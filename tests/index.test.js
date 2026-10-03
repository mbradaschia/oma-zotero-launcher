// OmaIndex build + Zotero.Notifier maintenance, against a fake Zotero.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const lib = (f) => fs.readFileSync(path.join(__dirname, "../zotero-bridge/lib", f), "utf8");
const tick = () => new Promise((r) => setTimeout(r, 260)); // > the index's 200 ms debounce

function fakeItem(items, fields) {
  const it = Object.assign(
    { libraryID: 1, itemType: "journalArticle", title: "", creators: [], year: "", parentItemID: null, deleted: false, tags: [], attachments: [], notes: [], kind: "regular", contentType: null },
    fields
  );
  it.key = it.key || "K" + String(it.id).padStart(7, "0");
  it.isRegularItem = () => it.kind === "regular";
  it.isFileAttachment = () => it.kind === "attachment";
  it.isTopLevelItem = () => it.parentItemID == null;
  it.isPDFAttachment = () => it.kind === "attachment" && it.contentType === "application/pdf";
  it.getCreatorsJSON = () => it.creators;
  it.getAttachments = () => it.attachments.slice();
  it.getNotes = () => it.notes.slice();
  it.getField = (f) => ({ year: it.year, firstCreator: it.firstCreator || "", publicationTitle: it.publication || "" })[f] || "";
  it.getDisplayTitle = () => it.title;
  it.getTags = () => it.tags.map((tag) => ({ tag }));
  it.dateAdded = it.dateAdded || "2026-01-01 00:00:00";
  it.dateModified = it.dateModified || "2026-01-01 00:00:00";
  items.set(it.id, it);
  return it;
}

function setup() {
  const items = new Map();
  const observers = new Map();
  const Zotero = {
    debug() {},
    logError(e) { throw e; },
    Libraries: { getAll: () => [{ libraryID: 1, libraryType: "user", waitForDataLoad: async () => {} }, { libraryID: 9, libraryType: "feed" }] },
    Items: {
      getAll: async (libID, onlyTop, includeDeleted, asIDs) =>
        [...items.values()]
          .filter((i) => i.libraryID === libID && (!onlyTop || i.parentItemID == null) && (includeDeleted || !i.deleted))
          .map((i) => (asIDs ? i.id : i)),
      get: (x) => (Array.isArray(x) ? x.map((id) => items.get(id)).filter(Boolean) : items.get(x) || false),
      loadDataTypes: async () => {},
    },
    Notifier: {
      registerObserver(obs) { const id = "o" + (observers.size + 1); observers.set(id, obs); return id; },
      unregisterObserver(id) { observers.delete(id); },
    },
  };
  const fire = (event, type, ids) => { for (const o of observers.values()) o.notify(event, type, ids, {}); };
  const ctx = vm.createContext({ Zotero, setTimeout, clearTimeout, console });
  vm.runInContext(lib("noteFormat.js"), ctx);
  vm.runInContext(lib("search.js"), ctx);
  vm.runInContext(lib("index.js"), ctx);

  // Library: A (PDF + note), B (bare), C (tagged), S (standalone PDF), N (standalone note), T (trashed)
  const A = fakeItem(items, { id: 1, title: "Resilience of supply chains", creators: [{ lastName: "Pimm", firstName: "Stuart" }], year: "1984", attachments: [11], notes: [12] });
  fakeItem(items, { id: 11, kind: "attachment", parentItemID: 1, contentType: "application/pdf" });
  fakeItem(items, { id: 12, kind: "note", parentItemID: 1 });
  const B = fakeItem(items, { id: 2, title: "Bare item", creators: [{ name: "WHO" }] });
  const C = fakeItem(items, { id: 3, title: "Tagged", tags: ["risk", "risk"] });
  const S = fakeItem(items, { id: 4, kind: "attachment", title: "loose.pdf", contentType: "application/pdf" });
  fakeItem(items, { id: 5, kind: "note", title: "standalone note" });
  fakeItem(items, { id: 6, title: "Trashed", deleted: true });

  const index = new ctx.OmaIndex();
  return { items, index, fire, observers, A, B, C, S };
}

