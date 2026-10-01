// Model providers (daemon/lib/providers/, modelspec, settings, secrets, generate, quotes):
// model names, the settings file, keys in a (fake) keyring, and one contract every provider
// passes against fakes: deltas in order, the whole text, usage, errors, cancellation. No keys,
// no network (PLAN-providers.md §8).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DAEMON = path.join(__dirname, "..", "daemon");
const M = () => import("../daemon/lib/modelspec.mjs");
const S = () => import("../daemon/lib/settings.mjs");
const K = () => import("../daemon/lib/secrets.mjs");
const P = () => import("../daemon/lib/providers/index.mjs");
const G = () => import("../daemon/lib/generate.mjs");
const Q = () => import("../daemon/lib/quotes.mjs");
const C = () => import("../daemon/lib/context.mjs");
const aiTest = () => import(require.resolve("ai/test", { paths: [DAEMON] }));

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), "oma-" + name + "-"));

test("model names: provider:model, bare = Claude, endpoints, validity", async () => {
  const m = await M();
  assert.deepEqual(m.parseModel("openai:gpt-5.5"), { provider: "openai", model: "gpt-5.5" });
  assert.deepEqual(m.parseModel("opus[1m]"), { provider: "claude", model: "opus[1m]" });
  assert.deepEqual(m.parseModel("ollama:qwen3:4b"), { provider: "ollama", model: "qwen3:4b" }); // only the first colon
  assert.deepEqual(m.parseModel("openrouter:deepseek/deepseek-r1:free"), { provider: "openrouter", model: "deepseek/deepseek-r1:free" });
  assert.deepEqual(m.parseModel("lab:llama-3.3-70b", ["lab"]), { provider: "lab", model: "llama-3.3-70b" });
  assert.deepEqual(m.parseModel("lab:llama"), { provider: "claude", model: "lab:llama" }); // not an endpoint: a (bare) Claude name
  assert.equal(m.canonModel("sonnet"), "claude:sonnet");
  assert.ok(m.sameModel("opus[1m]", "claude:opus[1m]"));
  for (const ok of ["default", "opus[1m]", "claude:opus[1m]", "openrouter:meta-llama/llama-3.3-70b-instruct:free", "ollama:qwen3:4b", "google:gemini-2.5-pro"]) assert.ok(m.validModel(ok), ok);
  for (const bad of ["", "rm -rf /", "a b", "openai:gpt\n5"]) assert.ok(!m.validModel(bad), bad);
  assert.ok(m.validEndpointId("lab") && !m.validEndpointId("openai") && !m.validEndpointId("default") && !m.validEndpointId("A"));
  // one effort scale, mapped: the AI SDK has no "max"
  assert.equal(m.aiSdkReasoning("max"), "xhigh");
  assert.equal(m.aiSdkReasoning(""), undefined);
  assert.deepEqual(m.effortsFor("gpt-4o"), []);
  assert.ok(m.effortsFor("o3").length && m.effortsFor("openai/gpt-5.5").length && m.effortsFor("gemini-2.5-flash").length);
  assert.equal(m.guessWindow("gpt-4o-mini"), 128000);
  assert.equal(m.guessWindow("something-new"), 0);
});

test("settings: a file from before sections means Claude; sections are read leniently", async () => {
  const { readSettings } = await S();
  const legacy = readSettings({ enterAction: "select" });
  assert.equal(legacy.configured, false);
  assert.equal(legacy.providers.claude.enabled, true);
  assert.equal(legacy.providers.openai.enabled, false);
  assert.equal(readSettings(null).providers.claude.enabled, true);
  const s = readSettings({
    general: { maxResults: 40 },
    providers: { ollama: { enabled: true, context: 32768 }, openai: { enabled: "yes" }, compatible: [
      { id: "lab", name: "Lab", baseURL: "https://gw.example.edu/v1" }, { id: "openai", baseURL: "https://x/v1" }, { id: "bad url", baseURL: "ftp://x" }] },
    defaults: { chat: { model: "ollama:qwen3:4b", effort: "" }, prompts: { model: "rm -rf", effort: "huge" }, fallback: "openrouter:x/y" },
  });
  assert.equal(s.configured, true);
  assert.equal(s.providers.claude.enabled, false); // configured: nothing is on unless it says so
  assert.equal(s.providers.openai.enabled, false); // only true is true
  assert.equal(s.providers.ollama.context, 32768);
  assert.equal(s.providers.ollama.baseURL, "http://localhost:11434/v1");
  assert.deepEqual(s.endpoints.map((e) => e.id), ["lab"]); // a built-in's id and a bad URL are dropped
  assert.deepEqual(s.defaults.chat, { model: "ollama:qwen3:4b", effort: "" });
  assert.deepEqual(s.defaults.prompts, { model: "", effort: "high" });
  assert.equal(s.defaults.fallback, "openrouter:x/y");
});

