#!/usr/bin/env node
// oma-zotero-prompt: run a prompt on a Zotero item with Claude and save the answer
// as a child note; list, create and edit the prompts. The overlay calls it
// (ZoteroSearch.qml's Prompts rows); it works from a terminal too.
//
//   oma-zotero-prompt list [--json]
//   oma-zotero-prompt run <prompt-id> --key <item-key> [--library <id>] [--dry-run] [--quiet]
//   oma-zotero-prompt new [title…] [--json] [--no-edit]  create a prompt (and open it in the editor)
//   oma-zotero-prompt edit <prompt-id>  open a prompt's text in the editor
//   oma-zotero-prompt set <prompt-id> [--title T] [--model M] [--effort E|default]
//   oma-zotero-prompt models [--json] [--refresh]  the models and effort levels (Agent SDK, cached a day)
//   oma-zotero-prompt path              the prompts directory
//
// Claude runs through the Claude Agent SDK (your Claude Code login), one turn, no
// tools: the paper goes in the message. Notes are created through the Zotero
// bridge's /notes/create and tagged "oma-companion" and "oma-prompt".
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, openSync, closeSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";
import { bridgeClient } from "../lib/bridge.mjs";
import { SYSTEM, buildMessage, stripTopHeading, noteTitle, ensureStore, listPrompts, loadPrompt, createPrompt, updatePrompt, excerpt, validId } from "../lib/prompts.mjs";
import { getModels } from "../lib/models.mjs";

const APA = "http://www.zotero.org/styles/apa"; // Zotero's "APA Style 7th edition"
const FULLTEXT_CHARS = 200000;
const NOTES_CHARS = 30000;
const WALL_CLOCK_MS = 15 * 60 * 1000;
const STATE_DIR = join(process.env.XDG_STATE_HOME || join(process.env.HOME || "", ".local", "state"), "oma-zotero");
const LOG = join(STATE_DIR, "prompts.log");

function log(msg, extra) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(LOG, `${new Date().toISOString()} ${msg}${extra ? " " + JSON.stringify(extra) : ""}\n`);
  } catch { /* logging is best effort */ }
}

let quiet = false;
function notify(summary, body, urgency = "normal") {
  if (quiet) return;
  try { spawn("notify-send", ["-a", "Zotero", "-u", urgency, summary, body || ""], { stdio: "ignore", detached: true }).unref(); } catch { /* no notifier */ }
}

function openEditor(path) {
  // omarchy-launch-editor opens the user's editor (a terminal one in a new window).
  const child = spawn("omarchy-launch-editor", [path], { stdio: "ignore", detached: true });
  child.on("error", () => spawn("xdg-open", [path], { stdio: "ignore", detached: true }).unref());
  child.unref();
}

function args(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["--json", "--dry-run", "--quiet", "--refresh", "--no-edit"].includes(a)) out.flags[a.slice(2)] = true;
    else if (a.startsWith("--")) out.flags[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

// Everything the prompt gets about the item.
async function gather(bridge, key, libraryID) {
  const details = await bridge.post("/item", { key, libraryID });
  const item = details.item || {};
  if (item.itemType === "note" || item.itemType === "attachment") {
    throw new Error("prompts run on a paper (a regular item), not on a " + item.itemType);
  }
  const ctx = { key: item.key, libraryID: item.libraryID, title: item.title || "(untitled)", itemType: item.itemType, annotations: [], notes: [] };
  const cite = async (mode) => {
    try {
      const r = await bridge.post("/cite", { keys: [item.key], libraryID: item.libraryID, style: APA, mode, format: "text" });
      return r.entries && r.entries[0] ? r.entries[0] : null;
    } catch (e) {
      log("cite failed", { key, mode, error: e.message });
      return null;
    }
  };
  const ref = await cite("bibliography");
  const inText = await cite("citation");
  ctx.reference = ref ? ref.text : "";
  ctx.citekey = ref ? ref.citekey || "" : "";
  ctx.citation = inText ? inText.text : "";
  try {
    const r = await bridge.post("/annotations", { key: item.key, libraryID: item.libraryID });
    for (const att of r.attachments || []) for (const a of att.annotations || []) ctx.annotations.push(a);
  } catch (e) {
    log("annotations failed", { key, error: e.message });
  }
  let budget = NOTES_CHARS;
  for (const n of details.notes || []) {
    if (budget <= 0) break;
    try {
      const r = await bridge.post("/note", { key: n.key, libraryID: n.libraryID, format: "export" });
      const md = String(r.markdown || "").slice(0, budget);
      budget -= md.length;
      ctx.notes.push({ title: n.title, markdown: md });
    } catch (e) {
      log("note failed", { key: n.key, error: e.message });
    }
  }
  try {
    ctx.fulltext = await bridge.post("/fulltext", { key: item.key, libraryID: item.libraryID, maxChars: FULLTEXT_CHARS, index: "ifMissing" });
  } catch (e) {
    ctx.fulltextError = e.message;
  }
  return ctx;
}

async function askClaude(prompt, message) {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error("wall-clock")), WALL_CLOCK_MS);
  let result = null;
  const q = query({
    prompt: message,
    options: {
      model: prompt.model,
      ...(prompt.effort ? { effort: prompt.effort } : {}), // "" = the model's default (Haiku takes none)
      systemPrompt: SYSTEM,
      tools: [], // the paper is in the message: nothing to look up, nothing to run
      maxTurns: 1,
      settingSources: [], // no CLAUDE.md, hooks or MCP servers from the user's setup
      persistSession: false,
      abortController: abort,
      cwd: STATE_DIR,
    },
  });
  try {
    for await (const m of q) {
      if (m.type === "result") result = m;
    }
  } catch (e) {
    throw new Error(abort.signal.aborted ? "Claude took longer than 15 minutes" : e.message);
  } finally {
    clearTimeout(timer);
    try { q.close?.(); } catch { /* closed */ }
  }
  if (!result || result.subtype !== "success" || result.is_error) {
    throw new Error("Claude: " + (result ? String(result.result || result.subtype) : "no answer"));
  }
  return { text: String(result.result || ""), usage: result.usage, costUsd: result.total_cost_usd, durationMs: result.duration_ms };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// One run at a time per item and prompt (a second Enter while it runs does nothing).
