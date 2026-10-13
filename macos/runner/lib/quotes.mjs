// The quote check: every quotation in an answer is looked up in what the model was given (the
// paper's text, its title and reference, the user's highlights and notes), and the ones not
// found word for word are flagged. Smaller models invent quotes more often; this makes it
// visible. Pure (node-tested).

const MIN_WORDS = 5; // shorter quoted phrases are terms, not quotes

// A form both sides share: lower case, one kind of quote, dash and space, no line-break
// hyphenation, no page marks or Markdown emphasis.
export function normalize(s) {
  return String(s || "")
    .replace(/-\s*\n\s*/g, "") // "hyphen-\nated" → "hyphenated"
    .replace(/\[p\.\s*[^\]]*\]|^#+\s*p\.\s*\S+\s*$/gim, " ")
    .replace(/[*_`]/g, "")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/ﬁ/g, "fi").replace(/ﬂ/g, "fl").replace(/ﬀ/g, "ff").replace(/ﬃ/g, "ffi").replace(/ﬄ/g, "ffl")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// The quotations in an answer: text in “…” or "…" of MIN_WORDS words or more (block quotes
// are left out: they are often paraphrased headings).
export function findQuotes(answer) {
  const out = [];
  const re = /“([^”]{10,1500})”|"([^"\n]{10,1500})"/g;
  let m;
  while ((m = re.exec(String(answer || "")))) {
    const q = (m[1] || m[2]).trim();
    if (q.split(/\s+/).length >= MIN_WORDS) out.push(q);
  }
  return out;
}

// A quote is found when each of its parts (split at ellipses and editorial brackets) appears.
export function quoteFound(quote, normalizedText) {
  const parts = String(quote).split(/\s*(?:\.\.\.|…|\[[^\]]*\])\s*/).map(normalize).map((p) => p.replace(/^[\s.,;:'"]+|[\s.,;:'"]+$/g, "")).filter((p) => p.split(" ").length >= 3);
  if (!parts.length) return true;
  return parts.every((p) => normalizedText.includes(p));
}

// → { checked, missing: [quote] } (checked: how many quotations were looked up).
export function checkQuotes(answer, paperText) {
  const text = normalize(paperText);
  const quotes = findQuotes(answer);
  if (!text) return { checked: 0, missing: [] };
  return { checked: quotes.length, missing: quotes.filter((q) => !quoteFound(q, text)) };
}

// Everything a quote may come from, as one text.
export function groundingText(ctx) {
  const c = ctx || {};
  return [c.title, c.reference, (c.annotations || []).map((a) => `${a.text || ""} ${a.comment || ""}`).join("\n"), (c.notes || []).map((n) => n.markdown || "").join("\n"), c.text].filter(Boolean).join("\n\n");
}

// The line a saved note ends with.
export function quoteCheckLine(r) {
  if (!r || !r.checked) return "";
  if (!r.missing.length) return `Quote check: all ${r.checked} quotation${r.checked === 1 ? " was" : "s were"} found word for word in the paper's text.`;
  return `Quote check: ${r.missing.length} of ${r.checked} quotation${r.checked === 1 ? " was" : "s were"} not found word for word in the paper's text; check ${r.missing.length === 1 ? "it" : "them"} before citing: ` +
    r.missing.map((q) => `“${q.length > 120 ? q.slice(0, 117) + "…" : q}”`).join("; ");
}
