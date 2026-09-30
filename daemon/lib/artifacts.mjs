// Artifacts: what a prompt, a chat or a change asked for makes besides notes (lib/formats.mjs: a
// Markdown document, an HTML page, a diagram, a mind map, an image), kept per paper in the folder
// chosen in Settings (default ~/.local/state/oma-zotero/artifacts), every version kept:
//
//   <folder>/<paper>_<library>-<KEY>/<id>/meta.json     { id, title, format, key, libraryID, paper, current, versions: [{ n, at, format, by, model, instruction }] }
//                                         /v1.mmd, v2.mmd…  every version's source
//                                         /<id>.mmd     the current version (the file to use)
//                                         /<id>.html    the current version's view (opens in the browser)
//   <folder>/.lib/                        the drawing libraries (lib/libs.mjs)
//
// A chat makes and changes artifacts through <artifact id="…" format="…" title="…">…</artifact>
// blocks in its answers (the pattern chat apps use for artifacts: the id says which one a new
// version replaces), so any model can, without tool calls. Pure but for the store's file I/O (node-tested).
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, renameSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { FORMATS, ARTIFACT_FORMATS, contract, extract, sanitize, validate, renderView } from "./formats.mjs";
import { buildMessage, slugify, validId } from "./prompts.mjs";

export function defaultArtifactsRoot(env = process.env) {
  return join(env.XDG_STATE_HOME || join(env.HOME || "", ".local", "state"), "oma-zotero", "artifacts");
}

// The folder from the settings ("~/…" expanded), else the default.
export function artifactsRoot(settings, env = process.env) {
  const d = String((settings && settings.artifactsDir) || "").trim();
  if (!d) return defaultArtifactsRoot(env);
  return d.replace(/^~(?=$|\/)/, env.HOME || "~");
}

export const libDir = (root) => join(root, ".lib");

const PAPER_DIR = /(?:^|_)(\d+)-([A-Z0-9]{8})$/;

function checkKey(key) {
  if (!/^[A-Z0-9]{8}$/.test(String(key))) throw new Error("bad item key");
}

export function findPaperDir(root, key, libraryID = 1) {
  checkKey(key);
  if (!existsSync(root)) return null;
  const lib = Number(libraryID) || 1;
  const d = readdirSync(root).find((f) => {
    const m = PAPER_DIR.exec(f);
    return m && Number(m[1]) === lib && m[2] === key;
  });
  return d ? join(root, d) : null;
}

