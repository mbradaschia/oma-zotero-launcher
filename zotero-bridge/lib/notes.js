/* Notes for the overlay: the list for an item, and one note as Markdown.
 *
 * Markdown comes from Zotero's built-in "Note Markdown" export translator (the
 * one behind Export Note → Markdown). For display it gets a cleaned-up, never
 * saved copy of the note: images become "[image]", links the overlay can't
 * follow keep only their text, and table cells are flattened to one line so the
 * tables stay Markdown tables (note-editor cells hold <p>s, which the translator
 * would spread over several lines).
 *
 * Write routes (registered by the bridge): child notes created from sanitized
 * HTML and tagged "oma-companion" (the prompt runner's notes, and the companion's
 * in oma-zotero-plugin), trashing exactly those notes again, and a substring
 * search over note HTML. */
/* global Zotero, DOMParser, OmaNoteFormat, OmaTags, omaHttpError, setTimeout, clearTimeout */

var OmaNotes = {
  COMPANION_TAG: "oma-companion",
  SCHEMA_VERSION: 9, // the note editor's data-schema-version (Zotero 10)
  MAX_HTML: 250000, // Zotero syncs notes up to about this size
  FULLTEXT_TAG: "oma-fulltext", // the paper's extracted text (oma-zotero-prompt extract)
  SEARCH_MIN: 2,
  SEARCH_MAX: 100,
  SEARCH_LIMIT: 50,

  // The notes shown for an item: its child notes (newest edit first), or the note itself.
  list(item) {
    let notes = [];
    if (item.isRegularItem()) notes = Zotero.Items.get(item.getNotes(false));
    else if (item.isNote()) notes = [item];
    return notes
      .filter((n) => n && !n.deleted)
      .map((n) => OmaNotes.summary(n))
      .sort((a, b) => (a.dateModified < b.dateModified ? 1 : a.dateModified > b.dateModified ? -1 : 0));
  },

  summary(note) {
    const title = OmaNoteFormat.plainTitle(note.getNoteTitle());
    return {
      key: note.key,
      libraryID: note.libraryID,
      title,
      dateModified: note.dateModified,
      excerpt: OmaNoteFormat.excerpt(OmaNotes.toText(note), title),
      fulltext: typeof note.hasTag === "function" && note.hasTag(OmaNotes.FULLTEXT_TAG),
    };
  },

  // { markdown, truncated, chars, format: "markdown" | "text" } for the overlay.
  // opts.linkColor: the theme color for web links ("#rrggbb").
  async forDisplay(note, opts) {
    const html = note.getNote();
    let md = null;
    try {
      md = await OmaNotes.toMarkdown(OmaNotes.cleanCopy(note, html), { includeAppLinks: false });
    } catch (e) {
      Zotero.logError(e);
    }
    if (md === null) {
      // The translator failed: show the plain text rather than nothing.
      const text = OmaNotes.toText(note, "\n\n").replace(/([\\`*_[\]#<>|])/g, "\\$1");
      return Object.assign(OmaNoteFormat.format(text, 0, opts), { format: "text" });
    }
    return Object.assign(OmaNoteFormat.format(md, 0, opts), { format: "markdown" });
  },

  // Markdown exactly as Zotero exports it (app links included), for copying.
  async exportMarkdown(note) {
    return OmaNotes.toMarkdown(note, { includeAppLinks: true });
  },

  // Markdown, or null if the translator fails or takes too long (it only reports success
  // through "done"; a failure may surface as a rejected promise, an "error", or nothing).
  TRANSLATE_TIMEOUT_MS: 15000,

  toMarkdown(note, displayOptions) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        Zotero.debug("[oma-zotero] note Markdown export timed out");
        finish(null);
      }, OmaNotes.TRANSLATE_TIMEOUT_MS);
      try {
        const t = new Zotero.Translate.Export();
        t.setItems([note]);
        t.setTranslator(Zotero.Translators.TRANSLATOR_ID_NOTE_MARKDOWN);
        if (displayOptions) t.setDisplayOptions(displayOptions);
        t.setHandler("done", (obj, worked) => finish(worked ? String(obj.string || "").replace(/\r\n/g, "\n") : null));
        t.setHandler("error", (obj, e) => {
          Zotero.logError(e);
          finish(null);
        });
        const running = t.translate();
        if (running && typeof running.then === "function") {
          running.catch((e) => {
            Zotero.logError(e);
            finish(null);
          });
        }
      } catch (e) {
        Zotero.logError(e);
        finish(null);
      }
    });
  },

  // An unsaved note holding the cleaned HTML (the original is never modified).
  cleanCopy(note, html) {
    const cleaned = OmaNotes.cleanHTML(html);
    if (cleaned === html) return note;
    const copy = new Zotero.Item("note");
    copy.setNote(cleaned);
    return copy;
  },

  cleanHTML(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    let changed = false;
    for (const img of Array.from(doc.querySelectorAll("img"))) {
      img.replaceWith(doc.createTextNode("[image]"));
      changed = true;
    }
    for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
      if (/^(https?|mailto):/i.test(a.getAttribute("href").trim())) continue;
      a.replaceWith(...Array.from(a.childNodes));
      changed = true;
    }
    for (const cell of Array.from(doc.querySelectorAll("td, th"))) {
      for (const br of Array.from(cell.querySelectorAll("br"))) br.replaceWith(doc.createTextNode(" "));
      for (const block of Array.from(cell.querySelectorAll("p, div, h1, h2, h3, h4, h5, h6, li, blockquote, pre"))) {
        block.after(doc.createTextNode(" "));
        block.replaceWith(...Array.from(block.childNodes));
      }
      changed = true;
    }
    // The translator converts only tables with a heading row (others stay raw HTML):
    // promote each table's first row. Its heading-row test looks at child nodes, so
    // whitespace between rows and cells goes first.
    for (const el of Array.from(doc.querySelectorAll("table, thead, tbody, tfoot, tr"))) {
      for (const n of Array.from(el.childNodes)) if (n.nodeType === 3 && !n.textContent.trim()) n.remove();
    }
    for (const table of Array.from(doc.querySelectorAll("table"))) {
      const first = table.rows && table.rows[0];
      if (!first || Array.from(first.cells).every((c) => c.nodeName === "TH")) continue;
      for (const td of Array.from(first.cells)) {
        const th = doc.createElement("th");
        for (const attr of Array.from(td.attributes)) th.setAttribute(attr.name, attr.value);
        th.append(...Array.from(td.childNodes));
        td.replaceWith(th);
      }
      changed = true;
    }
    return changed ? doc.body.innerHTML : String(html || "");
  },

  // Plain text, blocks kept apart by `sep` (a space for excerpts, blank lines for the fallback).
  toText(note, sep = " ") {
    return Zotero.Utilities.unescapeHTML(OmaNoteFormat.separateBlocks(note.getNote(), sep));
  },

  // ---------------------------------------------------------------- companion routes (this = the bridge)

  registerRoutes(bridge) {
    bridge.route("POST", "/notes/create", OmaNotes.routeCreate);
    bridge.route("POST", "/notes/trash", OmaNotes.routeTrash);
    bridge.route("POST", "/notes/search", OmaNotes.routeSearch);
  },

  // { parentKey, libraryID?, html, tags? } → { key, parentKey, libraryID }
  async routeCreate({ parentKey, libraryID, html, tags }) {
    const parent = await this._item(parentKey, libraryID);
    return OmaNotes.createChild(parent, html, OmaTags.cleanNames(tags, "tags"));
  },

  // { key, libraryID? } → { trashed: true, key, libraryID }; only notes this bridge created.
  async routeTrash({ key, libraryID }) {
    return OmaNotes.trash(await this._item(key, libraryID));
  },

  // { query, limit?, libraryID? } → { libraryID, query, notes: [{ key, libraryID, parentKey, title, excerpt, dateModified }] }
  async routeSearch({ query, limit, libraryID }) {
    const lib = libraryID == null ? Zotero.Libraries.userLibraryID : Number(libraryID);
    if (!Number.isInteger(lib) || !Zotero.Libraries.exists(lib)) throw omaHttpError(400, "bad-library", "unknown libraryID");
    const q = typeof query === "string" ? query.trim() : "";
    return { libraryID: lib, query: q, notes: await OmaNotes.search(lib, q, limit) };
  },

  // ---------------------------------------------------------------- creating, trashing, searching

  // A child note under a regular item, from sanitized HTML, tagged so /notes/trash can
  // tell it apart from the user's own notes. Verified recipe for Zotero 10.
  async createChild(parent, html, tags = []) {
    if (!parent || typeof parent.isRegularItem !== "function" || !parent.isRegularItem()) {
      throw omaHttpError(400, "bad-parent", "the parent must be a regular item (not an attachment or a note)");
    }
    OmaNotes._requireEditable(parent);
    const body = OmaNotes.prepareHTML(html);
    const note = new Zotero.Item("note");
    note.libraryID = parent.libraryID;
    note.parentID = parent.id;
    note.setNote(body);
    note.addTag(OmaNotes.COMPANION_TAG, 0);
    for (const t of tags || []) if (t !== OmaNotes.COMPANION_TAG) note.addTag(t, 0);
    await note.saveTx({ skipSelect: true });
    return { key: note.key, parentKey: parent.key, libraryID: parent.libraryID };
  },

  // Zotero's own trash (undoable there, emptied after 30 days), for companion notes only.
  async trash(note) {
    if (!note.isNote()) throw omaHttpError(400, "not-a-note", "not a note");
    if (!note.getTags().some((t) => t.tag === OmaNotes.COMPANION_TAG)) {
      throw omaHttpError(403, "not-ours", `only notes tagged “${OmaNotes.COMPANION_TAG}” can be trashed here`);
    }
    OmaNotes._requireEditable(note);
    await Zotero.Items.trashTx([note.id]);
    return { trashed: true, key: note.key, libraryID: note.libraryID };
  },

  // Notes whose HTML contains the query (case-insensitive for ASCII), newest edit first.
  async search(libraryID, query, limit) {
    const q = typeof query === "string" ? query.trim() : "";
    if (q.length < OmaNotes.SEARCH_MIN || q.length > OmaNotes.SEARCH_MAX) {
      throw omaHttpError(400, "bad-query", `query must be ${OmaNotes.SEARCH_MIN}–${OmaNotes.SEARCH_MAX} characters`);
    }
    const lim = Math.max(1, Math.min(OmaNotes.SEARCH_LIMIT, parseInt(limit, 10) || 20));
    // itemNotes also holds attachments' own note field, hence the item type filter.
    // (Zotero's DB layer refuses LIKE with literal patterns, hence INSTR.)
    const rows = await Zotero.DB.queryAsync(
      "SELECT I.itemID AS itemID FROM itemNotes N JOIN items I USING (itemID) " +
        "WHERE I.libraryID = ? AND I.itemTypeID = ? AND INSTR(LOWER(N.note), LOWER(?)) > 0 " +
        "AND I.itemID NOT IN (SELECT itemID FROM deletedItems) ORDER BY I.clientDateModified DESC LIMIT ?",
      [libraryID, Zotero.ItemTypes.getID("note"), q, lim]
    );
    const out = [];
    for (const r of rows || []) {
      const note = Zotero.Items.get(r.itemID);
      if (!note || !note.isNote()) continue;
      const parent = note.parentItemID ? Zotero.Items.get(note.parentItemID) : null;
      out.push(Object.assign(OmaNotes.summary(note), { parentKey: parent ? parent.key : null }));
    }
    return out;
  },

  _requireEditable(item) {
    if (OmaTags.editable(item)) return;
    const lib = Zotero.Libraries.get(item.libraryID);
    throw omaHttpError(409, "read-only", `“${lib ? lib.name : "This library"}” is read-only`);
  },

  // ---------------------------------------------------------------- HTML for new notes

  // Validated, sanitized and wrapped in the note editor's schema container (kept, with
  // its version, when the caller already sends one).
  prepareHTML(html) {
    if (typeof html !== "string" || !html.trim()) throw omaHttpError(400, "bad-html", "html must be a non-empty string");
    if (html.length > OmaNotes.MAX_HTML) throw omaHttpError(400, "bad-html", `html can't be longer than ${OmaNotes.MAX_HTML} characters`);
    const m = /^\s*<div\s+data-schema-version="(\d+)"[^>]*>([\s\S]*)<\/div>\s*$/i.exec(html);
    const clean = OmaNotes.sanitizeHTML(m ? m[2] : html).trim();
    if (!/\S/.test(clean.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " "))) throw omaHttpError(400, "bad-html", "no text is left after sanitizing the html");
    return `<div data-schema-version="${m ? m[1] : OmaNotes.SCHEMA_VERSION}">${clean}</div>`;
  },

  SAFE_TAGS: new Set(["p", "br", "h1", "h2", "h3", "h4", "ul", "ol", "li", "b", "strong", "i", "em", "u", "a", "blockquote", "code", "pre", "table", "thead", "tbody", "tr", "th", "td", "hr"]),
  // Dropped together with their content.
  DROP_TAGS: new Set(["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math", "textarea", "select", "head", "title"]),
  VOID_TAGS: new Set(["br", "hr"]),

  // Allowlist sanitizer without a DOM (node-testable, and safe against mutation tricks:
  // the output is rebuilt from scratch, so text can never become a tag). Keeps the tags
  // in SAFE_TAGS with no attributes except a web href on <a> (an <a> without one goes);
  // other tags lose their tag (content stays), script/style-like elements go entirely,
  // as do comments and doctypes.
  sanitizeHTML(html) {
    const src = String(html || "");
    const TAG = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>`]+))?)*)\s*\/?>/y;
    let out = "";
    let i = 0;
    let droppedAnchors = 0; // <a> tags without a web href go, with their </a>
    while (i < src.length) {
      const lt = src.indexOf("<", i);
      if (lt < 0) {
        out += OmaNotes._escapeText(src.slice(i));
        break;
      }
      out += OmaNotes._escapeText(src.slice(i, lt));
      if (src.startsWith("<!--", lt)) {
        const end = src.indexOf("-->", lt + 4);
        i = end < 0 ? src.length : end + 3;
        continue;
      }
      if (src[lt + 1] === "!" || src[lt + 1] === "?") {
        const end = src.indexOf(">", lt);
        i = end < 0 ? src.length : end + 1;
        continue;
      }
      TAG.lastIndex = lt;
      const m = TAG.exec(src);
      if (!m) {
        out += "&lt;";
        i = lt + 1;
        continue;
      }
      i = lt + m[0].length;
      const closing = m[0][1] === "/";
      const name = m[1].toLowerCase();
      if (OmaNotes.DROP_TAGS.has(name)) {
        if (!closing) {
          const close = new RegExp("</" + name + "\\s*>", "ig");
          close.lastIndex = i;
          const c = close.exec(src);
          i = c ? c.index + c[0].length : src.length;
        }
        continue;
      }
      if (!OmaNotes.SAFE_TAGS.has(name)) continue;
      if (closing) {
        if (name === "a" && droppedAnchors > 0) droppedAnchors--;
        else if (!OmaNotes.VOID_TAGS.has(name)) out += "</" + name + ">";
        continue;
      }
      let attrs = "";
      if (name === "a") {
        const href = OmaNotes._attr(m[2], "href");
        if (!href || !/^https?:\/\//i.test(href)) {
          droppedAnchors++;
          continue;
        }
        attrs = ' href="' + OmaNotes._escapeText(href).replace(/"/g, "&quot;") + '"';
      }
      out += "<" + name + attrs + ">";
    }
    return out;
  },

  // The decoded value of one attribute out of a tag's attribute string, or null.
  _attr(attrs, wanted) {
    const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
    let m;
    while ((m = re.exec(attrs || ""))) {
      if (m[1].toLowerCase() !== wanted) continue;
      const raw = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : "";
      return raw
        .replace(/&(amp|lt|gt|quot|#39|#x27|#x2F|#47);/gi, (w, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#x27": "'", "#x2f": "/", "#47": "/" })[e.toLowerCase()] || w)
        .replace(/[\u0000-\u001f]/g, "")
        .trim();
    }
    return null;
  },

  // Text is re-escaped; existing character references are kept as they are.
  _escapeText(text) {
    return String(text)
      .replace(/&(?![a-zA-Z][a-zA-Z0-9]{1,31};|#\d{1,7};|#[xX][0-9a-fA-F]{1,6};)/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  },
};
