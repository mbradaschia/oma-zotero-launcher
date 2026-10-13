// Claude, with the user's Claude subscription: the Claude Agent SDK and the account Claude Code
// is signed in to. No tools: the paper is in the message. Stateful: a chat is an SDK session,
// resumed on each turn.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { getModels } from "../models.mjs";
import { KNOWN_WINDOWS, DEFAULT_WINDOW } from "../context.mjs";

const WALL_CLOCK_MS = 15 * 60 * 1000;

function onPath(bin, env = process.env) {
  const r = spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8", env });
  return r.status === 0 ? r.stdout.trim() : "";
}

export const claude = {
  id: "claude",
  name: "Claude (subscription)",
  kind: "subscription",
  stateful: true,
  needsKey: false,
  signIn: "Install Claude Code and sign in: claude, then /login",
  privacy: "Sends the paper's metadata and text, your highlights and notes, and your questions to Anthropic, under your Claude plan's terms.",
  cost: "Included in your Claude Pro or Max plan (it counts against its usage limits).",
  async detect(ctx) {
    const path = onPath("claude", ctx.env);
    if (!path) return { available: false, signedIn: false, detail: "" };
    // Claude Code keeps its login to itself: listing the models is what proves it works.
    return { available: true, signedIn: null, detail: "Claude Code is installed" };
  },
  async status(config, ctx) {
    if (!onPath("claude", ctx.env)) return { ok: false, detail: "Claude Code isn't installed: " + this.signIn };
    try {
      const models = await this.listModels(config, ctx, { refresh: true });
      return { ok: true, detail: `signed in · ${models.length} models`, models };
    } catch (e) {
      return { ok: false, detail: "Claude Code didn't answer (" + e.message + "): " + this.signIn };
    }
  },
  async listModels(config, ctx, { refresh = false } = {}) {
    const r = await getModels({ refresh });
    return r.models.map((m) => ({ id: m.value, name: m.displayName, description: m.description, context: KNOWN_WINDOWS[m.value] || (ctx.learned && ctx.learned["claude:" + m.value]) || DEFAULT_WINDOW, efforts: m.efforts }));
  },
  // One turn. `message`: the text sent now; `resume`: the SDK session to continue.
  async stream({ model, effort, system, message, resume, persist = false, onDelta, signal, ctx }) {
    const { query } = await (ctx.agentSdk ? ctx.agentSdk() : import("@anthropic-ai/claude-agent-sdk"));
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error("wall-clock")), WALL_CLOCK_MS);
    if (signal) signal.addEventListener("abort", () => abort.abort(signal.reason), { once: true });
    mkdirSync(ctx.stateDir, { recursive: true });
    let result = null;
    let sessionId = null;
    const q = query({
      prompt: message,
      options: {
        model,
        ...(effort ? { effort } : {}), // "" = the model's default (Haiku takes none)
        systemPrompt: system,
        tools: [], // nothing to look up, nothing to run
        maxTurns: 1,
        settingSources: [], // no CLAUDE.md, hooks or MCP servers from the user's setup
        settings: { autoCompactEnabled: false }, // the runner compacts, keeping the paper whole
        persistSession: persist,
        ...(resume ? { resume } : {}),
        includePartialMessages: !!onDelta,
        abortController: abort,
        cwd: ctx.stateDir,
      },
    });
    try {
      for await (const m of q) {
        if (m.type === "system" && m.subtype === "init") sessionId = m.session_id || sessionId;
        else if (m.type === "stream_event") {
          const ev = m.event;
          if (onDelta && ev && ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta" && ev.delta.text) onDelta(ev.delta.text);
        } else if (m.type === "result") result = m;
      }
    } catch (e) {
      throw new Error(abort.signal.aborted ? "Claude took longer than 15 minutes" : e.message);
    } finally {
      clearTimeout(timer);
      try { q.close?.(); } catch { /* closed */ }
    }
    if (!result || result.subtype !== "success" || result.is_error) throw new Error("Claude: " + (result ? String(result.result || result.subtype) : "no answer"));
    const u = result.usage || {};
    let window = 0;
    for (const k of Object.keys(result.modelUsage || {})) window = Math.max(window, Number(result.modelUsage[k].contextWindow) || 0);
    return {
      text: String(result.result || ""),
      session: persist ? result.session_id || sessionId : null,
      usage: { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 },
      costUsd: result.total_cost_usd, // what it would cost on the API; the plan covers it
      subscription: true,
      window,
    };
  },
};
