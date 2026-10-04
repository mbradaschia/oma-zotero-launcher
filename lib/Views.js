// Pure view-model helpers for ZoteroSearch.qml (node-testable): bridge search
// responses → flat list rows with sections, StyledText titles and badges.

// Nerd Font (Font Awesome range) glyph per Zotero item type.
var ICONS = {
  journalArticle: "\uf0f6",
  magazineArticle: "\uf1ea",
  newspaperArticle: "\uf1ea",
  book: "\uf405",
  bookSection: "\uf405",
  encyclopediaArticle: "\uf405",
  dictionaryEntry: "\uf405",
  thesis: "\uf494",
  report: "\uf4a5",
  preprint: "\uf4a5",
  manuscript: "\uf4a5",
  conferencePaper: "\uf4a9",
  presentation: "\uf4a9",
  webpage: "\uf484",
  blogPost: "\uf484",
  forumPost: "\uf484",
  dataset: "\uf472",
  computerProgram: "\uf44f",
  videoRecording: "\uf447",
  film: "\uf447",
  audioRecording: "\uf485",
  podcast: "\uf485",
  email: "\uf42f",
  letter: "\uf42f",
  case: "\uf495",
  statute: "\uf495",
  patent: "\uf495",
  note: "\uf24a",
  attachment: "\uf1c1"
}
var DEFAULT_ICON = "\uf4a5"

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
    tagsText: tagsText(r.tags, r.tagCount, BUILD_STATUSES),
    ranks: rankLabels(r.rank).join("|"),
    status: statusFromTags(r, BUILD_STATUSES) // "\u0000": unknown (an older Zotero plugin, and not among its first tags)
  }
}

var COLLECTION_ICON = "\uf413"

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

// The first tags of a result, for its second line: "#notion #resilience +2". The "#" is only how
// they're shown (Zotero's tags have none), and a paper status tag is left out: its pill shows it.
function tagsText(tags, total, statuses) {
  tags = tags || []
  var lower = (statuses || []).map(function (s) { return String(s).toLowerCase() })
  var before = tags.length
  // a paper status (its pill shows it) and task statuses (t/…: the task icon shows those)
  tags = tags.filter(function (t) { return lower.indexOf(String(t).toLowerCase()) < 0 && !/^t\//i.test(String(t)) })
  total = (Number(total) || before) - (before - tags.length)
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
  // (in a collection, a tag or a saved search: only what acts on its papers, Extract their text)
  var cmds = (!resp.scope || resp.scope.kind === "search") && extras && !extras.noCommands ? commandRows(resp.query, extras)
    : resp.scope && extras && extras.scopeTitle ? commandRows(resp.query, extras).filter(function (r) { return r.kind === "extract-all" || r.kind === "classify-all" }) : []
  for (var m = 0; m < cmds.length; m++) rows.push(cmds[m])
  var papers = cols.length || tags.length || cmds.length || resp.scope ? SECTION_PAPERS : ""
  for (var c = 0; c < cols.length; c++) rows.push(toRow(cols[c], resp.scope ? "Subcollections" : SECTION_COLLECTIONS, color))
  for (var g = 0; g < tags.length; g++) rows.push(toRow(tags[g], SECTION_TAGS, color))
  for (var k = 0; k < results.length; k++) rows.push(toRow(results[k], papers, color))
  return rows
}

var SECTION_COMMANDS = "Go to"

// The launcher's own places, found by what you type: [kind, label, words, what it is, key].
var KEYS_ICON = "\uf11c"

var COMMANDS = [
  ["chats", "Chats", "chats chat conversations talk ask", "Your chats with papers", "c"],
  ["chat-new", "New chat…", "new chat ask talk paper", "Pick a paper to chat about", ""],
  ["todos", "Tasks", "tasks todo todos to do reading list", "Your tasks, by status", "t"],
  ["todo-new", "New task…", "new task todo add", "About a paper or not", "a"],
  ["tasks", "Processes", "processes queue running jobs runs extractions prompts", "Prompt runs, text extractions and syncs", "."],
  ["searches", "Searches", "searches saved search filters queries pinned badges", "Your saved searches: open, pin, rename, delete", "f"],
  ["sync", "Sync Zotero", "sync zotero synchronize synchronise cloud server upload download", "Zotero's own sync, without leaving the launcher", "S"],
  ["classify-all", "Tag the papers by taxonomies", "tag tags taxonomies taxonomy classify paper type ontology epistemology method theories", "Paper type, ontology, epistemology, method, theories: Jev, else your prompts model", ""],
  ["extract-all", "Extract every paper's text", "extract text pdf pdfs every all papers catch up fulltext full", "Papers with a PDF and no extracted text: a few at a time, in the background (in Processes)", ""],
  ["settings", "Settings", "settings preferences options configuration setup", "Models & providers, defaults, general", ";"],
  ["keys", "Keybindings", "keybindings keys shortcuts bindings help keyboard", "Every key, by section, with search", "?"],
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
    if (c[0] === "classify-all" && !(extras && extras.scopeTitle)) return // a collection's, a tag's, a saved search's papers: not the whole library
    var hay = (c[1] + " " + c[2]).toLowerCase().split(/[^a-z0-9]+/)
    if (!words.every(function (w) { return hay.some(function (h) { return h.indexOf(w) === 0 }) })) return
    var key = c[4] ? " · " + (extras && extras.keys === "alt" ? "alt+" : "") + c[4] : ""
    var icon = c[0] === "tasks" ? TASK_ICONS.done : c[0] === "keys" ? KEYS_ICON : c[0] === "searches" ? SEARCH_ICON : c[0] === "sync" ? SYNC_ICON : c[0].indexOf("todo") === 0 ? "\uf4a0" : c[0].indexOf("chat") === 0 ? CHAT_ICON : SETTINGS_ICON
    var title = c[0] === "extract-all" && extras && extras.scopeTitle ? "Extract the text of " + extras.scopeTitle + "'s papers"
      : c[0] === "classify-all" ? "Tag " + extras.scopeTitle + "'s papers by taxonomies" : c[1]
    var detail = c[0] === "sync" ? syncDetail(extras && extras.sync, extras && extras.now) : c[0] === "extract-all" && extras && extras.extracting ? "Extracting now: Settings › Defaults says how many are left, and stops it" : c[3]
    var r = workspaceRow(c[0], c[0] === "extract-all" ? EXTRACT_ICON : c[0] === "classify-all" ? "\uf02c" : icon, title, detail + key)
    r.section = SECTION_COMMANDS
    rows.push(r)
  })
  return rows.concat(settingRows(words, extras && extras.settingsIndex))
}

// Every Settings row, found as you type (extras.settingsIndex: [{ page, pageTitle, label, detail, section, rowId,
// value }], the launcher's Settings pages as they are now): the best few whose name (or its section, its page)
// has every word you typed; Enter opens its page on it. The pages Go to has already (Models & providers,
// Defaults, Rules, General) aren't listed twice.
var SETTINGS_IN_COMMANDS = ["providers", "defaults", "rules", "general"]
var SETTING_ROWS = 6
function settingRows(words, index) {
  words = (words || []).filter(function (w) { return w.length > 1 }) // a:smith's "a" finds nothing here
  if (!words.length || !index || !index.length) return []
  var split = function (t) { return String(t || "").toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w }) }
  var found = []
  index.forEach(function (e) {
    if (e.rowId === "set-nav" && SETTINGS_IN_COMMANDS.indexOf(e.value) >= 0) return
    var name = split(e.label), around = split(e.section + " " + e.pageTitle + " settings")
    var inName = 0
    var all = words.every(function (w) {
      if (name.some(function (h) { return h.indexOf(w) === 0 })) { inName++; return true }
      return around.some(function (h) { return h.indexOf(w) === 0 })
    })
    if (all && inName) found.push({ e: e, score: inName })
  })
  found.sort(function (a, b) { return b.score - a.score })
  return found.slice(0, SETTING_ROWS).map(function (f) {
    var e = f.e
    var where = "Settings" + (e.pageTitle && e.pageTitle !== "Settings" ? " › " + e.pageTitle : "") + (e.section && e.section !== e.pageTitle && e.section !== "Settings" ? " › " + e.section : "")
    var r = workspaceRow("setting", SETTINGS_ICON, e.label, where + (e.detail ? " · " + e.detail : ""))
    r.key = [e.page, e.rowId, e.value, e.label].join("\u0001")
    r.section = SECTION_COMMANDS
    return r
  })
}

