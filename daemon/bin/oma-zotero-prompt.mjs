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
//   oma-zotero-prompt extract --key <item-key> [--library <id>] [--force] [--json]
//                                       the PDF's text as a page-numbered note (pdftotext)
//   oma-zotero-prompt chat --key <item-key> [--library <id>] [--session <id>] [--model M] [--effort E]
//                                       one chat turn: the question on stdin, JSON lines out
//   oma-zotero-prompt chats --key <item-key> [--library <id>]            the paper's chats (JSON)
//   oma-zotero-prompt chat-show --key <item-key> [--library <id>] --session <id>   one chat (JSON)
//   oma-zotero-prompt note --key <item-key> [--library <id>] [--title T] [--tag T]
//                                       Markdown on stdin → a note on the item
//   oma-zotero-prompt chats --all       every paper's chats (JSON)
//   oma-zotero-prompt tasks [--clear]   the task queue: prompt runs and extractions (JSON)
//
// Claude runs through the Claude Agent SDK (your Claude Code login), no tools: the paper
// goes in the message. Its text comes from the paper's extracted-text note when there is
// one (page-numbered), else from the PDF with pdftotext, else from Zotero's full-text
// index. Notes are created through the Zotero bridge's /notes/create and tagged
// "oma-companion" and "oma-prompt" / "oma-chat" / "oma-fulltext".
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, openSync, closeSync, unlinkSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { marked } from "marked";
import { bridgeClient } from "../lib/bridge.mjs";
import { SYSTEM, buildMessage, stripTopHeading, noteTitle, ensureStore, listPrompts, loadPrompt, createPrompt, updatePrompt, excerpt, validId } from "../lib/prompts.mjs";
import { getModels } from "../lib/models.mjs";
import { FULLTEXT_TAG, pdftotext, splitPages, pageLabels, buildNote, groundingText } from "../lib/extract.mjs";
import { startTask, finishTask, failTask, writeIndex, clearTasks } from "../lib/tasks.mjs";
import { CHAT_SYSTEM, chatsDir, newSessionId, validSessionId, titleFor, loadSession, saveSession, listSessions, groundingMessage, replayMessage } from "../lib/chat.mjs";

const APA = "http://www.zotero.org/styles/apa"; // Zotero's "APA Style 7th edition"
const FULLTEXT_CHARS = 300000; // the paper's text sent to Claude
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
    if (["--json", "--dry-run", "--quiet", "--refresh", "--no-edit", "--force", "--all", "--clear"].includes(a)) out.flags[a.slice(2)] = true;
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
    if (n.fulltext) continue; // the paper's text, below
    try {
      const r = await bridge.post("/note", { key: n.key, libraryID: n.libraryID, format: "export" });
      const md = String(r.markdown || "").slice(0, budget);
      budget -= md.length;
      ctx.notes.push({ title: n.title, markdown: md });
    } catch (e) {
      log("note failed", { key: n.key, error: e.message });
    }
  }
  Object.assign(ctx, await paperText(bridge, details));
  ctx.details = details;
  return ctx;
}

// The item's first PDF on disk: { key, libraryID, path } or null.
async function pdfOf(bridge, details) {
  const att = (details.attachments || []).find((a) => a.exists && a.contentType === "application/pdf");
  if (!att) return null;
  const r = await bridge.post("/attachment", { key: att.key, libraryID: att.libraryID, target: "path", markOpened: false, dryRun: true });
  return r.path ? { key: att.key, libraryID: att.libraryID, path: r.path } : null;
}

async function extractPages(bridge, details) {
  const pdf = await pdfOf(bridge, details);
  if (!pdf) return null;
  const pages = splitPages(await pdftotext(pdf.path));
  if (!pages.some((p) => p.trim().length > 40)) throw new Error("the PDF has no text layer (a scan?): nothing to extract");
  const paper = details.paper || {};
  return Object.assign({ pdf, pages }, pageLabels(pages, paper.pages));
}

