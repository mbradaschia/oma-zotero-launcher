// What makes a bridge answer from your library safe to commit, in a public repository, as a test
// fixture (scripts/capture-fixtures.mjs).
// - Every string becomes a fake of lowercase letters and spaces, from an HMAC keyed by a secret
//   made for this run and never written: the same value scrubs the same way within a capture, and
//   nobody can compute the fake of a guess. Nothing of the original's words, capitals or
//   punctuation survives.
// - Lengths: a title or name keeps its exact length (titleRanges index it); every other string is
//   padded to a multiple of 8, so a creator, journal or tag can't be told by its length.
// - Metadata that would narrow a paper down is coarsened: dates keep only their year, a journal's
//   rank (grades, subject area, FT50, UTD24) becomes the same fixed value everywhere.
// - HTML keeps only its tag names from a short list, without attributes; everything else in it
//   (text, stray "<", comments) is scrubbed as text.
// - Kept as they are: numbers, booleans, and a string under a safe key only when it has that key's
//   shape (an identifier such as "journalArticle" or "application/pdf", a version, a Zotero key);
//   anything else there is scrubbed like any string. A paper's status is your own word: scrubbed.
import { createHmac, randomBytes } from "node:crypto";

const SECRET = randomBytes(32); // this run's, never stored

// Each safe key's shape: a value of another shape is scrubbed.
const IDENT = /^[a-z][a-zA-Z0-9]{0,39}(?:[/.+-][a-zA-Z0-9]{1,40}){0,3}$/; // journalArticle, application/pdf, open-reader
const NUMBER = /^\d{1,12}$/;
const VERSION = /^\d{1,4}(?:\.\d{1,6}){0,3}(?:-[a-z]{1,8}\.?\d{0,4})?$/; // 7.0.11, 0.2.1-beta.1
export const SAFE_KEYS = new Map([
  ...["itemType", "contentType", "readerType", "kind", "type", "openState", "tabType", "windowKind", "format", "action", "mode", "libraryType"].map((k) => [k, IDENT]),
  ...["libraryID", "tookMs", "searchMs", "score", "count", "pdfCount", "noteCount", "tagCount", "itemCount", "total", "candidates", "depth", "position", "year", "chars", "totalChars", "offset", "nextOffset", "parentID"].map((k) => [k, NUMBER]),
  ...["bridgeVersion", "zoteroVersion", "version"].map((k) => [k, VERSION]),
]);
// Kept only when they are Zotero keys (8 capitals and digits): a tag row's `key` is the tag's name.
const ID_KEYS = new Set(["key", "parentKey", "attachmentKey", "topKey"]);
const ZOTERO_KEY = /^[A-Z0-9]{8}$/;
// `field` names a facet (/facets' answer), but a rank's `field` is a journal's subject area.
const FACET_FIELDS = new Set(["tag", "year", "creator", "collection", "publication", "itemType", "type", "status", "has"]);
const DATE_KEYS = new Set(["dateAdded", "dateModified", "date", "lastSync"]);
const EXACT_LENGTH = new Set(["title", "name", "key", "query"]); // what titleRanges index; a tag row's key is its name
// A journal's rank, the same for every paper: kept in shape so the rank pills still render.
const RANK = { ajg: "3", abdc: "A", field: "", ft50: false, utd24: false };
const HTML = /<\/?[a-z][^<>]*>/i;
const TAGS = new Set(["p", "div", "span", "b", "strong", "i", "em", "u", "sup", "sub", "br", "a", "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code", "hr", "table", "tr", "td", "th", "tbody", "thead"]);
const ENTITIES = new Set(["&amp;", "&lt;", "&gt;", "&quot;", "&#39;", "&nbsp;"]);

function stream(secret, text) {
  let block = createHmac("sha256", secret).update(text).digest();
  let i = 0;
  return () => {
    if (i === block.length) { block = createHmac("sha256", secret).update(block).digest(); i = 0; }
    return block[i++];
  };
}

