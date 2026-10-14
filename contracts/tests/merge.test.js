// contracts/Merge.js: two machines' copies of a synced file put back together, the same bytes on
// either machine; a deletion on one doesn't come back from the other.
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../Merge.js");

const NOW = "2026-10-13T12:00:00.000Z";
const todos = (list, deleted) => JSON.stringify(deleted ? { todos: list, deleted } : { todos: list }, null, 2) + "\n";
const todo = (id, description, updated, extra) => Object.assign({ id, description, status: "next", updated }, extra || {});

test("conflict copies are recognised by name, Syncthing's and Dropbox's", () => {
  assert.deepEqual(M.conflictOf("todos.sync-conflict-20261013-101500-ABCDEFG.json"), { base: "todos.json", device: "ABCDEFG", tool: "syncthing" });
  assert.deepEqual(M.conflictOf("notes.sync-conflict-20261013-101500-ABC1234.md"), { base: "notes.md", device: "ABC1234", tool: "syncthing" });
  assert.deepEqual(M.conflictOf("todos (Mac's conflicted copy 2026-10-13).json"), { base: "todos.json", device: "Mac", tool: "dropbox" });
  assert.deepEqual(M.conflictOf("pins (arch's conflicted copy 2026-10-13 (1)).json"), { base: "pins.json", device: "arch", tool: "dropbox" });
  assert.equal(M.conflictOf("todos.json"), null);
  assert.equal(M.conflictOf("todos.sync-conflict-2026-ABC.json"), null);
});

test("kinds and the kept copy's name", () => {
  assert.equal(M.kindOf("todos.json"), "list");
  assert.equal(M.kindOf("shared/pins.json"), "list");
  assert.equal(M.kindOf("view.json"), "keyed");
  assert.equal(M.kindOf("settings.json"), "keyed");
  assert.equal(M.kindOf("prompts/summary.md"), "newer");
  assert.equal(M.keptName("summary.md", "my laptop"), "summary.conflict-my-laptop.md");
  assert.equal(M.keptName("README", "a"), "README.conflict-a");
});

test("stamp records a deletion, keeps the others, and leaves a file without deletions as it was", () => {
  const before = todos([todo("a", "A", "2026-10-01T00:00:00Z"), todo("b", "B", "2026-10-02T00:00:00Z")]);
  const after = todos([todo("a", "A", "2026-10-01T00:00:00Z")]);
  const out = JSON.parse(M.stamp("todos.json", before, after, NOW));
  assert.deepEqual(out.deleted, [{ id: "b", at: NOW }]);
  assert.equal(out.todos.length, 1);
  assert.equal(M.stamp("todos.json", before, before, NOW), before);
  // added again: its tombstone goes
  const back = JSON.parse(M.stamp("todos.json", M.stamp("todos.json", before, after, NOW), before, NOW));
  assert.equal(back.deleted, undefined);
});

test("stamp gives pins and searches an updated time when they change, and keeps it when not", () => {
  const before = JSON.stringify({ pins: [{ key: "ABCD1234", libraryID: 1, title: "a", type: "item", updated: "2026-01-01T00:00:00Z" }] });
  const same = JSON.parse(M.stamp("pins.json", before, JSON.stringify({ pins: [{ key: "ABCD1234", libraryID: 1, title: "a", type: "item" }] }), NOW));
  assert.equal(same.pins[0].updated, "2026-01-01T00:00:00Z");
  const added = JSON.parse(M.stamp("pins.json", before, JSON.stringify({ pins: [{ key: "ABCD1234", libraryID: 1, title: "a", type: "item" }, { key: "WXYZ9876", libraryID: 1, title: "b", type: "collection" }] }), NOW));
  assert.equal(added.pins[1].updated, NOW);
  const searches = JSON.parse(M.stamp("searches.json", JSON.stringify({ searches: [{ id: "s1", name: "x", query: "a" }] }), JSON.stringify({ searches: [{ id: "s1", name: "x", query: "b" }] }), NOW));
  assert.equal(searches.searches[0].updated, NOW);
});