const entry = (index, id) => index.byId.get(id);
// Values built inside the VM belong to another realm; compare plain copies.
const plain = (x) => JSON.parse(JSON.stringify(x));
const ids = (index) => plain(index.entries.map((e) => e.id)).sort((a, b) => a - b);
function assertConsistent(index) {
  index.entries.forEach((e, i) => assert.equal(index._pos.get(e.id), i, `position of ${e.id}`));
  assert.equal(index._pos.size, index.entries.length);
}

test("build indexes regular items and standalone files only", async () => {
  const { index } = setup();
  await index.build();
  assert.deepEqual(ids(index), [1, 2, 3, 4]);
  const a = entry(index, 1);
  assert.equal(a.pdfCount, 1);
  assert.equal(a.noteCount, 1);
  assert.equal(a.year, 1984);
  assert.deepEqual(plain(a.creators), ["Pimm, Stuart"]);
  assert.deepEqual(plain(entry(index, 2).creators), ["WHO"]);
  assert.deepEqual(plain(entry(index, 3).tags), ["risk"]); // de-duplicated
  assert.equal(entry(index, 4).pdfCount, 1);
  assert.equal(index.stats.count, 4);
  assert.equal(index.stats.libraries, 1); // feeds skipped
  assert.ok(index.version > 0);
});

test("the extracted text (a note tagged oma-fulltext) isn't counted among the notes, only marked", async () => {
  const { items, index, B } = setup();
  const text = fakeItem(items, { id: 31, kind: "note", parentItemID: 2 });
  text.hasTag = (t) => t === "oma-fulltext";
  const mine = fakeItem(items, { id: 32, kind: "note", parentItemID: 2 });
  mine.hasTag = () => false;
  B.notes = [31, 32];
  await index.build();
  assert.deepEqual([entry(index, 2).noteCount, entry(index, 2).extracted], [1, true]);
  assert.deepEqual([entry(index, 1).noteCount, entry(index, 1).extracted], [1, false]);
});

test("notifier keeps the index current", async () => {
  const { items, index, fire, observers, A, B, C, S } = setup();
  await index.build();
  index.startObserving();
  const v0 = index.version;

  B.title = "Renamed item";
  fire("modify", "item", [2]);
  await tick();
  assert.equal(entry(index, 2).title, "Renamed item");
  assert.ok(index.version > v0);

  // child PDF added to B → B's pdfCount
  fakeItem(items, { id: 21, kind: "attachment", parentItemID: 2, contentType: "application/pdf" });
  B.attachments.push(21);
  fire("add", "item", [21]);
  await tick();
  assert.equal(entry(index, 2).pdfCount, 1);

  // A's note deleted → A's noteCount via the child→parent map
  items.delete(12);
  A.notes = [];
  fire("delete", "item", [12]);
  await tick();
  assert.equal(entry(index, 1).noteCount, 0);

  // tag added to B (item-tag ids are "<itemID>-<tagID>")
  B.tags = ["new-tag"];
  fire("add", "item-tag", ["2-99"]);
  await tick();
  assert.deepEqual(plain(entry(index, 2).tags), ["new-tag"]);

  // C trashed → gone; S deleted → gone; positions stay consistent
  C.deleted = true;
  fire("trash", "item", [3]);
  items.delete(S.id);
  fire("delete", "item", [4]);
  await tick();
  assert.equal(entry(index, 3), undefined);
  assert.equal(entry(index, 4), undefined);
  assert.deepEqual(ids(index), [1, 2]);
  assertConsistent(index);

  // updated entries are search-ready (prepared by OmaSearch)
  assert.equal(entry(index, 2)._t, "renamed item");

  index.stopObserving();
  assert.equal(observers.size, 0);
});

test("events for unknown or non-indexed items are harmless", async () => {
  const { index, fire } = setup();
  await index.build();
  index.startObserving();
  const before = index.entries.length;
  fire("modify", "item", [5]); // standalone note: not indexed
  fire("delete", "item", [424242]); // never existed
  fire("modify", "item-tag", ["garbage"]);
  await tick();
  assert.equal(index.entries.length, before);
  assertConsistent(index);
  index.stopObserving();
});