// One string's fake: `length` UTF-16 code units (the original's by default) with its line
// breaks; everything else lowercase letters and spaces from the keyed stream.
export function fake(text, secret = SECRET, length = text.length) {
  const next = stream(secret, text);
  let out = "";
  for (let i = 0; i < length; i++) {
    if (text[i] === "\n") out += "\n";
    else { const b = next(); out += b % 6 === 0 ? " " : String.fromCharCode(97 + (b % 26)); }
  }
  return out;
}

const padded = (n) => Math.ceil(n / 8) * 8; // "" stays empty

// HTML's allowed tag names, bare; the rest is text.
function fakeHtml(html) {
  return html.split(/(<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^<>]*)?\/?>|&[a-zA-Z#0-9]+;)/).map((part, i) => {
    if (i % 2 === 0) return part ? fake(part) : "";
    if (ENTITIES.has(part)) return part;
    const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(part);
    if (tag && TAGS.has(tag[2].toLowerCase())) return `<${tag[1]}${tag[2].toLowerCase()}>`;
    return fake(part);
  }).join("");
}

// A date's year, in the shape it came in; nothing after it (Zotero's "2019-05-00 May 2019" keeps
// the text you typed after the date: dropped).
function yearOnly(s) {
  const y = /^\d{4}/.exec(s);
  if (!y) return fake(s, SECRET, padded(s.length));
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return `${y[0]}-01-01 00:00:00`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return `${y[0]}-01-01 ${y[0]}`;
  return y[0];
}

function scrubString(s, key) {
  if (HTML.test(s)) return fakeHtml(s);
  return fake(s, SECRET, EXACT_LENGTH.has(key) ? s.length : padded(s.length));
}

// A string under `key` kept as it is.
function safe(key, s) {
  if (ID_KEYS.has(key)) return ZOTERO_KEY.test(s);
  if (key === "field") return FACET_FIELDS.has(s);
  const shape = SAFE_KEYS.get(key);
  return !!shape && shape.test(s);
}

// The whole answer, scrubbed. `key`: the name the value sits under (an array inherits its parent's).
export function scrub(value, key = "") {
  if (key === "rank" && value && typeof value === "object" && !Array.isArray(value)) return { ...RANK };
  if (typeof value === "string") {
    if (safe(key, value)) return value;
    return DATE_KEYS.has(key) ? yearOnly(value) : scrubString(value, key);
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v, key));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v, k);
    return out;
  }
  return value;
}

function strings(value, key, out, keepSafe) {
  if (typeof value === "string") { if (!(keepSafe && safe(key, value))) out.push(value); } // dates too: their text must be gone
  else if (Array.isArray(value)) value.forEach((v) => strings(v, key, out, keepSafe));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) strings(v, k, out, keepSafe);
  return out;
}

const words = (s) => s.toLowerCase().match(/\p{L}{6,}/gu) || [];

// What a fixture would leak: the original values (longer than 3 characters, with a letter or
// digit, not under a safe key) that appear in the scrubbed answer, its object keys that aren't
// plain identifiers, and its words of 6 letters or more that survive as words. Empty means safe.
export function leaks(original, scrubbed) {
  const kept = strings(scrubbed, "", [], false);
  const keptWords = new Set(strings(scrubbed, "", [], true).flatMap(words)); // in what was scrubbed
  const found = new Set();
  const keys = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); }
  };
  walk(original);
  for (const k of keys) if (!/^[A-Za-z][A-Za-z0-9]*$/.test(k)) found.add(k);
  for (const s of new Set(strings(original, "", [], true))) {
    if (s.length > 3 && /[\p{L}\p{N}]/u.test(s) && kept.some((k) => k.includes(s))) found.add(s);
    for (const w of words(s)) if (keptWords.has(w)) found.add(w);
  }
  return [...found];
}
