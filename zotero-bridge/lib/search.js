/*
 * oma-zotero search: pure query parser + fzf-style fuzzy scorer.
 *
 * Loaded into the Zotero bridge sandbox with loadSubScript (defines `OmaSearch`)
 * and required by the node tests (module.exports). No Zotero dependencies.
 *
 * Query syntax (fzf-compatible subset, space-separated terms are ANDed):
 *   word      fuzzy match in title or creators
 *   'word     exact substring            ^word  prefix     word$  suffix
 *   !word     exclude (exact)            a|b    or "a | b" either term
 *   a:smith   creators only              t:resilience  title only
 *   y:2020    year (also y:2019..2021, y:2019.., y:..2021; a bare 4-digit term is a year)
 *   #tag      tag name (fuzzy, or #'exact / #^prefix)
 */
var OmaSearch = (function () {
  "use strict";

  const COMBINING = /[̀-ͯ]/g;
  const ASCII = /^[\x00-\x7f]*$/;

  const SCORE_MATCH = 16;
  const SCORE_GAP_START = -3;
  const SCORE_GAP_EXTENSION = -1;
  const BONUS_BOUNDARY_WHITE = 10;
  const BONUS_BOUNDARY = 8;
  const BONUS_CONSECUTIVE = 4;
  const BONUS_FIRST_CHAR_MULTIPLIER = 2;

  const WEIGHT_TITLE = 1.0;
  const WEIGHT_CREATORS = 1.2;
  const WEIGHT_FIRST_CREATOR = 1.4; // people search by first author
  const WEIGHT_PUBLICATION = 0.6;
  const WEIGHT_TAG = 1.0;
  const SCORE_YEAR = 200;
  const SCORE_YEAR_IN_TITLE = 60;
  // Typing (part of) a title: titles holding the typed words as one phrase win ties,
  // more so at the start and the more of the title the phrase covers.
  const BONUS_PHRASE = 40;
  const BONUS_PHRASE_START = 20;
  const BONUS_PHRASE_COVERAGE = 40;

  function fold(str) {
    str = String(str == null ? "" : str);
    return ASCII.test(str) ? str.toLowerCase() : str.toLowerCase().normalize("NFD").replace(COMBINING, "");
  }

  // Fold per character so that match offsets can be mapped back onto the
  // original string. map[i] = index in `str` of folded char i (null = identity).
  function foldWithMap(str) {
    str = String(str == null ? "" : str);
    if (ASCII.test(str)) return { text: str.toLowerCase(), map: null };
    let text = "";
    const map = [];
    for (let i = 0; i < str.length; i++) {
      let ch = str[i];
      const code = str.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) ch = str.slice(i, i + 2);
      const folded = ch.toLowerCase().normalize("NFD").replace(COMBINING, "");
      for (let k = 0; k < folded.length; k++) {
        text += folded[k];
        map.push(i);
      }
      if (ch.length === 2) i++;
    }
    return { text, map };
  }

  // Character class of the char *before* position i, for boundary bonuses.
  function bonusAt(text, i) {
    if (i === 0) return BONUS_BOUNDARY_WHITE;
    const c = text.charCodeAt(i - 1);
    if (c === 32 || c === 9 || c === 10) return BONUS_BOUNDARY_WHITE;
    const isWord = (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c > 127;
    return isWord ? 0 : BONUS_BOUNDARY;
  }

  // fzf v1 calculateScore over text[start..end) for pattern; returns
  // { score, positions } (positions optional).
  function calculateScore(text, pattern, start, end, withPositions) {
    let pidx = 0, score = 0, inGap = false, consecutive = 0, firstBonus = 0;
    const positions = withPositions ? [] : null;
    for (let idx = start; idx < end; idx++) {
      if (text.charCodeAt(idx) === pattern.charCodeAt(pidx)) {
        score += SCORE_MATCH;
        let bonus = bonusAt(text, idx);
        if (consecutive === 0) {
          firstBonus = bonus;
        } else {
          if (bonus >= BONUS_BOUNDARY && bonus > firstBonus) firstBonus = bonus;
          bonus = Math.max(bonus, firstBonus, BONUS_CONSECUTIVE);
        }
        score += pidx === 0 ? bonus * BONUS_FIRST_CHAR_MULTIPLIER : bonus;
        if (positions) positions.push(idx);
        inGap = false;
        consecutive++;
        pidx++;
        if (pidx === pattern.length) break;
      } else {
        score += inGap ? SCORE_GAP_EXTENSION : SCORE_GAP_START;
        inGap = true;
        consecutive = 0;
        firstBonus = 0;
      }
    }
    return { score, positions };
  }

  // Best exact occurrence (prefers word starts), or null.
  function exactMatch(text, pattern, withPositions) {
    let idx = text.indexOf(pattern);
    if (idx < 0) return null;
    let best = null;
    let guard = 0;
    while (idx >= 0 && guard++ < 16) {
      const r = calculateScore(text, pattern, idx, idx + pattern.length, withPositions);
      if (!best || r.score > best.score) best = r;
      if (bonusAt(text, idx) === BONUS_BOUNDARY_WHITE) break;
      idx = text.indexOf(pattern, idx + 1);
    }
    return best;
  }

  // fzf v1: forward pass to find the end, backward pass to find the tightest
  // start. Both passes jump with native indexOf/lastIndexOf per pattern char
  // instead of stepping through every text char in JS (the profiled hot spot).
  function fuzzyMatch(text, pattern, withPositions) {
    const exact = exactMatch(text, pattern, withPositions);
    if (exact) return exact;
    const m = pattern.length;
    let pos = text.indexOf(pattern[0]);
    if (pos < 0) return null;
    for (let k = 1; k < m; k++) {
      pos = text.indexOf(pattern[k], pos + 1);
      if (pos < 0) return null;
    }
    const eidx = pos + 1;
    for (let k = m - 2; k >= 0; k--) pos = text.lastIndexOf(pattern[k], pos - 1);
    return calculateScore(text, pattern, pos, eidx, withPositions);
  }

  function matchKind(text, term, withPositions) {
    if (!text) return null;
    const v = term.value;
    switch (term.kind) {
      case "exact":
        return exactMatch(text, v, withPositions);
      case "prefix":
        return text.startsWith(v) ? calculateScore(text, v, 0, v.length, withPositions) : null;
      case "suffix":
        return text.endsWith(v) ? calculateScore(text, v, text.length - v.length, text.length, withPositions) : null;
      case "equal":
        return text === v ? calculateScore(text, v, 0, v.length, withPositions) : null;
      default:
        return fuzzyMatch(text, v, withPositions);
    }
  }

  // Weighted creators score (or null). A match within the first creator beats
  // one in later co-authors; ^prefix / suffix$ apply to each creator's name.
  function matchCreators(entry, term) {
    const names = entry._c;
    if (!names.length) return null;
    let best = null;
    const first = matchKind(names[0], term, false);
    if (first) best = first.score * WEIGHT_FIRST_CREATOR;
    if (names.length > 1) {
      let rest = null;
      if (term.kind === "fuzzy" || term.kind === "exact") {
        rest = matchKind(entry._cj, term, false);
      } else {
        for (let i = 1; i < names.length; i++) {
          const r = matchKind(names[i], term, false);
          if (r && (!rest || r.score > rest.score)) rest = r;
        }
      }
      if (rest && (best === null || rest.score * WEIGHT_CREATORS > best)) best = rest.score * WEIGHT_CREATORS;
    }
    return best;
  }

  // Bitmask of a-z (bits 0-25) and "any digit" (bit 26): a cheap necessary
  // condition for a subsequence match, checked before any scoring.
  function charMask(text) {
    let m = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c >= 97 && c <= 122) m |= 1 << (c - 97);
      else if (c >= 48 && c <= 57) m |= 1 << 26;
    }
    return m;
  }

  function normalizeField(f) {
    f = f.toLowerCase();
    if (f === "a" || f === "au" || f === "author") return "creators";
    if (f === "t" || f === "ti" || f === "title") return "title";
    if (f === "y" || f === "year") return "year";
    if (f === "p" || f === "pub") return "publication";
    return null;
  }

  function parseYear(value) {
    const m = /^(\d{4})?(\.\.)?(\d{4})?$/.exec(value);
    if (!m || (!m[1] && !m[3])) return null;
    if (!m[2]) return { from: +m[1], to: +m[1] };
    return { from: m[1] ? +m[1] : -Infinity, to: m[3] ? +m[3] : Infinity };
  }

  function parseTerm(token) {
    let value = token, negate = false, field = null;
    if (value.startsWith("!")) { negate = true; value = value.slice(1); }
    const qualified = /^([a-z]+):(.*)$/i.exec(value);
    if (qualified && normalizeField(qualified[1])) {
      field = normalizeField(qualified[1]);
      value = qualified[2];
    } else if (value.startsWith("#")) {
      field = "tag";
      value = value.slice(1);
    }
    if (!value) return null;

    if (field === "year" || (!field && /^\d{4}$/.test(value))) {
      const range = parseYear(value);
      if (range) return { negate, field: "year", kind: "year", from: range.from, to: range.to, bare: !field, value };
      if (field === "year") return null;
    }

    let kind = "fuzzy";
    if (value.startsWith("'")) { kind = "exact"; value = value.slice(1); }
    else if (value.startsWith("^")) { kind = "prefix"; value = value.slice(1); }
    if (value.length > 1 && value.endsWith("$")) {
      kind = kind === "prefix" ? "equal" : "suffix";
      value = value.slice(0, -1);
    }
    if (negate && kind === "fuzzy") kind = "exact"; // fzf: !term is an inverse exact match
    value = fold(value);
    if (!value) return null;
    return { negate, field, kind, value, mask: charMask(value) };
  }

  function parseQuery(query) {
    const raw = String(query == null ? "" : query).trim();
    const groups = [];
    if (!raw) return { groups };
    let joinNext = false;
    for (const token of raw.split(/\s+/)) {
      if (token === "|") { joinNext = groups.length > 0; continue; }
      const alternatives = token.length > 1 && token.includes("|") ? token.split("|").filter(Boolean) : [token];
      const terms = alternatives.map(parseTerm).filter(Boolean);
      if (!terms.length) continue;
      if (joinNext) groups[groups.length - 1].push(...terms);
      else groups.push(terms);
      joinNext = false;
    }
    return { groups };
  }

  // Score one term against an entry: null = no match, else the weighted score.
  function scoreTerm(entry, term) {
    if (term.kind === "year") {
      const y = entry.year;
      if (y != null && y >= term.from && y <= term.to) return SCORE_YEAR;
      if (term.bare && entry._t.indexOf(term.value) >= 0) return SCORE_YEAR_IN_TITLE;
      return null;
    }
    const f = term.field;
    let best = null;
    let r;
    if (f === "tag") {
      for (const tag of entry._tags) {
        r = matchKind(tag, term, false);
        if (r && (best === null || r.score * WEIGHT_TAG > best)) best = r.score * WEIGHT_TAG;
      }
      return best;
    }
    if (f === "publication") {
      r = matchKind(entry._p, term, false);
      return r ? r.score * WEIGHT_PUBLICATION : null;
    }
    // Title/creators: per-field masks rule out most non-matches before scanning.
    const m = term.mask;
    if ((entry._mask & m) !== m) return null;
    if ((f === null || f === "title") && (entry._tmask & m) === m) {
      r = matchKind(entry._t, term, false);
      if (r) best = r.score * WEIGHT_TITLE;
    }
    if ((f === null || f === "creators") && (entry._cmask & m) === m) {
      const s = matchCreators(entry, term);
      if (s !== null && (best === null || s > best)) best = s;
    }
    return best;
  }

  // Sum of best score per AND-group, or null when any group fails.
  function matchEntry(entry, parsed) {
    let total = 0;
    for (const group of parsed.groups) {
      let passed = false, groupBest = null;
      for (const term of group) {
        const score = scoreTerm(entry, term);
        if (term.negate) {
          if (score === null) passed = true;
        } else if (score !== null) {
          passed = true;
          if (groupBest === null || score > groupBest) groupBest = score;
        }
      }
      if (!passed) return null;
      if (groupBest !== null) total += groupBest;
    }
    return total;
  }

  // Title highlight positions for every positive term that matches the title,
  // even when another field (creators) scored higher for that term.
  function titlePositions(entry, parsed) {
    const positions = [];
    for (const group of parsed.groups) {
      for (const term of group) {
        if (term.negate) continue;
        if (term.kind === "year") {
          const inYear = entry.year != null && entry.year >= term.from && entry.year <= term.to;
          if (term.bare && !inYear) {
            const r = exactMatch(entry._t, term.value, true);
            if (r) positions.push(...r.positions);
          }
          continue;
        }
        if (term.field !== null && term.field !== "title") continue;
        const r = matchKind(entry._t, term, true);
        if (r) positions.push(...r.positions);
      }
    }
    return positions;
  }

  // Convert folded-title positions into merged [start, end) ranges in the original title.
  function toRanges(positions, map) {
    if (!positions || !positions.length) return [];
    const idx = Array.from(new Set(positions.map((p) => (map ? map[p] : p)))).sort((a, b) => a - b);
    const ranges = [];
    let start = idx[0], prev = idx[0];
    for (let i = 1; i < idx.length; i++) {
      if (idx[i] === prev + 1) { prev = idx[i]; continue; }
      ranges.push([start, prev + 1]);
      start = prev = idx[i];
    }
    ranges.push([start, prev + 1]);
    return ranges;
  }

  // Build the search view of an index entry. Input fields:
  //   title, creators: [names], year: number|null, publication, tags: [names]
  function prepareEntry(entry) {
    const t = foldWithMap(entry.title || "");
    entry._t = t.text;
    entry._tmap = t.map;
    entry._c = (entry.creators || []).map(fold).filter(Boolean);
    entry._cj = entry._c.join("; ");
    entry._tmask = charMask(entry._t);
    entry._cmask = charMask(entry._cj);
    entry._mask = entry._tmask | entry._cmask;
    entry._p = fold(entry.publication || "");
    entry._tags = (entry.tags || []).map(fold);
    return entry;
  }

  // The query's title words as one phrase: its positive fuzzy/exact/prefix terms that
  // may match the title, in order. "" when the query has OR groups.
  function titlePhrase(parsed) {
    const words = [];
    for (const group of parsed.groups) {
      if (group.length !== 1) return "";
      const t = group[0];
      if (t.negate || t.kind === "year" || (t.field !== null && t.field !== "title")) continue;
      if (t.kind === "fuzzy" || t.kind === "exact" || t.kind === "prefix") words.push(t.value);
    }
    return words.join(" ");
  }

  function phraseBonus(title, phrase) {
    const at = title.indexOf(phrase);
    if (at < 0) return 0;
    return BONUS_PHRASE + (at === 0 ? BONUS_PHRASE_START : 0) + Math.round((BONUS_PHRASE_COVERAGE * phrase.length) / title.length);
  }

  // Best first. Dates are "YYYY-MM-DD HH:MM:SS", so plain comparison is
  // chronological (localeCompare's ICU collation was the hot spot).
  function compareHits(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    const ao = a.openRank == null ? Infinity : a.openRank;
    const bo = b.openRank == null ? Infinity : b.openRank;
    if (ao !== bo) return ao - bo;
    const ad = a.entry.dateModified || "";
    const bd = b.entry.dateModified || "";
    return ad < bd ? 1 : ad > bd ? -1 : 0;
  }

  // Keep `top` sorted best-first with at most `limit` hits.
  function insertTop(top, hit, limit) {
    let lo = 0, hi = top.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compareHits(top[mid], hit) <= 0) lo = mid + 1;
      else hi = mid;
    }
    if (lo >= limit) return;
    top.splice(lo, 0, hit);
    if (top.length > limit) top.pop();
  }

  function sameTerm(a, b) {
    return a.negate === b.negate && a.field === b.field && a.kind === b.kind && a.value === b.value && a.from === b.from && a.to === b.to;
  }

  // True when every entry matching `next` must also match `prev`, so `next`
  // can be evaluated over prev's matches only (typing narrows, like fzf):
  // prev's groups reappear unchanged, except that its last group may be a
  // single non-negated term whose value `next` extends; new groups may follow.
  function canNarrow(prev, next) {
    const pg = prev.groups, ng = next.groups;
    if (!pg.length || ng.length < pg.length) return false;
    for (let i = 0; i < pg.length; i++) {
      const a = pg[i], b = ng[i];
      if (a.length !== b.length) return false;
      for (let k = 0; k < a.length; k++) {
        if (sameTerm(a[k], b[k])) continue;
        const x = a[k], y = b[k];
        if (i !== pg.length - 1 || a.length !== 1) return false;
        if (x.negate || y.negate || x.kind !== y.kind || x.field !== y.field) return false;
        if (x.kind === "year" || x.kind === "suffix" || x.kind === "equal") return false;
        if (!y.value.startsWith(x.value)) return false;
      }
    }
    return true;
  }

  // AND-groups can be evaluated in any order; run cheap/selective ones first so
  // most entries are rejected before the expensive fuzzy scans.
  function groupCost(group) {
    let cost = 0;
    for (const t of group) {
      const c = t.kind === "year" ? 0 : t.field === "tag" ? 1 : t.kind !== "fuzzy" ? 2 : 10 - Math.min(t.value.length, 7);
      cost = Math.max(cost, c);
    }
    return cost;
  }

  function orderForEvaluation(parsed) {
    const groups = parsed.groups.slice().sort((a, b) => groupCost(a) - groupCost(b));
    return { groups };
  }

  /**
   * @param {Array} entries prepared entries (or a previous result's `matched`,
   *   when canNarrow(previous.parsed, parsed) holds)
   * @param {string|object} query raw query or parseQuery() result
   * @param {object} [opts] { limit=60, openRank: Map<entryId, rank>, collectMatches }
   * @returns {{ results: Array<{entry, score, titleRanges, openRank}>, total: number,
   *   parsed: object, matched?: Array }} `matched` = every matching entry (collectMatches)
   */
  function search(entries, query, opts) {
    opts = opts || {};
    const limit = opts.limit == null ? 60 : opts.limit;
    const parsed = typeof query === "string" ? parseQuery(query) : query;
    if (!parsed.groups.length) return { results: [], total: 0, parsed, matched: opts.collectMatches ? [] : undefined };
    const ordered = orderForEvaluation(parsed);
    const phrase = titlePhrase(parsed);
    const usePhrase = phrase.length >= 3; // "s", "su": nearly every title; leave those to the term scores
    const openRank = opts.openRank || null;
    const matched = opts.collectMatches ? [] : null;
    const results = [];
    let total = 0;
    for (const entry of entries) {
      let score = matchEntry(entry, ordered);
      if (score === null) continue;
      if (usePhrase) score += phraseBonus(entry._t, phrase);
      total++;
      if (matched) matched.push(entry);
      const rank = openRank ? openRank.get(entry.id) : undefined;
      const openRankValue = rank == null ? null : rank;
      // A full top list only admits hits that beat its worst one. Short queries
      // produce thousands of equal scores, so settle ties here without allocating.
      if (results.length === limit) {
        const worst = results[limit - 1];
        if (score < worst.score) continue;
        if (score === worst.score) {
          const ao = openRankValue == null ? Infinity : openRankValue;
          const bo = worst.openRank == null ? Infinity : worst.openRank;
          if (ao > bo || (ao === bo && (entry.dateModified || "") <= (worst.entry.dateModified || ""))) continue;
        }
      }
      insertTop(results, { entry, score, openRank: openRankValue }, limit);
    }
    // Highlight positions only for the rows we return (cheap second pass).
    for (const hit of results) hit.titleRanges = toRanges(titlePositions(hit.entry, parsed), hit.entry._tmap);
    return { results, total, parsed, matched: matched || undefined };
  }

  return { fold, foldWithMap, parseQuery, parseTerm, prepareEntry, search, canNarrow, toRanges, titlePhrase, _fuzzyMatch: fuzzyMatch };
})();

if (typeof module !== "undefined") module.exports = OmaSearch;
