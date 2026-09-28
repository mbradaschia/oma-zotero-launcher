// Pure helpers of the Omarchy plugin (lib/Client.js, lib/Views.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../lib/Client.js");
const V = require("../lib/Views.js");

const TOKEN = "ab".repeat(32);

test("handshake: only a well-formed port + 64-hex token is accepted", () => {
  assert.deepEqual(C.parseHandshake(JSON.stringify({ port: 23119, token: TOKEN, bridgeVersion: "0.0.1" })), { port: 23119, token: TOKEN, bridgeVersion: "0.0.1", zoteroVersion: "" });
  assert.equal(C.parseHandshake(""), null);
  assert.equal(C.parseHandshake("{nope"), null);
  assert.equal(C.parseHandshake(JSON.stringify({ port: 23119, token: "short" })), null);
  assert.equal(C.parseHandshake(JSON.stringify({ port: 0, token: TOKEN })), null);
});

test("requests carry the headers Zotero requires", () => {
  const bridge = { port: 23119, token: TOKEN };
  assert.equal(C.baseUrl(bridge), "http://127.0.0.1:23119/oma-zotero");
  const h = Object.fromEntries(C.headers(bridge));
  assert.equal(h["Zotero-Allowed-Request"], "1");
  assert.equal(h.Authorization, `Bearer ${TOKEN}`);
  assert.equal(h["Content-Type"], "application/json");
});

test("classify: ok, down, missing bridge vs missing item, auth, errors, timeout", () => {
  assert.deepEqual(C.classify(200, '{"ok":true,"x":1}', false), { kind: "ok", data: { ok: true, x: 1 } });
  assert.equal(C.classify(0, "", false).kind, "zotero-down");
  assert.equal(C.classify(0, "", true).kind, "timeout");
  assert.equal(C.classify(404, "No endpoint found", false).kind, "bridge-missing"); // Zotero's plain 404
  const notFound = C.classify(404, '{"ok":false,"error":{"code":"not-found","message":"no item"}}', false);
  assert.deepEqual([notFound.kind, notFound.code, notFound.message], ["error", "not-found", "no item"]);
  assert.equal(C.classify(401, '{"ok":false,"error":{"code":"token"}}', false).kind, "unauthorized");
  const internal = C.classify(500, "boom", false);
  assert.deepEqual([internal.kind, internal.code], ["error", "http-500"]);
});

test("search queue: one in flight, only the newest pending query survives", () => {
  const q = C.newQueue();
  assert.equal(C.enqueue(q, ""), ""); // empty query is a real query
  assert.equal(C.enqueue(q, "p"), null);
  assert.equal(C.enqueue(q, "pi"), null);
  assert.equal(C.enqueue(q, "pim"), null);
  assert.equal(C.done(q), "pim"); // "p" and "pi" were superseded
  assert.equal(C.done(q), null);
  assert.equal(C.enqueue(q, "x"), "x"); // idle again → sent immediately
});

test("highlight: ranges become bold accent spans, everything is escaped", () => {
  assert.equal(V.highlight("Risk & <resilience>", [[8, 13]], "#f00"), 'Risk &amp; &lt;<font color="#f00"><b>resil</b></font>ience&gt;');
  assert.equal(V.highlight("abc", [], "#f00"), "abc");
  assert.equal(V.highlight("abcdef", [[4, 6], [0, 2], [1, 3]], "#0"), '<font color="#0"><b>ab</b></font><font color="#0"><b>c</b></font>d<font color="#0"><b>ef</b></font>');
  assert.equal(V.highlight("x", [[5, 9]], "#0"), "x"); // out-of-range ranges are ignored
});

test("rows: empty query → open then recent sections; results unsectioned", () => {
  const open = [{ key: "AAAAAAAA", libraryID: 1, itemType: "journalArticle", title: "T1", creator: "Pimm", year: 1984, open: { kind: "tab", selected: true }, pdfCount: 1, noteCount: 2, tags: ["a"] }];
  const recent = [{ key: "BBBBBBBB", libraryID: 1, itemType: "book", title: "", creator: "", year: null, publication: "Journal" }];
  const rows = V.buildRows({ query: "", open, recent }, "#f00");
  assert.deepEqual(rows.map((r) => [r.section, r.key, r.openState]), [["Open in Zotero", "AAAAAAAA", "current"], ["Recently added", "BBBBBBBB", ""]]);
  assert.equal(rows[0].subtitle, "Pimm · 1984");
  assert.equal(rows[1].title, "(untitled)");
  assert.equal(rows[1].subtitle, "Journal");
  assert.equal(rows[0].icon, V.ICONS.journalArticle);
  assert.equal(V.iconFor("somethingNew"), V.iconFor(undefined)); // default glyph
  const res = V.buildRows({ query: "pimm", results: [{ key: "CCCCCCCC", title: "The complexity", titleRanges: [[4, 14]], open: { selected: false } }] }, "#f00");
  assert.deepEqual(res.map((r) => [r.section, r.openState]), [["", "open"]]);
  assert.match(res[0].titleHtml, /<b>complexity<\/b>/);
  // every row has the same fields (ListModel roles are fixed by the first append)
  const shape = (r) => Object.keys(r).sort().join(",");
  assert.equal(shape(rows[0]), shape(res[0]));
});

test("count text and selection behaviour", () => {
  assert.equal(V.countText({ query: "", open: [1, 2] }, 2795), "2 open · 2,795 items");
  assert.equal(V.countText({ query: "", open: [1] }, 0), "1 open");
  assert.equal(V.countText({ query: "x", results: [], total: 0 }), "no matches");
  assert.equal(V.countText({ query: "x", results: [1, 2], total: 2 }), "2 matches");
  assert.equal(V.countText({ query: "x", results: new Array(60), total: 1102 }), "60 of 1,102");
  const rows = [{ key: "A" }, { key: "B" }, { key: "C" }];
  assert.equal(V.selectionAfter(rows, "B", false), 1); // cursor moved by the user: keep the item
  assert.equal(V.selectionAfter(rows, "B", true), 0); // typing: best match on top
  assert.equal(V.selectionAfter(rows, "Z", false), 0);
  assert.equal(V.selectionAfter([], "A", false), 0);
});