test("resolveModel: defaults, a provider that is off, and nothing set up", async () => {
  const { readSettings } = await S();
  const { resolveModel } = await P();
  const legacy = readSettings(null);
  assert.equal(resolveModel("default", legacy).spec, "claude:opus[1m]");
  assert.equal(resolveModel("sonnet", legacy).spec, "claude:sonnet");
  const s = readSettings({ providers: { ollama: { enabled: true } }, defaults: { chat: { model: "ollama:qwen3:8b" }, prompts: { model: "ollama:gemma3:12b" } } });
  assert.equal(resolveModel("", s, "chat").spec, "ollama:qwen3:8b");
  assert.equal(resolveModel("default", s, "prompts").spec, "ollama:gemma3:12b");
  const off = resolveModel("opus[1m]", s, "prompts"); // an old prompt file, Claude now off
  assert.equal(off.spec, "ollama:gemma3:12b");
  assert.match(off.note, /Claude \(subscription\) is off: using the default model, ollama:gemma3:12b/);
  assert.throws(() => resolveModel("default", readSettings({ providers: {} })), /no AI model is set up/);
  assert.throws(() => resolveModel("default", readSettings({ providers: { openai: { enabled: true } } })), /choose one in Settings › Defaults/);
});

test("secrets: the keyring through secret-tool, the environment as a fallback, never a file", async () => {
  const k = await K();
  const dir = tmp("secret");
  const store = path.join(dir, "store.json");
  // A fake secret-tool: a JSON file stands in for the Secret Service.
  const bin = path.join(dir, "secret-tool");
  fs.writeFileSync(bin, `#!/usr/bin/env node
const fs = require("fs"); const f = ${JSON.stringify(store)};
const db = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
const [cmd, ...a] = process.argv.slice(2); const attrs = a.filter((x, i) => a[i - 1] !== "--label" && x !== "--label");
const id = attrs.join("|");
if (cmd === "lookup") { if (db[id]) process.stdout.write(db[id]); else process.exit(1); }
else if (cmd === "store") { db[id] = fs.readFileSync(0, "utf8"); fs.writeFileSync(f, JSON.stringify(db)); }
else if (cmd === "clear") { delete db[id]; fs.writeFileSync(f, JSON.stringify(db)); }
`, { mode: 0o755 });
  const opts = { bin, env: { PATH: process.env.PATH } };
  assert.deepEqual(k.keyringStatus(opts), { ok: true, detail: "system keyring" });
  assert.equal(k.getSecret("openai", opts), null);
  k.setSecret("openai", "  sk-test-1234567890\n", opts);
  assert.equal(k.getSecret("openai", opts), "sk-test-1234567890");
  assert.deepEqual(k.resolveKey("openai", opts), { value: "sk-test-1234567890", from: "keyring" });
  assert.throws(() => k.setSecret("openai", "two words", opts), /no spaces/);
  assert.throws(() => k.setSecret("openai", "", opts), /empty/);
  k.removeSecret("openai", opts);
  assert.equal(k.getSecret("openai", opts), null);
  assert.deepEqual(k.resolveKey("google", { bin, env: { GEMINI_API_KEY: "g-key" } }), { value: "g-key", from: "GEMINI_API_KEY" });
  assert.equal(k.maskKey("sk-test-1234567890"), "sk-…7890");
  assert.deepEqual(k.keyringStatus({ bin: path.join(dir, "missing") }).ok, false);
});

// ---------------------------------------------------------------- the provider contract

