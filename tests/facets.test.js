// The @ picker's values (zotero-bridge/lib/facets.js), c: terms resolved to a collection's papers
// (collections.js), and the words of a boolean query that name tags (tags.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const lib = (f) => fs.readFileSync(path.join(__dirname, "../zotero-bridge/lib", f), "utf8");
const plain = (x) => JSON.parse(JSON.stringify(x));

const S = require("../zotero-bridge/lib/search.js");
global.OmaSearch = S; // facets.js matches with it, as in the bridge's shared scope
const F = require("../zotero-bridge/lib/facets.js");

const entry = (id, o) => S.prepareEntry(Object.assign({ id, key: "K" + id, title: "Paper " + id, creators: [], tags: [], year: null, publication: "", itemType: "journalArticle", pdfCount: 0, noteCount: 0, attachmentCount: 0 }, o));
const ENTRIES = [
  entry(1, { creators: ["Smith, John", "Doe, Jane"], tags: ["risk", "supply chain"], year: 2020, publication: "JOM", pdfCount: 1 }),
  entry(2, { creators: ["Smith, John"], tags: ["risk"], year: 2021, publication: "JOM", noteCount: 1, itemType: "book" }),
  entry(3, { creators: ["Roe, Ann"], tags: ['say "hi"'], year: 2021, publication: "", attachmentCount: 1 }),
];

test("values: counts, most used first, and the term that picks each", () => {
  const tags = F.values(ENTRIES, "tag");
  assert.deepEqual(tags.map((v) => [v.value, v.count, v.token]), [["risk", 2, '#"risk"'], ['say "hi"', 1, '#"say hi"'], ["supply chain", 1, '#"supply chain"']]);
  assert.deepEqual(F.values(ENTRIES, "author").map((v) => [v.value, v.count]), [["Smith, John", 2], ["Doe, Jane", 1], ["Roe, Ann", 1]]);
  assert.equal(F.values(ENTRIES, "author")[0].token, 'a:"Smith, John"');
  assert.deepEqual(F.values(ENTRIES, "publication").map((v) => [v.value, v.count, v.token]), [["JOM", 2, 'p:"JOM"']]); // no empty publication
  assert.deepEqual(F.values(ENTRIES, "year").map((v) => [v.value, v.count, v.token]), [["2021", 2, "y:2021"], ["2020", 1, "y:2020"]]);
  const types = F.values(ENTRIES, "type", { typeLabel: (t) => ({ book: "Book", journalArticle: "Journal Article" })[t] });
  assert.deepEqual(types.map((v) => [v.label, v.count, v.token]), [["Journal Article", 2, 'type:"journalArticle"'], ["Book", 1, 'type:"book"']]);
  assert.deepEqual(F.values(ENTRIES, "has").map((v) => [v.token, v.count]), [["has:pdf", 1], ["has:notes", 1], ["has:files", 2]]);
  assert.deepEqual(F.values(ENTRIES, "nope"), []);
});

test("values: each picked term finds the papers its count promised", () => {
  for (const field of ["tag", "author", "publication", "year", "type", "has"]) {
    for (const v of F.values(ENTRIES, field)) {
      if (v.token.includes('"hi"') || v.value.includes('"')) continue; // quotes inside a name can't be written
      assert.equal(S.search(ENTRIES, v.token).total, v.count, `${field}: ${v.token}`);
    }
  }
});

test("match: what is typed, in the bridge: fuzzy on the label, the most used first on ties, highlighted", () => {
  const authors = F.prepare(F.values([
    entry(1, { creators: ["Geels, Frank W.", "Müller, Jörg"] }),
    entry(2, { creators: ["Geels, Frank W."] }),
    entry(3, { creators: ["Geels, F. W.", "Smith, John"] }),
    entry(4, { creators: ["Agee, Ann"] }),
  ], "author"));
  const m = (q, limit = 10) => F.match(authors, q, limit);
  // nothing typed: every value, most used first, up to the limit
  assert.deepEqual([m("").total, m("", 2).values.map((v) => v.label)], [5, ["Geels, Frank W.", "Agee, Ann"]]);
  // equal matches: the one with more papers first, whatever the length of its name
  assert.deepEqual(m("gee").values.map((v) => v.label).slice(0, 2), ["Geels, Frank W.", "Geels, F. W."]);
  assert.deepEqual(m("geels fr").values.map((v) => v.label), ["Geels, Frank W."]); // every word
  assert.deepEqual(m("muller").values.map((v) => v.label), ["Müller, Jörg"]); // accents
  assert.deepEqual(m("2020").values, []); // a year is text here, not a year filter
  const [hit] = m("smith").values;
  assert.deepEqual([hit.token, hit.count, hit.titleRanges], ['a:"Smith, John"', 1, [[0, 5]]]);
  assert.equal(m("zzz").total, 0);
});