// The paper's text for Claude: { text, grounding: { source, label, noteKey? }, textError? }.
//   1. the extracted-text note (page-numbered, and what the user saved)
//   2. the PDF, extracted now with pdftotext (page-numbered, not saved)
//   3. Zotero's full-text index (no page numbers)
async function paperText(bridge, details) {
  const cap = (t) => (t.length > FULLTEXT_CHARS ? t.slice(0, FULLTEXT_CHARS) + "\n\n[… the text is cut here]" : t);
  const saved = (details.notes || []).find((n) => n.fulltext);
  if (saved) {
    try {
      const r = await bridge.post("/note", { key: saved.key, libraryID: saved.libraryID, format: "export" });
      if (r.markdown) return { text: cap(r.markdown), grounding: { source: "note", noteKey: saved.key, label: "the extracted-text note, page by page" } };
    } catch (e) {
      log("fulltext note failed", { key: saved.key, error: e.message });
    }
  }
  let why = "";
  try {
    const x = await extractPages(bridge, details);
    if (x) return { text: cap(groundingText(x.pages, x.labels)), grounding: { source: "pdf", label: "the PDF, read with pdftotext just now (not saved as a note)" } };
    why = "no PDF";
  } catch (e) {
    why = e.message;
  }
  try {
    const f = await bridge.post("/fulltext", { key: details.item.key, libraryID: details.item.libraryID, maxChars: FULLTEXT_CHARS, index: "ifMissing" });
    if (f.text) return { text: f.text, grounding: { source: "zotero", label: "Zotero's full-text index (no page numbers)" } };
  } catch (e) {
    why = why || e.message;
  }
  return { text: "", grounding: { source: "none", label: "not available" }, textError: why };
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

// The task this run is (prompt runs and extractions), failed by main()'s catch.
let currentTask = null;

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
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => {
    if (currentTask) try { failTask(currentTask, "stopped"); } catch { /* exiting anyway */ }
    release();
    process.exit(130);
  });
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
  if (!flags["dry-run"]) currentTask = startTask({ kind: "prompt", title: prompt.title, promptId: id, key, libraryID: libraryID || 1, paper: String(flags.paper || "") });
  const bridge = bridgeClient();
  const ctx = await gather(bridge, key, libraryID);
  if (currentTask && !currentTask.paper) currentTask.paper = ctx.citation ? ctx.citation.replace(/^\((.*)\)$/, "$1") : ctx.title;
  const message = buildMessage(prompt, ctx);
  if (flags["dry-run"]) {
    process.stdout.write(`--- system\n${SYSTEM}\n--- message (${message.length} chars)\n${message}\n`);
    return;
  }
  const label = ctx.citation || ctx.title;
  notify(`Running “${prompt.title}”`, `${label}: the note is saved in Zotero when Claude is done (a few minutes)`, "low");
  log("run", { prompt: id, key, model: prompt.model, effort: prompt.effort, chars: message.length, text: ctx.grounding.source });
  const answer = await askClaude(prompt, message);
  const title = noteTitle(prompt, ctx);
  const html = `<h1>${escapeHtml(title)}</h1>\n${marked.parse(stripTopHeading(answer.text), { gfm: true })}` +
    `<p><em>Generated by Claude (${escapeHtml(prompt.model)}) with the “${escapeHtml(prompt.title)}” prompt on ${new Date().toISOString().slice(0, 10)}. Check quotes and pages against the paper.</em></p>`;
  const note = await bridge.post("/notes/create", { parentKey: ctx.key, libraryID: ctx.libraryID, html, tags: ["oma-prompt"] });
  log("saved", { prompt: id, key, note: note.key, durationMs: answer.durationMs, costUsd: answer.costUsd, usage: answer.usage });
  finishTask(currentTask, { noteKey: note.key, noteTitle: title, paper: currentTask.paper });
  notify(`Saved “${prompt.title}”`, `${label}: a new note in Zotero`);
  process.stdout.write(`saved note ${note.key} on ${ctx.key}\n`);
}

// ---------------------------------------------------------------- extract

