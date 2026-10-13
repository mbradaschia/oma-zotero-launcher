// scripts/scrub.mjs: what makes a captured bridge answer safe to commit. Every string is replaced by
// a keyed fake (a title's exact length, other strings padded), unless its key is on the safe list;
// dates keep their year, ranks become one fixed value; the result must hold none of the original.
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
  assert.equal(a.creator.length, 16); // padded to a multiple of 8
  assert.notEqual(a.creator, fake("Teece et al.", createHash("sha256").update("Teece et al.").digest(), 16));
});

test("ranges still slice the title: same length, positions unchanged", async () => {
  const { scrub } = await load();
  const out = scrub({ title: "Dynamic capabilities", titleRanges: [[0, 3]] });
  assert.deepEqual(out.titleRanges, [[0, 3]]);
  assert.equal(out.title.slice(0, 3).length, 3);
});

test("safe keys, numbers and booleans are kept", async () => {
  const { scrub } = await load();
  const v = { key: "ABCD1234", libraryID: 1, itemType: "journalArticle", ok: true, year: 1997, contentType: "application/pdf", title: "x y" };
  const out = scrub(v);
  for (const k of ["key", "libraryID", "itemType", "ok", "year", "contentType"]) assert.deepEqual(out[k], v[k], k);
});

test("HTML keeps its known tag names only, bare; its text is scrubbed", async () => {
  const { scrub } = await load();
  const html = '<p class="x">Supply chains &amp; <a href="https://doi.org/10.1/abc">resilience</a></p>';
  const out = scrub({ html }).html;
  assert.match(out, /^<p>[a-z ]{14}&amp;[a-z ]<a>[a-z ]{10}<\/a><\/p>$/);
  assert.ok(!out.includes("Supply") && !out.includes("doi.org") && !out.includes("resilience"));
});

test("HTML's odd corners don't survive: stray <, comments, unquoted and > in attributes", async () => {
  const { scrub, leaks } = await load();
  const cases = [
    "<i>Effects</i> where p<0.05 and Treatment>baseline",
    "<!-- reviewer comment: Hollenbeck -->text <b>bold</b>",
    "<a href=https://example.org/Mintzberg>link</a>",
    '<span title="Ansoff > Porter">matrix</span>',
    "<custom data-x=\"Penrose\">growth</custom>",
  ];
  for (const html of cases) {
    const out = scrub({ note: html }).note;
    for (const w of ["Effects", "Treatment", "baseline", "Hollenbeck", "reviewer", "Mintzberg", "example", "Ansoff", "Porter", "Penrose", "matrix", "growth"]) {
      assert.ok(!out.toLowerCase().includes(w.toLowerCase()), `${w} in ${out}`);
    }
    assert.deepEqual(leaks({ note: html }, { note: out }), []);
  }
});

test("dates keep their year; a journal's rank and its subject area become one fixed value", async () => {
  const { scrub } = await load();
  const out = scrub({ dateAdded: "2024-03-05 10:11:12", date: "1997-08-00 1997", rank: { ajg: "4*", abdc: "A*", field: "ENT-SBM", ft50: true, utd24: true } });
  assert.equal(out.dateAdded, "2024-01-01 00:00:00");
  assert.equal(out.date, "1997-01-01 1997");
  assert.equal(scrub({ date: "2019 (forthcoming in Organization Science)" }).date, "2019");
  assert.equal(scrub({ date: "2019-05-00 May 2019, Academy meeting" }).date, "2019-01-01 2019");
  assert.deepEqual(out.rank, { ajg: "3", abdc: "A", field: "", ft50: false, utd24: false });
  assert.deepEqual(scrub({ rank: { ajg: 4 } }).rank, scrub({ rank: { ajg: 2, field: "STRAT" } }).rank);
});

test("field is kept only when it names a facet", async () => {
  const { scrub } = await load();
  assert.equal(scrub({ field: "tag" }).field, "tag");
  assert.equal(scrub({ field: "year" }).field, "year");
  assert.notEqual(scrub({ field: "ETHICS-CSR-MAN" }).field, "ETHICS-CSR-MAN");
});

test("lengths: a title or name exact, everything else padded to a multiple of 8", async () => {
  const { scrub } = await load();
  const out = scrub({ title: "abc", name: "abcdefghi", creator: "Teece", publication: "Strategic Management Journal", tags: ["x"] });
  assert.equal(out.title.length, 3);
  assert.equal(out.name.length, 9);
  assert.equal(out.creator.length, 8);
  assert.equal(out.publication.length, 32);
  assert.equal(out.tags[0].length, 8);
  assert.equal(scrub({ publication: "", query: "" }).publication, ""); // empty stays empty
  assert.equal(scrub({ query: "" }).query, "");
});

test("leaks also names surviving words and keys that aren't identifiers", async () => {
  const { leaks } = await load();
  assert.deepEqual(leaks({ title: "Absorptive capacity" }, { title: "qq absorptive" }), ["absorptive"]);
  assert.deepEqual(leaks({ counts: { "supply chain": 3 } }, { counts: { "supply chain": 3 } }), ["supply chain"]);
  assert.deepEqual(leaks({ title: "Absorptive capacity" }, { title: "qq absorpt" }), []);
});

test("leaks: none after scrubbing; every surviving original named", async () => {
  const { scrub, leaks } = await load();
  const original = { results: [{ title: "Dynamic capabilities", creator: "Teece", tags: ["supply chain"], key: "ABCD1234" }] };
  assert.deepEqual(leaks(original, scrub(original)), []);
  assert.deepEqual(leaks(original, original).sort(), ["Dynamic capabilities", "Teece", "capabilities", "dynamic", "supply", "supply chain"].sort());
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

test("a safe key keeps only a value of its shape: anything else there is scrubbed", async () => {
  const { scrub, leaks } = await load();
  const original = { status: "PhD chapter two", itemType: "journal Article by Teece", kind: "item", contentType: "application/pdf",
    action: "open-reader", zoteroVersion: "7.0.11", version: "Hollenbeck notes", count: "12", libraryID: "1 Strategy" };
  const out = scrub(original);
  assert.notEqual(out.status, original.status);
  assert.notEqual(out.itemType, original.itemType);
  assert.notEqual(out.version, original.version);
  assert.notEqual(out.libraryID, original.libraryID);
  for (const k of ["kind", "contentType", "action", "zoteroVersion", "count"]) assert.equal(out[k], original[k], k);
  assert.deepEqual(leaks(original, out), []);
});

test("a date's text after its year is checked by leaks, not trusted", async () => {
  const { leaks } = await load();
  assert.deepEqual(leaks({ date: "2019 Organization Science" }, { date: "2019 Organization Science" }).sort(), ["2019 Organization Science", "organization", "science"].sort());
});
