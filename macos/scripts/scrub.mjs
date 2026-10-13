// What makes a bridge answer from your library safe to commit, in a public repository, as a test
// fixture (scripts/capture-fixtures.mjs): every string becomes a fake of the same length (so
// offsets such as titleRanges still fit) and the same line breaks, and nothing else of the
// original: no word lengths, capitals or punctuation, which together would fingerprint a title.
// The fakes come from an HMAC keyed by a secret made for this run and never written, so the same
// value scrubs the same way within a capture, and nobody can compute the fake of a guess to check
// whether a paper is in your library. HTML keeps its markup; its text and attribute values are
// scrubbed. Values under the safe keys below (ids, types, dates, counts) are kept, as are numbers
// and booleans.
import { createHmac, randomBytes } from "node:crypto";

const SECRET = randomBytes(32); // this run's, never stored

export const SAFE_KEYS = new Set([
  "key", "libraryID", "itemType", "contentType", "readerType", "kind", "type", "status", "openState",
  "ok", "tookMs", "searchMs", "bridgeVersion", "zoteroVersion", "version", "rank", "score", "count",
  "pdfCount", "noteCount", "tagCount", "itemCount", "total", "candidates", "depth", "position", "year",
  "dateAdded", "dateModified", "date", "lastSync", "exists", "editable", "selected", "tabType",
  "windowKind", "format", "action", "parentKey", "attachmentKey", "topKey", "field", "mode",
  "truncated", "chars", "totalChars", "offset", "nextOffset", "parentID", "libraryType",
]);
// Kept only when they are Zotero keys (8 capitals and digits): a tag row's `key` is the tag's name.
const ID_KEYS = new Set(["key", "parentKey", "attachmentKey", "topKey"]);
const ZOTERO_KEY = /^[A-Z0-9]{8}$/;
const KEEP_ATTRS = new Set(["class", "style", "color", "dir", "lang"]);
const HTML = /<\/?[a-z][^>]*>/i;

function stream(secret, text) {
  let block = createHmac("sha256", secret).update(text).digest();
  let i = 0;
  return () => {
    if (i === block.length) { block = createHmac("sha256", secret).update(block).digest(); i = 0; }
    return block[i++];
  };
}

// One string's fake: the same length in UTF-16 code units (what offsets count) and the same line
// breaks; everything else lowercase letters and spaces from the keyed stream.
export function fake(text, secret = SECRET) {
  const next = stream(secret, text);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n") out += "\n";
    else { const b = next(); out += b % 6 === 0 ? " " : String.fromCharCode(97 + (b % 26)); }
  }
  return out;
}

function fakeHtml(html) {
  return html.split(/(<[^>]*>|&[a-zA-Z#0-9]+;)/).map((part) => {
    if (part.startsWith("&") && part.endsWith(";")) return part;
    if (!part.startsWith("<")) return fake(part);
    return part.replace(/([\w-]+)=("([^"]*)"|'([^']*)')/g, (all, name, quoted, dq, sq) =>
      KEEP_ATTRS.has(name.toLowerCase()) ? all : `${name}="${fake(dq ?? sq)}"`);
  }).join("");
}

function scrubString(s) {
  return HTML.test(s) ? fakeHtml(s) : fake(s);
}

// The whole answer, scrubbed. `key`: the name the value sits under (an array inherits its parent's).
function safe(key, s) {
  return ID_KEYS.has(key) ? ZOTERO_KEY.test(s) : SAFE_KEYS.has(key);
}

export function scrub(value, key = "") {
  if (typeof value === "string") return safe(key, value) ? value : scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrub(v, key));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v, k);
    return out;
  }
  return value;
}

function strings(value, key, out, keepSafe) {
  if (typeof value === "string") { if (!(keepSafe && safe(key, value))) out.push(value); }
  else if (Array.isArray(value)) value.forEach((v) => strings(v, key, out, keepSafe));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) strings(v, k, out, keepSafe);
  return out;
}

// The original values (longer than 3 characters, with a letter or digit, not under a safe key)
// that still appear in the scrubbed answer: what a fixture would leak. Empty means safe.
export function leaks(original, scrubbed) {
  const kept = strings(scrubbed, "", [], false);
  const found = new Set();
  for (const s of new Set(strings(original, "", [], true))) {
    if (s.length > 3 && /[\p{L}\p{N}]/u.test(s) && kept.some((k) => k.includes(s))) found.add(s);
  }
  return [...found];
}