function lock(key, id) {
  const dir = join(process.env.XDG_RUNTIME_DIR || "/tmp", "oma-zotero", "prompt-runs");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${key}-${id}.lock`);
  try {
    closeSync(openSync(path, "wx"));
  } catch {
    return null;
  }
  const release = () => { try { if (existsSync(path)) unlinkSync(path); } catch { /* gone */ } };
  process.on("exit", release);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { release(); process.exit(130); });
  return release;
}

async function run(id, flags) {
  const key = String(flags.key || "");
  if (!/^[A-Z0-9]{8}$/.test(key)) throw new Error("--key <item key> is required");
  const libraryID = flags.library != null ? Number(flags.library) : undefined;
  const prompt = loadPrompt(id);
  if (!flags["dry-run"] && !lock(key, id)) {
    notify(`“${prompt.title}” is already running`, "on this item: its note will appear when it's done");
    return;
  }
  const bridge = bridgeClient();
  const ctx = await gather(bridge, key, libraryID);
  const message = buildMessage(prompt, ctx);
  if (flags["dry-run"]) {
    process.stdout.write(`--- system\n${SYSTEM}\n--- message (${message.length} chars)\n${message}\n`);
    return;
  }
  const label = ctx.citation || ctx.title;
  notify(`Running “${prompt.title}”`, `${label}: the note is saved in Zotero when Claude is done (a few minutes)`, "low");
  log("run", { prompt: id, key, model: prompt.model, effort: prompt.effort, chars: message.length, fulltext: ctx.fulltext ? ctx.fulltext.chars : 0 });
  const answer = await askClaude(prompt, message);
  const title = noteTitle(prompt, ctx);
  const html = `<h1>${escapeHtml(title)}</h1>\n${marked.parse(stripTopHeading(answer.text), { gfm: true })}` +
    `<p><em>Generated by Claude (${escapeHtml(prompt.model)}) with the “${escapeHtml(prompt.title)}” prompt on ${new Date().toISOString().slice(0, 10)}. Check quotes and pages against the paper.</em></p>`;
  const note = await bridge.post("/notes/create", { parentKey: ctx.key, libraryID: ctx.libraryID, html, tags: ["oma-prompt"] });
  log("saved", { prompt: id, key, note: note.key, durationMs: answer.durationMs, costUsd: answer.costUsd, usage: answer.usage });
  notify(`Saved “${prompt.title}”`, `${label}: a new note in Zotero`);
  process.stdout.write(`saved note ${note.key} on ${ctx.key}\n`);
}

async function main() {
  const { _: [cmd, ...rest], flags } = args(process.argv.slice(2));
  quiet = !!flags.quiet;
  switch (cmd) {
    case "list": {
      const prompts = listPrompts();
      if (flags.json) process.stdout.write(JSON.stringify({ dir: ensureStore(), prompts: prompts.map((p) => ({ id: p.id, title: p.title, model: p.model, effort: p.effort, excerpt: excerpt(p.body) })) }) + "\n");
      else for (const p of prompts) process.stdout.write(`${p.id}\t${p.title}\t${p.model}/${p.effort || "default"}\n`);
      return;
    }
    case "run":
      if (!validId(rest[0])) throw new Error("usage: oma-zotero-prompt run <prompt-id> --key <item key>");
      return run(rest[0], flags);
    case "new": {
      const { id, path } = createPrompt(rest.join(" "));
      if (!flags["no-edit"]) openEditor(path);
      process.stdout.write(flags.json ? JSON.stringify({ id, path }) + "\n" : `${id}\t${path}\n`);
      return;
    }
    case "set": {
      const changes = {};
      for (const k of ["title", "model", "effort"]) if (flags[k] != null) changes[k] = String(flags[k]);
      if (!Object.keys(changes).length) throw new Error("usage: oma-zotero-prompt set <id> [--title T] [--model M] [--effort E|default]");
      const p = updatePrompt(rest[0], changes);
      process.stdout.write(JSON.stringify({ id: p.id, title: p.title, model: p.model, effort: p.effort }) + "\n");
      return;
    }
    case "models": {
      const r = await getModels({ refresh: !!flags.refresh });
      if (flags.json) process.stdout.write(JSON.stringify(r) + "\n");
      else for (const m of r.models) process.stdout.write(`${m.value}\t${m.displayName}\t${m.efforts.join(",") || "no effort levels"}\n`);
      return;
    }
    case "edit": {
      const p = loadPrompt(rest[0]);
      const path = join(ensureStore(), p.id + ".md");
      openEditor(path);
      process.stdout.write(path + "\n");
      return;
    }
    case "path":
      process.stdout.write(ensureStore() + "\n");
      return;
    default:
      process.stderr.write("usage: oma-zotero-prompt list [--json] | run <id> --key <key> [--library <id>] [--dry-run] | new [title] | edit <id> | set <id> [--title T] [--model M] [--effort E] | models [--json] [--refresh] | path\n");
      process.exitCode = 2;
  }
}

main().catch((e) => {
  log("error", { argv: process.argv.slice(2), error: e.message });
  notify("Prompt failed", e.message, "critical");
  process.stderr.write(`oma-zotero-prompt: ${e.message}\n`);
  process.exitCode = 1;
});

