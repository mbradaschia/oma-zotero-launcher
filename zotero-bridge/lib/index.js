/* In-memory search index over every library's top-level regular items and
 * standalone file attachments, kept current through Zotero.Notifier. */
/* global Zotero, OmaSearch, OmaNoteFormat, OmaRankings, OmaNotes, setTimeout, clearTimeout */

var OmaIndex = class {
  constructor() {
    this.entries = [];
    this._pos = new Map(); // itemID -> index in entries
    this._parentOf = new Map(); // child (attachment/note) itemID -> parent itemID
    this._pending = new Set();
    this._timer = null;
    this._observerID = null;
    this.ready = null;
    this.version = 0; // bumped on every change; invalidates search narrowing caches
    this.stats = { builtAt: null, buildMs: null, loadMs: null, count: 0, libraries: 0, updates: 0 };
  }

  get byId() {
    return { get: (id) => (this._pos.has(id) ? this.entries[this._pos.get(id)] : undefined) };
  }

  build() {
    this.ready = this._build();
    return this.ready;
  }

  async _build() {
    const t0 = Date.now();
    let loadMs = 0;
    let libraries = 0;
    const entries = [];
    this._parentOf.clear();
    for (const lib of Zotero.Libraries.getAll()) {
      if (lib.libraryType === "feed") continue;
      libraries++;
      const tLoad = Date.now();
      await lib.waitForDataLoad("item");
      const ids = await Zotero.Items.getAll(lib.libraryID, true, false, true);
      const items = Zotero.Items.get(ids);
      await this._ensureLoaded(items);
      loadMs += Date.now() - tLoad;
      for (const item of items) {
        const entry = this.entryFor(item);
        if (entry) entries.push(entry);
      }
    }
    this.entries = entries;
    this.version++;
    this._pos = new Map(entries.map((e, i) => [e.id, i]));
    this.stats = {
      builtAt: new Date().toISOString(),
      buildMs: Date.now() - t0,
      loadMs,
      count: entries.length,
      libraries,
      updates: 0,
    };
    Zotero.debug(`[oma-zotero] index: ${entries.length} entries in ${this.stats.buildMs} ms (data load ${loadMs} ms)`);
    return this;
  }

  // waitForDataLoad("item") covers primary data; child relations and tags may be lazy.
  async _ensureLoaded(items) {
    const probe = items.find((i) => i.isRegularItem());
    if (!probe) return;
    for (const [dataType, touch] of [["childItems", (i) => i.getAttachments()], ["tags", (i) => i.getTags()]]) {
      try {
        touch(probe);
      } catch (e) {
        Zotero.debug(`[oma-zotero] loading ${dataType} for ${items.length} items`);
        await Zotero.Items.loadDataTypes(items, [dataType]);
      }
    }
  }

  entryFor(item) {
    try {
      const regular = item.isRegularItem();
      const standaloneFile = !regular && item.isFileAttachment() && item.isTopLevelItem();
      if ((!regular && !standaloneFile) || item.deleted) return null;

      let creators = [];
      let pdfCount = 0;
      let attachmentCount = 0;
      let noteCount = 0;
      let extracted = false;
      let year = null;
      let publication = "";
      let abstract = "";
      let rank = null;
      if (regular) {
        creators = item.getCreatorsJSON().map((c) => c.name || [c.lastName, c.firstName].filter(Boolean).join(", "));
        const attIDs = item.getAttachments(false);
        attachmentCount = attIDs.length;
        for (const att of Zotero.Items.get(attIDs)) {
          this._parentOf.set(att.id, item.id);
          if (att.isPDFAttachment()) pdfCount++;
        }
        // Your notes: the extracted text (a note too, tagged) isn't counted, only marked (extracted).
        const noteIDs = item.getNotes(false);
        const fulltextTag = typeof OmaNotes !== "undefined" ? OmaNotes.FULLTEXT_TAG : "oma-fulltext";
        for (const note of Zotero.Items.get(noteIDs)) {
          if (typeof note.hasTag === "function" && note.hasTag(fulltextTag)) extracted = true;
          else noteCount++;
        }
        for (const id of noteIDs) this._parentOf.set(id, item.id);
        const y = String(item.getField("year") || "");
        year = /^\d{4}$/.test(y) ? Number(y) : null;
        const field = (f) => {
          try {
            return item.getField(f, false, true) || "";
          } catch (e) {
            return ""; // not a field of this item type
          }
        };
        publication = field("publicationTitle");
        abstract = field("abstractNote");
        if (typeof OmaRankings !== "undefined") rank = OmaRankings.lookup({ issn: field("ISSN"), publication, abbreviation: field("journalAbbreviation") });
      } else if (item.isPDFAttachment()) {
        pdfCount = 1;
      }

      return OmaSearch.prepareEntry({
        id: item.id,
        key: item.key,
        libraryID: item.libraryID,
        itemType: item.itemType,
        title: OmaNoteFormat.plainTitle(item.getDisplayTitle()),
        creator: regular ? item.getField("firstCreator", true) : "",
        creators,
        year,
        publication,
        abstract,
        rank,
        dateAdded: item.dateAdded,
        dateModified: item.dateModified,
        pdfCount,
        attachmentCount,
        noteCount,
        extracted,
        tags: Array.from(new Set(item.getTags().map((t) => t.tag))),
      });
    } catch (e) {
      Zotero.logError(e);
      return null;
    }
  }

  startObserving() {
    if (this._observerID) return;
    this._observerID = Zotero.Notifier.registerObserver(
      {
        notify: (event, type, ids, extraData) => {
          for (const raw of ids) {
            // item-tag ids look like "<itemID>-<tagID>"
            const id = type === "item-tag" ? parseInt(String(raw).split("-")[0], 10) : Number(raw);
            if (Number.isInteger(id)) this._pending.add(id);
          }
          this._schedule();
        },
      },
      ["item", "item-tag", "trash"],
      "oma-zotero"
    );
  }

  stopObserving() {
    if (this._observerID) Zotero.Notifier.unregisterObserver(this._observerID);
    this._observerID = null;
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }

  _schedule() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      const ids = Array.from(this._pending);
      this._pending.clear();
      for (const id of ids) this._refresh(id, 0);
    }, 200);
  }

  _refresh(id, depth) {
    if (depth > 2) return;
    this.stats.updates++;
    const item = Zotero.Items.get(id);
    if (!item) {
      this._remove(id);
      const parent = this._parentOf.get(id);
      this._parentOf.delete(id);
      if (parent) this._refresh(parent, depth + 1);
      return;
    }
    if (!item.isTopLevelItem()) {
      this._parentOf.set(id, item.parentItemID);
      if (!this._pos.has(id)) this._refresh(item.parentItemID, depth + 1);
      return;
    }
    const entry = this.entryFor(item);
    if (entry) this._upsert(entry);
    else this._remove(id);
  }

  _upsert(entry) {
    this.version++;
    const i = this._pos.get(entry.id);
    if (i === undefined) {
      this._pos.set(entry.id, this.entries.length);
      this.entries.push(entry);
    } else {
      this.entries[i] = entry;
    }
  }

  _remove(id) {
    const i = this._pos.get(id);
    if (i === undefined) return;
    this.version++;
    const last = this.entries.pop();
    if (i < this.entries.length) {
      this.entries[i] = last;
      this._pos.set(last.id, i);
    }
    this._pos.delete(id);
  }
};