// Every provider: deltas arrive in order and add up to the text; usage is numbers; an error is
// an Error with the provider's reason; an aborted signal stops it.
async function contract(name, run) {
  const deltas = [];
  const r = await run({ onDelta: (d) => deltas.push(d) });
  assert.equal(deltas.join(""), r.text, name + ": deltas add up to the text");
  assert.ok(deltas.length >= 2, name + ": streamed in parts");
  assert.equal(r.text, "Bundling is “stabilizing, enriching, and pioneering” (p. 281).", name);
  for (const k of ["input", "output", "cacheRead", "cacheWrite"]) assert.equal(typeof r.usage[k], "number", name + " usage." + k);
  assert.ok(r.usage.input > 0 && r.usage.output > 0, name + ": usage counted");
  return r;
}

const PARTS = ["Bundling is “stabilizing, ", "enriching, and pioneering” ", "(p. 281)."];

function mockModel(MockLanguageModelV4, { fail } = {}) {
  return new MockLanguageModelV4({
    doStream: async () => {
      if (fail) throw Object.assign(new Error("Incorrect API key provided"), { statusCode: 401 });
      const chunks = [{ type: "stream-start", warnings: [] }, { type: "text-start", id: "t" }]
        .concat(PARTS.map((d) => ({ type: "text-delta", id: "t", delta: d })))
        .concat([{ type: "text-end", id: "t" }, { type: "finish", finishReason: { unified: "stop", raw: "stop" },
          usage: { inputTokens: { total: 1200, noCache: 200, cacheRead: 1000, cacheWrite: 0 }, outputTokens: { total: 30, text: 30, reasoning: 0 } } }]);
      return { stream: new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } }) };
    },
  });
}

test("contract: the API providers (OpenAI, Anthropic, Gemini, OpenRouter, compatible) through the AI SDK", async () => {
  const { MockLanguageModelV4 } = await aiTest();
  const { openai, anthropic, google, openrouter, compatible } = await import("../daemon/lib/providers/api.mjs");
  const { makeCtx } = await P();
  const ctx = makeCtx({ key: () => ({ value: "k", from: "keyring" }), env: {} });
  const lab = compatible({ id: "lab", name: "Lab", baseURL: "http://127.0.0.1:9/v1" });
  for (const base of [openai, anthropic, google, openrouter, lab]) {
    const seen = [];
    const p = Object.create(base);
    p.createModel = async (config, key, id) => { seen.push({ key, id }); return mockModel(MockLanguageModelV4); };
    const r = await contract(base.id, (o) => p.stream(Object.assign({ config: {}, model: "m-1", system: "sys", messages: [{ role: "user", content: "q" }], ctx }, o)));
    assert.deepEqual(r.usage, { input: 1200, output: 30, cacheRead: 1000, cacheWrite: 0 }, base.id);
    assert.deepEqual(seen, [{ key: "k", id: "m-1" }]);
    const bad = Object.create(base);
    bad.createModel = async () => mockModel(MockLanguageModelV4, { fail: true });
    await assert.rejects(bad.stream({ config: {}, model: "m", system: "s", messages: [{ role: "user", content: "q" }], ctx }), /API key was refused \(401\)/, base.id);
  }
  // Anthropic: the first message (the paper) is marked for caching
  let sent = null;
  const capture = (o) => {
    sent = o;
    return { stream: (async function* () { yield { type: "text-delta", text: "ok" }; yield { type: "finish", totalUsage: { inputTokens: 1, outputTokens: 1 } }; })(), usage: Promise.resolve(null), providerMetadata: Promise.resolve(null) };
  };
  const a = Object.create(anthropic);
  a.createModel = async () => mockModel(MockLanguageModelV4);
  await a.stream({ config: {}, model: "claude-x", effort: "high", system: "s", messages: [{ role: "user", content: "paper" }, { role: "assistant", content: "a" }, { role: "user", content: "q" }], ctx: Object.assign({}, ctx, { streamText: capture }) });
  assert.deepEqual(sent.messages[0].providerOptions, { anthropic: { cacheControl: { type: "ephemeral" } } });
  assert.equal(sent.messages[2].providerOptions, undefined);
  assert.equal(sent.instructions, "s");
  assert.equal(sent.reasoning, undefined); // "claude-x" isn't a known reasoning model: no effort sent
  // no key: a clear reason, before any request
  const nokey = makeCtx({ key: () => null, env: {} });
  await assert.rejects(openai.stream({ config: {}, model: "gpt", system: "s", messages: [], ctx: nokey }), /OpenAI API: no API key/);
});

