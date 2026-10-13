// scripts/scrub.mjs: what makes a captured bridge answer safe to commit. Every string is replaced by
// a fake of the same length and shape, unless its key is on the safe list; the result must hold
// none of the original values.
const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../scripts/scrub.mjs");

test("same length and line breaks; no word, capital or punctuation pattern of the original", async () => {
  const { scrub } = await load();
  const original = "Dynamic Capabilities: 2nd ed. (1997)\nLine two";
  const out = scrub({ title: original }).title;
  assert.equal(out.length, original.length);
  assert.equal(out.indexOf("\n"), original.indexOf("\n"));
  assert.match(out, /^[a-z ]+\n[a-z ]+$/);
  const shape = (t) => t.replace(/[a-z]/g, "a").replace(/[A-Z]/g, "A");
  assert.notEqual(shape(out), shape(original));
});

test("keyed by a secret: the same value scrubs the same way within a run, never computable from outside", async () => {
  const { scrub, fake } = await load();
  const a = scrub({ creator: "Teece et al.", x: [{ creator: "Teece et al." }] });
  assert.equal(a.creator, a.x[0].creator);
  assert.equal(scrub({ creator: "Teece et al." }).creator, a.creator);
  assert.notEqual(fake("Teece et al.", "secret one"), fake("Teece et al.", "secret two"));
  const { createHash } = require("node:crypto");
  assert.notEqual(a.creator, fake("Teece et al.", createHash("sha256").update("Teece et al.").digest()));
});

test("ranges still slice the title: same length, positions unchanged", async () => {
  const { scrub } = await load();
  const out = scrub({ title: "Dynamic capabilities", titleRanges: [[0, 3]] });
  assert.deepEqual(out.titleRanges, [[0, 3]]);
  assert.equal(out.title.slice(0, 3).length, 3);
});

test("safe keys, numbers and booleans are kept", async () => {
  const { scrub } = await load();
  const v = { key: "ABCD1234", libraryID: 1, itemType: "journalArticle", ok: true, year: 1997, dateAdded: "2024-01-02 03:04:05", contentType: "application/pdf", title: "x y" };
  const out = scrub(v);
  for (const k of ["key", "libraryID", "itemType", "ok", "year", "dateAdded", "contentType"]) assert.deepEqual(out[k], v[k], k);
});

test("HTML keeps its markup; its text and link targets are scrubbed", async () => {
  const { scrub } = await load();
  const html = '<p class="x">Supply chains &amp; <a href="https://doi.org/10.1/abc">resilience</a></p>';
  const out = scrub({ html }).html;
  assert.match(out, /^<p class="x">[a-z ]{14}&amp;[a-z ]<a href="[^"]+">[a-z ]{10}<\/a><\/p>$/);
  assert.ok(!out.includes("Supply") && !out.includes("doi.org") && !out.includes("resilience"));
});

test("leaks: none after scrubbing; every surviving original named", async () => {
  const { scrub, leaks } = await load();
  const original = { results: [{ title: "Dynamic capabilities", creator: "Teece", tags: ["supply chain"], key: "ABCD1234" }] };
  assert.deepEqual(leaks(original, scrub(original)), []);
  assert.deepEqual(leaks(original, original).sort(), ["Dynamic capabilities", "Teece", "supply chain"].sort());
});

test("an id key is kept only when it is a Zotero key: a tag row's key is the tag's name", async () => {
  const { scrub, leaks } = await load();
  const original = { results: [{ key: "ABCD1234", title: "x" }], tags: [{ kind: "tag", key: "supply chain resilience", name: "supply chain resilience", title: "supply chain resilience" }] };
  const out = scrub(original);
  assert.equal(out.results[0].key, "ABCD1234");
  assert.notEqual(out.tags[0].key, "supply chain resilience");
  assert.equal(out.tags[0].key, out.tags[0].name); // the same value, the same fake
  assert.deepEqual(leaks(original, out), []);
});