test("stamp prunes tombstones after 30 days", () => {
  const old = todos([], [{ id: "gone", at: "2026-08-01T00:00:00Z" }, { id: "recent", at: "2026-10-01T00:00:00Z" }]);
  const out = JSON.parse(M.stamp("todos.json", old, todos([]), NOW));
  assert.deepEqual(out.deleted.map((t) => t.id), ["recent"]);
});

test("todos: by id, the newer updated wins; both sides' new ones are kept", () => {
  const mine = todos([todo("a", "A mine", "2026-10-05T00:00:00Z"), todo("m", "Mine only", "2026-10-04T00:00:00Z")]);
  const theirs = todos([todo("a", "A theirs", "2026-10-06T00:00:00Z"), todo("t", "Theirs only", "2026-10-03T00:00:00Z")]);
  const out = JSON.parse(M.merge("todos.json", mine, theirs, 0, 0, NOW).text);
  assert.deepEqual(out.todos.map((t) => t.description).sort(), ["A theirs", "Mine only", "Theirs only"]);
});

test("a task deleted on one machine and left alone on the other stays deleted; edited after: it stays", () => {
  const base = todo("x", "X", "2026-10-01T00:00:00Z");
  const deletedHere = todos([], [{ id: "x", at: "2026-10-05T00:00:00Z" }]);
  assert.deepEqual(JSON.parse(M.merge("todos.json", deletedHere, todos([base]), 0, 0, NOW).text).todos, []);
  const editedThere = todos([todo("x", "X edited", "2026-10-07T00:00:00Z")]);
  const out = JSON.parse(M.merge("todos.json", deletedHere, editedThere, 0, 0, NOW).text);
  assert.deepEqual(out.todos.map((t) => t.description), ["X edited"]);
  assert.equal(out.deleted, undefined);
});

test("the same bytes whichever copy is mine", () => {
  const a = todos([todo("a", "A", "2026-10-05T00:00:00Z"), todo("b", "B", "2026-10-01T00:00:00Z")], [{ id: "c", at: "2026-10-02T00:00:00Z" }]);
  const b = todos([todo("b", "B2", "2026-10-06T00:00:00Z"), todo("c", "C", "2026-10-01T00:00:00Z"), todo("d", "D", "2026-10-03T00:00:00Z")]);
  assert.equal(M.merge("todos.json", a, b, 1, 2, NOW).text, M.merge("todos.json", b, a, 2, 1, NOW).text);
  const v1 = JSON.stringify({ grouping: "year", menuPins: { actions: ["open"] }, noteFontSize: 14 });
  const v2 = JSON.stringify({ grouping: "status", menuPins: { notes: ["x"] }, sectionOrder: { actions: ["Notes"] } });
  assert.equal(M.merge("view.json", v1, v2, 10000, 20000, NOW).text, M.merge("view.json", v2, v1, 20000, 10000, NOW).text);
  assert.equal(M.merge("notes.md", "one", "two", 10000, 20000, NOW).text, M.merge("notes.md", "two", "one", 20000, 10000, NOW).text);
});

test("pins merge by type, library and key; a removed pin doesn't come back", () => {
  const here = JSON.stringify({ pins: [{ key: "ABCD1234", libraryID: 1, type: "item", updated: "2026-10-01T00:00:00Z" }], deleted: [{ id: "collection:1:WXYZ9876", at: "2026-10-05T00:00:00Z" }] });
  const there = JSON.stringify({ pins: [{ key: "WXYZ9876", libraryID: 1, type: "collection", updated: "2026-10-01T00:00:00Z" }, { key: "QQQQ1111", libraryID: 1, type: "item", updated: "2026-10-02T00:00:00Z" }] });
  const out = JSON.parse(M.merge("pins.json", here, there, 0, 0, NOW).text);
  assert.deepEqual(out.pins.map((p) => p.key).sort(), ["ABCD1234", "QQQQ1111"]);
  assert.deepEqual(out.deleted, [{ id: "collection:1:WXYZ9876", at: "2026-10-05T00:00:00Z" }]); // kept, for the next copy
});

