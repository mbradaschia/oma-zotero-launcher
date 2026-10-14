// What Swift calls in the view logic, JSON in and JSON out: each wrapper takes plain values,
// supplies what JSON can't carry, and calls into the modules (globals here, as JSCore loads them;
// required in Node, for scripts/goldens.mjs). One wrapper per builder a phase needs.
var Glue = (function () {
  var V = typeof Views !== "undefined" ? Views : require("../../js/lib/Views.js")
  var C = typeof Client !== "undefined" ? Client : require("../../js/lib/Client.js")
  var T = typeof Todos !== "undefined" ? Todos : require("../../js/lib/Todos.js")
  var P = typeof Paths !== "undefined" ? Paths : require("../../../contracts/Paths.js")
  var F = typeof Fuzzy !== "undefined" ? Fuzzy : require("../../js/lib/Fuzzy.js")
  var S = typeof Settings !== "undefined" ? Settings : require("../../js/lib/Settings.js")
  var M = typeof Merge !== "undefined" ? Merge : require("../../../contracts/Merge.js")
  var lists = (typeof GlueLists !== "undefined" ? GlueLists : require("./GlueLists.js"))(V, C, T, P, F, S)
  var todos = (typeof GlueTodos !== "undefined" ? GlueTodos : require("./GlueTodos.js"))(V, C, T, M, F)
  var search = (typeof GlueSearch !== "undefined" ? GlueSearch : require("./GlueSearch.js"))(V, C, T, F)
  var runnerGlue = (typeof GlueRunner !== "undefined" ? GlueRunner : require("./GlueRunner.js"))(V, C, S, F)
  var settingsGlue = (typeof GlueSettings !== "undefined" ? GlueSettings : require("./GlueSettings.js"))(V, C, T, P, S)
  var Mk = typeof Marked !== "undefined" ? Marked : require("../../js/vendor/marked.umd.js")
  var chatGlue = (typeof GlueChat !== "undefined" ? GlueChat : require("./GlueChat.js"))(V, F, Mk)
  var taxGlue = (typeof GlueTaxonomies !== "undefined" ? GlueTaxonomies : require("./GlueTaxonomies.js"))(V, S)

  // Go to with only the places the Mac has (`have`: their kinds; a Settings row found by name
  // stays): the rest of the launcher's places come in later phases. With none left above the
  // papers, the papers lose their heading, as lib/Views.js's buildRows does.
  var onlyHave = function (rows, have, response) {
    var out = rows.filter(function (r) { return r.section !== "Go to" || r.kind === "setting" || have.indexOf(r.kind) >= 0 })
    var above = out.some(function (r) { return r.section === "Go to" || r.section === V.SECTION_COLLECTIONS || r.section === "Tags" })
    if (!above && !(response && response.scope)) out.forEach(function (r) { if (r.section === V.SECTION_PAPERS) r.section = "" })
    return out
  }

  var core = {
    resolvePaths: function (env, machineSettings, probe) { return P.resolve(env, machineSettings, probe) },

    // The settings in effect: the machine file and the shared one, combined and normalized
    // (Service.qml's applySettings). → { settings, problems }
    settings: function (machineRaw, sharedRaw) {
      var file = machineRaw === null && sharedRaw === null ? null : P.combineSettings(machineRaw, sharedRaw)
      return C.normalizeSettings(file)
    },
    // The same, the settings as JSON text (their keys in order: what the app passes back).
    settingsText: function (machineRaw, sharedRaw) { return JSON.stringify(core.settings(machineRaw, sharedRaw).settings) },

    // The /search body (Service.qml's _sendSearch). scope: { type, key, libraryID, title, query } or null.
    searchBody: function (query, scope, settings, pins, todos, chats, todoStatuses) {
      var q = String(query || "")
      var body = { query: q, limit: settings.maxResults, statusTags: C.statusTags(settings.paperStatuses), statusPrefix: C.PAPER_TAG_PREFIX,
        marks: C.searchMarks(todos || [], todoStatuses || [], chats || [], T.statusOfTodo) }
      if (scope && scope.type === "search") body.within = { id: scope.key, title: scope.title, query: scope.query }
      else if (scope && scope.type === "tag") body.tag = { name: scope.key, libraryID: scope.libraryID }
      else if (scope) body.collection = { key: scope.key, libraryID: scope.libraryID }
      else if (!q.trim()) {
        if (settings.emptyQuery) body.emptyQuery = settings.emptyQuery
        if ((pins || []).length) body.pinned = pins.map(function (p) { return { key: p.key, libraryID: p.libraryID, type: p.type } })
      }
      return body
    },

    // A /search answer's rows, matches highlighted in `color`.
    searchRows: function (response, color, extras) { return V.buildRows(response, color, extras || {}) },

    // The results as shown (ZoteroSearch.qml's rebuildSearch for what exists): the rows, your
    // section order, the papers grouped (g: { mode, info }), a paper's notes under it (Space).
    results: function (response, color, extras, sectionOrder, grouping, expanded) {
      var built = V.buildRows(response, color, extras || {})
      if (extras && extras.have) built = onlyHave(built, extras.have, response)
      var rows = V.orderSections(built, sectionOrder || null)
      var groupable = !!(response && (response.scope || String(response.query || "").trim()))
      if (grouping && groupable) rows = V.groupRows(rows, grouping.mode, Object.assign({ results: response.results, groups: T.GROUPS }, grouping.info || {}))
      return V.withNoteRows(rows, expanded || null)
    },
    nextGrouping: function (id, delta, taxonomies) { return V.nextGrouping(id, delta, taxonomies || []) },
    groupingName: function (id, taxonomies) { return V.groupingName(id, taxonomies || []) },

    // A paper's menu (Tab). `pinned`: whether it is pinned; `setup`: whether setup is unfinished.
    actions: function (details, viewerName, prompts, promptsProblem, pinned, setup, extras) {
      return V.buildActions(details, viewerName, prompts, promptsProblem, pinned, setup, extras || {})
    },

    // A paper's menu as shown (ZoteroSearch.qml:946-960): its rows in your order, your pins on top,
    // Other at the bottom, the filter, the section order. m: { details, viewerName, prompts,
    // promptsProblem, pinned, setup, extras, order, pins, others, sections, filter }.
    // → { ordered (before the pins and the filter: what Shift+↑↓ moves within), rows }
    menu: function (m) {
      var act = V.buildActions(m.details, m.viewerName || "", m.prompts === undefined ? null : m.prompts, m.promptsProblem || "", !!m.pinned, !!m.setup, m.extras || {})
      // the paper's tasks, after its notes and chats (ZoteroSearch.qml:950-955)
      if (m.todoRows && m.todoRows.length) {
        var at = -1
        for (var i = 0; i < act.length; i++) if (act[i].section === "Prompts and chat" || act[i].section === "This paper") { at = i; break }
        if (at < 0) at = act.length
        Array.prototype.splice.apply(act, [at, 0].concat(m.todoRows))
      }
      var ordered = V.orderRows(act, m.order || null)
      var rows = V.filterRows(V.otherRows(V.pinRows(ordered, m.pins || []), m.others || []), m.filter || "")
      return { ordered: ordered, rows: V.orderSections(rows, m.sections || null) }
    },

    orderRows: function (rows, order) { return V.orderRows(rows, order) },
    pinRows: function (rows, pins) { return V.pinRows(rows, pins) },
    otherRows: function (rows, others) { return V.otherRows(rows, others) },
    filterRows: function (rows, text) { return V.filterRows(rows, text) },
    orderSections: function (rows, order) { return V.orderSections(rows, order) },
    fileRows: function (details, purpose, filter) { return V.filterRows(V.buildFileRows(details, purpose), filter || "") },
    usableFiles: function (details, purpose) { return V.usableFiles(details, purpose) },
    selectionAfter: function (rows, previousKey, followTop) { return V.selectionAfter(rows, previousKey, followTop) },

    // The confirm view's two rows (ZoteroSearch.qml:4273). ask: { yes, no, detail, noDetail }.
    confirmRows: function (ask) {
      var a = ask || {}
      return [
        V.listRow({ rowId: "confirm-yes", icon: "", label: a.yes || "Yes", detail: a.detail || "", available: true }),
        V.listRow({ rowId: "confirm-no", icon: "", label: a.no || "No", detail: a.noDetail || "", available: true })
      ]
    },

    // pins.json and a menu's arrangement.
    parsePins: function (text) { return V.parsePins(text) },
    togglePin: function (pins, item) { return V.togglePin(pins || [], item) },
    isPinned: function (pins, item) { return V.isPinned(pins || [], item) },
    movePin: function (pins, item, other) { return V.movePin(pins || [], item, other) },
    toggleIdentity: function (list, id) { return V.toggleIdentity(list || [], id) },
    moveIdentity: function (list, id, other) { return V.moveIdentity(list || [], id, other) },
    moveSection: function (rows, name, delta) { return V.moveSection(rows, name, delta) },
    rowIdentity: function (row) { return V.rowIdentity(row) },

    // Text for the chrome.
    contextLabel: function (placeholder) { return V.contextLabel(placeholder) },
    typeHint: function (placeholder, textEntry) { return V.typeHint(placeholder, !!textEntry) },
    rankLabels: function (rank) { return V.rankLabels(rank) },
    paperFooter: function (p) { return V.paperFooter(p || {}) },
    statusName: function (tag) { return C.statusName(tag) },
    countText: function (response, total) { return V.countText(response, total) },
    citationStyle: function (settings) { return C.citationStyle(settings) },
    shortDate: function (iso) { return V.shortDate(iso) },
    // The Tasks view's count: "3 open · 12 tasks".
    todoCount: function (todos, settings) {
      var all = todos || [], sts = T.statusesOf(settings)
      var open = all.filter(function (t) { return T.statusOfTodo(t, sts).group !== "completed" }).length
      return open + " open · " + all.length + (all.length === 1 ? " task" : " tasks")
    }
  }
  for (var k in lists) core[k] = lists[k]
  for (var t in todos) core[t] = todos[t]
  for (var s in search) core[s] = search[s]
  for (var g in settingsGlue) core[g] = settingsGlue[g]
  for (var r in runnerGlue) core[r] = runnerGlue[r]
  for (var ch in chatGlue) core[ch] = chatGlue[ch]
  for (var tg in taxGlue) core[tg] = taxGlue[tg]

  // The Mac's key notation (decision 9) in the texts the view logic writes for the launcher's own
  // rows: modifiers as ⌥ ⇧ ⌃ ⌘ (⌘V pastes, as Ctrl+V does). Never on a paper's or a task's own text.
  // (and the AI features named one way, in the place that installs them: Settings › Setup)
  var MAC_KEYS = [[/Settings › Install AI features/g, "Settings › Setup installs them"], [/Settings › Requirements › Install AI features/g, "Settings › Setup"],
    [/Install the AI features first \(below\)/g, "Install the AI features first (Settings › Setup, below)"], [/Alt\+key\b/g, "⌥ and a key"], [/Shift\+Enter\b/g, "⇧↵"], [/Ctrl\+Enter\b/g, "⌃↵"], [/Shift\+Alt\+/g, "⇧⌥"], [/Alt\+Shift\+/g, "⇧⌥"], [/Ctrl\+V\b/g, "⌘V"], [/[Aa]lt\+/g, "⌥"], [/Shift\+/g, "⇧"], [/[Cc]trl\+/g, "⌃"]]
  var macKeys = function (t) {
    if (typeof t !== "string") return t
    for (var i = 0; i < MAC_KEYS.length; i++) t = t.replace(MAC_KEYS[i][0], MAC_KEYS[i][1])
    return t
  }
  var macRow = function (r, fields) {
    var x = Object.assign({}, r)
    fields.forEach(function (f) { if (typeof x[f] === "string") x[f] = macKeys(x[f]) })
    return x
  }
  ;["settingsPage", "statusSettings", "entryRows", "settingMenuRows", "settingsIndex"].forEach(function (name) {
    var f = core[name]
    core[name] = function () { var rows = f.apply(null, arguments); return Array.isArray(rows) ? rows.map(function (r) { return macRow(r, ["label", "labelHtml", "detail", "pageTitle"]) }) : rows }
  })
  // The rows that mix the launcher's words with yours (a paper's menu, tags, prompts, processes):
  // their details only, and never a row that is your content (a note, a task, a chat, a tag).
  var CONTENT = ["note", "read", "chat-session", "artifact", "todo", "task"] // (their details are yours, or a runner's report)
  ;["menu", "actions", "tagRows", "promptRows", "promptEditor", "promptModels", "promptEfforts", "promptOutputs", "titleRows", "extractMenu"].forEach(function (name) {
    var f = core[name]
    core[name] = function () {
      var out = f.apply(null, arguments)
      var fix = function (rows) { return rows.map(function (r) { return CONTENT.indexOf(r.rowId) >= 0 ? r : macRow(r, ["detail"]) }) }
      if (Array.isArray(out)) return fix(out)
      if (out && Array.isArray(out.rows)) return Object.assign({}, out, { rows: fix(out.rows), ordered: Array.isArray(out.ordered) ? fix(out.ordered) : out.ordered })
      return out
    }
  })
  var results = core.results
  core.results = function () {
    return results.apply(null, arguments).map(function (r) { return r.section === "Go to" ? macRow(r, ["subtitle"]) : r })
  }
  core.macKeys = function (text) { return macKeys(text) }
  return core
})()

if (typeof module !== "undefined") module.exports = Glue
