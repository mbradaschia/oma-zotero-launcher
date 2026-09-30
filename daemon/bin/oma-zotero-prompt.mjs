#!/usr/bin/env node
// oma-zotero-prompt: run a prompt on a Zotero item with an AI model and save the answer
// as a child note; chat with a paper; list, create and edit the prompts. The overlay calls it
// (ZoteroSearch.qml's Prompts rows); it works from a terminal too.
//
//   oma-zotero-prompt list [--json]
//   oma-zotero-prompt run <prompt-id> --key <item-key> [--library <id>] [--dry-run] [--quiet]
//   oma-zotero-prompt new [title…] [--json] [--no-edit]  create a prompt (and open it in the editor)
//   oma-zotero-prompt new-ai --describe "what it should do" [--json] [--dry-run]
//                                       a model writes the prompt (title and text) from a description
//   oma-zotero-prompt edit <prompt-id>  open a prompt's text in the editor
//   oma-zotero-prompt set <prompt-id> [--title T] [--model M] [--effort E|default] [--output O]
//   oma-zotero-prompt models [--json] [--refresh]  every enabled provider's models ("provider:model"), cached a day
//   oma-zotero-prompt providers         the providers: detected, enabled, keys, requirements (JSON)
//   oma-zotero-prompt provider-test <provider>   Test connection: its models, or what is wrong (JSON)
//   oma-zotero-prompt secret set|remove <provider>   an API key in the system keyring (set: on stdin)
//   oma-zotero-prompt path              the prompts directory
//   oma-zotero-prompt system [--chat] [--json]   the system prompt a prompt run (or chat) gets:
//                                       the runner's, the rules on in Settings › Rules, your instructions
//   oma-zotero-prompt system edit | system clear  your own instructions, added after the rules
//   oma-zotero-prompt extract --key <item-key> [--library <id>] [--force] [--json]
//                                       the PDF's text as a page-numbered note (pdftotext)
//   oma-zotero-prompt chat --key <item-key> [--library <id>] [--session <id>] [--model M] [--effort E]
//                          [--source auto|note|pdf]  one chat turn: the question on stdin, JSON lines out
//                                       (--source: ground a new chat in the extracted-text note or the PDF)
//   oma-zotero-prompt chat-rename --key <item-key> [--library <id>] --session <id> --title T
//   oma-zotero-prompt chats --key <item-key> [--library <id>]            the paper's chats (JSON)
//   oma-zotero-prompt chat-show --key <item-key> [--library <id>] --session <id>   one chat (JSON)
//   oma-zotero-prompt chat-delete --key <item-key> [--library <id>] --session <id>  forget a chat
//   oma-zotero-prompt note --key <item-key> [--library <id>] [--title T] [--tag T]
//                                       Markdown on stdin → a note on the item
//   oma-zotero-prompt chats --all       every paper's chats (JSON)
//   oma-zotero-prompt artifacts --key K [--library L] | artifacts --all   the artifacts (JSON: diagrams,
//                                       mind maps, images, pages, documents a prompt or chat made)
//   oma-zotero-prompt artifact-edit --key K [--library L] --id A --instruction "…"   a model changes it
//   oma-zotero-prompt artifact-undo|artifact-delete --key K [--library L] --id A
//   oma-zotero-prompt artifact-rename --key K [--library L] --id A --title T
//   oma-zotero-prompt artifact-libs     fetch the diagram and mind map libraries (once), redraw the views
//   oma-zotero-prompt tasks [--clear]   the task queue: prompt runs and extractions (JSON)
//
// The model comes from a provider (lib/providers/: a Claude or ChatGPT subscription, an API key,
// Ollama, an OpenAI-compatible endpoint), chosen in the launcher's Settings; no tools: the paper
// goes in the message. Its text comes from the paper's extracted-text note when there is
// one (page-numbered), else from the PDF with pdftotext, else from Zotero's full-text
// index. Notes are created through the Zotero bridge's /notes/create and tagged
// "oma-companion" and "oma-prompt" / "oma-chat" / "oma-fulltext".
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, openSync, closeSync, unlinkSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { marked } from "marked";
import { bridgeClient } from "../lib/bridge.mjs";
import { SYSTEM, buildMessage, stripTopHeading, noteTitle, ensureStore, listPrompts, loadPrompt, createPrompt, updatePrompt, excerpt, validId,
  META_SYSTEM, buildMetaMessage, parseMetaAnswer, defaultPrompts } from "../lib/prompts.mjs";
import { FORMATS, ARTIFACT_FORMATS } from "../lib/formats.mjs";
import { artifactsRoot, libDir, listArtifacts, listAllArtifacts, loadArtifact, readSource, saveArtifact, undoArtifact, renameArtifact, deleteArtifact, rerenderAll,
  artifactSystem, editMessage, produce, chatArtifactsSection, findArtifactBlocks, replaceArtifactBlocks, artifactLink } from "../lib/artifacts.mjs";