test("view.json per key and per view inside it: the newer file wins what both changed", () => {
  const older = JSON.stringify({ grouping: "year", menuPins: { actions: ["open"], notes: ["n"] }, noteFontSize: 14 });
  const newer = JSON.stringify({ grouping: "status", menuPins: { actions: ["reveal"] }, sectionOrder: { actions: ["Notes"] } });
  const out = JSON.parse(M.merge("view.json", older, newer, 100000, 200000, NOW).text);
  assert.equal(out.grouping, "status");
  assert.deepEqual(out.menuPins, { actions: ["reveal"], notes: ["n"] });
  assert.equal(out.noteFontSize, 14);
  assert.deepEqual(out.sectionOrder, { actions: ["Notes"] });
});

test("anything else: the newer copy wins and the other is kept", () => {
  assert.deepEqual(M.merge("prompts/x.md", "old", "new", 1000, 2000, NOW), { text: "new", kept: "old", keptFrom: "a" });
  assert.deepEqual(M.merge("chats/1-ABCD1234/c.json", "{\"a\":2}", "{\"a\":1}", 5000, 2000, NOW), { text: "{\"a\":2}", kept: "{\"a\":1}", keptFrom: "b" });
});

test("a copy that isn't JSON doesn't wipe the other", () => {
  const good = todos([todo("a", "A", "2026-10-05T00:00:00Z")]);
  assert.deepEqual(JSON.parse(M.merge("todos.json", good, "{ half", 0, 0, NOW).text).todos.map((t) => t.id), ["a"]);
  assert.equal(JSON.parse(M.merge("view.json", "{\"grouping\":\"year\"}", "nope", 1000, 2000, NOW).text).grouping, "year");
});

test("keys that reach a prototype are never merged", () => {
  const out = M.merge("view.json", '{"__proto__": {"x": 1}, "a": 1}', '{"constructor": 2, "a": 1}', 1000, 2000, NOW).text;
  assert.equal(JSON.parse(out).a, 1);
  assert.ok(!out.includes("__proto__") && !out.includes("constructor"));
});

test("malformed lists and tombstones don't throw, and a record named like a prototype key is a record", () => {
  assert.doesNotThrow(() => M.merge("todos.json", '{"todos": {}}', '{"todos": [], "deleted": "x"}', 0, 0, NOW));
  assert.doesNotThrow(() => M.stamp("todos.json", '{"todos": {}, "deleted": 5}', todos([]), NOW));
  const out = JSON.parse(M.merge("todos.json", todos([todo("constructor", "C", "2026-10-05T00:00:00Z")]), todos([todo("toString", "T", "2026-10-05T00:00:00Z")]), 0, 0, NOW).text);
  assert.deepEqual(out.todos.map((t) => t.id).sort(), ["constructor", "toString"]);
  assert.equal(M.kindOf("constructor"), "newer");
});

test("nothing to merge: both copies unreadable, an empty copy; no file beside it: the copy is the file", () => {
  assert.equal(M.merge("todos.json", "{", "nope", 0, 0, NOW), null);
  assert.equal(M.merge("view.json", "{", "nope", 1000, 2000, NOW), null);
  assert.equal(M.merge("notes.md", "mine", "", 1000, 2000, NOW), null);
  assert.deepEqual(M.merge("notes.md", "", "theirs", 0, 2000, NOW), { text: "theirs" });
});

test("times count in whole seconds: the two launchers measure them differently", () => {
  assert.deepEqual(M.merge("notes.md", "a", "b", 5400, 5900, NOW), M.merge("notes.md", "a", "b", 5000, 5000, NOW));
});

test("a tombstone without a date is pruned", () => {
  const out = JSON.parse(M.stamp("todos.json", todos([], [{ id: "x" }]), todos([]), NOW));
  assert.equal(out.deleted, undefined);
});
