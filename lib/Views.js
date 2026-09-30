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
  if (r.kind === "collection") return collectionRow(r, section, color)
  if (r.kind === "tag") return tagRow(r, section, color)
  var title = r.title || "(untitled)"
  return {
    section: section,
    kind: "item",
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
    tagsText: tagsText(r.tags, r.tagCount),
    ranks: rankLabels(r.rank).join("|"),
    status: statusFromTags(r, BUILD_STATUSES) // "\u0000": unknown (an older Zotero plugin, and not among its first tags)
  }
}

var COLLECTION_ICON = "\uf07b"

// A collection row: its full path as the title ("Parent / Child"), same roles as items.
function collectionRow(r, section, color) {
  var title = r.title || r.name || "(collection)"
  var lib = r.library && r.library !== "My Library" ? " · " + r.library : ""
  return {
    section: section,
    kind: "collection",
    key: String(r.key || ""),
    libraryID: Number(r.libraryID) || 1,
    itemType: "collection",
    icon: COLLECTION_ICON,
    title: title,
    titleHtml: highlight(title, r.titleRanges, color),
    subtitle: "Collection" + lib + " · Enter: its papers",
    openState: "",
    pdfCount: 0,
    noteCount: 0,
    tagsText: "",
    ranks: "",
    status: ""
  }
}

// A result's status when the bridge doesn't say (an older Zotero plugin): one of its first tags,
// if one is a status; else unknown.
function statusFromTags(r, statuses) {
  if (r.status != null) return String(r.status)
  var tags = (r.tags || []).map(function (t) { return String(t).toLowerCase() })
  for (var i = 0; i < (statuses || []).length; i++) {
    var k = tags.indexOf(statuses[i].toLowerCase())
    if (k >= 0) return r.tags[k]
  }
  return "\u0000"
}

// A tag row: the tag, how many papers carry it; Enter lists them.
function tagRow(r, section, color) {
  var title = String(r.title || r.name || "")
  var n = Number(r.count) || 0
  var lib = r.library && r.library !== "My Library" ? " · " + r.library : ""
  return {
    section: section,
    kind: "tag",
    key: title,
    libraryID: Number(r.libraryID) || 1,
    itemType: "tag",
    icon: TAG_ICON,
    title: title,
    titleHtml: highlight(title, r.titleRanges, color),
    subtitle: "Tag · " + thousands(n) + (n === 1 ? " paper" : " papers") + lib + " · Enter: its papers",
    openState: "",
    pdfCount: 0,
    noteCount: 0,
    tagsText: "",
    ranks: "",
    status: ""
  }
}

// A journal's rankings (the bridge's rank: { ajg, abdc, field, ft50, utd24 }) →
// ["ABS 4*", "ABDC A*", "FT50", "UTD24"].
function rankLabels(rank) {
  if (!rank) return []
  return [rank.ajg ? "ABS " + rank.ajg : "", rank.abdc ? "ABDC " + rank.abdc : "", rank.ft50 ? "FT50" : "", rank.utd24 ? "UTD24" : ""]
    .filter(function (x) { return x })
}

// A ranking as a compact pill on a result: the list's first letter and the grade ("ABS 4*" → "A 4*",
// "ABDC A" → "D A", FT50 → "F", UTD24 → "U"); the note window keeps the full names.
function rankShort(label) {
  var l = String(label || "")
  if (l === "FT50") return "F"
  if (l === "UTD24") return "U"
  var m = /^(ABS|ABDC) (.+)$/.exec(l)
  return m ? (m[1] === "ABS" ? "A " : "D ") + m[2] : l
}