import { ensureLibs } from "../lib/libs.mjs";
import { validate as validateArtifact, sanitize as sanitizeArtifact, extract as extractArtifact } from "../lib/formats.mjs";
import { loadRules, loadInstructions, instructionsPath, ensureInstructionsFile, clearInstructions, systemFor, standingText } from "../lib/system.mjs";
import { FULLTEXT_TAG, pdftotext, splitPages, pageLabels, buildNote, groundingText } from "../lib/extract.mjs";
import { startTask, finishTask, failTask, writeIndex, clearTasks } from "../lib/tasks.mjs";
import { windowFor, needsCompaction, splitHistory, compactionPrompt, COMPACT_SYSTEM, fitContext, PAPER_SHARE, loadWindows, saveWindow, threadOf, threadMessages } from "../lib/context.mjs";
import { CHAT_SYSTEM, chatsDir, newSessionId, validSessionId, titleFor, loadSession, saveSession, listSessions, deleteSession } from "../lib/chat.mjs";
import { loadSettings } from "../lib/settings.mjs";
import { makeCtx, resolveModel, providerById, findModelInfo, listAll, describeAll, configFor, SUGGESTED } from "../lib/providers/index.mjs";
import { generate, costOf } from "../lib/generate.mjs";
import { keyringStatus, setSecret, removeSecret } from "../lib/secrets.mjs";
import { sameModel } from "../lib/modelspec.mjs";
import { checkQuotes, quoteCheckLine, groundingText as quoteSources } from "../lib/quotes.mjs";

const APA = "http://www.zotero.org/styles/apa"; // Zotero's "APA Style 7th edition"
const FULLTEXT_CHARS = 300000; // the paper's text sent to Claude
const NOTES_CHARS = 30000;
const WALL_CLOCK_MS = 15 * 60 * 1000;
const STATE_DIR = join(process.env.XDG_STATE_HOME || join(process.env.HOME || "", ".local", "state"), "oma-zotero");
const LOG = join(STATE_DIR, "prompts.log");
const WINDOWS = join(STATE_DIR, "context-windows.json"); // context windows the models reported

