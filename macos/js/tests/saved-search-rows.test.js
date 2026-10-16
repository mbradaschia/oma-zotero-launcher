// R6: the launcher's saved searches found from the results, by their name or their query (Views.savedSearchRows,
// through commandRows' extras.searches), under their own heading; Enter opens one (the app's).
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../lib/Views.js");

const searches = [
  { id: "s1", name: "Resilience reading", query: "resilience y:2015-2020", pinned: true },
  { id: "s2", name: "Methods", query: "t:method survey" },
  { id: "s3", name: "Unread", query: "-t:read" },
];
const found = (q, extras) => V.commandRows(q, Object.assign({ searches: searches }, extras)).filter((r) => r.kind === "saved-search");

test("a saved search is found by a word of its name, or of its query", () => {
  assert.deepEqual(found("resil").map((r) => r.title), ["Resilience reading"]);
  assert.deepEqual(found("survey").map((r) => r.title), ["Methods"]);
  assert.deepEqual(found("unread").map((r) => r.title), ["Unread"]);
  assert.deepEqual(found("nothing here"), []);
});

test("every word must match, its name first", () => {
  assert.deepEqual(found("methods survey").map((r) => r.title), ["Methods"]);
  assert.deepEqual(found("methods resilience"), []);
  const both = [{ id: "a", name: "Old", query: "methods" }, { id: "b", name: "Methods", query: "x" }];
  assert.deepEqual(V.commandRows("methods", { searches: both }).filter((r) => r.kind === "saved-search").map((r) => r.title), ["Methods", "Old"]);
});

test("its row: the heading, the query, pinned, a key Enter can find it by", () => {
  const r = found("resilience")[0];
  assert.equal(r.section, "Saved searches");
  assert.equal(r.key, "saved-search:s1");
  assert.equal(r.subtitle, "Saved search · resilience y:2015-2020 · pinned");
  assert.equal(found("unread")[0].subtitle, "Saved search · -t:read");
});

test("none without searches, nothing typed, or one-letter words; at most five", () => {
  assert.deepEqual(V.commandRows("methods", {}).filter((r) => r.kind === "saved-search"), []);
  assert.deepEqual(found(""), []);
  assert.deepEqual(found("m"), []);
  const many = Array.from({ length: 9 }, (_, i) => ({ id: "m" + i, name: "Methods " + i, query: "q" }));
  assert.equal(V.commandRows("methods", { searches: many }).filter((r) => r.kind === "saved-search").length, 5);
});

test("the saved searches come after Go to (one section) and above the papers; the cursor starts on the first paper", () => {
  const resp = { query: "methods", results: [{ key: "K1", libraryID: 1, title: "A paper", itemType: "journalArticle" }] };
  const index = [{ page: "general", pageTitle: "General", label: "Methods in results", detail: "", section: "Results", rowId: "set-toggle", value: "x" }];
  const rows = V.buildRows(resp, "#3584e4", { searches: searches, settingsIndex: index });
  const i = rows.findIndex((r) => r.kind === "saved-search");
  assert.ok(i > rows.findIndex((r) => r.kind === "setting"), "Go to's settings first: Go to isn't split");
  assert.ok(i >= 0 && i < rows.findIndex((r) => r.key === "K1"));
  assert.equal(rows[V.selectionAfter(rows, "", true)].key, "K1");
});

test("accents don't matter: etica finds Ética", () => {
  const list = [{ id: "e", name: "Ética e IA", query: "ética" }];
  assert.deepEqual(V.commandRows("etica", { searches: list }).filter((r) => r.kind === "saved-search").map((r) => r.title), ["Ética e IA"]);
  assert.deepEqual(V.commandRows("éti", { searches: list }).filter((r) => r.kind === "saved-search").length, 1);
});
