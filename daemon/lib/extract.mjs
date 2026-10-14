// A paper's text from its PDF, page by page, for a note (and for the chat and prompts to
// ground on). pdftotext (Poppler) does the extraction: it keeps page breaks, so every
// page can carry the page number the journal printed on it ("p. 275"), which is what an
// APA 7 quote cites. A page with no text layer (a scan) is read by OCR when Tesseract is installed:
// pdftoppm (Poppler, as pdftotext) draws the page, tesseract reads it. Everything here but the
// spawning (pdftotext, ocrLanguages, ocrPage) is pure (node-tested).
import { spawn } from "node:child_process";
import { installHint, isMac } from "./platform.mjs";

export const FULLTEXT_TAG = "oma-fulltext";
export const MAX_NOTE_CHARS = 240000; // Zotero syncs notes up to about 250,000 characters
export const OCR_MAX_PAGES = 80; // a longer scan is left alone (a book: OCR it in a PDF app)
export const OCR_PAGE_SECONDS = 120;
export const MIN_PAGE_CHARS = 40; // less, and a page counts as having no text layer

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
    p.on("error", (e) => reject(new Error(e.code === "ENOENT" ? `pdftotext isn't installed (it comes with Poppler: ${installHint("poppler")})` : e.message)));
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

// An extraction error that means "a scan": no text layer, and no OCR to read it (or too long for it).
export function isScan(message) {
  return /no text layer/i.test(String(message || ""));
}

// What extract-batch records for a scan it left alone (extract.json's skipped, shown in Settings).
export function scanReason(message) {
  const s = String(message || "");
  if (/needs Tesseract/.test(s)) return "a scan, with no text layer: reading it needs Tesseract (Settings › Setup)";
  const long = /a scan of (\d+) pages/.exec(s);
  if (long) return `a scan of ${long[1]} pages, over the ${OCR_MAX_PAGES} read by OCR`;
  if (/OCR found/.test(s)) return "a scan, with no text layer: OCR found no text in it";
  return "a scan, with no text layer";
}

// How to install Tesseract (with English, on Omarchy: its languages are packages of their own).
export function tesseractHint(platform = process.platform) {
  return isMac(platform) ? installHint("tesseract", platform) : installHint("tesseract tesseract-data-eng", platform);
}

// pdftotext's text → every page, the empty ones too (it ends each page with a form feed).
export function rawPages(text) {
  const pages = String(text || "").split("\f");
  if (pages.length > 1 && pages[pages.length - 1] === "") pages.pop();
  return pages;
}

// The pages with no text layer (fewer than MIN_PAGE_CHARS characters): the ones OCR reads. → [index]
export function pagesToOcr(pages, min = MIN_PAGE_CHARS) {
  return pages.map((p, i) => (String(p || "").trim().length < min ? i : -1)).filter((i) => i >= 0);
}

// tesseract --list-langs → the languages to read with: English first, then the others installed (at most
// three: each one slows it down), "" when none (osd and the like aren't languages).
export function pickLanguages(listed) {
  const langs = String(listed || "").split("\n").map((l) => l.trim()).filter((l) => /^[a-z]{3}(_[a-z]+)?$/i.test(l) && !["osd", "equ", "snum"].includes(l));
  langs.sort((a, b) => (a === "eng" ? -1 : b === "eng" ? 1 : a.localeCompare(b)));
  return langs.slice(0, 3).join("+");
}

// The note's provenance for the pages OCR read: "p. 3–12 read by OCR (Tesseract)".
export function ocrLine(labels, ocr) {
  if (!ocr || !ocr.length) return "";
  if (ocr.length === labels.length) return "every page read by OCR (Tesseract)";
  const ranges = [];
  let start = ocr[0], prev = ocr[0];
  for (const i of ocr.slice(1).concat([-2])) {
    if (i === prev + 1) { prev = i; continue; }
    ranges.push(start === prev ? labels[start] : labels[start] + "–" + labels[prev]);
    start = prev = i;
  }
  return "p. " + ranges.join(", ") + " read by OCR (Tesseract)";
}

// The installed languages to OCR with (pickLanguages), "" when tesseract isn't there.
export function ocrLanguages(run = spawn) {
  return new Promise((resolve) => {
    let out = "";
    let p;
    try { p = run("tesseract", ["--list-langs"], { stdio: ["ignore", "pipe", "pipe"] }); } catch { return resolve(""); }
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", () => {});
    p.on("error", () => resolve(""));
    p.on("close", (code) => resolve(code === 0 ? pickLanguages(out) : ""));
  });
}

// One page (1-based) read by OCR: pdftoppm draws it at 300 dpi, in grey, into tesseract. One thread (it runs
// in the background); killed after OCR_PAGE_SECONDS. → its text
export function ocrPage(path, n, langs, run = spawn, seconds = OCR_PAGE_SECONDS) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, OMP_THREAD_LIMIT: "1" };
    const draw = run("pdftoppm", ["-r", "300", "-gray", "-f", String(n), "-l", String(n), "-singlefile", "-png", path], { stdio: ["ignore", "pipe", "ignore"] });
    const read = run("tesseract", ["stdin", "stdout", "-l", langs], { stdio: ["pipe", "pipe", "pipe"], env });
    let out = "";
    let err = "";
    let done = false;
    const end = (f) => { if (!done) { done = true; clearTimeout(timer); f(); } };
    const timer = setTimeout(() => end(() => { draw.kill("SIGKILL"); read.kill("SIGKILL"); reject(new Error(`OCR took over ${seconds} s on page ${n}`)); }), seconds * 1000);
    draw.stdout.pipe(read.stdin);
    read.stdin.on("error", () => {});
    read.stdout.setEncoding("utf8");
    read.stdout.on("data", (d) => { out += d; });
    read.stderr.on("data", (d) => { err += d; });
    draw.on("error", (e) => end(() => reject(new Error(e.code === "ENOENT" ? "pdftoppm isn't installed (it comes with Poppler)" : e.message))));
    read.on("error", (e) => end(() => reject(new Error(e.code === "ENOENT" ? `tesseract isn't installed (${tesseractHint()})` : e.message))));
    read.on("close", (code) => end(() => (code === 0 ? resolve(out) : reject(new Error(`tesseract failed on page ${n}: ${err.trim().split("\n").pop() || "exit " + code}`)))));
  });
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
// ocr: the pages OCR read (indexes), said in the provenance line.
export function buildNote({ title, pages, labels, source, file, extractor, date, ocr }) {
  const how = source === "printed" ? "page numbers as printed in the paper"
    : source === "range" ? "page numbers from the item's page range"
      : "page numbers of the PDF";
  const read = ocrLine(labels, ocr);
  let html = `<h1>Full text: ${esc(title)}</h1>\n<p><em>Extracted from ${esc(file)} with ${esc(extractor)} on ${esc(date)}; ${how}${read ? "; " + esc(read) : ""}. ` +
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
