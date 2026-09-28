/* Dev-only routes: spikes, test fixtures and test cleanup. Registered only when
 * the pref extensions.oma-zotero-bridge.dev is true, and token-protected like
 * every other route. Handlers run with `this` = the OmaBridge instance. None of
 * them write to the library, except /dev/undo (Zotero's own Edit → Undo, used
 * by the opt-in tag write tests). Release builds leave this file out. */
/* global Zotero, Services, ChromeUtils, setTimeout, OmaIndex, OmaSearch, OmaTabs, OmaNotes, OmaNoteFormat, omaHttpError, omaNow */

var OmaDev = {
  _opened: null,

  DEFAULT_QUERIES: [
    "s", "su", "sup", "supply chain", "stev resil", "pimm 1984", "complexity ecosys",
    "resilience 2020", "a:ivanov", "#resilience", "y:2015..2020 risk", "rslnc", "muller", "zzqx",
  ],

  register(bridge) {
    bridge.route("POST", "/dev/echo", OmaDev.echo);
    bridge.route("POST", "/dev/bench", OmaDev.bench);
    bridge.route("POST", "/dev/windows", OmaDev.windows);
    bridge.route("POST", "/dev/open-test-windows", OmaDev.openTestWindows);
    bridge.route("POST", "/dev/close-test-windows", OmaDev.closeTestWindows);
    bridge.route("POST", "/dev/note-md", OmaDev.noteMarkdown);
    bridge.route("POST", "/dev/tag-counts", OmaDev.tagCounts);
    bridge.route("POST", "/dev/prefs", OmaDev.prefs);
    bridge.route("POST", "/dev/reload", OmaDev.reload);
    bridge.route("POST", "/dev/samples", OmaDev.samples);
    bridge.route("POST", "/dev/ui-state", OmaDev.uiState);
    bridge.route("POST", "/dev/ui-restore", OmaDev.uiRestore);
    bridge.route("POST", "/dev/close-tab", OmaDev.closeTab);
    bridge.route("POST", "/dev/restart", OmaDev.restart);
    bridge.route("POST", "/dev/attachment-samples", OmaDev.attachmentSamples);
    bridge.route("POST", "/dev/close-reader-windows", OmaDev.closeReaderWindows);
    bridge.route("POST", "/dev/note-samples", OmaDev.noteSamples);
    bridge.route("POST", "/dev/note-state", OmaDev.noteState);
    bridge.route("POST", "/dev/tag-samples", OmaDev.tagSamples);
    bridge.route("POST", "/dev/undo-snapshot", OmaDev.undoSnapshot);
    bridge.route("POST", "/dev/undo", OmaDev.undo);
    bridge.route("POST", "/dev/undo-restore", OmaDev.undoRestore);
    bridge.route("POST", "/dev/delay", OmaDev.setDelay);
    bridge.route("POST", "/dev/tag-purge", OmaDev.tagPurge);
  },

  // Drop a tag that no item uses any more (the write tests' own tag), as Zotero's
  // periodic purge would. Tags still in use are left alone.
  async tagPurge({ name }) {
    const id = Zotero.Tags.getID(String(name || ""));
    if (!id) return { purged: false, existed: false };
    await Zotero.DB.executeTransaction(async () => {
      await Zotero.Tags.purge([id]);
    });
    return { purged: !Zotero.Tags.getID(String(name)), existed: true };
  },

  // Artificial /search latency (ms), to test the overlay's timeout state. In memory only.
  searchDelayMs: 0,

  async setDelay({ ms = 0 } = {}) {
    OmaDev.searchDelayMs = Math.max(0, Math.min(30000, parseInt(ms, 10) || 0));
    return { searchDelayMs: OmaDev.searchDelayMs };
  },

  // Notes by shape, for the phase 4 (notes) tests. "safeToOpen" notes already carry the
  // note editor's schema container, so opening them in Zotero shouldn't re-save them.
  async noteSamples() {
    await this.index.ready;
    const noteTypeID = Zotero.ItemTypes.getID("note");
    const openIDs = new Set(OmaTabs.openItems().map((o) => o.topItemID));
    const info = (item) => (item ? { key: item.key, libraryID: item.libraryID, title: item.isNote() ? item.getNoteTitle() : item.getDisplayTitle() } : null);
    const firstNote = async (where, params = []) => {
      const id = await Zotero.DB.valueQueryAsync(
        "SELECT itemID FROM items JOIN itemNotes USING (itemID) WHERE itemTypeID = ? AND itemID NOT IN (SELECT itemID FROM deletedItems) AND " +
          where + " ORDER BY LENGTH(note) LIMIT 1",
        [noteTypeID].concat(params)
      );
      const note = id ? Zotero.Items.get(id) : null;
      return note ? Object.assign(info(note), { parent: note.parentItemID ? info(Zotero.Items.get(note.parentItemID)) : null, htmlLength: note.getNote().length }) : null;
    };
    // Regular items by number of child notes (not open in a tab, so tests don't disturb them).
    const byCount = (pred) => {
      const e = this.index.entries.find((x) => x.itemType !== "attachment" && !openIDs.has(x.id) && pred(x.noteCount));
      return e ? { key: e.key, libraryID: e.libraryID, title: e.title, noteCount: e.noteCount } : null;
    };
    return {
      oneNote: byCount((n) => n === 1),
      severalNotes: byCount((n) => n >= 3),
      noNotes: byCount((n) => n === 0),
      standalone: await firstNote("parentItemID IS NULL"),
      withImage: await firstNote("INSTR(note, '<img') > 0"),
      withCitation: await firstNote("INSTR(note, 'class=\"citation\"') > 0"),
      withZoteroLink: await firstNote("INSTR(note, 'zotero://') > 0"),
      withTable: await firstNote("INSTR(note, '<table') > 0"),
      withHighlight: await firstNote("INSTR(note, 'data-annotation') > 0"),
      withCode: await firstNote("INSTR(note, '<pre') > 0"),
      withMath: await firstNote("INSTR(note, 'class=\"math\"') > 0"),
      longest: await (async () => {
        const id = await Zotero.DB.valueQueryAsync(
          "SELECT itemID FROM items JOIN itemNotes USING (itemID) WHERE itemTypeID = ? AND itemID NOT IN (SELECT itemID FROM deletedItems) ORDER BY LENGTH(note) DESC LIMIT 1",
          [noteTypeID]
        );
        const note = id ? Zotero.Items.get(id) : null;
        return note ? Object.assign(info(note), { htmlLength: note.getNote().length }) : null;
      })(),
      // Child notes whose HTML is already in the note editor's current format, and whose
      // parent isn't open: the "open in Zotero" test opens one of these.
      safeToOpen: await (async () => {
        const ids = await Zotero.DB.columnQueryAsync(
          "SELECT itemID FROM items JOIN itemNotes USING (itemID) WHERE itemTypeID = ? AND parentItemID IS NOT NULL " +
            "AND INSTR(note, 'data-schema-version') > 0 AND itemID NOT IN (SELECT itemID FROM deletedItems) ORDER BY LENGTH(note) LIMIT 20",
          [noteTypeID]
        );
        for (const note of Zotero.Items.get(ids || [])) {
          if (openIDs.has(note.parentItemID) || !Zotero.Notes.hasSchemaVersion(note.getNote())) continue;
          return Object.assign(info(note), { parent: info(Zotero.Items.get(note.parentItemID)) });
        }
        return null;
      })(),
      // A note with web links, to check how links are shown.
      withWebLink: await (async () => {
        const id = await Zotero.DB.valueQueryAsync(
          "SELECT itemID FROM items JOIN itemNotes USING (itemID) WHERE itemTypeID = ? AND INSTR(note, 'href=\"http') > 0 " +
            "AND itemID NOT IN (SELECT itemID FROM deletedItems) ORDER BY LENGTH(note) LIMIT 1",
          [Zotero.ItemTypes.getID("note")]
        );
        const note = id ? Zotero.Items.get(id) : null;
        return note ? { key: note.key, libraryID: note.libraryID, title: note.getNoteTitle() } : null;
      })(),
      betterNotesInstalled: !!Zotero.BetterNotes,
    };
  },

  // A note's sync-relevant state, so tests can prove that opening it changed nothing.
  async noteState({ key, libraryID }) {
    const note = Zotero.Items.getByLibraryAndKey(libraryID || Zotero.Libraries.userLibraryID, String(key || ""));
    if (!note || !note.isNote()) throw omaHttpError(404, "not-found", "no such note");
    const html = note.getNote();
    let hash = 0;
    for (let i = 0; i < html.length; i++) hash = (Math.imul(hash, 31) + html.charCodeAt(i)) | 0;
    return { key: note.key, version: note.version, synced: note.synced, dateModified: note.dateModified, clientDateModified: note.clientDateModified, htmlLength: html.length, hash };
  },

  // Items and tags for the phase 5 (tags) tests. The write tests use `writable`: a regular
  // item that isn't open, in an editable library, without the test tag.
  async tagSamples({ testTag = "oma-zotero-test" } = {}) {
    await this.index.ready;
    const openIDs = new Set(OmaTabs.openItems().map((o) => o.topItemID));
    const libraryID = Zotero.Libraries.userLibraryID;
    const colors = Zotero.Tags.getColors(libraryID);
    const info = (e) => (e ? { key: e.key, libraryID: e.libraryID, title: e.title, tags: e.tags } : null);
    const regular = this.index.entries.filter((e) => e.itemType !== "attachment" && e.libraryID === libraryID && !openIDs.has(e.id));
    // A regular item carrying an automatic tag itself (not just on a child).
    const autoEntry = regular.find((e) => e.tags.length && Zotero.Items.get(e.id).getTags().some((t) => t.type === 1));
    return {
      libraryID,
      editable: Zotero.Libraries.get(libraryID).editable,
      readOnlyLibraries: Zotero.Libraries.getAll().filter((l) => !l.editable).map((l) => ({ libraryID: l.libraryID, name: l.name, type: l.libraryType })),
      coloredTags: Array.from(colors.entries()).map(([tag, v]) => ({ tag, color: v.color, position: v.position })),
      writable: info(regular.find((e) => e.tags.length >= 1 && e.tags.length <= 5 && !e.tags.includes(testTag))),
      withColoredTag: info(regular.find((e) => e.tags.some((t) => colors.has(t)))),
      withAutoTag: autoEntry
        ? Object.assign(info(autoEntry), { autoTags: Zotero.Items.get(autoEntry.id).getTags().filter((t) => t.type === 1).map((t) => t.tag) })
        : null,
      untagged: info(regular.find((e) => e.tags.length === 0)),
      // An item in a read-only library (e.g. a feed): tag edits must be refused.
      readOnlyItem: await (async () => {
        for (const l of Zotero.Libraries.getAll()) {
          if (l.editable) continue;
          const id = await Zotero.DB.valueQueryAsync("SELECT itemID FROM items WHERE libraryID = ? LIMIT 1", [l.libraryID]);
          const item = id ? await Zotero.Items.getAsync(id) : null; // feed items load lazily
          if (item) return { key: item.key, libraryID: item.libraryID, library: l.name };
        }
        return null;
      })(),
      testTagInUse: Number(await Zotero.DB.valueQueryAsync(
        "SELECT COUNT(*) FROM itemTags JOIN tags USING (tagID) WHERE name = ?",
        [testTag]
      )) || 0,
    };
  },

  // Zotero's undo history lives in memory (Zotero.UndoHistory). Write tests snapshot it,
  // exercise Edit → Undo, and put it back so the user's own undo steps are untouched.
  _undoSnap: null,

  async undoSnapshot() {
    const UH = Zotero.UndoHistory;
    OmaDev._undoSnap = { undo: UH._undoStack.slice(), redo: UH._redoStack.slice() };
    return { undo: UH._undoStack.length, redo: UH._redoStack.length, top: UH.getUndoAction() };
  },

  async undo() {
    const UH = Zotero.UndoHistory;
    const top = UH.getUndoAction();
    const done = await UH.undo();
    return { done, action: top, undo: UH._undoStack.length, redo: UH._redoStack.length };
  },

  // Drop the history entries that only touch the given items (the tests' own), and bring
  // back the redo stack that a new entry clears.
  async undoRestore({ keys = [], libraryID } = {}) {
    const UH = Zotero.UndoHistory;
    const snap = OmaDev._undoSnap || { undo: [], redo: [] };
    const lib = libraryID || Zotero.Libraries.userLibraryID;
    const ids = new Set(keys.map((k) => Zotero.Items.getIDFromLibraryAndKey(lib, String(k))).filter(Boolean));
    const ours = (e) => !snap.undo.includes(e) && !snap.redo.includes(e) && e.changes.every((c) => c.objectType === "item" && ids.has(c.id));
    const before = { undo: UH._undoStack.length, redo: UH._redoStack.length };
    UH._undoStack = UH._undoStack.filter((e) => !ours(e));
    UH._redoStack = UH._redoStack.filter((e) => !ours(e));
    if (!UH._redoStack.length && snap.redo.length) UH._redoStack = snap.redo.slice();
    OmaDev._undoSnap = null;
    return { before, after: { undo: UH._undoStack.length, redo: UH._redoStack.length }, top: UH.getUndoAction() };
  },

  // Items by file-attachment shape, for the phase 3 (actions) tests. Items open in
  // tabs are skipped so tests don't disturb them.
  async attachmentSamples() {
    await this.index.ready;
    const openIDs = new Set(OmaTabs.openItems().map((o) => o.topItemID));
    const info = (item) => (item ? { key: item.key, libraryID: item.libraryID, title: item.getDisplayTitle() } : null);
    let onePdf = null, multiPdf = null, multiPdfOneOnDisk = null, urlOnly = null, standalonePdf = null;
    for (const e of this.index.entries) {
      if (openIDs.has(e.id)) continue;
      if (e.itemType === "attachment") {
        if (!standalonePdf && e.pdfCount === 1 && (await Zotero.Items.get(e.id).getFilePathAsync())) standalonePdf = info(Zotero.Items.get(e.id));
        continue;
      }
      if (e.pdfCount >= 2 && (!multiPdf || !multiPdfOneOnDisk)) {
        const item = Zotero.Items.get(e.id);
        let onDisk = 0;
        for (const a of Zotero.Items.get(item.getAttachments(false))) {
          if (a.isPDFAttachment() && (await a.getFilePathAsync())) onDisk++;
        }
        if (!multiPdf && onDisk >= 2) multiPdf = info(item);
        if (!multiPdfOneOnDisk && onDisk === 1) multiPdfOneOnDisk = info(item);
      }
      if (!onePdf && e.pdfCount === 1 && e.attachmentCount === 1) onePdf = info(Zotero.Items.get(e.id));
      if (!urlOnly && e.attachmentCount > 0 && e.pdfCount === 0) {
        const item = Zotero.Items.get(e.id);
        if (Zotero.Items.get(item.getAttachments(false)).every((a) => !a.isFileAttachment())) urlOnly = info(item);
      }
      if (onePdf && multiPdf && multiPdfOneOnDisk && urlOnly && standalonePdf) break;
    }
    // linkMode 0-2 = imported file, imported URL (snapshot), linked file
    const fileAttIDs = await Zotero.DB.columnQueryAsync(
      "SELECT itemID FROM itemAttachments WHERE linkMode IN (0, 1, 2) AND itemID NOT IN (SELECT itemID FROM deletedItems)"
    );
    let missingFile = null, snapshotOnly = null;
    for (const att of Zotero.Items.get(fileAttIDs)) {
      if (!att || att.isInTrash()) continue;
      const parent = att.parentItemID ? Zotero.Items.get(att.parentItemID) : null;
      if (!missingFile && !(await att.getFilePathAsync())) {
        missingFile = { attachment: info(att), parent: info(parent) };
      }
      if (!snapshotOnly && parent && att.attachmentReaderType === "snapshot" && !openIDs.has(parent.id)) {
        const siblings = Zotero.Items.get(parent.getAttachments(false));
        if (!siblings.some((s) => s.isPDFAttachment())) snapshotOnly = info(parent);
      }
      if (missingFile && snapshotOnly) break;
    }
    return { onePdf, multiPdf, multiPdfOneOnDisk, urlOnly, standalonePdf, missingFile, snapshotOnly };
  },

  // Close the separate reader windows showing one attachment (test cleanup).
  async closeReaderWindows({ key, libraryID }) {
    const att = Zotero.Items.getByLibraryAndKey(libraryID || Zotero.Libraries.userLibraryID, String(key || ""));
    if (!att) throw omaHttpError(404, "not-found", "no such attachment");
    let closed = 0;
    for (const reader of (Zotero.Reader._readers || []).slice()) {
      try {
        if (!reader.tabID && reader.itemID === att.id && reader._window && !reader._window.closed) {
          reader.close(); // not _window.close(): only ReaderWindow.close() removes it from Zotero.Reader._readers
          closed++;
        }
      } catch (e) {
        // stale entry
      }
    }
    return { closed };
  },

  // Graceful restart (session saved, tabs restored): needed only when
  // bootstrap.js itself changes, since Zotero caches it until restart.
  async restart() {
    setTimeout(() => Zotero.Utilities.Internal.quit(true), 200);
    return { restarting: true };
  },

  // Library-independent test fixtures: one real item per case the tests need.
  async samples() {
    await this.index.ready;
    const entries = this.index.entries;
    const open = OmaTabs.openItems();
    const openIDs = new Set(open.map((o) => o.topItemID));
    const info = (e) => (e ? { key: e.key, libraryID: e.libraryID, title: e.title } : null);
    const byID = (id) => {
      const item = id && Zotero.Items.get(id);
      return item ? { key: item.key, libraryID: item.libraryID, title: item.isNote() ? item.getNoteTitle() : item.getDisplayTitle() } : null;
    };
    const regular = (e) => e.itemType !== "attachment";
    const noteTypeID = Zotero.ItemTypes.getID("note");
    // most used single-word tag, for a #tag search check
    // (Zotero's DB layer refuses LIKE with literal patterns, hence INSTR)
    const topTag = await Zotero.DB.valueQueryAsync(
      "SELECT T.name FROM itemTags IT JOIN tags T USING (tagID) WHERE INSTR(T.name, ' ') = 0 " +
        "GROUP BY T.name ORDER BY COUNT(*) DESC LIMIT 1"
    );

    let inCurrentCollection = null;
    try {
      const win = Zotero.getMainWindow();
      const collections = win ? win.ZoteroPane.getSelectedCollections() : [];
      if (collections.length) {
        const ids = collections[0].getChildItems(true).filter((id) => !openIDs.has(id));
        inCurrentCollection = info(ids.map((id) => this.index.byId.get(id)).find(Boolean));
      }
    } catch (e) {
      Zotero.logError(e);
    }

    return {
      // open in a tab (first = most recently used)
      openItems: open.map((o) => Object.assign(byID(o.topItemID) || {}, { tabId: o.tabId || null, kind: o.kind })),
      pdfNotOpen: info(entries.find((e) => regular(e) && e.pdfCount > 0 && !openIDs.has(e.id))),
      noAttachment: info(entries.find((e) => regular(e) && e.attachmentCount === 0 && e.noteCount === 0 && !openIDs.has(e.id))),
      standaloneFile: info(entries.find((e) => !regular(e) && !openIDs.has(e.id))),
      childNote: byID(
        await Zotero.DB.valueQueryAsync(
          "SELECT itemID FROM items JOIN itemNotes USING (itemID) WHERE itemTypeID = ? AND parentItemID IS NOT NULL " +
            "AND itemID NOT IN (SELECT itemID FROM deletedItems) LIMIT 1",
          [noteTypeID]
        )
      ),
      trashed: byID(await Zotero.DB.valueQueryAsync("SELECT itemID FROM deletedItems LIMIT 1")),
      inCurrentCollection,
      topTag,
      // how many indexed entries carry topTag: an exact #^tag$ search must return this many
      topTagIndexed: topTag ? entries.filter((e) => e.tags.includes(topTag)).length : 0,
    };
  },

  // Snapshot of Zotero's visible state, so UI tests can put everything back.
  async uiState() {
    const win = Zotero.getMainWindow();
    if (!win) return { mainWindow: false };
    const zt = win.Zotero_Tabs;
    const keyOf = (id) => {
      const item = id && Zotero.Items.get(id);
      return item ? item.key : null;
    };
    const topKeyOf = (id) => {
      const item = id && Zotero.Items.get(id);
      if (!item) return null;
      const top = item.isTopLevelItem() ? item : Zotero.Items.get(item.parentItemID);
      return top ? top.key : null;
    };
    const selectedTab = zt._tabs.find((t) => t.id === zt.selectedID);
    return {
      mainWindow: true,
      title: win.document.title,
      selectedTabId: zt.selectedID,
      selectedTabItemKey: selectedTab && selectedTab.data ? keyOf(selectedTab.data.itemID) : null,
      selectedTabTopKey: selectedTab && selectedTab.data ? topKeyOf(selectedTab.data.itemID) : null,
      tabs: zt._tabs.map((t) => ({ id: t.id, type: t.type, itemKey: t.data ? keyOf(t.data.itemID) : null, topKey: t.data ? topKeyOf(t.data.itemID) : null })),
      selectedItemKeys: win.ZoteroPane.getSelectedItems(false, { libraryTabOnly: true }).map((i) => i.key),
      selectedCollectionIDs: win.ZoteroPane.getSelectedCollections(true),
    };
  },

  // Undo UI tests: close tabs for items that weren't open, reselect the items that
  // were selected, and select the same tab (matched by item, since reopened tabs get new ids).
  async uiRestore({ state }) {
    const win = Zotero.getMainWindow();
    if (!win || !state || !state.mainWindow) throw omaHttpError(400, "bad-state", "no main window or state");
    const zt = win.Zotero_Tabs;
    const keyOf = (id) => {
      const item = id && Zotero.Items.get(id);
      return item ? item.key : null;
    };
    const keep = new Set(state.tabs.map((t) => t.itemKey).filter(Boolean));
    const extra = zt._tabs.filter((t) => t.id !== "zotero-pane" && !keep.has(t.data ? keyOf(t.data.itemID) : null)).map((t) => t.id);
    if (extra.length) zt.close(extra);

    // Original tab order (a reopened tab is appended at the end). Walking positions
    // left to right, the tab wanted at p is always at index >= p.
    for (let p = 1; p < state.tabs.length; p++) {
      const want = state.tabs[p].itemKey;
      const c = zt._tabs.findIndex((t, i) => i >= p && t.data && keyOf(t.data.itemID) === want);
      if (c > p) zt.move(zt._tabs[c].id, p);
    }

    const libraryID = Zotero.Libraries.userLibraryID;
    const ids = (state.selectedItemKeys || []).map((k) => Zotero.Items.getIDFromLibraryAndKey(libraryID, k)).filter(Boolean);
    if (ids.length) await win.ZoteroPane.selectItems(ids, { noTabSwitch: true, noWindowRestore: true });
    else win.ZoteroPane.itemsView.selection.clearSelection();

    const target = state.selectedTabItemKey
      ? zt._tabs.find((t) => t.data && keyOf(t.data.itemID) === state.selectedTabItemKey)
      : zt._tabs.find((t) => t.id === "zotero-pane");
    if (target) zt.select(target.id);

    // Tabs the tests loaded go back to being unloaded (same index, same data).
    // A tab still loading can't be unloaded (Zotero_Tabs.canUnload), so let it settle first.
    for (let i = 0; i < 50 && zt._tabs.some((t) => /-loading$/.test(t.type)); i++) await Zotero.Promise.delay(100);
    const wasUnloaded = new Set(state.tabs.filter((t) => /-unloaded$/.test(t.type)).map((t) => t.itemKey));
    let unloaded = 0;
    for (const t of zt._tabs.slice()) {
      if (t.id === zt.selectedID || /-unloaded$/.test(t.type) || !t.data) continue;
      if (wasUnloaded.has(keyOf(t.data.itemID))) {
        zt.unload(t.id);
        unloaded++;
      }
    }
    return { closedTabs: extra.length, unloadedTabs: unloaded, selectedTabId: zt.selectedID };
  },

  async closeTab({ tabId }) {
    const win = Zotero.getMainWindow();
    const zt = win && win.Zotero_Tabs;
    if (!zt || !zt._tabs.some((t) => t.id === tabId) || tabId === "zotero-pane") throw omaHttpError(404, "not-found", "no such tab");
    zt.close([tabId]);
    return { closed: tabId };
  },

  // What the client actually sent (minus the token): answers "does Qt send Origin?".
  async echo(data, req) {
    const headers = {};
    for (const k of Object.keys(req.headers)) if (k !== "authorization") headers[k] = req.headers[k];
    return { method: req.method, pathname: req.pathname, headers, data };
  },

  async bench({ queries, reps = 30 }) {
    await this.index.ready;
    queries = Array.isArray(queries) && queries.length ? queries.map(String) : OmaDev.DEFAULT_QUERIES;
    reps = Math.max(1, Math.min(200, parseInt(reps, 10) || 30));
    const round = (x) => Math.round(x * 100) / 100;
    const results = [];
    for (const q of queries) {
      const times = [];
      let total = 0;
      for (let i = 0; i < reps; i++) {
        const t0 = omaNow();
        total = OmaSearch.search(this.index.entries, q, { limit: 60 }).total;
        times.push(omaNow() - t0);
      }
      times.sort((a, b) => a - b);
      const sum = times.reduce((a, b) => a + b, 0);
      results.push({
        query: q,
        total,
        avgMs: round(sum / times.length),
        p50Ms: round(times[Math.floor(times.length * 0.5)]),
        p95Ms: round(times[Math.min(times.length - 1, Math.floor(times.length * 0.95))]),
        maxMs: round(times[times.length - 1]),
      });
    }
    // Typing simulation: each query typed one character at a time, with the same
    // narrowing the /search route uses. Per-keystroke cost is what users feel.
    const typing = [];
    for (const q of queries) {
      const perKey = [];
      for (let r = 0; r < Math.min(reps, 10); r++) {
        let prev = null;
        for (let i = 1; i <= q.length; i++) {
          const parsed = OmaSearch.parseQuery(q.slice(0, i));
          const t0 = omaNow();
          const candidates = prev && OmaSearch.canNarrow(prev.parsed, parsed) ? prev.matched : this.index.entries;
          const res = OmaSearch.search(candidates, parsed, { limit: 60, collectMatches: true });
          perKey.push(omaNow() - t0);
          prev = parsed.groups.length ? res : null;
        }
      }
      perKey.sort((a, b) => a - b);
      typing.push({
        query: q,
        keystrokes: q.length,
        avgMs: round(perKey.reduce((a, b) => a + b, 0) / perKey.length),
        p95Ms: round(perKey[Math.min(perKey.length - 1, Math.floor(perKey.length * 0.95))]),
        maxMs: round(perKey[perKey.length - 1]),
      });
    }
    const t0 = omaNow();
    await new OmaIndex().build();
    const rebuildMs = round(omaNow() - t0);
    return { entries: this.index.entries.length, indexStats: this.index.stats, rebuildMs, reps, results, typing };
  },

  async windows() {
    const wins = [];
    for (const w of Services.wm.getEnumerator(null)) {
      wins.push({ windowtype: w.document.documentElement.getAttribute("windowtype"), title: w.document.title, name: w.name });
    }
    return { windows: wins, tabs: OmaTabs.list(), openItems: OmaTabs.openItems(), mainWindowTitle: OmaTabs.mainWindowTitle() };
  },

  // Opens a separate reader window (and optionally a note window) so their
  // Hyprland properties can be inspected; close-test-windows closes exactly
  // these. Pass the key of an item whose PDF is already open, so nothing new
  // is marked as read. Note windows are opt-in: the note editor may re-save
  // older notes when opening them.
  async openTestWindows({ key, libraryID, withNote = false } = {}) {
    await this.index.ready;
    let parent = key ? Zotero.Items.getByLibraryAndKey(libraryID || Zotero.Libraries.userLibraryID, String(key)) : null;
    if (!parent) {
      const pick = this.index.entries.find((e) => e.pdfCount > 0);
      if (!pick) throw omaHttpError(404, "not-found", "no item with a PDF");
      parent = Zotero.Items.get(pick.id);
    }
    const att = parent.isRegularItem() ? await parent.getBestAttachment() : parent;
    const noteID = withNote && parent.isRegularItem() ? parent.getNotes(false)[0] : null;
    const opened = (OmaDev._opened = { reader: null, noteWindow: null });
    let readerTitle = null;
    let noteTitle = null;
    if (att && (await att.getFilePathAsync())) {
      opened.reader = await Zotero.Reader.open(att.id, null, { openInWindow: true, allowDuplicate: true });
      await Zotero.Promise.delay(2500);
      readerTitle = opened.reader && opened.reader._window ? opened.reader._window.document.title : null;
    }
    if (noteID) {
      await Zotero.Notes.open(noteID, null, { openInWindow: true });
      await Zotero.Promise.delay(1500);
      for (const w of Services.wm.getEnumerator("zotero:note")) {
        if (w.name === "zotero-note-" + noteID) {
          opened.noteWindow = w;
          noteTitle = w.document.title;
        }
      }
    }
    return {
      item: parent.key,
      attachment: att ? att.key : null,
      readerTitle,
      note: noteID ? Zotero.Items.get(noteID).key : null,
      noteTitle,
      mainWindowTitle: OmaTabs.mainWindowTitle(),
    };
  },

  async closeTestWindows() {
    const o = OmaDev._opened || {};
    let closed = 0;
    if (o.reader && o.reader._window && !o.reader._window.closed) {
      o.reader.close(); // not _window.close(): only ReaderWindow.close() removes it from Zotero.Reader._readers
      closed++;
    }
    if (o.noteWindow && !o.noteWindow.closed) {
      o.noteWindow.close();
      closed++;
    }
    OmaDev._opened = null;
    return { closed };
  },

  async noteMarkdown({ key, libraryID } = {}) {
    let note = null;
    if (key) {
      note = Zotero.Items.getByLibraryAndKey(libraryID || Zotero.Libraries.userLibraryID, String(key));
    } else {
      // itemNotes also holds attachments' own note field, so filter on the note item type.
      const id = await Zotero.DB.valueQueryAsync(
        "SELECT itemID FROM items JOIN itemNotes USING (itemID) " +
          "WHERE itemTypeID = ? AND itemID NOT IN (SELECT itemID FROM deletedItems) " +
          "ORDER BY clientDateModified DESC LIMIT 1",
        [Zotero.ItemTypes.getID("note")]
      );
      note = id ? Zotero.Items.get(id) : null;
    }
    if (!note || !note.isNote()) throw omaHttpError(404, "not-found", "note not found");
    const html = note.getNote();
    const t0 = omaNow();
    const markdown = await OmaNotes.toMarkdown(note);
    const markdownMs = Math.round((omaNow() - t0) * 100) / 100;
    let betterNotes = null;
    const bn = Zotero.BetterNotes && Zotero.BetterNotes.api && Zotero.BetterNotes.api.convert;
    if (bn && typeof bn.html2md === "function") {
      try {
        const t1 = omaNow();
        const md = await bn.html2md(html);
        betterNotes = { markdown: md, ms: Math.round((omaNow() - t1) * 100) / 100 };
      } catch (e) {
        betterNotes = { error: String(e) };
      }
    }
    return {
      key: note.key,
      title: note.getNoteTitle(),
      parentKey: note.parentItemID ? Zotero.Items.get(note.parentItemID).key : null,
      htmlLength: html.length,
      html,
      markdown,
      markdownMs,
      markdownStripped: OmaNoteFormat.stripImages(markdown),
      display: await OmaNotes.forDisplay(note),
      text: OmaNotes.toText(note),
      betterNotes,
    };
  },

  async tagCounts({ libraryID } = {}) {
    libraryID = parseInt(libraryID, 10) || Zotero.Libraries.userLibraryID;
    const round = (x) => Math.round(x * 100) / 100;
    const t0 = omaNow();
    const rows = await Zotero.DB.queryAsync(
      "SELECT T.name AS name, IT.type AS type, COUNT(*) AS n FROM itemTags IT " +
        "JOIN tags T USING (tagID) JOIN items I USING (itemID) " +
        "WHERE I.libraryID = ? AND IT.itemID NOT IN (SELECT itemID FROM deletedItems) " +
        "GROUP BY T.name, IT.type",
      [libraryID]
    );
    const sqlMs = round(omaNow() - t0);
    const counts = new Map();
    for (const r of rows) {
      const c = counts.get(r.name) || { tag: r.name, count: 0, types: [] };
      c.count += r.n;
      c.types.push(r.type);
      counts.set(r.name, c);
    }
    const t1 = omaNow();
    const all = await Zotero.Tags.getAll(libraryID);
    const getAllMs = round(omaNow() - t1);
    const colors = Zotero.Tags.getColors(libraryID);
    const list = Array.from(counts.values())
      .map((c) => Object.assign(c, colors.get(c.tag) || {}))
      .sort((a, b) => b.count - a.count);
    return {
      libraryID,
      sqlMs,
      getAllMs,
      distinctFromSql: counts.size,
      getAllCount: all.length,
      getAllSample: all.slice(0, 5),
      colored: Array.from(colors.entries()).map(([name, v]) => Object.assign({ name }, v)),
      top: list.slice(0, 15),
    };
  },

  async prefs() {
    const P = Services.prefs;
    return {
      autoDisableScopes: { value: P.getIntPref("extensions.autoDisableScopes", -1), hasUserValue: P.prefHasUserValue("extensions.autoDisableScopes") },
      startupScanScopes: P.getIntPref("extensions.startupScanScopes", -1),
      restoreMarker: P.getBoolPref("extensions.oma-zotero-bridge.dev.restoreAutoDisableScopes", false),
      dev: this.dev,
      fileHandlerPdf: Zotero.Prefs.get("fileHandler.pdf"),
      openReaderInNewWindow: Zotero.Prefs.get("openReaderInNewWindow"),
      httpServerPort: Zotero.Prefs.get("httpServer.port"),
      undoHistorySteps: Zotero.Prefs.get("undoHistory.steps"),
    };
  },

  // Hot reload: AddonWrapper.reload() disables + re-enables from the
  // AddonManager (outside this sandbox); startup() reloads lib/*.js uncached.
  async reload() {
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    const addon = await AddonManager.getAddonByID(this.id);
    if (!addon) throw omaHttpError(404, "not-found", "add-on not found");
    setTimeout(() => addon.reload(), 150);
    return { scheduled: true, id: this.id };
  },
};
