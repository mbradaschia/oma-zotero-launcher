// OmaTags (zotero-bridge/lib/tags.js) against a fake Zotero: ordering, request
// validation, the library tag list, an item's tags, and undoable updates.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Values from the VM realm → plain main-realm values (deepStrictEqual checks prototypes).
const plain = (x) => JSON.parse(JSON.stringify(x));

function omaHttpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

function load({ rows = [], colors = new Map(), libraries = { 1: { name: "My Library", editable: true } } } = {}) {
  const ctx = vm.createContext({
    omaHttpError,
    Zotero: {
      DB: { queryAsync: async () => rows },
      Tags: { getColors: () => colors },
      Libraries: { get: (id) => libraries[id] || null },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../zotero-bridge/lib/tags.js"), "utf8"), ctx);
  return ctx.OmaTags;
}

// A fake item with Zotero's addTag/removeTag semantics and a recording saveTx.
function fakeItem(tags, { libraryID = 1, editable = true } = {}) {
  const item = {
    libraryID,
    tags: tags.map((t) => (typeof t === "string" ? { tag: t, type: 0 } : t)),
    saves: [],
    isEditable: () => editable,
    getTags() {
      return this.tags.map((t) => Object.assign({}, t));
    },
    addTag(name, type = 0) {
      const t = this.tags.find((x) => x.tag === name);
      if (t && t.type === type) return false;
      if (t) t.type = type;
      else this.tags.push({ tag: name, type });
      return true;
    },
    removeTag(name) {
      const n = this.tags.length;
      this.tags = this.tags.filter((x) => x.tag !== name);
      return this.tags.length !== n;
    },
    async saveTx(opts) {
      this.saves.push(opts);
    },
  };
  return item;
}

test("compare: colored tags by slot, then most used, then name (case-insensitive)", () => {
  const T = load();
  const list = [
    { tag: "zeta", count: 5, position: null },
    { tag: "Alpha", count: 5, position: null },
    { tag: "★ Best", count: 0, position: 1 },
    { tag: "/To Read", count: 3, position: 0 },
    { tag: "notion", count: 1019, position: null },
    { tag: "beta", count: 5, position: null },
  ];
  assert.deepEqual(list.sort(T.compare).map((t) => t.tag), ["/To Read", "★ Best", "notion", "Alpha", "beta", "zeta"]);
});

test("cleanNames: trims, de-duplicates, and refuses bad input with 400 bad-tags", () => {
  const T = load();
  assert.deepEqual(plain(T.cleanNames(["  a ", "b", "a"], "add")), ["a", "b"]);
  assert.deepEqual(plain(T.cleanNames(undefined, "add")), []);
  for (const bad of ["x", [""], ["  "], [42], ["two\nlines"], ["x".repeat(256)], Array(51).fill("t")]) {
    assert.throws(() => T.cleanNames(bad, "add"), (e) => e.status === 400 && e.code === "bad-tags", JSON.stringify(bad).slice(0, 40));
  }
  assert.deepEqual(plain(T.cleanNames(["x".repeat(255)], "add")), ["x".repeat(255)]);
});

test("list: merges types per name, adds unused colored tags, sorts", async () => {
  const colors = new Map([["★ Best", { color: "#2EA8E5", position: 1 }], ["⚡ Scan", { color: "#A28AE5", position: 0 }]]);
  const rows = [
    { name: "notion", type: 0, n: 1019 },
    { name: "risk", type: 1, n: 4 },
    { name: "risk", type: 0, n: 2 },
    { name: "⚡ Scan", type: 0, n: 4 },
  ];
  const T = load({ rows, colors });
  const list = plain(await T.list(1));
  assert.deepEqual(list.map((t) => t.tag), ["⚡ Scan", "★ Best", "notion", "risk"]);
  assert.deepEqual(list.find((t) => t.tag === "risk"), { tag: "risk", types: [0, 1], count: 6, color: null, position: null });
  assert.deepEqual(list.find((t) => t.tag === "★ Best"), { tag: "★ Best", types: [], count: 0, color: "#2EA8E5", position: 1 });
});

test("itemTags: one entry per name, manual wins over automatic, colors attached", () => {
  const colors = new Map([["⚡ Scan", { color: "#A28AE5", position: 0 }]]);
  const T = load({ colors });
  const item = fakeItem([{ tag: "b", type: 1 }, { tag: "b", type: 0 }, { tag: "auto", type: 1 }, "⚡ Scan"]);
  assert.deepEqual(plain(T.itemTags(item)), [
    { tag: "⚡ Scan", type: 0, color: "#A28AE5", position: 0 },
    { tag: "auto", type: 1, color: null, position: null },
    { tag: "b", type: 0, color: null, position: null },
  ]);
});

test("update: one undoable save labelled like Zotero's own tag edits", async () => {
  const T = load();
  const cases = [
    { tags: ["a"], add: ["b"], remove: [], action: "undo-action-add-tag", count: 1, after: ["a", "b"] },
    { tags: ["a"], add: ["b", "c"], remove: [], action: "undo-action-add-tag", count: 1, after: ["a", "b", "c"] },
    { tags: ["a", "b"], add: [], remove: ["a"], action: "undo-action-remove-tag", count: 1, after: ["b"] },
    { tags: ["a", "b"], add: [], remove: ["a", "b"], action: "undo-action-remove-tags-from-item", count: 2, after: [] },
    { tags: ["a"], add: ["b"], remove: ["a"], action: "undo-action-change-tag", count: 1, after: ["b"] },
  ];
  for (const c of cases) {
    const item = fakeItem(c.tags);
    const r = plain(await T.update(item, c.add, c.remove));
    assert.deepEqual(plain(item.saves), [{ undoAction: c.action, undoActionArgs: { count: c.count } }], c.action);
    assert.deepEqual(r.tags.map((t) => t.tag), c.after);
    assert.deepEqual(r.added, c.add);
    assert.deepEqual(r.removed, c.remove);
  }
});

test("update: no-ops don't save; an automatic tag isn't turned manual by 'add'", async () => {
  const T = load();
  const item = fakeItem(["a", { tag: "auto", type: 1 }]);
  const r = plain(await T.update(item, ["a", "auto"], ["missing"]));
  assert.deepEqual(item.saves, []);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.removed, []);
  assert.equal(item.tags.find((t) => t.tag === "auto").type, 1);
});

test("update: read-only library or item → 409 read-only naming the library, nothing saved", async () => {
  const T = load({ libraries: { 1: { name: "My Library", editable: true }, 2: { name: "HBR.org", editable: false } } });
  const feedItem = fakeItem(["a"], { libraryID: 2, editable: true }); // Zotero says feeds are editable; the library flag wins
  await assert.rejects(T.update(feedItem, ["b"], []), (e) => e.status === 409 && e.code === "read-only" && /HBR\.org/.test(e.message));
  assert.deepEqual(feedItem.saves, []);
  const locked = fakeItem(["a"], { editable: false });
  await assert.rejects(T.update(locked, [], ["a"]), (e) => e.code === "read-only");
  assert.deepEqual(locked.tags.map((t) => t.tag), ["a"]);
  assert.equal(T.editable(fakeItem([])), true);
  assert.equal(T.editable(feedItem), false);
});

test("update: the same name added and removed → 400", async () => {
  const T = load();
  await assert.rejects(T.update(fakeItem([]), ["x"], ["x"]), (e) => e.status === 400 && e.code === "bad-tags");
});

test("everywhere: a tag counted, renamed (merging) and deleted across the libraries you can edit; a racing write is retried", async () => {
  // tag ids are global in Zotero; items per library; group 2 is read-only
  const tags = new Map([["s/pending", 7], ["s/read", 8]]);
  const items = { "1:7": [11, 12], "3:7": [31], "2:7": [21], "1:8": [12] };
  const calls = [];
  let racing = 0; // how many renames don't stick (an item saved with its old tags right after)
  const ctx = vm.createContext({
    omaHttpError,
    Zotero: {
      Tags: {
        getID: (name) => tags.get(name) || false,
        getTagItems: async (lib, id) => (items[lib + ":" + id] || []).slice(),
        rename: async (lib, from, to) => {
          calls.push(["rename", lib, from, to]);
          if (racing > 0) { racing--; return; }
          const a = tags.get(from);
          if (!tags.has(to)) tags.set(to, 100 + tags.size);
          const b = tags.get(to);
          items[lib + ":" + b] = Array.from(new Set((items[lib + ":" + b] || []).concat(items[lib + ":" + a] || [])));
          delete items[lib + ":" + a];
        },
        removeFromLibrary: async (lib, ids) => { calls.push(["delete", lib, ids.slice()]); for (const id of ids) delete items[lib + ":" + id]; },
      },
      Libraries: { getAll: () => [{ libraryID: 1, editable: true }, { libraryID: 2, editable: false }, { libraryID: 3, editable: true }] },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../zotero-bridge/lib/tags.js"), "utf8"), ctx);
  const T = ctx.OmaTags;
  assert.deepEqual(plain(await T.countEverywhere("s/pending")), { name: "s/pending", count: 3 }); // not group 2's
  assert.deepEqual(plain(await T.countEverywhere("nothing")), { name: "nothing", count: 0 });
  // renamed into an existing tag: merged (item 12 had both)
  racing = 1; // the first try in library 1 doesn't stick: it's done again
  const r = plain(await T.renameEverywhere("s/pending", "s/read"));
  assert.deepEqual([r.count, r.left, r.ids.sort()], [3, 0, [11, 12, 31]]);
  assert.deepEqual(calls.filter((c) => c[1] === 1).length, 2);
  assert.deepEqual(plain(await T.countEverywhere("s/read")), { name: "s/read", count: 3 });
  calls.length = 0;
  const d = plain(await T.deleteEverywhere("s/read"));
  assert.deepEqual([d.count, d.left], [3, 0]);
  assert.deepEqual(plain(await T.countEverywhere("s/read")), { name: "s/read", count: 0 });
  // what still has it after the second try is said
  racing = 5;
  tags.set("x", 9); items["1:9"] = [11];
  assert.deepEqual([plain(await T.renameEverywhere("x", "y")).count, plain(await T.renameEverywhere("x", "y")).left], [0, 1]);
  await assert.rejects(T.renameEverywhere("x", "x"), /the same/);
});

test("what changes in Zotero: renames, deletes and new prefixed tags, logged for the launcher", () => {
  const T = load();
  T.changes = { seq: 0, log: [] };
  // a rename in Zotero's tag selector: one modify per item, the old and new names
  T.notify("modify", "item-tag", ["11-9", "12-9"], { "11-9": { tag: "s/skim", old: { tag: "s/skimmed" } }, "12-9": { tag: "s/skim", old: { tag: "s/skimmed" } } });
  // tags put on items: only prefixed ones count
  T.notify("add", "item-tag", ["11-3", "11-4"], { "11-3": { tag: "t/Drafting" }, "11-4": { tag: "notion" } });
  // a tag gone from the library
  T.notify("delete", "tag", [5], { 5: { old: { tag: "s/old" } } });
  T.notify("delete", "tag", [6], { 6: { old: { tag: "plain" } } });
  const all = plain(T.changesSince(0));
  assert.equal(all.seq, 3);
  assert.deepEqual(all.changes.map((c) => [c.kind, c.from || "", c.name]), [["rename", "s/skimmed", "s/skim"], ["add", "", "t/Drafting"], ["delete", "", "s/old"]]);
  assert.deepEqual(plain(T.changesSince(2)).changes.map((c) => c.name), ["s/old"]);
});

test("papersWith: a tag's papers, each once (a note's or a file's: its paper), in the libraries you can edit", async () => {
  const mk = (id, key, fields) => Object.assign({ id, key, libraryID: 1, deleted: false, parentItemID: null, isRegularItem: () => !fields || !fields.child, getDisplayTitle: () => "Title " + key }, fields || {});
  const all = new Map([[1, mk(1, "AAAA0001")], [2, mk(2, "NOTE0001", { child: true, parentItemID: 1 })], [3, mk(3, "AAAA0003")], [4, mk(4, "GONE0004", { deleted: true })]]);
  const ctx = vm.createContext({
    omaHttpError,
    Zotero: {
      Tags: { getID: (n) => (n === "to read" ? 5 : false), getTagItems: async (lib, id) => (lib === 1 && id === 5 ? [1, 2, 3, 4] : []) },
      Libraries: { getAll: () => [{ libraryID: 1, editable: true }] },
      Items: { get: (x) => (Array.isArray(x) ? x.map((i) => all.get(i)) : all.get(x)) },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../zotero-bridge/lib/tags.js"), "utf8"), ctx);
  const byId = new Map([[1, { title: "Corporate effects", creator: "Adner & Helfat", year: 2003 }]]);
  assert.deepEqual(plain(await ctx.OmaTags.papersWith("to read", 10, byId)), [
    { key: "AAAA0001", libraryID: 1, title: "Corporate effects", creator: "Adner & Helfat", year: "2003" },
    { key: "AAAA0003", libraryID: 1, title: "Title AAAA0003", creator: "", year: "" },
  ]);
  assert.equal(plain(await ctx.OmaTags.papersWith("to read", 1, byId)).length, 1);
  assert.deepEqual(plain(await ctx.OmaTags.papersWith("nothing", 10, byId)), []);
});