// A submenu's search reaches Settings too: the settings matching what's typed, under a Settings section below the
// menu's own rows (listRow rows; Enter opens the page on the row: value is settingRows' key).
function settingMenuRows(query, index) {
  var words = String(query || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(function (w) { return w })
  return settingRows(words, index).map(function (r) {
    return listRow({ section: "Settings", rowId: "setting-go", icon: SETTINGS_ICON, label: r.title, detail: r.subtitle, value: r.key, available: true, submenu: true })
  })
}

// ---------------------------------------------------------------- Zotero's sync

var SYNC_ICON = "\uf021"

// Sync Zotero's line, from the bridge's /sync/status (null: not known yet).
function syncDetail(sync, now) {
  if (!sync) return "Zotero's own sync, without leaving the launcher"
  if (!sync.configured) return "Not set up: sign in under Zotero › Settings › Sync"
  if (sync.running) return "Syncing…" + (sync.status ? " · " + sync.status : "") + " · it's in Processes"
  return sync.lastSync ? "Last synced " + ago(sync.lastSync, now) : "Zotero's own sync, without leaving the launcher"
}

// The footer's word on it: "synced 5 min ago", "syncing…", or "" (not set up, or not known).
function syncFooter(sync, now) {
  if (!sync || !sync.configured) return ""
  if (sync.running) return "syncing…"
  return sync.lastSync ? "synced " + ago(sync.lastSync, now) : ""
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
  if (kind === "EPUB") return ""
  if (kind === "snapshot") return ""
  return ""
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
    itemTitle: String(f.itemTitle || ""),
    path: String(f.path || ""), // a file to open (an artifact's view)
    session: String(f.session || ""), // a chat (a chat turn in Processes)
    // A form row (a task's page): "text" or "multiline" edits editText in place; "pills" shows
    // pills ("a|b|c"), pillOn filled.
    field: String(f.field || ""),
    editText: String(f.editText == null ? "" : f.editText),
    pills: String(f.pills || ""),
    pillOn: String(f.pillOn || ""),
    pill: String(f.pill || ""), // a status shown as a filled pill after the label (a paper's tasks)
    pillKind: String(f.pillKind || "task"),
    chips: String(f.chips || ""), // labels as pills after the label ("a|b"), in chipKind's colour
    chipKind: String(f.chipKind || ""),
    decision: String(f.decision || "") // a taxonomy label's in the audit: "confirmed" (on, by you), "dismissed" (off, by you), "" (auto)
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
    var notes = orderNotes(ownNotes(details), extra.noteOrder)
    if (!notes.length) {
      rows.push(listRow({ rowId: "notes-empty", icon: NOTE_ICON, label: loading ? "…" : "No notes yet", detail: loading ? "" : "Prompts and chats can write some", available: false }))
    }
    notes.forEach(function (n) {
      var detail = [shortDate(n.dateModified), n.excerpt].filter(function (x) { return x }).join(" · ")
      rows.push(listRow({ rowId: "note", icon: NOTE_ICON, label: n.title || "Untitled note", detail: detail, available: true, submenu: true, note: n }))
    })
    rows.forEach(function (r) { r.section = SECTION_NOTES })
    // Its chats, newest first: Enter continues one, Shift+Enter renames or deletes it.
    ;(extra.chats || []).forEach(function (c) {
      rows.push(listRow({ section: SECTION_CHATS, rowId: "chat-session", icon: CHAT_ICON, label: c.title || "Chat", available: true, submenu: true, value: c.id,
        detail: [String(c.updated || "").slice(0, 10), c.turns + (c.turns === 1 ? " question" : " questions"), c.model || ""].filter(function (x) { return x }).join(" · ") }))
    })
    // Its artifacts (diagrams, mind maps, images, pages, documents), the latest changed first:
    // Enter opens one in the browser, Shift+Enter changes it with AI, renames, undoes or deletes it.
    ;(extra.artifacts || []).forEach(function (a) {
      rows.push(artifactRow(a, SECTION_ARTIFACTS))
    })
    // No AI model yet: one row that leads to Settings, in place of Prompts and Chat.
    var ai = setup ? [setupRow(prompts, promptsProblem), extractRow(details, loading, !prompts)]
      : [promptsRow(prompts, promptsProblem), chatRow(details, prompts, promptsProblem), extractRow(details, loading, !prompts, extra.extracting)]
    // Tag by taxonomies (paper type, ontology, method, theories…): Jev, else your prompts model; its labels are
    // pills under the status line (taxonomyStrip)
    if (extra.taxonomies && !loading) ai.push(classifyRow(extra, setup))
    // what came out, label by label (Jev's probabilities, or your model's)
    if (extra.taxonomies && !loading && extra.taxStatus && extra.taxStatus.classified) ai.push(listRow({ rowId: "classify-audit", icon: "\uf080", label: "Audit the taxonomies",
      detail: "Every label's probability, what was tagged, suggested or left out; Enter on one tags it", available: true, submenu: true }))
    ai.forEach(function (r) { r.section = SECTION_AI; rows.push(r) })
  }
  var start = itemType === "note" ? 0 : rows.length

  // Its status (a tag from Settings › Paper status): Alt+→ / Alt+← (or Enter) moves it along.
  if (extra.paperStatus !== undefined && itemType !== "note" && itemType !== "attachment") {
    rows.push(listRow({ rowId: "paper-status", icon: TAG_ICON, label: extra.paperStatus ? "Status: " + extra.paperStatus : "No status",
      detail: "Alt+→ / Alt+← (or Enter) changes it: " + ["none"].concat(extra.statusTags || []).join(" → "), available: !loading, badge: extra.paperStatus || "" }))
  }
  // Its default task (a task status on the paper itself): Shift+Alt+→ / Shift+Alt+← (or Enter) moves it along.
  if (extra.defaultTask && itemType !== "note" && itemType !== "attachment") {
    var dt = extra.defaultTask
    rows.push(listRow({ rowId: "default-task", icon: "\uf4a0", label: dt.status ? "Task: " + dt.status : "No task", pill: dt.status || "", available: !loading,
      detail: "Shift+Alt+→ / Shift+Alt+← (or Enter) " + (dt.status ? "changes it" : "makes it, “" + (dt.description || "Read it") + "”") + ": " + ["none"].concat(dt.statuses || []).join(" → ") }))
  }
  rows.push(pinRow(pinned))
  rows.push(actionRow("open", "", "Open in Zotero", loading ? "…" : (OPEN_DETAIL[details.openAction] || ""), true, false, null))

  var ext = usableFiles(details, "external")
  var extKind = fileKind(ext[0] || ((details && details.attachments) || [])[0])
  var extDetail = loading ? "…" : ext.length > 1 ? ext.length + " files: choose one…"
    : ext.length === 1 ? (extKind === "PDF" && viewerName ? viewerName + " · " : "") + (ext[0].filename || ext[0].title)
    : noFileReason(details, "external")
  rows.push(actionRow("external", "", "Open " + extKind + " externally", extDetail, ext.length > 0, ext.length > 1, ext.length === 1 ? ext[0] : null))

  var win = usableFiles(details, "window")
  var winKind = fileKind(win[0] || ext[0])
  var winDetail = loading ? "…" : win.length > 1 ? win.length + " files: choose one…"
    : win.length === 1 ? (win[0].filename || win[0].title)
    : noFileReason(details, "window")
  rows.push(actionRow("window", "", "Open " + winKind + " in a new Zotero window", winDetail, win.length > 0, win.length > 1, win.length === 1 ? win[0] : null))

  rows.push(listRow({ rowId: "tags", icon: TAG_ICON, label: "Tags", detail: loading ? "…" : tagSummary(details), available: !loading, submenu: true }))
  // every taxonomy's labels on it, in sections (hidden ones too)
  if (extra.taxonomies && itemType !== "note" && itemType !== "attachment") {
    var mine = paperTaxonomies(details && details.tags, extra.taxonomies).filter(function (t) { return t.labels.length })
    rows.push(listRow({ rowId: "tax-paper", icon: CLASSIFY_ICON, label: "Taxonomies", available: !loading, submenu: true,
      detail: loading ? "…" : mine.length ? mine.map(function (t) { return t.name + ": " + t.labels.join(", ") }).join(" · ") : "No labels yet: Tag by taxonomies" }))
  }
  // A paper: its citation and bibliography entry, in your citation style, copied (i, r).
  if (extra.cite && itemType !== "note" && itemType !== "attachment") citeRows(extra.cite, loading).forEach(function (r) { rows.push(r) })

  rows.push(actionRow("reveal", "", "Show in library", "Select it in Zotero's library", true, false, null))
  var own = itemType === "note" ? "This note" : itemType === "attachment" ? "This file" : "This paper"
  for (var i = start; i < rows.length; i++) rows[i].section = own
  return rows
}

// Copy citation / Copy bibliography entry. cite: { citation, bibliography (the formatted texts,
// "" until they come), error, keys ("single" | "alt") }.
var CLASSIFY_ICON = "\uf02c"

// The paper's labels in each taxonomy (its tags with the taxonomy's prefix). taxonomies: the runner's
// report's ([{ id, name, prefix, kind }]). → [{ id, name, prefix, labels }]
function paperTaxonomies(tags, taxonomies) {
  var names = ((tags || []).map(function (t) { return String(t.tag || t) }))
  return (taxonomies || []).map(function (t) {
    var p = String(t.prefix || "").toLowerCase()
    return { id: t.id, name: t.name, prefix: t.prefix, labels: p ? names.filter(function (n) { return n.toLowerCase().indexOf(p) === 0 && n.length > p.length }).map(function (n) { return n.slice(p.length) }) : [] }
  })
}

// The pills under a paper's status line (its menu and submenus): its labels in each taxonomy, and a word on
// them. taxStatus: { classified, stale: [ids] } (null while asked); classifying: it's being tagged now.
// → { items: [{ id, name, prefix, labels }] (the taxonomies it has labels in), note }
function taxonomyStrip(tags, taxonomies, taxStatus, classifying) {
  // the ones set to be shown (a taxonomy's page › On papers)
  var shown = (taxonomies || []).filter(function (t) { return t.show !== false })
  var items = paperTaxonomies(tags, shown).filter(function (t) { return t.labels.length })
  var st = taxStatus || null
  // a unique taxonomy with two labels (from before it was unique, or added outside the launcher): keep one
  var kind = {}
  ;(taxonomies || []).forEach(function (t) { kind[t.id] = t.kind })
  var two = items.filter(function (t) { return kind[t.id] === "one" && t.labels.length > 1 }).map(function (t) { return t.name })
  var note = two.length ? two.join(", ") + " takes one label: keep one (# tags)"
    : classifying ? "tagging…"
    : st && !st.classified ? "not tagged yet"
    : st && st.stale && st.stale.length ? "out of date: " + (taxonomies || []).filter(function (t) { return st.stale.indexOf(t.id) >= 0 }).map(function (t) { return t.name }).join(", ")
    : !items.length ? "no labels" : ""
  return { items: items, note: note }
}

// Audit the taxonomies (a paper's menu): its result label by label (the runner's classify-show), and where you change
// it by hand. Per taxonomy, its labels, the likeliest first, each with its probability, what became of it, and a
// check when the paper has it (tags: the paper's, whoever put them on). Enter cycles a label through three states:
// auto (the classifier decides) → on, by you → off, by you → auto. Yours are kept on later passes; a unique
// taxonomy's label put on replaces the other. audit: null while it's read.
var AUDIT_STATE = { tagged: "Auto: on (the classifier tagged it)", confirmed: "On, by you", suggested: "Auto: suggested (in Review)", dismissed: "Off, by you" }
var AUDIT_NEXT = { confirmed: "off, by you", dismissed: "auto (the classifier decides)" }
function buildTaxonomyAudit(audit, tags) {
  if (!audit) return [listRow({ rowId: "tax-audit-info", icon: TAG_ICON, label: "Reading the result…", available: false })]
  var have = {}
  ;(tags || []).forEach(function (g) { have[String(g.tag || g).toLowerCase()] = true })
  var rows = []
  var when = String(audit.at || "").replace("T", " ").slice(0, 16)
  rows.push(listRow({ section: "Result", rowId: "classify", icon: CLASSIFY_ICON, label: audit.classified ? "Tag again by taxonomies" : "Tag by taxonomies", available: true,
    detail: audit.classified ? "Last by " + String(audit.by || "?").replace(/^jev:/, "Jev ") + (when ? " · " + when + " UTC" : "") + " · your changes below are kept" : "Not tagged yet" }))
  audit.taxonomies.forEach(function (t) {
    var sec = t.name + " · " + (t.kind === "one" ? "unique" : "several") + " · tagged from " + Math.round(t.threshold * 100) + "%, suggested from " + Math.round(t.low * 100) + "%"
      + (!t.classified ? " · not tagged yet" : !t.kept ? " · from before probabilities were kept: tag again" : t.stale ? " · out of date" : "")
    t.labels.forEach(function (l) {
      var p = l.p == null ? null : Math.round(l.p * 100)
      var on = !!have[(String(t.prefix || "") + l.name).toLowerCase()]
      var why = AUDIT_STATE[l.state] || (on ? "Auto: on (put on by hand outside this page)" : p == null ? "Auto: not known" : l.p >= t.threshold ? "Auto: off (one label per paper)" : "Auto: off, below " + Math.round(t.low * 100) + "%")
      rows.push(listRow({ section: sec, rowId: "tax-audit", icon: TAG_ICON, label: l.name, value: t.id, tag: l.name, trailing: p == null ? "—" : p + "%", available: true,
        showCheck: true, checked: on, badge: l.state === "confirmed" || l.state === "dismissed" ? "by you" : "auto", decision: l.state === "confirmed" || l.state === "dismissed" ? l.state : "",
        detail: why + " · Enter → " + (AUDIT_NEXT[l.state] || (t.kind === "one" ? "on, by you (in place of the other)" : "on, by you")) }))
    })
  })
  return rows
}

// A paper's taxonomies (its menu › Taxonomies): a section per taxonomy (hidden ones too), its labels on the paper
// (Enter: the papers with one), then Audit the taxonomies and Tag by taxonomies.
function buildPaperTaxonomies(details, taxonomies, classified) {
  var rows = []
  var mine = paperTaxonomies(details && details.tags, taxonomies)
  ;(taxonomies || []).forEach(function (t, i) {
    var sec = t.name + " · " + (t.kind === "one" ? "unique" : "several") + (t.show === false ? " · hidden on papers" : "")
    var labels = mine[i].labels
    if (!labels.length) rows.push(listRow({ section: sec, rowId: "tax-none", icon: TAG_ICON, label: "No label", detail: t.prefix + "…", available: false }))
    labels.forEach(function (l) {
      rows.push(listRow({ section: sec, rowId: "tax-label-papers", icon: TAG_ICON, label: l, detail: t.prefix + l + " · Enter: the papers with it", available: true, submenu: true, tag: t.prefix + l, chips: l, chipKind: "taxonomy" }))
    })
  })
  if (classified) rows.push(listRow({ section: "More", rowId: "classify-audit", icon: "\uf080", label: "Audit the taxonomies", detail: "Every label's probability, and what became of it", available: true, submenu: true }))
  rows.push(listRow({ section: "More", rowId: "classify", icon: CLASSIFY_ICON, label: classified ? "Tag again by taxonomies" : "Tag by taxonomies", detail: "Paper type, ontology, epistemology, method, theories…", available: true }))
  return rows
}

// The footer's status row in a paper's menu (and its submenus): its text and its taxonomies, as pills.
// p: { details, extracting, taxonomies (the report's), taxStatus, classifying }. → [{ text, kind, mode }]
function paperFooter(p) {
  var d = p.details
  if (!d) return []
  var out = []
  var note = fulltextNote(d)
  out.push(p.extracting ? { text: "text: extracting…", kind: "status", mode: "off" }
    : note ? { text: "\u2713 text extracted", kind: "status", mode: "tag" }
    : hasPdf(d) ? { text: "text not extracted", kind: "neutral", mode: "off" } : { text: "no PDF", kind: "neutral", mode: "off" })
  if ((p.taxonomies || []).length) {
    var labels = paperTaxonomies(d.tags, p.taxonomies).reduce(function (n, t) { return n + t.labels.length }, 0)
    var st = p.taxStatus || null
    var stale = st ? (p.taxonomies || []).filter(function (t) { return (st.stale || []).indexOf(t.id) >= 0 }).map(function (t) { return t.name }) : []
    // needing an update (never tagged, or out of date with one): a warning, in the priority colour
    out.push(p.classifying ? { text: "taxonomies: tagging…", kind: "taxonomy", mode: "off" }
      : st && !st.classified ? { text: "\u26a0 taxonomies: not tagged" + (labels ? " (" + labels + " labels by hand)" : ""), kind: "priority", mode: "on" }
      : st && stale.length ? { text: "\u26a0 taxonomies: update needed (" + (stale.length === (p.taxonomies || []).length ? "all" : stale.join(", ")) + ")", kind: "priority", mode: "on" }
      : { text: "\u2713 taxonomies: " + labels + (labels === 1 ? " label" : " labels"), kind: "taxonomy", mode: "tag" })
  }
  return out
}

