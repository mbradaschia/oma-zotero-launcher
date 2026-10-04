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
//   oma-zotero-prompt set <prompt-id> [--title T] [--model M] [--effort E|default] [--output O] [--brief on|off]
//   oma-zotero-prompt models [--json] [--refresh]  every enabled provider's models ("provider:model"), cached a day
//   oma-zotero-prompt providers         the providers: detected, enabled, keys, requirements (JSON)
//   oma-zotero-prompt provider-test <provider>   Test connection: its models, or what is wrong (JSON)
//   oma-zotero-prompt secret set|remove <provider>   an API key in the system keyring (set: on stdin)
//   oma-zotero-prompt path              the prompts directory
//   oma-zotero-prompt system [--chat] [--json]   the system prompt a prompt run (or chat) gets:
//                                       the runner's, the rules on in Settings › Rules, your instructions
//   oma-zotero-prompt system edit | system clear  your own instructions, added after the rules
//   oma-zotero-prompt extract --key <item-key> [--library <id>] [--force] [--json]
//   oma-zotero-prompt taxonomies [--json]   the taxonomies in force, the Jev key, how many suggestions wait
//   oma-zotero-prompt taxonomy-edit <id> | taxonomy-new --name N [--no-edit --json]   a taxonomy file, in your editor
//   oma-zotero-prompt taxonomy-show <id> | taxonomy-save <id> (JSON on stdin) | taxonomy-remove <id> [--reset]
//                                       one taxonomy in full / saved as yours / yours deleted, a bundled one off
//                                       (--reset: back as bundled); taxonomy-save --new: a new one (its id from its prefix)
//   oma-zotero-prompt taxonomy-draft    stdin { id, request, turns }: a taxonomy proposed by your prompts model, nothing saved
//   oma-zotero-prompt classify --items <lib:key,…> [--taxonomies id,…]   tag papers by the taxonomies (Jev,
//                                       else your prompts model); each paper a task in Processes
//   oma-zotero-prompt classify-status --items <lib:key,…> [--json]   the taxonomies each paper is out of
//                                       date with (never classified by them, or by another version)
//   oma-zotero-prompt catchup-plan [--stale-taxonomies] [--stale-prompts] [--since <date> [--tag] [--extract]
//                                       [--prompts id,…]]   what bringing papers up to date would run (JSON): papers
//                                       a taxonomy or a prompt saw in an older version, what papers added since miss
//   oma-zotero-prompt classify-show --item <lib:key>   a paper's result, every label's probability (JSON)
//   oma-zotero-prompt classify-review [--json] | classify-decide --item <lib:key> --taxonomy <id> --label L --accept|--dismiss|--auto
//   oma-zotero-prompt extract-batch --items <lib:key,…> [--max-mb N]   automatic extraction: each paper
//                                       with a PDF and no extracted text, one after the other (each a task
//                                       in Processes), large PDFs and scans skipped; JSON: { results }
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
import { appendFileSync, mkdirSync, openSync, closeSync, unlinkSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync, renameSync } from "node:fs";
import { join, basename } from "node:path";
import { marked } from "marked";
import { safeMarkdown } from "../lib/safe-markdown.mjs"; // a model's Markdown: nothing in it loads by itself
import { bridgeClient } from "../lib/bridge.mjs";
import { SYSTEM, buildMessage, stripTopHeading, noteTitle, ensureStore, listPrompts, loadPrompt, createPrompt, updatePrompt, excerpt, validId,
  META_SYSTEM, buildMetaMessage, parseMetaAnswer, defaultPrompts } from "../lib/prompts.mjs";
import { FORMATS, ARTIFACT_FORMATS } from "../lib/formats.mjs";
import { artifactsRoot, libDir, listArtifacts, listAllArtifacts, loadArtifact, readSource, saveArtifact, undoArtifact, renameArtifact, deleteArtifact, rerenderAll,
  artifactSystem, editMessage, produce, briefSystem, briefMessage, drawMessage, readBrief, chatArtifactsSection, findArtifactBlocks, replaceArtifactBlocks, artifactLink } from "../lib/artifacts.mjs";
