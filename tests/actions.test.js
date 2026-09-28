// OmaActions.plan(): the pure "Enter" decision (PLAN.md §5.6).
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../zotero-bridge/lib/actions.js");

const pdf = (id, exists = true) => ({ id, readerType: "pdf", exists });
const regular = (id, childIDs = [], best = null) => ({ kind: "regular", id, childIDs, best });
const tab = (itemID, extra = {}) => Object.assign({ kind: "tab", tabType: "reader", tabId: `tab-${itemID}`, itemID, selected: false, timeSelected: 0, index: 1 }, extra);
const win = (itemID, tabType = "reader") => ({ kind: "window", tabType, itemID, title: "w" });

test("item open in a tab (any child) → switch to that tab", () => {
  assert.deepEqual(A.plan(regular(1, [10, 11], pdf(10)), [tab(10)]), { action: "switch-tab", tabId: "tab-10", itemID: 10 });
  // a secondary attachment or a child note tab counts as "open" too
  assert.equal(A.plan(regular(1, [10, 11], pdf(10)), [tab(11, { tabType: "note" })]).tabId, "tab-11");
});

test("several tabs: selected, then most recently selected, then tab order", () => {
  const target = regular(1, [10, 11, 12], pdf(10));
  assert.equal(A.plan(target, [tab(10, { timeSelected: 9 }), tab(11, { selected: true })]).tabId, "tab-11");
  assert.equal(A.plan(target, [tab(10, { timeSelected: 5 }), tab(11, { timeSelected: 9 })]).tabId, "tab-11");
  assert.equal(A.plan(target, [tab(12, { index: 3 }), tab(11, { index: 2 })]).tabId, "tab-11");
});

test("separate window only → focus it; a tab wins over a window", () => {
  assert.deepEqual(A.plan(regular(1, [10], pdf(10)), [win(10)]), { action: "focus-window", itemID: 10, windowKind: "reader" });
  assert.equal(A.plan(regular(1, [10], pdf(10)), [win(10), tab(10)]).action, "switch-tab");
});

test("not open, readable file → open the best attachment in the reader", () => {
  assert.deepEqual(A.plan(regular(1, [10], pdf(10)), []), { action: "open-reader", itemID: 10 });
  assert.equal(A.plan(regular(1, [10], { id: 10, readerType: "epub", exists: true }), []).action, "open-reader");
  assert.equal(A.plan(regular(1, [10], { id: 10, readerType: "snapshot", exists: true }), []).action, "open-reader");
});

test("nothing openable → select in the library", () => {
  assert.deepEqual(A.plan(regular(1), []), { action: "select", itemID: 1 }); // no attachment
  assert.equal(A.plan(regular(1, [10], pdf(10, false)), []).action, "select"); // file missing
  assert.equal(A.plan(regular(1, [10], { id: 10, readerType: null, exists: false }), []).action, "select"); // linked URL
  assert.equal(A.plan(regular(1, [10], { id: 10, readerType: "docx", exists: true }), []).action, "select"); // no reader
});

test("standalone attachment opens itself; notes open in the note editor", () => {
  const standalone = { kind: "attachment", id: 5, childIDs: [], best: pdf(5) };
  assert.deepEqual(A.plan(standalone, []), { action: "open-reader", itemID: 5 });
  assert.equal(A.plan(standalone, [tab(5)]).action, "switch-tab");
  const note = { kind: "note", id: 7, childIDs: [], best: null };
  assert.deepEqual(A.plan(note, []), { action: "open-note", itemID: 7 });
  assert.equal(A.plan(note, [tab(7, { tabType: "note" })]).action, "switch-tab");
  assert.deepEqual(A.plan(note, [win(7, "note")]), { action: "focus-window", itemID: 7, windowKind: "note" });
});

test("file order: existing files first, then Zotero's best, then PDFs, then title", () => {
  const f = (title, extra) => Object.assign({ title, exists: true, best: false, contentType: "application/pdf" }, extra);
  const files = [
    f("B missing best", { exists: false, best: true }),
    f("snapshot", { contentType: "text/html" }),
    f("A pdf"),
    f("Z pdf best", { best: true }),
    f("C missing", { exists: false }),
  ];
  assert.deepEqual(files.sort(A.compareAttachments).map((x) => x.title), ["Z pdf best", "A pdf", "snapshot", "B missing best", "C missing"]);
});

test("other items' tabs and windows are ignored", () => {
  assert.equal(A.plan(regular(1, [10], pdf(10)), [tab(99, { selected: true }), win(98)]).action, "open-reader");
  assert.equal(A.plan(regular(1), undefined).action, "select");
});
