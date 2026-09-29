// Pure view-model helpers for ZoteroSearch.qml (node-testable): bridge search
// responses → flat list rows with sections, StyledText titles and badges.

// Nerd Font (Font Awesome range) glyph per Zotero item type.
var ICONS = {
  journalArticle: "",
  magazineArticle: "",
  newspaperArticle: "",
  book: "",
  bookSection: "",
  encyclopediaArticle: "",
  dictionaryEntry: "",
  thesis: "",
  report: "",
  preprint: "",
  manuscript: "",
  conferencePaper: "",
  presentation: "",
  webpage: "",
  blogPost: "",
  forumPost: "",
  dataset: "",
  computerProgram: "",
  videoRecording: "",
  film: "",
  audioRecording: "",
  podcast: "",
  email: "",
  letter: "",
  case: "",
  statute: "",
  patent: "",
  note: "",
  attachment: ""
}
var DEFAULT_ICON = ""

function iconFor(itemType) {
  return ICONS[itemType] || DEFAULT_ICON
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// Title as StyledText with the matched ranges ([start, end) in the original
// string, from the bridge) in `color` + bold. Everything else is escaped.
function highlight(title, ranges, color) {
  title = String(title == null ? "" : title)
  if (!ranges || !ranges.length) return escapeHtml(title)
  var sorted = ranges.slice().sort(function (a, b) { return a[0] - b[0] })
  var out = ""
  var pos = 0
  for (var i = 0; i < sorted.length; i++) {
    var s = Math.max(pos, sorted[i][0])
    var e = Math.min(title.length, sorted[i][1])
    if (e <= s) continue
    out += escapeHtml(title.slice(pos, s)) + '<font color="' + color + '"><b>' + escapeHtml(title.slice(s, e)) + "</b></font>"
    pos = e
  }
  return out + escapeHtml(title.slice(pos))
}

function subtitle(row) {
  var parts = []
  if (row.creator) parts.push(row.creator)
  if (row.year) parts.push(String(row.year))
  if (row.publication) parts.push(row.publication)
  return parts.join(" · ")
}

// "current" = the tab Zotero is showing, "open" = any other open tab/window.
function openState(row) {
  if (!row.open) return ""
  return row.open.selected ? "current" : "open"
}

function thousands(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

function toRow(r, section, color) {
  var title = r.title || "(untitled)"
  return {
    section: section,
    key: String(r.key || ""),
    libraryID: Number(r.libraryID) || 1,
    itemType: String(r.itemType || ""),
    icon: iconFor(r.itemType),
    title: title,
    titleHtml: highlight(title, r.titleRanges, color),
    subtitle: subtitle(r),
    openState: openState(r),
    pdfCount: Number(r.pdfCount) || 0,
    noteCount: Number(r.noteCount) || 0,
    tagsText: tagsText(r.tags, r.tagCount)
  }
}

// The first tags of a result, for its second line: "#notion #resilience +2".
function tagsText(tags, total) {
  tags = tags || []
  if (!tags.length) return ""
  var shown = tags.slice(0, 3).map(function (t) { return "#" + t }).join(" ")
  var more = (Number(total) || tags.length) - Math.min(3, tags.length)
  return more > 0 ? shown + " +" + more : shown
}

var SECTION_PINNED = "Pinned"
var SECTION_OPEN = "Open in Zotero"
var SECTION_RECENT = "Recently added"
var SECTION_RECENT_MODIFIED = "Recently modified"

// Search response → rows. Empty query: pinned items, open items, then recently added
// (or modified, per the emptyQuery setting). Otherwise: ranked results (no section header).
function buildRows(resp, color) {
  var rows = []
  if (!resp) return rows
  if (!String(resp.query || "").trim()) {
    var open = resp.open || []
    var recent = resp.recent || []
    var recentSection = resp.recentBy === "modified" ? SECTION_RECENT_MODIFIED : SECTION_RECENT
    var pinned = resp.pinned || []
    for (var p = 0; p < pinned.length; p++) rows.push(toRow(pinned[p], SECTION_PINNED, color))
    for (var i = 0; i < open.length; i++) rows.push(toRow(open[i], SECTION_OPEN, color))
    for (var j = 0; j < recent.length; j++) rows.push(toRow(recent[j], recentSection, color))
    return rows
  }
  var results = resp.results || []
  for (var k = 0; k < results.length; k++) rows.push(toRow(results[k], "", color))
  return rows
}

// Right-hand header text: counts for the current view.
function countText(resp, total) {
  if (!resp) return ""
  if (!String(resp.query || "").trim()) {
    var n = (resp.open || []).length
    var base = n === 1 ? "1 open" : n + " open"
    return total ? base + " · " + thousands(total) + " items" : base
  }
  if (!resp.total) return "no matches"
  var shown = (resp.results || []).length
  return resp.total > shown ? shown + " of " + thousands(resp.total) : thousands(resp.total) + (resp.total === 1 ? " match" : " matches")
}

// Row index to select after a rebuild: the same item if it is still listed
// and the user moved the cursor, else the top row.
function selectionAfter(rows, previousKey, followTop) {
  if (!rows.length) return 0
  if (followTop || !previousKey) return 0
  for (var i = 0; i < rows.length; i++) if (rows[i].key === previousKey) return i
  return 0
}

// ---------------------------------------------------------------- actions (Tab)

var READER_TYPES = ["pdf", "epub", "snapshot"]

// What Enter does for this item, from the bridge's plan.
var OPEN_DETAIL = {
  "switch-tab": "Switch to its open tab",
  "focus-window": "Focus its open window",
  "open-reader": "Open it in Zotero's reader",
  "open-note": "Open the note in Zotero",
  "select": "Nothing to open: select it in the library"
}

function fileKind(att) {
  if (!att) return "file"
  if (att.contentType === "application/pdf") return "PDF"
  if (att.readerType === "epub") return "EPUB"
  if (att.readerType === "snapshot") return "snapshot"
  return "file"
}

function fileIcon(att) {
  var kind = fileKind(att)
  if (kind === "PDF") return ""
  if (kind === "EPUB") return ""
  if (kind === "snapshot") return ""
  return ""
}

// Files an action can use: "external" → any existing file, "window" → existing
// files Zotero's reader can show. Keeps the bridge's order (best first).
function usableFiles(details, purpose) {
  var files = (details && details.attachments) || []
  return files.filter(function (a) {
    return a.exists && (purpose !== "window" || READER_TYPES.indexOf(a.readerType) >= 0)
  })
}

// One row of the actions / files / notes / tags lists. Every row carries every
// role (a ListModel takes its roles from the first row it gets).
function listRow(f) {
  var label = String(f.label == null ? "" : f.label)
  return {
    rowId: String(f.rowId || ""),
    icon: String(f.icon || ""),
    label: label,
    labelHtml: f.labelHtml != null ? String(f.labelHtml) : escapeHtml(label),
    detail: String(f.detail || ""),
    available: !!f.available, // not "enabled": that is a built-in Item property in the QML delegate
    submenu: !!f.submenu,
    showCheck: !!f.showCheck,
    checked: !!f.checked,
    swatch: String(f.swatch || ""),
    badge: String(f.badge || ""),
    trailing: String(f.trailing || ""),
    attKey: f.att ? String(f.att.key) : "",
    attLibraryID: f.att ? Number(f.att.libraryID) || 1 : 1,
    attContentType: f.att ? String(f.att.contentType || "") : "",
    noteKey: f.note ? String(f.note.key) : "",
    noteLibraryID: f.note ? Number(f.note.libraryID) || 1 : 1,
    tag: String(f.tag || ""),
    promptId: String(f.promptId || ""),
    value: String(f.value == null ? "" : f.value)
  }
}

function actionRow(id, icon, label, detail, enabled, submenu, att) {
  return listRow({ rowId: id, icon: icon, label: label, detail: detail, available: enabled, submenu: submenu, att: att })
}

// Why a file action is unavailable.
function noFileReason(details, purpose) {
  var files = (details && details.attachments) || []
  if (!files.length) return "No file attached"
  if (!files.some(function (a) { return a.exists })) return files.length === 1 ? "The file is missing" : "The files are missing"
  return purpose === "window" ? "Zotero's reader can't open this file type" : ""
}

// The actions view. `details` is the bridge's /item response, or null while loading.
// `prompts`: Service.prompts ([{ id, title, model }] or null), `promptsProblem` why it is null.
// `pinned`: whether the item is pinned to the top of the list.
function buildActions(details, viewerName, prompts, promptsProblem, pinned) {
  var loading = !details
  var rows = []

  // Notes first: the Notes row, then the item's notes one per row.
  var itemType = details && details.item ? details.item.itemType : ""
  if (itemType === "note") {
    var self = ((details && details.notes) || [])[0]
    rows.push(listRow({ rowId: "read", icon: NOTE_ICON, label: "Read note", detail: self ? self.excerpt || "Empty note" : "", available: !!self, submenu: true, note: self }))
  } else if (itemType !== "attachment") {
    var notes = (details && details.notes) || []
    var notesDetail = loading ? "…" : !notes.length ? "No notes"
      : notes.length === 1 ? "1 note" : notes.length + " notes"
    rows.push(listRow({ rowId: "notes", icon: NOTE_ICON, label: "Notes", detail: notesDetail, available: notes.length > 0, submenu: notes.length > 0 }))
    notes.forEach(function (n) {
      var detail = [shortDate(n.dateModified), n.excerpt].filter(function (x) { return x }).join(" · ")
      rows.push(listRow({ rowId: "note", label: n.title || "Untitled note", detail: detail, available: true, submenu: true, note: n }))
    })
    rows.push(promptsRow(prompts, promptsProblem))
  }

  rows.push(pinRow(pinned))
  rows.push(actionRow("open", "", "Open in Zotero", loading ? "…" : (OPEN_DETAIL[details.openAction] || ""), true, false, null))

  var ext = usableFiles(details, "external")
  var extKind = fileKind(ext[0] || ((details && details.attachments) || [])[0])
  var extDetail = loading ? "…" : ext.length > 1 ? ext.length + " files: choose one…"
    : ext.length === 1 ? (extKind === "PDF" && viewerName ? viewerName + " · " : "") + (ext[0].filename || ext[0].title)
    : noFileReason(details, "external")
  rows.push(actionRow("external", "", "Open " + extKind + " externally", extDetail, ext.length > 0, ext.length > 1, ext.length === 1 ? ext[0] : null))

  var win = usableFiles(details, "window")
  var winKind = fileKind(win[0] || ext[0])
  var winDetail = loading ? "…" : win.length > 1 ? win.length + " files: choose one…"
    : win.length === 1 ? (win[0].filename || win[0].title)
    : noFileReason(details, "window")
  rows.push(actionRow("window", "", "Open " + winKind + " in a new Zotero window", winDetail, win.length > 0, win.length > 1, win.length === 1 ? win[0] : null))

  rows.push(listRow({ rowId: "tags", icon: TAG_ICON, label: "Tags", detail: loading ? "…" : tagSummary(details), available: !loading, submenu: true }))

  rows.push(actionRow("reveal", "", "Show in library", "Select it in Zotero's library", true, false, null))
  return rows
}

// ---------------------------------------------------------------- pins

var PIN_ICON = "\uf08d"

function pinRow(pinned) {
  return listRow({ rowId: "pin", icon: PIN_ICON, label: pinned ? "Unpin" : "Pin to the top",
    detail: pinned ? "Take it out of the Pinned section" : "Show it first, in the Pinned section before you type", available: true })
}

// The pins file (~/.config/omarchy/oma-zotero-launcher/pins.json) → [{ key, libraryID, title }].
function parsePins(text) {
  var j
  try {
    j = JSON.parse(String(text || ""))
  } catch (e) {
    return []
  }
  var list = j && Array.isArray(j.pins) ? j.pins : []
  return list.filter(function (p) { return p && /^[A-Z0-9]{8}$/.test(String(p.key)) }).map(function (p) {
    return { key: String(p.key), libraryID: Number(p.libraryID) || 1, title: String(p.title || "") }
  })
}

function isPinned(pins, item) {
  return !!item && (pins || []).some(function (p) { return p.key === item.key && p.libraryID === (Number(item.libraryID) || 1) })
}

// Pin (to the end of the pinned list) or unpin; returns the new list.
function togglePin(pins, item) {
  var lib = Number(item.libraryID) || 1
  if (isPinned(pins, item)) return pins.filter(function (p) { return !(p.key === item.key && p.libraryID === lib) })
  return pins.concat([{ key: String(item.key), libraryID: lib, title: String(item.title || "") }])
}

// ---------------------------------------------------------------- prompts

var PROMPT_ICON = "\uf0d0"
var EDIT_ICON = "\uf044"
var MODEL_ICON = "\uf2db"
var EFFORT_ICON = "\uf0e4"
var TEXT_ICON = "\uf15c"

// The actions' Prompts row, under the notes: opens the prompts list.
function promptsRow(prompts, problem) {
  if (!prompts) {
    return listRow({ rowId: "prompts", icon: PROMPT_ICON, label: "Prompts", detail: problem || "…", available: false })
  }
  var n = prompts.length
  var detail = n ? n + (n === 1 ? " prompt" : " prompts") + " · Claude writes a new note" : "No prompts yet: create one"
  return listRow({ rowId: "prompts", icon: PROMPT_ICON, label: "Prompts", detail: detail, available: true, submenu: true })
}

// A model's name from the SDK's list ("opus[1m]" → "Opus (1M context)"), else the value itself.
function findModel(models, value) {
  for (var i = 0; i < (models || []).length; i++) if (models[i].value === value) return models[i]
  return null
}

function modelLabel(models, value) {
  var m = findModel(models, value)
  return m ? m.displayName : String(value || "")
}

function effortLabel(effort) {
  return effort ? effort : "model default"
}

// The effort to keep when the model changes: the same level if the new model takes it,
// else "high" (or its highest level), or "" for a model without effort levels.
function effortFor(models, model, effort) {
  var m = findModel(models, model)
  if (!m) return effort
  var levels = m.efforts || []
  if (!levels.length) return ""
  if (levels.indexOf(effort) >= 0) return effort
  return levels.indexOf("high") >= 0 ? "high" : levels[levels.length - 1]
}

// The prompts submenu: each prompt (Enter runs it, Alt+E edits it), then "New prompt…".
function buildPromptRows(prompts, models, query, color, rank) {
  var ranked = rank(prompts || [], query, [
    { get: function (p) { return p.title } },
    { get: function (p) { return p.excerpt || "" }, weight: 0.3 }
  ])
  var rows = ranked.map(function (r) {
    var p = r.item
    var detail = [modelLabel(models, p.model), effortLabel(p.effort), p.excerpt].filter(function (x) { return x }).join(" · ")
    return listRow({ rowId: "prompt", icon: PROMPT_ICON, label: p.title, labelHtml: highlight(p.title, rangesFrom(r.positions), color), detail: detail, available: true, promptId: p.id })
  })
  rows.push(listRow({ rowId: "prompt-new", icon: CREATE_ICON, label: "New prompt…", detail: "Name it, pick a model and effort, then write it", available: true, submenu: true }))
  return rows
}

// The prompt editor. `open` is the dropdown showing its options ("model", "effort" or "");
// `models` is the SDK's list (null while loading).
function buildPromptEditor(prompt, models, open) {
  if (!prompt) return []
  var rows = []
  var m = findModel(models, prompt.model)
  rows.push(listRow({ rowId: "pe-title", icon: EDIT_ICON, label: "Title", detail: prompt.title, available: true, submenu: true }))
  rows.push(listRow({ rowId: "pe-model", icon: MODEL_ICON, label: "Model", detail: m ? m.displayName + (m.description ? " · " + m.description : "") : prompt.model + (models ? " (not in Claude's list)" : ""),
    available: true, trailing: open === "model" ? "▴" : "▾" }))
  if (open === "model") {
    var list = (models || []).slice()
    if (!m) list.unshift({ value: prompt.model, displayName: prompt.model, description: models ? "not in Claude's list" : "loading Claude's models…", efforts: [] })
    list.forEach(function (o) {
      rows.push(listRow({ rowId: "pe-model-opt", label: o.displayName, detail: o.description + (o.efforts && o.efforts.length ? "" : " · no effort levels"),
        available: true, showCheck: true, checked: o.value === prompt.model, value: o.value, trailing: o.value }))
    })
  }
  var levels = m ? m.efforts || [] : []
  var noEffort = m && !levels.length
  rows.push(listRow({ rowId: "pe-effort", icon: EFFORT_ICON, label: "Effort", detail: noEffort ? m.displayName + " takes no effort level" : effortLabel(prompt.effort),
    available: !noEffort, trailing: noEffort ? "" : open === "effort" ? "▴" : "▾" }))
  if (open === "effort" && !noEffort) {
    var opts = levels.length ? levels : ["low", "medium", "high", "xhigh", "max"]
    opts.forEach(function (e) {
      rows.push(listRow({ rowId: "pe-effort-opt", label: e, detail: EFFORT_HELP[e] || "", available: true, showCheck: true, checked: e === prompt.effort, value: e }))
    })
  }
  rows.push(listRow({ rowId: "pe-text", icon: TEXT_ICON, label: "Prompt text", detail: prompt.excerpt || "Empty: write it", available: true, submenu: true, trailing: "editor" }))
  return rows
}

var EFFORT_HELP = {
  low: "fastest, least thinking",
  medium: "",
  high: "thorough (recommended for these notes)",
  xhigh: "more thinking, slower",
  max: "most thinking, slowest and most usage"
}

// Naming a new prompt ("create") or renaming one: the header holds the title.
function buildTitleRows(text, mode) {
  var t = String(text || "").trim()
  var create = mode === "create"
  var label = !t ? (create ? "Type the new prompt's name" : "Type the new title") : create ? "Create “" + t + "”" : "Rename to “" + t + "”"
  return [listRow({ rowId: "pe-title-save", icon: create ? CREATE_ICON : EDIT_ICON, label: label, available: !!t, value: t })]
}

// ---------------------------------------------------------------- notes

var NOTE_ICON = "\uf249"
var TAG_ICON = "\uf02b"
var CREATE_ICON = "\uf067"

// "2025-05-13 19:42:18" (Zotero's UTC SQL date) → "2025-05-13".
function shortDate(sqlDate) {
  var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(sqlDate || ""))
  return m ? m[1] : ""
}

// Match positions → [start, end) ranges for highlight().
function rangesFrom(positions) {
  var out = []
  for (var i = 0; i < (positions || []).length; i++) {
    var last = out[out.length - 1]
    if (last && last[1] === positions[i]) last[1]++
    else out.push([positions[i], positions[i] + 1])
  }
  return out
}

// The notes list. `rank` is Fuzzy.filter (passed in: QML imports it separately).
function buildNoteRows(details, query, color, rank) {
  var notes = (details && details.notes) || []
  var ranked = rank(notes, query, [
    { get: function (n) { return n.title || "Untitled note" } },
    { get: function (n) { return n.excerpt || "" }, weight: 0.5 }
  ])
  return ranked.map(function (r) {
    var n = r.item
    var title = n.title || "Untitled note"
    var detail = [shortDate(n.dateModified), n.excerpt].filter(function (x) { return x }).join(" · ")
    return listRow({ rowId: "note", icon: NOTE_ICON, label: title, labelHtml: highlight(title, rangesFrom(r.positions), color), detail: detail, available: true, submenu: true, note: n })
  })
}

// ---------------------------------------------------------------- tags

// "notion, resilience +2" for the actions' Tags row.
function tagSummary(details) {
  var tags = (details && details.tags) || []
  var readOnly = !!(details && details.library && details.library.editable === false)
  var text = !tags.length ? (readOnly ? "No tags" : "No tags yet: add some")
    : tags.slice(0, 3).map(function (t) { return t.tag }).join(", ") + (tags.length > 3 ? " +" + (tags.length - 3) : "")
  return readOnly ? text + " · read-only library" : text
}

// { name: type } for the item's tags (type 0 manual, 1 automatic).
function tagMap(tags) {
  var map = {}
  for (var i = 0; i < (tags || []).length; i++) map[tags[i].tag] = Number(tags[i].type) || 0
  return map
}

function hasTagCI(tags, name) {
  var n = String(name).toLowerCase()
  for (var i = 0; i < tags.length; i++) if (String(tags[i].tag).toLowerCase() === n) return true
  return false
}

// The tag editor. state: { tags: library tags (from /tags/list), itemTags: tagMap(),
// initial: names on the item when the view opened, editable }. Without a query: the
// initial tags first (they stay put when unchecked, so a slip is easy to undo), then
// tags added since, then the rest of the library. With a query: fuzzy-ranked (via
// `rank` = Fuzzy.filter), plus a "Create tag" row when no tag has exactly that name
// (ignoring case).
function buildTagRows(state, query, color, rank, limit) {
  limit = limit || 300
  var lib = (state && state.tags) || []
  var on = (state && state.itemTags) || {}
  var editable = !(state && state.editable === false)
  var all = lib.slice()
  var known = {}
  for (var i = 0; i < lib.length; i++) known[lib[i].tag] = true
  for (var name in on) if (!known[name]) all.push({ tag: name, types: [on[name]], count: 0, color: null, position: null })

  var q = String(query || "").trim()
  var ordered
  if (!q) {
    var initial = (state && state.initial) || []
    var first = []
    for (var j = 0; j < initial.length; j++) {
      for (var k = 0; k < all.length; k++) if (all[k].tag === initial[j]) first.push(all[k])
    }
    var added = all.filter(function (t) { return on[t.tag] !== undefined && initial.indexOf(t.tag) < 0 })
    var rest = all.filter(function (t) { return on[t.tag] === undefined && initial.indexOf(t.tag) < 0 })
    ordered = first.concat(added, rest).map(function (t) { return { item: t, positions: [] } })
  } else {
    ordered = rank(all, q, [{ get: function (t) { return t.tag } }])
  }
  var rows = ordered.slice(0, limit).map(function (r) {
    var t = r.item
    var type = on[t.tag]
    var checked = type !== undefined
    var auto = checked ? type === 1 : !!(t.types && t.types.length && t.types.every(function (x) { return x === 1 }))
    return listRow({
      rowId: "tag", tag: t.tag, label: t.tag, labelHtml: highlight(t.tag, rangesFrom(r.positions), color),
      showCheck: true, checked: checked, swatch: t.color || "", badge: auto ? "auto" : "",
      trailing: t.count ? thousands(t.count) : "", available: editable
    })
  })
  if (q && !hasTagCI(all, q)) {
    rows.push(listRow({ rowId: "create", tag: q, icon: CREATE_ICON, label: "Create tag “" + q + "”", detail: editable ? "Ctrl+Enter adds it from anywhere in the list" : "", available: editable }))
  }
  return rows
}

// Header count for the tag editor: "129 tags · 2 on this item".
function tagCountText(state) {
  var n = ((state && state.tags) || []).length
  var on = Object.keys((state && state.itemTags) || {}).length
  return thousands(n) + (n === 1 ? " tag" : " tags") + " · " + on + " on this item"
}

// The file picker for "external" or "window" (items with several files).
function buildFileRows(details, purpose) {
  var files = (details && details.attachments) || []
  return files.map(function (a) {
    var usable = a.exists && (purpose !== "window" || READER_TYPES.indexOf(a.readerType) >= 0)
    var why = !a.exists ? "missing" : usable ? "" : "Zotero can't open this type"
    var parts = [fileKind(a)]
    if (a.filename && a.filename !== a.title) parts.push(a.filename)
    if (why) parts.push(why)
    return actionRow("pick", fileIcon(a), a.title, parts.join(" · "), usable, false, a)
  })
}

// Type-to-filter for the (short) action and file lists: case-insensitive
// subsequence match on the label. Labels with a word starting with the query
// come first ("win" → "…new Zotero window" before "Show in library"); order is
// otherwise kept.
function filterRows(rows, query) {
  var q = String(query || "").toLowerCase().replace(/\s+/g, "")
  if (!q) return rows.slice()
  var scored = []
  for (var n = 0; n < rows.length; n++) {
    var label = String(rows[n].label).toLowerCase()
    var i = 0
    for (var c = 0; c < label.length && i < q.length; c++) if (label[c] === q[i]) i++
    if (i < q.length) continue
    var wordStart = label.split(/[^a-z0-9]+/).some(function (w) { return w.indexOf(q) === 0 })
    scored.push({ row: rows[n], score: wordStart ? 1 : 0, index: n })
  }
  scored.sort(function (a, b) { return b.score - a.score || a.index - b.index })
  return scored.map(function (s) { return s.row })
}

if (typeof module !== "undefined") {
  module.exports = {
    ICONS: ICONS, iconFor: iconFor, escapeHtml: escapeHtml, highlight: highlight, subtitle: subtitle, openState: openState,
    thousands: thousands, toRow: toRow, buildRows: buildRows, countText: countText, selectionAfter: selectionAfter,
    SECTION_PINNED: SECTION_PINNED, SECTION_OPEN: SECTION_OPEN, SECTION_RECENT: SECTION_RECENT, SECTION_RECENT_MODIFIED: SECTION_RECENT_MODIFIED, tagsText: tagsText,
    fileKind: fileKind, usableFiles: usableFiles, buildActions: buildActions, buildFileRows: buildFileRows, filterRows: filterRows,
    listRow: listRow, pinRow: pinRow, parsePins: parsePins, isPinned: isPinned, togglePin: togglePin, promptsRow: promptsRow, buildPromptRows: buildPromptRows, buildPromptEditor: buildPromptEditor, buildTitleRows: buildTitleRows,
    effortFor: effortFor, modelLabel: modelLabel, shortDate: shortDate, rangesFrom: rangesFrom, buildNoteRows: buildNoteRows,
    tagSummary: tagSummary, tagMap: tagMap, buildTagRows: buildTagRows, tagCountText: tagCountText
  }
}