test("model lists: each provider's answer, normalized (context, efforts, prices)", async () => {
  const { openai, anthropic, google, openrouter, compatible } = await import("../daemon/lib/providers/api.mjs");
  const { makeCtx } = await P();
  const answers = {
    "https://api.openai.com/v1/models": { data: [{ id: "gpt-5.5" }, { id: "gpt-4o" }, { id: "text-embedding-3-large" }, { id: "gpt-4o-realtime-preview" }, { id: "o3" }] },
    "https://api.anthropic.com/v1/models?limit=100": { data: [{ id: "claude-sonnet-5", display_name: "Claude Sonnet 5", max_input_tokens: 1000000 }] },
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200": { models: [
      { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", inputTokenLimit: 1048576, supportedGenerationMethods: ["generateContent"], thinking: true, description: "Our best. More text." },
      { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] }] },
    "https://openrouter.ai/api/v1/models": { data: [
      { id: "deepseek/deepseek-r1:free", name: "DeepSeek R1 (free)", context_length: 163840, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["reasoning"] },
      { id: "openai/gpt-5.5", name: "GPT-5.5", context_length: 272000, pricing: { prompt: "0.00000125", completion: "0.00001" }, supported_parameters: [] }] },
    "http://127.0.0.1:9/v1/models": { data: [{ id: "llama-3.3-70b" }] },
  };
  const headers = {};
  const fetch = async (url, o) => { headers[url] = (o && o.headers) || {}; return new Response(JSON.stringify(answers[url] || {}), { status: answers[url] ? 200 : 404 }); };
  const ctx = makeCtx({ fetch, key: (id) => ({ value: "key-" + id }), env: {} });
  assert.deepEqual((await openai.listModels({}, ctx)).map((m) => m.id), ["o3", "gpt-5.5", "gpt-4o"]);
  assert.equal(headers["https://api.openai.com/v1/models"].Authorization, "Bearer key-openai");
  assert.deepEqual(await anthropic.listModels({}, ctx), [{ id: "claude-sonnet-5", name: "Claude Sonnet 5", description: "", context: 1000000, efforts: ["low", "medium", "high", "xhigh"] }]);
  assert.equal(headers["https://api.anthropic.com/v1/models?limit=100"]["x-api-key"], "key-anthropic");
  const g = await google.listModels({}, ctx);
  assert.deepEqual(g, [{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", description: "Our best", context: 1048576, efforts: ["low", "medium", "high"] }]);
  const or = await openrouter.listModels({}, ctx);
  assert.equal(or[0].free, true);
  assert.deepEqual(or[0].efforts, ["low", "medium", "high"]);
  assert.equal(or[1].priceIn, 1.25);
  assert.equal(or[1].priceOut, 10);
  const lab = compatible({ id: "lab", name: "Lab", baseURL: "http://127.0.0.1:9/v1", context: 65536 });
  assert.deepEqual(await lab.listModels({}, makeCtx({ fetch, key: () => null, env: {} })), [{ id: "llama-3.3-70b", name: "llama-3.3-70b", description: "", context: 65536, efforts: [] }]);
  // a refused key says so
  const refused = makeCtx({ fetch: async () => new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 }), key: () => ({ value: "bad" }), env: {} });
  await assert.rejects(anthropic.listModels({}, refused), /API key was refused \(401\): invalid x-api-key/);
  const st = await anthropic.status({}, makeCtx({ fetch, key: () => null, env: {} }));
  assert.deepEqual([st.ok, /no API key/.test(st.detail), /ANTHROPIC_API_KEY/.test(st.detail)], [false, true, true]);
});

