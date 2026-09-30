// The Settings view (lib/Settings.js) and the sectioned settings file (lib/Client.js):
// migration from the flat file, edits, validation, and the rows of each page, onboarding
// included (PLAN-providers.md §3, §5).
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../lib/Settings.js");
const C = require("../lib/Client.js");
const V = require("../lib/Views.js");

const row = V.listRow;

function providers(over) {
  const base = [
    { id: "claude", name: "Claude (subscription)", kind: "subscription", enabled: false, takesKey: false, needsKey: false, key: { set: false }, detected: { available: true, signedIn: null, detail: "Claude Code is installed" }, privacy: "p", cost: "c", signIn: "claude, then /login" },
    { id: "chatgpt", name: "ChatGPT (subscription)", kind: "subscription", enabled: false, takesKey: false, key: { set: false }, detected: { available: true, signedIn: false, detail: "not signed in: codex login" }, privacy: "p", cost: "c" },
    { id: "openai", name: "OpenAI API", kind: "api", enabled: false, takesKey: true, needsKey: true, key: { set: false }, detected: { available: false }, envNames: ["OPENAI_API_KEY"], keyUrl: "https://platform.openai.com/api-keys", privacy: "p", cost: "c" },
    { id: "openrouter", name: "OpenRouter", kind: "api", enabled: false, takesKey: true, needsKey: true, key: { set: true, from: "keyring", masked: "sk-…abcd" }, detected: { available: false }, privacy: "p", cost: "c" },
    { id: "ollama", name: "Ollama", kind: "local", enabled: true, takesKey: false, key: { set: false }, detected: { available: true, signedIn: true, detail: "running, with 2 models" }, baseURL: "http://localhost:11434/v1", privacy: "p", cost: "c" },
    { id: "lab", name: "Lab", kind: "endpoint", endpoint: true, enabled: true, takesKey: true, needsKey: false, key: { set: false }, detected: { available: false }, baseURL: "https://gw/v1", privacy: "p", cost: "c" },
  ];
  return base.map((p) => Object.assign({}, p, (over || {})[p.id] || {}));
}

function state(over) {
  return Object.assign({
    settings: C.normalizeSettings({ providers: { ollama: { enabled: true } } }).settings,
    info: { keyring: { ok: true }, providers: providers() },
    runner: { installed: true, installing: false },
    reqs: { node: "v26.10.0", pdftotext: true },
    models: [{ value: "ollama:qwen3:8b", displayName: "qwen3:8b", group: "Ollama", context: 40960, efforts: ["low"] }],
    defaults: { prompts: "ollama:qwen3:8b", chat: "ollama:qwen3:8b" },
    tests: {}, open: "",
  }, over || {});
}

test("the file: flat settings move into general; providers and defaults round-trip and validate", () => {
  const flat = C.normalizeSettings({ maxResults: 40, emptyQuery: { recent: "added" } }).settings;
  assert.equal(flat.configured, false);
  assert.equal(flat.providers.claude.enabled, true); // before sections: Claude
  const file = S.toFile(flat);
  assert.deepEqual(file.general, { maxResults: 40, emptyQuery: { recent: "added" } });
  assert.equal(file.providers.claude.enabled, true); // written out, so it stays on
  const back = C.normalizeSettings(file);
  assert.deepEqual(back.problems, []);
  assert.equal(back.settings.maxResults, 40);
  assert.equal(back.settings.configured, true);
  // edits on normalized settings, then the file
  let s = S.withValue(back.settings, "providers.openai.enabled", true);
  s = S.withValue(s, "general.accelerators", false);
  s = S.withValue(s, "defaults.chat.model", "openai:gpt-5.5");
  s = S.withValue(s, "general.externalPdfCommand", ["zathura", "--fork"]);
  const added = S.addEndpoint(s, "Lab Gateway!", "https://gw.example.edu/v1");
  assert.equal(added.id, "lab-gateway");
  assert.equal(S.addEndpoint(added.settings, "Lab Gateway", "https://x/v1").id, "lab-gateway-2");
  assert.equal(S.addEndpoint(s, "OpenAI", "https://x/v1").id, "openai-2"); // never a provider's id
  s = S.withValue(added.settings, "endpoint.lab-gateway.context", 32768);
  const f2 = S.toFile(s);
  assert.deepEqual(f2.general, { maxResults: 40, emptyQuery: { recent: "added" }, accelerators: false, externalPdfCommand: ["zathura", "--fork"] });
  assert.deepEqual(f2.providers.compatible, [{ id: "lab-gateway", name: "Lab Gateway!", baseURL: "https://gw.example.edu/v1", enabled: true, context: 32768 }]);
  assert.deepEqual(f2.defaults, { chat: { model: "openai:gpt-5.5", effort: "high" } });
  const r = C.normalizeSettings(f2);
  assert.deepEqual(r.problems, []);
  assert.equal(r.settings.providers.openai.enabled, true);
  assert.equal(r.settings.endpoints[0].context, 32768);
  assert.deepEqual(S.removeEndpoint(s, "lab-gateway").endpoints, []);
  assert.equal(S.withValue(s, "general.externalPdfCommand", undefined).externalPdfCommand, undefined); // back to the default
  // what the validator refuses, the launcher doesn't write
  const bad = C.normalizeSettings({ providers: { openai: { enabled: "yes" }, nope: {}, compatible: [{ id: "openai", baseURL: "x" }] }, defaults: { chat: { model: "a b" } } });
  assert.deepEqual(bad.problems, [
    "providers.openai.enabled must be true or false",
    'unknown provider "nope"',
    "providers.compatible[0] needs a new id (a-z, 0-9, -; not a provider's name)",
    'defaults.chat.model must be a model, e.g. "openai:gpt-5.5"',
  ]);
  assert.deepEqual(C.normalizeSettings({ general: { colour: 1 } }).problems, ['unknown setting "colour"']);
});

