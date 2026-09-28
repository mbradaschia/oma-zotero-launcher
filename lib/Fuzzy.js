// Fuzzy matching for the overlay's local lists (tags, notes, actions): fzf-style
// subsequence scoring, case- and accent-insensitive (node-testable). The main
// search runs in the bridge; these lists hold at most a few thousand short
// strings, which this handles per keystroke.
//
// Query terms (split on spaces) must all match, in any order. A term matches
// when its characters appear in order; word starts, consecutive runs and
// prefixes score higher, gaps lower.

var SCORE_MATCH = 16
var BONUS_BOUNDARY = 10
var BONUS_FIRST_CHAR = 6
var BONUS_CONSECUTIVE = 6
var PENALTY_GAP_START = 3
var PENALTY_GAP = 1
var BONUS_PREFIX = 12
var BONUS_EXACT = 30

// Lowercased, accents stripped, with a map from each folded char to its index in `s`.
function fold(s) {
  s = String(s == null ? "" : s)
  var out = ""
  var map = []
  for (var i = 0; i < s.length; i++) {
    var c = s[i]
    var f = c
    var code = c.charCodeAt(0)
    if (code >= 0xc0 && code < 0x2000 && typeof c.normalize === "function") f = c.normalize("NFD").replace(/[̀-ͯ]/g, "")
    f = f.toLowerCase()
    for (var k = 0; k < f.length; k++) {
      out += f[k]
      map.push(i)
    }
  }
  return { text: out, map: map }
}

function isWordChar(c) {
  return /[a-z0-9À-￿]/i.test(c)
}

// Best (fzf v1-style) alignment of one folded term in folded text, or null.
function matchTerm(term, text) {
  var n = text.length
  var m = term.length
  if (!m) return { score: 0, positions: [] }
  if (m > n) return null
  // Forward: the earliest end of an in-order match…
  var ti = 0
  var end = -1
  for (var i = 0; i < n; i++) {
    if (text[i] === term[ti]) {
      ti++
      if (ti === m) {
        end = i
        break
      }
    }
  }
  if (end < 0) return null
  // …backward from there: the latest start, i.e. the tightest window.
  ti = m - 1
  var start = end
  for (var j = end; j >= 0; j--) {
    if (text[j] === term[ti]) {
      ti--
      if (ti < 0) {
        start = j
        break
      }
    }
  }
  // A contiguous occurrence beats a scattered window; one at a word start beats one mid-word.
  var sub = -1
  for (var at = text.indexOf(term); at >= 0; at = text.indexOf(term, at + 1)) {
    if (sub < 0) sub = at
    if (at === 0 || !isWordChar(text[at - 1])) {
      sub = at
      break
    }
  }
  if (sub >= 0) {
    start = sub
    end = sub + m - 1
  }
  var positions = []
  var score = 0
  var prev = -2
  ti = 0
  for (var p = start; p <= end && ti < m; p++) {
    if (text[p] !== term[ti]) continue
    var boundary = p === 0 || !isWordChar(text[p - 1])
    score += SCORE_MATCH
    if (boundary) score += BONUS_BOUNDARY
    if (ti === 0 && boundary) score += BONUS_FIRST_CHAR
    if (prev === p - 1) score += BONUS_CONSECUTIVE
    else if (prev >= 0) score -= PENALTY_GAP_START + Math.min(10, p - prev - 1) * PENALTY_GAP
    positions.push(p)
    prev = p
    ti++
  }
  if (start === 0) score += BONUS_PREFIX
  if (m === n) score += BONUS_EXACT
  return { score: score, positions: positions }
}

// Match `query` against `text` → null | { score, positions } (indices into `text`).
function match(query, text) {
  var terms = fold(query).text.split(/\s+/).filter(function (t) { return t.length > 0 })
  var f = fold(text)
  if (!terms.length) return { score: 0, positions: [] }
  var score = 0
  var seen = {}
  var positions = []
  for (var t = 0; t < terms.length; t++) {
    var r = matchTerm(terms[t], f.text)
    if (!r) return null
    score += r.score
    for (var k = 0; k < r.positions.length; k++) {
      var orig = f.map[r.positions[k]]
      if (!seen[orig]) {
        seen[orig] = true
        positions.push(orig)
      }
    }
  }
  // Shorter texts win ties: "risk" before "supply-chain risk management" for "risk".
  score -= Math.min(20, Math.floor(f.text.length / 8))
  positions.sort(function (a, b) { return a - b })
  return { score: score, positions: positions }
}

// Rank `items` by `query`. `fields`: [{ get: item → string, weight? }]; the first
// field is the one whose match positions are returned (for highlighting). With
// an empty query every item comes back, in order.
function filter(items, query, fields) {
  var out = []
  var q = String(query || "").trim()
  for (var i = 0; i < items.length; i++) {
    if (!q) {
      out.push({ item: items[i], score: 0, positions: [], index: i })
      continue
    }
    var best = null
    for (var f = 0; f < fields.length; f++) {
      var r = match(q, fields[f].get(items[i]))
      if (!r) continue
      var s = r.score * (fields[f].weight || 1)
      if (!best || s > best.score) best = { score: s, positions: f === 0 ? r.positions : [] }
    }
    if (best) out.push({ item: items[i], score: best.score, positions: best.positions, index: i })
  }
  if (q) out.sort(function (a, b) { return b.score - a.score || a.index - b.index })
  return out
}

// Match positions → [start, end) ranges for Views.highlight().
function ranges(positions) {
  var out = []
  for (var i = 0; i < positions.length; i++) {
    var last = out[out.length - 1]
    if (last && last[1] === positions[i]) last[1]++
    else out.push([positions[i], positions[i] + 1])
  }
  return out
}

if (typeof module !== "undefined") {
  module.exports = { fold: fold, match: match, matchTerm: matchTerm, filter: filter, ranges: ranges }
}