// A fake Ollama: /api/tags, /api/show, and /api/chat streaming NDJSON.
function fakeOllama({ failModel } = {}) {
  const calls = [];
  const fetch = async (url, o = {}) => {
    const body = o.body ? JSON.parse(o.body) : null;
    calls.push({ url, body });
    if (url.endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "qwen3:8b", details: { parameter_size: "8.2B" } }, { name: "nomic-embed-text" }] }));
    if (url.endsWith("/api/show")) {
      const embed = body.model === "nomic-embed-text";
      return new Response(JSON.stringify({ model_info: { "qwen3.context_length": 40960 }, capabilities: embed ? ["embedding"] : ["completion", "thinking"], details: { parameter_size: "8.2B" } }));
    }
    if (url.endsWith("/api/chat")) {
      if (body.model === failModel) return new Response(JSON.stringify({ error: `model "${failModel}" not found, try pulling it first` }), { status: 404 });
      const lines = PARTS.map((d) => JSON.stringify({ message: { content: d }, done: false }) + "\n").concat([JSON.stringify({ done: true, prompt_eval_count: 900, eval_count: 25 }) + "\n"]);
      const enc = new TextEncoder();
      return { ok: true, status: 200, body: (async function* () { for (const l of lines) { yield enc.encode(l.slice(0, 7)); yield enc.encode(l.slice(7)); } })() };
    }
    return new Response("", { status: 404 });
  };
  return { fetch, calls };
}

test("contract: Ollama (its own API; the context each request needs; thinking)", async () => {
  const { ollama, numCtx } = await import("../daemon/lib/providers/ollama.mjs");
  const { makeCtx } = await P();
  const f = fakeOllama();
  const ctx = makeCtx({ fetch: f.fetch, env: {} });
  const models = await ollama.listModels({ baseURL: "http://localhost:11434/v1" }, ctx);
  assert.deepEqual(models.map((m) => [m.id, m.context, m.efforts.length]), [["qwen3:8b", 40960, 3]]); // the embedding model is left out
  const r = await contract("ollama", (o) => ollama.stream(Object.assign({ config: { baseURL: "http://localhost:11434/v1" }, model: "qwen3:8b", effort: "high", system: "sys", messages: [{ role: "user", content: "x".repeat(36000) }], ctx }, o)));
  assert.deepEqual(r.usage, { input: 900, output: 25, cacheRead: 0, cacheWrite: 0 });
  const chat = f.calls.find((c) => c.url.endsWith("/api/chat")).body;
  assert.equal(chat.messages[0].role, "system");
  assert.equal(chat.think, true); // qwen3 thinks or not; levels are gpt-oss's
  assert.equal(chat.options.num_ctx, 20480); // 10k for the text + 8k for the answer, in 4k steps
  assert.equal(numCtx([{ content: "x".repeat(3600000) }], "", { max: 40960 }), 40960); // never past the model
  assert.equal(numCtx([{ content: "x" }], "", { cap: 8192 }), 8192);
  const bad = fakeOllama({ failModel: "nope" });
  await assert.rejects(ollama.stream({ config: {}, model: "nope", system: "s", messages: [{ role: "user", content: "q" }], ctx: makeCtx({ fetch: bad.fetch, env: {} }) }), /not found, try pulling it first/);
  const down = makeCtx({ fetch: async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); }, env: {} });
  assert.deepEqual((await ollama.detect(down, {})).available, false);
  assert.match((await ollama.status({}, down)).detail, /Ollama isn't answering/);
});

