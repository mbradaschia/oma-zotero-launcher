// Grouping and sorting the results' papers (lib/Views.js groupRows; g / G in the launcher).
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../lib/Views.js");
const T = require("../lib/Todos.js");

const raw = [
  { key: "AAAA0001", libraryID: 1, title: "A", status: "s/reading", year: 2003, dateAdded: "2026-09-01 10:00:00", dateModified: "2026-10-02 09:00:00" },
  { key: "AAAA0002", libraryID: 1, title: "B", status: "", year: 2020, dateAdded: "2026-10-01 10:00:00", dateModified: "2026-10-01 10:00:00" },
  { key: "AAAA0003", libraryID: 1, title: "C", status: "s/to read", year: null, dateAdded: "2025-05-01 10:00:00", dateModified: "2026-09-15 10:00:00" },
  { key: "AAAA0004", libraryID: 1, title: "D", status: "s/reading", year: 1999, dateAdded: "2026-10-02 10:00:00", dateModified: "2026-10-02 10:00:00" },
];
const resp = { query: "x", collections: [{ kind: "collection", key: "COLL0001", title: "Topics" }], results: raw, total: 4 };
const rows = () => V.buildRows(resp, "#fff", { statuses: ["s/to read", "s/reading", "s/read"], noCommands: true });
const statuses = T.statusesOf(null);
const info = { results: raw, statuses: ["s/to read", "s/reading", "s/read"], taskStatuses: statuses, groups: T.GROUPS,
  tasks: { "1:AAAA0002": statuses.find((s) => s.id === "reading"), "1:AAAA0004": statuses.find((s) => s.id === "to_read"), "1:AAAA0001": statuses.find((s) => s.id === "done") } };
const shape = (list) => list.map((r) => [r.section, r.title]);

test("relevance (the default): as the bridge ranked them", () => {
  assert.deepEqual(V.groupRows(rows(), "relevance", info), rows());
  assert.deepEqual(V.groupRows(rows(), "", info), rows());
});

test("by paper status: your statuses in order, no status last; relevance within each; collections stay on top", () => {
  assert.deepEqual(shape(V.groupRows(rows(), "status", info)), [
    ["Collections", "Topics"], ["Status · to read", "C"], ["Status · reading", "A"], ["Status · reading", "D"], ["No status", "B"]]);
});

test("by task status (a paper's default task) or by task group; papers without tasks last", () => {
  assert.deepEqual(shape(V.groupRows(rows(), "task", info)).slice(1), [["Task · To read", "D"], ["Task · Reading", "B"], ["Task · Done", "A"], ["No task", "C"]]);
  assert.deepEqual(shape(V.groupRows(rows(), "taskgroup", info)).slice(1), [["Backlog", "D"], ["Active", "B"], ["Completed", "A"], ["No task", "C"]]);
});

test("by date added, changed or published: newest first, a heading per month (or year); none last", () => {
  assert.deepEqual(shape(V.groupRows(rows(), "added", info)).slice(1), [["October 2026", "D"], ["October 2026", "B"], ["September 2026", "A"], ["May 2025", "C"]]);
  assert.deepEqual(shape(V.groupRows(rows(), "modified", info)).slice(1), [["October 2026", "D"], ["October 2026", "A"], ["October 2026", "B"], ["September 2026", "C"]]);
  assert.deepEqual(shape(V.groupRows(rows(), "year", info)).slice(1), [["2020", "B"], ["2003", "A"], ["1999", "D"], ["No year", "C"]]);
});

test("pinned papers (in a saved search) stay first; g cycles the modes round; their names", () => {
  const withPinned = V.pinnedFirst(rows(), { "item:1:AAAA0003": true });
  assert.deepEqual(shape(V.groupRows(withPinned, "year", info)).slice(0, 2), [["Pinned", "C"], ["Collections", "Topics"]]);
  assert.equal(V.nextGrouping("relevance", 1), "status");
  assert.equal(V.nextGrouping("year", 1), "relevance");
  assert.equal(V.nextGrouping("relevance", -1), "year");
  assert.equal(V.nextGrouping("nonsense", 1), "status");
  assert.equal(V.groupingName("added"), "newest added");
  assert.equal(V.groupingName("relevance"), "");
  assert.equal(V.monthOf("2026-10-03 12:00:00"), "October 2026");
});
