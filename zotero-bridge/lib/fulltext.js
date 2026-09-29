// @ts-check
/* Full text of an item's file for the companion. Zotero's own full-text index
 * cache (.zotero-ft-cache next to the file: PDFs, EPUBs and snapshots) is read
 * first; a PDF without one has its text extracted on demand (nothing is
 * stored), and `index: "ifMissing"` lets Zotero index the file — completely,
 * not capped by its "pages to index" preference — when the cache is missing or
 * partial. The request options and the text window are pure (node-tested). */
/* global Zotero, IOUtils, omaHttpError, OmaActions */

var OmaFulltext = {
  DEFAULT_CHARS: 200000,
  MAX_CHARS: 500000,
  INDEX_MODES: ["never", "ifMissing"],
  // Zotero.Fulltext.INDEX_STATE_*
  STATE_NAMES: ["unavailable", "unindexed", "partial", "indexed", "queued"],
  STATE_PARTIAL: 2,

  register(bridge) {
    bridge.route("POST", "/fulltext", OmaFulltext.route);
  },

  /**
   * POST /fulltext. `key`: a regular item (its first readable file on disk) or a file
   * attachment. `maxChars` ≤ 500000 (default 200000), `offset`: the window of the text
   * returned. `index`: "never" (default) or "ifMissing" (let Zotero index the file first
   * if it hasn't). this = the bridge.
   * @param {{key: string, libraryID?: any, maxChars?: any, offset?: any, index?: string}} req
   * @returns {Promise<{key: string, libraryID: number, attachmentKey: string, title: string,
   *   contentType: string, readerType: string|null, fileExists: boolean, source: string,
   *   text: string, offset: number, chars: number, totalChars: number, truncated: boolean,
   *   nextOffset: number|null, indexedState: number|null, indexedStateName: string|null,
   *   indexedPages: number|null, totalPages: number|null}>}
   */
  async route({ key, libraryID, maxChars, offset, index }) {
    const opts = OmaFulltext.options({ maxChars, offset, index });
    const item = await this._item(key, libraryID);
    const att = await OmaFulltext.attachmentFor(item);
    const path = await att.getFilePathAsync();
    let state = await OmaFulltext.state(att);
    const got = await OmaFulltext.load(att, path, state, opts.index);
    if (got.reindexed) state = await OmaFulltext.state(att);
    const slice = OmaFulltext.window(got.text, opts.offset, opts.maxChars);
    return Object.assign(
      {
        key: item.key,
        libraryID: item.libraryID,
        attachmentKey: att.key,
        title: att.getDisplayTitle() || att.attachmentFilename || "(untitled)",
        contentType: att.attachmentContentType || "",
        readerType: att.attachmentReaderType || null,
        fileExists: !!path,
        source: got.source,
      },
      slice,
      {
        indexedState: state.indexedState,
        indexedStateName: state.indexedStateName,
        indexedPages: got.pages ? got.pages.indexedPages : state.indexedPages,
        totalPages: got.pages ? got.pages.totalPages : state.totalPages,
      }
    );
  },

  // The file to read: a regular item's first readable (PDF/EPUB/snapshot) file on
  // disk, else its first readable file (its cache may exist); an attachment itself.
  async attachmentFor(item) {
    if (item.isRegularItem()) {
      const files = (await OmaActions.fileAttachments(item)).filter((f) => OmaActions.READER_TYPES.includes(f.readerType));
      const pick = files.find((f) => f.exists) || files[0];
      if (!pick) throw omaHttpError(409, "missing-file", "the item has no PDF, EPUB or snapshot attachment");
      return Zotero.Items.getByLibraryAndKey(pick.libraryID, pick.key);
    }
    if (item.isAttachment() && item.isFileAttachment()) return item;
    throw omaHttpError(400, "not-a-file", `a ${item.itemType} has no full text`);
  },

  // Zotero's index bookkeeping for the file: state 0 unavailable, 1 unindexed,
  // 2 partial, 3 indexed, 4 queued, and the page counts (PDFs).
  async state(att) {
    let indexedState = null;
    try {
      indexedState = await Zotero.Fulltext.getIndexedState(att);
    } catch (e) {
      Zotero.logError(e);
    }
    let row = null;
    try {
      row = await Zotero.DB.rowQueryAsync("SELECT indexedPages, totalPages FROM fulltextItems WHERE itemID=?", [att.id]);
    } catch (e) {
      Zotero.logError(e);
    }
    const n = (v) => (v == null ? null : Number(v));
    return {
      indexedState,
      indexedStateName: OmaFulltext.STATE_NAMES[indexedState] || null,
      indexedPages: row ? n(row.indexedPages) : null,
      totalPages: row ? n(row.totalPages) : null,
    };
  },

  // { text, source: "cache" | "pdfworker", pages?, reindexed }, or a 409.
  async load(att, path, state, mode) {
    let cache = OmaFulltext.cacheFile(att);
    let reindexed = false;
    if (mode === "ifMissing" && path && (!cache.exists || state.indexedState === OmaFulltext.STATE_PARTIAL)) {
      try {
        await Zotero.Fulltext.indexItems([att.id], { complete: true });
        reindexed = true;
      } catch (e) {
        Zotero.logError(e);
      }
      cache = OmaFulltext.cacheFile(att);
    }
    if (cache.exists) {
      let text = null;
      try {
        text = await IOUtils.readUTF8(cache.path);
      } catch (e) {
        Zotero.logError(e);
      }
      if (text != null) return { text: OmaFulltext.normalize(text), source: "cache", reindexed };
    }
    if (path && OmaFulltext.isPDF(att)) {
      let r;
      try {
        r = await Zotero.PDFWorker.getFullText(att.id, null);
      } catch (e) {
        Zotero.logError(e);
        throw omaHttpError(409, "extract-failed", `Zotero couldn't extract the PDF's text: ${e.message}`);
      }
      return {
        text: OmaFulltext.normalize(r && r.text),
        source: "pdfworker",
        pages: { indexedPages: r && r.extractedPages != null ? r.extractedPages : null, totalPages: r && r.totalPages != null ? r.totalPages : null },
        reindexed,
      };
    }
    if (!path) throw omaHttpError(409, "missing-file", "the file is missing from disk and Zotero has no full text for it");
    throw omaHttpError(409, "not-indexed", 'Zotero has not indexed this file; retry with index: "ifMissing"');
  },

  cacheFile(att) {
    try {
      const f = Zotero.Fulltext.getItemCacheFile(att);
      return { path: f.path, exists: !!f.exists() };
    } catch (e) {
      Zotero.logError(e);
      return { path: null, exists: false };
    }
  },

  isPDF(att) {
    try {
      return att.isPDFAttachment();
    } catch (e) {
      return att.attachmentContentType === "application/pdf";
    }
  },

  // ------------------------------------------------------------ pure helpers

  // Request options, clamped: { maxChars, offset, index }; a bad index mode is a 400.
  /** @param {{maxChars?: any, offset?: any, index?: string}} [opts] */
  options({ maxChars, offset, index } = {}) {
    const mode = index == null || index === "" ? "never" : index;
    if (!OmaFulltext.INDEX_MODES.includes(mode)) throw omaHttpError(400, "bad-index", 'index must be "never" or "ifMissing"');
    const max = parseInt(maxChars, 10);
    const off = parseInt(offset, 10);
    return {
      maxChars: Math.max(1, Math.min(OmaFulltext.MAX_CHARS, Number.isNaN(max) ? OmaFulltext.DEFAULT_CHARS : max)),
      offset: Math.max(0, Number.isNaN(off) ? 0 : off),
      index: mode,
    };
  },

  normalize(text) {
    return String(text == null ? "" : text).replace(/\r\n?/g, "\n");
  },

  // The window [offset, offset + maxChars) of the text, with paging info.
  window(text, offset, maxChars) {
    const all = String(text == null ? "" : text);
    const start = Math.min(Math.max(0, offset), all.length);
    const chunk = all.slice(start, start + maxChars);
    const end = start + chunk.length;
    return { text: chunk, offset: start, chars: chunk.length, totalChars: all.length, truncated: end < all.length, nextOffset: end < all.length ? end : null };
  },
};

if (typeof module !== "undefined") module.exports = OmaFulltext;