test("contract: Claude (Agent SDK) and ChatGPT (Codex SDK), stateful, against fake SDKs", async () => {
  const { claude } = await import("../daemon/lib/providers/claude.mjs");
  const { chatgpt, loginState, parseCatalog } = await import("../daemon/lib/providers/chatgpt.mjs");
  const { makeCtx } = await P();
  const stateDir = tmp("state");
  let options = null;
  const agentSdk = async () => ({
    query: ({ prompt, options: o }) => {
      options = Object.assign({ prompt }, o);
      const msgs = [{ type: "system", subtype: "init", session_id: "sess-1" }]
        .concat(PARTS.map((d) => ({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: d } } })))
        .concat([{ type: "result", subtype: "success", result: PARTS.join(""), session_id: "sess-1", total_cost_usd: 0.12,
          usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 190, output_tokens: 30 }, modelUsage: { "claude-opus-5": { contextWindow: 1000000 } } }]);
      return Object.assign((async function* () { for (const m of msgs) yield m; })(), { close() {} });
    },
  });
  const r = await contract("claude", (o) => claude.stream(Object.assign({ model: "opus[1m]", effort: "high", system: "sys", message: "q", resume: "sess-0", persist: true, ctx: makeCtx({ agentSdk, stateDir, env: {} }) }, o)));
  assert.deepEqual([r.session, r.window, r.subscription, r.usage.input], ["sess-1", 1000000, true, 1200]);
  assert.deepEqual([options.resume, options.maxTurns, options.tools, options.settingSources, options.settings.autoCompactEnabled], ["sess-0", 1, [], [], false]);

  // Codex: its commands under the paper-only profile (no --sandbox flag, which would override
  // it), no network, an empty folder; the instructions lead a new thread's message
  let threadOpts = null, input = null, resumed = null, codexOpts = null;
  const codexSdk = async () => ({
    Codex: class {
      constructor(o) { this.o = o; codexOpts = o; }
      startThread(opts) { threadOpts = opts; return this.thread(); }
      resumeThread(id, opts) { resumed = id; threadOpts = opts; return this.thread(); }
      thread() {
        return { id: "th-1", runStreamed: async (i) => { input = i; let acc = "";
          const evs = [{ type: "thread.started", thread_id: "th-1" }, { type: "turn.started" }]
            .concat(PARTS.map((d) => { acc += d; return { type: "item.updated", item: { type: "agent_message", text: acc } }; }))
            .concat([{ type: "item.completed", item: { type: "agent_message", text: acc } }, { type: "turn.completed", usage: { input_tokens: 800, cached_input_tokens: 500, cache_write_input_tokens: 0, output_tokens: 40, reasoning_output_tokens: 5 } }]);
          return { events: (async function* () { for (const e of evs) yield e; })() }; } };
      }
    },
  });
  const fakeBin = path.join(tmp("codex"), "bin", "codex");
  fs.mkdirSync(path.dirname(fakeBin), { recursive: true });
  fs.writeFileSync(fakeBin, "");
  const cctx = makeCtx({ codexSdk, stateDir, env: { OPENAI_API_KEY: "should-not-pass" }, codexBin: fakeBin });
  const c = await contract("chatgpt", (o) => chatgpt.stream(Object.assign({ model: "gpt-5.5", effort: "high", system: "SYS", message: "the paper and q", ctx: cctx }, o)));
  assert.deepEqual([c.session, c.usage.input, c.usage.cacheRead], ["th-1", 800, 500]);
  assert.deepEqual([threadOpts.sandboxMode, threadOpts.networkAccessEnabled, threadOpts.webSearchMode, threadOpts.approvalPolicy, threadOpts.modelReasoningEffort], [undefined, false, "disabled", "never", "high"]);
  assert.equal(codexOpts.codexPathOverride, fs.realpathSync(fakeBin));
  assert.equal(codexOpts.env.OPENAI_API_KEY, undefined);
  assert.ok(codexOpts.configOverrides.includes('default_permissions="oma-paper-only"'));
  assert.ok(codexOpts.configOverrides.includes(`permissions.oma-paper-only.filesystem={":root" = "none", ":minimal" = "read", ${JSON.stringify(path.dirname(path.dirname(fs.realpathSync(fakeBin))))} = "read"}`));
  for (const o of ["mcp_servers={}", "features.view_image=false", "features.hooks=false", "features.apps=false", "features.multi_agent=false"]) assert.ok(codexOpts.configOverrides.includes(o), o);
  assert.match(input, /^SYS\n\n---\n\nthe paper and q$/);
  await chatgpt.stream({ model: "gpt-5.5", system: "SYS", message: "next", resume: "th-1", ctx: cctx });
  assert.deepEqual([resumed, input], ["th-1", "next"]);
  // failures come back as reasons
  const failing = async () => ({ Codex: class { startThread() { return { runStreamed: async () => ({ events: (async function* () { yield { type: "turn.failed", error: { message: "usage limit reached" } }; })() }) }; } } });
  await assert.rejects(chatgpt.stream({ model: "m", system: "s", message: "q", ctx: makeCtx({ codexSdk: failing, stateDir, env: {}, codexBin: fakeBin }) }), /ChatGPT: usage limit reached/);
  assert.deepEqual(loginState("Logged in using ChatGPT"), { signedIn: true, detail: "signed in with ChatGPT" });
  assert.equal(loginState("Not logged in").signedIn, false);
  assert.match(loginState("Logged in using an API key - sk-…").detail, /API key, not a ChatGPT plan/);
  assert.deepEqual(parseCatalog(JSON.stringify({ models: [
    { slug: "gpt-5.5", display_name: "GPT-5.5", context_window: 272000, visibility: "list", supported_reasoning_levels: [{ effort: "low" }, { effort: "ultra" }] },
    { slug: "hidden", visibility: "hide" }] })), [{ id: "gpt-5.5", name: "GPT-5.5", description: "", context: 272000, efforts: ["low"] }]);
});

