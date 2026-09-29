// Prompt files and the text sent to Claude. Pure (no I/O besides the store
// functions at the bottom), so node can test it.
//
// A prompt is one Markdown file in the prompts directory
// (~/.config/omarchy/oma-zotero-launcher/prompts/<id>.md): YAML-ish frontmatter with
// `title`, `model` and `effort`, then the instruction itself. The runner adds
// the paper (metadata, APA 7 reference, annotations, notes, full text).
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "defaults");
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export const DEFAULT_META = { model: "opus[1m]", effort: "high" };

// A model value as the Agent SDK takes it: an alias ("opus", "sonnet"), an id
// ("claude-opus-5"), with a context suffix ("opus[1m]"). The list to pick from comes
// from the SDK (models.mjs); this only keeps the file from holding anything odd.
export function validModel(m) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}(\[[0-9a-z]{1,8}\])?$/.test(String(m || ""));
}

// "" = the model's own default (models without effort levels, such as Haiku).
export function validEffort(e) {
  return e === "" || EFFORTS.includes(e);
}

export function promptsDir(env = process.env) {
  const config = env.XDG_CONFIG_HOME || join(env.HOME || "", ".config");
  return env.OMA_ZOTERO_PROMPTS_DIR || join(config, "omarchy", "oma-zotero-launcher", "prompts");
}