// Tag by taxonomies, in Prompts and chat. extra: { taxonomies (the report's), taxStatus, classifying, jev }.
function classifyRow(extra, setup) {
  var st = extra.taxStatus || null
  var stale = st ? st.stale || [] : []
  var names = (extra.taxonomies || []).filter(function (t) { return stale.indexOf(t.id) >= 0 }).map(function (t) { return t.name })
  var by = extra.jev ? "Jev" : "your prompts model"
  return listRow({ rowId: "classify", icon: CLASSIFY_ICON, available: !extra.classifying && (!!extra.jev || !setup),
    label: extra.classifying ? "Tagging by taxonomies…" : st && st.classified ? (names.length ? "Tag again by taxonomies: out of date" : "Tag again by taxonomies") : "Tag by taxonomies",
    detail: extra.classifying ? "It's in Processes; the tags show when it's done" : !extra.jev && setup ? "Needs a Jev key or an AI model: Settings › Taxonomies"
      : (st && st.classified && names.length ? "Out of date with " + names.join(", ") : (extra.taxonomies || []).map(function (t) { return t.name }).join(", ")) + " · " + by + " · Settings › Taxonomies" })
}

// A tag added by hand (the tag editor): a label of a unique taxonomy (one label per paper) takes the place of the
// paper's other label in it. tag; itemTags: the paper's tag names; taxonomies: the report's. → { taxonomy, others }
// (the paper's other labels of it, to come off) or null.
function uniqueLabelClash(tag, itemTags, taxonomies) {
  var lower = String(tag || "").toLowerCase()
  var t = (taxonomies || []).filter(function (x) { return x.kind === "one" && lower.indexOf(String(x.prefix).toLowerCase()) === 0 && lower.length > x.prefix.length })[0]
  if (!t) return null
  var others = (itemTags || []).filter(function (n) { var l = String(n).toLowerCase(); return l !== lower && l.indexOf(t.prefix.toLowerCase()) === 0 && l.length > t.prefix.length })
  return others.length ? { taxonomy: t, others: others } : null
}

var CITE_ICON = "\uf10d"
function citeRows(cite, loading) {
  var key = function (l) { return (cite.keys === "alt" ? "alt+" : "") + l }
  var text = function (t) { return cite.error ? "Couldn't format it: " + cite.error : loading || !t ? "…" : t }
  return [
    listRow({ rowId: "cite-copy", value: "citation", icon: CITE_ICON, label: "Copy citation", detail: text(cite.citation) + " · " + key("i"), available: !loading }),
    listRow({ rowId: "cite-copy", value: "bibliography", icon: CITE_ICON, label: "Copy bibliography entry", detail: text(cite.bibliography) + " · " + key("r"), available: !loading })
  ]
}

var SECTION_NOTES = "Notes"
var SECTION_CHATS = "Chats"
var SECTION_ARTIFACTS = "Artifacts"

// ---------------------------------------------------------------- artifacts

var ARTIFACT_ICONS = { markdown: "\uf15c", html: "\uf1c9", diagram: "\uf542", mindmap: "\uf0e8", image: "\uf03e" }

// An artifact's line: what it is, its version, when and how it was made.
function artifactDetail(a) {
  var by = String(a.by || "")
  var how = by.indexOf("prompt:") === 0 ? "from a prompt" : by.indexOf("chat:") === 0 ? "from a chat" : by === "edit" ? "changed with AI" : ""
  return [a.formatLabel || a.format, a.versions > 1 ? "version " + a.current + " of " + a.versions : "", String(a.updated || "").slice(0, 10), how].filter(function (x) { return x }).join(" · ")
}

function artifactRow(a, section) {
  return listRow({ section: section || "", rowId: "artifact", icon: ARTIFACT_ICONS[a.format] || TEXT_ICON, label: a.title, detail: artifactDetail(a), available: true, submenu: true,
    value: a.id, path: a.view, itemKey: a.key, itemLibraryID: a.libraryID, itemTitle: a.paper })
}

// Shift+Enter on an artifact: what can be done with it.
function buildArtifactMenu(a) {
  if (!a) return []
  var src = { markdown: "the Markdown file", html: "the HTML file", diagram: "the diagram's text (Mermaid)", mindmap: "the outline (Markdown)", image: "the SVG file" }[a.format] || "the file"
  var rows = [
    listRow({ rowId: "art-open", icon: "\uf35d", label: "Open", detail: "In your browser", available: true, path: a.view }),
    listRow({ rowId: "art-change", icon: PROMPT_ICON, label: "Change it with AI…", detail: "Say what to change; a new version is made, the old ones kept", available: true, submenu: true }),
    listRow({ rowId: "art-source", icon: EDIT_ICON, label: "Edit it yourself", detail: "Opens " + src + " in your editor", available: true, path: a.file }),
    listRow({ rowId: "art-brief", icon: TEXT_ICON, label: "Read the brief", detail: a.brief ? "What it was planned from: core message, concepts, numbers, takeaways, visual concept" : "It was drawn in one go, without a brief", available: !!a.brief, path: a.brief || "" }),
    listRow({ rowId: "art-undo", icon: "\uf0e2", label: "Undo the last change", detail: a.current > 1 ? "Back to version " + (a.current - 1) + " of " + a.versions : "This is its first version", available: a.current > 1 }),
    listRow({ rowId: "art-rename", icon: EDIT_ICON, label: "Rename…", detail: a.title, available: true, submenu: true }),
    listRow({ rowId: "art-folder", icon: "\uf07c", label: "Show the folder", detail: a.dir || "", available: !!a.dir, path: a.dir }),
    listRow({ rowId: "art-delete", icon: "\uf1f8", label: "Delete it", detail: "All its versions", available: true })
  ]
  return rows
}

// The header holds what to change: one row asks for it.
function buildArtifactChangeRows(a, text, ready) {
  var t = String(text || "").trim()
  return [listRow({ rowId: "art-change-go", icon: PROMPT_ICON, value: t, available: !!t && !!ready,
    label: t ? "Change it: “" + t + "”" : "Type what to change, e.g. add the moderators, left to right, shorter labels",
    detail: !ready ? "Set up an AI model first (Settings)" : "Your default prompts model makes version " + ((a && a.versions) + 1) + " from the paper and this one; it's in Processes" })]
}

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
var TASK_ICONS = { running: "\uf110", done: "\uf00c", error: "\uf421" }
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

var SETTINGS_ICON = "\uf423"

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
    var detail = t.status === "running" ? "Running · started " + ago(t.started, now) + (t.stage ? " · " + t.stage : "") + (t.model ? " · " + t.model : "")
      : t.status === "done" ? ("Finished " + ago(t.finished, now) + " · " + (t.detail ? t.detail + " · " : "") + runFacts(t) + (t.noteKey ? "Enter reads the note" : t.artifactView ? "Enter opens it" : t.chatSession ? "Enter opens the chat" : t.promptId && t.kind === "draft" ? "Enter edits the prompt" : "")).replace(/ · $/, "")
        : "Failed " + ago(t.finished, now) + ": " + (t.error || "unknown error")
    var opens = t.status === "done" && !!(t.noteKey || t.artifactView || t.chatSession || (t.kind === "draft" && t.promptId))
    return listRow({ section: TASK_SECTIONS[t.status] || "", rowId: "task", icon: TASK_ICONS[t.status] || "", label: label, labelHtml: highlight(label, rangesFrom(r.positions), color), detail: detail,
      available: opens, submenu: opens, session: t.chatSession || "", promptId: t.kind === "draft" ? t.promptId || "" : "", value: t.id, itemKey: t.key, itemLibraryID: t.libraryID, itemTitle: t.paper,
      note: t.status === "done" && t.noteKey ? { key: t.noteKey, libraryID: t.libraryID } : null, path: t.status === "done" ? t.artifactView || "" : "", badge: t.status === "running" ? "running" : t.status === "error" ? "failed" : "" })
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
    rows.unshift(listRow({ rowId: "tasks-clear", icon: "\uf48e", label: "Clear finished processes · the notes stay in Zotero", available: true }))
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

var PIN_ICON = "\uf435"

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

// ---------------------------------------------------------------- a menu's own pins and order

// In a paper's menu, p pins the highlighted row into a Pinned section on top, and Shift+\u2191/\u2193 moves a row
// within its section; both are kept per menu, by each row's identity (what it is, and which one: a note,
// a chat, a prompt\u2026), so a row you placed keeps its place on every paper that has it.
var SECTION_MENU_PINNED = "Pinned"

function rowIdentity(r) {
  var which = r.noteKey || r.value || r.promptId || "" // not a file's key: Open PDF is the same row on every paper
  return String(r.rowId) + (which ? ":" + which : "")
}

// Rows in your order within each section (order: { section: [identities] }): the ones you placed first,
// in that order, then the others as they come.
function orderRows(rows, order) {
  if (!order) return rows
  return [].concat.apply([], sectionGroups(rows).map(function (g) {
    var o = order[g.name]
    if (!o || !o.length) return g.rows
    var pos = {}
    o.forEach(function (id, i) { pos[id] = i })
    return g.rows.map(function (r, i) { return { r: r, i: i, p: pos[rowIdentity(r)] } }).sort(function (a, b) {
      if (a.p !== undefined && b.p !== undefined) return a.p - b.p
      if (a.p !== undefined) return -1
      if (b.p !== undefined) return 1
      return a.i - b.i
    }).map(function (e) { return e.r })
  }))
}

// The pinned rows (pins: [identities], in your order) out of their sections, into Pinned on top.
function pinRows(rows, pins) {
  if (!pins || !pins.length) return rows
  var byId = {}
  rows.forEach(function (r) { var id = rowIdentity(r); if (!byId[id]) byId[id] = r })
  var pinned = []
  pins.forEach(function (id) { if (byId[id] && pinned.indexOf(byId[id]) < 0) pinned.push(byId[id]) })
  if (!pinned.length) return rows
  return pinned.map(function (r) { return Object.assign({}, r, { section: SECTION_MENU_PINNED }) }).concat(rows.filter(function (r) { return pinned.indexOf(r) < 0 }))
}

// The rows you moved out of the way (P: others, [identities], in your order), out of their sections into Other,
// below everything.
var SECTION_MENU_OTHER = "Other"
function otherRows(rows, others) {
  if (!others || !others.length) return rows
  var byId = {}
  rows.forEach(function (r) { var id = rowIdentity(r); if (!byId[id] && r.section !== SECTION_MENU_PINNED) byId[id] = r })
  var moved = []
  others.forEach(function (id) { if (byId[id] && moved.indexOf(byId[id]) < 0) moved.push(byId[id]) })
  if (!moved.length) return rows
  return rows.filter(function (r) { return moved.indexOf(r) < 0 }).concat(moved.map(function (r) { return Object.assign({}, r, { section: SECTION_MENU_OTHER }) }))
}

// The identities `list` (a section's order, or the pins) with `id` moved to where `other` is. \u2192 the new
// list, or null when either isn't in it.
function moveIdentity(list, id, other) {
  var ids = (list || []).slice()
  var a = ids.indexOf(id), b = ids.indexOf(other)
  if (a < 0 || b < 0 || a === b) return null
  ids.splice(b, 0, ids.splice(a, 1)[0])
  return ids
}

// p: pinned (to the end) or unpinned. \u2192 the new pins.
function toggleIdentity(pins, id) {
  var list = (pins || []).slice()
  var i = list.indexOf(id)
  if (i >= 0) list.splice(i, 1)
  else list.push(id)
  return list
}

// ---------------------------------------------------------------- the footer's key hints

