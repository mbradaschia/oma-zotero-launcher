// When two machines changed the same synced file while apart, the sync tool keeps both: the file
// and a conflict copy beside it. This puts them back together, for both launchers (SYNC-FORMAT.md,
// "Conflicts"). Pure and deterministic: the same two files give the same bytes on either machine,
// whichever is "mine". The callers find the copies, read, write
// the merge (atomically) and only then delete the copy.
//
// Lists of records (todos.json, pins.json, searches.json) merge by record: the newer `updated`
// wins. A deletion is kept as a tombstone in the file's `deleted` list ({ id, at }), so a record
// removed on one machine doesn't come back from the other's copy; tombstones go after 30 days.
// Readers never see them (they read `todos`, `pins`, `searches`). Writers call stamp() so each
// save records its deletions and when each record changed.
// view.json and the shared settings.json merge per key (and per view inside view.json): the newer
// file wins a key both have differently. Anything else: the newer file wins, the other is kept
// beside it as <name>.conflict-<machine>.<ext>.

var KEEP_DAYS = 30

var LISTS = {
  "todos.json": { list: "todos", id: function (r) { return String(r.id) } },
  "pins.json": { list: "pins", id: function (r) { return (r.type === "collection" || r.type === "tag" ? r.type : "item") + ":" + (Number(r.libraryID) || 1) + ":" + r.key } },
  "searches.json": { list: "searches", id: function (r) { return String(r.id) } }
}
var KEYED = { "view.json": ["menuPins", "menuOther", "menuOrder", "sectionOrder", "noteOrder"], "settings.json": [] }

function isObject(x) {
  return !!x && typeof x === "object" && !Array.isArray(x)
}

function unsafeKey(k) {
  return k === "__proto__" || k === "constructor" || k === "prototype"
}

function parse(text) {
  try {
    var j = JSON.parse(String(text || ""), function (k, v) { return unsafeKey(k) ? undefined : v })
    return isObject(j) ? j : null
  } catch (e) {
    return null
  }
}

function text(obj) {
  return JSON.stringify(obj, null, 2) + "\n"
}

