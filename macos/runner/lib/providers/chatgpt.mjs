// ChatGPT, with the user's ChatGPT plan: the Codex SDK, which runs the `codex` CLI signed in
// with `codex login`. It answers from the message, like the other providers: Codex is an agent
// with tools, so the paper's text (which could carry instructions) must not reach the user's
// files through them. Codex's "read-only" sandbox still reads every file you can, so instead its
// commands run under a permission profile that can read only the system (programs, libraries)
// and Codex itself: not your home or any other file; no writes, no network. The tools that work
// outside that sandbox (images read from disk, MCP servers, apps, plugins, hooks, a browser, other
// agents) are off. Stateful: a chat is a Codex thread, resumed on each turn.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";

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

// The codex binary that runs: ctx.codexBin (a path, or a name on PATH), else the one the SDK
// bundles (@openai/codex's platform package), as the SDK itself would find it. → its real path.
export function codexBinary(ctx) {
  const want = ctx.codexBin || "";
  if (want) {
    const found = isAbsolute(want) || want.includes("/") ? want
      : String((ctx.env && ctx.env.PATH) || process.env.PATH || "").split(delimiter).map((d) => join(d, want)).find((f) => existsSync(f));
    if (!found || !existsSync(found)) throw new Error(`Codex isn't installed at ${want}`);
    const bin = realpathSync(found);
    // Its sandbox re-runs this very program: a wrapper script (npm's codex.js) would hand the
    // commands a binary the read grants don't cover.
    if (!isNative(bin)) throw new Error(`${want} isn't Codex's own program (a script?): point OMA_CODEX_BIN at the codex binary itself`);
    return bin;
  }
  const triple = { "linux-x64": "x86_64-unknown-linux-musl", "linux-arm64": "aarch64-unknown-linux-musl", "darwin-x64": "x86_64-apple-darwin", "darwin-arm64": "aarch64-apple-darwin" }[`${process.platform}-${process.arch}`];
  if (!triple) throw new Error(`ChatGPT: no Codex for ${process.platform}-${process.arch}`);
  const pkg = { "x86_64-unknown-linux-musl": "codex-linux-x64", "aarch64-unknown-linux-musl": "codex-linux-arm64", "x86_64-apple-darwin": "codex-darwin-x64", "aarch64-apple-darwin": "codex-darwin-arm64" }[triple];
  const codexReq = createRequire(createRequire(import.meta.url).resolve("@openai/codex/package.json"));
  const root = join(dirname(codexReq.resolve(`@openai/${pkg}/package.json`)), "vendor", triple);
  for (const bin of [join(root, "bin", "codex"), join(root, "codex", "codex")]) if (existsSync(bin)) return realpathSync(bin);
  throw new Error("the Codex SDK's codex binary is missing: reinstall the AI features");
}

// An executable file (ELF or Mach-O), not a script.
function isNative(file) {
  try {
    if (!statSync(file).isFile()) return false;
    const fd = openSync(file, "r");
    const b = Buffer.alloc(4);
    readSync(fd, b, 0, 4, 0);
    closeSync(fd);
    const m = b.readUInt32BE(0);
    return m === 0x7f454c46 || m === 0xcffaedfe || m === 0xcefaedfe || m === 0xfeedfacf || m === 0xfeedface || m === 0xcafebabe;
  } catch {
    return false;
  }
}

// What Codex's sandbox may read besides the system: Codex's own files, nothing of yours.
// The SDK's bundled codex: its package folder (vendor/<triple>: bin/, codex-resources/ with its
// bubblewrap, codex-path/), which holds Codex alone. A codex of your own (OMA_CODEX_BIN): the
// binary itself and its code-mode helper next to it, file by file, and the packaged layout's
// codex-resources; never the folders around it (~/bin, ~/.local).
export function codexReadGrants(binary, bundled) {
  if (bundled) return [dirname(dirname(binary))];
  const dir = dirname(binary);
  const grants = [binary];
  const helper = join(dir, "codex-code-mode-host");
  if (existsSync(helper)) grants.push(realpathSync(helper));
  const pkg = dirname(dir);
  if (basename(dir) === "bin" && existsSync(join(pkg, "codex-package.json")) && existsSync(join(pkg, "codex-resources"))) grants.push(join(pkg, "codex-resources"));
  return grants;
}

// The `--config` overrides that keep a turn to the message (see the top): the permission profile
// its commands run under (codexReadGrants: Codex's own files), and the tools that would act outside
// it, off. Raw strings: the profile's keys (":root", paths) aren't TOML bare keys, which the SDK's
// structured config would need.
export const PROFILE = "oma-paper-only";
export const OFF_FEATURES = ["view_image", "apps", "plugins", "remote_plugin", "hooks", "browser_use", "browser_use_external",
  "in_app_browser", "computer_use", "image_generation", "multi_agent", "memories", "tool_suggest", "skill_mcp_dependency_install"];
export function paperOnlyConfig(grants) {
  return [
    `default_permissions=${JSON.stringify(PROFILE)}`,
    `permissions.${PROFILE}.filesystem={":root" = "none", ":minimal" = "read"${grants.map((g) => `, ${JSON.stringify(g)} = "read"`).join("")}}`,
    "mcp_servers={}",
    ...OFF_FEATURES.map((f) => `features.${f}=false`),
  ];
}

// The thread's options. No sandboxMode: Codex's --sandbox flag would override the profile.
export function threadOptions(model, effort, dir) {
  return { model, workingDirectory: dir, skipGitRepoCheck: true, networkAccessEnabled: false, webSearchMode: "disabled", approvalPolicy: "never",
    ...(effort ? { modelReasoningEffort: effort } : {}) };
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
    const dir = join(ctx.stateDir, "codex-empty"); // an empty folder (the profile can't read it anyway)
    mkdirSync(dir, { recursive: true });
    const binary = codexBinary(ctx);
    const codex = new Codex({ env: codexEnv(ctx.env), codexPathOverride: binary, configOverrides: paperOnlyConfig(codexReadGrants(binary, !ctx.codexBin)) });
    const opts = threadOptions(model, effort, dir);
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
