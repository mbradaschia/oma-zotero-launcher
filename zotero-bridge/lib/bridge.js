/* Omarchy Zotero Bridge: routes, auth and the token handshake file.
 *
 * Security model (see PLAN.md §5.2): Zotero's own server already refuses a
 * wrong Host header and drops browser-looking requests (Mozilla UA / Origin)
 * that lack Zotero-Allowed-Request. On top of that, every route here:
 *   - refuses any request carrying an Origin header (403)
 *   - requires `Authorization: Bearer <token>` (401); the token is published
 *     only in $XDG_RUNTIME_DIR/oma-zotero/bridge.json (0600, dir 0700)
 *   - caps the body size (413) and accepts JSON only
 */
/* global Zotero, Services, IOUtils, PathUtils, Components, crypto, OmaIndex, OmaSearch, OmaTabs, OmaActions, OmaNotes, OmaNoteFormat, OmaTags, OmaDev, OmaAnnotations, OmaFulltext, OmaCite */

var OMA_JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

// High-resolution clock in ms. `performance` is not a sandbox global here and
// ChromeUtils has no now() in Gecko 140; Components.utils.now() is the chrome one.
function omaNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  try {
    return Components.utils.now();
  } catch (e) {
    return Date.now();
  }
}

function omaHttpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

function omaReply(status, error) {
  return [status, OMA_JSON_HEADERS, JSON.stringify({ ok: false, error })];
}

