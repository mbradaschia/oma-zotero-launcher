// @ts-check
/* Citations and identifiers for the companion: formatted bibliographies and
 * in-text citations through Zotero's CSL engine (/cite), and /lookup, which
 * resolves DOIs, citekeys, item keys and titles to items.
 *
 * Every index entry carries a normalised `doi` and a `citekey`: Better BibTeX's
 * key when BBT is installed, else Zotero's own citationKey field, else a
 * generated BBT-style key (<author><year><TitleWord><TitleWord>, with a/b/c…
 * suffixes when several items share one). The identifier and title helpers are
 * pure (node-tested). */
/* global Zotero, omaHttpError, OmaSearch */

var OmaCite = {
  MAX_KEYS: 50,
  MAX_LOOKUP: 200,
  DEFAULT_STYLE: "http://www.zotero.org/styles/apa",
  STYLE_PREFIX: "http://www.zotero.org/styles/",
  MODES: ["bibliography", "citation"],
  FORMATS: ["text", "html"],
  // A fuzzy title match is accepted only this similar (trigram Dice, 0–1) and at
  // least this far ahead of the runner-up.
  MIN_TITLE_SCORE: 0.8,
  TITLE_MARGIN: 0.1,
  // Words Better BibTeX skips when it takes title words for a key (its default list, shortened).
  SKIP_WORDS: new Set(
    (
      "a an the of and or on in to for with at by from as is are its into via vs versus about over under between among " +
      "through toward towards without within but not nor than that this these those their there be been being do does " +
      "how what when where which who why it we you they our your his her one some any all " +
      "der die das des dem den ein eine einer eines einem einen und oder von zu im am zum zur " +
      "le la les l un une du de et ou au aux el los las una unos unas y o del al il lo gli i e ed di da della dei delle nel nella"
    ).split(" ")
  ),

  register(bridge) {
    bridge.route("POST", "/cite", OmaCite.cite);
    bridge.route("POST", "/lookup", OmaCite.lookup);
    bridge.route("POST", "/styles", OmaCite.styles);
  },

  // ------------------------------------------------------------ identifiers

  // "https://doi.org/10.1234/ABC." → "10.1234/abc"; null when it isn't a DOI.
  normalizeDOI(raw) {
    let s = String(raw == null ? "" : raw).trim();
    s = s
      .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "")
      .replace(/^doi:\s*/i, "")
      .replace(/[\s.,;)\]>]+$/, "")
      .toLowerCase();
    return /^10\.\d{4,9}\/\S+$/.test(s) ? s : null;
  },

  // BBT-style key without disambiguation: the first author's family name (lowercase
  // ASCII), the year, then the first two title words that aren't skip words, capitalised.
  // creators: getCreatorsJSON() entries ({ lastName, firstName, creatorType } or { name }).
  citekeyBase({ creators, year, title }) {
    const list = Array.isArray(creators) ? creators.filter(Boolean) : [];
    const first = list.find((c) => c.creatorType === "author") || list[0] || null;
    const folded = first ? OmaSearch.fold(first.lastName || first.name || "") : "";
    const family = folded.replace(/[^a-z0-9]/g, "") || folded.replace(/[^\p{L}\p{N}]/gu, "") || "anon";
    const y = /^\d{4}$/.test(String(year == null ? "" : year)) ? String(year) : "";
    const words = OmaCite.titleWords(title)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase() + w.slice(1));
    return family + y + words.join("");
  },

  // Title words for a key: diacritics stripped, punctuation dropped, skip words left out.
  titleWords(title) {
    const plain = String(title == null ? "" : title)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
    return plain.split(/[^\p{L}\p{N}]+/u).filter((w) => w && !OmaCite.SKIP_WORDS.has(w.toLowerCase()));
  },

  // 0 → "a" … 25 → "z", 26 → "aa" (Better BibTeX's postfix order).
  suffix(i) {
    let n = i + 1;
    let s = "";
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(97 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  },

  // Give generated keys their a/b/c… suffixes so that every citekey in the index is
  // unique. Real keys (Better BibTeX, Zotero's field) are never changed; generated
  // ones get suffixes in dateAdded order, so keys stay put as newer items arrive.
  assignCitekeys(entries) {
    const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const taken = new Set();
    const generated = [];
    for (const e of entries) {
      if (e.citekeySource === "generated" && e.citekeyBase) generated.push(e);
      else if (e.citekey) taken.add(e.citekey);
    }
    generated.sort((a, b) => cmp(a.dateAdded || "", b.dateAdded || "") || cmp(a.key, b.key));
    for (const e of generated) {
      let candidate = e.citekeyBase;
      for (let i = 0; taken.has(candidate); i++) candidate = e.citekeyBase + OmaCite.suffix(i);
      e.citekey = candidate;
      taken.add(candidate);
    }
    return entries;
  },

  // The item's real citekey: Better BibTeX's, else Zotero's citationKey field; null if neither.
  citekeyOf(item) {
    try {
      const bbt = typeof Zotero !== "undefined" && Zotero.BetterBibTeX;
      if (bbt && bbt.KeyManager && typeof bbt.KeyManager.get === "function") {
        const k = bbt.KeyManager.get(item.id);
        if (k && k.citekey) return { citekey: String(k.citekey).trim(), source: "bbt" };
      }
    } catch (e) {
      // BBT not ready yet: fall through
    }
    try {
      const field = item.getField("citationKey");
      if (field && String(field).trim()) return { citekey: String(field).trim(), source: "zotero" };
    } catch (e) {
      // not a field of this item type
    }
    return null;
  },

  // The identifier fields of an index entry: { doi, citekey, citekeySource, citekeyBase }.
  // citekeySource is "bbt", "zotero", "generated" or null; a generated citekey is
  // provisional until assignCitekeys() has run over the whole index.
  entryFields(item, { regular, creators, year, title }) {
    if (!regular) return { doi: null, citekey: null, citekeySource: null, citekeyBase: null };
    let doi = null;
    try {
      doi = OmaCite.normalizeDOI(item.getField("DOI"));
    } catch (e) {
      doi = null;
    }
    const real = OmaCite.citekeyOf(item);
    if (real) return { doi, citekey: real.citekey, citekeySource: real.source, citekeyBase: null };
    const base = OmaCite.citekeyBase({ creators, year, title });
    return { doi, citekey: base, citekeySource: "generated", citekeyBase: base };
  },

  // The entry's citekey, or the item's real one for items outside the index.
  citekeyFor(item, index) {
    const entry = index && index.byId ? index.byId.get(item.id) : null;
    if (entry && entry.citekey) return entry.citekey;
    const real = OmaCite.citekeyOf(item);
    return real ? real.citekey : null;
  },

  // ------------------------------------------------------------ titles

  // Lowercase, diacritics stripped, punctuation → spaces, collapsed: the form titles are compared in.
  foldTitle(title) {
    return OmaSearch.fold(title).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  },

  // Trigram Dice similarity of two titles (0–1), after foldTitle().
  titleSimilarity(a, b) {
    const x = OmaCite.foldTitle(a);
    const y = OmaCite.foldTitle(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    const ga = OmaCite._trigrams(x);
    const gb = OmaCite._trigrams(y);
    let shared = 0;
    let na = 0;
    let nb = 0;
    for (const [g, n] of ga) {
      na += n;
      const m = gb.get(g);
      if (m) shared += Math.min(n, m);
    }
    for (const n of gb.values()) nb += n;
    return na + nb ? (2 * shared) / (na + nb) : 0;
  },

  _trigrams(s) {
    const t = " " + s + " ";
    const out = new Map();
    for (let i = 0; i + 3 <= t.length; i++) {
      const g = t.slice(i, i + 3);
      out.set(g, (out.get(g) || 0) + 1);
    }
    return out;
  },

  // Lookup tables over prepared index entries; duplicates resolve to the newest edit.
  tables(entries) {
    const newer = (a, b) => !b || (a.dateModified || "") > (b.dateModified || "");
    const byDoi = new Map();
    const byCitekey = new Map();
    const byCitekeyLower = new Map();
    const byKey = new Map();
    const byTitle = new Map();
    for (const e of entries) {
      if (e.doi && newer(e, byDoi.get(e.doi))) byDoi.set(e.doi, e);
      if (e.citekey) {
        if (newer(e, byCitekey.get(e.citekey))) byCitekey.set(e.citekey, e);
        const lower = e.citekey.toLowerCase();
        if (newer(e, byCitekeyLower.get(lower))) byCitekeyLower.set(lower, e);
      }
      if (!byKey.has(e.key)) byKey.set(e.key, e);
      const t = OmaCite.foldTitle(e.title);
      if (t && newer(e, byTitle.get(t))) byTitle.set(t, e);
    }
    return { byDoi, byCitekey, byCitekeyLower, byKey, byTitle };
  },

  // One title → { entry, method: "title-exact" | "title-fuzzy", score } or null.
  matchTitle(query, entries, byTitle) {
    const folded = OmaCite.foldTitle(query);
    if (!folded) return null;
    const exact = byTitle.get(folded);
    if (exact) return { entry: exact, method: "title-exact", score: 1 };
    const scored = OmaCite.candidates(folded, entries)
      .map((e) => ({ entry: e, score: OmaCite.titleSimilarity(folded, e.title) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    const second = scored[1];
    if (!best || best.score < OmaCite.MIN_TITLE_SCORE) return null;
    if (second && second.score > best.score - OmaCite.TITLE_MARGIN) return null; // two near-identical titles: ambiguous
    return { entry: best.entry, method: "title-fuzzy", score: Math.round(best.score * 1000) / 1000 };
  },

  // Fuzzy candidates through the search scorer: the whole title as a query (every
  // word must match), else its longest words only.
  candidates(folded, entries) {
    const hits = OmaSearch.search(entries, folded, { limit: 5 }).results;
    if (hits.length) return hits.map((h) => h.entry);
    const words = folded
      .split(" ")
      .filter((w) => w.length >= 4)
      .sort((a, b) => b.length - a.length)
      .slice(0, 5);
    if (!words.length) return [];
    return OmaSearch.search(entries, words.join(" "), { limit: 5 }).results.map((h) => h.entry);
  },

  // ------------------------------------------------------------ routes

  /**
   * POST /lookup. `method`: doi | citekey | key | title-exact | title-fuzzy. Trashed
   * items never match. this = the bridge.
   * @param {{dois?: string[], titles?: string[], citekeys?: string[], keys?: string[], libraryID?: any}} req
   * @returns {Promise<{matches: Array<{query: string, method: string, key: string,
   *   libraryID: number, title: string, score: number}>, unmatched: string[]}>}
   */
  async lookup({ dois, titles, citekeys, keys, libraryID }) {
    await this.index.ready;
    const lists = {};
    let n = 0;
    for (const [name, raw] of [["dois", dois], ["titles", titles], ["citekeys", citekeys], ["keys", keys]]) {
      if (raw == null) {
        lists[name] = [];
        continue;
      }
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) {
        throw omaHttpError(400, "bad-request", `${name} must be an array of strings`);
      }
      lists[name] = raw;
      n += raw.length;
    }
    if (!n) throw omaHttpError(400, "bad-request", "nothing to look up: give dois, titles, citekeys or keys");
    if (n > OmaCite.MAX_LOOKUP) throw omaHttpError(400, "too-many", `at most ${OmaCite.MAX_LOOKUP} queries per request`);
    let lib = null;
    if (libraryID != null) {
      lib = Number(libraryID);
      if (!Number.isInteger(lib) || !Zotero.Libraries.exists(lib)) throw omaHttpError(400, "bad-library", "unknown libraryID");
    }
    const entries = lib == null ? this.index.entries : this.index.entries.filter((e) => e.libraryID === lib);
    const tables = OmaCite.tables(entries);
    const matches = [];
    const unmatched = [];
    const report = (query, method, hit, score) => {
      if (hit) matches.push({ query, method, key: hit.key, libraryID: hit.libraryID, title: hit.title, score });
      else unmatched.push(query);
    };
    for (const q of lists.dois) {
      const doi = OmaCite.normalizeDOI(q);
      report(q, "doi", doi ? tables.byDoi.get(doi) : null, 1);
    }
    for (const q of lists.citekeys) {
      const k = q.trim();
      report(q, "citekey", k ? tables.byCitekey.get(k) || tables.byCitekeyLower.get(k.toLowerCase()) : null, 1);
    }
    for (const q of lists.keys) {
      const k = q.trim().toUpperCase();
      let hit = /^[A-Z0-9]{8}$/.test(k) ? tables.byKey.get(k) : null;
      if (!hit && /^[A-Z0-9]{8}$/.test(k)) {
        // Not indexed (a note, a child attachment…): ask Zotero directly.
        const item = Zotero.Items.getByLibraryAndKey(lib == null ? Zotero.Libraries.userLibraryID : lib, k);
        if (item && !item.deleted) {
          hit = { key: item.key, libraryID: item.libraryID, title: item.isNote() ? item.getNoteTitle() : item.getDisplayTitle() };
        }
      }
      report(q, "key", hit, 1);
    }
    for (const q of lists.titles) {
      const m = OmaCite.matchTitle(q, entries, tables.byTitle);
      report(q, m ? m.method : "title", m ? m.entry : null, m ? m.score : 0);
    }
    return { matches, unmatched };
  },

  // A short style name ("apa") or a style URL → the style ID Zotero.Styles knows; null if malformed.
  styleID(style) {
    const s = String(style == null ? "" : style).trim();
    if (!s) return OmaCite.DEFAULT_STYLE;
    if (/^[a-z0-9][a-z0-9-]*$/i.test(s)) return OmaCite.STYLE_PREFIX + s.toLowerCase();
    if (/^https?:\/\/\S+$/i.test(s)) return s;
    return null;
  },

  // A style ID as the launcher keeps it: the short name for Zotero's own styles ("apa"), else the URL.
  shortStyle(styleID) {
    const s = String(styleID || "");
    return s.indexOf(OmaCite.STYLE_PREFIX) === 0 && /^[a-z0-9][a-z0-9-]*$/i.test(s.slice(OmaCite.STYLE_PREFIX.length)) ? s.slice(OmaCite.STYLE_PREFIX.length) : s;
  },

  // Installed styles ({ styleID, title }) → [{ id, title }] by title, a style without an ID left out.
  styleList(styles) {
    return (Array.isArray(styles) ? styles : [])
      .filter((st) => st && st.styleID)
      .map((st) => ({ id: OmaCite.shortStyle(st.styleID), title: String(st.title || st.styleID) }))
      .sort((a, b) => a.title.localeCompare(b.title));
  },

  /**
   * POST /styles: the citation styles installed in Zotero (Settings › Citation style picks one).
   * @returns {Promise<{styles: Array<{id: string, title: string}>, default: string}>}
   */
  async styles() {
    let list;
    try {
      list = Zotero.Styles.getVisible();
    } catch (e) {
      throw omaHttpError(503, "styles-not-ready", "Zotero's styles aren't loaded yet");
    }
    return { styles: OmaCite.styleList(list), default: OmaCite.shortStyle(OmaCite.DEFAULT_STYLE) };
  },

  clean(s) {
    return String(s == null ? "" : s)
      .replace(/\r\n?/g, "\n")
      .trim();
  },

  // One in-text citation naming every item, e.g. "(Pimm, 1984; Ulaga et al., 2021)".
  cluster(engine, items, format) {
    try {
      const citation = { citationItems: items.map((i) => ({ id: i.id })), properties: { noteIndex: 0 } };
      return engine.previewCitationCluster(citation, [], [], format);
    } catch (e) {
      Zotero.logError(e);
      return Zotero.Cite.makeFormattedBibliographyOrCitationList(engine, items, format, true);
    }
  },

  /**
   * POST /cite. mode "bibliography": each entry's text is its bibliography entry and
   * `bibliography` is the whole list in the style's order. mode "citation": each entry's
   * text is its in-text citation and `citation` cites all items at once. this = the bridge.
   * @param {{keys: string[], libraryID?: any, style?: string, mode?: "bibliography"|"citation",
   *   format?: "text"|"html", locale?: string}} req
   * @returns {Promise<{style: string, styleTitle: string|null, locale: string, mode: string,
   *   format: string, entries: Array<{key: string, libraryID: number, citekey: string|null, text: string}>,
   *   bibliography: string|null, citation: string|null}>}
   */
  async cite({ keys, libraryID, style, mode = "bibliography", format = "text", locale = "en-US" }) {
    if (!Array.isArray(keys) || !keys.length || keys.some((k) => typeof k !== "string")) {
      throw omaHttpError(400, "bad-keys", "keys must be a non-empty array of item keys");
    }
    if (keys.length > OmaCite.MAX_KEYS) throw omaHttpError(400, "bad-keys", `at most ${OmaCite.MAX_KEYS} keys per request`);
    if (!OmaCite.MODES.includes(mode)) throw omaHttpError(400, "bad-mode", 'mode must be "bibliography" or "citation"');
    if (!OmaCite.FORMATS.includes(format)) throw omaHttpError(400, "bad-format", 'format must be "text" or "html"');
    locale = String(locale == null || locale === "" ? "en-US" : locale);
    if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(locale)) throw omaHttpError(400, "bad-locale", "locale must look like en-US");
    const styleID = OmaCite.styleID(style);
    if (!styleID) throw omaHttpError(400, "bad-style", "style must be a short name like apa or a style URL");
    let st;
    try {
      st = Zotero.Styles.get(styleID);
    } catch (e) {
      throw omaHttpError(503, "styles-not-ready", "Zotero's styles aren't loaded yet");
    }
    if (!st) throw omaHttpError(400, "bad-style", `no installed style ${styleID}`);

    await this.index.ready;
    const items = [];
    for (const key of Array.from(new Set(keys))) {
      const item = await this._item(key, libraryID);
      if (!item.isRegularItem()) throw omaHttpError(400, "not-citable", `${key} is a ${item.itemType}, not a citable item`);
      items.push(item);
    }

    let engine;
    try {
      engine = st.getCiteProc(locale, format);
    } catch (e) {
      Zotero.logError(e);
      throw omaHttpError(400, "bad-style", `the style can't be loaded: ${e.message}`);
    }
    const asCitation = mode === "citation";
    try {
      const entries = items.map((item) => ({
        key: item.key,
        libraryID: item.libraryID,
        citekey: OmaCite.citekeyFor(item, this.index),
        text: OmaCite.clean(Zotero.Cite.makeFormattedBibliographyOrCitationList(engine, [item], format, asCitation)),
      }));
      const all = OmaCite.clean(
        asCitation ? OmaCite.cluster(engine, items, format) : Zotero.Cite.makeFormattedBibliographyOrCitationList(engine, items, format, false)
      );
      return {
        style: styleID,
        styleTitle: st.title || null,
        locale,
        mode,
        format,
        entries,
        bibliography: asCitation ? null : all,
        citation: asCitation ? all : null,
      };
    } finally {
      try {
        if (engine && typeof engine.free === "function") engine.free();
      } catch (e) {
        // engine already released
      }
    }
  },
};

if (typeof module !== "undefined") module.exports = OmaCite;