// "sirmon-et-al-2007_1-ABCD1234": readable in a file manager, found by its key.
export function ensurePaperDir(root, key, libraryID = 1, label = "") {
  const found = findPaperDir(root, key, libraryID);
  if (found) return found;
  const slug = slugify(String(label || "").replace(/^\((.*)\)$/, "$1")).slice(0, 50);
  const dir = join(root, `${slug ? slug + "_" : ""}${Number(libraryID) || 1}-${key}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readMeta(dir) {
  return JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
}

function write(path, text) {
  writeFileSync(path + ".tmp", text);
  renameSync(path + ".tmp", path);
}

const ext = (format) => (FORMATS[format] || {}).ext || "txt";

// What the launcher lists: { id, title, format, formatLabel, current, versions, created, updated, by, model, view, file, dir }
export function summary(dir, meta) {
  const v = meta.versions.find((x) => x.n === meta.current) || meta.versions[meta.versions.length - 1] || {};
  return { id: meta.id, title: meta.title, format: meta.format, formatLabel: (FORMATS[meta.format] || {}).label || meta.format, current: meta.current, versions: meta.versions.length,
    created: meta.created, updated: meta.updated, by: v.by || "", model: v.model || "", key: meta.key, libraryID: meta.libraryID, paper: meta.paper || "",
    view: join(dir, meta.id + ".html"), file: join(dir, meta.id + "." + ext(meta.format)), dir };
}

// A paper's artifacts, the most recently changed first.
export function listArtifacts(root, key, libraryID = 1) {
  const pd = findPaperDir(root, key, libraryID);
  if (!pd) return [];
  const out = [];
  for (const id of readdirSync(pd)) {
    if (!validId(id)) continue;
    try { out.push(summary(join(pd, id), readMeta(join(pd, id)))); } catch { /* not an artifact */ }
  }
  return out.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
}

// Every paper's, the most recently changed first.
export function listAllArtifacts(root) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const d of readdirSync(root)) {
    const m = PAPER_DIR.exec(d);
    if (m) out.push(...listArtifacts(root, m[2], Number(m[1])));
  }
  return out.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
}

export function loadArtifact(root, key, libraryID, id) {
  if (!validId(id)) throw new Error("bad artifact id");
  const pd = findPaperDir(root, key, libraryID);
  const dir = pd && join(pd, id);
  if (!dir || !existsSync(join(dir, "meta.json"))) throw new Error(`no artifact "${id}" on this paper`);
  return { dir, meta: readMeta(dir) };
}

export function readSource(dir, meta, n = meta.current) {
  const v = meta.versions.find((x) => x.n === n);
  if (!v) throw new Error(`no version ${n}`);
  return readFileSync(join(dir, `v${n}.${ext(v.format || meta.format)}`), "utf8");
}

// The current version's file and view, from the version the meta points at.
function writeCurrent(dir, meta) {
  const v = meta.versions.find((x) => x.n === meta.current);
  meta.format = v.format || meta.format;
  const src = readSource(dir, meta);
  for (const f of readdirSync(dir)) if (f.startsWith(meta.id + ".") && f !== meta.id + ".html" && f !== meta.id + "." + ext(meta.format)) try { unlinkSync(join(dir, f)); } catch { /* gone */ }
  write(join(dir, meta.id + "." + ext(meta.format)), src.endsWith("\n") ? src : src + "\n");
  const subtitle = [meta.paper, FORMATS[meta.format].label, `version ${meta.current} of ${meta.versions.length}`, (v.at || "").slice(0, 10)].filter(Boolean).join(" · ");
  write(join(dir, meta.id + ".html"), renderView(meta.format, src, { title: meta.title, subtitle, lib: "../../.lib" }));
  write(join(dir, "meta.json"), JSON.stringify(meta, null, 1));
}

// A new artifact, or a new version of `id` when it exists. → summary + { isNew, version }
export function saveArtifact(root, { key, libraryID = 1, paper = "", id = "", title = "", format, source, by = "", model = "", instruction = "", now = new Date() }) {
  if (!ARTIFACT_FORMATS.includes(format)) throw new Error(`bad artifact format: ${format}`);
  const pd = ensurePaperDir(root, key, libraryID, paper);
  const at = now.toISOString();
  let meta;
  let dir = validId(id) ? join(pd, id) : "";
  const isNew = !dir || !existsSync(join(dir, "meta.json"));
  if (isNew) {
    const base = (validId(id) ? id : slugify(title)) || format;
    let nid = base;
    for (let i = 2; existsSync(join(pd, nid)); i++) nid = `${base}-${i}`.slice(0, 60);
    dir = join(pd, nid);
    mkdirSync(dir, { recursive: true });
    meta = { id: nid, title: String(title || "").replace(/\s+/g, " ").trim().slice(0, 120) || FORMATS[format].label, format, key, libraryID: Number(libraryID) || 1, paper, created: at, updated: at, current: 0, versions: [] };
  } else {
    meta = readMeta(dir);
    if (title && by !== "edit") meta.title = String(title).replace(/\s+/g, " ").trim().slice(0, 120);
  }
  const n = meta.versions.reduce((m, v) => Math.max(m, v.n), 0) + 1;
  write(join(dir, `v${n}.${ext(format)}`), String(source).trim() + "\n");
  meta.versions.push(Object.assign({ n, at, format, by, model }, instruction ? { instruction: String(instruction).slice(0, 500) } : {}));
  meta.current = n;
  meta.updated = at;
  writeCurrent(dir, meta);
  return Object.assign(summary(dir, meta), { isNew, version: n });
}

// Back to the version before the current one (the later ones stay, listed).
export function undoArtifact(root, key, libraryID, id) {
  const { dir, meta } = loadArtifact(root, key, libraryID, id);
  const earlier = meta.versions.map((v) => v.n).filter((n) => n < meta.current);
  if (!earlier.length) throw new Error("this is its first version: nothing to undo");
  meta.current = Math.max(...earlier);
  meta.updated = new Date().toISOString();
  writeCurrent(dir, meta);
  return summary(dir, meta);
}

export function renameArtifact(root, key, libraryID, id, title) {
  const t = String(title || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!t) throw new Error("the title can't be empty");
  const { dir, meta } = loadArtifact(root, key, libraryID, id);
  meta.title = t;
  writeCurrent(dir, meta);
  return summary(dir, meta);
}

export function deleteArtifact(root, key, libraryID, id) {
  const { dir } = loadArtifact(root, key, libraryID, id);
  rmSync(dir, { recursive: true, force: true });
}

// Every view again (after the libraries arrive, or an update of the view pages).
export function rerenderAll(root) {
  for (const a of listAllArtifacts(root)) try { writeCurrent(a.dir, readMeta(a.dir)); } catch { /* skip it */ }
}

// ---------------------------------------------------------------- making one with a model

// What the model is for a prompt run or a change: the format's output contract. The rules and
// the user's instructions follow (lib/system.mjs, context "artifact").
export function artifactSystem(format) {
  const f = FORMATS[format];
  return `You make ${f.noun} about one academic paper. It is saved with the paper in the reader's library and opened in a browser.

You get the paper's metadata, its APA 7 reference and in-text citation (formatted by Zotero, exact), the reader's highlights and comments with page labels, their existing notes, and the full text Zotero extracted from the file.

# Output

${contract(format)}`;
}

// The request for a new version: what to change, the current version, then the paper.
export function editMessage(meta, source, instruction, ctx) {
  const f = FORMATS[meta.format];
  const body = [`Change the ${f.noun.replace(/^an? /, "")} "${meta.title}" as asked below, and write the whole new version (not only what changes).`, "", "## What to change", "", String(instruction || "").trim(),
    "", "## The current version", "", "<current>", source.trim(), "</current>"].join("\n");
  return buildMessage({ body }, ctx);
}

// Generate, take the artifact out of the answer, clean and check it; one retry that says what was
// wrong. `gen(messages)` → { text, … }. → { source, error ("" when usable), answer, retried }
export async function produce(format, messages, gen) {
  let answer = await gen(messages);
  let source = sanitize(format, extract(format, answer.text));
  let error = validate(format, source);
  let retried = false;
  if (error) {
    retried = true;
    const again = messages.concat([
      { role: "assistant", content: answer.text },
      { role: "user", content: `That can't be used: ${error}. Write it again, whole, following the output format exactly, and nothing else.` },
    ]);
    answer = await gen(again);
    source = sanitize(format, extract(format, answer.text));
    error = validate(format, source);
  }
  return { source, error, answer, retried };
}