test("parseValue: numbers in range, commands, URLs, context sizes", () => {
  const n = S.generalItem("maxResults");
  assert.deepEqual(S.parseValue(n, "80"), { value: 80 });
  assert.match(S.parseValue(n, "5").error, /10 to 200/);
  assert.match(S.parseValue(n, "lots").error, /whole number/);
  assert.deepEqual(S.parseValue(S.generalItem("externalPdfCommand"), " zathura  --fork "), { value: ["zathura", "--fork"] });
  assert.deepEqual(S.parseValue(S.generalItem("externalPdfCommand"), ""), { value: undefined });
  assert.deepEqual(S.parseValue({ type: "url" }, "http://localhost:1234/v1/"), { value: "http://localhost:1234/v1" });
  assert.ok(S.parseValue({ type: "url" }, "localhost:1234").error);
  assert.deepEqual(S.parseValue({ type: "context" }, "32k"), { value: 32768 });
  assert.deepEqual(S.parseValue({ type: "context" }, ""), { value: undefined });
  assert.equal(S.valueText(S.generalItem("emptyQuery.recent"), undefined), "Newest added or changed");
});

test("Settings pages: the root with requirements; General from the schema, with dropdowns", () => {
  const root = S.buildRoot(state(), row);
  assert.deepEqual(root.map((r) => [r.section, r.label]), [
    ["Settings", "Models & providers"], ["Settings", "Defaults"], ["Settings", "General"],
    ["Requirements", "Node.js v26.10.0"], ["Requirements", "AI features installed"], ["Requirements", "pdftotext"], ["Requirements", "System keyring"]]);
  assert.equal(root[0].detail, "Ollama, Lab are on");
  assert.equal(root[1].detail, "Prompts: ollama:qwen3:8b · Chat: ollama:qwen3:8b");
  const fresh = S.buildRoot(state({ runner: { installed: false, installing: false }, reqs: { node: "", pdftotext: false }, info: null }), row);
  const install = fresh.find((r) => r.rowId === "set-install");
  assert.deepEqual([install.label, install.available, install.detail], ["Install AI features", false, "Install Node.js first"]);
  assert.match(fresh.find((r) => /Node/.test(r.label)).detail, /omarchy install dev-env node/);
  assert.match(fresh.find((r) => /pdftotext/.test(r.label)).detail, /omarchy pkg add poppler/);
  const g = S.buildGeneral(state({ open: "general.emptyQuery.recent" }), row);
  assert.equal(g.length, S.GENERAL.length + 4); // the open dropdown's four options
  const opts = g.filter((r) => r.rowId === "set-opt");
  assert.deepEqual(opts.map((r) => [r.tag, r.checked]), [["latest", true], ["added", false], ["modified", false], ["none", false]]);
  assert.equal(g.find((r) => r.value === "general.accelerators").detail, "On · Alt+O, Alt+W and the others act on the selected paper");
});