// A hint ("⇧↵ z zotero", "alt+→← status", "type to search") → { keys: "⇧↵ z", desc: "zotero" }: its leading
// keys (a symbol, a single letter, a+b, a/b, tab, esc…), drawn brighter than what they do.
var HINT_KEY_WORDS = ["tab", "esc", "del", "space", "pgup", "pgdn", "home", "end", "enter"]
function hintParts(hint) {
  var words = String(hint || "").trim().split(/\s+/).filter(function (w) { return w })
  var n = 0
  while (n < words.length - 1 && (words[n].length === 1 || /[^a-z-]/.test(words[n]) || HINT_KEY_WORDS.indexOf(words[n]) >= 0)) n++
  return { keys: words.slice(0, n).join(" "), desc: words.slice(n).join(" ") }
}

// The hints that fit on one line (width: what they may take; widthOf(hint): a hint's width; gap: between two),
// whole, in their order: the ones that go back (esc, ⌫) always, then the others as they come while there's room
// (a long one left out, a shorter one after it may still fit). → [hints]
function fitHints(hints, widthOf, width, gap) {
  var keep = function (h) { var k = hintParts(h).keys; return /esc|⌫/.test(k) }
  var used = 0, take = {}
  hints.forEach(function (h, i) { if (keep(h)) { used += widthOf(h) + (used ? gap : 0); take[i] = true } })
  hints.forEach(function (h, i) {
    if (take[i]) return
    var w = widthOf(h) + (used ? gap : 0)
    if (used + w <= width) { used += w; take[i] = true }
  })
  return hints.filter(function (h, i) { return take[i] })
}

// ---------------------------------------------------------------- pills

// Every pill in the launcher is one of three: "on" (the one chosen among choices, or the active badge:
// filled), "tag" (something the item has: tinted, outlined) or "off" (the other choices, a minor mark:
// a faint outline). Each kind has its color, from the theme (colors.toml) when it has one apart from the
// others, else the accent turned round the colour wheel: status (the accent), task, rank, taxonomy, scope
// (a collection, a tag, a saved search), priority; neutral is the text's.
var PILL_KINDS = ["status", "task", "rank", "taxonomy", "scope", "priority"]
var PILL_THEME = {
  status: ["accent"],
  task: ["green", "bright_green"],
  rank: ["blue", "bright_blue", "cyan"],
  taxonomy: ["magenta", "bright_magenta"],
  scope: ["cyan", "bright_cyan", "blue"],
  priority: ["yellow", "bright_yellow", "orange"]
}
var PILL_SPIN = { task: 150, rank: 210, taxonomy: 285, scope: 180, priority: 45 } // degrees from the accent

function hexRgb(c) {
  var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(String(c || ""))
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null
}

function rgbHex(rgb) {
  return "#" + rgb.map(function (x) { var h = Math.round(Math.max(0, Math.min(255, x))).toString(16); return h.length < 2 ? "0" + h : h }).join("")
}

function rgbHsl(rgb) {
  var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255
  var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min
  if (!d) return [0, 0, l]
  var s = d / (1 - Math.abs(2 * l - 1))
  var h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(h * 60 + 360) % 360, s, l]
}

function hslRgb(hsl) {
  var h = hsl[0], s = hsl[1], l = hsl[2]
  var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2
  var p = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [(p[0] + m) * 255, (p[1] + m) * 255, (p[2] + m) * 255]
}

// How far apart two colours look (the "redmean" weighting of RGB): about 100 and more tells them apart.
function colorDistance(a, b) {
  var x = hexRgb(a), y = hexRgb(b)
  if (!x || !y) return 0
  var rm = (x[0] + y[0]) / 2, dr = x[0] - y[0], dg = x[1] - y[1], db = x[2] - y[2]
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db)
}

// WCAG contrast between two colours: 1 (none) to 21; a pill's colour needs 3 against the background.
function luminance(c) {
  var rgb = hexRgb(c) || [0, 0, 0]
  var ch = rgb.map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

function contrast(a, b) {
  var x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

// base: { accent, foreground, background } (the shell's). → { status, task, rank, taxonomy, scope, priority,
// neutral }: "#rrggbb" each.
function pillPalette(theme, base) {
  theme = theme || {}
  base = base || {}
  var accent = hexRgb(base.accent) ? rgbHex(hexRgb(base.accent)) : "#7aa2f7"
  var bg = hexRgb(base.background) ? rgbHex(hexRgb(base.background)) : "#000000"
  var dark = luminance(bg) < 0.25
  var out = { neutral: base.foreground || (dark ? "#cccccc" : "#333333") }
  var used = []
  var usable = function (c) {
    var rgb = hexRgb(c)
    return !!rgb && rgbHsl(rgb)[1] >= 0.3 && contrast(c, bg) >= 3 && used.every(function (u) { return colorDistance(c, u) >= 110 })
  }
  // first the theme's own colours (each kind in turn), then a turned hue for the kinds left
  var pending = []
  PILL_KINDS.forEach(function (kind) {
    var pick = null
    PILL_THEME[kind].forEach(function (name) {
      var c = name === "accent" ? accent : theme[name]
      if (!pick && (kind === "status" || usable(c))) pick = rgbHex(hexRgb(c))
    })
    if (pick) { used.push(pick); out[kind] = pick } else pending.push(kind)
  })
  pending.forEach(function (kind) {
    var pick = null
    // the accent's saturation, its hue turned, as light (on a dark theme) or dark as reads on the background
    var sat = Math.max(0.5, rgbHsl(hexRgb(accent))[1])
    var hue0 = rgbHsl(hexRgb(accent))[0] + PILL_SPIN[kind]
    for (var step = 0; step < 12 && !pick; step++) {
      var hue = (hue0 + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * 25 + 720) % 360
      for (var l = dark ? 0.55 : 0.45; dark ? l <= 0.8 : l >= 0.25; l += dark ? 0.05 : -0.05) {
        var c = rgbHex(hslRgb([hue, sat, l]))
        if (usable(c)) { pick = c; break }
      }
    }
    if (!pick) pick = rgbHex(hslRgb([(hue0 + 360) % 360, sat, dark ? 0.65 : 0.4]))
    used.push(pick)
    out[kind] = pick
  })
  return out
}

// ---------------------------------------------------------------- prompts

var PROMPT_ICON = "\uf400"
var EDIT_ICON = "\uf448"
var MODEL_ICON = "\uf487"
var EFFORT_ICON = "\uf469"
var TEXT_ICON = "\uf0f6"

var CHAT_ICON = "\uf442"
var EXTRACT_ICON = "\uf1c1"

// The paper's notes but its extracted text (that's behind the extraction row): yours, and the ones
// prompts and chats wrote. Takes the bridge's /item response, or a list of notes.
function ownNotes(details) {
  var notes = Array.isArray(details) ? details : (details && details.notes) || []
  return notes.filter(function (n) { return !n.fulltext })
}

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
    // Enter reads it; Shift+Enter: read it, extract it again, open it in Zotero, delete it.
    return listRow({ rowId: "extract", icon: EXTRACT_ICON, label: "Text extracted", value: "read", note: saved,
      detail: (saved.dateModified ? "Saved " + shortDate(saved.dateModified) + " · " : "") + "Enter reads it · Shift+Enter: extract it again, open in Zotero, delete",
      available: true, submenu: true, badge: "\u2713" })
  }
  return listRow({ rowId: "extract", icon: EXTRACT_ICON, label: "Text not extracted", value: "extract",
    detail: loading ? "…" : noRunner && hasPdf(details) ? "Needs the AI features: Settings › Install AI features" : pdf ? "Enter extracts the PDF's text into a page-numbered note, for chats and prompts" : "No PDF to extract from",
    available: !loading && pdf })
}

// Shift+Enter on Text extracted: what can be done with the extracted text (a note in Zotero, tagged
// oma-fulltext; prompts and chats read it).
function buildExtractMenu(details, noRunner) {
  var saved = fulltextNote(details)
  if (!saved) return []
  var pdf = hasPdf(details) && !noRunner
  return [
    listRow({ rowId: "ext-read", icon: EXTRACT_ICON, label: "Read it", detail: "Page by page, as prompts and chats read it", available: true, submenu: true, note: saved }),
    listRow({ rowId: "ext-again", icon: EXTRACT_ICON, label: "Extract it again", available: pdf,
      detail: pdf ? "From the PDF; the new text replaces this one (which goes to Zotero's trash)" : noRunner && hasPdf(details) ? "Needs the AI features: Settings › Install AI features" : "No PDF to extract it from" }),
    listRow({ rowId: "ext-zotero", icon: "", label: "Open in Zotero", detail: "The note, in Zotero's note editor", available: true, note: saved }),
    listRow({ rowId: "ext-delete", icon: "\uf1f8", label: "Delete it", detail: "To Zotero's trash; a prompt or chat extracts it again when it needs it", available: true, note: saved })
  ]
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
    var detail = [p.output && p.output !== "note" ? OUTPUT_LABELS[p.output] || p.output : "", modelLabel(models, p.model, resolvedDefault), effortLabel(p.effort), p.excerpt].filter(function (x) { return x }).join(" · ")
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

// auto: it runs on new papers (Settings › Defaults › New papers; defaults.autoPrompts).
function buildPromptEditor(prompt, models, open, resolvedDefault, auto) {
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
  rows.push(listRow({ rowId: "pe-output", icon: ARTIFACT_ICONS[prompt.output] || NOTE_ICON, label: "Makes", detail: OUTPUT_HELP[prompt.output || "note"], available: true, submenu: true }))
  if (prompt.output && prompt.output !== "note") rows.push(listRow({ rowId: "pe-brief", icon: EFFORT_ICON, label: "Plans it first", available: true, showCheck: true, checked: prompt.brief !== false,
    detail: prompt.brief !== false ? "On · a brief first (core message, concepts, takeaways, numbers, a visual concept), then the final version drawn from it" : "Off · drawn in one go: faster, less considered" }))
  rows.push(listRow({ rowId: "pe-text", icon: TEXT_ICON, label: "Prompt text", detail: prompt.excerpt || "Empty: write it", available: true, submenu: true, trailing: "editor" }))
  rows.push(listRow({ rowId: "pe-auto", icon: MODEL_ICON, label: "Run on new papers", available: true, showCheck: true, checked: !!auto,
    detail: (auto ? "On" : "Off") + " · on each paper added to Zotero from when it's turned on, once, in the background (also in Settings › Defaults › New papers › Prompts to run on new papers)" }))
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

var OUTPUTS = ["note", "markdown", "html", "diagram", "mindmap", "image"]
var OUTPUT_LABELS = { note: "Zotero note", markdown: "Markdown file", html: "HTML page", diagram: "Diagram", mindmap: "Mind map", image: "Image (SVG)" }
var OUTPUT_HELP = {
  note: "A Zotero note on the paper",
  markdown: "A Markdown file (.md), in the paper's artifacts",
  html: "A self-contained HTML page, opens in your browser",
  diagram: "A diagram (flowchart, sequence, timeline…, drawn with Mermaid)",
  mindmap: "A mind map you can fold and unfold (drawn with markmap)",
  image: "An image, drawn as SVG: labels stay sharp and spelled right"
}

// What the prompt makes, as a page.
function buildPromptOutputs(prompt) {
  var cur = (prompt && prompt.output) || "note"
  return OUTPUTS.map(function (o) {
    return listRow({ rowId: "pe-output-opt", icon: ARTIFACT_ICONS[o] || NOTE_ICON, label: OUTPUT_LABELS[o], detail: OUTPUT_HELP[o], available: true, showCheck: true, checked: o === cur, value: o })
  })
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

var NOTE_ICON = "\uf24a"
var TAG_ICON = "\uf412"
var CREATE_ICON = "\uf44d"

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
  var notes = orderNotes(ownNotes(details), order)
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
  // Status tags (s/…, t/…) aren't edited here: they're managed in Settings › Paper status and › Tasks.
  var lib = ((state && state.tags) || []).filter(function (t) { return !isStatusTag(t.tag) })
  var onAll = (state && state.itemTags) || {}
  var on = {}
  for (var n in onAll) if (!isStatusTag(n)) on[n] = onAll[n]
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
  if (q && !hasTagCI(all, q) && !isStatusTag(q)) {
    rows.push(listRow({ rowId: "create", tag: q, icon: CREATE_ICON, label: "Create tag “" + q + "”", detail: editable ? "Ctrl+Enter adds it from anywhere in the list" : "", available: editable }))
  }
  // Its statuses, as rows that lead to where they're managed (nothing typed, or a status asked for)
  if (!q || isStatusTag(q) || /^stat/i.test(q)) statusTagRows(Object.keys(onAll)).forEach(function (r) { rows.push(r) })
  return rows
}

var STATUS_PREFIXES = ["s/", "t/"]

// A status tag: a paper status (s/…) or a task status (t/…), kept by the launcher.
function isStatusTag(name) {
  var n = String(name || "").toLowerCase()
  return STATUS_PREFIXES.some(function (p) { return n.indexOf(p) === 0 })
}

// The tag editor's Statuses rows: the paper's status and its tasks' statuses; Enter goes to their Settings page.
function statusTagRows(names) {
  var paper = names.filter(function (n) { return n.toLowerCase().indexOf("s/") === 0 }).map(function (n) { return n.slice(2) })
  var tasks = names.filter(function (n) { return n.toLowerCase().indexOf("t/") === 0 }).map(function (n) { return n.slice(2) })
  return [
    listRow({ section: "Statuses", rowId: "tags-status", value: "paper-status", icon: TAG_ICON, available: true, submenu: true,
      label: paper.length ? "Paper status: " + paper.join(", ") : "No paper status",
      detail: "Its s/… tag: Alt+→ / Alt+← on the paper changes it · Enter: Settings › Paper status" }),
    listRow({ section: "Statuses", rowId: "tags-status", value: "tasks", icon: "\uf4a0", available: true, submenu: true,
      label: tasks.length ? "Task statuses: " + tasks.join(", ") : "No task statuses",
      detail: "Its t/… tags follow its tasks · Enter: Settings › Tasks" })
  ]
}

// Turning a tag into a status (the tag editor's Shift+Enter): a new one named after it, or merged into one
// of yours. kind: "paper" | "task"; paper: your paper statuses' names; tasks: [{ id, name, group }].
function buildTagStatusRows(kind, tag, paper, tasks) {
  var lower = String(tag).toLowerCase()
  var rows = []
  if (kind === "paper") {
    var exists = (paper || []).some(function (p) { return p.toLowerCase() === lower })
    rows.push(listRow({ rowId: "tag-status-opt", value: "", icon: CREATE_ICON, label: "A new paper status “" + tag + "”", available: !exists,
      detail: exists ? "There's one by that name: merge into it, below" : "It becomes s/" + tag + " on every paper with it, and a status in Settings › Paper status" }))
    ;(paper || []).forEach(function (p) {
      rows.push(listRow({ section: "Or merge it into", rowId: "tag-status-opt", value: p, icon: TAG_ICON, label: "Merge into “" + p + "”", available: true,
        detail: "It becomes s/" + p + " on every paper with it (renamed in Zotero, merged)" }))
    })
    return rows
  }
  var existsTask = (tasks || []).some(function (t) { return t.name.toLowerCase() === lower })
  rows.push(listRow({ rowId: "tag-status-opt", value: "", icon: CREATE_ICON, label: "A new task status “" + tag + "”, in Backlog", available: !existsTask,
    detail: existsTask ? "There's one by that name: merge into it, below" : "Each paper with it gets its default task in it (made where it has none); the tag becomes t/" + tag }))
  ;(tasks || []).forEach(function (t) {
    rows.push(listRow({ section: "Or merge it into", rowId: "tag-status-opt", value: t.id, icon: "\uf4a0", label: "Merge into “" + t.name + "”", available: true,
      detail: "Each paper with it: its default task goes to " + t.name + " (made where it has none); the tag becomes t/" + t.name }))
  })
  return rows
}

// Header count for the tag editor: "129 tags · 2 on this item".
function tagCountText(state) {
  var n = ((state && state.tags) || []).filter(function (t) { return !isStatusTag(t.tag) }).length // the statuses: their own rows
  var on = Object.keys((state && state.itemTags) || {}).filter(function (t) { return !isStatusTag(t) }).length
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

var SEARCH_ICON = "\uf422"
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

// Tab / Shift+Tab over the badges: "" (All) and the pinned searches, round and round.
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
      detail: s.pinned ? "Take its badge away" : "A badge above the results: Tab and Shift+Tab switch between them", available: true }),
    listRow({ rowId: "search-rename", icon: EDIT_ICON, label: "Rename…", detail: s.name, available: true, submenu: true }),
    listRow({ rowId: "search-query", icon: EDIT_ICON, label: "Edit the search…", detail: s.query, available: true, submenu: true }),
    listRow({ rowId: "search-delete", icon: "", label: "Delete this search", detail: "Only the saved search: your papers stay as they are", available: true })
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
      listRow({ rowId: "search-save-pin", icon: PIN_ICON, label: "Save and pin it", detail: "A badge above the results; Tab switches to it", available: true, value: name })
    ]
  }
  if (mode === "rename") return [listRow({ rowId: "search-rename-save", icon: EDIT_ICON, label: t ? "Rename to “" + t + "”" : "Type the new name", available: !!t, value: t })]
  return [listRow({ rowId: "search-query-save", icon: SEARCH_ICON, label: t ? "Save the search “" + t + "”" : "Type the search", detail: query ? "It was: " + query : "", available: !!t, value: t })]
}