test("generate: the conversation folded for a new thread; the fallback model when a provider fails", async () => {
  const { foldMessages, generate, costOf } = await G();
  const { readSettings } = await S();
  const { makeCtx } = await P();
  assert.equal(foldMessages([{ role: "user", content: "paper + q1" }]), "paper + q1");
  assert.equal(foldMessages([{ role: "user", content: "P q1" }, { role: "assistant", content: "a1" }, { role: "user", content: "q2" }]),
    "P q1\n\n(Our conversation since then:)\n\n**You:** a1\n\n(Now:) q2");
  const f = fakeOllama({ failModel: "broken" });
  const env = { XDG_CACHE_HOME: tmp("cache") };
  const settings = readSettings({ providers: { ollama: { enabled: true } }, defaults: { fallback: "ollama:qwen3:8b" } });
  const notes = [];
  const r = await generate({ settings, ctx: makeCtx({ fetch: f.fetch, env }), target: { provider: "ollama", model: "broken", spec: "ollama:broken" }, system: "s",
    messages: [{ role: "user", content: "q" }], onFallback: (t) => notes.push(t) });
  assert.equal(r.spec, "ollama:qwen3:8b");
  assert.equal(r.fellBack.from, "ollama:broken");
  assert.match(notes[0], /ollama:broken failed .*not found.*: answering with the fallback, ollama:qwen3:8b/);
  // no fallback set: the error stands
  await assert.rejects(generate({ settings: readSettings({ providers: { ollama: { enabled: true } } }), ctx: makeCtx({ fetch: f.fetch, env }), target: { provider: "ollama", model: "broken", spec: "ollama:broken" }, system: "s", messages: [{ role: "user", content: "q" }] }), /not found/);
  assert.equal(costOf({ subscription: true, costUsd: 0.5 }), 0);
  assert.equal(costOf({ costUsd: 0.25 }), 0.25);
  assert.equal(costOf({ usage: { input: 1e6, output: 2e5 }, price: { in: 1.25, out: 10 } }), 3.25);
  assert.equal(costOf({ usage: { input: 5, output: 5 }, price: { in: null, out: null } }), null);
});

test("threads: a chat's conversation for providers sent all of it, before and after a summary", async () => {
  const c = await C();
  const ctx = { title: "T", annotations: [], notes: [], text: "[p. 1]\nbody", grounding: { label: "the note" } };
  // a chat saved before providers: a Claude session
  assert.deepEqual(c.threadOf({ sdkSession: "s1", messages: [] }), { provider: "claude", id: "s1", start: 0, summarized: false });
  const s = { messages: [{ role: "user", text: "q1" }, { role: "assistant", text: "a1" }], thread: { provider: "ollama", id: null, start: 0, summarized: false } };
  const m = c.threadMessages(s, ctx, "q2");
  assert.deepEqual(m.map((x) => x.role), ["user", "assistant", "user"]);
  assert.ok(m[0].content.includes("<paper>\n[p. 1]\nbody\n</paper>") && m[0].content.endsWith("q1"));
  assert.equal(m[2].content, "q2");
  assert.ok(c.threadMessages({ messages: [], thread: { start: 0 } }, ctx, "first").pop().content.includes("<paper>"));
  // after a summary: the paper, the summary and the recent turns open the thread
  const long = { summary: "- q1 → a1", messages: [
    { role: "user", text: "q1" }, { role: "assistant", text: "a1" }, { role: "user", text: "q2" }, { role: "assistant", text: "a2" },
    { role: "user", text: "q3" }, { role: "assistant", text: "a3" }, { role: "note", text: "summarized" }, { role: "user", text: "q4" }, { role: "assistant", text: "a4" }],
    thread: { provider: "openai", id: null, start: 7, summarized: true } };
  const t = c.threadMessages(long, ctx, "q5");
  assert.equal(t.length, 3);
  for (const want of ["<paper>", "- q1 → a1", "**User:** q2", "**Assistant:** a3", "(Now:) q4"]) assert.ok(t[0].content.includes(want), want);
  assert.equal(t[1].content, "a4");
  assert.equal(t[2].content, "q5");
  assert.equal(c.windowFor("claude:opus[1m]", {}), 1000000);
  assert.equal(c.windowFor("openai:gpt-5.5", {}, 272000), 272000);
  assert.equal(c.windowFor("openai:gpt-5.5", { "openai:gpt-5.5": 400000 }, 272000), 400000);
});

