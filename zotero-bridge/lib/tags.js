/* Tags for the overlay's tag editor: the library's tags with counts and colors,
 * an item's tags, and add/remove edits that Zotero's Edit → Undo can revert. And tags in
 * the launcher's search, like collections: the ones matching what you type, and a search
 * scoped to one tag's papers. compare(), cleanNames() and the search helpers are pure
 * (node-tested). */
/* global Zotero, omaHttpError, OmaSearch */

var OmaTags = {
  MAX_LENGTH: 255, // Zotero.Tags.MAX_SYNC_LENGTH: longer tags don't sync
  MAX_PER_REQUEST: 50,
  MAX_SHOWN: 3, // tags listed above the papers while typing
  _search: null, // { version, entries }

  // Every tag on an indexed paper, per library, with how many papers carry it: search
  // entries (the name is the title), rebuilt when the index changes.
  searchEntries(index) {
    if (OmaTags._search && OmaTags._search.version === index.version && OmaTags._search.index === index) return OmaTags._search.entries;
    const byKey = new Map();
    for (const e of index.entries) {
      for (const name of e.tags || []) {
        const k = e.libraryID + "\u0000" + name;
        const t = byKey.get(k) || { name, libraryID: e.libraryID, count: 0 };
        t.count++;
        byKey.set(k, t);
      }
    }
    const entries = Array.from(byKey.values())
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .map((t, i) => OmaSearch.prepareEntry({ kind: "tag", id: -1 - i, key: t.name, libraryID: t.libraryID, name: t.name, title: t.name, count: t.count, creators: [], year: null, publication: "", tags: [] }));
    OmaTags._search = { version: index.version, index, entries };
    return entries;
  },

  // A tag as a search row.
  row(entry, extra) {
    return Object.assign({ kind: "tag", key: entry.name, libraryID: entry.libraryID, itemType: "tag", title: entry.name, name: entry.name, count: entry.count }, extra || {});
  },

  // The words of a query that could name a tag: "#" and "tag:" dropped, and without other
  // fields (a:…, c:"…"), exclusions (!x, NOT x, NOT (…)), operators, parentheses and quotes.
  tagWords(query) {
    return String(query)
      .replace(/(^|[\s(])tag:/gi, "$1#")
      .replace(/\bNOT\s+("[^"]*"?|\([^)]*\)?|\S+)/g, " ")
      .replace(/(^|[\s(])!("[^"]*"?|\S+)/g, "$1 ")
      .replace(/\b[a-z]+:("[^"]*"?|\S*)/gi, " ")
      .replace(/(^|[\s("])#/g, "$1")
      .replace(/\b(AND|OR)\b/g, " ")
      .replace(/[()|"]/g, " ");
  },

  // Tags matching the query, best first: each typed word is in the name (tags are short,
  // and many look alike, so letters scattered through a long tag don't count); "#" is optional.
  search(index, query, limit) {
    const q = OmaTags.tagWords(query);
    const words = q.split(/\s+/).map(OmaSearch.fold).filter(Boolean);
    if (!words.length) return [];
    const entries = OmaTags.searchEntries(index).filter((e) => words.every((w) => e._t.includes(w)));
    const res = OmaSearch.search(entries, OmaSearch.parseQuery(q), { limit: limit || OmaTags.MAX_SHOWN });
    return res.results.map((h) => OmaTags.row(h.entry, { titleRanges: h.titleRanges }));
  },

  findEntry(index, name, libraryID) {
    const lib = libraryID == null ? 1 : Number(libraryID);
    return OmaTags.searchEntries(index).find((e) => e.name === String(name) && e.libraryID === lib) || null;
  },

  // The indexed papers carrying the tag (in its library).
  papers(index, entry) {
    return index.entries.filter((e) => e.libraryID === entry.libraryID && (e.tags || []).includes(entry.name));
  },

  // Colored tags first (in their color-slot order), then the most used, then by name.
  compare(a, b) {
    const ca = a.position == null ? Infinity : a.position;
    const cb = b.position == null ? Infinity : b.position;
    if (ca !== cb) return ca < cb ? -1 : 1;
    if ((b.count || 0) !== (a.count || 0)) return (b.count || 0) - (a.count || 0);
    const na = String(a.tag).toLowerCase();
    const nb = String(b.tag).toLowerCase();
    return na < nb ? -1 : na > nb ? 1 : 0;
  },

  _colorOf(colors, name) {
    const c = colors && colors.get(name);
    return c ? { color: c.color, position: c.position } : { color: null, position: null };
  },

  // Every tag in use in the library (plus colored tags, which exist even when unused):
  // [{ tag, types: [0|1…], count, color, position }], sorted by compare().
  async list(libraryID) {
    const rows = await Zotero.DB.queryAsync(
      "SELECT T.name AS name, IT.type AS type, COUNT(*) AS n FROM itemTags IT " +
        "JOIN tags T USING (tagID) JOIN items I USING (itemID) " +
        "WHERE I.libraryID = ? AND IT.itemID NOT IN (SELECT itemID FROM deletedItems) " +
        "GROUP BY T.name, IT.type",
      [libraryID]
    );
    const colors = Zotero.Tags.getColors(libraryID);
    const byName = new Map();
    for (const r of rows || []) {
      const t = byName.get(r.name) || Object.assign({ tag: r.name, types: [], count: 0 }, OmaTags._colorOf(colors, r.name));
      t.count += r.n;
      if (!t.types.includes(r.type)) t.types.push(r.type);
      byName.set(r.name, t);
    }
    for (const [name, c] of colors) {
      if (!byName.has(name)) byName.set(name, { tag: name, types: [], count: 0, color: c.color, position: c.position });
    }
    return Array.from(byName.values())
      .map((t) => Object.assign(t, { types: t.types.sort() }))
      .sort(OmaTags.compare);
  },

  // The item's tags, one per name (Zotero can hold a name twice, once per type; manual wins).
  itemTags(item) {
    const colors = Zotero.Tags.getColors(item.libraryID);
    const byName = new Map();
    for (const t of item.getTags()) {
      const type = t.type || 0;
      const prev = byName.get(t.tag);
      if (!prev || type < prev.type) byName.set(t.tag, Object.assign({ tag: t.tag, type }, OmaTags._colorOf(colors, t.tag)));
    }
    return Array.from(byName.values()).sort(OmaTags.compare);
  },

  // Validate a list of tag names from a request: trimmed, unique, 1–255 chars, one line.
  cleanNames(list, field) {
    if (list == null) return [];
    if (!Array.isArray(list)) throw omaHttpError(400, "bad-tags", `${field} must be an array of tag names`);
    if (list.length > OmaTags.MAX_PER_REQUEST) throw omaHttpError(400, "bad-tags", `at most ${OmaTags.MAX_PER_REQUEST} tags per request`);
    const out = [];
    for (const raw of list) {
      if (typeof raw !== "string") throw omaHttpError(400, "bad-tags", `${field} must be an array of tag names`);
      const name = raw.trim();
      if (!name) throw omaHttpError(400, "bad-tags", "a tag name can't be empty");
      if (/[\r\n]/.test(name)) throw omaHttpError(400, "bad-tags", "a tag name can't contain line breaks");
      if (name.length > OmaTags.MAX_LENGTH) throw omaHttpError(400, "bad-tags", `a tag name can't be longer than ${OmaTags.MAX_LENGTH} characters`);
      if (!out.includes(name)) out.push(name);
    }
    return out;
  },

  // ---- what changes in Zotero, for the launcher's status lists (s/…, t/…)

  // Prefixed tags only ("s/reading", "t/Next": a short prefix and a slash); the log is the bridge's
  // memory since it started (a list read at the launcher's opening covers before that).
  PREFIXED: /^[a-z]{1,3}\//i,
  MAX_CHANGES: 500,
  changes: { seq: 0, log: [] },
  _observerID: null,

  record(change) {
    const c = OmaTags.changes;
    const last = c.log[c.log.length - 1];
    if (last && last.kind === change.kind && last.name === change.name && last.from === change.from) return; // one per batch
    c.seq++;
    c.log.push(Object.assign({ seq: c.seq }, change));
    if (c.log.length > OmaTags.MAX_CHANGES) c.log.splice(0, c.log.length - OmaTags.MAX_CHANGES);
  },

  // Zotero's notifier, as tags.js sends it: a rename is "modify item-tag" with { tag, old: { tag } },
  // a tag on an item "add item-tag" with { tag }, a tag gone from the library "delete tag" with
  // { old: { tag } }.
  notify(event, type, ids, extraData) {
    for (const id of ids || []) {
      const d = (extraData && extraData[id]) || {};
      if (type === "item-tag" && event === "modify" && d.old && d.old.tag && d.tag && d.old.tag !== d.tag) {
        if (OmaTags.PREFIXED.test(d.old.tag) || OmaTags.PREFIXED.test(d.tag)) OmaTags.record({ kind: "rename", from: d.old.tag, name: d.tag });
      } else if (type === "item-tag" && event === "add" && d.tag && OmaTags.PREFIXED.test(d.tag)) {
        OmaTags.record({ kind: "add", name: d.tag });
      } else if (type === "tag" && event === "delete" && d.old && d.old.tag && OmaTags.PREFIXED.test(d.old.tag)) {
        OmaTags.record({ kind: "delete", name: d.old.tag });
      }
    }
  },

  startObserving() {
    if (OmaTags._observerID) return;
    OmaTags._observerID = Zotero.Notifier.registerObserver({ notify: OmaTags.notify }, ["item-tag", "tag"], "oma-zotero-tags");
  },

  stopObserving() {
    if (OmaTags._observerID) Zotero.Notifier.unregisterObserver(OmaTags._observerID);
    OmaTags._observerID = null;
  },

  changesSince(since) {
    const n = Number(since) || 0;
    return { seq: OmaTags.changes.seq, changes: OmaTags.changes.log.filter((c) => c.seq > n) };
  },

  // Every tag with one of these prefixes that's on an item (not in the trash), in any library
  // ("s/" → s/reading, s/read…), by name. Zotero keeps a tag no item has until it purges it: not those.
  async prefixed(prefixes) {
    const out = new Set();
    for (const p of prefixes) {
      const rows = await Zotero.DB.queryAsync(
        "SELECT DISTINCT T.name AS name FROM tags T JOIN itemTags IT USING (tagID) " +
          "WHERE substr(T.name, 1, ?) = ? COLLATE NOCASE AND IT.itemID NOT IN (SELECT itemID FROM deletedItems)",
        [p.length, p]
      );
      for (const r of rows || []) out.add(r.name);
    }
    return Array.from(out).sort();
  },

  // A tag across your libraries (the ones you can edit): [{ libraryID, tagID, ids }] where items
  // carry it. Renaming or deleting a status's tag, or a tag from the tag editor, acts on all of them.
  async whereIs(name) {
    const tagID = Zotero.Tags.getID(name);
    if (!tagID) return [];
    const out = [];
    for (const lib of Zotero.Libraries.getAll()) {
      if (!lib.editable) continue;
      const ids = await Zotero.Tags.getTagItems(lib.libraryID, tagID);
      if (ids && ids.length) out.push({ libraryID: lib.libraryID, tagID, ids: Array.from(ids) });
    }
    return out;
  },

  async countEverywhere(name) {
    const where = await OmaTags.whereIs(name);
    return { name, count: where.reduce((n, w) => n + w.ids.length, 0) };
  },

  // The papers carrying a tag (a note's or a file's: its paper), each once, in your editable libraries,
  // at most `limit`: [{ key, libraryID, title, creator, year }] (turning a tag into a task status gives
  // each its default task). byId: the search index's entries, for the paper's creator and year.
  async papersWith(name, limit, byId) {
    const out = [];
    const seen = new Set();
    for (const w of await OmaTags.whereIs(name)) {
      for (const item of Zotero.Items.get(w.ids)) {
        if (!item || item.deleted) continue;
        const paper = item.parentItemID ? Zotero.Items.get(item.parentItemID) : item;
        if (!paper || !paper.isRegularItem() || seen.has(paper.id)) continue;
        seen.add(paper.id);
        const e = byId ? byId.get(paper.id) : null;
        out.push({ key: paper.key, libraryID: paper.libraryID, title: e ? e.title : paper.getDisplayTitle(), creator: e ? e.creator || "" : "", year: e && e.year ? String(e.year) : "" });
        if (out.length >= limit) return out;
      }
    }
    return out;
  },

  // Zotero's own rename (into an existing tag, it merges): one step per library. → the items touched.
  // Each checks its work and goes once more over what still has the old tag (a save of one of the
  // items racing it can write the old tag back); count is what changed, left what still has it.
  async renameEverywhere(from, to) {
    if (from === to) throw omaHttpError(400, "bad-tags", "the new name is the same");
    return OmaTags._everywhere(from, (w) => Zotero.Tags.rename(w.libraryID, from, to), { from, to });
  },

  async deleteEverywhere(name) {
    return OmaTags._everywhere(name, (w) => Zotero.Tags.removeFromLibrary(w.libraryID, [w.tagID]), { name });
  },

  async _everywhere(name, act, out) {
    const where = await OmaTags.whereIs(name);
    for (const w of where) await act(w);
    let left = await OmaTags.whereIs(name);
    if (left.length) {
      for (const w of left) await act(w);
      left = await OmaTags.whereIs(name);
    }
    const ids = where.flatMap((w) => w.ids);
    const leftIds = new Set(left.flatMap((w) => w.ids));
    return Object.assign(out, { count: ids.filter((id) => !leftIds.has(id)).length, left: leftIds.size, ids });
  },

  // Can the user edit this item's tags? Zotero's own isEditable() says yes for feed
  // items (Zotero itself writes their read state), so check the library flag too.
  editable(item) {
    const lib = Zotero.Libraries.get(item.libraryID);
    return !!(lib && lib.editable && item.isEditable());
  },

  // Add (as manual tags) and remove tags on one item, in one undoable save.
  async update(item, add, remove) {
    if (!OmaTags.editable(item)) {
      const lib = Zotero.Libraries.get(item.libraryID);
      throw omaHttpError(409, "read-only", `“${lib ? lib.name : "This library"}” is read-only`);
    }
    const both = add.filter((t) => remove.includes(t));
    if (both.length) throw omaHttpError(400, "bad-tags", `“${both[0]}” is both added and removed`);
    const had = new Set(item.getTags().map((t) => t.tag));
    const removed = remove.filter((name) => item.removeTag(name));
    const added = add.filter((name) => !had.has(name) && item.addTag(name, 0));
    if (added.length || removed.length) {
      // Zotero's own undo labels (en-US): "Add Tag", "Remove Tag", "Remove N Tags", "Change Tag".
      let undoAction = "undo-action-change-tag";
      let count = 1;
      if (!removed.length) undoAction = "undo-action-add-tag";
      else if (!added.length) {
        undoAction = removed.length > 1 ? "undo-action-remove-tags-from-item" : "undo-action-remove-tag";
        count = removed.length;
      }
      await item.saveTx({ undoAction, undoActionArgs: { count } });
    }
    return { added, removed, tags: OmaTags.itemTags(item) };
  },
};

if (typeof module !== "undefined") module.exports = OmaTags;