test("collections: their paths in tree order, papers counted with subcollections", () => {
  const ctx = vm.createContext({ console });
  vm.runInContext(lib("search.js"), ctx);
  vm.runInContext(lib("collections.js") + "\nthis.OmaCollections = OmaCollections;", ctx);
  const cols = ctx.OmaCollections.build([
    { id: 1, key: "AAAAAAAA", libraryID: 1, name: "Topics", parentID: null },
    { id: 2, key: "BBBBBBBB", libraryID: 1, name: "SCM", parentID: 1 },
    { id: 3, key: "CCCCCCCC", libraryID: 2, name: "Shared", parentID: null },
  ], new Map([[1, "My Library"], [2, "Lab"]]));
  const values = F.values([], "collection", { collections: cols, collectionCounts: new Map([[1, 5], [2, 3]]) });
  assert.deepEqual(plain(values).map((v) => [v.label, v.count, v.token, v.detail]), [
    ["Topics", 5, 'c:"Topics"', ""],
    ["Topics / SCM", 3, 'c:"Topics / SCM"', ""],
    ["Shared", 0, 'c:"Shared"', "Lab"], // other libraries after yours
  ]);
});

test("resolveTerms: a c: term → the papers of every collection it matches, subcollections included", async () => {
  const children = { 1: [10, 11], 2: [12], 3: [13] };
  const ctx = vm.createContext({
    console,
    Zotero: { Collections: { get: (id) => ({ id, getChildItems: () => children[id] || [] }), loadDataTypes: async () => {} } },
  });
  vm.runInContext(lib("search.js"), ctx);
  vm.runInContext(lib("collections.js") + "\nthis.OmaCollections = OmaCollections;", ctx);
  const C = ctx.OmaCollections;
  C._entries = C.build([
    { id: 1, key: "AAAAAAAA", libraryID: 1, name: "Topics", parentID: null },
    { id: 2, key: "BBBBBBBB", libraryID: 1, name: "SCM", parentID: 1 },
    { id: 3, key: "CCCCCCCC", libraryID: 1, name: "Methods", parentID: null },
  ]);
  const ids = async (q) => {
    const parsed = await C.resolveTerms(ctx.OmaSearch.parseQuery(q));
    return ctx.OmaSearch.terms(parsed).filter((t) => t.field === "collection").map((t) => Array.from(t.ids).sort());
  };
  assert.deepEqual(plain(await ids('c:"Topics"')), [[10, 11, 12]]); // with SCM's paper
  assert.deepEqual(plain(await ids('c:"SCM"')), [[12]]); // by its name
  assert.deepEqual(plain(await ids("c:scm OR c:meth")), [[12], [13]]);
  assert.deepEqual(plain(await ids("c:nothing")), [[]]);
});

test("tagWords: only the words that could name a tag", () => {
  const ctx = vm.createContext({});
  vm.runInContext(lib("tags.js") + "\nthis.OmaTags = OmaTags;", ctx);
  const w = (q) => ctx.OmaTags.tagWords(q).split(/\s+/).filter(Boolean);
  assert.deepEqual(w("#risk supply"), ["risk", "supply"]);
  assert.deepEqual(w('tag:"supply chain" OR #risk'), ["supply", "chain", "risk"]);
  assert.deepEqual(w('a:"Smith, John" c:"A / B" y:2020 !x !"y z" NOT old NOT (a b) keep'), ["keep"]);
  assert.deepEqual(w("(risk | resilience)"), ["risk", "resilience"]);
});
