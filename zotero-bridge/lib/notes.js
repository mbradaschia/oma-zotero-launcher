/* Notes for the overlay: the list for an item, and one note as Markdown.
 *
 * Markdown comes from Zotero's built-in "Note Markdown" export translator (the
 * one behind Export Note → Markdown). For display it gets a cleaned-up, never
 * saved copy of the note: images become "[image]", links the overlay can't
 * follow keep only their text, and table cells are flattened to one line so the
 * tables stay Markdown tables (note-editor cells hold <p>s, which the translator
 * would spread over several lines). */
/* global Zotero, DOMParser, OmaNoteFormat, setTimeout, clearTimeout */

var OmaNotes = {
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
};