// ---------------------------------------------------------------- the query, coloured

var QUERY_FIELD = /^(a|au|author|t|ti|title|ab|abs|abstract|ta|y|year|p|pub|publication|journal|tag|c|col|collection|type|has|status|task|tasks|added|add|modified|mod|changed|recent):/i

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
var FIELD_KEYS = { a: "A", au: "A", author: "A", t: "T", ti: "T", title: "T", ab: "AB", abs: "AB", abstract: "AB", ta: "TA", y: "Y", year: "Y", p: "P", pub: "P", publication: "P", journal: "P",
  c: "C", col: "C", collection: "C", type: "Type", has: "Has", tag: "#", status: "Status", task: "Task", tasks: "Task",
  added: "Added", add: "Added", modified: "Modified", mod: "Modified", changed: "Modified", recent: "Recent" }

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

// A date term's value, said: "7d" → "last 7 days", ">2026-01-01" → "after 2026-01-01", "a..b" → "a to b".
function dateText(v) {
  var x = String(v || "").trim().toLowerCase()
  var rel = /^(\d{1,4})([dwmy])$/.exec(x)
  if (rel) return "last " + rel[1] + " " + { d: "day", w: "week", m: "month", y: "year" }[rel[2]] + (rel[1] === "1" ? "" : "s")
  var op = /^(>=|<=|>|<|=)(.+)$/.exec(x)
  if (op) return { ">": "after ", ">=": "from ", "<": "before ", "<=": "until ", "=": "" }[op[1]] + op[2]
  var range = /^([^.]*)\.\.([^.]*)$/.exec(x)
  if (range) return range[1] && range[2] ? range[1] + " to " + range[2] : range[1] ? "from " + range[1] : "until " + range[2]
  return x
}

// What a block shows: "A: Smith, John", "# supply chain", "Type: Journal article", "NOT Has: PDF".
function blockLabel(f) {
  var v = f.value
  if (f.key === "Type") v = v.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/^./, function (c) { return c.toUpperCase() })
  if (f.key === "Has" && v.toLowerCase() === "pdf") v = "PDF"
  if (f.key === "Added" || f.key === "Modified" || f.key === "Recent") v = dateText(v)
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

// ---------------------------------------------------------------- pinned first, in a saved search

// A saved search's results with what you pinned first, under Pinned, as before you type at the
// top: rows whose "type:libraryID:key" is in pinned (the rest keep their order).
function pinnedFirst(rows, pinned) {
  var key = function (r) { return (r.kind === "collection" || r.kind === "tag" ? r.kind : "item") + ":" + r.libraryID + ":" + r.key }
  var top = [], rest = []
  rows.forEach(function (r) {
    var isRow = r.kind === "item" || r.kind === "collection" || r.kind === "tag"
    if (isRow && pinned && pinned[key(r)]) top.push(Object.assign({}, r, { section: SECTION_PINNED }))
    else rest.push(r)
  })
  return top.concat(rest)
}

// ---------------------------------------------------------------- the context bar (above the search box)

// A level's header text ("‹ Tasks · type one to add it…") → what the context bar names ("Tasks").
function contextLabel(placeholder) {
  return String(placeholder || "").replace(/^‹\s*/, "").split(" · ")[0]
}

// …and what the search box says while it's empty: the header's own hint when it has one ("type to find or
// create one" → "Type to find or create one"), else "Type it" on a page for typing, else "Type to filter".
function typeHint(placeholder, textEntry) {
  var parts = String(placeholder || "").replace(/^‹\s*/, "").split(" · ")
  var last = parts.length > 1 ? parts[parts.length - 1] : ""
  if (/^(type|pick|choose|name|↵)/i.test(last)) return last.charAt(0).toUpperCase() + last.slice(1)
  return textEntry ? "Type it" : "Type to filter"
}

// A scope's count for the bar: "12 papers".
function scopeCount(n) {
  n = Number(n)
  return isFinite(n) && n >= 0 ? thousands(n) + (n === 1 ? " paper" : " papers") : ""
}

// ---------------------------------------------------------------- grouping and sorting the papers (g)

// How the results' papers are grouped or sorted (g / G cycle it, remembered): [id, the header's name].
var GROUPINGS = [
  ["relevance", ""],
  ["status", "by paper status"],
  ["task", "by task status"],
  ["taskgroup", "by task group"],
  ["added", "newest added"],
  ["modified", "newest changed"],
  ["year", "newest published"]
]

// The modes g cycles: the fixed ones, then one per taxonomy ("tax:theory/": by theories). taxonomies: the
// runner's report's list ([{ prefix, name, labels }]), or none.
function groupings(taxonomies) {
  return GROUPINGS.concat((taxonomies || []).map(function (t) { return ["tax:" + t.prefix, "by " + String(t.name).toLowerCase()] }))
}

function groupingName(id, taxonomies) {
  var all = groupings(taxonomies)
  for (var i = 0; i < all.length; i++) if (all[i][0] === id) return all[i][1]
  return ""
}

function nextGrouping(id, delta, taxonomies) {
  var ids = groupings(taxonomies).map(function (g) { return g[0] })
  var i = Math.max(0, ids.indexOf(id || "relevance"))
  return ids[((i + delta) % ids.length + ids.length) % ids.length]
}

var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

// "2026-10-03 12:00:00" → "October 2026"
function monthOf(sqlDate) {
  var m = /^(\d{4})-(\d{2})/.exec(String(sqlDate || ""))
  return m ? MONTH_NAMES[Number(m[2]) - 1] + " " + m[1] : ""
}