import { ensureLibs } from "../lib/libs.mjs";
import { validate as validateArtifact, sanitize as sanitizeArtifact, extract as extractArtifact } from "../lib/formats.mjs";
import { findBrowser, measureLayout } from "../lib/layout.mjs";
import { loadRules, loadInstructions, instructionsPath, ensureInstructionsFile, clearInstructions, systemFor, standingText } from "../lib/system.mjs";
import { FULLTEXT_TAG, pdftotext, splitPages, pageLabels, buildNote, groundingText, skipReason, isScan } from "../lib/extract.mjs";
import { startTask, updateTask, finishTask, failTask, writeIndex, clearTasks } from "../lib/tasks.mjs";
import { windowFor, needsCompaction, splitHistory, compactionPrompt, COMPACT_SYSTEM, fitContext, PAPER_SHARE, loadWindows, saveWindow, threadOf, threadMessages } from "../lib/context.mjs";
import { CHAT_SYSTEM, chatsDir, newSessionId, validSessionId, titleFor, loadSession, saveSession, listSessions, deleteSession } from "../lib/chat.mjs";
import { loadSettings } from "../lib/settings.mjs";
import { makeCtx, resolveModel, providerById, findModelInfo, listAll, describeAll, configFor, SUGGESTED } from "../lib/providers/index.mjs";
import { generate, costOf } from "../lib/generate.mjs";
import { keyringStatus, setSecret, removeSecret, resolveKey, maskKey } from "../lib/secrets.mjs";
import { loadTests, saveTest, testFor } from "../lib/keytests.mjs";
import { loadTaxonomies, DEFAULTS_DIR, userDir as taxonomyDir, classificationText, jevQuestions, fromJev, jevCost, LLM_SYSTEM, llmPrompt, parseLlm, decide, tagChanges, loadStore, saveStore, reviewList, fingerprint, staleTaxonomies, toFile as taxonomyFile, checkEdit as checkTaxonomy, template as taxonomyTemplate, DRAFT_SYSTEM, draftMessages, parseDraft, auditView } from "../lib/taxonomies.mjs";
import { jevClassify } from "../lib/providers/jev.mjs";
import { versionsFor, promptRuns, stalePromptJobs, staleTaxonomyJobs, recentJobs, paperCount } from "../lib/catchup.mjs";
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
    if (["--json", "--dry-run", "--quiet", "--refresh", "--no-edit", "--force", "--all", "--clear", "--chat", "--accept", "--dismiss", "--auto", "--reset", "--new", "--stale-taxonomies", "--stale-prompts", "--tag", "--extract", "--extract-first"].includes(a)) out.flags[a.slice(2)] = true;
    else if (a.startsWith("--")) out.flags[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

// Everything the prompt gets about the item.
// extractFirst: the text saved as its note first when it has none (automatic runs: --extract-first).
async function gather(bridge, key, libraryID, source = "auto", extractFirst = false) {
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
  Object.assign(ctx, await paperText(bridge, details, source, extractFirst));
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
async function paperText(bridge, details, source = "auto", extractFirst = false) {
  const cap = (t) => (t.length > FULLTEXT_CHARS ? t.slice(0, FULLTEXT_CHARS) + "\n\n[… the text is cut here]" : t);
  let saved = source === "pdf" ? null : (details.notes || []).find((n) => n.fulltext);
  // Settings › Defaults › Extract the text first (or a run on new papers, a catch-up): save the page-numbered note
  // now, then read it.
  if (!saved && source !== "pdf" && details.paper && (extractFirst || loadSettings().defaults.autoExtract)) {
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
  const version = flags["dry-run"] ? { n: 0, hash: "" } : versionsFor([prompt]).get(id);
  if (!flags["dry-run"] && !lock(key, id)) {
    notify(`“${prompt.title}” is already running`, "on this item: its note will appear when it's done");
    return;
  }
  if (!flags["dry-run"]) currentTask = startTask({ kind: "prompt", title: prompt.title, promptId: id, key, libraryID: libraryID || 1, paper: String(flags.paper || "") });
  const bridge = bridgeClient();
  const ctx = await gather(bridge, key, libraryID, "auto", !!flags["extract-first"]);
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
    updateTask(currentTask, { model: target.spec, paper: currentTask.paper });
    const a = await makeArtifact({ settings, pctx, target, effort: prompt.effort, format: prompt.output, system, message, ctx, fit,
      plan: prompt.brief ? { task: prompt.body } : null, save: { id, title: prompt.title, by: "prompt:" + id, prompt: id + "@" + version.hash } });
    finishTask(currentTask, { artifactId: a.id, artifactView: a.view, artifactTitle: a.title, stage: "", detail: `${a.formatLabel}, version ${a.version}${a.brief ? ", planned in a brief first" : ""}${a.warning ? " (" + a.warning + ")" : ""}`, paper: currentTask.paper,
      model: a.answer.spec, usage: a.answer.usage, costUsd: costOf(a.answer), subscription: !!a.answer.subscription, ...(a.quotes ? { quotes: a.quotes } : {}) });
    notify(`Made “${a.title}”`, `${label}: ${a.formatLabel.toLowerCase()}, version ${a.version}${a.warning ? ": " + a.warning : ""} (the paper's Artifacts)`);
    process.stdout.write(`saved ${a.format} ${a.id} (version ${a.version}): ${a.view}\n`);
    return;
  }
  notify(`Running “${prompt.title}”`, `${label}: ${pname} (${target.model}) writes it; the note is saved in Zotero when it's done`, "low");
  log("run", { prompt: id, key, model: target.spec, effort: prompt.effort, chars: message.length, text: ctx.grounding.source, cut: fit.cut });
  updateTask(currentTask, { model: target.spec, paper: currentTask.paper });
  const answer = await generate({ settings, ctx: pctx, target, effort: prompt.effort, system, messages: [{ role: "user", content: message }], onFallback: (t) => log("fallback", { prompt: id, note: t }) });
  const quotes = checkQuotes(answer.text, fit.ctx.text ? quoteSources(fit.ctx) : "");
  const title = noteTitle(prompt, ctx, version.n);
  const byName = providerById(answer.provider, settings).name;
  const html = `<h1>${escapeHtml(title)}</h1>\n${marked.parse(safeMarkdown(stripTopHeading(answer.text)), { gfm: true })}` +
    (quotes.checked ? `<p><em>${escapeHtml(quoteCheckLine(quotes))}</em></p>` : "") +
    `<p><em>Generated by ${escapeHtml(byName)} (${escapeHtml(answer.model)}) with the “${escapeHtml(prompt.title)}” prompt, version ${version.n} (${id}@${version.hash}), on ${new Date().toISOString().slice(0, 10)}${fit.cut.text ? ", from a text cut to fit the model" : ""}. Check quotes and pages against the paper.</em></p>`;
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

// ---------------------------------------------------------------- taxonomies

function taxonomyReport() {
  const all = loadTaxonomies();
  const { taxonomies, problems } = all;
  const key = resolveKey("jev");
  const store = loadStore();
  return {
    taxonomies: taxonomies.map((t) => ({ id: t.id, name: t.name, prefix: t.prefix, kind: t.kind, labels: t.labels.map((l) => l.name), threshold: t.threshold, own: t.own, bundled: t.bundled, path: t.path, hash: fingerprint(t), show: t.show !== false })),
    problems,
    jev: { key: key ? { set: true, from: key.from, masked: maskKey(key.value) } : { set: false, from: "", masked: "" }, test: key ? testFor(loadTests(), "jev", maskKey(key.value)) : null },
    off: all.off || [],
    review: reviewList(store, taxonomies).length,
    classified: Object.keys(store.papers || {}).length,
    dir: taxonomyDir(),
  };
}

// A taxonomy file in your editor: yours (a bundled one is copied first, so yours replaces it).
function taxonomyEdit(id, flags) {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(String(id || ""))) throw new Error("usage: oma-zotero-prompt taxonomy-edit <id>");
  const dir = taxonomyDir();
  mkdirSync(dir, { recursive: true });
  const mine = join(dir, id + ".json");
  if (!existsSync(mine)) {
    const t = loadTaxonomies().taxonomies.find((x) => x.id === id);
    if (!t) throw new Error(`no taxonomy “${id}”`);
    writeFileSync(mine, readFileSync(t.path, "utf8"));
  }
  if (!flags["no-edit"]) openEditor(mine);
  process.stdout.write((flags.json ? JSON.stringify({ id, path: mine }) : mine) + "\n");
}

const TAXONOMY_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

// One taxonomy in full (its labels' definitions too), for the launcher's page of it.
function taxonomyShow(id) {
  if (!TAXONOMY_ID.test(String(id || ""))) throw new Error("usage: oma-zotero-prompt taxonomy-show <id> --json");
  const t = loadTaxonomies().taxonomies.find((x) => x.id === id);
  if (!t) throw new Error(`no taxonomy “${id}”`);
  return Object.assign(taxonomyFile(t), { id: t.id, low: t.low, bundled: t.bundled, own: t.own, path: t.path, hash: fingerprint(t) });
}

// The launcher's edit of a taxonomy (its JSON on stdin), checked, saved as yours (a bundled one: your copy).
// --new: a new one, its id made from its prefix (theory/ → theory, theory-2…).
function taxonomySave(id, flags) {
  let raw;
  try { raw = JSON.parse(readFileSync(0, "utf8")); } catch (e) { throw new Error("not JSON: " + e.message); }
  if (flags && flags.new) {
    const base = String((raw && raw.prefix) || "taxonomy").replace(/\/$/, "").replace(/[^a-z0-9-]/g, "") || "taxonomy";
    const taken = (x) => existsSync(join(taxonomyDir(), x + ".json")) || existsSync(join(DEFAULTS_DIR, x + ".json"));
    id = base;
    for (let n = 2; taken(id); n++) id = base + "-" + n;
  }
  if (!TAXONOMY_ID.test(String(id || ""))) throw new Error("usage: oma-zotero-prompt taxonomy-save <id> | --new (the taxonomy's JSON on stdin)");
  const v = checkTaxonomy(raw, id, loadTaxonomies().taxonomies);
  if (v.error) throw new Error(v.error);
  const dir = taxonomyDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, id + ".json");
  writeFileSync(path + ".tmp", JSON.stringify(taxonomyFile(v.taxonomy), null, 2) + "\n");
  renameSync(path + ".tmp", path);
  return taxonomyShow(id);
}

// Yours deleted; a bundled one turned off ({ "off": true } in your folder), or with --reset back as bundled
// (your copy, or its being off, removed).
function taxonomyRemove(id, flags) {
  if (!TAXONOMY_ID.test(String(id || ""))) throw new Error("usage: oma-zotero-prompt taxonomy-remove <id> [--reset]");
  const bundled = existsSync(join(DEFAULTS_DIR, id + ".json"));
  const mine = join(taxonomyDir(), id + ".json");
  if (flags.reset) {
    if (!bundled) throw new Error(`“${id}” isn't a bundled taxonomy`);
    if (existsSync(mine)) unlinkSync(mine);
    return { id, removed: false, reset: true };
  }
  if (bundled) {
    mkdirSync(taxonomyDir(), { recursive: true });
    writeFileSync(mine, JSON.stringify({ off: true }, null, 2) + "\n");
    return { id, removed: false, off: true };
  }
  if (!existsSync(mine)) throw new Error(`no taxonomy “${id}” of yours`);
  unlinkSync(mine);
  return { id, removed: true };
}

// A taxonomy proposed by your prompts model (stdin: { id (the one being changed, or ""), request, turns }): the
// proposal, checked, and what the model says about it; nothing saved. → { taxonomy, notes, by } or { error, notes }
async function taxonomyDraft() {
  let input;
  try { input = JSON.parse(readFileSync(0, "utf8")); } catch (e) { throw new Error("not JSON: " + e.message); }
  const request = String(input.request || "").trim();
  if (!request) throw new Error("say what you want");
  const all = loadTaxonomies().taxonomies;
  const current = input.id ? all.find((t) => t.id === input.id) : null;
  if (input.id && !current) throw new Error(`no taxonomy “${input.id}”`);
  const others = all.filter((t) => !current || t.id !== current.id).map((t) => ({ id: t.id, name: t.name, prefix: t.prefix }));
  const turns = (Array.isArray(input.turns) ? input.turns : []).slice(-8);
  const settings = loadSettings();
  const target = resolveModel("default", settings, "prompts");
  const answer = await generate({ settings, ctx: providerCtx(), target, effort: "medium", system: DRAFT_SYSTEM, messages: draftMessages(current, others, turns, request),
    onFallback: (t) => log("fallback", { taxonomyDraft: true, note: t }) });
  const r = parseDraft(answer.text, current ? current.id : "draft", others);
  log("taxonomy-draft", { id: input.id || "", ok: !r.error, by: answer.spec });
  return Object.assign(r, { by: answer.spec });
}

function taxonomyNew(flags) {
  const t = taxonomyTemplate(String(flags.name || "Topics"));
  const dir = taxonomyDir();
  mkdirSync(dir, { recursive: true });
  let id = t.prefix.slice(0, -1);
  for (let n = 2; existsSync(join(dir, id + ".json")) || loadTaxonomies().taxonomies.some((x) => x.id === id); n++) id = t.prefix.slice(0, -1) + "-" + n;
  const path = join(dir, id + ".json");
  writeFileSync(path, JSON.stringify(t, null, 2) + "\n");
  if (!flags["no-edit"]) openEditor(path);
  process.stdout.write((flags.json ? JSON.stringify({ id, path }) : path) + "\n");
}

// The paper's probabilities for every taxonomy: Jev when its key is set, else your prompts model.
// → { probs, by, costUsd }
async function classifyText(taxonomies, text, settings) {
  const key = resolveKey("jev");
  if (key) {
    const r = await jevClassify({ apiKey: key.value, state: text, questions: jevQuestions(taxonomies), baseURL: process.env.OMA_JEV_URL || undefined });
    return { probs: fromJev(taxonomies, r.answers), by: "jev:" + r.model, costUsd: jevCost(r.usage) };
  }
  const target = resolveModel("default", settings, "prompts");
  const answer = await generate({ settings, ctx: providerCtx(), target, effort: "low", system: LLM_SYSTEM, messages: [{ role: "user", content: llmPrompt(taxonomies, text) }],
    onFallback: (t) => log("fallback", { classify: true, note: t }) });
  return { probs: parseLlm(answer.text, taxonomies), by: answer.spec, costUsd: costOf(answer) };
}

// The Jev key, tested: one tiny question (costs a fraction of a cent). → { ok, detail }
async function testJev() {
  const key = resolveKey("jev");
  if (!key) return { ok: false, detail: "No key: Settings › Taxonomies › Set the Jev API key" };
  try {
    const r = await jevClassify({ apiKey: key.value, state: "A key check.", questions: { check: { type: "choice", instructions: "Is this a key check?", criteria: { yes: "It is", no: "It isn't" } } },
      baseURL: process.env.OMA_JEV_URL || undefined, timeoutMs: 20000 });
    return { ok: true, detail: "The key works · " + r.model };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

// Tag papers by the taxonomies: each one read (its title, abstract and extracted text, when it has one),
// classified, its tags put on and taken off in Zotero, the result kept (with each label's probability) for
// the review list and a later pass. Each paper a task in Processes.
async function classify(flags) {
  const bridge = bridgeClient();
  const settings = loadSettings();
  const all = loadTaxonomies();
  const only = flags.taxonomies ? String(flags.taxonomies).split(",") : null;
  const taxonomies = all.taxonomies.filter((t) => !only || only.includes(t.id));
  if (!taxonomies.length) throw new Error("no taxonomies" + (all.problems.length ? ": " + all.problems[0] : ""));
  const items = String(flags.items || "").split(",").map((x) => x.trim()).filter((x) => /^\d+:[A-Z0-9]{8}$/.test(x)).slice(0, 200);
  if (!items.length) throw new Error("--items <libraryID:key,…> is required");
  const results = [];
  for (const id of items) {
    const [lib, key] = id.split(":");
    let task = null;
    try {
      const details = await bridge.post("/item", { key, libraryID: Number(lib) });
      if (!details.paper) { results.push({ id, status: "skipped", reason: "not a paper" }); continue; }
      const p = details.paper;
      const cite = [p.authors, p.year ? "(" + p.year + ")" : ""].filter(Boolean).join(" ") || p.title;
      task = startTask({ kind: "classify", title: "Tag by taxonomies", key, libraryID: Number(lib), paper: cite });
      let text = "";
      const saved = (details.notes || []).find((n) => n.fulltext);
      if (saved) {
        try { text = (await bridge.post("/note", { key: saved.key, libraryID: saved.libraryID, format: "export" })).markdown || ""; } catch (e) { log("classify: text failed", { key, error: e.message }); }
      }
      const r = await classifyText(taxonomies, classificationText({ title: p.title, abstract: p.abstract, text }), settings);
      const store = loadStore();
      const before = (store.papers[id] && store.papers[id].taxonomies) || {};
      const existing = (details.tags || []).map((t) => t.tag);
      const next = {};
      const add = [], remove = [];
      for (const t of taxonomies) {
        const prev = before[t.id] || {};
        const d = decide(t, r.probs[t.id] || {}, prev.dismissed);
        const probs = {};
        for (const l of t.labels) probs[l.name] = Math.round(((r.probs[t.id] || {})[l.name] || 0) * 1000) / 1000;
        next[t.id] = { tagged: d.tagged, suggested: d.suggested, confirmed: prev.confirmed || [], dismissed: prev.dismissed || [], hash: fingerprint(t), probs };
        const c = tagChanges(t, next[t.id], prev, existing);
        // a one-label taxonomy with a label you put on: yours stays; the classifier's goes to Review instead
        if (c.kept) {
          const keptLabel = c.kept.slice(t.prefix.length).toLowerCase();
          next[t.id].suggested = d.tagged.filter((x) => x.label.toLowerCase() !== keptLabel && x.label.toLowerCase() !== "not stated").concat(d.suggested).slice(0, 1);
          next[t.id].tagged = [];
        }
        add.push(...c.add);
        remove.push(...c.remove);
      }
      if (add.length || remove.length) await bridge.post("/tags/update", { key, libraryID: Number(lib), add, remove });
      store.papers[id] = { at: new Date().toISOString(), by: r.by, paper: cite, taxonomies: Object.assign({}, before, next) };
      saveStore(store);
      const tagged = Object.values(next).reduce((n, x) => n + x.tagged.length, 0);
      const suggested = Object.values(next).reduce((n, x) => n + x.suggested.length, 0);
      finishTask(task, { model: r.by, costUsd: r.costUsd, detail: tagged + (tagged === 1 ? " tag" : " tags") + (suggested ? ", " + suggested + " to review" : "") });
      results.push({ id, status: "tagged", add, remove, suggested, by: r.by });
    } catch (e) {
      if (task) failTask(task, e.message);
      results.push({ id, status: "failed", reason: e.message });
    }
  }
  log("classify", { items: items.length, tagged: results.filter((x) => x.status === "tagged").length });
  if (items.length > 1) notify("Tagged by taxonomies", results.filter((x) => x.status === "tagged").length + " of " + items.length + " papers" + (results.some((x) => x.suggested) ? "; suggestions wait in Settings › Taxonomies" : ""), "low");
  process.stdout.write(JSON.stringify({ results }) + "\n");
}

// Which taxonomies each paper is out of date with (never classified by them, or by another version of
// them: Settings › Taxonomies › Tag it when you open it classifies it again for those). Reads the store
// only: no bridge, no model. → { items: [{ id, classified, at, stale: [taxonomy ids] }] }
function classifyStatus(flags) {
  const items = String(flags.items || "").split(",").map((x) => x.trim()).filter((x) => /^\d+:[A-Z0-9]{8}$/.test(x)).slice(0, 200);
  if (!items.length) throw new Error("--items <libraryID:key,…> is required");
  const { taxonomies } = loadTaxonomies();
  const store = loadStore();
  return { items: items.map((id) => {
    const e = store.papers[id];
    return { id, classified: !!e, at: (e && e.at) || "", stale: staleTaxonomies(e, taxonomies) };
  }) };
}

// What bringing papers up to date would run, part by part (each asked for): the papers a taxonomy tagged with an
// older version of it; the runs of a prompt with an older version of it (runs from before versions were kept are
// counted, left alone); what papers added since --since miss (their text with --extract, their taxonomies with --tag,
// the --prompts). → { taxonomies?, prompts?, recent?: { jobs: [{ id, op, prompt?, only?, title? }], papers } }
async function catchupPlan(flags) {
  const out = {};
  const bridge = bridgeClient();
  const { taxonomies } = loadTaxonomies();
  const store = loadStore();
  const wanted = flags.prompts ? String(flags.prompts).split(",").filter(validId) : [];
  const needRuns = flags["stale-prompts"] || (flags.since && wanted.length);
  const prompts = needRuns ? listPrompts() : [];
  const versions = versionsFor(prompts);
  let runs = {};
  if (needRuns) {
    const notes = (await bridge.post("/notes/by-prompt", {})).notes || [];
    runs = promptRuns(notes, listAllArtifacts(artifactsRoot(loadSettings())), prompts);
  }
  if (flags["stale-taxonomies"]) {
    const jobs = staleTaxonomyJobs(store, taxonomies);
    out.taxonomies = { jobs, papers: paperCount(jobs) };
  }
  if (flags["stale-prompts"]) {
    const s = stalePromptJobs(runs, versions);
    out.prompts = { jobs: s.jobs, papers: paperCount(s.jobs), unknown: s.unknown };
  }
  if (flags.since) {
    const since = String(flags.since);
    const papers = (await bridge.post("/papers/select", { since, limit: 2000 })).items || [];
    const textless = flags.extract ? ((await bridge.post("/extract/pending", { since, limit: 2000 })).items || []).map((i) => (Number(i.libraryID) || 1) + ":" + i.key) : [];
    const jobs = recentJobs(papers, { textless, extract: !!flags.extract, tag: !!flags.tag, store, taxonomies, prompts: wanted, runs, versions });
    out.recent = { jobs, papers: paperCount(jobs), added: papers.length };
  }
  return out;
}

// A suggestion accepted (tagged, and kept on later passes) or dismissed (never suggested again).
async function classifyDecide(flags) {
  const id = String(flags.item || "");
  if (!/^\d+:[A-Z0-9]{8}$/.test(id) || !flags.taxonomy || !flags.label || (!flags.accept && !flags.dismiss && !flags.auto)) throw new Error("usage: classify-decide --item <lib:key> --taxonomy <id> --label L --accept|--dismiss|--auto");
  const t = loadTaxonomies().taxonomies.find((x) => x.id === flags.taxonomy);
  if (!t) throw new Error(`no taxonomy “${flags.taxonomy}”`);
  const label = (t.labels.find((l) => l.name.toLowerCase() === String(flags.label).toLowerCase()) || {}).name;
  if (!label) throw new Error(`“${flags.label}” isn't a label of ${t.name}`);
  const store = loadStore();
  const paper = store.papers[id] || { at: new Date().toISOString(), by: "you", paper: id, taxonomies: {} };
  const prev = paper.taxonomies[t.id] || { tagged: [], suggested: [], confirmed: [], dismissed: [] };
  const x = { tagged: prev.tagged || [], suggested: (prev.suggested || []).filter((s) => s.label !== label), confirmed: (prev.confirmed || []).filter((l) => l !== label), dismissed: (prev.dismissed || []).filter((l) => l !== label) };
  if (prev.hash) x.hash = prev.hash; // a decision doesn't make the result current, nor out of date
  if (prev.probs) x.probs = prev.probs;
  if (flags.auto) {
    // your decision dropped: the classifier's last result decides again (its probabilities, when kept)
    if (prev.probs) {
      const d = decide(t, prev.probs, x.dismissed);
      x.tagged = d.tagged;
      x.suggested = d.suggested;
    }
    const want = x.tagged.some((g) => g.label.toLowerCase() === label.toLowerCase()) || x.confirmed.some((l) => l.toLowerCase() === label.toLowerCase());
    const [lib, key] = id.split(":");
    const details = await bridge().post("/item", { key, libraryID: Number(lib) });
    const have = (details.tags || []).map((g) => g.tag);
    const mine = (t.prefix + label).toLowerCase();
    const add = [], remove = [];
    if (want && !have.some((g) => g.toLowerCase() === mine)) {
      add.push(t.prefix + label);
      // a unique taxonomy keeps one: the others the classifier (not you) put on come off
      if (t.kind === "one") remove.push(...have.filter((g) => g.toLowerCase().startsWith(t.prefix.toLowerCase()) && g.toLowerCase() !== mine && !x.confirmed.some((l) => (t.prefix + l).toLowerCase() === g.toLowerCase())));
    }
    if (!want) remove.push(...have.filter((g) => g.toLowerCase() === mine));
    if (add.length || remove.length) await bridge().post("/tags/update", { key, libraryID: Number(lib), add, remove });
  } else if (flags.accept) {
    x.confirmed = t.kind === "one" ? [label] : x.confirmed.concat([label]);
    const [lib, key] = id.split(":");
    const details = await bridge().post("/item", { key, libraryID: Number(lib) });
    const c = tagChanges(t, x, prev, (details.tags || []).map((g) => g.tag));
    if (t.kind === "one") x.tagged = [];
    if (c.add.length || c.remove.length) await bridge().post("/tags/update", { key, libraryID: Number(lib), add: c.add, remove: c.remove });
  } else {
    // not this label: off the paper too (whoever put it on), and never tagged or suggested again
    x.dismissed = x.dismissed.concat([label]);
    x.tagged = x.tagged.filter((g) => g.label.toLowerCase() !== label.toLowerCase());
    const [lib, key] = id.split(":");
    const details = await bridge().post("/item", { key, libraryID: Number(lib) });
    const off = (details.tags || []).map((g) => g.tag).filter((g) => g.toLowerCase() === (t.prefix + label).toLowerCase());
    if (off.length) await bridge().post("/tags/update", { key, libraryID: Number(lib), add: [], remove: off });
  }
  paper.taxonomies[t.id] = x;
  store.papers[id] = paper;
  saveStore(store);
  process.stdout.write(JSON.stringify({ ok: true, id, taxonomy: t.id, label, accepted: !!flags.accept, auto: !!flags.auto }) + "\n");
}

// Automatic extraction: the papers given (from the launcher: new ones, or a catch-up), one after the
// other, each a task in Processes, without a notification each. A paper already extracted, without a PDF
// on disk, with a PDF over --max-mb, or a scan (no text layer) is skipped, with why.
async function extractBatch(flags) {
  const bridge = bridgeClient();
  const maxBytes = Math.max(0, Number(flags["max-mb"]) || 0) * 1048576;
  const items = String(flags.items || "").split(",").map((s) => s.trim()).filter((s) => /^\d+:[A-Z0-9]{8}$/.test(s)).slice(0, 50);
  if (!items.length) throw new Error("--items <libraryID:key,…> is required");
  const results = [];
  for (const id of items) {
    const [lib, key] = id.split(":");
    try {
      const details = await bridge.post("/item", { key, libraryID: Number(lib) });
      const pdf = details.paper ? await pdfOf(bridge, details) : null;
      let bytes = 0;
      try { bytes = pdf ? statSync(pdf.path).size : 0; } catch (e) { bytes = 0; }
      const why = skipReason({ paper: !!details.paper, extracted: (details.notes || []).some((n) => n.fulltext), pdf: !!pdf, bytes, maxBytes });
      if (why) { results.push({ id, status: "skipped", reason: why }); continue; }
      const r = await extractToNote(bridge, details, false, null, { quiet: true });
      results.push(r ? { id, status: "saved", note: r.note, pages: r.pages } : { id, status: "skipped", reason: "no PDF on disk" });
    } catch (e) {
      results.push(isScan(e.message) ? { id, status: "skipped", reason: "a scan, with no text layer: OCR it first" } : { id, status: "failed", reason: e.message });
    }
  }
  log("extract-batch", { items: items.length, saved: results.filter((r) => r.status === "saved").length });
  process.stdout.write(JSON.stringify({ results }) + "\n");
}

// The PDF's text as a page-numbered note on the paper (replacing `existing`, which goes to Zotero's
// trash), as a task in Processes. → { note, pages, source, first, last, cut } or null (no PDF).
// opts.quiet: no notifications (automatic extraction says it once for the batch).
async function extractToNote(bridge, details, again, existing, opts) {
  const quiet = !!(opts && opts.quiet);
  const key = details.item.key;
  const libraryID = details.item.libraryID;
  if (!quiet) notify(again ? "Extracting the text again…" : "Extracting the text…", details.paper.title || details.item.title, "low");
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
    if (!quiet) notify("Extracted the text", `${x.pages.length} pages (p. ${first}–${last}), saved as a note: chats and prompts now use it`);
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
  const made = await saveChatArtifacts(answer.text, ctx, session, answer.spec, settings);
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

// An image's layout, measured in this machine's Chromium-based browser (null without one: then
// it's estimated). The browser is looked up once.
let layoutBrowser;
function measureImage(svg, opts) {
  if (layoutBrowser === undefined) layoutBrowser = findBrowser();
  return measureLayout(svg, { ...opts, browser: layoutBrowser,
    onFail: (f) => log("layout not measured (estimated instead)", { browser: layoutBrowser, reason: f.reason, code: f.code, stderr: f.stderr.slice(-300) }) });
}

// Generate an artifact (checked, retried once), save it as a new artifact or a new version of
// save.id, and fetch its drawing libraries. → saved summary + { answer, warning, quotes }
// `plan`: { task } to plan it first: a brief (concepts, relationships, numbers, takeaways, a visual
// concept) from the paper, then the artifact drawn from the brief.
async function makeArtifact({ settings, pctx, target, effort, format, system, message, ctx, fit, save, plan = null }) {
  let brief = "";
  if (plan) {
    if (currentTask) updateTask(currentTask, { stage: "1 of 2: the brief" });
    const b = await generate({ settings, ctx: pctx, target, effort, system: composeSystem(briefSystem(format), settings, "artifact"),
      messages: [{ role: "user", content: briefMessage(plan.task, format, fit ? fit.ctx : ctx) }], onFallback: (t) => log("fallback", { artifact: save.id, note: t }) });
    brief = String(b.text || "").trim();
    if (brief.length < 200) { log("brief too short: drawing in one go", { id: save.id, chars: brief.length }); brief = ""; }
    else message = drawMessage(plan.task, brief, ctx);
    if (currentTask) updateTask(currentTask, { stage: brief ? "2 of 2: drawing it" : "" });
  }
  const gen = (messages) => generate({ settings, ctx: pctx, target, effort, system, messages, onFallback: (t) => log("fallback", { artifact: save.id, note: t }) });
  const r = await produce(format, [{ role: "user", content: message }], gen, { measure: measureImage });
  if (!r.source) throw new Error(`${r.answer.spec} didn't write ${FORMATS[format].noun}: ${r.error}`);
  const root = artifactsRoot(settings);
  const a = saveArtifact(root, { key: ctx.key, libraryID: ctx.libraryID, paper: ctx.citation ? ctx.citation.replace(/^\((.*)\)$/, "$1") : ctx.title, id: save.id, title: save.title,
    format, source: r.source, brief, by: save.by, model: r.answer.spec, instruction: save.instruction || "", prompt: save.prompt || "" });
  await fetchLibs(root, [format]);
  const quotes = ["markdown", "html"].includes(format) && fit && fit.ctx.text ? checkQuotes(r.source, quoteSources(fit.ctx)) : null;
  log("artifact saved", { id: a.id, format, version: a.version, model: r.answer.spec, planned: !!brief, retried: r.retried, layout: r.layout || undefined, invalid: r.error || undefined, costUsd: costOf(r.answer) });
  const left = r.layout && r.layout.left;
  return Object.assign(a, { answer: r.answer, warning: r.error ? "it may not display: " + r.error : left ? `${left} layout fault${left === 1 ? "" : "s"} left (Change it with AI to fix)` : "", quotes: quotes && quotes.checked ? { checked: quotes.checked, missing: quotes.missing.length } : null });
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
  const message = editMessage(meta, readSource(dir, meta), instruction, fit.ctx, readBrief(dir, meta));
  updateTask(currentTask, { model: target.spec });
  notify(`Changing “${meta.title}”`, instruction.slice(0, 120), "low");
  const a = await makeArtifact({ settings, pctx, target, effort: settings.defaults.prompts.effort, format: meta.format, system, message, ctx, fit,
    save: { id: meta.id, title: meta.title, by: "edit", instruction } });
  finishTask(currentTask, { artifactId: a.id, artifactView: a.view, artifactTitle: a.title, detail: `version ${a.version}${a.warning ? " (" + a.warning + ")" : ""}`, model: a.answer.spec,
    usage: a.answer.usage, costUsd: costOf(a.answer), subscription: !!a.answer.subscription });
  notify(`Changed “${a.title}”`, `Version ${a.version}${a.warning ? ": " + a.warning : ""}`);
  process.stdout.write(JSON.stringify({ id: a.id, version: a.version, view: a.view }) + "\n");
}

// The chat's answer: its artifact blocks saved (a new artifact, or a new version of one), each
// replaced by a link in the text kept. An image's layout is measured and repaired (there's no
// retry in a chat: its faults are listed for the user to ask about). → { text, saved: [summaries] }
async function saveChatArtifacts(answerText, ctx, session, model, settings) {
  const { blocks, cut } = findArtifactBlocks(answerText);
  if (!blocks.length && !cut) return { text: answerText, saved: [] };
  const root = artifactsRoot(settings);
  const saved = [];
  const images = new Map(); // block → { source, problem }
  for (const b of blocks.filter((x) => x.format === "image")) {
    const source = sanitizeArtifact("image", extractArtifact("image", b.content));
    if (!source || validateArtifact("image", source, { layout: false })) continue;
    const fixed = await measureImage(source, { repair: true });
    if (fixed) images.set(b, { source: fixed.svg ? sanitizeArtifact("image", fixed.svg) : source, problem: fixed.problems.length ? `${fixed.problems.length} label${fixed.problems.length === 1 ? "" : "s"} still overlap${fixed.problems.length === 1 ? "s" : ""} something` : "" });
  }
  const text = replaceArtifactBlocks(answerText, blocks, (b) => {
    const format = ARTIFACT_FORMATS.includes(b.format) ? b.format : "";
    if (!format) return `*(An artifact in an unknown format, "${b.format}", wasn't saved.)*`;
    const measured = images.get(b);
    const source = measured ? measured.source : sanitizeArtifact(format, extractArtifact(format, b.content));
    if (!source) return `*(An empty artifact wasn't saved.)*`;
    const problem = measured ? measured.problem : validateArtifact(format, source);
    try {
      const a = saveArtifact(root, { key: ctx.key, libraryID: ctx.libraryID, paper: String(session.paper || "").replace(/^\((.*)\)$/, "$1"), id: b.id, title: b.title, format, source, by: "chat:" + session.id, model });
      saved.push(Object.assign(a, { warning: problem }));
      return artifactLink(a) + (problem ? `\n\n*(${measured ? "Its layout isn't clean" : "It may not display"}: ${problem}. Ask me to fix it.)*` : "");
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
  const html = (title ? `<h1>${escapeHtml(title)}</h1>\n` : "") + marked.parse(safeMarkdown(stripTopHeading(md)), { gfm: true });
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
      const versions = versionsFor(prompts);
      if (flags.json) process.stdout.write(JSON.stringify({ dir: ensureStore(), prompts: prompts.map((p) => ({ id: p.id, title: p.title, version: versions.get(p.id).n, hash: versions.get(p.id).hash, model: p.model, effort: p.effort, output: p.output, brief: p.brief, excerpt: excerpt(p.body), body: p.body })) }) + "\n");
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
      for (const k of ["title", "model", "effort", "output", "brief"]) if (flags[k] != null) changes[k] = String(flags[k]);
      if (!Object.keys(changes).length) throw new Error("usage: oma-zotero-prompt set <id> [--title T] [--model M] [--effort E|default] [--output O] [--brief on|off]");
      const p = updatePrompt(rest[0], changes);
      process.stdout.write(JSON.stringify({ id: p.id, title: p.title, model: p.model, effort: p.effort, output: p.output, brief: p.brief }) + "\n");
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
      const tests = loadTests();
      const providers = (await describeAll(settings, providerCtx(), { keyringOk: keyring.ok })).map((p) => Object.assign({}, p, { test: testFor(tests, p.id, p.key && p.key.set ? p.key.masked : "") }));
      const pdf = spawnSync("sh", ["-c", "command -v pdftotext"], { encoding: "utf8" });
      process.stdout.write(JSON.stringify({ configured: settings.configured, keyring, providers, suggested: SUGGESTED, requirements: { node: process.versions.node, pdftotext: pdf.status === 0 } }) + "\n");
      return;
    }
    case "provider-test": {
      // Test connection: lists the models, or says exactly what is wrong (jev: the Jev key, with one tiny
      // question). The result is kept (key-tests.json) with the masked key it was tested with.
      const settings = loadSettings();
      if (String(rest[0] || "") === "jev") {
        const r = await testJev();
        const key = resolveKey("jev");
        const at = saveTest("jev", r, key ? maskKey(key.value) : "");
        process.stdout.write(JSON.stringify({ id: "jev", ok: r.ok, detail: r.detail, models: [], at: at.at }) + "\n");
        return;
      }
      const p = providerById(String(rest[0] || ""), settings);
      if (!p) throw new Error("usage: oma-zotero-prompt provider-test <provider>");
      let r;
      try {
        r = await p.status(configFor(p.id, settings), providerCtx());
      } catch (e) {
        r = { ok: false, detail: e.message };
      }
      const models = (r.models || []).map((m) => ({ value: p.id + ":" + m.id, displayName: m.name, context: m.context, efforts: m.efforts, priceIn: m.priceIn, priceOut: m.priceOut, free: m.free }));
      const key = resolveKey(p.id);
      const at = saveTest(p.id, { ok: !!r.ok, detail: r.detail || "" }, key ? maskKey(key.value) : "");
      process.stdout.write(JSON.stringify({ id: p.id, ok: !!r.ok, detail: r.detail || "", models, at: at.at }) + "\n");
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
    case "extract-batch":
      return extractBatch(flags);
    case "taxonomies": {
      const r = taxonomyReport();
      return process.stdout.write(flags.json ? JSON.stringify(r) + "\n" : r.taxonomies.map((t) => `${t.id}\t${t.prefix}\t${t.kind}\t${t.labels.length} labels\t${t.name}`).join("\n") + "\n");
    }
    case "taxonomy-edit":
      return taxonomyEdit(rest[0], flags);
    case "taxonomy-new":
      return taxonomyNew(flags);
    case "taxonomy-show":
      return process.stdout.write(JSON.stringify(taxonomyShow(rest[0])) + "\n");
    case "taxonomy-save":
      return process.stdout.write(JSON.stringify(taxonomySave(rest[0], flags)) + "\n");
    case "taxonomy-draft":
      return process.stdout.write(JSON.stringify(await taxonomyDraft()) + "\n");
    case "taxonomy-remove":
      return process.stdout.write(JSON.stringify(taxonomyRemove(rest[0], flags)) + "\n");
    case "classify":
      return classify(flags);
    case "classify-show": {
      // one paper's result, label by label (its menu › Audit the taxonomies)
      const id = String(flags.item || "");
      if (!/^\d+:[A-Z0-9]{8}$/.test(id)) throw new Error("usage: oma-zotero-prompt classify-show --item <lib:key> --json");
      const r = auditView(loadStore().papers[id], loadTaxonomies().taxonomies);
      return process.stdout.write(JSON.stringify(Object.assign({ id }, r)) + "\n");
    }
    case "catchup-plan":
      return process.stdout.write(JSON.stringify(await catchupPlan(flags)) + "\n");
    case "classify-status": {
      const r = classifyStatus(flags);
      return process.stdout.write(flags.json ? JSON.stringify(r) + "\n" : r.items.map((i) => `${i.id}\t${i.classified ? "classified" : "never"}\t${i.stale.join(",") || "current"}`).join("\n") + "\n");
    }
    case "classify-review": {
      const { taxonomies } = loadTaxonomies();
      const items = reviewList(loadStore(), taxonomies);
      return process.stdout.write(flags.json ? JSON.stringify({ items }) + "\n" : items.map((i) => `${i.id}\t${i.prefix}${i.label}\t${Math.round(i.p * 100)}%\t${i.paper}`).join("\n") + "\n");
    }
    case "classify-decide":
      return classifyDecide(flags);
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