function providerCtx() {
  return makeCtx({ stateDir: STATE_DIR, learned: loadWindows(WINDOWS) });
}

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
    if (["--json", "--dry-run", "--quiet", "--refresh", "--no-edit", "--force", "--all", "--clear", "--chat"].includes(a)) out.flags[a.slice(2)] = true;
    else if (a.startsWith("--")) out.flags[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

// Everything the prompt gets about the item.
async function gather(bridge, key, libraryID, source = "auto") {
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
  Object.assign(ctx, await paperText(bridge, details, source));
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
//   `source`: "auto" (that order), "note" (the note, else the PDF), "pdf" (skip the note).
async function paperText(bridge, details, source = "auto") {
  const cap = (t) => (t.length > FULLTEXT_CHARS ? t.slice(0, FULLTEXT_CHARS) + "\n\n[… the text is cut here]" : t);
  let saved = source === "pdf" ? null : (details.notes || []).find((n) => n.fulltext);
  // Settings › Defaults › Extract the text first: save the page-numbered note now, then read it.
  if (!saved && source !== "pdf" && details.paper && loadSettings().defaults.autoExtract) {
    try {
      const r = await extractToNote(bridge, details, false);
      if (r) saved = { key: r.note, libraryID: details.item.libraryID };
    } catch (e) {
      log("auto-extract failed", { key: details.item.key, error: e.message });
    }
  }
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
  const settings = loadSettings();
  const pctx = providerCtx();
  const target = resolveModel(prompt.model, settings, "prompts");
  if (target.note) log("model", { prompt: id, note: target.note });
  const info = await findModelInfo(settings, pctx, target.provider, target.model);
  const fit = fitContext(ctx, windowFor(target.spec, loadWindows(WINDOWS), info && info.context), 0.8);
  const message = buildMessage(prompt, fit.ctx);
  const artifact = prompt.output !== "note";
  const system = artifact ? composeSystem(artifactSystem(prompt.output), settings, "artifact") : composeSystem(SYSTEM, settings, "prompt");
  if (flags["dry-run"]) {
    process.stdout.write(`--- model ${target.spec}${target.note ? " (" + target.note + ")" : ""}\n--- system\n${system}\n--- message (${message.length} chars)\n${message}\n`);
    return;
  }
  const label = ctx.citation || ctx.title;
  const pname = providerById(target.provider, settings).name;
  if (artifact) {
    notify(`Running “${prompt.title}”`, `${label}: ${pname} (${target.model}) makes ${FORMATS[prompt.output].noun}`, "low");
    log("run", { prompt: id, key, model: target.spec, output: prompt.output, chars: message.length, text: ctx.grounding.source, cut: fit.cut });
    currentTask.model = target.spec;
    const a = await makeArtifact({ settings, pctx, target, effort: prompt.effort, format: prompt.output, system, message, ctx, fit,
      save: { id, title: prompt.title, by: "prompt:" + id } });
    finishTask(currentTask, { artifactId: a.id, artifactView: a.view, artifactTitle: a.title, detail: `${a.formatLabel}, version ${a.version}${a.warning ? " (" + a.warning + ")" : ""}`, paper: currentTask.paper,
      model: a.answer.spec, usage: a.answer.usage, costUsd: costOf(a.answer), subscription: !!a.answer.subscription, ...(a.quotes ? { quotes: a.quotes } : {}) });
    notify(`Made “${a.title}”`, `${label}: ${a.formatLabel.toLowerCase()}, version ${a.version}${a.warning ? ": " + a.warning : ""} (the paper's Artifacts)`);
    process.stdout.write(`saved ${a.format} ${a.id} (version ${a.version}): ${a.view}\n`);
    return;
  }
  notify(`Running “${prompt.title}”`, `${label}: ${pname} (${target.model}) writes it; the note is saved in Zotero when it's done`, "low");
  log("run", { prompt: id, key, model: target.spec, effort: prompt.effort, chars: message.length, text: ctx.grounding.source, cut: fit.cut });
  currentTask.model = target.spec;
  const answer = await generate({ settings, ctx: pctx, target, effort: prompt.effort, system, messages: [{ role: "user", content: message }], onFallback: (t) => log("fallback", { prompt: id, note: t }) });
  const quotes = checkQuotes(answer.text, fit.ctx.text ? quoteSources(fit.ctx) : "");
  const title = noteTitle(prompt, ctx);
  const byName = providerById(answer.provider, settings).name;
  const html = `<h1>${escapeHtml(title)}</h1>\n${marked.parse(stripTopHeading(answer.text), { gfm: true })}` +
    (quotes.checked ? `<p><em>${escapeHtml(quoteCheckLine(quotes))}</em></p>` : "") +
    `<p><em>Generated by ${escapeHtml(byName)} (${escapeHtml(answer.model)}) with the “${escapeHtml(prompt.title)}” prompt on ${new Date().toISOString().slice(0, 10)}${fit.cut.text ? ", from a text cut to fit the model" : ""}. Check quotes and pages against the paper.</em></p>`;
  const note = await bridge.post("/notes/create", { parentKey: ctx.key, libraryID: ctx.libraryID, html, tags: ["oma-prompt"] });
  const cost = costOf(answer);
  log("saved", { prompt: id, key, note: note.key, model: answer.spec, costUsd: cost, usage: answer.usage, quotes: { checked: quotes.checked, missing: quotes.missing.length } });
  finishTask(currentTask, { noteKey: note.key, noteTitle: title, paper: currentTask.paper, model: answer.spec, usage: answer.usage, costUsd: cost, subscription: !!answer.subscription,
    quotes: { checked: quotes.checked, missing: quotes.missing.length }, ...(answer.fellBack ? { fellBack: answer.fellBack.from } : {}) });
  notify(`Saved “${prompt.title}”`, `${label}: a new note in Zotero` + (quotes.missing.length ? ` (${quotes.missing.length} quote${quotes.missing.length === 1 ? "" : "s"} not found in the text: check the note)` : ""));
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
  const r = await extractToNote(bridge, details, !!existing, existing);
  if (!r) throw new Error("this item has no PDF on disk to extract");
  say({ status: "saved", note: r.note, pages: r.pages, pageNumbers: r.source, first: r.first, last: r.last, cut: r.cut,
    message: `saved note ${r.note}: ${r.pages} pages (p. ${r.first}–${r.last})${r.cut ? ", cut to fit" : ""}` });
}

// The PDF's text as a page-numbered note on the paper (replacing `existing`, which goes to Zotero's
// trash), as a task in Processes. → { note, pages, source, first, last, cut } or null (no PDF).
async function extractToNote(bridge, details, again, existing) {
  const key = details.item.key;
  const libraryID = details.item.libraryID;
  notify(again ? "Extracting the text again…" : "Extracting the text…", details.paper.title || details.item.title, "low");
  const cite = [details.paper.authors, details.paper.year ? "(" + details.paper.year + ")" : ""].filter(Boolean).join(" ");
  const task = startTask({ kind: "extract", title: again ? "Extract the text again" : "Extract the text", key, libraryID, paper: cite || details.item.title });
  try {
    const x = await extractPages(bridge, details);
    if (!x) {
      failTask(task, "no PDF on disk to extract");
      return null;
    }
    const title = details.paper.title || details.item.title;
    const note = buildNote({ title, pages: x.pages, labels: x.labels, source: x.source, file: basename(x.pdf.path), extractor: "pdftotext", date: new Date().toISOString().slice(0, 10) });
    const r = await bridge.post("/notes/create", { parentKey: key, libraryID, html: note.html, tags: [FULLTEXT_TAG] });
    // Extracting again replaces the note: the old one goes to Zotero's trash (undoable there).
    if (existing) {
      try {
        await bridge.post("/notes/trash", { key: existing.key, libraryID: existing.libraryID });
      } catch (e) {
        log("old fulltext note kept", { key: existing.key, error: e.message });
      }
    }
    const first = x.labels[0];
    const last = x.labels[x.labels.length - 1];
    log("extracted", { key, note: r.key, pages: x.pages.length, labels: x.source, chars: note.chars, cut: note.cut });
    finishTask(task, { noteKey: r.key, noteTitle: "Full text: " + title, detail: `${x.pages.length} pages (p. ${first}–${last})` });
    notify("Extracted the text", `${x.pages.length} pages (p. ${first}–${last}), saved as a note: chats and prompts now use it`);
    return { note: r.key, pages: x.pages.length, source: x.source, first, last, cut: note.cut };
  } catch (e) {
    failTask(task, e.message);
    throw e;
  }
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

// One turn: the question on stdin; JSON lines out: session, [status, note,] delta…, context, done
// (or error). The chat stays inside the model's context window: see lib/context.mjs.
const tooLong = (e) => /prompt is too long|too long for the model|context (window|length)|maximum context|too many tokens/i.test(String(e && e.message));

async function chat(flags) {
  const { key, libraryID } = itemFlags(flags);
  const question = readFileSync(0, "utf8").trim();
  if (!question) throw new Error("the question comes on stdin");
  const dir = chatsDir(key, libraryID);
  const now = new Date().toISOString();
  let session = flags.session ? loadSession(dir, String(flags.session)) : null;
  const settings = loadSettings();
  const pctx = providerCtx();
  const target = resolveModel(String(flags.model || (session && session.model) || "default"), settings, "chat");
  const bridge = bridgeClient();
  const source = ["note", "pdf"].includes(flags.source) ? flags.source : session && session.grounding && ["note", "pdf"].includes(session.grounding.source) ? session.grounding.source : "auto";
  const ctx = await gather(bridge, key, libraryID, source);
  const effort = flags.effort != null ? (flags.effort === "default" ? "" : String(flags.effort)) : session ? session.effort : settings.defaults.chat.effort;
  if (!session) {
    session = { id: newSessionId(), key, libraryID, title: titleFor(question), paper: ctx.citation || ctx.title, created: now, updated: now, model: target.spec, effort, grounding: ctx.grounding,
      thread: { provider: target.provider, id: null, start: 0, summarized: false }, messages: [] };
  }
  // The window of the model answering now (a chat can switch models, and providers).
  const info = await findModelInfo(settings, pctx, target.provider, target.model);
  const window = session.model && sameModel(session.model, target.spec) && session.context && session.context.window ? session.context.window : windowFor(target.spec, loadWindows(WINDOWS), info && info.context);
  if (session.context) session.context.window = window;
  session.model = target.spec;
  session.effort = effort;
  // The paper stays whole unless it can't fit this model at all.
  const fit = fitContext(ctx, window, PAPER_SHARE);
  emit({ type: "session", id: session.id, title: session.title, grounding: fit.ctx.grounding, model: target.spec });
  currentTask = startTask({ kind: "chat", title: "Chat: " + titleFor(question, 60), key, libraryID, paper: String(session.paper || "").replace(/^\((.*)\)$/, "$1"), chatSession: session.id, model: target.spec });
  if (target.note) {
    session.messages.push({ role: "note", text: target.note, at: now });
    emit({ type: "note", text: target.note });
  }
  if (session.context) emit({ type: "context", used: session.context.used, window });

  const provider = providerById(target.provider, settings);
  const aroot = artifactsRoot(settings);
  const system = composeSystem(CHAT_SYSTEM, settings, "chat") + "\n\n" + chatArtifactsSection(listArtifacts(aroot, key, libraryID), (a) => readFileSync(a.file, "utf8"));
  const asked = session.messages.some((m) => m.role === "user");
  let compacted = false;
  if (asked && needsCompaction(session.context, question)) {
    await compact(session, settings, pctx, target, effort);
    compacted = true;
  }
  const turn = () => {
    const t = threadOf(session);
    const resume = provider.stateful && t.id && t.provider === target.provider ? t.id : null;
    return generate({ settings, ctx: pctx, target, effort, system, resume, persist: true,
      messages: resume ? [{ role: "user", content: question }] : threadMessages(session, fit.ctx, question),
      onDelta: (d) => emit({ type: "delta", text: d }),
      onStatus: (text) => emit({ type: "status", text }),
      onFallback: (text) => {
        session.messages.push({ role: "note", text, at: new Date().toISOString() });
        emit({ type: "note", text });
      } });
  };
  let answer;
  try {
    answer = await turn();
  } catch (e) {
    const t = threadOf(session);
    const resumed = provider.stateful && t.id && t.provider === target.provider;
    // Too long for the window, or the provider's thread is gone: continue from a summary.
    if (!asked || !(tooLong(e) || resumed)) throw e;
    log(tooLong(e) ? "chat over the context window, compacting" : "chat resume failed, continuing from a summary", { session: session.id, error: e.message });
    await compact(session, settings, pctx, target, effort);
    compacted = true;
    answer = await turn();
  }
  const t = threadOf(session);
  session.thread = { provider: answer.provider, id: answer.stateful ? answer.session || null : null, start: t.start, summarized: t.summarized };
  delete session.sdkSession;
  const made = saveChatArtifacts(answer.text, ctx, session, answer.spec, settings);
  answer.text = made.text;
  for (const a of made.saved) emit({ type: "artifact", id: a.id, title: a.title, format: a.format, formatLabel: a.formatLabel, version: a.version, isNew: a.isNew, view: a.view, warning: a.warning || "" });
  if (made.saved.length) await fetchLibs(aroot, made.saved.map((a) => a.format));
  const quotes = checkQuotes(answer.text, fit.ctx.text ? quoteSources(fit.ctx) : "");
  const cost = costOf(answer);
  session.messages.push({ role: "user", text: question, at: now },
    { role: "assistant", text: answer.text, at: new Date().toISOString(), model: answer.spec, ...(quotes.checked ? { quotes } : {}), ...(cost != null && !answer.subscription ? { costUsd: cost } : {}) });
  const used = answer.usage.input + answer.usage.output;
  if (answer.window) saveWindow(WINDOWS, answer.spec, answer.window);
  session.context = { used: used || (session.context && session.context.used) || 0, window: answer.window || window, updated: new Date().toISOString() };
  if (cost != null && !answer.subscription) session.costUsd = (session.costUsd || 0) + cost;
  session.updated = new Date().toISOString();
  saveSession(dir, session);
  log("chat", { key, session: session.id, model: answer.spec, effort: answer.effort, turns: session.messages.filter((x) => x.role === "user").length, context: session.context, compacted, costUsd: cost, quotes: { checked: quotes.checked, missing: quotes.missing.length } });
  emit({ type: "context", used: session.context.used, window: session.context.window, compacted });
  if (quotes.checked) emit({ type: "quotes", checked: quotes.checked, missing: quotes.missing });
  emit({ type: "done", id: session.id, text: answer.text, model: answer.spec, ...(cost != null && !answer.subscription ? { costUsd: cost, sessionCostUsd: session.costUsd } : {}) });
  const madeText = made.saved.map((a) => `${a.isNew ? "made" : "changed"} “${a.title}”`).join(", ");
  finishTask(currentTask, { detail: madeText ? "answered; " + madeText : "answered", model: answer.spec, usage: answer.usage, costUsd: cost, subscription: !!answer.subscription });
}

// Summarize the exchanges before the last few (adding to an earlier summary), note it in the
// chat, and start a new thread from it: the paper, the summary, the last exchanges verbatim.
async function compact(session, settings, pctx, target, effort) {
  emit({ type: "status", text: "Summarizing earlier questions to fit the context…" });
  const { older } = splitHistory(session.messages);
  const fresh = older.slice(session.summarizedTurns || 0);
  let summary = session.summary || "";
  if (fresh.length) {
    const r = await generate({ settings, ctx: pctx, target, effort: effort ? "low" : "", system: COMPACT_SYSTEM, messages: [{ role: "user", content: compactionPrompt(fresh, summary) }] });
    summary = r.text.trim();
  }
  const questions = older.filter((x) => x.role === "user").length;
  session.summary = summary;
  session.summarizedTurns = older.length;
  session.compactions = (session.compactions || []).concat([{ at: new Date().toISOString(), questions, before: session.context ? session.context.used : null }]);
  const note = { role: "note", text: `The first ${questions} question${questions === 1 ? " was" : "s were"} summarized to fit the model's context; the paper is still read in full.`, at: new Date().toISOString() };
  session.messages.push(note);
  emit({ type: "note", text: note.text });
  session.thread = { provider: target.provider, id: null, start: session.messages.length, summarized: true };
}

// ---------------------------------------------------------------- artifacts

// Generate an artifact (checked, retried once), save it as a new artifact or a new version of
// save.id, and fetch its drawing libraries. → saved summary + { answer, warning, quotes }
async function makeArtifact({ settings, pctx, target, effort, format, system, message, ctx, fit, save }) {
  const gen = (messages) => generate({ settings, ctx: pctx, target, effort, system, messages, onFallback: (t) => log("fallback", { artifact: save.id, note: t }) });
  const r = await produce(format, [{ role: "user", content: message }], gen);
  if (!r.source) throw new Error(`${r.answer.spec} didn't write ${FORMATS[format].noun}: ${r.error}`);
  const root = artifactsRoot(settings);
  const a = saveArtifact(root, { key: ctx.key, libraryID: ctx.libraryID, paper: ctx.citation ? ctx.citation.replace(/^\((.*)\)$/, "$1") : ctx.title, id: save.id, title: save.title,
    format, source: r.source, by: save.by, model: r.answer.spec, instruction: save.instruction || "" });
  await fetchLibs(root, [format]);
  const quotes = ["markdown", "html"].includes(format) && fit && fit.ctx.text ? checkQuotes(r.source, quoteSources(fit.ctx)) : null;
  log("artifact saved", { id: a.id, format, version: a.version, model: r.answer.spec, retried: r.retried, invalid: r.error || undefined, costUsd: costOf(r.answer) });
  return Object.assign(a, { answer: r.answer, warning: r.error ? "it may not display: " + r.error : "", quotes: quotes && quotes.checked ? { checked: quotes.checked, missing: quotes.missing.length } : null });
}

// The drawing libraries the formats need, fetched once (the views load them when opened).
async function fetchLibs(root, formats) {
  const names = [...new Set([].concat(...formats.map((f) => (FORMATS[f] && FORMATS[f].libs) || [])))];
  if (!names.length) return { ok: true, missing: [] };
  const missing = names.filter((n) => !existsSync(join(libDir(root), n)));
  const task = missing.length ? startTask({ kind: "libs", title: "Download the drawing libraries", paper: missing.join(", ") }) : null;
  const r = await ensureLibs(libDir(root), names);
  if (!r.ok) log("libraries missing", { missing: r.missing, error: r.error });
  if (task) {
    if (r.ok) finishTask(task, { detail: `${missing.length} saved in ${libDir(root)}: diagrams and mind maps now draw offline` });
    else failTask(task, `${r.missing.join(", ")}: ${r.error || "not downloaded"} (the views show their text until then; oma-zotero-prompt artifact-libs tries again)`);
  }
  return r;
}

// artifact-edit: a model changes an artifact as asked (a task in Processes).
async function editArtifact(flags) {
  const { key, libraryID } = itemFlags(flags);
  const instruction = String(flags.instruction || "").trim();
  if (!instruction) throw new Error('--instruction "what to change" is required');
  const settings = loadSettings();
  const root = artifactsRoot(settings);
  const { dir, meta } = loadArtifact(root, key, libraryID, String(flags.id || ""));
  if (!lock(key, "artifact-" + meta.id)) {
    notify(`“${meta.title}” is already being changed`, "It will show its new version when it's done");
    return;
  }
  currentTask = startTask({ kind: "artifact", title: `Change “${meta.title}”`, key, libraryID, paper: meta.paper, artifactId: meta.id });
  const bridge = bridgeClient();
  const ctx = await gather(bridge, key, libraryID);
  const pctx = providerCtx();
  const target = resolveModel(String(flags.model || "default"), settings, "prompts");
  const info = await findModelInfo(settings, pctx, target.provider, target.model);
  const fit = fitContext(ctx, windowFor(target.spec, loadWindows(WINDOWS), info && info.context), 0.7);
  const system = composeSystem(artifactSystem(meta.format), settings, "artifact");
  const message = editMessage(meta, readSource(dir, meta), instruction, fit.ctx);
  currentTask.model = target.spec;
  notify(`Changing “${meta.title}”`, instruction.slice(0, 120), "low");
  const a = await makeArtifact({ settings, pctx, target, effort: settings.defaults.prompts.effort, format: meta.format, system, message, ctx, fit,
    save: { id: meta.id, title: meta.title, by: "edit", instruction } });
  finishTask(currentTask, { artifactId: a.id, artifactView: a.view, artifactTitle: a.title, detail: `version ${a.version}${a.warning ? " (" + a.warning + ")" : ""}`, model: a.answer.spec,
    usage: a.answer.usage, costUsd: costOf(a.answer), subscription: !!a.answer.subscription });
  notify(`Changed “${a.title}”`, `Version ${a.version}${a.warning ? ": " + a.warning : ""}`);
  process.stdout.write(JSON.stringify({ id: a.id, version: a.version, view: a.view }) + "\n");
}

// The chat's answer: its artifact blocks saved (a new artifact, or a new version of one), each
// replaced by a link in the text kept. → { text, saved: [summaries] }
function saveChatArtifacts(answerText, ctx, session, model, settings) {
  const { blocks, cut } = findArtifactBlocks(answerText);
  if (!blocks.length && !cut) return { text: answerText, saved: [] };
  const root = artifactsRoot(settings);
  const saved = [];
  const text = replaceArtifactBlocks(answerText, blocks, (b) => {
    const format = ARTIFACT_FORMATS.includes(b.format) ? b.format : "";
    if (!format) return `*(An artifact in an unknown format, "${b.format}", wasn't saved.)*`;
    const source = sanitizeArtifact(format, extractArtifact(format, b.content));
    if (!source) return `*(An empty artifact wasn't saved.)*`;
    const problem = validateArtifact(format, source);
    try {
      const a = saveArtifact(root, { key: ctx.key, libraryID: ctx.libraryID, paper: String(session.paper || "").replace(/^\((.*)\)$/, "$1"), id: b.id, title: b.title, format, source, by: "chat:" + session.id, model });
      saved.push(Object.assign(a, { warning: problem }));
      return artifactLink(a) + (problem ? `\n\n*(It may not display: ${problem}. Ask me to fix it.)*` : "");
    } catch (e) {
      return `*(The artifact “${b.title}” wasn't saved: ${e.message})*`;
    }
  }, cut);
  return { text, saved };
}

// The system prompt: the runner's description of the job (`base`), the rules on in Settings › Rules
// for this context ("prompt" or "chat"), and the user's own instructions.
function composeSystem(base, settings, context) {
  return systemFor(base, { rules: loadRules(), overrides: settings.rules, instructions: loadInstructions(), context });
}

// ---------------------------------------------------------------- write a prompt with AI

// The description → a new prompt file, written by the default prompts model from the meta prompt
// (lib/prompts.mjs), with the bundled prompts as examples. → { id, path, title, excerpt, model }
async function newWithAI(flags) {
  const description = String(flags.describe || "").replace(/\s+/g, " ").trim();
  if (!description) throw new Error('usage: oma-zotero-prompt new-ai --describe "what the prompt should do"');
  const settings = loadSettings();
  const pctx = providerCtx();
  const target = resolveModel("default", settings, "prompts");
  const message = buildMetaMessage(description, { main: standingText({ rules: loadRules(), overrides: settings.rules, instructions: loadInstructions() }), examples: defaultPrompts() });
  if (flags["dry-run"]) {
    process.stdout.write(`--- model ${target.spec}\n--- system\n${META_SYSTEM}\n--- message (${message.length} chars)\n${message}\n`);
    return;
  }
  notify("Writing a prompt…", `${providerById(target.provider, settings).name} (${target.model}) drafts it from your description`, "low");
  currentTask = startTask({ kind: "draft", title: "Write a prompt with AI", paper: description.length > 80 ? description.slice(0, 79) + "…" : description, model: target.spec });
  log("new-ai", { model: target.spec, chars: description.length });
  const answer = await generate({ settings, ctx: pctx, target, effort: settings.defaults.prompts.effort, system: META_SYSTEM, messages: [{ role: "user", content: message }], onFallback: (t) => log("fallback", { newAi: true, note: t }) });
  const draft = parseMetaAnswer(answer.text, description);
  if (draft.body.length < 40) throw new Error(`${answer.spec} didn't write a usable prompt: try again, or describe it differently`);
  const { id, path } = createPrompt(draft.title, ensureStore(), draft.body, draft.output);
  log("new-ai saved", { id, model: answer.spec, costUsd: costOf(answer) });
  finishTask(currentTask, { promptId: id, detail: `“${draft.title}”, makes ${FORMATS[draft.output].label.toLowerCase()}`, model: answer.spec, usage: answer.usage, costUsd: costOf(answer), subscription: !!answer.subscription });
  notify(`Wrote “${draft.title}”`, "A new prompt: review its text before you run it (e on the prompt, then Prompt text)");
  const out = { id, path, title: draft.title, output: draft.output, excerpt: excerpt(draft.body), model: answer.spec };
  process.stdout.write(flags.json ? JSON.stringify(out) + "\n" : `${id}\t${path}\n`);
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
      if (flags.json) process.stdout.write(JSON.stringify({ dir: ensureStore(), prompts: prompts.map((p) => ({ id: p.id, title: p.title, model: p.model, effort: p.effort, output: p.output, excerpt: excerpt(p.body), body: p.body })) }) + "\n");
      else for (const p of prompts) process.stdout.write(`${p.id}\t${p.title}\t${p.model}/${p.effort || "default"}\t${p.output}\n`);
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
    case "new-ai":
      return newWithAI(flags);
    case "system": {
      // The system prompt as sent; your own instructions: edit them (the file gets a template first), or clear them.
      const path = instructionsPath();
      if (rest[0] === "edit") {
        openEditor(ensureInstructionsFile(path));
        process.stdout.write(path + "\n");
        return;
      }
      if (rest[0] === "clear") {
        clearInstructions(path);
        process.stdout.write(JSON.stringify({ path, cleared: true }) + "\n");
        return;
      }
      if (rest[0]) throw new Error("usage: oma-zotero-prompt system [--chat] [--json] | system edit | system clear");
      const chat = !!flags.chat;
      const text = composeSystem(chat ? CHAT_SYSTEM : SYSTEM, loadSettings(), chat ? "chat" : "prompt");
      process.stdout.write(flags.json ? JSON.stringify({ path, instructions: loadInstructions(path), system: text }) + "\n" : text + "\n");
      return;
    }
    case "set": {
      const changes = {};
      for (const k of ["title", "model", "effort", "output"]) if (flags[k] != null) changes[k] = String(flags[k]);
      if (!Object.keys(changes).length) throw new Error("usage: oma-zotero-prompt set <id> [--title T] [--model M] [--effort E|default] [--output O]");
      const p = updatePrompt(rest[0], changes);
      process.stdout.write(JSON.stringify({ id: p.id, title: p.title, model: p.model, effort: p.effort, output: p.output }) + "\n");
      return;
    }
    case "models": {
      // Every enabled provider's models, grouped ("provider:model" values), and the defaults.
      const settings = loadSettings();
      const groups = await listAll(settings, providerCtx(), { refresh: !!flags.refresh });
      const models = [].concat(...groups.map((g) => g.models));
      const def = (purpose) => {
        try { return resolveModel("default", settings, purpose).spec; } catch { return ""; }
      };
      if (flags.json) process.stdout.write(JSON.stringify({ models, groups: groups.map((g) => ({ id: g.id, name: g.name, kind: g.kind, ok: g.ok, detail: g.detail, count: g.models.length })), defaults: { prompts: def("prompts"), chat: def("chat") }, configured: settings.configured }) + "\n");
      else for (const m of models) process.stdout.write(`${m.value}\t${m.displayName}\t${m.context || "?"}\t${m.efforts.join(",") || "no effort levels"}\n`);
      for (const g of groups) if (!g.ok) process.stderr.write(`${g.name}: ${g.detail}\n`);
      return;
    }
    case "providers": {
      // Settings › Models & providers: every provider, what was detected, keys, requirements.
      const settings = loadSettings();
      const keyring = keyringStatus();
      const providers = await describeAll(settings, providerCtx(), { keyringOk: keyring.ok });
      const pdf = spawnSync("sh", ["-c", "command -v pdftotext"], { encoding: "utf8" });
      process.stdout.write(JSON.stringify({ configured: settings.configured, keyring, providers, suggested: SUGGESTED, requirements: { node: process.versions.node, pdftotext: pdf.status === 0 } }) + "\n");
      return;
    }
    case "provider-test": {
      // Test connection: lists the models, or says exactly what is wrong.
      const settings = loadSettings();
      const p = providerById(String(rest[0] || ""), settings);
      if (!p) throw new Error("usage: oma-zotero-prompt provider-test <provider>");
      let r;
      try {
        r = await p.status(configFor(p.id, settings), providerCtx());
      } catch (e) {
        r = { ok: false, detail: e.message };
      }
      const models = (r.models || []).map((m) => ({ value: p.id + ":" + m.id, displayName: m.name, context: m.context, efforts: m.efforts, priceIn: m.priceIn, priceOut: m.priceOut, free: m.free }));
      process.stdout.write(JSON.stringify({ id: p.id, ok: !!r.ok, detail: r.detail || "", models }) + "\n");
      return;
    }
    case "secret": {
      // secret set <provider> (the key on stdin) | secret remove <provider>: the system keyring.
      const [action, provider] = rest;
      if (!/^[a-z][a-z0-9-]{1,30}$/.test(String(provider || "")) || !["set", "remove"].includes(action)) throw new Error("usage: oma-zotero-prompt secret set|remove <provider> (set: the key on stdin)");
      if (action === "set") setSecret(provider, readFileSync(0, "utf8"));
      else removeSecret(provider);
      process.stdout.write(JSON.stringify({ ok: true, provider, action }) + "\n");
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
    case "artifacts": {
      const root = artifactsRoot(loadSettings());
      if (flags.all) {
        process.stdout.write(JSON.stringify({ root, artifacts: listAllArtifacts(root) }) + "\n");
        return;
      }
      const { key, libraryID } = itemFlags(flags);
      process.stdout.write(JSON.stringify({ root, artifacts: listArtifacts(root, key, libraryID) }) + "\n");
      return;
    }
    case "artifact-edit":
      return editArtifact(flags);
    case "artifact-undo":
    case "artifact-rename":
    case "artifact-delete": {
      quiet = true;
      const { key, libraryID } = itemFlags(flags);
      const root = artifactsRoot(loadSettings());
      const id = String(flags.id || "");
      if (cmd === "artifact-delete") {
        deleteArtifact(root, key, libraryID, id);
        process.stdout.write(JSON.stringify({ id, deleted: true }) + "\n");
      } else {
        const a = cmd === "artifact-undo" ? undoArtifact(root, key, libraryID, id) : renameArtifact(root, key, libraryID, id, flags.title);
        process.stdout.write(JSON.stringify(a) + "\n");
      }
      return;
    }
    case "artifact-libs": {
      const root = artifactsRoot(loadSettings());
      const r = await fetchLibs(root, ARTIFACT_FORMATS);
      rerenderAll(root);
      process.stdout.write(JSON.stringify(Object.assign({ dir: libDir(root) }, r)) + "\n");
      if (!r.ok) process.exitCode = 1;
      return;
    }
    case "tasks":
      process.stdout.write(JSON.stringify({ tasks: flags.clear ? clearTasks() : writeIndex() }) + "\n");
      return;
    case "chat-rename": {
      const { key, libraryID } = itemFlags(flags);
      if (!validSessionId(flags.session)) throw new Error("--session <id> is required");
      const title = String(flags.title || "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (!title) throw new Error("--title can't be empty");
      const dir = chatsDir(key, libraryID);
      const session = loadSession(dir, String(flags.session));
      session.title = title;
      saveSession(dir, session);
      process.stdout.write(JSON.stringify({ id: session.id, title }) + "\n");
      return;
    }
    case "chat-delete": {
      const { key, libraryID } = itemFlags(flags);
      if (!validSessionId(flags.session)) throw new Error("--session <id> is required");
      deleteSession(chatsDir(key, libraryID), String(flags.session));
      process.stdout.write(JSON.stringify({ id: String(flags.session), deleted: true }) + "\n");
      return;
    }
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
      process.stderr.write("usage: oma-zotero-prompt list | run <id> --key K | new | new-ai --describe D | edit <id> | set <id> | models | providers | provider-test <p> | secret set|remove <p> | path | system [edit|clear] | extract --key K | chat --key K [--session S] | chats --key K | chat-show --key K --session S | note --key K (see the file's header)\n");
      process.exitCode = 2;
  }
}

main().catch((e) => {
  log("error", { argv: process.argv.slice(2), error: e.message });
  if (currentTask) try { failTask(currentTask, e.message); } catch { /* the error is logged */ }
  if (process.argv[2] === "chat") emit({ type: "error", message: e.message });
  const what = { extract: "Couldn't extract the text", "new-ai": "Couldn't write the prompt", "artifact-edit": "Couldn't change the artifact" }[process.argv[2]] || "Prompt failed";
  notify(what, e.message, "critical");
  process.stderr.write(`oma-zotero-prompt: ${e.message}\n`);
  process.exitCode = 1;
});