// "Findings & Takeaways!" → "findings-takeaways"
export function slugify(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function validId(id) {
  return /^[a-z0-9][a-z0-9-]{0,59}$/.test(String(id || ""));
}

// "---\ntitle: X\nmodel: opus\n---\nbody" → { title, model, effort, body }. Unknown or
// invalid values fall back to the defaults; a file without frontmatter is all body.
export function parsePrompt(text, id) {
  const src = String(text || "").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src);
  const meta = {};
  if (m) {
    for (const line of m[1].split("\n")) {
      const kv = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/.exec(line);
      if (kv) meta[kv[1].toLowerCase()] = kv[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  const effort = meta.effort === "default" ? "" : meta.effort;
  return {
    id,
    title: meta.title || id,
    model: validModel(meta.model) ? meta.model : DEFAULT_META.model,
    effort: effort !== undefined && validEffort(effort) ? effort : DEFAULT_META.effort,
    body: (m ? m[2] : src).trim(),
  };
}

export function serializePrompt(p) {
  const title = String(p.title || "").replace(/[\r\n]+/g, " ").trim();
  const effort = p.effort === "" ? "default" : p.effort || DEFAULT_META.effort;
  return `---\ntitle: ${title}\nmodel: ${p.model || DEFAULT_META.model}\neffort: ${effort}\n---\n\n${String(p.body || "").trim()}\n`;
}

// The first line of the instruction, for the overlay.
export function excerpt(body, max = 120) {
  const line = String(body || "").split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#")) || "";
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

// Fixed for every prompt: what the model is, what it gets, and the rules that keep
// the note honest. The prompt file says what to write.
export const SYSTEM = `You write research notes that are saved as a Zotero note on the paper they are about.

You get the paper's metadata, its APA 7 reference and in-text citation (formatted by Zotero, exact), the reader's highlights and comments with page labels, their existing notes, and the full text Zotero extracted from the file. Work from that material only.

Rules:
- Never invent content, quotes, page numbers or references. If something is not in the material, say so.
- Quotes are verbatim from the full text or the highlights, in quotation marks, with an APA 7 in-text citation. Give the page ("p. 275") when you know it: highlights carry their page label, and the reference gives the article's page range. When you cannot tell the page, cite the section instead (e.g. "Discussion section"), never a guess.
- Cite the paper itself with the in-text citation given. Works the paper cites are cited as the paper cites them, and go in the references only if they appear in its reference list.
- The reference list uses APA 7. The paper's own reference is the one given, copied exactly. Entries for works it cites come from the paper's reference list, reformatted to APA 7; do not add DOIs or details that are not there.
- Write Markdown: ## and ### headings, lists, **bold**, *italics* (journal titles and volumes in references), > blockquotes, tables. No top-level # heading: the note gets its title separately. No preamble or closing remarks: output only the note.`;

// The user message: the prompt, then the paper.
export function buildMessage(prompt, ctx) {
  const lines = [];
  lines.push("# Task", "", prompt.body, "");
  lines.push("# The paper", "");
  lines.push(`- Title: ${ctx.title}`);
  if (ctx.itemType) lines.push(`- Item type: ${ctx.itemType}`);
  if (ctx.reference) lines.push(`- APA 7 reference: ${ctx.reference}`);
  if (ctx.citation) lines.push(`- APA 7 in-text citation: ${ctx.citation}`);
  if (ctx.citekey) lines.push(`- Citation key: ${ctx.citekey}`);
  lines.push("");
  lines.push("# The reader's highlights and comments", "");
  if (ctx.annotations && ctx.annotations.length) {
    for (const a of ctx.annotations) {
      const bits = [`[p. ${a.pageLabel || "?"}]`, a.type];
      if (a.text) bits.push(`"${a.text}"`);
      if (a.comment) bits.push(`— comment: ${a.comment}`);
      lines.push("- " + bits.join(" "));
    }
  } else lines.push("(none)");
  lines.push("");
  lines.push("# The reader's existing notes", "");
  if (ctx.notes && ctx.notes.length) {
    for (const n of ctx.notes) lines.push(`## ${n.title || "Untitled note"}`, "", n.markdown.trim(), "");
  } else lines.push("(none)", "");
  lines.push("# Full text", "");
  if (ctx.fulltext && ctx.fulltext.text) {
    const f = ctx.fulltext;
    lines.push(`(${f.title || "file"}, ${f.chars} of ${f.totalChars} characters${f.truncated ? ", cut off: say so where it matters" : ""}; page breaks are not marked)`, "");
    lines.push("<fulltext>", f.text, "</fulltext>");
  } else {
    lines.push(`(not available${ctx.fulltextError ? ": " + ctx.fulltextError : ""}: work from the metadata, highlights and notes, and say that the full text was not available)`);
  }
  return lines.join("\n");
}

// Drop a leading "# …" line the model may add anyway: the note gets its own <h1>.
export function stripTopHeading(markdown) {
  return String(markdown || "").replace(/^\s*#\s[^\n]*\n+/, "").trim();
}

export function noteTitle(prompt, ctx) {
  return `${prompt.title}: ${ctx.citation ? ctx.citation.replace(/^\((.*)\)$/, "$1") + " — " : ""}${ctx.title}`;
}

// ---------------------------------------------------------------- the store

// The prompts directory, seeded with the bundled defaults the first time.
export function ensureStore(dir = promptsDir()) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(DEFAULTS_DIR)) {
      if (f.endsWith(".md")) writeFileSync(join(dir, f), readFileSync(join(DEFAULTS_DIR, f), "utf8"));
    }
  }
  return dir;
}

export function listPrompts(dir = ensureStore()) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && validId(f.slice(0, -3)))
    .map((f) => parsePrompt(readFileSync(join(dir, f), "utf8"), f.slice(0, -3)))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function loadPrompt(id, dir = ensureStore()) {
  if (!validId(id)) throw new Error(`bad prompt id: ${id}`);
  const path = join(dir, id + ".md");
  if (!existsSync(path)) throw new Error(`no prompt "${id}" in ${dir}`);
  return parsePrompt(readFileSync(path, "utf8"), id);
}

// Change a prompt's title, model or effort (the text stays as it is).
export function updatePrompt(id, changes, dir = ensureStore()) {
  const p = loadPrompt(id, dir);
  if (changes.title != null) {
    const t = String(changes.title).replace(/[\r\n]+/g, " ").trim();
    if (!t) throw new Error("the title can't be empty");
    p.title = t.slice(0, 120);
  }
  if (changes.model != null) {
    if (!validModel(changes.model)) throw new Error(`bad model: ${changes.model}`);
    p.model = changes.model;
  }
  if (changes.effort != null) {
    const e = changes.effort === "default" ? "" : changes.effort;
    if (!validEffort(e)) throw new Error(`bad effort: ${changes.effort} (low, medium, high, xhigh, max or default)`);
    p.effort = e;
  }
  writeFileSync(join(dir, id + ".md"), serializePrompt(p));
  return p;
}

// A new prompt file from a title (a free id: "-2", "-3", … when taken) → its path.
export function createPrompt(title, dir = ensureStore()) {
  const clean = String(title || "").trim() || "New prompt";
  const base = slugify(clean) || "prompt";
  let id = base;
  for (let i = 2; existsSync(join(dir, id + ".md")); i++) id = `${base}-${i}`;
  const body = "Describe the note Claude should write about this paper.\n\nKeep the rules for quotes and citations: quote verbatim with APA 7 in-text citations and page numbers, and end with a \"## References\" section in APA 7 format.";
  const path = join(dir, id + ".md");
  writeFileSync(path, serializePrompt({ title: clean, body }));
  return { id, path };
}
