// OmaTabs.pruneDeadReaderWindows (zotero-bridge/lib/tabs.js): a ReaderWindow
// whose window was closed by script stays in Zotero.Reader._readers and makes
// Reader.open(…, { openInWindow }) reuse it (nothing opens). The prune drops
// exactly those entries.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(readers) {
  const ctx = vm.createContext({
    Zotero: { Reader: { _readers: readers }, getMainWindow: () => null, Items: { get: () => null } },
    Services: { wm: { getEnumerator: () => [] } },
    Components: { utils: { isDeadWrapper: (w) => !!(w && w.dead) } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../zotero-bridge/lib/tabs.js"), "utf8"), ctx);
  return ctx.OmaTabs;
}

test("prunes reader windows whose window is dead, closed or missing; keeps tabs and live windows", () => {
  const live = { itemID: 1, _window: { closed: false } };
  const tab = { itemID: 2, tabID: "tab-1", _window: { dead: true } }; // tabs are never pruned
  const dead = { itemID: 3, _window: { dead: true } };
  const closed = { itemID: 4, _window: { closed: true } };
  const missing = { itemID: 5 };
  const throwing = { itemID: 6, get _window() { throw new Error("can't access dead object"); } };
  const readers = [live, tab, dead, closed, missing, throwing];
  const OmaTabs = load(readers);
  assert.equal(OmaTabs.pruneDeadReaderWindows(), 4);
  assert.deepEqual(readers.map((r) => r.itemID), [1, 2]);
  assert.equal(OmaTabs.pruneDeadReaderWindows(), 0);
});

test("openItems: one row per top-level item; MRU (selected first) or tab-bar order", () => {
  const items = {
    10: { id: 10, isTopLevelItem: () => true },
    11: { id: 11, isTopLevelItem: () => false, parentItemID: 10 }, // attachment of 10
    20: { id: 20, isTopLevelItem: () => true },
    30: { id: 30, isTopLevelItem: () => true },
    40: { id: 40, isTopLevelItem: () => true },
  };
  const tabs = [
    { id: "zotero-pane", type: "library" },
    { id: "t20", type: "reader", data: { itemID: 20 }, timeSelected: 500 },
    { id: "t11", type: "reader-unloaded", data: { itemID: 11 }, timeSelected: 100 },
    { id: "t30", type: "note", data: { itemID: 30 }, timeSelected: 900 },
    { id: "t10", type: "reader", data: { itemID: 10 }, timeSelected: 50 },
  ];
  const ctx = vm.createContext({
    Zotero: {
      Reader: { _readers: [{ itemID: 40, _window: { closed: false, document: { title: "w" } } }] },
      getMainWindow: () => ({ Zotero_Tabs: { _tabs: tabs, selectedID: "t20" } }),
      Items: { get: (id) => items[id] || null },
    },
    Services: { wm: { getEnumerator: () => [] } },
    Components: { utils: { isDeadWrapper: () => false } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../zotero-bridge/lib/tabs.js"), "utf8"), ctx);
  const mru = ctx.OmaTabs.openItems();
  assert.deepEqual([...mru.map((o) => o.topItemID)], [20, 30, 10, 40]); // selected, then newest; the window has no time
  assert.equal(mru.find((o) => o.topItemID === 10).tabId, "t11"); // the newer of item 10's two tabs
  const bar = ctx.OmaTabs.openItems({ order: "tabbar" });
  assert.deepEqual([...bar.map((o) => o.topItemID)], [20, 10, 30, 40]); // item 10's first tab is at index 2; windows last
});