// The top labels (ABS 4* / 4, ABDC A* / A, FT50, UTD24) get the accent color; the rest stay quiet.
function rankIsTop(label) {
  return ["FT50", "UTD24", "ABS 4*", "ABS 4", "ABDC A*", "ABDC A"].indexOf(label) >= 0
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
var SECTION_COLLECTIONS = "Collections"
var SECTION_TAGS = "Tags"
var SECTION_PAPERS = "Papers"
var SECTION_OPEN = "Open in Zotero"
var SECTION_RECENT = "Recently added"
var SECTION_RECENT_MODIFIED = "Recently modified"
var SECTION_RECENT_LATEST = "Recent" // the newer of added and modified, per item

// Search response → rows. Empty query: pinned items, open items, then recently added
// (or modified, per the emptyQuery setting). Otherwise: ranked results (no section header).
var BUILD_STATUSES = [] // the statuses buildRows reads a result's status against (extras.statuses)

function buildRows(resp, color, extras) {
  BUILD_STATUSES = (extras && extras.statuses) || []
  var rows = []
  if (!resp) return rows
  if (!resp.scope && !String(resp.query || "").trim()) {
    // Before you type: your papers only. Chats, Tasks and Settings are keys (c, t, ;), the task
    // queue is in the footer, and typing finds them under Go to.
    var open = resp.open || []
    var recent = resp.recent || []
    var recentSection = resp.recentBy === "modified" ? SECTION_RECENT_MODIFIED : resp.recentBy === "added" ? SECTION_RECENT : SECTION_RECENT_LATEST
    var pinned = resp.pinned || []
    for (var p = 0; p < pinned.length; p++) rows.push(toRow(pinned[p], SECTION_PINNED, color))
    for (var i = 0; i < open.length; i++) rows.push(toRow(open[i], SECTION_OPEN, color))
    for (var j = 0; j < recent.length; j++) rows.push(toRow(recent[j], recentSection, color))
    return rows
  }
  // Typed (or inside a collection or a tag): the launcher's own places that match (Go to) on top,
  // then matching collections, then matching tags, then the papers. The papers get their own
  // heading only when something is listed above them; the cursor starts on the first of them
  // (selectionAfter), on a place only when nothing else matches.
  var cols = resp.collections || []
  var tags = resp.tags || []
  var results = resp.results || []
  // (a pinned search's badge is still the top level: its places are found too; not while picking a paper)
  var cmds = (!resp.scope || resp.scope.kind === "search") && extras && !extras.noCommands ? commandRows(resp.query, extras) : []
  for (var m = 0; m < cmds.length; m++) rows.push(cmds[m])
  var papers = cols.length || tags.length || cmds.length || resp.scope ? SECTION_PAPERS : ""
  for (var c = 0; c < cols.length; c++) rows.push(toRow(cols[c], resp.scope ? "Subcollections" : SECTION_COLLECTIONS, color))
  for (var g = 0; g < tags.length; g++) rows.push(toRow(tags[g], SECTION_TAGS, color))
  for (var k = 0; k < results.length; k++) rows.push(toRow(results[k], papers, color))
  return rows
}

var SECTION_COMMANDS = "Go to"

// The launcher's own places, found by what you type: [kind, label, words, what it is, key].
var COMMANDS = [
  ["chats", "Chats", "chats chat conversations talk ask", "Your chats with papers", "c"],
  ["chat-new", "New chat…", "new chat ask talk paper", "Pick a paper to chat about", ""],
  ["todos", "Tasks", "tasks todo todos to do reading list", "Your tasks, by status", "t"],
  ["todo-new", "New task…", "new task todo add", "About a paper or not", "a"],
  ["tasks", "Processes", "processes queue running jobs runs extractions prompts", "Prompt runs and text extractions", "."],
  ["searches", "Searches", "searches saved search filters queries pinned badges", "Your saved searches: open, pin, rename, delete", "f"],
  ["settings", "Settings", "settings preferences options configuration setup", "Models & providers, defaults, general", ";"],
  ["settings-providers", "Models & providers", "models providers ai claude chatgpt openai anthropic gemini google openrouter ollama api key keys setup", "Settings › Models & providers", ""],
  ["settings-defaults", "Default models", "defaults default model effort fallback", "Settings › Defaults", ""],
  ["settings-rules", "Rules for prompts and chat", "rules system prompt instructions citations apa references quotes grounding rigor", "Settings › Rules", ""],
  ["settings-general", "General settings", "general keys delay results port pdf app", "Settings › General", ""]
]

// `extras.keys`: "single" or "alt", for the key shown with each.
function commandRows(query, extras) {
  var words = String(query || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(function (w) { return w })
  if (!words.length) return []
  var rows = []
  COMMANDS.forEach(function (c) {
    var hay = (c[1] + " " + c[2]).toLowerCase().split(/[^a-z0-9]+/)
    if (!words.every(function (w) { return hay.some(function (h) { return h.indexOf(w) === 0 }) })) return
    var key = c[4] ? " · " + (extras && extras.keys === "alt" ? "alt+" : "") + c[4] : ""
    var icon = c[0] === "tasks" ? TASK_ICONS.done : c[0] === "searches" ? SEARCH_ICON : c[0].indexOf("todo") === 0 ? "\uf0ae" : c[0].indexOf("chat") === 0 ? CHAT_ICON : SETTINGS_ICON
    var r = workspaceRow(c[0], icon, c[1], c[3] + key)
    r.section = SECTION_COMMANDS
    rows.push(r)
  })
  return rows
}

// Right-hand header text: counts for the current view.
function countText(resp, total) {
  if (!resp) return ""
  if (resp.scope) {
    var t = Number(resp.total) || 0
    var q = String(resp.query || "").trim()
    return q ? (t ? thousands(t) + (t === 1 ? " match" : " matches") : "no matches") : thousands(t) + (t === 1 ? " paper" : " papers")
  }
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
  var first = firstItemRow(rows)
  if (followTop || !previousKey) return first
  for (var i = 0; i < rows.length; i++) if (rows[i].key === previousKey) return i
  return first
}

// The first row that isn't the Tasks, Chats or Settings entry (the cursor starts on your papers).
function firstItemRow(rows) {
  for (var i = 0; i < rows.length; i++) if (rows[i].section !== SECTION_WORKSPACE && rows[i].section !== SECTION_COMMANDS) return i
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
    section: String(f.section || ""), // the heading it sits under (the paper's menu)
    promptId: String(f.promptId || ""),
    value: String(f.value == null ? "" : f.value),
    itemKey: String(f.itemKey || ""), // the paper a task or a chat is about
    itemLibraryID: Number(f.itemLibraryID) || 1,
    itemTitle: String(f.itemTitle || "")
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
// `extra`: { chats (this paper's, newest first), noteOrder (note keys, your order), extracting (a
// running extraction of its text) }.
function buildActions(details, viewerName, prompts, promptsProblem, pinned, setup, extra) {
  extra = extra || {}
  var loading = !details
  var rows = []

  // Sections, like the results: Notes (the notes themselves), Prompts and chat, then the
  // paper (or file, or note) itself.
  var itemType = details && details.item ? details.item.itemType : ""
  if (itemType === "note") {
    var self = ((details && details.notes) || [])[0]
    rows.push(listRow({ rowId: "read", icon: NOTE_ICON, label: "Read note", detail: self ? self.excerpt || "Empty note" : "", available: !!self, submenu: true, note: self }))
  } else if (itemType !== "attachment") {
    var notes = orderNotes((details && details.notes) || [], extra.noteOrder)
    if (!notes.length) {
      rows.push(listRow({ rowId: "notes-empty", icon: NOTE_ICON, label: loading ? "…" : "No notes yet", detail: loading ? "" : "Prompts and chats can write some", available: false }))
    }
    notes.forEach(function (n) {
      var detail = [shortDate(n.dateModified), n.excerpt].filter(function (x) { return x }).join(" · ")
      rows.push(listRow({ rowId: "note", icon: n.fulltext ? EXTRACT_ICON : NOTE_ICON, label: n.title || "Untitled note", detail: detail, available: true, submenu: true, note: n }))
    })
    rows.forEach(function (r) { r.section = SECTION_NOTES })
    // Its chats, newest first: Enter continues one, Shift+Enter renames or deletes it.
    ;(extra.chats || []).forEach(function (c) {
      rows.push(listRow({ section: SECTION_CHATS, rowId: "chat-session", icon: CHAT_ICON, label: c.title || "Chat", available: true, submenu: true, value: c.id,
        detail: [String(c.updated || "").slice(0, 10), c.turns + (c.turns === 1 ? " question" : " questions"), c.model || ""].filter(function (x) { return x }).join(" · ") }))
    })
    // No AI model yet: one row that leads to Settings, in place of Prompts and Chat.
    var ai = setup ? [setupRow(prompts, promptsProblem), extractRow(details, loading, !prompts)]
      : [promptsRow(prompts, promptsProblem), chatRow(details, prompts, promptsProblem), extractRow(details, loading, !prompts, extra.extracting)]
    ai.forEach(function (r) { r.section = SECTION_AI; rows.push(r) })
  }
  var start = itemType === "note" ? 0 : rows.length

  // Its status (a tag from Settings › Paper status): Tab / Shift+Tab (or Enter) moves it along.
  if (extra.paperStatus !== undefined && itemType !== "note" && itemType !== "attachment") {
    rows.push(listRow({ rowId: "paper-status", icon: TAG_ICON, label: extra.paperStatus ? "Status: " + extra.paperStatus : "No status",
      detail: "Tab / Shift+Tab (or Enter) changes it: " + ["none"].concat(extra.statusTags || []).join(" → "), available: !loading, badge: extra.paperStatus || "" }))
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
  var own = itemType === "note" ? "This note" : itemType === "attachment" ? "This file" : "This paper"
  for (var i = start; i < rows.length; i++) rows[i].section = own
  return rows
}

var SECTION_NOTES = "Notes"
var SECTION_CHATS = "Chats"

// Rows in your order of their sections (Ctrl+Shift+↑/↓): the sections you placed, in that order,
// then any others where they were. A section is the run of rows with the same heading.
function sectionGroups(rows) {
  var groups = []
  rows.forEach(function (r) {
    var last = groups[groups.length - 1]
    if (last && last.name === r.section) last.rows.push(r)
    else groups.push({ name: r.section, rows: [r] })
  })
  return groups
}

function orderSections(rows, order) {
  if (!order || !order.length) return rows
  var pos = {}
  order.forEach(function (n, i) { pos[n] = i })
  var groups = sectionGroups(rows).map(function (g, i) { return { g: g, i: i } })
  var placed = groups.filter(function (e) { return pos[e.g.name] !== undefined }).sort(function (a, b) { return pos[a.g.name] - pos[b.g.name] })
  // The placed ones take, in their order, the slots placed sections held; the others stay put.
  var slots = groups.filter(function (e) { return pos[e.g.name] !== undefined }).map(function (e) { return e.i })
  var out = groups.slice()
  slots.forEach(function (slot, k) { out[slot] = placed[k] })
  return [].concat.apply([], out.map(function (e) { return e.g.rows }))
}

// The section order after moving `name` one place up (-1) or down (+1) among `rows`' sections.
// → the new list of names, or null when it can't move.
function moveSection(rows, name, delta) {
  var names = sectionGroups(rows).map(function (g) { return g.name })
  var i = names.indexOf(name)
  var j = i + delta
  if (i < 0 || j < 0 || j >= names.length) return null
  var t = names[i]
  names[i] = names[j]
  names[j] = t
  return names
}

// Notes in your order (Shift+↑/↓ in the paper's menu): the ones you placed first, in that order,
// then the others as Zotero gives them (newest first).
function orderNotes(notes, order) {
  var pos = {}
  ;(order || []).forEach(function (k, i) { pos[k] = i })
  return notes.map(function (n, i) { return { n: n, i: i } }).sort(function (a, b) {
    var x = pos[a.n.key], y = pos[b.n.key]
    if (x !== undefined && y !== undefined) return x - y
    if (x !== undefined) return -1
    if (y !== undefined) return 1
    return a.i - b.i
  }).map(function (e) { return e.n })
}
var SECTION_AI = "Prompts and chat"

// ---------------------------------------------------------------- tasks and chats

var SECTION_WORKSPACE = "Processes and chats"
var TASK_ICONS = { running: "\uf110", done: "\uf00c", error: "\uf071" }
var TASK_SECTIONS = { running: "Running", done: "Finished", error: "Failed" }

// The queue at a glance: { running, done, error, text } ("1 running · 2 finished · 1 failed").
function taskSummary(tasks) {
  var n = { running: 0, done: 0, error: 0 }
  ;(tasks || []).forEach(function (t) { if (n[t.status] !== undefined) n[t.status]++ })
  var parts = []
  if (n.running) parts.push(n.running + " running")
  if (n.done) parts.push(n.done + " finished")
  if (n.error) parts.push(n.error + " failed")
  n.text = parts.join(" · ")
  return n
}

// The rows a result-list row needs, for the Tasks and Chats entries.
function workspaceRow(kind, icon, title, subtitle) {
  return { section: SECTION_WORKSPACE, kind: kind, key: kind, libraryID: 0, itemType: kind, icon: icon, title: title, titleHtml: escapeHtml(title),
    subtitle: subtitle, openState: "", pdfCount: 0, noteCount: 0, tagsText: "", ranks: "", status: "" }
}

var SETTINGS_ICON = "\uf013"

// `extras`: { tasks, chats (the count, or -1 when the runner is missing), setup (no AI model yet) }.
function workspaceRows(extras) {
  if (!extras) return []
  var rows = []
  var sum = taskSummary(extras.tasks)
  var key = function (l) { return " · " + (extras.keys === "alt" ? "alt+" : "") + l }
  if ((extras.tasks || []).length) rows.push(workspaceRow("tasks", sum.running ? TASK_ICONS.running : TASK_ICONS.done, "Processes", sum.text + key(".")))
  if (extras.chats >= 0) rows.push(workspaceRow("chats", CHAT_ICON, "Chats", (extras.chats ? extras.chats + (extras.chats === 1 ? " chat" : " chats") + " · open one or start one" : "Start a chat with a paper") + key("c")))
  rows.push(workspaceRow("settings", SETTINGS_ICON, "Settings", (extras.setup ? "Set up an AI model for prompts and chat" : "Models & providers, defaults, general") + key(";")))
  return rows
}

// "3 min ago" for a task's detail.
function ago(iso, now) {
  var t = Date.parse(iso || "")
  if (!t) return ""
  var s = Math.max(0, Math.round(((now || Date.now()) - t) / 1000))
  return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " d ago"
}

// What a prompt run used: "openai:gpt-5.5 · 41k tokens · $0.08 · 1 quote not found · "
function runFacts(t) {
  var bits = []
  if (t.model) bits.push(t.model + (t.fellBack ? " (fallback)" : ""))
  if (t.usage && (t.usage.input || t.usage.output)) bits.push(tokenCount(t.usage.input + t.usage.output) + " tokens")
  if (t.subscription) bits.push("in your plan")
  else if (typeof t.costUsd === "number") bits.push(t.costUsd < 0.01 ? (t.costUsd ? "< $0.01" : "free") : "$" + t.costUsd.toFixed(2))
  if (t.quotes && t.quotes.missing) bits.push(t.quotes.missing + (t.quotes.missing === 1 ? " quote" : " quotes") + " not found in the text")
  return bits.length ? bits.join(" · ") + " · " : ""
}

function tokenCount(n) {
  return n >= 1000000 ? Math.round(n / 100000) / 10 + "M" : n >= 1000 ? Math.round(n / 1000) + "k" : String(n)
}

// The Processes view (the task queue): "Clear finished processes", then the tasks newest first; Enter on a finished
// one reads the note it made.
function buildTaskRows(tasks, query, color, rank, now) {
  var ranked = rank(tasks || [], query, [
    { get: function (t) { return t.title + " " + (t.paper || "") } }
  ])
  var rows = ranked.map(function (r) {
    var t = r.item
    var label = t.title + (t.paper ? " — " + t.paper : "")
    var detail = t.status === "running" ? "Running · started " + ago(t.started, now) + (t.model ? " · " + t.model : "")
      : t.status === "done" ? "Finished " + ago(t.finished, now) + " · " + (t.detail ? t.detail + " · " : "") + runFacts(t) + (t.noteKey ? "Enter reads the note" : "")
        : "Failed " + ago(t.finished, now) + ": " + (t.error || "unknown error")
    return listRow({ section: TASK_SECTIONS[t.status] || "", rowId: "task", icon: TASK_ICONS[t.status] || "", label: label, labelHtml: highlight(label, rangesFrom(r.positions), color), detail: detail,
      available: t.status === "done", submenu: t.status === "done", value: t.id, itemKey: t.key, itemLibraryID: t.libraryID, itemTitle: t.paper,
      note: t.status === "done" && t.noteKey ? { key: t.noteKey, libraryID: t.libraryID } : null, badge: t.status === "running" ? "running" : t.status === "error" ? "failed" : "" })
  })
  var order = { running: 0, done: 1, error: 2 }
  var status = {}
  var started = {}
  ;(tasks || []).forEach(function (t) { status[t.id] = t.status; started[t.id] = String(t.started || "") })
  var typed = !!String(query || "").trim()
  // Running, then Finished, then Failed; newest first in each (by match while you type).
  rows = rows.map(function (r, i) { return { r: r, i: i } }).sort(function (x, y) {
    var byState = (order[status[x.r.value]] || 0) - (order[status[y.r.value]] || 0)
    if (byState || typed) return byState || x.i - y.i
    var a = started[x.r.value], b = started[y.r.value]
    return a < b ? 1 : a > b ? -1 : x.i - y.i
  }).map(function (x) { return x.r })
  // "Clear finished processes" heads the list (the launcher starts the cursor on the first task).
  if ((tasks || []).some(function (t) { return t.status !== "running" })) {
    rows.unshift(listRow({ rowId: "tasks-clear", icon: "\uf1f8", label: "Clear finished processes · the notes stay in Zotero", available: true }))
  }
  return rows
}

// The Chats view: "New chat…" (pick a paper), then the chats grouped by paper (a heading each): the
// paper with the newest chat first, its chats newest first. While you type, the papers whose chats
// match best come first.
function buildChatRows(chats, query, color, rank) {
  var ranked = rank(chats || [], query, [
    { get: function (c) { return c.title } },
    { get: function (c) { return c.paper || "" }, weight: 0.6 }
  ])
  if (!String(query || "").trim()) {
    ranked = ranked.slice().sort(function (a, b) {
      var x = String(a.item.updated || ""), y = String(b.item.updated || "")
      return x < y ? 1 : x > y ? -1 : 0
    })
  }
  var groups = []
  var byPaper = {}
  ranked.forEach(function (r) {
    var c = r.item
    var id = (Number(c.libraryID) || 1) + ":" + c.key
    if (!byPaper[id]) {
      byPaper[id] = { paper: String(c.paper || c.key).replace(/^\((.*)\)$/, "$1"), items: [] }
      groups.push(byPaper[id])
    }
    byPaper[id].items.push(r)
  })
  var rows = [listRow({ rowId: "chat-new", icon: CREATE_ICON, label: "New chat…", detail: "Pick the paper to chat about", available: true, submenu: true })]
  groups.forEach(function (g) {
    g.items.forEach(function (r) {
      var c = r.item
      rows.push(listRow({ section: g.paper, rowId: "chat-open", icon: CHAT_ICON, label: c.title, labelHtml: highlight(c.title, rangesFrom(r.positions), color),
        detail: [String(c.updated || "").slice(0, 10), c.turns + (c.turns === 1 ? " question" : " questions"), c.model || ""].filter(function (x) { return x }).join(" · "),
        available: true, submenu: true, value: c.id, itemKey: c.key, itemLibraryID: c.libraryID, itemTitle: c.paper }))
    })
  })
  return rows
}

// A setup step as a result row (Zotero or its plugin isn't working): Enter does it.
function setupResultRow(action, icon, title, detail) {
  var r = workspaceRow("setup", icon, title, detail)
  r.key = action
  r.section = "Set up"
  return r
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
  // Items and collections by their key; tags by their name.
  return list.filter(function (p) { return p && (p.type === "tag" ? typeof p.key === "string" && p.key.length > 0 && p.key.length <= 255 : /^[A-Z0-9]{8}$/.test(String(p.key))) }).map(function (p) {
    return { key: String(p.key), libraryID: Number(p.libraryID) || 1, title: String(p.title || ""), type: pinType(p) }
  })
}

function pinType(x) {
  return x && (x.type === "collection" || x.type === "tag") ? x.type : "item"
}

function isPinned(pins, item) {
  var type = pinType(item)
  return !!item && (pins || []).some(function (p) { return p.key === item.key && p.libraryID === (Number(item.libraryID) || 1) && p.type === type })
}

// The pins with `item` moved to where `other` is (Shift+↑/↓ on neighbours in the Pinned section).
function movePin(pins, item, other) {
  var same = function (p, x) { return p.key === String(x.key) && p.libraryID === (Number(x.libraryID) || 1) && p.type === pinType(x) }
  var list = (pins || []).slice()
  var a = -1, b = -1
  for (var i = 0; i < list.length; i++) {
    if (same(list[i], item)) a = i
    if (same(list[i], other)) b = i
  }
  if (a < 0 || b < 0) return list
  var moved = list.splice(a, 1)[0]
  list.splice(b, 0, moved)
  return list
}

// Pin (to the end of the pinned list) or unpin; returns the new list. `item.type`:
// "collection" or "tag", else an item.
function togglePin(pins, item) {
  var lib = Number(item.libraryID) || 1
  var type = pinType(item)
  if (isPinned(pins, item)) return pins.filter(function (p) { return !(p.key === item.key && p.libraryID === lib && p.type === type) })
  return pins.concat([{ key: String(item.key), libraryID: lib, title: String(item.title || ""), type: type }])
}

// ---------------------------------------------------------------- prompts

var PROMPT_ICON = "\uf0d0"
var EDIT_ICON = "\uf044"
var MODEL_ICON = "\uf2db"
var EFFORT_ICON = "\uf0e4"
var TEXT_ICON = "\uf15c"

var CHAT_ICON = "\uf086"
var EXTRACT_ICON = "\uf1c1"

// The paper's extracted-text note (oma-zotero-prompt extract), if it has one.
function fulltextNote(details) {
  var notes = (details && details.notes) || []
  for (var i = 0; i < notes.length; i++) if (notes[i].fulltext) return notes[i]
  return null
}

function hasPdf(details) {
  return ((details && details.attachments) || []).some(function (a) { return a.exists && a.contentType === "application/pdf" })
}

// "Chat with the paper": a chat window grounded in its text (needs the prompt runner).
function chatRow(details, prompts, problem) {
  var saved = fulltextNote(details)
  var detail = !prompts ? (problem || "…") : saved ? "Grounded in its extracted text, page by page · past chats kept"
    : hasPdf(details) ? "Grounded in the PDF's text · extract it first for a saved, page-numbered copy" : "Grounded in what Zotero has: no PDF"
  return listRow({ rowId: "chat", icon: CHAT_ICON, label: "Chat with the paper", detail: detail, available: !!prompts, submenu: true })
}

// The text-extraction row: says whether the PDF's text is extracted; Enter extracts it, or
// extracts it again and replaces the note (the old one goes to Zotero's trash). The note
// itself is read from the Notes section.
function extractRow(details, loading, noRunner, extracting) {
  var saved = fulltextNote(details)
  var pdf = hasPdf(details) && !noRunner
  if (extracting) return listRow({ rowId: "extract", icon: EXTRACT_ICON, label: saved ? "Extracting the text again…" : "Extracting the text…", value: "",
    detail: "It's in Processes; this row updates when it's done", available: false, badge: "running" })
  if (saved) {
    return listRow({ rowId: "extract", icon: EXTRACT_ICON, label: "Text extracted", value: "replace",
      detail: (saved.dateModified ? "Saved " + shortDate(saved.dateModified) + " · " : "") + (pdf ? "Enter extracts it again and replaces the note" : "No PDF to extract it again from"),
      available: pdf, badge: "\u2713" })
  }
  return listRow({ rowId: "extract", icon: EXTRACT_ICON, label: "Text not extracted", value: "extract",
    detail: loading ? "…" : noRunner && hasPdf(details) ? "Needs the AI features: Settings › Install AI features" : pdf ? "Enter extracts the PDF's text into a page-numbered note, for chats and prompts" : "No PDF to extract from",
    available: !loading && pdf })
}

// The actions' Prompts row, under the notes: opens the prompts list.
function promptsRow(prompts, problem) {
  if (!prompts) {
    return listRow({ rowId: "prompts", icon: PROMPT_ICON, label: "Prompts", detail: problem || "…", available: false })
  }
  var n = prompts.length
  var detail = n ? n + (n === 1 ? " prompt" : " prompts") + " · the model writes a new note" : "No prompts yet: create one"
  return listRow({ rowId: "prompts", icon: PROMPT_ICON, label: "Prompts", detail: detail, available: true, submenu: true })
}

// "Set up an AI model": prompts and chat need a provider (Settings › Models & providers).
function setupRow(prompts, problem) {
  var missing = !prompts && /isn't installed/.test(String(problem || ""))
  return listRow({ rowId: "setup", icon: SETTINGS_ICON, label: "Set up an AI model", available: true, submenu: true,
    detail: missing ? "Prompts and chat: install the AI features, then choose a model" : "Prompts and chat need a model: your subscription, an API key, or one on this computer" })
}

// A model in the providers' list ("claude:opus[1m]" → "Opus (1M context)"). Values name their
// provider; a bare name is a Claude model, as in prompt files from before providers.
function findModel(models, value) {
  var v = String(value || "")
  for (var i = 0; i < (models || []).length; i++) {
    var m = models[i]
    if (m.value === v || m.value === "claude:" + v) return m
  }
  return null
}

// `defaults`: what "default" resolves to ("" = nothing set up), for its label.
function modelLabel(models, value, resolvedDefault) {
  if (!value || value === "default") return resolvedDefault ? "Default · " + modelLabel(models, resolvedDefault) : "Default model"
  var m = findModel(models, value)
  if (!m) return String(value)
  var group = m.group ? String(m.group).replace(/ \(subscription\)$/, "") : ""
  return (group && group !== "Claude" ? group + " · " : "") + m.displayName
}

function effortLabel(effort) {
  return effort ? effort : "model default"
}

// The effort to keep when the model changes: the same level if the new model takes it,
// else "high" (or its highest level), or "" for a model without effort levels.
function effortFor(models, model, effort) {
  if (!model || model === "default") return effort || "high"
  var m = findModel(models, model)
  if (!m) return effort
  var levels = m.efforts || []
  if (!levels.length) return ""
  if (levels.indexOf(effort) >= 0) return effort
  return levels.indexOf("high") >= 0 ? "high" : levels[levels.length - 1]
}

// The prompts submenu: each prompt (Enter runs it, Alt+E edits it), then "New prompt…".
function buildPromptRows(prompts, models, query, color, rank, resolvedDefault) {
  var ranked = rank(prompts || [], query, [
    { get: function (p) { return p.title } },
    { get: function (p) { return p.excerpt || "" }, weight: 0.3 }
  ])
  var rows = ranked.map(function (r) {
    var p = r.item
    var detail = [modelLabel(models, p.model, resolvedDefault), effortLabel(p.effort), p.excerpt].filter(function (x) { return x }).join(" · ")
    return listRow({ rowId: "prompt", icon: PROMPT_ICON, label: p.title, labelHtml: highlight(p.title, rangesFrom(r.positions), color), detail: detail, available: true, promptId: p.id })
  })
  rows.push(listRow({ rowId: "prompt-new", icon: CREATE_ICON, label: "New prompt…", detail: "Name it and write it, or describe it and let AI write it", available: true, submenu: true }))
  return rows
}

// The prompt editor: title, model, effort (each opens a page of its own) and text.
// `models` is the providers' list (null while loading); `resolvedDefault`: the model "default"
// stands for (Settings › Defaults).
function promptModel(prompt, models, resolvedDefault) {
  var isDefault = !prompt.model || prompt.model === "default"
  return { isDefault: isDefault, m: isDefault ? findModel(models, resolvedDefault) : findModel(models, prompt.model) }
}

function buildPromptEditor(prompt, models, open, resolvedDefault) {
  if (!prompt) return []
  var rows = []
  var pm = promptModel(prompt, models, resolvedDefault)
  var m = pm.m
  rows.push(listRow({ rowId: "pe-title", icon: EDIT_ICON, label: "Title", detail: prompt.title, available: true, submenu: true }))
  var modelDetail = pm.isDefault ? "Default model" + (resolvedDefault ? " · now " + modelLabel(models, resolvedDefault) : " · none set up yet") + " (Settings › Defaults)"
    : m ? modelLabel(models, prompt.model) + (m.description ? " · " + m.description : "") : prompt.model + (models ? " (not in your providers' lists)" : "")
  rows.push(listRow({ rowId: "pe-model", icon: MODEL_ICON, label: "Model", detail: modelDetail, available: true, submenu: true }))
  var noEffort = m && !(m.efforts || []).length
  rows.push(listRow({ rowId: "pe-effort", icon: EFFORT_ICON, label: "Effort", detail: noEffort ? m.displayName + " takes no effort level" : effortLabel(prompt.effort),
    available: !noEffort, submenu: !noEffort }))
  rows.push(listRow({ rowId: "pe-text", icon: TEXT_ICON, label: "Prompt text", detail: prompt.excerpt || "Empty: write it", available: true, submenu: true, trailing: "editor" }))
  return rows
}

// The prompt's model, as a page: the default, then every enabled provider's models, grouped.
function buildPromptModels(prompt, models, resolvedDefault) {
  var pm = promptModel(prompt, models, resolvedDefault)
  var rows = [listRow({ rowId: "pe-model-opt", label: "Default model", detail: "Whatever Settings › Defaults says for prompts" + (resolvedDefault ? " (now " + resolvedDefault + ")" : ""),
    available: true, showCheck: true, checked: pm.isDefault, value: "default" })]
  var list = (models || []).slice()
  if (!pm.isDefault && !pm.m) list.unshift({ value: prompt.model, displayName: prompt.model, description: models ? "not in your providers' lists" : "loading the models…", efforts: [] })
  list.forEach(function (o) {
    rows.push(listRow({ section: o.group || "", rowId: "pe-model-opt", label: o.displayName, detail: [o.description, o.efforts && o.efforts.length ? "" : "no effort levels"].filter(function (x) { return x }).join(" · "),
      available: true, showCheck: true, checked: !pm.isDefault && (o.value === prompt.model || o.value === "claude:" + prompt.model), value: o.value }))
  })
  return rows
}

// The prompt's effort, as a page: the levels its model takes.
function buildPromptEfforts(prompt, models, resolvedDefault) {
  var m = promptModel(prompt, models, resolvedDefault).m
  var levels = m && (m.efforts || []).length ? m.efforts : ["low", "medium", "high", "xhigh", "max"]
  return levels.map(function (e) {
    return listRow({ rowId: "pe-effort-opt", label: e, detail: EFFORT_HELP[e] || "", available: true, showCheck: true, checked: e === prompt.effort, value: e })
  })
}

var EFFORT_HELP = {
  low: "fastest, least thinking",
  medium: "",
  high: "thorough (recommended for these notes)",
  xhigh: "more thinking, slower",
  max: "most thinking, slowest and most usage"
}

// Naming a new prompt ("create") or renaming one: the header holds the title. A new prompt can
// also be written with AI: the header then holds what it should do. `ai`: { ready (a model is
// set up), busy (a draft is being written) }.
function buildTitleRows(text, mode, ai) {
  var t = String(text || "").trim()
  var create = mode === "create"
  var label = !t ? (create ? "Type the new prompt's name" : "Type the new title") : create ? "Create “" + t + "”" : "Rename to “" + t + "”"
  var rows = [listRow({ rowId: "pe-title-save", icon: create ? CREATE_ICON : EDIT_ICON, label: label, available: !!t, value: t })]
  if (create) {
    var a = ai || {}
    rows.push(listRow({ rowId: "pe-title-ai", icon: PROMPT_ICON, value: t, available: !!t && !!a.ready && !a.busy,
      label: a.busy ? "Writing the prompt with AI…" : t ? "Write it with AI: “" + t + "”" : "Or describe what it should do, and let AI write it",
      detail: a.busy ? "It opens here when it's ready (or see it under Prompts)" : !a.ready ? "Set up an AI model first (Settings)"
        : "Your default prompts model drafts the title and text, following your rules; review it before you run it" }))
  }
  return rows
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
function buildNoteRows(details, query, color, rank, order) {
  var notes = orderNotes((details && details.notes) || [], order)
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

// ---------------------------------------------------------------- note window

// A note's first block is its title (Zotero names notes by their first line), which the
// reader's header and the window's top bar already show. → { title, html }: that block's
// full text (Zotero's own title is cut at ~120 characters) and the HTML without it. The
// block is only taken when it is the title (`noteTitle`, or starts with it when cut).
function splitNoteTitle(html, noteTitle) {
  var src = String(html || "")
  var m = /^\s*<(h[1-6]|p)>([\s\S]*?)<\/\1>/.exec(src)
  var fold = function (t) { return plainText(t).replace(/\s+/g, " ").trim().toLowerCase() }
  var want = fold(noteTitle || "").replace(/…$/, "")
  if (!m || !want) return { title: String(noteTitle || ""), html: src }
  var first = plainText(m[2]).replace(/\s+/g, " ").trim()
  var f = first.toLowerCase()
  if (!f || !(f === want || f.indexOf(want) === 0 || want.indexOf(f) === 0)) return { title: String(noteTitle || ""), html: src }
  return { title: first, html: src.slice(m[0].length) }
}

// Tags out, the common entities decoded.
function plainText(html) {
  return String(html || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
}

// A chat question as a short title (notes, file names): one line, ≤ 60 characters.
function chatTitle(question) {
  var t = String(question || "").replace(/\s+/g, " ").trim()
  return !t ? "chat" : t.length > 60 ? t.slice(0, 59).trim() + "…" : t
}

// "Sirmon et al. (2007)" from the bridge's paper info, for a header.
function paperCite(paper) {
  if (!paper) return ""
  return [paper.authors, paper.year ? "(" + paper.year + ")" : ""].filter(function (x) { return x }).join(" ")
}

// A note's sanitized HTML (bridge /note format "html": bare tags, web hrefs only) → Qt rich
// text with the note window's typography: headings a step or two above the body instead of
// Qt's 2× h1, a small gap between paragraphs but none between bullets (Zotero writes a list
// item as <li><p>…</p></li>), indented quotes, ruled tables, links in the accent color.
// `o`: { size (body px), color (text), accent, dim (quote/secondary text) }.
function noteHtml(html, o) {
  var size = Number(o.size) || 14
  var px = function (f) { return Math.round(size * f) + "px" }
  var heading = function (f, top) {
    return 'style="font-size:' + px(f) + ";font-weight:600;margin-top:" + px(top) + ";margin-bottom:" + px(0.35) + ";color:" + o.color + '"'
  }
  var styles = {
    h1: heading(1.3, 0.6),
    h2: heading(1.15, 1.1),
    h3: heading(1.05, 0.9),
    h4: heading(1.0, 0.8),
    p: 'style="margin-top:0px;margin-bottom:' + px(0.45) + ';line-height:135%"',
    lip: 'style="margin-top:0px;margin-bottom:0px;line-height:135%"', // a paragraph in a list item
    li: 'style="margin-top:0px;margin-bottom:0px;line-height:135%"',
    ul: 'style="margin-top:0px;margin-bottom:' + px(0.6) + '"',
    ol: 'style="margin-top:0px;margin-bottom:' + px(0.6) + '"',
    blockquote: 'style="margin-left:' + px(1.2) + ";margin-right:0px;margin-top:" + px(0.2) + ";margin-bottom:" + px(0.7) + ";color:" + o.dim + ';font-style:italic"',
    pre: 'style="margin-bottom:' + px(0.6) + '"',
    table: 'border="1" cellspacing="0" cellpadding="' + Math.round(size * 0.35) + '" style="border-collapse:collapse;margin-bottom:' + px(0.8) + ";border-color:" + o.dim + '"',
    th: 'style="font-weight:600"',
    hr: ""
  }
  var out = String(html || "")
    // Headings become styled paragraphs: Qt sizes <h1>–<h3> itself, whatever the style says.
    .replace(/<(h[1-6])>/g, function (m, tag) { return "<p " + (styles[tag] || styles.h4) + ">" })
    .replace(/<\/h[1-6]>/g, "</p>")
    .replace(/<li>(\s*)<p>/g, "<li>$1<p " + styles.lip + ">")
    .replace(/<(p|li|ul|ol|blockquote|pre|table|th)>/g, function (m, tag) { return "<" + tag + " " + styles[tag] + ">" })
    .replace(/<a href="/g, '<a style="color:' + o.accent + ';text-decoration:none" href="')
  return '<div style="font-size:' + px(1) + ";color:" + o.color + '">' + out + "</div>"
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

// ---------------------------------------------------------------- saved searches

var SEARCH_ICON = ""
var SECTION_SEARCHES = "Saved searches"
var MAX_SEARCHES = 200

// The searches file (~/.config/omarchy/oma-zotero-launcher/searches.json) → [{ id, name, query,
// pinned }], in your order; the pinned ones are the badges above the results, in this order too.
function parseSearches(text) {
  var j
  try {
    j = JSON.parse(String(text || ""))
  } catch (e) {
    return []
  }
  var list = j && Array.isArray(j.searches) ? j.searches : []
  var seen = {}
  var out = []
  list.forEach(function (s) {
    if (!s || typeof s.query !== "string" || !s.query.trim()) return
    var id = String(s.id || "")
    if (!/^[a-z0-9-]{1,40}$/.test(id) || seen[id]) return
    seen[id] = true
    out.push({ id: id, name: String(s.name || "").trim() || s.query.trim(), query: s.query.trim(), pinned: !!s.pinned })
  })
  return out.slice(0, MAX_SEARCHES)
}

// A new id: the time in base 36, moved on past any taken.
function newSearchId(searches, now) {
  var n = Math.floor(Number(now) || Date.now())
  var taken = {}
  ;(searches || []).forEach(function (s) { taken[s.id] = true })
  while (taken["s" + n.toString(36)]) n++
  return "s" + n.toString(36)
}

// → { list, search }: the search added at the end.
function addSearch(searches, name, query, pinned, now) {
  query = String(query || "").trim()
  var s = { id: newSearchId(searches, now), name: String(name || "").trim() || query, query: query, pinned: !!pinned }
  return { list: (searches || []).concat([s]), search: s }
}

function findSearch(searches, id) {
  var list = searches || []
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]
  return null
}

// changes: { name?, query?, pinned? }; an empty name or query leaves it as it was.
function updateSearch(searches, id, changes) {
  return (searches || []).map(function (s) {
    if (s.id !== id) return s
    var next = Object.assign({}, s)
    if (changes.name != null && String(changes.name).trim()) next.name = String(changes.name).trim()
    if (changes.query != null && String(changes.query).trim()) next.query = String(changes.query).trim()
    if (changes.pinned != null) next.pinned = !!changes.pinned
    return next
  })
}

function removeSearch(searches, id) {
  return (searches || []).filter(function (s) { return s.id !== id })
}

// The list with `id` moved to where `otherId` is (Shift+↑/↓ on neighbours).
function moveSearch(searches, id, otherId) {
  var list = (searches || []).slice()
  var a = -1, b = -1
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) a = i
    if (list[i].id === otherId) b = i
  }
  if (a < 0 || b < 0) return list
  var moved = list.splice(a, 1)[0]
  list.splice(b, 0, moved)
  return list
}

function pinnedSearches(searches) {
  return (searches || []).filter(function (s) { return s.pinned })
}

// Alt+→ / Alt+← over the badges: "" (All) and the pinned searches, round and round.
function nextSearch(pinned, currentId, delta) {
  var ids = [""].concat((pinned || []).map(function (s) { return s.id }))
  var i = Math.max(0, ids.indexOf(currentId || ""))
  return ids[((i + delta) % ids.length + ids.length) % ids.length]
}

// A saved search as the launcher's search scope (the bridge's `within`).
function searchScope(s) {
  return { key: s.id, libraryID: 0, title: s.name, type: "search", query: s.query }
}

// What a scope adds to a query, to save what is shown: a collection's c:"path", a tag's #"name",
// a saved search's query.
function scopeQuery(scope) {
  if (!scope) return ""
  if (scope.type === "search") return String(scope.query || "")
  if (scope.type === "tag") return '#"' + String(scope.key).replace(/"/g, "") + '"'
  return 'c:"' + String(scope.title || "").replace(/"/g, "") + '"'
}

// Both queries as one: a side with OR or parentheses goes in parentheses of its own, so
// neither changes the other's meaning.
function combinedQuery(a, b) {
  a = String(a || "").trim()
  b = String(b || "").trim()
  if (!a || !b) return a || b
  var wrap = function (q) { return /\bOR\b|[()]/.test(q) ? "(" + q + ")" : q }
  return wrap(a) + " " + wrap(b)
}

// The Searches view: the pinned ones (the badges, in their order), then the rest; typing finds
// them by name or query.
function buildSearchRows(searches, query, color, rank) {
  var list = searches || []
  if (!list.length) {
    return [listRow({ rowId: "search-help", icon: SEARCH_ICON, label: "No saved searches yet",
      detail: "Type a search, then s (or Ctrl+S) saves it; @ adds tags, authors, years…", available: false })]
  }
  var typed = !!String(query || "").trim()
  var ranked = rank(list, query, [{ get: function (s) { return s.name } }, { get: function (s) { return s.query }, weight: 0.7 }])
  if (!typed) ranked = ranked.slice().sort(function (a, b) { return (b.item.pinned ? 1 : 0) - (a.item.pinned ? 1 : 0) || a.index - b.index })
  return ranked.map(function (r) {
    var s = r.item
    return listRow({ section: typed ? "" : s.pinned ? SECTION_PINNED : SECTION_SEARCHES, rowId: "search", icon: s.pinned ? PIN_ICON : SEARCH_ICON,
      label: s.name, labelHtml: highlight(s.name, rangesFrom(r.positions), color), detail: s.query, badge: s.pinned ? "pinned" : "",
      available: true, submenu: true, value: s.id })
  })
}

// Shift+Enter on a saved search.
function searchMenuRows(s) {
  s = s || {}
  return [
    listRow({ rowId: "search-open", icon: SEARCH_ICON, label: "Open", detail: s.query, available: true, submenu: true }),
    listRow({ rowId: "search-pin", icon: PIN_ICON, label: s.pinned ? "Unpin" : "Pin above the results",
      detail: s.pinned ? "Take its badge away" : "A badge above the results: Alt+→ and Alt+← switch between them", available: true }),
    listRow({ rowId: "search-rename", icon: EDIT_ICON, label: "Rename…", detail: s.name, available: true, submenu: true }),
    listRow({ rowId: "search-query", icon: EDIT_ICON, label: "Edit the search…", detail: s.query, available: true, submenu: true }),
    listRow({ rowId: "search-delete", icon: "", label: "Delete this search", detail: "Only the saved search: your papers stay as they are", available: true })
  ]
}

// The header holds the text: a name for the search being saved ("save"), a new name ("rename"),
// or its search ("query").
function buildSearchEditRows(mode, text, query) {
  var t = String(text || "").trim()
  if (mode === "save") {
    var name = t || query
    return [
      listRow({ rowId: "search-save", icon: SEARCH_ICON, label: "Save as “" + name + "”", detail: query, available: true, value: name }),
      listRow({ rowId: "search-save-pin", icon: PIN_ICON, label: "Save and pin it", detail: "A badge above the results; Alt+→ switches to it", available: true, value: name })
    ]
  }
  if (mode === "rename") return [listRow({ rowId: "search-rename-save", icon: EDIT_ICON, label: t ? "Rename to “" + t + "”" : "Type the new name", available: !!t, value: t })]
  return [listRow({ rowId: "search-query-save", icon: SEARCH_ICON, label: t ? "Save the search “" + t + "”" : "Type the search", detail: query ? "It was: " + query : "", available: !!t, value: t })]
}

// ---------------------------------------------------------------- the query, coloured

var QUERY_FIELD = /^(a|au|author|t|ti|title|y|year|p|pub|publication|journal|tag|c|col|collection|type|has):/i

// The theme's named colours (~/.local/state/omarchy/current/theme/colors.toml: `red = "#ED5B5A"`) →
// { red: "#ED5B5A", … }.
function parseThemeColors(text) {
  var out = {}
  String(text || "").split("\n").forEach(function (line) {
    var m = /^\s*([a-z_]+)\s*=\s*"(#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)"/.exec(line)
    if (m) out[m[1]] = m[2]
  })
  return out
}

// Field prefixes → the key a block shows ("A: Smith, John").
var FIELD_KEYS = { a: "A", au: "A", author: "A", t: "T", ti: "T", title: "T", y: "Y", year: "Y", p: "P", pub: "P", publication: "P", journal: "P",
  c: "C", col: "C", collection: "C", type: "Type", has: "Has", tag: "#" }

// A word of the search as a field term, or null: { neg, prefix, key, value (unquoted), quoted, closed }.
function fieldTerm(w) {
  var neg = w.charAt(0) === "!"
  var t = neg ? w.slice(1) : w
  var m = QUERY_FIELD.exec(t)
  var prefix = m ? m[0] : t.charAt(0) === "#" ? "#" : ""
  if (!prefix) return null
  var value = t.slice(prefix.length)
  var quoted = value.charAt(0) === '"'
  var closed = quoted && value.length >= 2 && value.charAt(value.length - 1) === '"'
  return { neg: neg, prefix: prefix, key: prefix === "#" ? "#" : FIELD_KEYS[prefix.slice(0, -1).toLowerCase()],
    value: quoted ? value.slice(1, closed ? -1 : undefined) : value, quoted: quoted, closed: closed }
}

// What a block shows: "A: Smith, John", "# supply chain", "Type: Journal article", "NOT Has: PDF".
function blockLabel(f) {
  var v = f.value
  if (f.key === "Type") v = v.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/^./, function (c) { return c.toUpperCase() })
  if (f.key === "Has" && v.toLowerCase() === "pdf") v = "PDF"
  return (f.neg ? "NOT " : "") + (f.key === "#" ? "# " : f.key + ": ") + v
}

// The search in pieces for the search box: [{ text (as typed), label (as shown), start, end, block,
// role }]. Operators (AND, OR, NOT, |) and finished field terms (a:"…", #tag, y:2020, …) are blocks,
// shown by their label; the rest is text (plain words, phrases, parentheses, spaces), in roles that
// colour it: "field" (a:, #), "quote", "neg" (!), "op" (a bar inside a word), "paren", "" (plain).
// The word the caret is inside, or at the end of while you type it (`live`), stays text: it becomes
// a block once finished, by a space, a ")" or the caret moving away.
function querySegments(text, caret, live) {
  text = String(text == null ? "" : text)
  caret = caret == null ? text.length : Number(caret)
  var segs = []
  var add = function (s, start, role, block, label) {
    if (!s) return
    var last = segs[segs.length - 1]
    if (!block && last && !last.block && last.role === role) {
      last.text += s
      last.label += s
      last.end += s.length
      return
    }
    segs.push({ text: s, label: label || s, start: start, end: start + s.length, block: !!block, role: role })
  }
  var term = function (t, at) {
    if (t.charAt(0) === "!") { add("!", at, "neg"); t = t.slice(1); at++ }
    var m = QUERY_FIELD.exec(t)
    var prefix = m ? m[0] : t.charAt(0) === "#" ? "#" : ""
    add(prefix, at, "field")
    add(t.slice(prefix.length), at + prefix.length, t.charAt(prefix.length) === '"' ? "quote" : "")
  }
  var i = 0
  while (i < text.length) {
    var ch = text.charAt(i)
    if (ch === " " || ch === "\t") { add(ch, i, ""); i++; continue }
    if (ch === "(" || ch === ")") { add(ch, i, "paren"); i++; continue }
    var j = i, inQuote = false
    while (j < text.length) {
      var d = text.charAt(j)
      if (d === '"') inQuote = !inQuote
      else if (!inQuote && (d === " " || d === "\t" || d === "(" || d === ")")) break
      j++
    }
    var w = text.slice(i, j)
    var open = (caret > i && caret < j) || (!!live && caret === j)
    var f = fieldTerm(w)
    var bars = w.length > 1 && /\|/.test(w.replace(/"[^"]*"?/g, ""))
    if (w === "AND" || w === "OR" || w === "NOT" || w === "|") add(w, i, "op", !open)
    else if (f && !open && !bars && f.value && (!f.quoted || f.closed)) add(w, i, f.neg ? "neg" : "field", true, blockLabel(f))
    else if (bars) {
      // x|y: each side a term, the bars operators (bars inside quotes are text)
      var cur = "", from = i, quote = false
      for (var k = 0; k < w.length; k++) {
        var c = w.charAt(k)
        if (c === '"') quote = !quote
        if (c === "|" && !quote) { term(cur, from); add("|", i + k, "op"); cur = ""; from = i + k + 1; continue }
        cur += c
      }
      term(cur, from)
    } else term(w, i)
    i = j
  }
  return segs
}

// ---------------------------------------------------------------- the @ picker

var PICKER_FIELDS = [
  { field: "tag", icon: TAG_ICON, label: "Tags", detail: "#tag" },
  { field: "author", icon: "", label: "Authors", detail: "a:author" },
  { field: "publication", icon: "", label: "Publications", detail: "p:journal" },
  { field: "year", icon: "", label: "Years", detail: "y:2020 (or type a range: y:2019..2021)" },
  { field: "collection", icon: COLLECTION_ICON, label: "Collections", detail: "c:collection, its subcollections too" },
  { field: "type", icon: "", label: "Item types", detail: "type:book" },
  { field: "has", icon: "", label: "Has a PDF, notes or files", detail: "has:pdf  has:notes  has:files" },
  { field: "search", icon: SEARCH_ICON, label: "Saved searches", detail: "One of yours, in parentheses" }
]

// [what it puts in, what it is, its section]
var PICKER_OPERATORS = [
  ["AND", "Both (a space does the same)", "Operators"],
  ["OR", "Either: a OR b", "Operators"],
  ["NOT", "Not the next term, or the next ( … )", "Operators"],
  ["(", "A group: (a OR b) c", "Operators"],
  [")", "End the group", "Operators"],
  ["|", "Either of its neighbours: a | b c is (a OR b) c", "Operators"],
  ['"', "An exact phrase; around a name, the whole name: #\"supply chain\"", "Syntax"],
  ["!", "Exclude the next term: !review, !#read", "Syntax"],
  ["t:", "In the title only: t:resilience", "Syntax"],
  ["a:", "By an author: a:smith", "Syntax"],
  ["y:", "A year or a range: y:2020, y:2019..2021, y:..2010", "Syntax"],
  ["p:", "In a publication: p:management", "Syntax"],
  ["#", "With a tag: #risk", "Syntax"],
  ["c:", "In a collection, subcollections too: c:scm", "Syntax"],
  ["type:", "An item type: type:book", "Syntax"],
  ["has:", "Has something: has:pdf, has:notes, has:files", "Syntax"],
  ["'", "An exact match, not fuzzy: 'resil", "Syntax"],
  ["^", "Starts with: ^supply", "Syntax"],
  ["$", "Ends with (after the word): chain$", "Syntax"]
]

function pickerFieldLabel(field) {
  for (var i = 0; i < PICKER_FIELDS.length; i++) if (PICKER_FIELDS[i].field === field) return PICKER_FIELDS[i].label
  return field
}

// @: what to add to the search. Its filters (Saved searches only when you have some), the
// operators, then the rest of the syntax. Typing finds one by its label or what it does.
function buildPickerRows(query, hasSearches) {
  var rows = PICKER_FIELDS.filter(function (f) { return f.field !== "search" || hasSearches }).map(function (f) {
    return listRow({ section: "Add a filter", rowId: "pick-field", icon: f.icon, label: f.label, detail: f.detail, available: true, submenu: true, value: f.field })
  })
  PICKER_OPERATORS.forEach(function (o) {
    rows.push(listRow({ section: o[2], rowId: "pick-op", icon: "", label: o[0], detail: o[1], available: true, value: o[0] }))
  })
  var q = String(query || "").trim().toLowerCase()
  if (!q) return rows
  // Symbols have nothing to match: they're found by what they do ("exclude", "phrase", "title").
  var byLabel = filterRows(rows, q)
  var byWhat = rows.filter(function (r) { return byLabel.indexOf(r) < 0 && r.detail.toLowerCase().indexOf(q) >= 0 })
  return byLabel.concat(byWhat)
}

// A field's values ({ label, count, token, detail }) as rows. `rank` (Fuzzy.filter) ranks them by what
// is typed; without it they come ranked (the bridge's /facets), their matches in titleRanges.
function buildPickerValueRows(values, query, color, rank, limit) {
  var ranked = rank ? rank(values || [], query, [{ get: function (v) { return v.label } }])
    : (values || []).map(function (v) { return { item: v, positions: null } })
  return ranked.slice(0, limit || 200).map(function (r) {
    var v = r.item
    return listRow({ rowId: "pick-value", label: v.label, labelHtml: highlight(v.label, r.positions ? rangesFrom(r.positions) : v.titleRanges, color),
      detail: [v.token, v.detail].filter(function (x) { return x }).join(" · "), trailing: v.count ? thousands(v.count) : "", available: true, value: v.token })
  })
}

// Your saved searches as picker values: each one's search in parentheses.
function savedSearchValues(searches) {
  return (searches || []).map(function (s) { return { value: s.id, label: s.name, count: 0, token: "(" + s.query + ")", detail: "" } })
}

// ---------------------------------------------------------------- editing the search at its caret

// Where a new term may start: the beginning, after a space, "(", or a prefix (a:, #, !, |).
var TERM_START = /[\s(:#!|]/

function quoteOpenAt(before) {
  return (before.split('"').length - 1) % 2 === 1
}

// One character typed at the caret. With `pairs` (a search, as code editors do): "(" and '"'
// close themselves, the caret between them, where a term may start (not inside quotes, not
// before a word); typing ")" or a closing '"' steps over the one already there.
function typeChar(text, caret, ch, pairs) {
  var before = text.slice(0, caret), after = text.slice(caret)
  var prev = before.charAt(before.length - 1), next = after.charAt(0)
  var inQuote = quoteOpenAt(before)
  var free = !next || /[\s)]/.test(next) // nothing right after the caret but a space or ")"
  if (pairs) {
    if (ch === '"' && inQuote && next === '"') return { text: text, caret: caret + 1 }
    if (ch === ")" && !inQuote && next === ")") return { text: text, caret: caret + 1 }
    if (ch === '"' && !inQuote && free && (!prev || TERM_START.test(prev))) return { text: before + '""' + after, caret: caret + 1 }
    if (ch === "(" && !inQuote && free) return { text: before + "()" + after, caret: caret + 1 }
  }
  return { text: before + ch + after, caret: caret + ch.length }
}

// A block to delete whole: the one ending at the caret, or right before a space the caret follows
// (Backspace); the one starting at the caret, with the space after it (Delete). → { start, end } | null
function blockBefore(segs, text, caret) {
  for (var i = 0; i < segs.length; i++) {
    var s = segs[i]
    if (s.block && (s.end === caret || (s.end === caret - 1 && text.charAt(caret - 1) === " "))) return { start: s.start, end: caret }
  }
  return null
}

function blockAfter(segs, text, caret) {
  for (var i = 0; i < segs.length; i++) {
    var s = segs[i]
    if (s.block && s.start === caret) return { start: caret, end: s.end + (text.charAt(s.end) === " " ? 1 : 0) }
  }
  return null
}

// Typing a word: the caret right after a character of one (not a space or a parenthesis).
function typingAt(text, caret) {
  var c = text.charAt(caret - 1)
  return !!c && !/[\s()]/.test(c)
}

// The search edited at its caret (an index into text). op: { insert: "text" } (each character as
// typed) or "backspace" | "word" (Ctrl+Backspace) | "delete" | "clear" (Ctrl+U) | "left" | "right" |
// "home" | "end". With `pairs` (a search): ( and " close themselves; Backspace inside an empty () or
// "" deletes both; a block (querySegments; `live`: the word at the caret is being typed) is deleted
// and stepped over whole. → { text, caret, live }
function editQuery(text, caret, op, pairs, live) {
  text = String(text == null ? "" : text)
  caret = Math.max(0, Math.min(text.length, caret == null ? text.length : Number(caret)))
  var before = text.slice(0, caret), after = text.slice(caret)
  var segs = pairs ? querySegments(text, caret, live) : []
  var cut = function (r) { return { text: text.slice(0, r.start) + text.slice(r.end), caret: r.start, live: false } }
  var moved = function (to) { return { text: text, caret: to, live: false } }
  if (op && typeof op === "object") {
    var out = { text: text, caret: caret }
    var s = String(op.insert == null ? "" : op.insert)
    for (var i = 0; i < s.length; i++) out = typeChar(out.text, out.caret, s.charAt(i), pairs)
    return { text: out.text, caret: out.caret, live: typingAt(out.text, out.caret) }
  }
  var block
  switch (op) {
    case "backspace": {
      if (!caret) return moved(0)
      if ((block = blockBefore(segs, text, caret))) return cut(block)
      var prev = before.charAt(before.length - 1), next = after.charAt(0)
      var emptyPair = pairs && ((prev === "(" && next === ")") || (prev === '"' && next === '"' && !quoteOpenAt(before.slice(0, -1))))
      var t = before.slice(0, -1) + (emptyPair ? after.slice(1) : after)
      return { text: t, caret: caret - 1, live: typingAt(t, caret - 1) }
    }
    case "word": {
      if ((block = blockBefore(segs, text, caret))) return cut(block)
      var kept = before.replace(/\s+$/, "").replace(/\S+$/, "")
      return { text: kept + after, caret: kept.length, live: false }
    }
    case "delete":
      if ((block = blockAfter(segs, text, caret))) return cut(block)
      return { text: before + after.slice(1), caret: caret, live: false }
    case "clear": return { text: "", caret: 0, live: false }
    case "left":
      for (var l = 0; l < segs.length; l++) if (segs[l].block && segs[l].end === caret) return moved(segs[l].start)
      return moved(Math.max(0, caret - 1))
    case "right":
      for (var r = 0; r < segs.length; r++) if (segs[r].block && segs[r].start === caret) return moved(segs[r].end)
      return moved(Math.min(text.length, caret + 1))
    case "home": return moved(0)
    case "end": return moved(text.length)
  }
  return { text: text, caret: caret, live: !!live }
}

// A term or operator picked with @, put in at the caret: spaced from its neighbours, and a space
// after it for what you type next (not before a ")"). A prefix (a:, #, !, ', ^) is left open for
// its value; "(" and '"' open a pair with the caret inside, as when typed; ")" steps over one.
// → { text, caret, live }
function insertAt(text, caret, token) {
  text = String(text == null ? "" : text)
  caret = Math.max(0, Math.min(text.length, caret == null ? text.length : Number(caret)))
  var t = String(token)
  var before = text.slice(0, caret), after = text.slice(caret)
  var prev = before.charAt(before.length - 1), next = after.charAt(0)
  var lead = prev && !TERM_START.test(prev) ? " " : ""
  if (t === "(" || t === '"') return editQuery(text, caret, { insert: lead + t }, true)
  if (t === ")" || t === "$") return editQuery(text, caret, { insert: t }, true)
  if (/^[a-z]+:$|^[#!'^]$/.test(t)) return { text: before + lead + t + after, caret: caret + lead.length + t.length, live: false }
  var trail = next && /[\s)]/.test(next) ? "" : " "
  return { text: before + lead + t + trail + after, caret: caret + lead.length + t.length + trail.length, live: false }
}

if (typeof module !== "undefined") {
  module.exports = {
    ICONS: ICONS, iconFor: iconFor, escapeHtml: escapeHtml, highlight: highlight, subtitle: subtitle, openState: openState,
    thousands: thousands, toRow: toRow, rankLabels: rankLabels, rankShort: rankShort, statusFromTags: statusFromTags, noteHtml: noteHtml, splitNoteTitle: splitNoteTitle, paperCite: paperCite, chatTitle: chatTitle, rankIsTop: rankIsTop, buildRows: buildRows, countText: countText, selectionAfter: selectionAfter,
    SECTION_PINNED: SECTION_PINNED, SECTION_COLLECTIONS: SECTION_COLLECTIONS, SECTION_PAPERS: SECTION_PAPERS, SECTION_OPEN: SECTION_OPEN, SECTION_RECENT: SECTION_RECENT, SECTION_RECENT_MODIFIED: SECTION_RECENT_MODIFIED, SECTION_RECENT_LATEST: SECTION_RECENT_LATEST, tagsText: tagsText,
    fileKind: fileKind, usableFiles: usableFiles, buildActions: buildActions, buildFileRows: buildFileRows, filterRows: filterRows,
    listRow: listRow, taskSummary: taskSummary, buildTaskRows: buildTaskRows, buildChatRows: buildChatRows, workspaceRows: workspaceRows, ago: ago, chatRow: chatRow, extractRow: extractRow, fulltextNote: fulltextNote, pinRow: pinRow, parsePins: parsePins, isPinned: isPinned, togglePin: togglePin, movePin: movePin, orderNotes: orderNotes, hasPdf: hasPdf, orderSections: orderSections, moveSection: moveSection, sectionGroups: sectionGroups, promptsRow: promptsRow, buildPromptRows: buildPromptRows, buildPromptEditor: buildPromptEditor, buildPromptModels: buildPromptModels, buildPromptEfforts: buildPromptEfforts, buildTitleRows: buildTitleRows,
    effortFor: effortFor, modelLabel: modelLabel, commandRows: commandRows, setupResultRow: setupResultRow, findModel: findModel, setupRow: setupRow, runFacts: runFacts, shortDate: shortDate, rangesFrom: rangesFrom, buildNoteRows: buildNoteRows,
    tagSummary: tagSummary, tagMap: tagMap, buildTagRows: buildTagRows, tagCountText: tagCountText,
    parseSearches: parseSearches, newSearchId: newSearchId, addSearch: addSearch, findSearch: findSearch, updateSearch: updateSearch, removeSearch: removeSearch,
    moveSearch: moveSearch, pinnedSearches: pinnedSearches, nextSearch: nextSearch, searchScope: searchScope, scopeQuery: scopeQuery, combinedQuery: combinedQuery,
    buildSearchRows: buildSearchRows, searchMenuRows: searchMenuRows, buildSearchEditRows: buildSearchEditRows,
    parseThemeColors: parseThemeColors, querySegments: querySegments,
    buildPickerRows: buildPickerRows, buildPickerValueRows: buildPickerValueRows, savedSearchValues: savedSearchValues, editQuery: editQuery, insertAt: insertAt, pickerFieldLabel: pickerFieldLabel
  }
}