// The results' papers grouped (a heading each) or sorted, per `mode`; collections, tags, Go to and the
// Pinned section stay as they are. info: { results (the bridge's rows: dates, year), statuses (your paper
// status tags, in order), tasks ({ "lib:key": a paper's default task status }), taskStatuses (in order),
// groups (the task groups: [[id, name]]) }.
function groupRows(rows, mode, info) {
  if (!mode || mode === "relevance") return rows
  info = info || {}
  var isPaper = function (r) { return r.kind === "item" && r.section !== SECTION_PINNED }
  var papers = rows.filter(isPaper)
  if (!papers.length) return rows
  var raw = {}
  ;(info.results || []).forEach(function (x) { raw[(Number(x.libraryID) || 1) + ":" + x.key] = x })
  var id = function (r) { return r.libraryID + ":" + r.key }
  var order = []
  var keyed = papers.map(function (r, i) {
    var x = raw[id(r)] || {}
    var group, rank, sortKey = ""
    if (mode === "status") {
      var st = r.status && r.status !== "\u0000" ? r.status : ""
      var k = -1
      for (var a = 0; a < (info.statuses || []).length; a++) if (info.statuses[a].toLowerCase() === st.toLowerCase()) k = a
      group = k >= 0 ? "Status · " + String(info.statuses[k]).replace(/^s\//i, "") : "No status"
      rank = k >= 0 ? k : 1e6
    } else if (mode === "task" || mode === "taskgroup") {
      var t = (info.tasks || {})[id(r)]
      if (!t) { group = "No task"; rank = 1e6 }
      else if (mode === "task") {
        var ti = -1
        for (var b = 0; b < (info.taskStatuses || []).length; b++) if (info.taskStatuses[b].id === t.id) ti = b
        group = "Task · " + t.name
        rank = ti >= 0 ? ti : 1e5
      } else {
        var gi = -1
        for (var c = 0; c < (info.groups || []).length; c++) if (info.groups[c][0] === t.group) gi = c
        group = gi >= 0 ? info.groups[gi][1] : t.group
        rank = gi >= 0 ? gi : 1e5
      }
    } else if (mode === "added" || mode === "modified") {
      sortKey = String((mode === "added" ? x.dateAdded : x.dateModified) || "")
      group = monthOf(sortKey) || "No date"
      rank = 0
    } else if (mode.indexOf("tax:") === 0) {
      // a taxonomy's tags (facets on the bridge's rows): its labels in their order, none last
      var prefix = mode.slice(4)
      var tx = (info.taxonomies || []).filter(function (t) { return t.prefix === prefix })[0]
      var labels = tx ? tx.labels : []
      var mine = (x.facets || []).filter(function (f) { return String(f).toLowerCase().indexOf(prefix.toLowerCase()) === 0 }).map(function (f) { return String(f).slice(prefix.length) })
      var best = -1
      mine.forEach(function (l) {
        var li = -1
        for (var q = 0; q < labels.length; q++) if (String(labels[q]).toLowerCase() === l.toLowerCase()) li = q
        if (li < 0) li = labels.length // a label not (or no longer) in the file
        if (best < 0 || li < best) { best = li; group = l }
      })
      if (best < 0) { group = "No " + (tx ? String(tx.name).toLowerCase() : prefix.slice(0, -1)); rank = 1e6 } else rank = best
    } else if (mode === "year") {
      var y = Number(x.year) || 0
      sortKey = y ? String(y) : ""
      group = y ? String(y) : "No year"
      rank = 0
    }
    return { r: r, i: i, group: group, rank: rank, sortKey: sortKey }
  })
  keyed.sort(function (p, q) {
    if (p.rank !== q.rank) return p.rank - q.rank
    if (p.sortKey !== q.sortKey) return p.sortKey < q.sortKey ? 1 : -1 // newest first; none last
    return p.i - q.i // relevance within a group
  })
  var grouped = keyed.map(function (e) { return Object.assign({}, e.r, { section: e.group }) })
  // in place of the papers, where they were
  var out = []
  var placed = false
  rows.forEach(function (r) {
    if (!isPaper(r)) return out.push(r)
    if (!placed) { out = out.concat(grouped); placed = true }
  })
  return out
}

// ---------------------------------------------------------------- a paper's notes, under it

// The results with the notes of each paper you opened (Space) right under it: rows of kind
// "note-child", indented; Enter reads one. expanded: { "libraryID:key": [notes] }.
function withNoteRows(rows, expanded) {
  if (!expanded) return rows
  var out = []
  rows.forEach(function (r) {
    out.push(r)
    var notes = r.kind === "item" ? expanded[r.libraryID + ":" + r.key] : null
    if (!notes) return
    notes.forEach(function (n) {
      var title = String(n.title || "Untitled note")
      var when = String(n.dateModified || "").slice(0, 10)
      out.push({ section: r.section, kind: "note-child", key: String(n.key), libraryID: Number(n.libraryID) || 1, itemType: "note",
        icon: iconFor("note"), title: title, titleHtml: escapeHtml(title), subtitle: [when, String(n.excerpt || "")].filter(function (x) { return x }).join(" · "),
        openState: "", pdfCount: 0, noteCount: 0, tagsText: "", ranks: "", status: "" })
    })
  })
  return out
}

// ---------------------------------------------------------------- a model's Markdown, made safe

// A model's answer, safe to show: nothing in it loads by itself (the same rule as the runner's
// daemon/lib/safe-markdown.mjs, which keeps the notes it writes safe). No Markdown parsing, which
// could disagree with the renderer: a zero-width space between "!" and "[", and after a "<" that
// would open a tag, so no image and no tag can form anywhere; links still work (on click).
function safeMarkdown(text) {
  return String(text == null ? "" : text).replace(/!\[/g, "!\u200b[").replace(/<(?=[A-Za-z!?\/])/g, "<\u200b")
}

// ---------------------------------------------------------------- Keybindings (?)

// [section, keys, what they do]: the launcher's keys, as the footer and README name them.
var KEYBINDINGS = [
  ["Everywhere", "Super+Shift+Z", "Open or close the launcher (your Hyprland keybinding)"],
  ["Everywhere", "?  F1", "These keybindings, the ones for where you are first (F1 also while you type, and in the note and chat windows)"],
  ["Everywhere", "Esc", "Leave the search box; then clear it; then back a level; at the top, close"],
  ["Everywhere", "Shift+Esc", "Straight back to the results; there, clear the search (it never closes)"],
  ["Everywhere", "W", "The launcher as a window, and back as the overlay"],
  ["Everywhere", "Alt+key", "With Settings › General › How keys act › Alt+key: the same keys, with Alt (Alt+1 … 9 too); typing always searches"],
  ["Everywhere", "Super+W", "Close the launcher when it's open (with the README's rebinding)"],
  ["The search box", "type", "Search (in a list: filter it)"],
  ["The search box", "↑ ↓  PgUp PgDn", "Move"],
  ["The search box", "Enter", "The highlighted row's main action"],
  ["The search box", "Alt+Backspace", "Clear the search box"],
  ["The search box", "@", "Add a filter: tag, author, title, abstract, year, status, task…, or an operator"],
  ["The search box", "Ctrl+S", "Save the search"],
  ["The search box", "Tab  Shift+Tab", "Next / previous pinned search (the badges on top)"],
  ["The search box", "Ctrl+V", "Paste (where you type a name, a key, a value)"],
  ["One key (the list has the keys)", "/", "Back to the search box (Tab too, without pinned searches)"],
  ["One key (the list has the keys)", "↑ ↓  j k  PgUp PgDn", "Move"],
  ["One key (the list has the keys)", "1 … 9", "The row with that number"],
  ["One key (the list has the keys)", "Enter  →", "Open: a paper's menu, a collection, a tag, a note"],
  ["One key (the list has the keys)", "Backspace  ←", "Back a level"],
  ["One key (the list has the keys)", "Shift+Enter  z", "Open it in Zotero"],
  ["One key (the list has the keys)", "c", "Chat about the paper; elsewhere, your chats"],
  ["One key (the list has the keys)", "t  a", "Your tasks / a new task"],
  ["One key (the list has the keys)", ".", "Processes: prompt runs, text extractions, taxonomy tagging, syncs"],
  ["One key (the list has the keys)", "f  s", "Your saved searches / save this one"],
  ["One key (the list has the keys)", ";", "Settings"],
  ["One key (the list has the keys)", "S", "Sync Zotero (Zotero's own sync; its progress in Processes)"],
  ["One key (the list has the keys)", "Ctrl+Shift+↑ ↓", "Move the highlighted row's section up or down (each menu keeps your order)"],
  ["One key (the list has the keys)", "g  G", "Group or sort the papers: by paper status, task status or group, a taxonomy, date added, changed, published; relevance"],
  ["Papers", "Space", "Show or hide its notes under it (Enter reads one; Space or ← on one hides them)"],
  ["Papers", "Alt+→  Alt+←", "Next / previous status (saved to Zotero a second later)"],
  ["Papers", "Shift+Alt+→  Shift+Alt+←", "Its default task: made on the first press, then the next / previous task status"],
  ["Papers", "o  w", "Its PDF in your PDF app / in its own Zotero window"],
  ["Papers", "n  #  x", "Its notes / its tags / extract its text (on Text extracted: its menu)"],
  ["Papers", "p  l", "Pin or unpin it / show it in your library"],
  ["Papers", "i  r", "Copy its citation / its bibliography entry, in your citation style (Settings › General)"],
  ["Papers", "Shift+↑ ↓", "Move a pinned paper, collection or tag (before you type)"],
  ["A paper's menu", "Enter  →", "Run the highlighted row (Tag by taxonomies, a prompt, Copy citation…); its taxonomy labels are the pills under its status (a click: their papers)"],
  ["A paper's menu", "p", "Pin the highlighted row to the menu's Pinned section, on top (again: unpin it); on every paper's menu"],
  ["A paper's menu", "P (Shift+p)", "Move the highlighted row into Other, at the bottom of every paper's menu (again: back in its section)"],
  ["A paper's menu", "Shift+↑ ↓", "Move the highlighted row within its section (a note: among its notes; a pinned row: among the pins)"],
  ["A paper's menu", "Shift+Enter", "On a chat, an artifact or the extracted text: its menu; elsewhere: Zotero"],
  ["A paper's menu", "a", "A new task about the paper (and the note or chat highlighted)"],
  ["Notes", "Enter", "Read it"],
  ["Notes", "w", "In its own window"],
  ["Notes", "y  s", "Copy it as Markdown / save it as a .md file"],
  ["Notes", "Shift+↑ ↓", "Move it (in a paper's menu and its notes)"],
  ["Reading a note", "j k  ↑ ↓", "Scroll"],
  ["Reading a note", "Space PgDn  b PgUp", "A page down / up"],
  ["Reading a note", "g  G  Home End", "The top / the end"],
  ["Reading a note", "Shift+↑ ↓", "The paper's previous / next note"],
  ["Reading a note", "Backspace  ←  h", "Back"],
  ["Reading a note", "t  a", "A new task about the note"],
  ["Reading a note", "i  r", "Copy its paper's citation / bibliography entry"],
  ["Reading a note", "Alt+→  Alt+←", "Its paper's next / previous status (the note window too)"],
  ["Reading a note", "Shift+Alt+→  Shift+Alt+←", "Its paper's default task (the note window too)"],
  ["Reading a note", "Alt+P", "Pin or unpin its paper"],
  ["Reading a note", "Ctrl+-  Ctrl++  Ctrl+0", "Smaller / larger / the theme's text size (the note window too)"],
  ["Reading a note", "m (note window)", "Back to the launcher, on the paper's menu"],
  ["Tags", "type, Enter", "Find a tag / add or remove it"],
  ["Tags", "Ctrl+Enter", "Create exactly what you typed"],
  ["Tags", "Shift+Enter", "On a tag: rename it, delete it, or make it a paper or task status, on every paper"],
  ["Tasks", "type, Enter", "Add a task (#status !priority @due) and open it"],
  ["Tasks", "Shift+Enter", "Just add it, as it is"],
  ["Tasks", "@ (a new task's line)", "Add a block: an action, the citation, a status, a due date, a priority"],
  ["Tasks", "Tab  Shift+Tab", "Next / previous status"],
  ["Tasks", "d  !", "Done (again: back) / priority"],
  ["Tasks", "Delete  u", "Delete it / bring it back"],
  ["Tasks", "Shift+↑ ↓", "Move it within its status, then into the next"],
  ["A task's page", "type", "Edit the description or the notes, on their row"],
  ["A task's page", "Enter", "Keep it and go back (in the notes: a new line)"],
  ["A task's page", "Ctrl+Enter", "Keep the notes and go back"],
  ["A task's page", "Tab  Shift+Tab", "Status or priority, on its row"],
  ["A task's page", "← → ↑ ↓", "The due date's calendar: a day, a week"],
  ["A task's page", "PgUp PgDn  Home  Delete", "The calendar: a month / today / no date"],
  ["Saved searches", "Enter  Shift+Enter", "Open it / its menu: pin, rename, edit, delete"],
  ["Saved searches", "p", "Pin or unpin it (a badge above the results)"],
  ["Saved searches", "Shift+↑ ↓", "Move it"],
  ["Prompts", "Enter  e", "Run it / edit it"],
  ["Settings", "Enter", "Change, choose, open or test the highlighted row"],
  ["Settings", "Shift+↑ ↓", "Move a paper status, a task status or a taxonomy's label (Settings › Paper status, Tasks, Taxonomies › one)"],
  ["Settings", "Delete", "Dismiss a suggestion (Settings › Taxonomies › Review)"],
  ["Chats", "Enter  Shift+Enter", "Continue it / rename or delete it"],
  ["Chats", "Enter  Shift+Enter (chat window)", "Send / a new line"],
  ["Chats", "Esc (chat window)", "Stop the answer, or close a menu"],
  ["Chats", "Alt+M (chat window)", "Back to the launcher, on the paper's menu"]
]

// The keys for where you are (? or F1: the Keybindings' first section, "Here"), by view.
var VIEW_KEYS = {
  results: [
    ["Enter  →", "The highlighted row: a paper's menu, into a collection or a tag, a Go to entry"],
    ["Shift+Enter  z", "Open it in Zotero"],
    ["Space", "Show or hide a paper's notes under it"],
    ["o  w", "Its PDF in your PDF app / in a Zotero window"],
    ["n  #  x", "Its notes / its tags / extract its text"],
    ["p  l", "Pin or unpin it / show it in your library"],
    ["i  r", "Copy its citation / bibliography entry"],
    ["Alt+→  Alt+←", "Its next / previous status"],
    ["Shift+Alt+→  Shift+Alt+←", "Its default task's next / previous status"],
    ["g  G", "Group or sort the papers / back a step"],
    ["s  Ctrl+S", "Save the search"],
    ["@", "Add a filter or an operator to the search"],
    ["Tab  Shift+Tab", "Next / previous pinned search (the badges)"],
    ["Shift+↑ ↓", "Move a pinned item (before you type)"],
    ["Ctrl+Shift+↑ ↓", "Move the highlighted row's section"],
    ["1 … 9", "The row with that number"],
    ["/  Alt+Backspace", "The search box / clear it"],
    ["c  t  a  .", "Chat about it / your tasks / a new task / Processes"],
    ["f  S  ;  W", "Saved searches / sync Zotero / Settings / as a window"],
    ["Esc", "Leave the search box; clear it; close"]
  ],
  scope: [
    ["type", "Search in it"],
    ["Enter  →", "A paper's menu"],
    ["Shift+Enter  z", "Open it in Zotero"],
    ["o  w  n  #  x", "Its PDF (your app, a Zotero window) / notes / tags / extract its text"],
    ["p  l  i  r", "Pin it / show it in your library / copy its citation, bibliography entry"],
    ["Alt+→  Alt+←", "Its next / previous status"],
    ["Shift+Alt+→  Shift+Alt+←", "Its default task"],
    ["g  G", "Group or sort the papers"],
    ["s", "Save this search"],
    ["Backspace  Esc", "Back"]
  ],
  pick: [
    ["type", "Find the paper"],
    ["Enter", "Chat about it"],
    ["Esc", "Back"]
  ],
  actions: [
    ["Enter  →", "Run the highlighted row"],
    ["p", "Pin the highlighted row to Pinned, on top of every paper's menu (again: unpin)"],
    ["P (Shift+p)", "Move the highlighted row out of the way, into Other at the bottom (again: back in its section)"],
    ["Shift+↑ ↓", "Move the highlighted row within its section"],
    ["Ctrl+Shift+↑ ↓", "Move its section up or down"],
    ["Shift+Enter", "On a chat, an artifact, the extracted text: its menu; elsewhere: Zotero"],
    ["z", "Open it in Zotero"],
    ["o  w", "Its PDF in your app / in a Zotero window (on a note: the note's window)"],
    ["n  #  x", "Its notes / its tags / extract its text"],
    ["i  r", "Copy its citation / bibliography entry"],
    ["c  a", "Chat about it / a new task about it"],
    ["l", "Show it in your library"],
    ["y  s", "On a note: copy it / save it as .md"],
    ["Tab  d  !  Delete  u", "On a task: status / done / priority / delete / undo"],
    ["Alt+→  Alt+←", "Its next / previous status"],
    ["Shift+Alt+→  Shift+Alt+←", "Its default task"],
    ["1 … 9  /", "A row by its number / filter the menu"],
    ["Backspace  ←  Esc", "Back to the results"]
  ],
  notes: [
    ["Enter", "Read it"],
    ["Shift+↑ ↓", "Move it (kept for this paper)"],
    ["w", "In its own window"],
    ["y  s", "Copy it as Markdown / save it as .md"],
    ["Shift+Enter  z", "Open it in Zotero"],
    ["Backspace  Esc", "Back"]
  ],
  note: [
    ["j k  ↑ ↓", "Scroll"],
    ["Space PgDn  b PgUp", "A page down / up"],
    ["g  G  Home End", "The top / the end"],
    ["Shift+↑ ↓", "The paper's previous / next note"],
    ["y  s", "Copy it as Markdown / save it as .md"],
    ["w", "In its own window"],
    ["z  Shift+Enter", "Open it in Zotero"],
    ["c", "Chat about its paper"],
    ["t  a", "A new task about it"],
    ["i  r", "Copy its paper's citation / bibliography entry"],
    ["Alt+→  Alt+←", "Its paper's status"],
    ["Shift+Alt+→  Shift+Alt+←", "Its paper's default task"],
    ["Alt+P", "Pin or unpin its paper"],
    ["Ctrl+-  Ctrl++  Ctrl+0", "Text size"],
    ["Backspace  ←  h", "Back"]
  ],
  tags: [
    ["type", "Find a tag, or name a new one"],
    ["Enter", "Add it to the paper, or remove it"],
    ["Ctrl+Enter", "Create exactly what you typed"],
    ["Shift+Enter", "Its menu: rename, delete everywhere, make it a status"],
    ["Esc", "Clear; then back"]
  ],
  picker: [
    ["type", "Find a filter"],
    ["Enter", "Its values (a tag, an author…), or add the operator"],
    ["1 … 9", "The row with that number"],
    ["Esc", "Back to the search"]
  ],
  todos: [
    ["type, Enter", "Add a task (#status !priority @due) and open it; or find one"],
    ["Shift+Enter", "Just add it"],
    ["Enter", "Open the highlighted task"],
    ["Tab  Shift+Tab", "Its next / previous status"],
    ["d  !", "Done / priority"],
    ["Delete  u", "Delete it / bring it back"],
    ["Shift+↑ ↓", "Move it"],
    ["Backspace  Esc", "Back"]
  ],
  task: [
    ["type", "Edit the description or the notes, on their row"],
    ["Enter", "Keep it and go back (the notes: a new line)"],
    ["Ctrl+Enter", "Keep the notes and go back"],
    ["Tab  Shift+Tab", "Status or priority, on its row"],
    ["d  Delete", "Done / delete it"],
    ["Esc", "Back"]
  ],
  calendar: [
    ["← → ↑ ↓", "A day / a week"],
    ["PgUp PgDn", "A month"],
    ["Home  Delete", "Today / no date"],
    ["type, Enter", "A date (fri, tomorrow, +3d, 2026-10-03), or the highlighted day"],
    ["Esc", "Back"]
  ],
  "todo-new": [
    ["type", "What to do (#status !priority @due)"],
    ["@", "Add a block: an action, the citation, a status, a due date, a priority"],
    ["Enter  Shift+Enter", "Add it and open it / just add it"],
    ["Esc", "Clear; then back"]
  ],
  prompts: [
    ["Enter", "Run it on the paper"],
    ["e", "Edit it"],
    ["type", "Find one"],
    ["Backspace  Esc", "Back"]
  ],
  settings: [
    ["Enter", "Change, choose, open or test the highlighted row"],
    ["Shift+↑ ↓", "Move a status (Paper status, Tasks) or a taxonomy's label"],
    ["Delete", "Dismiss a suggestion (Taxonomies › Review)"],
    ["1 … 9  /", "A row by its number / find a setting"],
    ["Backspace  Esc", "Back"]
  ],
  processes: [
    ["Enter", "Open what it made (a note: read it), or run it again"],
    ["w  y  s", "On a note: its window / copy / save"],
    ["Backspace  Esc", "Back"]
  ],
  chats: [
    ["Enter", "Continue it in its window"],
    ["type", "Find one"],
    ["Backspace  Esc", "Back"]
  ],
  searches: [
    ["Enter", "Open it"],
    ["Shift+Enter", "Its menu: pin, rename, edit, delete"],
    ["p", "Pin or unpin it (a badge above the results)"],
    ["Shift+↑ ↓", "Move it"],
    ["Backspace  Esc", "Back"]
  ],
  menu: [
    ["Enter", "Choose the highlighted row"],
    ["1 … 9", "The row with that number"],
    ["Backspace  Esc", "Back"]
  ],
  typing: [
    ["type", "The name, the value or the text asked for"],
    ["Enter", "Save it"],
    ["Ctrl+V", "Paste"],
    ["Esc", "Clear; then back"]
  ],
  "tax-paper": [
    ["Enter", "The papers with the highlighted label; Audit the taxonomies; Tag again"],
    ["type", "Find a label"],
    ["Backspace  Esc", "Back to the paper's menu"]
  ],
  "tax-audit": [
    ["Enter", "Cycle the highlighted label: auto (the classifier decides) → on, by you → off, by you → auto; on Tag again, a new pass"],
    ["type", "Find a label"],
    ["Backspace  Esc", "Back to the paper's menu"]
  ],
  "note-window": [
    ["j k  ↑ ↓", "Scroll"],
    ["Space PgDn  b PgUp", "A page down / up"],
    ["g  G  Home End", "The top / the end"],
    ["m", "Back to the launcher, on the paper's menu"],
    ["z  Shift+Enter", "Open it in Zotero"],
    ["c", "Chat about its paper"],
    ["y  s", "Copy it as Markdown / save it as .md"],
    ["Alt+→  Alt+←", "Its paper's status"],
    ["Shift+Alt+→  Shift+Alt+←", "Its paper's default task"],
    ["Ctrl+-  Ctrl++  Ctrl+0", "Text size"],
    ["Ctrl+C", "Copy the selected text"],
    ["?  F1  Esc", "Show or hide these keys"]
  ],
  "chat-window": [
    ["Enter", "Send your question"],
    ["Shift+Enter", "A new line"],
    ["Esc", "Stop the answer, or close a menu"],
    ["Alt+M", "Back to the launcher, on the paper's menu"],
    ["F1  Esc", "Show or hide these keys"]
  ]
}

var VIEW_TITLES = { results: "the results", scope: "a collection, a tag or a saved search", pick: "picking a paper", actions: "a paper's menu", notes: "a paper's notes", note: "reading a note",
  tags: "the tag editor", picker: "the @ picker", todos: "your tasks", task: "a task's page", calendar: "the due date", "todo-new": "a new task", prompts: "prompts", settings: "Settings",
  processes: "Processes", chats: "chats", "tax-audit": "the taxonomies' audit", "tax-paper": "the paper's taxonomies", searches: "saved searches", menu: "this menu", typing: "typing a name or a value", "note-window": "the note window", "chat-window": "the chat window" }

// Where you are, for the keys: view (the launcher's), ctx { scope, pickFor, inSettings, textEntry }. → { group, title }
function keysContext(view, ctx) {
  ctx = ctx || {}
  var g = view === "search" ? (ctx.pickFor ? "pick" : ctx.scope ? "scope" : "results")
    : view === "actions" || view === "notes" || view === "note" || view === "tags" || view === "prompts" || view === "chats" || view === "searches" || view === "todos" ? view
    : view === "picker" || view === "picker-values" ? "picker"
    : view === "todo-edit" || view === "todo-status" || view === "todo-priority" ? "task"
    : view === "todo-due" ? "calendar"
    : view === "todo-new" ? "todo-new"
    : view === "tasks" ? "processes"
    : ctx.inSettings && view !== "settings-edit" ? "settings"
    : ctx.textEntry ? "typing"
    : VIEW_KEYS[view] ? view : "menu"
  return { group: g, title: VIEW_TITLES[g] || "here" }
}

// A key as the Alt-key mode writes it: the letters and . ; # take Alt ("o  w" → "Alt+O  Alt+W").
function altKeys(keys) {
  return String(keys).split("  ").map(function (part) {
    return part.split(" ").map(function (k) { return /^[a-zA-Z.;#!]$/.test(k) ? "Alt+" + (k.length === 1 && /[a-z]/.test(k) ? k.toUpperCase() : k) : k }).join(" ")
  }).join("  ")
}

// The Keybindings view: first "Here · <where you are>" (here: keysContext's, with alt: the Alt-key mode),
// then a section per heading, the keys on the right; typing finds them by any word of the keys, what they do
// or the section.
function buildKeyRows(query, here) {
  var words = String(query || "").toLowerCase().split(/\s+/).filter(function (w) { return w })
  var match = function (section, keys, what) {
    var hay = (section + " " + keys + " " + what).toLowerCase()
    return words.every(function (w) { return hay.indexOf(w) >= 0 })
  }
  var rows = []
  var mine = here && VIEW_KEYS[here.group]
  if (mine) {
    var section = "Here · " + (here.title || VIEW_TITLES[here.group] || "")
    mine.forEach(function (k) {
      var keys = here.alt && here.group !== "note-window" && here.group !== "chat-window" ? altKeys(k[0]) : k[0]
      if (match(section, keys, k[1])) rows.push(listRow({ section: section, rowId: "key-info", icon: KEYS_ICON, label: k[1], trailing: keys, available: true }))
    })
  }
  KEYBINDINGS.forEach(function (k) {
    if (match(k[0], k[1], k[2])) rows.push(listRow({ section: k[0], rowId: "key-info", icon: KEYS_ICON, label: k[2], trailing: k[1], available: true }))
  })
  return rows
}

// ---------------------------------------------------------------- the @ picker

var PICKER_FIELDS = [
  { field: "title", insert: "t:\"\"", icon: "\uf031", label: "Title", detail: "t:\"…\": type the words, as a phrase" },
  { field: "titleabstract", insert: "ta:\"\"", icon: "\uf0f6", label: "Title and abstract", detail: "ta:\"…\": type the words, as a phrase (ab:\"…\" the abstract only)" },
  { field: "tag", icon: TAG_ICON, label: "Tags", detail: "#tag" },
  { field: "author", icon: "", label: "Authors", detail: "a:author" },
  { field: "publication", icon: "", label: "Publications", detail: "p:journal" },
  { field: "year", icon: "", label: "Years", detail: "y:2020 (or type y:>=2020, y:<2020, y:2019..2021)" },
  { field: "collection", icon: COLLECTION_ICON, label: "Collections", detail: "c:collection, its subcollections too" },
  { field: "type", icon: "", label: "Item types", detail: "type:book" },
  { field: "status", icon: "\uf461", label: "Paper status", detail: "status:reading  status:none" },
  { field: "task", icon: "\uf4a0", label: "Tasks", detail: "has:task  task:waiting (a status, or its group)" },
  { field: "has", icon: "", label: "Has (or not): a PDF, notes, a task, a chat, a collection", detail: "has:notes  !has:notes  has:chat  has:collection" },
  { field: "added", icon: "\uf073", label: "Added", detail: "added:7d (the last 7 days)  added:>2026-01-01  added:<2026  added:2026-01..2026-03" },
  { field: "modified", icon: "\uf073", label: "Modified", detail: "modified:30d  modified:>2026-09-01  (when it was last changed)" },
  { field: "recent", icon: "\uf073", label: "Recent: added or modified", detail: "recent:7d  (the newer of the two)" },
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
  ["ta:", "In the title or the abstract: ta:resilience", "Syntax"],
  ["ab:", "In the abstract only: ab:resilience", "Syntax"],
  ["a:", "By an author: a:smith", "Syntax"],
  ["y:", "A year, a range or compared: y:2020, y:2019..2021, y:>=2020, y:<2010", "Syntax"],
  ["p:", "In a publication: p:management", "Syntax"],
  ["#", "With a tag: #risk", "Syntax"],
  ["c:", "In a collection, subcollections too: c:scm", "Syntax"],
  ["type:", "An item type: type:book", "Syntax"],
  ["has:", "Has something: has:pdf, has:notes, has:files, has:task, has:chat, has:collection (!has: hasn't)", "Syntax"],
  ["status:", "A paper status: status:reading, status:none", "Syntax"],
  ["task:", "A task with a status (or group): task:waiting, task:active", "Syntax"],
  ["added:", "When it was added: added:7d, added:>2026-01-01, added:2026-01..2026-03", "Syntax"],
  ["modified:", "When it was last changed: modified:30d, modified:<2026", "Syntax"],
  ["recent:", "Added or changed (the newer): recent:7d", "Syntax"],
  ["'", "An exact match, not fuzzy: 'resil", "Syntax"],
  ["^", "Starts with: ^supply", "Syntax"],
  ["$", "Ends with (after the word): chain$", "Syntax"]
]

function pickerFieldLabel(field, taxonomies) {
  for (var i = 0; i < PICKER_FIELDS.length; i++) if (PICKER_FIELDS[i].field === field) return PICKER_FIELDS[i].label
  var t = taxonomyOfField(field, taxonomies)
  return t ? t.name : field
}

// A taxonomy as a filter in the @ picker: its field is "tax:<id>"; its values are its labels (as tags), with how
// many papers have each (tagCounts: { tag (lowercase): count }, from the bridge's tag facets).
function taxonomyOfField(field, taxonomies) {
  var m = /^tax:(.+)$/.exec(String(field || ""))
  return m ? (taxonomies || []).filter(function (t) { return t.id === m[1] })[0] || null : null
}

function taxonomyValues(t, tagCounts) {
  if (!t) return []
  return (t.labels || []).map(function (l) {
    var tag = t.prefix + l
    return { value: l, label: l, count: (tagCounts || {})[tag.toLowerCase()] || 0, token: '#"' + tag.replace(/"/g, "") + '"', detail: "" }
  })
}

// @: what to add to the search. Its filters (Saved searches only when you have some), the
// operators, then the rest of the syntax. Typing finds one by its label or what it does.
function buildPickerRows(query, hasSearches, taxonomies) {
  var rows = PICKER_FIELDS.filter(function (f) { return f.field !== "search" || hasSearches }).map(function (f) {
    // a text field: Enter puts its prefix in the search, and you type the words
    if (f.insert) return listRow({ section: "Add a filter", rowId: "pick-op", icon: f.icon, label: f.label, detail: f.detail, available: true, value: f.insert })
    return listRow({ section: "Add a filter", rowId: "pick-field", icon: f.icon, label: f.label, detail: f.detail, available: true, submenu: true, value: f.field })
  })
  // each taxonomy: its labels, as tags (#"type/case study")
  ;(taxonomies || []).forEach(function (t) {
    rows.push(listRow({ section: "Taxonomies", rowId: "pick-field", icon: "\uf02c", label: t.name, available: true, submenu: true, value: "tax:" + t.id,
      detail: "#" + t.prefix + "… · " + (t.labels || []).length + " labels · " + (t.kind === "one" ? "unique: one per paper" : "several per paper") }))
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

// A date field's values in the picker (added, modified, recent): the usual spans, then After, Before and Between,
// which put the field in the search for you to type the date. year: this year (2026).
var DATE_FIELDS = { added: true, modified: true, recent: true }
function buildDateValueRows(field, year, query) {
  var spans = [["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["3m", "Last 3 months"], ["1y", "Last 12 months"], [String(year), "This year (" + year + ")"], [String(year - 1), "Last year (" + (year - 1) + ")"]]
  var rows = spans.map(function (x) {
    return listRow({ section: "When", rowId: "pick-value", icon: "\uf073", label: x[1], detail: field + ":" + x[0], available: true, value: field + ":" + x[0] })
  })
  ;[[">", "After a date…", "then type it: 2026-05-01, 2026-05 or 2026"], ["<", "Before a date…", "then type it"], ["", "Between two dates…", "then type them: 2026-01-01..2026-03-31 (or 2026-01..2026-03)"]].forEach(function (x) {
    rows.push(listRow({ section: "A date of your own", rowId: "pick-op", icon: "\uf044", label: x[1], detail: field + ":" + x[0] + "… " + x[2], available: true, value: field + ":" + x[0] }))
  })
  return filterRows(rows, query)
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
  if (/^[a-z]+:[<>=]?$|^[#!'^]$/.test(t)) return { text: before + lead + t + after, caret: caret + lead.length + t.length, live: false }
  // a text field's prefix with its quotes (t:""): the caret between them, for the words
  if (/^[a-z]+:""$/.test(t)) return { text: before + lead + t + after, caret: caret + lead.length + t.length - 1, live: false }
  var trail = next && /[\s)]/.test(next) ? "" : " "
  return { text: before + lead + t + trail + after, caret: caret + lead.length + t.length + trail.length, live: false }
}

if (typeof module !== "undefined") {
  module.exports = {
    safeMarkdown: safeMarkdown, groupings: groupings, contextLabel: contextLabel, typeHint: typeHint, scopeCount: scopeCount, GROUPINGS: GROUPINGS, groupingName: groupingName, nextGrouping: nextGrouping, groupRows: groupRows, monthOf: monthOf, syncDetail: syncDetail, syncFooter: syncFooter, pinnedFirst: pinnedFirst, withNoteRows: withNoteRows, KEYBINDINGS: KEYBINDINGS, VIEW_KEYS: VIEW_KEYS, keysContext: keysContext, altKeys: altKeys, buildKeyRows: buildKeyRows, rowIdentity: rowIdentity, orderRows: orderRows, pinRows: pinRows, moveIdentity: moveIdentity, toggleIdentity: toggleIdentity, SECTION_MENU_PINNED: SECTION_MENU_PINNED, SECTION_MENU_OTHER: SECTION_MENU_OTHER, otherRows: otherRows, pillPalette: pillPalette, hintParts: hintParts, fitHints: fitHints, colorDistance: colorDistance, contrast: contrast, paperTaxonomies: paperTaxonomies, uniqueLabelClash: uniqueLabelClash, taxonomyStrip: taxonomyStrip, classifyRow: classifyRow, buildTaxonomyAudit: buildTaxonomyAudit, buildPaperTaxonomies: buildPaperTaxonomies, paperFooter: paperFooter, COMMANDS: COMMANDS,
    ICONS: ICONS, iconFor: iconFor, escapeHtml: escapeHtml, highlight: highlight, subtitle: subtitle, openState: openState,
    thousands: thousands, toRow: toRow, rankLabels: rankLabels, rankShort: rankShort, statusFromTags: statusFromTags, noteHtml: noteHtml, splitNoteTitle: splitNoteTitle, paperCite: paperCite, chatTitle: chatTitle, rankIsTop: rankIsTop, buildRows: buildRows, countText: countText, selectionAfter: selectionAfter,
    SECTION_PINNED: SECTION_PINNED, SECTION_COLLECTIONS: SECTION_COLLECTIONS, SECTION_PAPERS: SECTION_PAPERS, SECTION_OPEN: SECTION_OPEN, SECTION_RECENT: SECTION_RECENT, SECTION_RECENT_MODIFIED: SECTION_RECENT_MODIFIED, SECTION_RECENT_LATEST: SECTION_RECENT_LATEST, tagsText: tagsText,
    fileKind: fileKind, usableFiles: usableFiles, buildActions: buildActions, citeRows: citeRows, buildFileRows: buildFileRows, filterRows: filterRows,
    listRow: listRow, taskSummary: taskSummary, buildTaskRows: buildTaskRows, buildChatRows: buildChatRows, workspaceRows: workspaceRows, ago: ago, chatRow: chatRow, extractRow: extractRow, buildExtractMenu: buildExtractMenu, ownNotes: ownNotes, fulltextNote: fulltextNote, pinRow: pinRow, parsePins: parsePins, isPinned: isPinned, togglePin: togglePin, movePin: movePin, orderNotes: orderNotes, hasPdf: hasPdf, orderSections: orderSections, moveSection: moveSection, sectionGroups: sectionGroups, promptsRow: promptsRow, buildPromptRows: buildPromptRows, buildPromptEditor: buildPromptEditor, buildPromptModels: buildPromptModels, buildPromptEfforts: buildPromptEfforts, buildTitleRows: buildTitleRows,
    effortFor: effortFor, modelLabel: modelLabel, commandRows: commandRows, settingRows: settingRows, settingMenuRows: settingMenuRows, setupResultRow: setupResultRow, findModel: findModel, setupRow: setupRow, runFacts: runFacts, shortDate: shortDate, rangesFrom: rangesFrom, buildNoteRows: buildNoteRows,
    tagSummary: tagSummary, tagMap: tagMap, buildTagRows: buildTagRows, isStatusTag: isStatusTag, statusTagRows: statusTagRows, buildTagStatusRows: buildTagStatusRows, tagCountText: tagCountText,
    artifactRow: artifactRow, artifactDetail: artifactDetail, buildArtifactMenu: buildArtifactMenu, buildArtifactChangeRows: buildArtifactChangeRows, buildPromptOutputs: buildPromptOutputs, OUTPUT_LABELS: OUTPUT_LABELS, SECTION_ARTIFACTS: SECTION_ARTIFACTS,
    parseSearches: parseSearches, newSearchId: newSearchId, addSearch: addSearch, findSearch: findSearch, updateSearch: updateSearch, removeSearch: removeSearch,
    moveSearch: moveSearch, pinnedSearches: pinnedSearches, nextSearch: nextSearch, searchScope: searchScope, scopeQuery: scopeQuery, combinedQuery: combinedQuery,
    buildSearchRows: buildSearchRows, searchMenuRows: searchMenuRows, buildSearchEditRows: buildSearchEditRows,
    parseThemeColors: parseThemeColors, querySegments: querySegments,
    buildPickerRows: buildPickerRows, buildPickerValueRows: buildPickerValueRows, savedSearchValues: savedSearchValues, editQuery: editQuery, insertAt: insertAt, pickerFieldLabel: pickerFieldLabel, buildDateValueRows: buildDateValueRows, DATE_FIELDS: DATE_FIELDS, dateText: dateText, taxonomyOfField: taxonomyOfField, taxonomyValues: taxonomyValues
  }
}