async function extract(flags) {
  const { key, libraryID } = itemFlags(flags);
  const bridge = bridgeClient();
  const details = await bridge.post("/item", { key, libraryID });
  if (!details.paper) throw new Error("text is extracted from a paper's PDF, not from a " + details.item.itemType);
  const existing = (details.notes || []).find((n) => n.fulltext);
  const say = (o) => process.stdout.write((flags.json ? JSON.stringify(o) : o.message) + "\n");
  if (existing && !flags.force) {
    notify("The text is already extracted", "It's a note on the paper: “" + existing.title + "”", "low");
    return say({ status: "exists", note: existing.key, message: `already extracted: note ${existing.key} (--force to extract again)` });
  }
  notify("Extracting the text…", details.paper.title || details.item.title, "low");
  const cite = [details.paper.authors, details.paper.year ? "(" + details.paper.year + ")" : ""].filter(Boolean).join(" ");
  currentTask = startTask({ kind: "extract", title: "Extract the text", key, libraryID, paper: cite || details.item.title });
  const x = await extractPages(bridge, details);
  if (!x) throw new Error("this item has no PDF on disk to extract");
  const title = details.paper.title || details.item.title;
  const note = buildNote({ title, pages: x.pages, labels: x.labels, source: x.source, file: basename(x.pdf.path), extractor: "pdftotext", date: new Date().toISOString().slice(0, 10) });
  const r = await bridge.post("/notes/create", { parentKey: details.item.key, libraryID: details.item.libraryID, html: note.html, tags: [FULLTEXT_TAG] });
  log("extracted", { key, note: r.key, pages: x.pages.length, labels: x.source, chars: note.chars, cut: note.cut });
  finishTask(currentTask, { noteKey: r.key, noteTitle: "Full text: " + title, detail: `${x.pages.length} pages (p. ${x.labels[0]}–${x.labels[x.labels.length - 1]})` });
  notify("Extracted the text", `${x.pages.length} pages (p. ${x.labels[0]}–${x.labels[x.labels.length - 1]}), saved as a note: chats and prompts now use it`);
  say({ status: "saved", note: r.key, pages: x.pages.length, pageNumbers: x.source, first: x.labels[0], last: x.labels[x.labels.length - 1], cut: note.cut,
    message: `saved note ${r.key}: ${x.pages.length} pages (p. ${x.labels[0]}–${x.labels[x.labels.length - 1]})${note.cut ? ", cut to fit" : ""}` });
}

function itemFlags(flags) {
  const key = String(flags.key || "");
  if (!/^[A-Z0-9]{8}$/.test(key)) throw new Error("--key <item key> is required");
  return { key, libraryID: flags.library != null ? Number(flags.library) : 1 };
}

// ---------------------------------------------------------------- chat

function emit(o) {
  process.stdout.write(JSON.stringify(o) + "\n");
}

// One turn: the question on stdin; JSON lines out: session, delta…, done (or error).
async function chat(flags) {
  const { key, libraryID } = itemFlags(flags);
  const question = readFileSync(0, "utf8").trim();
  if (!question) throw new Error("the question comes on stdin");
  const dir = chatsDir(key, libraryID);
  const now = new Date().toISOString();
  let session = flags.session ? loadSession(dir, String(flags.session)) : null;
  const bridge = bridgeClient();
  const ctx = await gather(bridge, key, libraryID);
  const model = String(flags.model || (session && session.model) || "opus[1m]");
  const effort = flags.effort != null ? (flags.effort === "default" ? "" : String(flags.effort)) : session ? session.effort : "high";
  if (!session) {
    session = { id: newSessionId(), key, libraryID, title: titleFor(question), paper: ctx.citation || ctx.title, created: now, updated: now, model, effort, grounding: ctx.grounding, sdkSession: null, messages: [] };
  }
  session.model = model;
  session.effort = effort;
  emit({ type: "session", id: session.id, title: session.title, grounding: ctx.grounding });
  const first = !session.sdkSession;
  const message = first ? groundingMessage(ctx, question) : question;
  let answer;
  try {
    answer = await chatTurn({ model, effort, message, resume: session.sdkSession });
  } catch (e) {
    if (first) throw e;
    log("chat resume failed, replaying", { session: session.id, error: e.message });
    answer = await chatTurn({ model, effort, message: replayMessage(ctx, session.messages, question), resume: null });
  }
  session.sdkSession = answer.sessionId || session.sdkSession;
  session.messages.push({ role: "user", text: question, at: now }, { role: "assistant", text: answer.text, at: new Date().toISOString(), model });
  session.updated = new Date().toISOString();
  saveSession(dir, session);
  log("chat", { key, session: session.id, model, effort, turns: session.messages.length / 2, costUsd: answer.costUsd });
  emit({ type: "done", id: session.id, text: answer.text });
}

