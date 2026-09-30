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
 *   #tag      tag name (fuzzy, or #'exact / #^prefix); also tag:name
 *   p:journal publication                c:path  collection (and its subcollections)
 *   type:book item type                  has:pdf / has:notes / has:files
 *   y:>=2020  year compared (>, <, =, >=, <=)
 *   status:reading  a paper status (the launcher's status tags; status:none: none of them)
 *   task:waiting    a task about the paper with that status (or group)
 *   has:task / has:chat / has:collection (in a collection; also has:list)
 * Status, task, has:task and has:chat come from the launcher (the bridge resolves them per
 * query: term.tags, term.keys; has:collection: term.ids), like a c: term's papers.
 *   "a b"     an exact phrase; a quoted tag, author, publication, collection or type
 *             is the whole name: #"supply chain", a:"Smith, John", c:"Topics / SCM"
 * Boolean: AND (the default), OR, NOT (uppercase) and ( ). NOT binds tightest, then
 * AND, then OR; `|` is a tight OR between neighbours ("a | b c" = (a OR b) AND c).
 * Queries without AND/OR/NOT/( ) parse into AND-groups of OR-terms (`groups`), the
 * fast path; the rest into an expression tree (`expr`).
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
  const SCORE_FILTER = 100; // a collection, item type or has: filter that holds
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
    if (f === "p" || f === "pub" || f === "publication" || f === "journal") return "publication";
    if (f === "tag") return "tag";
    if (f === "c" || f === "col" || f === "collection") return "collection";
    if (f === "type") return "type";
    if (f === "has") return "has";
    if (f === "status") return "status";
    if (f === "task" || f === "tasks") return "task";
    return null;
  }

  // Quoted, these fields match the whole name, not part of it.
  const WHOLE_WHEN_QUOTED = { tag: true, creators: true, publication: true, collection: true, type: true };
  // has:<what> (a prefix is enough: has:p) → what it checks.
  const HAS = [["pdf", "pdf"], ["notes", "notes"], ["files", "files"], ["attachments", "files"], ["tasks", "task"], ["chats", "chat"],
    ["collections", "collection"], ["lists", "collection"]];
  // has: values the index can't answer alone (the bridge resolves them per query).
  const HAS_RESOLVED = { task: true, chat: true, collection: true };

  // '"a b"' → 'a b' (an unclosed quote, while typing, runs to the end); else null.
  function unquote(value) {
    if (!value.startsWith('"')) return null;
    value = value.slice(1);
    return value.endsWith('"') ? value.slice(0, -1) : value;
  }

  function parseYear(value) {
    const op = /^(>=|<=|>|<|=)(\d{4})$/.exec(value);
    if (op) {
      const y = +op[2];
      if (op[1] === "=") return { from: y, to: y };
      if (op[1] === ">") return { from: y + 1, to: Infinity };
      if (op[1] === ">=") return { from: y, to: Infinity };
      if (op[1] === "<") return { from: -Infinity, to: y - 1 };
      return { from: -Infinity, to: y };
    }
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
    const inner = unquote(value);
    const quoted = inner !== null;
    if (quoted) value = inner;
    if (!value.trim()) return null;

    if (field === "status" || field === "task") {
      const v = fold(value).trim();
      return v ? { negate, field, kind: field, value: v } : null;
    }
    if (field === "has") {
      const v = fold(value).trim();
      const hit = HAS.find((h) => h[0].startsWith(v));
      return hit ? { negate, field, kind: "has", value: hit[1] } : null;
    }
    if (field === "year" || (!field && !quoted && /^\d{4}$/.test(value))) {
      const range = parseYear(value.trim());
      if (range) return { negate, field: "year", kind: "year", from: range.from, to: range.to, bare: !field, value };
      if (field === "year") return null;
    }

    let kind = "fuzzy";
    if (quoted) {
      kind = WHOLE_WHEN_QUOTED[field] ? "equal" : "exact";
    } else {
      if (value.startsWith("'")) { kind = "exact"; value = value.slice(1); }
      else if (value.startsWith("^")) { kind = "prefix"; value = value.slice(1); }
      if (value.length > 1 && value.endsWith("$")) {
        kind = kind === "prefix" ? "equal" : "suffix";
        value = value.slice(0, -1);
      }
    }
    if (negate && kind === "fuzzy") kind = "exact"; // fzf: !term is an inverse exact match
    value = fold(value);
    if (!value) return null;
    return { negate, field, kind, value, mask: charMask(value) };
  }

  // Words, quoted strings (spaces and all) and parentheses.
  function tokenize(raw) {
    const tokens = [];
    let cur = "", quote = false;
    for (const ch of raw) {
      if (quote) {
        cur += ch;
        if (ch === '"') quote = false;
      } else if (ch === '"') {
        cur += ch;
        quote = true;
      } else if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        if (cur) tokens.push(cur);
        cur = "";
      } else if (ch === "(" || ch === ")") {
        if (cur) tokens.push(cur);
        cur = "";
        tokens.push(ch);
      } else {
        cur += ch;
      }
    }
    if (cur) tokens.push(cur);
    return tokens;
  }

  // "x|y" → ["x", "y"], leaving bars inside quotes alone.
  function splitBars(token) {
    if (token.length < 2 || token.indexOf("|") < 0) return [token];
    const parts = [];
    let cur = "", quote = false;
    for (const ch of token) {
      if (ch === '"') quote = !quote;
      if (ch === "|" && !quote) { parts.push(cur); cur = ""; continue; }
      cur += ch;
    }
    parts.push(cur);
    return parts.filter(Boolean);
  }

  // Nodes: { op: "term", term } | { op: "and" | "or", children } | { op: "not", child }.
  // null when there is nothing; a single part stands for itself; nested and/or flatten.
  function node(op, parts) {
    if (!parts.length) return null;
    if (parts.length === 1) return parts[0];
    const children = [];
    for (const p of parts) {
      if (p.op === op) children.push(...p.children);
      else children.push(p);
    }
    return { op, children };
  }

  // Lenient, since the query is parsed as it is typed: a missing ")" closes at the end, a stray
  // one is skipped, and an operator with nothing after it is ignored.
  function parseExpr(tokens) {
    let i = 0;
    const peek = () => tokens[i];
    const stop = (t) => t === undefined || t === ")" || t === "OR" || t === "AND" || t === "|";
    function leaf(token) {
      const found = splitBars(token).map(parseTerm).filter(Boolean);
      return node("or", found.map((term) => ({ op: "term", term })));
    }
    function primary() {
      const t = tokens[i++];
      if (t !== "(") return leaf(t);
      const e = or();
      if (peek() === ")") i++;
      return e;
    }
    function unary() {
      if (stop(peek())) return null;
      if (peek() === "NOT") {
        i++;
        const child = unary();
        return child ? { op: "not", child } : null;
      }
      return primary();
    }
    function tight() {
      const parts = [];
      const first = unary();
      if (first) parts.push(first);
      while (peek() === "|") {
        i++;
        const next = unary();
        if (next) parts.push(next);
      }
      return node("or", parts);
    }
    function and() {
      const parts = [];
      for (;;) {
        const t = peek();
        if (t === undefined || t === ")" || t === "OR") break;
        if (t === "AND" || t === "|") { i++; continue; }
        const n = tight();
        if (n) parts.push(n);
      }
      return node("and", parts);
    }
    function or() {
      const parts = [];
      for (;;) {
        const n = and();
        if (n) parts.push(n);
        if (peek() !== "OR") break;
        i++;
      }
      return node("or", parts);
    }
    const parts = [];
    while (i < tokens.length) {
      const n = or();
      if (n) parts.push(n);
      if (peek() === ")") i++;
    }
    return node("and", parts);
  }

  function negated(term) {
    const t = Object.assign({}, term, { negate: true });
    if (t.kind === "fuzzy") t.kind = "exact"; // as !term
    return t;
  }

  // The tree as AND-groups of OR-terms, or null when it isn't one (NOT over a group, OR of ANDs).
  function toGroups(expr) {
    if (!expr) return [];
    const groups = [];
    for (const conj of expr.op === "and" ? expr.children : [expr]) {
      const group = [];
      for (const alt of conj.op === "or" ? conj.children : [conj]) {
        if (alt.op === "term") group.push(alt.term);
        else if (alt.op === "not" && alt.child.op === "term" && !alt.child.term.negate) group.push(negated(alt.child.term));
        else return null;
      }
      groups.push(group);
    }
    return groups;
  }

  function fromExpr(expr) {
    const groups = toGroups(expr);
    return groups ? { groups, expr: null } : { groups: [], expr };
  }

  function toExpr(parsed) {
    if (parsed.expr) return parsed.expr;
    return node("and", parsed.groups.map((g) => node("or", g.map((term) => ({ op: "term", term })))));
  }

  function parseQuery(query) {
    const raw = String(query == null ? "" : query).trim();
    if (!raw) return { groups: [], expr: null };
    return fromExpr(parseExpr(tokenize(raw)));
  }

  // Both must match (a saved search, and what is typed within it).
  function combine(a, b) {
    return fromExpr(node("and", [toExpr(a), toExpr(b)].filter(Boolean)));
  }

  function isEmpty(parsed) {
    return !parsed.groups.length && !parsed.expr;
  }

  // Every term, for resolving (collections) before a search.
  function terms(parsed) {
    const out = [];
    const walk = (n) => {
      if (n.op === "term") out.push(n.term);
      else if (n.op === "not") walk(n.child);
      else n.children.forEach(walk);
    };
    if (parsed.expr) walk(parsed.expr);
    else for (const g of parsed.groups) out.push(...g);
    return out;
  }

  // The terms whose matches count for a hit (not negated, not under NOT): for highlights.
  function positiveTerms(parsed) {
    if (!parsed.expr) return [].concat(...parsed.groups).filter((t) => !t.negate);
    const out = [];
    const walk = (n, neg) => {
      if (n.op === "term") { if (!neg && !n.term.negate) out.push(n.term); }
      else if (n.op === "not") walk(n.child, !neg);
      else for (const c of n.children) walk(c, neg);
    };
    walk(parsed.expr, false);
    return out;
  }

  // Does a collection (its search entry: the path is the title) match a c: term? Unquoted: the
  // words anywhere in its path; quoted: its whole path, or its name.
  function collectionMatch(entry, term) {
    const v = term.value;
    if (term.kind === "equal") return entry._t === v || fold(entry.name || "") === v ? { score: SCORE_FILTER } : null;
    if (term.kind === "fuzzy") return exactMatch(entry._t, v, false);
    return matchKind(entry._t, term, false);
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
    if (f === "collection") {
      if (entry.kind === "collection") {
        r = collectionMatch(entry, term);
        return r ? r.score : null;
      }
      return term.ids && term.ids.has(entry.id) ? SCORE_FILTER : null; // the bridge resolves ids
    }
    if (f === "type") {
      // unquoted: a prefix of the type (type:book is book and bookSection); quoted: the type
      if (!entry._type) return null;
      const held = term.kind === "fuzzy" ? entry._type.startsWith(term.value) : !!matchKind(entry._type, term, false);
      return held ? SCORE_FILTER : null;
    }
    if (f === "status") {
      // term.tags: the folded status tags it means; term.none: none of them
      if (!term.tags) return null;
      const held = entry._tags.some((t) => term.tags.has(t));
      return (term.none ? !held : held) ? SCORE_FILTER : null;
    }
    if (f === "task" || (f === "has" && (term.value === "task" || term.value === "chat"))) {
      return term.keys && term.keys.has(entry.libraryID + ":" + entry.key) ? SCORE_FILTER : null;
    }
    if (f === "has" && term.value === "collection") return term.ids && term.ids.has(entry.id) ? SCORE_FILTER : null;
    if (f === "has") {
      const pdfs = entry.pdfCount || 0;
      const held = term.value === "pdf" ? pdfs > 0 : term.value === "notes" ? (entry.noteCount || 0) > 0 : pdfs + (entry.attachmentCount || 0) > 0;
      return held ? SCORE_FILTER : null;
    }
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

  // An expression's score for an entry: AND adds its parts' scores, OR takes the best, NOT
  // passes (0) when its part fails; null = no match.
  function evalNode(entry, n) {
    if (n.op === "term") {
      const s = scoreTerm(entry, n.term);
      return n.term.negate ? (s === null ? 0 : null) : s;
    }
    if (n.op === "not") return evalNode(entry, n.child) === null ? 0 : null;
    if (n.op === "and") {
      let total = 0;
      for (const c of n.children) {
        const s = evalNode(entry, c);
        if (s === null) return null;
        total += s;
      }
      return total;
    }
    let best = null;
    for (const c of n.children) {
      const s = evalNode(entry, c);
      if (s !== null && (best === null || s > best)) best = s;
    }
    return best;
  }

  // Title highlight positions for every positive term that matches the title,
  // even when another field (creators) scored higher for that term.
  function titlePositions(entry, parsed) {
    const positions = [];
    for (const term of positiveTerms(parsed)) {
      if (term.kind === "year") {
        const inYear = entry.year != null && entry.year >= term.from && entry.year <= term.to;
        if (term.bare && !inYear) {
          const r = exactMatch(entry._t, term.value, true);
          if (r) positions.push(...r.positions);
        }
        continue;
      }
      if (term.field === "collection" && entry.kind === "collection" && term.kind !== "equal") {
        const r = term.kind === "fuzzy" ? exactMatch(entry._t, term.value, true) : matchKind(entry._t, term, true);
        if (r) positions.push(...r.positions);
        continue;
      }
      if (term.field !== null && term.field !== "title") continue;
      const r = matchKind(entry._t, term, true);
      if (r) positions.push(...r.positions);
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
    entry._type = fold(entry.itemType || "");
    return entry;
  }

  // The query's title words as one phrase: its positive fuzzy/exact/prefix terms that
  // may match the title, in order. "" when the query has OR groups.
  function titlePhrase(parsed) {
    if (parsed.expr) return "";
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
    if (prev.expr || next.expr || !pg.length || ng.length < pg.length) return false;
    // A collection's papers are looked up for each query (they aren't in the index): never reused.
    if (ng.some((g) => g.some((t) => t.field === "collection" || resolved(t)))) return false;
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

  // Does the term depend on what the launcher knows (statuses, tasks, chats) or on collections?
  function resolved(t) {
    return t.kind === "status" || t.kind === "task" || (t.kind === "has" && !!HAS_RESOLVED[t.value]);
  }

  // status:<value> → { tags: Set of folded status tags, none }: "none" is none of them; else the
  // status it names (or, failing that, those it starts).
  function statusTerm(statusTags, value) {
    const all = (statusTags || []).map(fold);
    const v = fold(value);
    if (v === "none" || v === "no") return { tags: new Set(all), none: true };
    const exact = all.filter((t) => t === v);
    return { tags: new Set(exact.length ? exact : all.filter((t) => t.startsWith(v))), none: false };
  }

  // task:<value> → the keys ("libraryID:key") of the papers with a task whose status (or its
  // group: backlog, next, active, waiting, completed) is that, or starts so. tasks: [{ id, status, group }].
  function taskKeys(tasks, value) {
    const v = fold(value);
    const exact = (tasks || []).filter((t) => fold(t.status) === v || fold(t.group) === v);
    const hits = exact.length ? exact : (tasks || []).filter((t) => fold(t.status).startsWith(v) || fold(t.group).startsWith(v));
    return new Set(hits.map((t) => String(t.id)));
  }

  // AND-groups can be evaluated in any order; run cheap/selective ones first so
  // most entries are rejected before the expensive fuzzy scans.
  function groupCost(group) {
    let cost = 0;
    for (const t of group) {
      const c = t.kind === "year" || t.kind === "has" || t.kind === "status" || t.kind === "task" || t.field === "collection" || t.field === "type" ? 0 : t.field === "tag" ? 1 : t.kind !== "fuzzy" ? 2 : 10 - Math.min(t.value.length, 7);
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
    if (isEmpty(parsed)) return { results: [], total: 0, parsed, matched: opts.collectMatches ? [] : undefined };
    const ordered = parsed.expr ? null : orderForEvaluation(parsed);
    const phrase = titlePhrase(parsed);
    // "s", "su": nearly every title; leave those to the term scores. opts.phrase false: never (short
    // labels, where it would only favour the shortest).
    const usePhrase = opts.phrase !== false && phrase.length >= 3;
    const openRank = opts.openRank || null;
    const matched = opts.collectMatches ? [] : null;
    const results = [];
    let total = 0;
    for (const entry of entries) {
      let score = parsed.expr ? evalNode(entry, parsed.expr) : matchEntry(entry, ordered);
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

  return { fold, foldWithMap, parseQuery, parseTerm, tokenize, combine, isEmpty, terms, collectionMatch, resolved, statusTerm, taskKeys, prepareEntry, search, canNarrow, toRanges, titlePhrase, _fuzzyMatch: fuzzyMatch };
})();

if (typeof module !== "undefined") module.exports = OmaSearch;
