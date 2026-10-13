// Copied for the Mac app (macos/VENDORED.md): its tests of the launcher's view logic; the bridge's
// tests stay with the bridge.
// and the launcher's rows and sections for them (lib/Views.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const V = require("../lib/Views.js");

const plain = (x) => JSON.parse(JSON.stringify(x));

const cols = [
  { id: 3, key: "CCCCCCCC", libraryID: 1, name: "Public SCM", parentID: 2 },
  { id: 1, key: "AAAAAAAA", libraryID: 1, name: "_Topics", parentID: null },
  { id: 2, key: "BBBBBBBB", libraryID: 1, name: "SCM", parentID: 1 },
  { id: 4, key: "DDDDDDDD", libraryID: 1, name: "Power", parentID: 2 },
  { id: 5, key: "EEEEEEEE", libraryID: 2, name: "Shared", parentID: null },
];

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

test("tags in the launcher: a Tags section after collections; Enter lists the papers; pins", () => {
  const rows = V.buildRows({ query: "resil", collections: [{ kind: "collection", key: "AAAAAAAA", libraryID: 1, title: "_Topics" }],
    tags: [{ kind: "tag", key: "resilience", libraryID: 1, title: "resilience", count: 12, titleRanges: [[0, 5]] }],
    results: [{ kind: "item", key: "KKKKKKKK", libraryID: 1, title: "A paper", itemType: "journalArticle" }] }, "#f00");
  assert.deepEqual(rows.map((r) => [r.section, r.kind]), [["Collections", "collection"], ["Tags", "tag"], ["Papers", "item"]]);
  assert.deepEqual([rows[1].key, rows[1].subtitle, rows[1].titleHtml], ["resilience", "Tag · 12 papers · Enter: its papers", '<font color="#f00"><b>resil</b></font>ience']);
  // inside a tag: its papers, under Papers
  const inside = V.buildRows({ query: "", scope: { kind: "tag", key: "resilience", libraryID: 1, title: "resilience", itemCount: 1 }, collections: [], tags: [],
    results: [{ kind: "item", key: "KKKKKKKK", libraryID: 1, title: "A paper", itemType: "journalArticle" }], total: 1 }, "#f00");
  assert.deepEqual(inside.map((r) => [r.section, r.kind]), [["Papers", "item"]]);
  // pinned tags: kept by name, apart from an item with the same key
  let pins = V.togglePin([], { key: "resilience", libraryID: 1, title: "resilience", type: "tag" });
  assert.deepEqual(pins, [{ key: "resilience", libraryID: 1, title: "resilience", type: "tag" }]);
  assert.ok(V.isPinned(pins, { key: "resilience", libraryID: 1, type: "tag" }));
  assert.ok(!V.isPinned(pins, { key: "resilience", libraryID: 1, type: "collection" }));
  assert.deepEqual(V.parsePins(JSON.stringify({ pins: pins.concat([{ key: "", type: "tag" }, { key: "x", type: "item" }]) })), pins);
  // Shift+↑/↓: a pin moves to its neighbour's place
  const three = [{ key: "AAAAAAAA", libraryID: 1, title: "a", type: "item" }].concat(pins, [{ key: "CCCCCCCC", libraryID: 1, title: "c", type: "collection" }]);
  assert.deepEqual(V.movePin(three, { key: "resilience", libraryID: 1, type: "tag" }, { key: "AAAAAAAA", libraryID: 1 }).map((p) => p.key), ["resilience", "AAAAAAAA", "CCCCCCCC"]);
  assert.deepEqual(V.movePin(three, { key: "resilience", libraryID: 1, type: "tag" }, { key: "CCCCCCCC", libraryID: 1, type: "collection" }).map((p) => p.key), ["AAAAAAAA", "CCCCCCCC", "resilience"]);
  assert.deepEqual(V.movePin(three, { key: "gone", libraryID: 1, type: "tag" }, { key: "AAAAAAAA", libraryID: 1 }), three); // not pinned: unchanged
  pins = V.togglePin(pins, { key: "resilience", libraryID: 1, type: "tag" });
  assert.deepEqual(pins, []);
  // the Pinned section shows a pinned tag as a tag row
  const pinned = V.buildRows({ query: "", pinned: [{ kind: "tag", key: "resilience", libraryID: 1, title: "resilience", count: 3 }], open: [], recent: [] }, "#f00");
  assert.deepEqual(pinned.map((r) => [r.section, r.kind, r.icon === V.ICONS.journalArticle]), [["Pinned", "tag", false]]);
});
