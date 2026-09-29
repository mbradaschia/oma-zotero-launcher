// Collections: the bridge's paths, order, subtrees and fuzzy search (zotero-bridge/lib/collections.js),
// and the launcher's rows and sections for them (lib/Views.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const V = require("../lib/Views.js");

const lib = (f) => fs.readFileSync(path.join(__dirname, "../zotero-bridge/lib", f), "utf8");
const ctx = vm.createContext({ console });
vm.runInContext(lib("search.js"), ctx);
vm.runInContext(lib("collections.js") + "\nthis.OmaCollections = OmaCollections;", ctx);
const C = ctx.OmaCollections;
const plain = (x) => JSON.parse(JSON.stringify(x));

const cols = [
  { id: 3, key: "CCCCCCCC", libraryID: 1, name: "Public SCM", parentID: 2 },
  { id: 1, key: "AAAAAAAA", libraryID: 1, name: "_Topics", parentID: null },
  { id: 2, key: "BBBBBBBB", libraryID: 1, name: "SCM", parentID: 1 },
  { id: 4, key: "DDDDDDDD", libraryID: 1, name: "Power", parentID: 2 },
  { id: 5, key: "EEEEEEEE", libraryID: 2, name: "Shared", parentID: null },
];
const entries = C.build(cols, new Map([[1, "My Library"], [2, "Lab group"]]));

test("build: full paths, parents before children, siblings by name, per library", () => {
  assert.deepEqual(entries.map((e) => e.title), ["_Topics", "_Topics / SCM", "_Topics / SCM / Power", "_Topics / SCM / Public SCM", "Shared"]);
  const pub = entries.find((e) => e.key === "CCCCCCCC");
  assert.deepEqual([pub.name, pub.parentPath, pub.depth, pub.library], ["Public SCM", "_Topics / SCM", 2, "My Library"]);
  // a parent loop can't hang it
  assert.equal(C.build([{ id: 1, key: "X", libraryID: 1, name: "a", parentID: 2 }, { id: 2, key: "Y", libraryID: 1, name: "b", parentID: 1 }]).length, 2);
});

test("subtreeIDs: a collection and every descendant", () => {
  const scm = entries.find((e) => e.key === "BBBBBBBB");
  assert.deepEqual(Array.from(C.subtreeIDs(scm, entries)).sort(), [2, 3, 4]);
  assert.deepEqual(Array.from(C.subtreeIDs(entries.find((e) => e.key === "CCCCCCCC"), entries)), [3]);
});

test("search: fuzzy on the full path; inside a scope only its descendants", () => {
  C._entries = entries;
  const q = (s) => ctx.OmaSearch.parseQuery(s);
  const titles = (rows) => plain(rows).map((r) => r.title);
  assert.deepEqual(titles(C.search(q("public"), null)), ["_Topics / SCM / Public SCM"]);
  assert.ok(titles(C.search(q("scm"), null)).includes("_Topics / SCM"));
  const scm = entries.find((e) => e.key === "BBBBBBBB");
  assert.deepEqual(titles(C.search(q("scm"), scm)).sort(), ["_Topics / SCM / Power", "_Topics / SCM / Public SCM"]); // not SCM itself
  assert.deepEqual(titles(C.children(scm)), ["_Topics / SCM / Power", "_Topics / SCM / Public SCM"]);
  const row = plain(C.search(q("publ"), null))[0];
  assert.deepEqual([row.kind, row.key, row.name, row.parentPath], ["collection", "CCCCCCCC", "Public SCM", "_Topics / SCM"]);
  assert.ok(row.titleRanges.length > 0);
  // author, year and tag terms don't match collections
  assert.deepEqual(titles(C.search(q("a:scm"), null)), []);
  assert.deepEqual(titles(C.search(q("#scm"), null)), []);
  C._entries = null;
});

test("rows: a Collections section above the papers, subcollections in a scope, collection rows", () => {
  const col = { kind: "collection", key: "CCCCCCCC", libraryID: 1, title: "_Topics / SCM / Public SCM", library: "My Library", titleRanges: [[10, 13]] };
  const item = { key: "IIIIIIII", libraryID: 1, title: "Paper", itemType: "journalArticle" };
  const typed = V.buildRows({ query: "scm", collections: [col], results: [item] }, "#fff");
  assert.deepEqual(typed.map((r) => [r.section, r.kind]), [["Collections", "collection"], ["Papers", "item"]]);
  assert.equal(typed[0].title, "_Topics / SCM / Public SCM");
  assert.match(typed[0].titleHtml, /<font color="#fff"><b>SCM<\/b><\/font>|<b>SCM<\/b>/);
  assert.equal(typed[0].subtitle, "Collection · Enter: its papers");
  assert.equal(Object.keys(typed[0]).sort().join(), Object.keys(typed[1]).sort().join()); // one ListModel
  // no collections → papers without a heading, as before
  assert.deepEqual(V.buildRows({ query: "x", collections: [], results: [item] }, "#fff").map((r) => r.section), [""]);
  // inside a collection
  const scoped = { query: "", scope: { key: "BBBBBBBB", libraryID: 1, title: "_Topics / SCM" }, collections: [col], results: [item], total: 1 };
  assert.deepEqual(V.buildRows(scoped, "#fff").map((r) => r.section), ["Subcollections", "Papers"]);
  assert.equal(V.countText(scoped, 0), "1 paper");
  assert.equal(V.countText(Object.assign({}, scoped, { query: "x", total: 0 }), 0), "no matches");
  // pinned collections sit with pinned papers
  const empty = V.buildRows({ query: "", pinned: [col, item], open: [], recent: [] }, "#fff");
  assert.deepEqual(empty.map((r) => [r.section, r.kind]), [["Pinned", "collection"], ["Pinned", "item"]]);
});

test("pins: a collection and a paper with the same key are different pins", () => {
  let pins = V.togglePin([], { key: "AAAAAAAA", libraryID: 1, title: "SCM", type: "collection" });
  assert.equal(V.isPinned(pins, { key: "AAAAAAAA", libraryID: 1, type: "collection" }), true);
  assert.equal(V.isPinned(pins, { key: "AAAAAAAA", libraryID: 1 }), false);
  pins = V.togglePin(pins, { key: "AAAAAAAA", libraryID: 1, title: "Paper" });
  assert.deepEqual(pins.map((p) => p.type), ["collection", "item"]);
  assert.deepEqual(V.togglePin(pins, { key: "AAAAAAAA", libraryID: 1, type: "collection" }).map((p) => p.type), ["item"]);
  assert.equal(V.parsePins('{"pins":[{"key":"AAAAAAAA","type":"collection"}]}')[0].type, "collection");
});
