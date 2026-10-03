// A paper's text from its PDF, page by page, for a note (and for the chat and prompts to
// ground on). pdftotext (Poppler) does the extraction: it keeps page breaks, so every
// page can carry the page number the journal printed on it ("p. 275"), which is what an
// APA 7 quote cites. Everything here but pdftotext() is pure (node-tested).
import { spawn } from "node:child_process";

export const FULLTEXT_TAG = "oma-fulltext";
export const MAX_NOTE_CHARS = 240000; // Zotero syncs notes up to about 250,000 characters

// Run pdftotext on a file → its text, pages separated by form feeds. Rejects with a clear
// message when pdftotext is missing (poppler) or the file can't be read.
export function pdftotext(path, run = spawn) {
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    const p = run("pdftotext", ["-enc", "UTF-8", "-eol", "unix", path, "-"], { stdio: ["ignore", "pipe", "pipe"] });
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => reject(new Error(e.code === "ENOENT" ? "pdftotext isn't installed (it comes with Poppler: omarchy pkg add poppler)" : e.message)));
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`pdftotext failed: ${err.trim().split("\n").pop() || "exit " + code}`))));
  });
}

// Automatic extraction (extract-batch): why a paper is left alone, or "" to extract it. { paper: has a
// paper, extracted: has its text already, pdf: a PDF on disk, bytes: its size, maxBytes: the limit (0: none) }.
export function skipReason({ paper, extracted, pdf, bytes, maxBytes }) {
  if (!paper) return "not a paper";
  if (extracted) return "already extracted";
  if (!pdf) return "no PDF on disk";
  if (maxBytes > 0 && bytes > maxBytes) return `large PDF (${Math.round(bytes / 1048576)} MB, over ${Math.round(maxBytes / 1048576)} MB)`;
  return "";
}

// An extraction error that means "a scan": no text layer, so OCR it first.
export function isScan(message) {
  return /no text layer/i.test(String(message || ""));
}

// "text\fmore\f" → ["text", "more"] (a trailing empty page dropped).
export function splitPages(text) {
  const pages = String(text || "").split("\f");
  while (pages.length && !pages[pages.length - 1].trim()) pages.pop();
  return pages;
}

// The number printed on each page, if the journal prints them: a line holding only a
// number near the top or bottom of the page. Taken when one offset (printed − position)
// fits at least 40% of the pages; else from the item's page range ("273-292") when its
// length matches; else the PDF's own page numbers. → { labels: ["273", …], source }
export function pageLabels(pages, pagesField) {
  const n = pages.length;
  const votes = new Map();
  pages.forEach((page, i) => {
    const lines = page.split("\n").map((l) => l.trim()).filter(Boolean);
    const edge = [...lines.slice(0, 3), ...lines.slice(-3)];
    const seen = new Set();
    for (const l of edge) {
      if (!/^\d{1,5}$/.test(l)) continue;
      const offset = Number(l) - i;
      if (seen.has(offset)) continue;
      seen.add(offset);
      votes.set(offset, (votes.get(offset) || 0) + 1);
    }
  });
  let best = null;
  for (const [offset, count] of votes) if (!best || count > best.count) best = { offset, count };
  if (best && n >= 2 && best.count >= Math.max(2, Math.ceil(n * 0.4)) && best.offset + n - 1 > 0) {
    return { labels: pages.map((_, i) => String(Math.max(1, i + best.offset))), source: "printed" };
  }
  const m = /^\s*(\d+)\s*[-–—]\s*(\d+)\s*$/.exec(String(pagesField || ""));
  if (m) {
    const start = Number(m[1]);
    const count = Number(m[2]) - start + 1;
    if (count > 0 && Math.abs(count - n) <= 1) return { labels: pages.map((_, i) => String(start + i)), source: "range" };
  }
  return { labels: pages.map((_, i) => String(i + 1)), source: "pdf" };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A page's text → paragraphs: lines joined, hyphenated breaks mended ("uncer-\ntainty"),
// blank lines as paragraph breaks.
export function paragraphs(page) {
  return String(page || "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2").replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

// The note: a title, where the text came from, then one "p. N" section per page. Cut (with
// a line saying so) to stay under Zotero's note size.
export function buildNote({ title, pages, labels, source, file, extractor, date }) {
  const how = source === "printed" ? "page numbers as printed in the paper"
    : source === "range" ? "page numbers from the item's page range"
      : "page numbers of the PDF";
  let html = `<h1>Full text: ${esc(title)}</h1>\n<p><em>Extracted from ${esc(file)} with ${esc(extractor)} on ${esc(date)}; ${how}. ` +
    `Generated text: check quotes against the PDF.</em></p>\n`;
  let cut = false;
  for (let i = 0; i < pages.length; i++) {
    const section = `<h2>p. ${esc(labels[i])}</h2>\n` + paragraphs(pages[i]).map((p) => `<p>${esc(p)}</p>`).join("\n") + "\n";
    if (html.length + section.length > MAX_NOTE_CHARS) {
      cut = true;
      break;
    }
    html += section;
  }
  if (cut) html += `<p><em>The text stops here: the rest would make the note too long for Zotero to sync.</em></p>\n`;
  return { html, cut, chars: html.length };
}

// The same text for grounding a chat or a prompt: "[p. 275]" before each page.
export function groundingText(pages, labels) {
  return pages.map((p, i) => `[p. ${labels[i]}]\n${paragraphs(p).join("\n\n")}`).join("\n\n");
}