// What a conflict copy is a copy of. Syncthing: "todos.sync-conflict-20261013-101500-ABCDEFG.json";
// Dropbox: "todos (Mac's conflicted copy 2026-10-13).json". → { base, device, tool } or null.
function conflictOf(name) {
  var n = String(name || "")
  var s = /^(.*)\.sync-conflict-\d{8}-\d{6}-([A-Z0-9]{7})(\.[^./]+)?$/.exec(n)
  if (s && s[1]) return { base: s[1] + (s[3] || ""), device: s[2], tool: "syncthing" }
  var d = /^(.*) \((.+?)'s conflicted copy(?: \d{4}-\d{2}-\d{2})?(?: \(\d+\))?\)(\.[^./]+)?$/.exec(n)
  if (d && d[1]) return { base: d[1] + (d[3] || ""), device: d[2], tool: "dropbox" }
  return null
}

// How a file merges: "list", "keyed" or "newer".
function kindOf(base) {
  var b = String(base || "").split("/").pop()
  return LISTS[b] ? "list" : KEYED[b] ? "keyed" : "newer"
}

// The loser of a "newer" merge, kept beside it: "notes.md" → "notes.conflict-laptop.md".
function keptName(base, machine) {
  var b = String(base)
  var m = String(machine || "other").replace(/[^A-Za-z0-9._-]+/g, "-")
  var dot = b.lastIndexOf(".")
  return dot > 0 ? b.slice(0, dot) + ".conflict-" + m + b.slice(dot) : b + ".conflict-" + m
}

function withUpdated(r, at) {
  var out = {}
  for (var k in r) if (k !== "updated") out[k] = r[k]
  out.updated = at
  return out
}

function sameRecord(a, b) {
  var strip = function (r) { var o = {}; for (var k in r) if (k !== "updated") o[k] = r[k]; return JSON.stringify(o) }
  return strip(a) === strip(b)
}

function prune(deleted, now) {
  var limit = Date.parse(now) - KEEP_DAYS * 86400000
  return (deleted || []).filter(function (t) { return t && typeof t.id === "string" && !(Date.parse(t.at) < limit) })
}

// A save of a list file: `after` (the new text) with its tombstones and `updated` times, against
// `before` (the file as it was). → the text to write.
function stamp(base, before, after, now) {
  var spec = LISTS[String(base || "").split("/").pop()]
  var next = parse(after)
  if (!spec || !next) return after
  var prev = parse(before) || {}
  var was = {}
  ;(Array.isArray(prev[spec.list]) ? prev[spec.list] : []).forEach(function (r) { if (r) was[spec.id(r)] = r })
  var list = (Array.isArray(next[spec.list]) ? next[spec.list] : []).map(function (r) {
    if (!r || typeof r !== "object") return r
    var old = was[spec.id(r)]
    if (spec.list === "todos") return r // a task keeps its own `updated` (lib/Todos.js sets it)
    if (old && sameRecord(old, r)) return old.updated ? withUpdated(r, old.updated) : r // unchanged: its time stays
    return withUpdated(r, now)
  })
  var live = {}
  list.forEach(function (r) { if (r) live[spec.id(r)] = true })
  var deleted = prune(prev.deleted, now).filter(function (t) { return !live[t.id] })
  Object.keys(was).forEach(function (id) { if (!live[id] && !deleted.some(function (t) { return t.id === id })) deleted.push({ id: id, at: now }) })
  var out = {}
  for (var key in next) if (key !== "deleted") out[key] = next[key]
  out[spec.list] = list
  if (deleted.length) out.deleted = deleted
  return text(out)
}

function newest(obj, spec) {
  var t = ""
  ;(obj[spec.list] || []).forEach(function (r) { if (r && r.updated && r.updated > t) t = r.updated })
  ;(obj.deleted || []).forEach(function (d) { if (d && d.at > t) t = d.at })
  return t
}

// The file whose content leads (its order, its other keys): the newer, else the larger text.
function lead(a, b, aText, bText, aKey, bKey) {
  if (aKey !== bKey) return aKey > bKey
  return String(aText) >= String(bText)
}

function mergeLists(spec, aText, bText, now) {
  var a = parse(aText) || {}, b = parse(bText) || {}
  var aFirst = lead(a, b, aText, bText, newest(a, spec), newest(b, spec))
  var first = aFirst ? a : b, second = aFirst ? b : a
  var gone = {}
  prune((a.deleted || []).concat(b.deleted || []), now).forEach(function (t) { if (!gone[t.id] || t.at > gone[t.id]) gone[t.id] = t.at })
  var pick = {}, order = []
  ;[first, second].forEach(function (f) {
    ;(Array.isArray(f[spec.list]) ? f[spec.list] : []).forEach(function (r) {
      if (!r || typeof r !== "object") return
      var id = spec.id(r)
      if (!pick[id]) { order.push(id); pick[id] = r; return }
      var cur = pick[id]
      var ru = String(r.updated || ""), cu = String(cur.updated || "")
      if (ru > cu || (ru === cu && JSON.stringify(r) > JSON.stringify(cur))) pick[id] = r
    })
  })
  var list = [], deleted = []
  order.forEach(function (id) {
    var r = pick[id]
    if (gone[id] && !(String(r.updated || "") > gone[id])) return // deleted after its last change
    list.push(r)
  })
  Object.keys(gone).sort().forEach(function (id) { if (!list.some(function (r) { return spec.id(r) === id })) deleted.push({ id: id, at: gone[id] }) })
  var out = {}
  for (var k in first) if (k !== "deleted" && k !== spec.list) out[k] = first[k]
  for (var k2 in second) if (k2 !== "deleted" && k2 !== spec.list && !(k2 in out)) out[k2] = second[k2]
  out[spec.list] = list
  if (deleted.length) out.deleted = deleted
  return text(out)
}

function mergeObjects(a, b, aNewer, inner) {
  var out = {}
  var keys = Object.keys(a).concat(Object.keys(b).filter(function (k) { return !(k in a) })).sort()
  keys.forEach(function (k) {
    if (unsafeKey(k)) return
    if (!(k in b)) return (out[k] = a[k])
    if (!(k in a)) return (out[k] = b[k])
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) return (out[k] = a[k])
    if (inner && inner.indexOf(k) >= 0 && isObject(a[k]) && isObject(b[k])) return (out[k] = mergeObjects(a[k], b[k], aNewer, null))
    out[k] = aNewer ? a[k] : b[k]
  })
  return out
}

// Two copies of one file → { text } to write over the file, and, for the newer-wins kind,
// { kept } (the other copy, to write beside it under keptName()). times: the files' modification
// times (ms) where content can't tell which is newer; now: an ISO date.
function merge(base, aText, bText, aTime, bTime, now) {
  var b = String(base || "").split("/").pop()
  if (LISTS[b]) return { text: mergeLists(LISTS[b], aText, bText, now) }
  var aNewer = aTime !== bTime ? aTime > bTime : String(aText) >= String(bText)
  if (KEYED[b]) {
    var x = parse(aText), y = parse(bText)
    if (!x || !y) return { text: x ? aText : bText }
    return { text: text(mergeObjects(x, y, aNewer, KEYED[b])) }
  }
  return aNewer ? { text: aText, kept: bText } : { text: bText, kept: aText }
}

if (typeof module !== "undefined") module.exports = { KEEP_DAYS: KEEP_DAYS, conflictOf: conflictOf, kindOf: kindOf, keptName: keptName, stamp: stamp, merge: merge }
