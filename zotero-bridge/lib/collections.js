// @ts-check
/* Collections for the launcher: every collection with its full path ("Parent / Child
 * / Grandchild"), searchable with the same fuzzy matcher as items (the path is the
 * entry's title), the items of a collection and its subcollections (a search scope),
 * and selecting a collection in Zotero's collection tree. The list is cached and
 * rebuilt after Zotero reports a collection change. Paths, ordering and the scope's
 * item set are pure over plain objects (node-tested). */
/* global Zotero, omaHttpError, OmaSearch */

var OmaCollections = {
  SEP: " / ",
  MAX_SHOWN: 3, // collections listed above the papers while typing
  _entries: null,
  _observerID: null,

  register(bridge) {
    bridge.route("POST", "/collection/reveal", OmaCollections.reveal);
  },

  startObserving() {
    if (OmaCollections._observerID) return;
    OmaCollections._observerID = Zotero.Notifier.registerObserver(
      { notify: () => { OmaCollections._entries = null; } },
      ["collection", "trash", "library"],
      "oma-zotero-collections"
    );
  },

  stopObserving() {
    if (OmaCollections._observerID) Zotero.Notifier.unregisterObserver(OmaCollections._observerID);
    OmaCollections._observerID = null;
    OmaCollections._entries = null;
  },

  // Plain collections ({ id, key, libraryID, name, parentID }) → search entries with their
  // full path, parents before children, siblings by name.
  build(cols, libraryNames) {
    const byID = new Map(cols.map((c) => [c.id, c]));
    const pathOf = (c) => {
      const names = [];
      const seen = new Set();
      for (let x = c; x && !seen.has(x.id); x = x.parentID ? byID.get(x.parentID) : null) {
        seen.add(x.id);
        names.unshift(x.name);
      }
      return names;
    };
    const entries = cols.map((c) => {
      const names = pathOf(c);
      return OmaSearch.prepareEntry({
        kind: "collection",
        id: c.id,
        key: c.key,
        libraryID: c.libraryID,
        name: c.name,
        title: names.join(OmaCollections.SEP),
        parentPath: names.slice(0, -1).join(OmaCollections.SEP),
        depth: names.length - 1,
        parentID: c.parentID || null,
        library: (libraryNames && libraryNames.get(c.libraryID)) || "",
        creators: [],
        year: null,
        publication: "",
        tags: [],
      });
    });
    const cmp = (a, b) => (a.libraryID - b.libraryID) || a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });
    return entries.sort(cmp);
  },

  entries() {
    if (OmaCollections._entries) return OmaCollections._entries;
    const cols = [];
    const names = new Map();
    for (const lib of Zotero.Libraries.getAll()) {
      if (lib.libraryType === "feed") continue;
      names.set(lib.libraryID, lib.name);
      for (const c of Zotero.Collections.getByLibrary(lib.libraryID, true)) {
        if (c.deleted) continue;
        cols.push({ id: c.id, key: c.key, libraryID: c.libraryID, name: c.name, parentID: c.parentID || null });
      }
    }
    OmaCollections._entries = OmaCollections.build(cols, names);
    return OmaCollections._entries;
  },

  find(key, libraryID) {
    const lib = libraryID == null ? Zotero.Libraries.userLibraryID : Number(libraryID);
    return OmaCollections.entries().find((e) => e.key === String(key) && e.libraryID === lib) || null;
  },

  // The entry and all its descendants' IDs.
  subtreeIDs(entry, all) {
    const ids = new Set([entry.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of all) {
        if (e.parentID && ids.has(e.parentID) && !ids.has(e.id)) {
          ids.add(e.id);
          grew = true;
        }
      }
    }
    return ids;
  },

  // Top-level item IDs in the collection and its subcollections (trash excluded).
  async itemIDs(entry) {
    const cols = Array.from(OmaCollections.subtreeIDs(entry, OmaCollections.entries()))
      .map((id) => Zotero.Collections.get(id))
      .filter(Boolean);
    try {
      if (cols.length) cols[0].getChildItems(true, false);
    } catch (e) {
      await Zotero.Collections.loadDataTypes(cols, ["childItems"]); // lazy right after startup
    }
    const ids = new Set();
    for (const c of cols) for (const id of c.getChildItems(true, false)) ids.add(id);
    return ids;
  },

  // A query's c: terms → the papers of every collection they match, subcollections included
  // (term.ids, which OmaSearch checks).
  async resolveTerms(parsed) {
    const terms = OmaSearch.terms(parsed).filter((t) => t.field === "collection");
    if (!terms.length) return parsed;
    const all = OmaCollections.entries();
    for (const term of terms) {
      const ids = new Set();
      for (const e of all) {
        if (!OmaSearch.collectionMatch(e, term)) continue;
        for (const id of await OmaCollections.itemIDs(e)) ids.add(id);
      }
      term.ids = ids;
    }
    return parsed;
  },

  // A collection as a search row (the path is its title; `titleRanges` highlight it).
  row(entry, extra) {
    return Object.assign(
      {
        kind: "collection",
        key: entry.key,
        libraryID: entry.libraryID,
        itemType: "collection",
        title: entry.title,
        name: entry.name,
        parentPath: entry.parentPath,
        library: entry.library,
      },
      extra || {}
    );
  },

  // Collections matching the query (fuzzy on the full path), best first; within `scope`
  // (an entry) only its descendants.
  search(parsed, scope, limit) {
    let entries = OmaCollections.entries();
    if (scope) {
      const ids = OmaCollections.subtreeIDs(scope, entries);
      entries = entries.filter((e) => e.id !== scope.id && ids.has(e.id));
    }
    const res = OmaSearch.search(entries, parsed, { limit: limit || OmaCollections.MAX_SHOWN });
    return res.results.map((h) => OmaCollections.row(h.entry, { titleRanges: h.titleRanges }));
  },

  // A collection's direct subcollections, by name.
  children(scope) {
    return OmaCollections.entries()
      .filter((e) => e.parentID === scope.id)
      .map((e) => OmaCollections.row(e));
  },

  // POST /collection/reveal { key, libraryID? }: the collection selected in the library tab.
  async reveal({ key, libraryID }) {
    const entry = OmaCollections.find(key, libraryID);
    if (!entry) throw omaHttpError(404, "not-found", "no such collection");
    const win = Zotero.getMainWindow();
    if (!win || win.closed) throw omaHttpError(409, "no-main-window", "Zotero's main window is not open");
    win.Zotero_Tabs.select("zotero-pane");
    await win.ZoteroPane.collectionsView.selectCollection(entry.id);
    return { windowKind: "main", windowTitle: win.document.title, collection: OmaCollections.row(entry) };
  },
};
