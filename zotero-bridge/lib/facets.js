// @ts-check
/* The values the launcher's @ picker offers: every tag, author, publication, year, collection,
 * item type and has: filter in the library, how many papers each holds, and the search term
 * that picks it (#"supply chain", a:"Smith, John", y:2020, c:"Topics / SCM", type:"book",
 * has:pdf). values() is pure over index entries (node-tested). */
/* global Zotero, omaHttpError, OmaCollections, OmaSearch, OmaBridge */

var OmaFacets = {
  FIELDS: ["tag", "author", "publication", "year", "collection", "type", "has", "status", "task"],
  // Short lists that depend on the launcher's statuses, tasks and chats: counted on each request.
  LIVE: ["has", "status", "task"],
  MAX: 20000, // values per field (authors run to thousands; the launcher lists the best 200 as you type)

  _prepared: new Map(), // field → { index, version, entries }: search entries, while the index is unchanged

  register(bridge) {
    // POST /facets { field, query?, limit? } → { field, values: [{ value, label, count, token, detail }] }:
    // every value (no limit), or, with a limit, the best `limit` for what is typed (fuzzy on the label,
    // the most used first on ties; titleRanges highlight the match) and how many match (total) of
    // how many there are (count).
    // statusTags and marks (the launcher's paper statuses, tasks and chats) for status, task and has.
    bridge.route("POST", "/facets", async function (data) {
      await this.index.ready;
      const field = String(data.field || "");
      if (!OmaFacets.FIELDS.includes(field)) throw omaHttpError(400, "bad-field", "field must be one of " + OmaFacets.FIELDS.join(", "));
      const live = { statusTags: OmaBridge.statusTagList(data.statusTags), statusPrefix: String(data.statusPrefix || "").slice(0, 10), marks: OmaBridge.markList(data.marks) };
      if (data.limit == null) return { field, values: await OmaFacets.list(this.index, field, live) };
      const limit = Math.max(1, Math.min(500, parseInt(data.limit, 10) || 100));
      const query = String(data.query == null ? "" : data.query).slice(0, 200);
      const entries = OmaFacets.LIVE.includes(field)
        ? OmaFacets.prepare(await OmaFacets.list(this.index, field, live))
        : await OmaFacets.searchEntries(this.index, field);
      return Object.assign({ field, query, count: entries.length }, OmaFacets.match(entries, query, limit));
    });
  },

  // Every value of the field, most used first.
  async list(index, field, live) {
    live = live || {};
    const env = { collections: [], collectionCounts: new Map(), typeLabel: OmaFacets.typeLabel, statusTags: live.statusTags || [], statusPrefix: live.statusPrefix || "", marks: live.marks || null };
    if (field === "has") env.collected = await OmaBridge.collectedItemIDs();
    if (field === "collection") {
      // the papers c: finds: indexed items only (not standalone notes)
      env.collections = OmaCollections.entries();
      for (const c of env.collections) {
        let n = 0;
        for (const id of await OmaCollections.itemIDs(c)) if (index.byId.get(id)) n++;
        env.collectionCounts.set(c.id, n);
      }
    }
    return OmaFacets.values(index.entries, field, env);
  },

  // The field's values as search entries (the label is the title), kept while the index is
  // unchanged: typing in the picker searches them without recounting 10,000 authors each time.
  // Collections also while the collection tree is the same (moving a paper changes the index).
  async searchEntries(index, field) {
    const kept = OmaFacets._prepared.get(field);
    const tree = field === "collection" ? OmaCollections.entries() : null;
    if (kept && kept.index === index && kept.version === index.version && kept.tree === tree) return kept.entries;
    const entries = OmaFacets.prepare(await OmaFacets.list(index, field));
    OmaFacets._prepared.set(field, { index, version: index.version, tree, entries });
    return entries;
  },

  // values → search entries, in their order (which settles ties: the most used first).
  prepare(values) {
    return values.map((v, i) => OmaSearch.prepareEntry({ id: i, title: v.label, creators: [], tags: [], year: null, publication: "", value: v }));
  },

  // The best `limit` entries for what is typed: each word fuzzy in the label (a year or a colon is
  // just text here). → { total, values (with titleRanges) }
  match(entries, query, limit) {
    const words = String(query || "").trim().split(/\s+/).filter(Boolean);
    const groups = words.map((w) => OmaSearch.parseTerm("t:" + w)).filter(Boolean).map((t) => [t]);
    if (!groups.length) return { total: entries.length, values: entries.slice(0, limit).map((e) => e.value) };
    const order = new Map(entries.map((e) => [e.id, e.id]));
    const res = OmaSearch.search(entries, { groups, expr: null }, { limit, openRank: order, phrase: false });
    return { total: res.total, values: res.results.map((h) => Object.assign({}, h.entry.value, { titleRanges: h.titleRanges })) };
  },

  typeLabel(type) {
    try {
      return Zotero.ItemTypes.getLocalizedString(type) || type;
    } catch (e) {
      return type;
    }
  },

  // x → "x", for a term (the query language has no escapes, so quotes inside are dropped).
  quote(value) {
    return '"' + String(value).replace(/"/g, "") + '"';
  },

  // How many entries hold each key (keysOf(entry) → the entry's keys, each counted once).
  count(entries, keysOf) {
    const counts = new Map();
    for (const e of entries) {
      for (const k of new Set(keysOf(e))) {
        if (k === "" || k == null) continue;
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    return counts;
  },

  // entries: the index's; env: { collections (OmaCollections entries), collectionCounts (id →
  // papers), typeLabel (itemType → its name) }. Most used first; years newest first;
  // collections in the tree's order.
  values(entries, field, env) {
    env = env || {};
    const label = env.typeLabel || ((t) => t);
    const q = OmaFacets.quote;
    // Ties by name, compared folded (localeCompare's collation is slow over thousands of authors).
    const byCount = (a, b) => b.count - a.count || (a._k < b._k ? -1 : a._k > b._k ? 1 : 0);
    const listed = (counts, token, labelOf) =>
      Array.from(counts, ([value, count]) => {
        const label = labelOf ? labelOf(value) : String(value);
        return { value: String(value), label, count, token: token(value), detail: "", _k: label.toLowerCase() };
      });
    let out;
    if (field === "tag") out = listed(OmaFacets.count(entries, (e) => e.tags || []), (v) => "#" + q(v)).sort(byCount);
    else if (field === "author") out = listed(OmaFacets.count(entries, (e) => e.creators || []), (v) => "a:" + q(v)).sort(byCount);
    else if (field === "publication") out = listed(OmaFacets.count(entries, (e) => [e.publication]), (v) => "p:" + q(v)).sort(byCount);
    else if (field === "year") out = listed(OmaFacets.count(entries, (e) => (e.year == null ? [] : [e.year])), (v) => "y:" + v).sort((a, b) => Number(b.value) - Number(a.value));
    else if (field === "type") out = listed(OmaFacets.count(entries, (e) => [e.itemType]), (v) => "type:" + q(v), label).sort(byCount);
    else if (field === "has") {
      const n = (test) => entries.filter(test).length;
      const marks = env.marks || { tasks: [], chats: [] };
      const keyOf = (e) => e.libraryID + ":" + e.key;
      const tasked = new Set(marks.tasks.map((t) => t.id));
      const chatted = new Set(marks.chats);
      const collected = env.collected || new Set();
      const tests = [
        ["pdf", "A PDF", "No PDF", (e) => (e.pdfCount || 0) > 0],
        ["notes", "Notes", "No notes", (e) => (e.noteCount || 0) > 0],
        ["files", "Any file", "No file", (e) => (e.pdfCount || 0) + (e.attachmentCount || 0) > 0],
        ["task", "A task", "No task", (e) => tasked.has(keyOf(e))],
        ["chat", "A chat", "No chat", (e) => chatted.has(keyOf(e))],
        ["collection", "In a collection", "In no collection", (e) => collected.has(e.id)],
      ];
      out = [];
      for (const [value, yes, no, test] of tests) {
        const count = n(test);
        out.push({ value, label: yes, count, token: "has:" + value, detail: "" });
        out.push({ value: "!" + value, label: no, count: entries.length - count, token: "!has:" + value, detail: "" });
      }
    } else if (field === "status") {
      const tags = env.statusTags || [];
      const folded = tags.map((t) => t.toLowerCase());
      const has = (e, t) => (e.tags || []).some((x) => String(x).toLowerCase() === t);
      out = [{ value: "none", label: "No status", count: entries.filter((e) => !folded.some((t) => has(e, t))).length, token: "status:none", detail: "" }]
        .concat(tags.map((t, i) => {
          const pre = env.statusPrefix || "";
          const name = pre && t.toLowerCase().startsWith(pre.toLowerCase()) ? t.slice(pre.length) : t; // s/reading → reading
          return { value: name, label: name, count: entries.filter((e) => has(e, folded[i])).length, token: "status:" + q(name), detail: t };
        }));
    } else if (field === "task") {
      const tasks = (env.marks && env.marks.tasks) || [];
      const papers = new Set(entries.map((e) => e.libraryID + ":" + e.key));
      const mine = tasks.filter((t) => papers.has(t.id));
      const per = (list) => new Set(list.map((t) => t.id)).size;
      const statuses = [];
      for (const t of mine) if (!statuses.some((s) => s.status === t.status)) statuses.push(t);
      out = [
        { value: "has", label: "Any task", count: per(mine), token: "has:task", detail: "" },
        { value: "!has", label: "No task", count: entries.length - per(mine), token: "!has:task", detail: "" },
      ].concat(statuses.map((s) => ({ value: s.status, label: s.status, count: per(mine.filter((t) => t.status === s.status)), token: "task:" + q(s.status), detail: s.group })));
    } else if (field === "collection") {
      const counts = env.collectionCounts || new Map();
      out = (env.collections || []).map((c) => ({
        value: c.title, label: c.title, count: counts.has(c.id) ? counts.get(c.id) : 0, token: "c:" + q(c.title),
        detail: c.library && c.library !== "My Library" ? c.library : "",
      }));
    } else out = [];
    return out.slice(0, OmaFacets.MAX).map((v) => {
      delete v._k;
      return v;
    });
  },
};

if (typeof module !== "undefined") module.exports = OmaFacets;