// ---------------------------------------------------------------- in a chat

export const CHAT_SOURCES_CHARS = 40000; // the most of the artifacts' text a chat turn carries

// The chat's system prompt section on artifacts: how to make and change one, and the paper's
// artifacts now (their current text, newest first, while it fits).
export function chatArtifactsSection(list, readCurrent, budget = CHAT_SOURCES_CHARS) {
  const lines = ["# Artifacts", "",
    "Besides answering, you can make or change an artifact that is saved with the paper: a diagram, a mind map, an image, an HTML page or a Markdown document. Make one only when the user asks for one (or for a visual, a map, a figure, a page or a file), and change one when they ask you to.",
    "", "Write it inside your answer:", "", '<artifact id="short-id" format="mindmap" title="A short title">', "its whole content", "</artifact>", "",
    "- format is one of these, and the content follows its rules:"];
  for (const f of ARTIFACT_FORMATS) lines.push(`  - ${f} (${FORMATS[f].noun}): ${contract(f)}`);
  lines.push("- To change an artifact, use its id and write the whole new version, not only what changes. A new one gets a new id: lowercase words joined by hyphens.",
    "- Outside the block, say in a sentence or two what you made or changed: the user sees the artifact as a link, not its content.", "");
  if (!list.length) {
    lines.push("The paper has no artifacts yet.");
    return lines.join("\n");
  }
  lines.push("The paper's artifacts now:", "");
  let left = budget;
  for (const a of list) {
    lines.push(`- id "${a.id}": ${FORMATS[a.format].label} "${a.title}" (version ${a.current})`);
    let src = "";
    try { src = readCurrent(a); } catch { /* unreadable */ }
    if (src && src.length <= left) {
      lines.push(`<current id="${a.id}">`, src.trim(), "</current>");
      left -= src.length;
    } else if (src) lines.push("  (too long to include here: to change it, ask the user to use Change it with AI in the launcher)");
  }
  return lines.join("\n");
}

const BLOCK = /<artifact\b([^>]*)>([\s\S]*?)<\/artifact>/gi;

function attrs(s) {
  const out = {};
  for (const m of String(s).matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) out[m[1].toLowerCase()] = m[2];
  return out;
}

// The artifact blocks in an answer: [{ raw, id, format, title, content }]; `cut`: an unclosed one at the end.
export function findArtifactBlocks(text) {
  const blocks = [];
  for (const m of String(text || "").matchAll(BLOCK)) {
    const a = attrs(m[1]);
    blocks.push({ raw: m[0], id: String(a.id || "").toLowerCase(), format: String(a.format || a.type || "").toLowerCase(), title: a.title || "", content: m[2].replace(/^\n+|\n+$/g, "") });
  }
  const rest = String(text || "").replace(BLOCK, "");
  const cut = /<artifact\b[^>]*>[\s\S]*$/i.exec(rest);
  return { blocks, cut: cut ? cut[0] : "" };
}

export function artifactLink(a) {
  return `[▣ ${a.title} · ${a.formatLabel || (FORMATS[a.format] || {}).label || a.format}, version ${a.version || a.current}](oma-artifact:${a.id})`;
}

// The answer as the chat keeps it: each block replaced by `replace(block)` (a link, or why it
// wasn't saved), an unclosed one by a line saying it was cut off.
export function replaceArtifactBlocks(text, blocks, replace, cut) {
  let out = String(text || "");
  for (const b of blocks) out = out.replace(b.raw, () => `\n\n${replace(b)}\n\n`);
  if (cut) out = out.replace(cut, () => "\n\n*(An artifact was cut off before it ended, so it wasn't saved: ask again.)*");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
