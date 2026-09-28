/* Open tabs / windows adapter: the only code touching Zotero's private UI state
 * (Zotero_Tabs._tabs, Zotero.Reader._readers). Everything is feature-detected. */
/* global Zotero, Services, Components */

// Zotero.Reader._readers can keep a ReaderWindow whose window is already gone;
// touching such a dead wrapper throws "can't access dead object".
function omaWindowAlive(w) {
  try {
    return !!w && !Components.utils.isDeadWrapper(w) && !w.closed;
  } catch (e) {
    return false;
  }
}

var OmaTabs = {
  // Raw list of reader/note tabs in the main window plus separate reader/note windows.
  list() {
    const out = [];
    const win = Zotero.getMainWindow();
    const zt = win && win.Zotero_Tabs;
    if (zt && Array.isArray(zt._tabs)) {
      zt._tabs.forEach((tab, index) => {
        const m = /^(reader|note)(?:-(?:unloaded|loading))?$/.exec(tab.type || "");
        const itemID = tab.data && tab.data.itemID;
        if (!m || !itemID) return;
        out.push({
          kind: "tab",
          tabType: m[1],
          tabId: tab.id,
          itemID,
          title: tab.title,
          index,
          selected: tab.id === zt.selectedID,
          loaded: tab.type === m[1],
          timeSelected: tab.timeSelected || 0,
        });
      });
    }
    for (const reader of (Zotero.Reader && Zotero.Reader._readers) || []) {
      try {
        if (reader.tabID) continue;
        const w = reader._window;
        if (!omaWindowAlive(w)) continue;
        out.push({ kind: "window", tabType: "reader", itemID: reader.itemID, title: w.document.title, timeSelected: 0 });
      } catch (e) {
        // stale reader entry; skip
      }
    }
    for (const w of Services.wm.getEnumerator("zotero:note")) {
      const m = /^zotero-note-(\d+)$/.exec(w.name || "");
      if (!m || !omaWindowAlive(w)) continue;
      out.push({ kind: "window", tabType: "note", itemID: Number(m[1]), title: w.document.title, timeSelected: 0 });
    }
    return out;
  },

  // Open tabs/windows mapped to their top-level item, de-duplicated. Order "mru": most
  // recently used first (the selected tab counts as newest); "tabbar": Zotero's tab-bar
  // order, then separate windows.
  openItems({ order = "mru" } = {}) {
    const byTop = new Map();
    for (const t of this.list()) {
      const item = Zotero.Items.get(t.itemID);
      if (!item) continue;
      const top = item.isTopLevelItem() ? item : Zotero.Items.get(item.parentItemID);
      if (!top) continue;
      const rankTime = t.selected ? Number.MAX_SAFE_INTEGER : t.timeSelected;
      const tabIndex = t.kind === "tab" ? t.index : 1e9;
      const prev = byTop.get(top.id);
      if (!prev || rankTime > prev.rankTime) {
        byTop.set(top.id, Object.assign({}, t, { topItemID: top.id, rankTime, tabIndex: Math.min(tabIndex, prev ? prev.tabIndex : 1e9) }));
      } else {
        prev.tabIndex = Math.min(prev.tabIndex, tabIndex);
      }
    }
    const byRank = (a, b) => b.rankTime - a.rankTime;
    return Array.from(byTop.values()).sort(order === "tabbar" ? (a, b) => a.tabIndex - b.tabIndex || byRank(a, b) : byRank);
  },

  mainWindowTitle() {
    const win = Zotero.getMainWindow();
    return win ? win.document.title : null;
  },

  // Drop reader windows whose window is gone. Zotero removes a ReaderWindow from
  // _readers only via ReaderWindow.close() (the window's onclose); if something
  // closes the window by script, the stale entry stays and Reader.open(…,
  // { openInWindow }) "reuses" it: nothing opens and touching it throws
  // "can't access dead object".
  pruneDeadReaderWindows() {
    const readers = (Zotero.Reader && Zotero.Reader._readers) || [];
    let pruned = 0;
    for (const reader of readers.slice()) {
      let dead = false;
      try {
        dead = !reader.tabID && !omaWindowAlive(reader._window);
      } catch (e) {
        dead = true;
      }
      if (dead) {
        readers.splice(readers.indexOf(reader), 1);
        pruned++;
      }
    }
    return pruned;
  },

  // Live separate window showing itemID: kind "reader" (attachment) or "note".
  findWindow(itemID, kind) {
    if (kind === "reader") {
      for (const reader of (Zotero.Reader && Zotero.Reader._readers) || []) {
        try {
          if (!reader.tabID && reader.itemID === itemID && omaWindowAlive(reader._window)) return reader._window;
        } catch (e) {
          // stale reader entry; skip
        }
      }
      return null;
    }
    for (const w of Services.wm.getEnumerator("zotero:note")) {
      if (w.name === "zotero-note-" + itemID && omaWindowAlive(w)) return w;
    }
    return null;
  },
};
