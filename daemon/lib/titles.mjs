// Note titles Zotero takes as they are. Zotero titles a note by its first line (the <h1> the runner writes), so
// that line gets only plain, printable text: a paper title's rich-text markup (<i>Homo</i>, H<sub>2</sub>O, <span
// class="nocase">) as its words, no control or invisible characters (line breaks, zero-width, bidi marks, lone
// surrogates, noncharacters), spaces collapsed; and at most TITLE_MAX characters, the paper's title shortened
// first, so the prompt's name and version always show. Pure (node-tested).

export const TITLE_MAX = 120; // Zotero cuts a note's title there

// A title's text, plain and printable.
export function cleanTitle(s) {
  return String(s == null ? "" : s)
    .replace(/<\/?(i|b|em|strong|sub|sup|span|sc)\b[^>]*>/gi, "") // Zotero's rich text in titles: its words
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, " ") // control characters, line and paragraph breaks
    .replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, "") // soft hyphens, zero-width and bidi marks
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "") // lone surrogates
    .replace(/[\uFDD0-\uFDEF\uFFFE\uFFFF]/g, "") // noncharacters
    .replace(/\s+/g, " ")
    .trim();
}

// head (kept whole: "Findings v2: ") then tail (the paper, shortened with "…" to fit max). → the title
export function fitTitle(head, tail, max = TITLE_MAX) {
  const h = cleanTitle(head) + (/\s$/.test(String(head)) && cleanTitle(head) ? " " : "");
  const t = cleanTitle(tail);
  if ((h + t).length <= max) return (h + t).trim();
  const room = max - h.length - 1;
  if (room < 8) return (h + t).slice(0, max - 1).trimEnd() + "…";
  const chars = Array.from(t); // never cut a character in two
  let cut = "";
  for (const c of chars) {
    if ((cut + c).length > room) break;
    cut += c;
  }
  return h + cut.replace(/[\s,;:·-]+$/, "") + "…";
}