test("context budget: notes go first, then the text is cut from the end, and the label says so", async () => {
  const { fitContext } = await C();
  const ctx = { text: "t".repeat(36000), notes: [{ title: "a", markdown: "n".repeat(7200) }, { title: "b", markdown: "n".repeat(7200) }], annotations: [], grounding: { label: "the note" } };
  const whole = fitContext(ctx, 200000, 0.8);
  assert.deepEqual(whole.cut, { notes: 0, text: false });
  assert.equal(whole.ctx.grounding.label, "the note");
  const oneNote = fitContext(ctx, 20000, 0.8); // 16k - 2.5k for the instructions = 13.5k: 10k of text + 2k per note
  assert.deepEqual(oneNote.cut, { notes: 1, text: false });
  assert.deepEqual(oneNote.ctx.notes.map((n) => n.title), ["a"]); // the first notes stay
  const noNotes = fitContext(ctx, 18000, 0.8);
  assert.deepEqual(noNotes.cut, { notes: 2, text: false });
  assert.equal(noNotes.ctx.notes.length, 0);
  assert.equal(ctx.notes.length, 2); // the original is untouched
  const cut = fitContext(ctx, 8000, 0.8);
  assert.equal(cut.cut.text, true);
  assert.ok(cut.ctx.text.length < 36000 && /cut here to fit/.test(cut.ctx.text));
  assert.match(cut.ctx.grounding.label, /the text cut to fit the model, 2 notes left out to fit/);
});

test("quote check: quotations looked up word for word, forgiving typography", async () => {
  const q = await Q();
  const paper = "## p. 281\nBundling refers to the pro-\ncesses (i.e., stabilizing, enriching, and pioneering) used to integrate resources to form capabilities. [p. 282] Leveraging involves “mobilizing” capabilities.";
  const answer = [
    "Bundling “refers to the processes (i.e., stabilizing, enriching, and pioneering) used to integrate resources” (p. 281).",
    "They add \"used to integrate resources … form capabilities\" (p. 281).",
    "Invented: “firms must always bundle before they leverage anything” (p. 282).",
    "A term: “bundling” is short.",
  ].join("\n");
  assert.deepEqual(q.findQuotes(answer).length, 3); // the one-word term is left out
  const r = q.checkQuotes(answer, paper);
  assert.equal(r.checked, 3);
  assert.deepEqual(r.missing, ["firms must always bundle before they leverage anything"]);
  assert.match(q.quoteCheckLine(r), /^Quote check: 1 of 3 quotations were not found word for word/);
  assert.match(q.quoteCheckLine({ checked: 2, missing: [] }), /all 2 quotations were found/);
  assert.equal(q.quoteCheckLine({ checked: 0, missing: [] }), "");
  assert.deepEqual(q.checkQuotes(answer, ""), { checked: 0, missing: [] }); // no text: nothing to check against
  // the title, the reference, highlights and notes count too: the model was given them
  const src = q.groundingText({ title: "Managing Firm Resources in Dynamic Environments", reference: "Sirmon, D. G. (2007).", annotations: [{ text: "a highlighted sentence of some length", comment: "" }], notes: [{ markdown: "my own note says this plainly" }], text: paper });
  assert.deepEqual(q.checkQuotes("“Managing Firm Resources in Dynamic Environments” and “a highlighted sentence of some length” and “my own note says this plainly”", src).missing, []);
});