test("Models & providers: ready to use first, yours, then ways to add one; a provider's page", () => {
  const rows = S.buildProviders(state(), row);
  assert.deepEqual(rows.map((r) => [r.section, r.rowId, r.value || r.label]), [
    ["Ready to use", "set-quick", "claude"], // detected (ChatGPT isn't signed in: not offered)
    ["Your providers", "set-provider", "openrouter"], ["Your providers", "set-provider", "ollama"], ["Your providers", "set-provider", "lab"],
    ["Add a provider", "set-provider", "chatgpt"], ["Add a provider", "set-provider", "openai"],
    ["Add a provider", "set-endpoint-new", "Add an OpenAI-compatible endpoint…"]]);
  assert.match(rows[0].detail, /Claude Code is installed · Enter turns it on/);
  assert.match(rows[1].detail, /key sk-…abcd/);
  assert.equal(S.buildProviders(state({ info: null }), row)[0].label, "Checking what's installed…");
  const page = S.buildProvider(state({ tests: { openai: { ok: true, detail: "3 models", models: [{ value: "openai:gpt-5.5", displayName: "gpt-5.5", priceIn: 1.25, priceOut: 10 }] } } }), "openai", row);
  assert.deepEqual(page.map((r) => r.rowId), ["set-toggle", "set-test", "set-key", "set-link", "set-info", "set-use", "set-info", "set-info", "set-info"]);
  assert.equal(page[0].value, "providers.openai.enabled");
  assert.match(page[2].label, /Set the API key from the clipboard/);
  assert.match(page[2].detail, /clipboard is cleared/);
  assert.match(page[page.length - 1].detail, /with gpt-5.5, about \$0.07–\$0.14 a run/);
  const lab = S.buildProvider(state(), "lab", row);
  assert.equal(lab[0].value, "endpoint.lab.enabled");
  assert.ok(lab.some((r) => r.value === "endpoint.lab.baseURL") && lab.some((r) => r.rowId === "set-endpoint-remove"));
  const ollama = S.buildProvider(state(), "ollama", row);
  assert.ok(ollama.some((r) => r.value === "providers.ollama.context") && !ollama.some((r) => r.rowId === "set-key"));
  // no keyring: keys can't be stored (the environment still works)
  const nokr = S.buildProvider(state({ info: { keyring: { ok: false, detail: "no Secret Service" }, providers: providers() } }), "openai", row);
  assert.equal(nokr.find((r) => r.rowId === "set-key").available, false);
});

test("onboarding: nothing on, or no runner, means Set up an AI model", () => {
  assert.equal(S.needsSetup(state()), false);
  const none = providers({ ollama: { enabled: false }, lab: { enabled: false } });
  assert.equal(S.needsSetup(state({ info: { keyring: { ok: true }, providers: none } })), true);
  assert.equal(S.needsSetup(state({ runner: { installed: false } })), true);
  assert.equal(S.needsSetup(state({ info: null })), false); // still loading: don't flash the setup row
  const details = { item: { itemType: "journalArticle" }, attachments: [{ exists: true, contentType: "application/pdf" }], notes: [], tags: [], library: { editable: true } };
  const menu = V.buildActions(details, "", [], "", false, true);
  assert.deepEqual(menu.filter((r) => r.section === "Prompts and chat").map((r) => r.rowId), ["setup", "extract"]);
  const noRunner = V.buildActions(details, "", null, "oma-zotero-prompt isn't installed: make prompts-install", false, true);
  assert.match(noRunner.find((r) => r.rowId === "setup").detail, /install the AI features/);
  assert.match(noRunner.find((r) => r.rowId === "extract").detail, /Needs the AI features/);
});

test("Defaults and the model picker: grouped by provider; one provider's for Use for prompts and chat", () => {
  const s = state();
  s.settings = S.withValue(s.settings, "defaults.chat.model", "ollama:qwen3:8b");
  const d = S.buildDefaults(s, row);
  assert.deepEqual(d.map((r) => [r.section, r.label]), [["Prompts", "Model"], ["Prompts", "Effort"], ["Chat", "Model"], ["Chat", "Effort"],
    ["When a model fails", "Fallback model"], ["When a model fails", "Prompts can name their own model"]]);
  assert.equal(d[0].detail, "ollama:qwen3:8b (automatic)");
  assert.equal(d[2].detail, "ollama:qwen3:8b");
  const pick = S.buildModelPicker(s, "defaults.chat.model", row);
  assert.deepEqual(pick.map((r) => [r.section, r.tag, r.checked]), [["Ollama", "ollama:qwen3:8b", true]]);
  assert.match(pick[0].detail, /41k context · effort levels/);
  const fb = S.buildModelPicker(s, "defaults.fallback", row);
  assert.deepEqual(fb.map((r) => [r.label, r.checked]), [["None", true], ["qwen3:8b", false]]);
  assert.equal(S.modelDetail({ context: 8192, free: true }), "8k context: partial text · free");
});
