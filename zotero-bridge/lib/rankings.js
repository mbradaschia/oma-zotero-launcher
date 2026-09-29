// @ts-check
/* Journal rankings for an item's publication: its AJG 2024 rating (the "ABS list",
 * 1 to 4*, with the AJG field), its ABDC rating (A* to C), and whether it is on the
 * FT50 and UTD24 lists.
 * Matched by ISSN (print or electronic) against the AJG, else by normalized journal
 * title ("&" = "and", no "The", accents and punctuation folded). FT50 and UTD24 list
 * titles only; they are tied to ISSNs through the AJG, so an item with an ISSN still
 * matches when its title is spelled differently. Data: rankingsData.js
 * (scripts/update-rankings.sh). Pure (node-tested). */
/* global OMA_RANKINGS_DATA */

var OmaRankings = {
  _maps: null,

  // "The Journal of Finance & Economics:" → "journal of finance and economics"
  normTitle(title) {
    return String(title || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&amp;/g, "&")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/^the /, "")
      .trim();
  },

  // "0001-4826", "00014826", "0001-482x" → "0001-4826" / "0001-482X"; anything else → "".
  normISSN(issn) {
    const m = /^(\d{4})-?(\d{3}[\dX])$/i.exec(String(issn || "").trim());
    return m ? `${m[1]}-${m[2].toUpperCase()}` : "";
  },

  // A Zotero ISSN field can hold several ("0001-4826, 1558-7967").
  issns(field) {
    return String(field || "")
      .split(/[\s,;]+/)
      .map((s) => OmaRankings.normISSN(s))
      .filter(Boolean);
  },

  maps(data) {
    if (!data && OmaRankings._maps) return OmaRankings._maps;
    const d = data || (typeof OMA_RANKINGS_DATA !== "undefined" ? OMA_RANKINGS_DATA : { ajg: [], ft50: [], utd24: [] });
    const byISSN = new Map();
    const byTitle = new Map();
    const titlesOf = new Map(); // AJG entry → its ISSNs, to tie FT50/UTD24 titles to ISSNs
    for (const [pissn, eissn, title, field, rating] of d.ajg || []) {
      const entry = { rating: String(rating), field: String(field || ""), title: String(title) };
      const ids = [OmaRankings.normISSN(pissn), OmaRankings.normISSN(eissn)].filter(Boolean);
      for (const id of ids) byISSN.set(id, entry);
      byTitle.set(OmaRankings.normTitle(title), entry);
      titlesOf.set(entry, ids);
    }
    const listed = (titles) => {
      const t = new Set();
      const ids = new Set();
      for (const title of titles || []) {
        const n = OmaRankings.normTitle(title);
        t.add(n);
        const e = byTitle.get(n);
        for (const id of (e && titlesOf.get(e)) || []) ids.add(id);
      }
      return { titles: t, issns: ids };
    };
    const abdcByISSN = new Map();
    const abdcByTitle = new Map();
    for (const [pissn, eissn, title, rating] of d.abdc || []) {
      for (const id of [OmaRankings.normISSN(pissn), OmaRankings.normISSN(eissn)]) if (id) abdcByISSN.set(id, String(rating));
      abdcByTitle.set(OmaRankings.normTitle(title), String(rating));
    }
    const maps = { byISSN, byTitle, abdcByISSN, abdcByTitle, ft50: listed(d.ft50), utd24: listed(d.utd24), edition: d.ajgEdition || "AJG" };
    if (!data) OmaRankings._maps = maps;
    return maps;
  },

  /**
   * An item's rankings, or null when its journal is on none of the lists.
   * @param {{issn?: string, publication?: string, abbreviation?: string}} pub
   * @returns {{ajg: string, field: string, abdc: string, ft50: boolean, utd24: boolean} | null}
   */
  lookup(pub, data) {
    const m = OmaRankings.maps(data);
    const ids = OmaRankings.issns(pub.issn);
    const titles = [pub.publication, pub.abbreviation].map((t) => OmaRankings.normTitle(t)).filter(Boolean);
    let entry = null;
    for (const id of ids) if (!entry) entry = m.byISSN.get(id) || null;
    for (const t of titles) if (!entry) entry = m.byTitle.get(t) || null;
    const on = (list) => ids.some((id) => list.issns.has(id)) || titles.some((t) => list.titles.has(t));
    let abdc = "";
    for (const id of ids) if (!abdc) abdc = m.abdcByISSN.get(id) || "";
    for (const t of titles) if (!abdc) abdc = m.abdcByTitle.get(t) || "";
    const out = { ajg: entry ? entry.rating : "", field: entry ? entry.field : "", abdc, ft50: on(m.ft50), utd24: on(m.utd24) };
    return out.ajg || out.abdc || out.ft50 || out.utd24 ? out : null;
  },

  // The labels shown for an item: ["ABS 4*", "ABDC A*", "FT50", "UTD24"].
  labels(rank) {
    if (!rank) return [];
    return [rank.ajg ? "ABS " + rank.ajg : "", rank.abdc ? "ABDC " + rank.abdc : "", rank.ft50 ? "FT50" : "", rank.utd24 ? "UTD24" : ""].filter(Boolean);
  },
};