var OmaBridge = class {
  static PREFIX = "/oma-zotero";
  static PREF = "extensions.oma-zotero-bridge.";
  static MAX_BODY = 64 * 1024;
  static MAX_PINS = 50;

  constructor({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    this.active = false;
    this.routes = new Map();
    this.index = null;
    this.token = null;
    this.handshakePath = null;
  }

  get dev() {
    return Services.prefs.getBoolPref(OmaBridge.PREF + "dev", false);
  }

  async start() {
    this.active = true;
    this._devHygiene();
    this.token = this._ensureToken();
    this.index = new OmaIndex();
    this.index
      .build()
      .then(() => this.index.startObserving())
      .catch((e) => Zotero.logError(e));

    this.route("GET", "/ping", this.ping);
    this.route("POST", "/search", this.search);
    this.route("POST", "/open", this.open);
    this.route("POST", "/reveal", this.reveal);
    this.route("POST", "/item", this.itemDetails);
    this.route("POST", "/attachment", this.attachment);
    this.route("POST", "/note", this.note);
    this.route("POST", "/tags/list", this.tagList);
    this.route("POST", "/tags/update", this.tagUpdate);
    // For the prompt runner (daemon/): what a paper says, and notes written back.
    OmaNotes.registerRoutes(this);
    for (const mod of [OmaAnnotations, OmaFulltext, OmaCite]) mod.register(this);
    // dev.js is left out of release builds (scripts/build-xpi.sh)
    if (this.dev && typeof OmaDev !== "undefined") OmaDev.register(this);

    await this._writeHandshake();
    Zotero.debug(`[oma-zotero] bridge ${this.version} started (dev=${this.dev}, routes=${this.routes.size})`);
  }

  async stop() {
    this.active = false;
    for (const [path, cls] of this.routes) {
      if (Zotero.Server.Endpoints[path] === cls) delete Zotero.Server.Endpoints[path];
    }
    this.routes.clear();
    if (this.index) this.index.stopObserving();
    if (this.handshakePath) {
      try {
        await IOUtils.remove(this.handshakePath, { ignoreAbsent: true });
      } catch (e) {
        Zotero.logError(e);
      }
    }
    Zotero.debug("[oma-zotero] bridge stopped");
  }

  route(method, path, handler) {
    const bridge = this;
    const full = OmaBridge.PREFIX + path;
    const Endpoint = class {
      supportedMethods = [method];
      supportedDataTypes = ["application/json"];
      // Arity 1: Zotero passes { method, pathname, pathParams, searchParams, headers, data }.
      init = (req) => bridge._handle(req, handler);
    };
    Zotero.Server.Endpoints[full] = Endpoint;
    this.routes.set(full, Endpoint);
  }

  async _handle(req, handler) {
    if (!this.active) return omaReply(503, { code: "inactive", message: "bridge is not running" });
    if (req.headers.origin) return omaReply(403, { code: "origin", message: "browser-origin requests are refused" });
    if (!this._tokenOk(req.headers.authorization)) return omaReply(401, { code: "token", message: "missing or invalid bearer token" });
    if (Number(req.headers["content-length"] || 0) > OmaBridge.MAX_BODY) {
      return omaReply(413, { code: "too-large", message: "request body too large" });
    }
    const t0 = Date.now();
    try {
      const data = req.data && typeof req.data === "object" && !Array.isArray(req.data) ? req.data : {};
      const body = await handler.call(this, data, req);
      return [200, OMA_JSON_HEADERS, JSON.stringify(Object.assign({ ok: true }, body, { tookMs: Date.now() - t0 }))];
    } catch (e) {
      if (!e.status) Zotero.logError(e);
      return omaReply(e.status || 500, { code: e.code || "internal", message: String((e && e.message) || e) });
    }
  }

  // ---------------------------------------------------------------- routes

  async ping() {
    return {
      bridgeVersion: this.version,
      zoteroVersion: Zotero.version,
      dev: this.dev,
      index: this.index.stats,
      openCount: OmaTabs.openItems().length,
    };
  }

  // What an empty query shows, from the shell's settings (emptyQuery in
  // ~/.config/omarchy/oma-zotero-launcher.json); anything missing or invalid gets the default.
  static emptyQueryOptions(raw, recentDefault = 15) {
    const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const n = parseInt(o.recentLimit, 10);
    return {
      showOpen: o.showOpen !== false,
      tabOrder: o.tabOrder === "tabbar" ? "tabbar" : "mru",
      recent: ["added", "modified", "none"].includes(o.recent) ? o.recent : "added",
      recentLimit: Math.max(0, Math.min(50, Number.isNaN(n) ? recentDefault : n)),
    };
  }

  // The items the shell pinned ([{ key, libraryID }], its pins file), as top-level item IDs
  // in pin order; unknown, trashed and duplicate ones are dropped.
  static pinnedIDs(pinned) {
    const out = [];
    const seen = new Set();
    for (const p of (Array.isArray(pinned) ? pinned : []).slice(0, OmaBridge.MAX_PINS)) {
      if (!p || !/^[A-Z0-9]{8}$/.test(String(p.key))) continue;
      const lib = p.libraryID == null ? Zotero.Libraries.userLibraryID : Number(p.libraryID);
      const id = Number.isInteger(lib) ? Zotero.Items.getIDFromLibraryAndKey(lib, String(p.key)) : false;
      const item = id ? Zotero.Items.get(id) : null;
      if (!item || item.deleted) continue;
      const top = item.parentItemID || item.id;
      if (!seen.has(top)) {
        seen.add(top);
        out.push(top);
      }
    }
    return out;
  }

  async search({ query = "", limit = 60, emptyQuery = null, pinned = null }) {
    if (this.dev && typeof OmaDev !== "undefined" && OmaDev.searchDelayMs) await Zotero.Promise.delay(OmaDev.searchDelayMs);
    await this.index.ready;
    query = String(query).slice(0, 500);
    limit = Math.max(1, Math.min(200, parseInt(limit, 10) || 60));
    const open = OmaTabs.openItems();
    const openByTop = new Map(open.map((o, i) => [o.topItemID, Object.assign({ rank: i }, o)]));

    if (!query.trim()) {
      const eq = OmaBridge.emptyQueryOptions(emptyQuery, Services.prefs.getIntPref(OmaBridge.PREF + "recentLimit", 15));
      const shownOpen = !eq.showOpen ? [] : eq.tabOrder === "tabbar" ? OmaTabs.openItems({ order: "tabbar" }) : open;
      const pinnedIDs = OmaBridge.pinnedIDs(pinned);
      const pinnedRows = pinnedIDs.map((id) => this._rowForItemID(id, openByTop.get(id) || null)).filter(Boolean);
      const skip = new Set(shownOpen.map((o) => o.topItemID).concat(pinnedIDs));
      const by = eq.recent === "modified" ? "dateModified" : "dateAdded";
      const recent =
        eq.recent === "none"
          ? []
          : this.index.entries
              .filter((e) => !skip.has(e.id))
              .sort((a, b) => (a[by] < b[by] ? 1 : a[by] > b[by] ? -1 : 0))
              .slice(0, eq.recentLimit)
              .map((e) => this._row(e, openByTop.get(e.id) || null));
      const openRows = shownOpen
        .filter((o) => !pinnedIDs.includes(o.topItemID))
        .map((o) => this._rowForItemID(o.topItemID, openByTop.get(o.topItemID)))
        .filter(Boolean);
      return { query, pinned: pinnedRows, open: openRows, recent, recentBy: eq.recent, emptyQuery: eq, results: [], total: 0 };
    }

    const t0 = omaNow();
    const openRank = new Map(open.map((o, i) => [o.topItemID, i]));
    const { results, total, candidates } = this._search(query, { limit, openRank });
    const searchMs = Math.round((omaNow() - t0) * 100) / 100;
    const rows = results.map((h) =>
      this._row(h.entry, openByTop.get(h.entry.id), { score: Math.round(h.score), titleRanges: h.titleRanges })
    );
    return { query, pinned: [], open: [], recent: [], results: rows, total, searchMs, candidates };
  }

  // Enter: switch to the item's tab/window, else open it (reader / note editor),
  // else select it in the library. `dryRun` returns the plan without acting.
  async open({ key, libraryID, dryRun = false }) {
    const item = await this._item(key, libraryID);
    const plan = OmaActions.plan(await OmaActions.describe(item), OmaTabs.list());
    if (dryRun) return { dryRun: true, action: plan.action, plan, item: this._itemInfo(item) };
    const result = await OmaActions.execute(plan);
    return Object.assign({ action: plan.action, item: this._itemInfo(item) }, result);
  }

  // Show the item (or attachment/note) selected in the library tab.
  async reveal({ key, libraryID, dryRun = false }) {
    const item = await this._item(key, libraryID);
    const plan = { action: "select", itemID: item.id };
    if (dryRun) return { dryRun: true, action: plan.action, plan, item: this._itemInfo(item) };
    const result = await OmaActions.execute(plan);
    return Object.assign({ action: plan.action, item: this._itemInfo(item) }, result);
  }

  // What the actions view needs: what Enter would do, the item's files, notes and
  // tags, and whether its library can be edited.
  async itemDetails({ key, libraryID }) {
    const item = await this._item(key, libraryID);
    const plan = OmaActions.plan(await OmaActions.describe(item), OmaTabs.list());
    const notes = OmaNotes.list(item);
    const tags = OmaTags.itemTags(item);
    const library = Zotero.Libraries.get(item.libraryID);
    return {
      item: this._itemInfo(item),
      openAction: plan.action,
      attachments: await OmaActions.fileAttachments(item),
      notes,
      noteCount: item.isRegularItem() ? notes.length : 0,
      tags,
      tagCount: tags.length,
      library: { libraryID: item.libraryID, name: library.name, type: library.libraryType, editable: OmaTags.editable(item) },
    };
  }

  // One note as Markdown. format "display" (default): cleaned for the overlay and
  // size-capped, web links in `linkColor` if given; "export": exactly what Zotero's
  // Export Note → Markdown gives (for copying).
  async note({ key, libraryID, format = "display", linkColor = null }) {
    const note = await this._item(key, libraryID);
    if (!note.isNote()) throw omaHttpError(400, "not-a-note", "not a note");
    if (format !== "display" && format !== "export") throw omaHttpError(400, "bad-format", 'format must be "display" or "export"');
    const parent = note.parentItemID ? Zotero.Items.get(note.parentItemID) : null;
    const base = {
      key: note.key,
      libraryID: note.libraryID,
      title: OmaNoteFormat.plainTitle(note.getNoteTitle()),
      dateModified: note.dateModified,
      parent: parent ? this._itemInfo(parent) : null,
      paper: parent ? OmaBridge.paperInfo(parent) : null,
    };
    if (format === "export") {
      const markdown = await OmaNotes.exportMarkdown(note);
      if (markdown === null) throw omaHttpError(500, "export-failed", "Zotero couldn't convert the note to Markdown");
      return Object.assign(base, { format: "markdown", markdown, truncated: false, chars: markdown.length });
    }
    return Object.assign(base, await OmaNotes.forDisplay(note, { linkColor: /^#[0-9a-f]{6}$/i.test(String(linkColor)) ? linkColor : null }));
  }

  // The library's tags for the tag editor (colored first, then most used).
  async tagList({ libraryID }) {
    const lib = libraryID == null ? Zotero.Libraries.userLibraryID : Number(libraryID);
    if (!Number.isInteger(lib) || !Zotero.Libraries.exists(lib)) throw omaHttpError(400, "bad-library", "unknown libraryID");
    const library = Zotero.Libraries.get(lib);
    return { libraryID: lib, editable: library.editable, tags: await OmaTags.list(lib) };
  }

  // Add/remove tags on one item; undoable from Zotero's Edit menu.
  async tagUpdate({ key, libraryID, add, remove }) {
    const item = await this._item(key, libraryID);
    const toAdd = OmaTags.cleanNames(add, "add");
    const toRemove = OmaTags.cleanNames(remove, "remove");
    if (!toAdd.length && !toRemove.length) throw omaHttpError(400, "bad-tags", "nothing to add or remove");
    const result = await OmaTags.update(item, toAdd, toRemove);
    return Object.assign({ item: this._itemInfo(item) }, result);
  }

  // One file attachment: target "path" → its path (the shell launches the external
  // viewer; like Zotero, this counts as opening it unless markOpened is false),
  // target "window" → open it in a separate Zotero reader window.
  async attachment({ key, libraryID, target, markOpened = true, dryRun = false }) {
    const att = await this._item(key, libraryID);
    if (!att.isAttachment() || !att.isFileAttachment()) throw omaHttpError(400, "not-a-file", "not a file attachment");
    if (target !== "path" && target !== "window") throw omaHttpError(400, "bad-target", 'target must be "path" or "window"');
    const path = await att.getFilePathAsync();
    if (!path) throw omaHttpError(409, "missing-file", "the file is missing from disk");
    const info = { key: att.key, contentType: att.attachmentContentType || "", readerType: att.attachmentReaderType || null };
    if (target === "path") {
      if (markOpened && !dryRun) await Zotero.Notifier.trigger("open", "file", att.id);
      return Object.assign({ path }, info);
    }
    if (!OmaActions.READER_TYPES.includes(info.readerType)) throw omaHttpError(409, "no-reader", "Zotero's reader can't open this file type");
    if (dryRun) return Object.assign({ dryRun: true, action: "open-window" }, info);
    OmaTabs.pruneDeadReaderWindows();
    // allowDuplicate: without it Reader.open selects an existing (unloaded) tab instead of opening a window.
    const reader = await Zotero.Reader.open(att.id, null, { openInWindow: true, allowDuplicate: true });
    const title = reader && omaWindowAlive(reader._window) ? reader._window.document.title : null;
    return Object.assign({ windowKind: "reader", windowTitle: title }, info);
  }

  // The item for a request (validated, loaded — feed libraries load lazily — and not trashed).
  async _item(key, libraryID) {
    key = String(key == null ? "" : key);
    if (!/^[A-Z0-9]{8}$/.test(key)) throw omaHttpError(400, "bad-key", "key must be 8 characters A-Z/0-9");
    const lib = libraryID == null ? Zotero.Libraries.userLibraryID : Number(libraryID);
    if (!Number.isInteger(lib) || !Zotero.Libraries.exists(lib)) throw omaHttpError(400, "bad-library", "unknown libraryID");
    const item = await Zotero.Items.getByLibraryAndKeyAsync(lib, key);
    if (!item) throw omaHttpError(404, "not-found", "no item with that key");
    // Other libraries are fully loaded at startup; feed items load on demand.
    if (Zotero.Libraries.get(lib).libraryType === "feed") await item.loadAllData();
    if (item.isInTrash()) throw omaHttpError(409, "trashed", "the item is in the trash");
    return item;
  }

  _itemInfo(item) {
    return {
      key: item.key,
      libraryID: item.libraryID,
      itemType: item.itemType,
      title: OmaNoteFormat.plainTitle(item.isNote() ? item.getNoteTitle() : item.getDisplayTitle()),
    };
  }

  // Search with fzf-style narrowing: while the user keeps typing, each query only
  // rescans the previous query's matches (OmaSearch.canNarrow decides when that
  // is exact). One cache per bridge; any index change invalidates it.
  _search(query, opts) {
    const parsed = OmaSearch.parseQuery(query);
    const cache = this._searchCache;
    const narrow = cache && cache.version === this.index.version && OmaSearch.canNarrow(cache.parsed, parsed);
    const candidates = narrow ? cache.matched : this.index.entries;
    const res = OmaSearch.search(candidates, parsed, Object.assign({ collectMatches: true }, opts));
    this._searchCache = parsed.groups.length ? { parsed, matched: res.matched, version: this.index.version } : null;
    return { results: res.results, total: res.total, candidates: candidates.length };
  }

  // ---------------------------------------------------------------- helpers

  _row(entry, open, extra) {
    return Object.assign(
      {
        key: entry.key,
        libraryID: entry.libraryID,
        itemType: entry.itemType,
        title: entry.title,
        creator: entry.creator,
        year: entry.year,
        publication: entry.publication,
        pdfCount: entry.pdfCount,
        noteCount: entry.noteCount,
        tags: entry.tags.slice(0, 3),
        tagCount: entry.tags.length,
        open: open
          ? { kind: open.kind, tabType: open.tabType, tabId: open.tabId || null, selected: !!open.selected, rank: open.rank }
          : null,
      },
      extra || {}
    );
  }

  // A paper's header for the note window: the authors as APA 7 cites them ("Sirmon",
  // "Sirmon & Hitt", "Sirmon et al."), the year, the title and where it was published.
  static paperInfo(item) {
    const field = (f) => {
      try {
        return String(item.getField(f) || "").trim();
      } catch (e) {
        return ""; // not a field of this item type
      }
    };
    const names = (item.getCreators ? item.getCreators() : [])
      .filter((c) => Zotero.CreatorTypes.getName(c.creatorTypeID) !== "reviewedAuthor")
      .map((c) => String(c.lastName || c.firstName || "").trim())
      .filter(Boolean);
    const authors = names.length > 2 ? names[0] + " et al." : names.join(" & ");
    const m = /\b(\d{4})\b/.exec(field("date"));
    const publication = ["publicationTitle", "bookTitle", "proceedingsTitle", "websiteTitle", "university", "publisher"].map(field).find(Boolean) || "";
    return { key: item.key, title: field("title") || item.getDisplayTitle(), authors, year: m ? m[1] : "", publication };
  }

  // Open tabs can hold items the index doesn't cover (e.g. a standalone note).
  _rowForItemID(itemID, open) {
    const entry = this.index.byId.get(itemID);
    if (entry) return this._row(entry, open);
    const item = Zotero.Items.get(itemID);
    if (!item) return null;
    const tags = item.getTags().map((t) => t.tag);
    return this._row(
      {
        key: item.key,
        libraryID: item.libraryID,
        itemType: item.itemType,
        title: OmaNoteFormat.plainTitle(item.isNote() ? item.getNoteTitle() : item.getDisplayTitle()),
        creator: "",
        year: null,
        publication: "",
        pdfCount: 0,
        noteCount: 0,
        tags,
      },
      open
    );
  }

  _ensureToken() {
    const pref = OmaBridge.PREF + "token";
    let token = Services.prefs.getStringPref(pref, "");
    if (!/^[0-9a-f]{64}$/.test(token)) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      Services.prefs.setStringPref(pref, token);
    }
    return token;
  }

  _tokenOk(header) {
    const m = /^Bearer\s+([0-9a-f]{64})$/.exec(String(header || "").trim());
    if (!m) return false;
    let diff = 0;
    for (let i = 0; i < 64; i++) diff |= m[1].charCodeAt(i) ^ this.token.charCodeAt(i);
    return diff === 0;
  }

  async _writeHandshake() {
    const runtime = Services.env.get("XDG_RUNTIME_DIR") || PathUtils.tempDir;
    const dir = PathUtils.join(runtime, "oma-zotero");
    await IOUtils.makeDirectory(dir, { ignoreExisting: true, createAncestors: true });
    await IOUtils.setPermissions(dir, 0o700);
    const file = PathUtils.join(dir, "bridge.json");
    const data = {
      port: Zotero.Prefs.get("httpServer.port"),
      token: this.token,
      bridgeVersion: this.version,
      zoteroVersion: Zotero.version,
      pid: Services.appinfo.processID,
      startedAt: new Date().toISOString(),
    };
    await IOUtils.writeUTF8(file, JSON.stringify(data, null, 2) + "\n", { tmpPath: file + ".tmp" });
    await IOUtils.setPermissions(file, 0o600);
    this.handshakePath = file;
  }

  // Dev install (scripts/bridge-dev-link.sh) temporarily lets profile-scope
  // sideloads start enabled; put Zotero's default back once we're running.
  _devHygiene() {
    const marker = OmaBridge.PREF + "dev.restoreAutoDisableScopes";
    if (!Services.prefs.getBoolPref(marker, false)) return;
    Services.prefs.clearUserPref("extensions.autoDisableScopes");
    Services.prefs.clearUserPref(marker);
    Zotero.debug("[oma-zotero] dev: restored extensions.autoDisableScopes to Zotero's default");
  }
};