async function chatTurn({ model, effort, message, resume }) {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error("wall-clock")), WALL_CLOCK_MS);
  let result = null;
  let sessionId = null;
  const q = query({
    prompt: message,
    options: {
      model,
      ...(effort ? { effort } : {}),
      systemPrompt: CHAT_SYSTEM,
      tools: [],
      maxTurns: 1,
      settingSources: [],
      persistSession: true, // resumed on the next turn
      ...(resume ? { resume } : {}),
      includePartialMessages: true,
      abortController: abort,
      cwd: STATE_DIR,
    },
  });
  try {
    for await (const m of q) {
      if (m.type === "system" && m.subtype === "init") sessionId = m.session_id || sessionId;
      else if (m.type === "stream_event") {
        const ev = m.event;
        if (ev && ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta" && ev.delta.text) emit({ type: "delta", text: ev.delta.text });
      } else if (m.type === "result") result = m;
    }
  } catch (e) {
    throw new Error(abort.signal.aborted ? "Claude took longer than 15 minutes" : e.message);
  } finally {
    clearTimeout(timer);
    try { q.close?.(); } catch { /* closed */ }
  }
  if (!result || result.subtype !== "success" || result.is_error) throw new Error("Claude: " + (result ? String(result.result || result.subtype) : "no answer"));
  return { text: String(result.result || ""), sessionId: result.session_id || sessionId, costUsd: result.total_cost_usd };
}

// Markdown on stdin → a note on the item (a chat answer saved to Zotero).
async function saveNote(flags) {
  const { key, libraryID } = itemFlags(flags);
  const md = readFileSync(0, "utf8").trim();
  if (!md) throw new Error("the note's Markdown comes on stdin");
  const title = String(flags.title || "").trim();
  const tag = /^[\w-]{1,40}$/.test(String(flags.tag || "")) ? String(flags.tag) : "oma-chat";
  const html = (title ? `<h1>${escapeHtml(title)}</h1>\n` : "") + marked.parse(stripTopHeading(md), { gfm: true });
  const r = await bridge().post("/notes/create", { parentKey: key, libraryID, html, tags: [tag] });
  process.stdout.write(JSON.stringify({ status: "saved", note: r.key }) + "\n");
}

// Every paper's chats, newest first: [{ id, title, updated, turns, key, libraryID, paper }].
function allChats() {
  const root = join(STATE_DIR, "chats");
  if (!existsSync(root)) return [];
  const out = [];
  for (const d of readdirSync(root)) {
    const m = /^(\d+)-([A-Z0-9]{8})$/.exec(d);
    if (!m) continue;
    for (const c of listSessions(join(root, d))) {
      let paper = "";
      try { paper = loadSession(join(root, d), c.id).paper || ""; } catch { /* unreadable */ }
      out.push(Object.assign(c, { key: m[2], libraryID: Number(m[1]), paper }));
    }
  }
  return out.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
}

function bridge() {
  return bridgeClient();
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
    case "extract":
      return extract(flags);
    case "chat":
      quiet = true; // the chat window shows errors itself
      return chat(flags);
    case "chats": {
      if (flags.all) {
        process.stdout.write(JSON.stringify({ chats: allChats() }) + "\n");
        return;
      }
      const { key, libraryID } = itemFlags(flags);
      process.stdout.write(JSON.stringify({ chats: listSessions(chatsDir(key, libraryID)) }) + "\n");
      return;
    }
    case "tasks":
      process.stdout.write(JSON.stringify({ tasks: flags.clear ? clearTasks() : writeIndex() }) + "\n");
      return;
    case "chat-show": {
      const { key, libraryID } = itemFlags(flags);
      if (!validSessionId(flags.session)) throw new Error("--session <id> is required");
      process.stdout.write(JSON.stringify(loadSession(chatsDir(key, libraryID), String(flags.session))) + "\n");
      return;
    }
    case "note":
      quiet = true;
      return saveNote(flags);
    default:
      process.stderr.write("usage: oma-zotero-prompt list | run <id> --key K | new | edit <id> | set <id> | models | path | extract --key K | chat --key K [--session S] | chats --key K | chat-show --key K --session S | note --key K (see the file's header)\n");
      process.exitCode = 2;
  }
}

main().catch((e) => {
  log("error", { argv: process.argv.slice(2), error: e.message });
  if (currentTask) try { failTask(currentTask, e.message); } catch { /* the error is logged */ }
  if (process.argv[2] === "chat") emit({ type: "error", message: e.message });
  notify(process.argv[2] === "extract" ? "Couldn't extract the text" : "Prompt failed", e.message, "critical");
  process.stderr.write(`oma-zotero-prompt: ${e.message}\n`);
  process.exitCode = 1;
});

