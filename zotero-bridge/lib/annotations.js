// @ts-check
/* Annotations for the companion: the highlights, notes, images and ink strokes
 * on an item's PDF/EPUB/snapshot files, one list per file, in reading order.
 * Each annotation is Zotero's own JSON (Zotero.Annotations.toJSONSync) trimmed
 * to what a reader of the item needs. sortIndex parsing, ordering and the
 * `since` helpers are pure (node-tested). */
/* global Zotero, omaHttpError, OmaActions */

var OmaAnnotations = {
  MAX_PER_ATTACHMENT: 2000,

  register(bridge) {
    bridge.route("POST", "/annotations", OmaAnnotations.route);
  },

  /**
   * POST /annotations. `key`: a regular item (all its readable files), a file attachment,
   * or an annotation (its file). `since`: ISO 8601 date or unix ms → only annotations
   * modified at or after it. `includeExternal`: also the annotations embedded in the PDF
   * itself (imported, read-only). this = the bridge.
   * @param {{key: string, libraryID?: any, includeExternal?: boolean, since?: any}} req
   * @returns {Promise<{key: string, libraryID: number, topKey: string, attachments: Array<{
   *   key: string, libraryID: number, title: string, contentType: string, readerType: string|null,
   *   count: number, truncated: boolean, annotations: any[]}>, total: number}>}
   */
  async route({ key, libraryID, includeExternal = false, since = null }) {
    const sinceMs = OmaAnnotations.parseSince(since);
    const item = await this._item(key, libraryID);
    const files = OmaAnnotations.attachmentsOf(item);
    const top = item.isTopLevelItem() ? item : item.topLevelItem || item;
    const attachments = [];
    let total = 0;
    for (const att of files) {
      const all = await OmaAnnotations.forAttachment(att, { includeExternal: !!includeExternal, sinceMs });
      const annotations = all.slice(0, OmaAnnotations.MAX_PER_ATTACHMENT);
      total += annotations.length;
      attachments.push({
        key: att.key,
        libraryID: att.libraryID,
        title: att.getDisplayTitle() || att.attachmentFilename || "(untitled)",
        contentType: att.attachmentContentType || "",
        readerType: att.attachmentReaderType || null,
        count: annotations.length,
        truncated: all.length > annotations.length,
        annotations,
      });
    }
    return { key: item.key, libraryID: item.libraryID, topKey: top.key, attachments, total };
  },

  // The files whose annotations the key stands for.
  attachmentsOf(item) {
    if (item.isRegularItem()) {
      return Zotero.Items.get(item.getAttachments(false)).filter(
        (a) => a && a.isFileAttachment() && (OmaActions.READER_TYPES.includes(a.attachmentReaderType) || OmaAnnotations.count(a) > 0)
      );
    }
    if (item.isAttachment()) {
      if (!item.isFileAttachment()) throw omaHttpError(400, "not-a-file", "a linked URL has no annotations");
      return [item];
    }
    if (typeof item.isAnnotation === "function" && item.isAnnotation()) {
      const att = item.parentItem;
      if (!att) throw omaHttpError(404, "not-found", "the annotation's file is gone");
      return [att];
    }
    throw omaHttpError(400, "not-annotatable", `a ${item.itemType} has no annotations`);
  },

  count(att) {
    try {
      return att.numAnnotations();
    } catch (e) {
      return 0;
    }
  },

  // One file's annotations (trashed ones left out), oldest page first.
  async forAttachment(att, { includeExternal = false, sinceMs = null } = {}) {
    let annotations;
    try {
      annotations = att.getAnnotations(false);
    } catch (e) {
      return []; // not a file attachment
    }
    if (!annotations.length) return [];
    try {
      // annotationPosition (and pageLabel on some builds) load on demand
      await Zotero.Items.loadDataTypes(annotations, ["annotation", "annotationDeferred"]);
    } catch (e) {
      Zotero.logError(e);
    }
    const out = [];
    for (const a of annotations) {
      const json = OmaAnnotations.toJSON(a);
      if (!json) continue;
      if (json.isExternal && !includeExternal) continue;
      if (sinceMs != null && !(Date.parse(json.dateModified) >= sinceMs)) continue;
      out.push(json);
    }
    return out.sort(OmaAnnotations.compare);
  },

  // Zotero's JSON for one annotation, trimmed: { key, type, text, comment, color, pageLabel,
  // pageIndex, sortIndex, position, tags, dateModified, isExternal, authorName }.
  toJSON(a) {
    let o;
    try {
      o = Zotero.Annotations.toJSONSync(a);
    } catch (e) {
      Zotero.logError(e);
      o = OmaAnnotations.rawJSON(a);
    }
    if (!o) return null;
    const position = o.position && typeof o.position === "object" ? o.position : null;
    return {
      key: o.key,
      type: o.type || null,
      text: o.text == null ? null : String(o.text),
      comment: o.comment == null ? "" : String(o.comment),
      color: o.color || null,
      pageLabel: o.pageLabel || null,
      pageIndex: position && Number.isInteger(position.pageIndex) ? position.pageIndex : null,
      sortIndex: o.sortIndex || "",
      position,
      tags: (o.tags || []).map((t) => (t && t.name) || "").filter(Boolean),
      dateModified: o.dateModified || null,
      isExternal: !!o.isExternal,
      authorName: o.authorName || null,
    };
  },

  // Fallback without Zotero.Annotations: the same fields read from the item itself.
  rawJSON(a) {
    try {
      const type = a.annotationType;
      let position = null;
      try {
        position = JSON.parse(a.annotationPosition);
      } catch (e) {
        position = null;
      }
      return {
        key: a.key,
        type,
        isExternal: !!a.annotationIsExternal,
        text: type === "highlight" || type === "underline" ? a.annotationText : undefined,
        comment: a.annotationComment,
        pageLabel: a.annotationPageLabel,
        color: a.annotationColor,
        sortIndex: a.annotationSortIndex,
        position,
        tags: a.getTags().map((t) => ({ name: t.tag })),
        dateModified: OmaAnnotations.sqlToISO(a.dateModified),
      };
    } catch (e) {
      Zotero.logError(e);
      return null;
    }
  },

  // ------------------------------------------------------------ pure helpers

  // "00003|001234|00567" (page | char offset | y) → [3, 1234, 567]; null when it isn't a sortIndex.
  parseSortIndex(s) {
    const parts = String(s == null ? "" : s).split("|");
    if (!parts.every((p) => /^\d+$/.test(p))) return null;
    return parts.map(Number);
  },

  // Reading order: numeric sortIndex parts, else the raw string.
  compare(a, b) {
    const x = OmaAnnotations.parseSortIndex(a.sortIndex);
    const y = OmaAnnotations.parseSortIndex(b.sortIndex);
    if (x && y) {
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] || 0) - (y[i] || 0);
        if (d) return d;
      }
      return 0;
    }
    const sa = String(a.sortIndex || "");
    const sb = String(b.sortIndex || "");
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  },

  // since: an ISO 8601 date/time, or unix time in ms (seconds are accepted too) → ms; null when absent.
  parseSince(since) {
    if (since == null || since === "") return null;
    let ms;
    if (typeof since === "number") ms = since;
    else if (typeof since === "string" && /^\d+$/.test(since.trim())) ms = Number(since.trim());
    else if (typeof since === "string") ms = Date.parse(since.trim());
    else ms = NaN;
    if (!Number.isFinite(ms) || ms < 0) throw omaHttpError(400, "bad-since", "since must be an ISO 8601 date or unix time in ms");
    if (ms < 1e11) ms *= 1000; // unix seconds
    return ms;
  },

  // ms → "YYYY-MM-DD HH:MM:SS" in UTC, the form Zotero stores dateModified in.
  sinceToSQL(ms) {
    return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  },

  // "YYYY-MM-DD HH:MM:SS" (UTC) → ISO 8601.
  sqlToISO(sql) {
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(String(sql == null ? "" : sql));
    return m ? `${m[1]}T${m[2]}Z` : sql || null;
  },
};

if (typeof module !== "undefined") module.exports = OmaAnnotations;
