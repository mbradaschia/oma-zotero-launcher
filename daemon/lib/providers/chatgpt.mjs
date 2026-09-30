// ChatGPT, with the user's ChatGPT plan: the Codex SDK, which runs the `codex` CLI signed in
// with `codex login`. Read-only sandbox, no network or web search, in an empty folder: it
// answers from the message, like the other providers. Stateful: a chat is a Codex thread,
// resumed on each turn.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const WALL_CLOCK_MS = 15 * 60 * 1000;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

function codexEnv(env) {
  // Without these the CLI uses the ChatGPT login (the plan), not an API key (a bill).
  const out = Object.assign({}, env);
  delete out.OPENAI_API_KEY;
  delete out.CODEX_API_KEY;
  return out;
}

function run(args, env, bin = "codex") {
  const r = spawnSync(bin, args, { encoding: "utf8", env: codexEnv(env), timeout: 30000 });
  if (r.error) return { ok: false, missing: r.error.code === "ENOENT", out: "" };
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

// `codex login status` → signed in with ChatGPT?
export function loginState(out) {
  const s = String(out || "");
  if (/not logged in/i.test(s)) return { signedIn: false, detail: "Codex is installed, but not signed in: codex login" };
  if (/chatgpt/i.test(s)) return { signedIn: true, detail: "signed in with ChatGPT" };
  if (/api key/i.test(s)) return { signedIn: false, detail: "Codex is signed in with an API key, not a ChatGPT plan: codex logout, then codex login" };
  return { signedIn: false, detail: s.trim().split("\n")[0] || "unknown login state" };
}

// `codex debug models` → the models the plan offers.
export function parseCatalog(text) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return [];
  }
  return (j.models || [])
    .filter((m) => m && m.slug && m.visibility !== "hide")
    .map((m) => ({
      id: m.slug,
      name: m.display_name || m.slug,
      description: String(m.description || ""),
      context: m.context_window || 0,
      efforts: (m.supported_reasoning_levels || []).map((l) => l.effort).filter((e) => EFFORTS.includes(e)),
    }));
}

export const chatgpt = {
  id: "chatgpt",
  name: "ChatGPT (subscription)",
  kind: "subscription",
  stateful: true,
  needsKey: false,
  signIn: "Install the Codex CLI (npm i -g @openai/codex) and sign in with ChatGPT: codex login",
  privacy: "Sends the paper's metadata and text, your highlights and notes, and your questions to OpenAI, under your ChatGPT plan's terms.",
  cost: "Included in your ChatGPT Plus, Pro or Team plan (it counts against its usage limits).",
  async detect(ctx) {
    const r = run(["login", "status"], ctx.env, ctx.codexBin);
    if (r.missing) return { available: false, signedIn: false, detail: "" };
    const s = loginState(r.out);
    return { available: true, signedIn: s.signedIn, detail: s.detail };
  },
  async status(config, ctx) {
    const d = await this.detect(ctx);
    if (!d.available) return { ok: false, detail: "Codex isn't installed: " + this.signIn };
    if (!d.signedIn) return { ok: false, detail: d.detail };
    const models = await this.listModels(config, ctx);
    return models.length ? { ok: true, detail: `${d.detail} · ${models.length} models`, models } : { ok: false, detail: "Codex listed no models" };
  },
  async listModels(config, ctx) {
    const r = run(["debug", "models"], ctx.env, ctx.codexBin);
    return r.ok ? parseCatalog(r.out.slice(r.out.indexOf("{"))) : [];
  },
  async stream({ model, effort, system, message, resume, onDelta, signal, ctx }) {
    let Codex;
    try {
      ({ Codex } = ctx.codexSdk ? await ctx.codexSdk() : await import("@openai/codex-sdk"));
    } catch {
      throw new Error("the Codex SDK isn't installed with the runner: reinstall the AI features");
    }
    const dir = join(ctx.stateDir, "codex-empty"); // nothing to read in its sandbox
    mkdirSync(dir, { recursive: true });
    const codex = new Codex({ env: codexEnv(ctx.env), ...(ctx.codexBin ? { codexPathOverride: ctx.codexBin } : {}) });
    const opts = { model, sandboxMode: "read-only", workingDirectory: dir, skipGitRepoCheck: true, networkAccessEnabled: false, webSearchMode: "disabled", approvalPolicy: "never",
      ...(effort ? { modelReasoningEffort: effort } : {}) };
    const thread = resume ? codex.resumeThread(resume, opts) : codex.startThread(opts);
    // Codex has no system prompt of its own to set: the instructions lead the first message.
    const input = resume ? message : `${system}\n\n---\n\n${message}`;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error("wall-clock")), WALL_CLOCK_MS);
    if (signal) signal.addEventListener("abort", () => abort.abort(signal.reason), { once: true });
    let text = "";
    let usage = null;
    let threadId = resume || null;
    try {
      const { events } = await thread.runStreamed(input, { signal: abort.signal });
      for await (const ev of events) {
        if (ev.type === "thread.started") threadId = ev.thread_id;
        else if ((ev.type === "item.updated" || ev.type === "item.completed") && ev.item && ev.item.type === "agent_message") {
          const t = String(ev.item.text || "");
          if (t.startsWith(text)) {
            if (onDelta && t.length > text.length) onDelta(t.slice(text.length));
          } else if (onDelta) onDelta(t); // a new message: rare in one turn
          text = t;
        } else if (ev.type === "turn.completed") usage = ev.usage;
        else if (ev.type === "turn.failed") throw new Error("ChatGPT: " + ((ev.error && ev.error.message) || "the turn failed"));
        else if (ev.type === "error") throw new Error("ChatGPT: " + (ev.message || "error"));
      }
    } catch (e) {
      throw new Error(abort.signal.aborted ? "ChatGPT took longer than 15 minutes" : e.message);
    } finally {
      clearTimeout(timer);
    }
    if (!text.trim()) throw new Error("ChatGPT sent an empty answer");
    const u = usage || {};
    return { text, session: threadId || thread.id, usage: { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cached_input_tokens || 0, cacheWrite: u.cache_write_input_tokens || 0 }, costUsd: null, subscription: true };
  },
};
