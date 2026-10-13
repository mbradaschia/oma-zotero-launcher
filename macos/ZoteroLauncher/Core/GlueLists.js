// Glue's wrappers for the lists of phase 4a on: notes, tags, statuses, the settings pages, the
// paper's default task. Merged into Glue (Glue.js); JSON in, JSON out, as there.
function GlueLists(V, C, T, P, F, S) {
  var L = V.listRow
  var asDate = function (ms) { return new Date(Number(ms) || Date.now()) }

  // Settings.js's state (ZoteroSearch.qml's settingsState), with what the Mac has.
  function settingsState(settings, ctx) {
    return { settings: settings, info: null, models: null, defaults: { prompts: "", chat: "" }, rules: [], instructions: "", tests: {}, open: "",
      runner: { installed: false, installing: false }, styles: ctx.styles || null, stylesProblem: ctx.stylesProblem || "",
      extract: { pending: 0, catchup: null, skipped: 0 }, taxonomies: null, prompts: null, catchUp: { plan: null, running: false, problem: "" },
      reqs: {}, setup: null, bridge: ctx.bridge || { status: "unknown", version: "", zoteroVersion: "", expected: "" } }
  }

  return {
    // ---- notes
    noteRows: function (details, query, color, order) { return V.buildNoteRows(details, query || "", color, F.filter, order || []) },
    ownNotes: function (details, order) { return V.orderNotes(V.ownNotes(details), order || []) },
    noteParts: function (html, title) { return V.splitNoteTitle(html, title) },
    // The reader's HTML: o = { size, color, accent, dim }.
    noteHtml: function (html, o) { return V.noteHtml(html, o) },
    paperCite: function (paper) { return V.paperCite(paper) },
    withNoteRows: function (rows, expanded) { return V.withNoteRows(rows, expanded) },
    fileName: function (name) { return C.fileName(name) },

    // ---- tags
    // state: { tags, itemTags, initial, editable }
    tagRows: function (state, query, color) { return V.buildTagRows(state, query || "", color, F.filter) },
    tagMap: function (tags) { return V.tagMap(tags) },
    tagCountText: function (state) { return V.tagCountText(state) },
    uniqueLabelClash: function (name, itemTags, taxonomies) { return V.uniqueLabelClash(name, itemTags || [], taxonomies || []) || null },
    tagStatusRows: function (kind, tag, paper, tasks) { return V.buildTagStatusRows(kind, tag, paper, tasks) },
    // The tag editor's Shift+Enter menu (ZoteroSearch.qml:4330).
    tagMenuRows: function (n) {
      return [
        L({ rowId: "tag-rename", icon: "", label: "Rename…", detail: "On every paper that has “" + n + "” (into an existing tag: merged)", available: true, submenu: true }),
        L({ rowId: "tag-to-paper", icon: "", label: "Make it a paper status…", detail: "A new one (s/" + n + "), or merged into one of yours; renamed on every paper", available: true, submenu: true }),
        L({ rowId: "tag-to-task", icon: T.ICON.task, label: "Make it a task status…", detail: "Each paper with it gets its default task in that status; the tag becomes t/…", available: true, submenu: true }),
        L({ rowId: "tag-delete", icon: "", label: "Delete from every paper", detail: "Take “" + n + "” off every paper in your library", available: true })
      ]
    },
    tagNameRows: function (from, text) {
      var t = String(text || "").trim()
      return [L({ rowId: "tag-name-save", icon: "", label: t ? "Rename “" + from + "” to “" + t + "”" : "Type the new name",
        detail: "On every paper that has it", available: !!t && t !== from, value: t })]
    },

    // ---- statuses
    statusTags: function (names) { return C.statusTags(names) },
    paperStatusOf: function (tags, statusTags) { return C.paperStatusOf(tags || [], statusTags) },
    nextPaperStatus: function (statusTags, current, delta) { return C.nextPaperStatus(statusTags, current, delta) },
    statusTag: function (name) { return C.statusTag(name) },

    // ---- the paper's default task (todos.json)
    parseTodos: function (text) { return T.parseTodos(text) },
    todoStatuses: function (settings) { return T.statusesOf(settings) },
    defaultTasks: function (todos, statuses) { return T.defaultTaskStatuses(todos, statuses) },
    nextDefaultStatus: function (statuses, currentId, delta) { return T.nextDefaultStatus(statuses, currentId, delta) },
    defaultTaskDescription: function (settings, item) { return T.defaultTaskDescription(T.defaultTemplateOf(settings), item) },
    // Each change made (Service.qml's setDefaultTasks): → { todos, tags (the t/ tag changes) }.
    setDefaultTasks: function (todos, changes, settings, nowMs) {
      var statuses = T.statusesOf(settings), template = T.defaultTemplateOf(settings), now = asDate(nowMs)
      var list = todos
      ;(changes || []).forEach(function (c) { list = T.setDefaultTask(list, c.item, c.status, statuses, template, now).todos })
      return { todos: list, text: T.serializeTodos(list), tags: T.taskTagChanges(todos, statuses, list, statuses) }
    },
    statusById: function (statuses, id) { return T.statusById(statuses, id) },
    // A task status added (the tag menu's Make it a task status): → { statuses, status } or { error }.
    addStatus: function (statuses, name, group) { return T.addStatus(statuses, name, group) },
    // Settings' tasks with a status added, as JSON text for saving: → { tasksText, status } or { error }.
    tasksWithStatus: function (settings, name, group) {
      var r = T.addStatus(T.statusesOf(settings), name, group)
      if (r.error) return { error: r.error }
      var tasks = {}
      var cur = settings.tasks || {}
      for (var k in cur) tasks[k] = cur[k]
      tasks.statuses = r.statuses
      return { tasksText: JSON.stringify(tasks), status: r.status }
    },
    taskTagPrefix: function () { return T.TASK_TAG_PREFIX },

    // ---- settings (Settings.js; row = Views.listRow)
    // page: "", "general", "paper-status", "styles", "choice", "edit"; ctx: { bridge: { status,
    // version, zoteroVersion, expected }, styles, stylesProblem } (what the Mac knows so far; the
    // runner's parts come with phase 6); extra: { choice (a path), edit, filter, machineOnly }.
    settingsPage: function (page, settings, ctx, extra) {
      var x = extra || {}
      var state = settingsState(settings, ctx || {})
      var rows
      if (page === "") rows = S.buildRoot(state, L)
      else if (page === "general") rows = S.buildGeneral(Object.assign({}, state, { machineOnly: x.machineOnly || null }), L)
      else if (page === "paper-status") rows = S.buildPaperStatusSettings(state.settings.paperStatuses || [], L).concat([L({ section: "In Zotero", rowId: "pstatus-migrate", icon: "",
        label: "Move the status tags to " + C.PAPER_TAG_PREFIX + "…", detail: "Papers tagged “" + ((state.settings.paperStatuses || [])[0] || "reading") + "” before the prefix get “" + C.statusTag((state.settings.paperStatuses || [])[0] || "reading") + "”, and so on", available: (state.settings.paperStatuses || []).length > 0 })])
      else if (page === "styles") rows = S.buildStylePicker(state, L)
      else if (page === "choice") rows = S.buildChoice(state, x.choice, L)
      else if (page === "edit") return S.buildEditRows(x.edit, x.filter || "", L)
      else rows = [L({ rowId: "set-info", icon: S.ICON.info, label: "This page comes to the Mac in a later version", available: false })]
      return V.filterRows(rows, x.filter || "")
    },
    // The rows that stay on this machine with a sync folder (ZoteroSearch.qml's machineOnlyKeys).
    machineOnly: function () {
      var out = {}
      Object.keys(P.SETTING_SCOPES).forEach(function (k) { if (k.indexOf("general.") === 0 && P.SETTING_SCOPES[k] === "machine") out[k.slice(8)] = true })
      return out
    },
    settingEdit: function (path, settings) {
      var key = path.replace(/^general\./, "")
      var item = S.generalItem(key)
      if (!item) return null
      var cur = S.getPath(settings, key)
      var text = cur === undefined || cur === null ? "" : Array.isArray(cur) ? cur.join(" ") : String(cur)
      return { path: path, label: item.label, type: item.type, help: item.help || "", current: text, item: item,
        empty: item.type === "argv" || item.type === "context" || item.type === "path" ? "back to the default" : "" }
    },
    parseValue: function (item, text) { return S.parseValue(item, text) },
    settingValue: function (settings, path) {
      var key = path.replace(/^general\./, "")
      var item = S.generalItem(key)
      var cur = S.getPath(settings, key)
      return cur === undefined || cur === null ? (item ? item.def : false) : cur
    },
    // Settings with one value changed, saved as Service.qml's saveSettings: → { problem } or
    // { machine, shared (null without a sync folder), refused, syncDirChange }.
    settingsSave: function (settings, path, value, paths, sharedRaw) {
      var next = S.withValue(settings, path, value)
      var file = S.toFile(next)
      var res = C.normalizeSettings(file)
      if (res.problems.length) return { problem: res.problems[0] }
      if ((next.syncDir || null) !== (settings.syncDir || null)) return { syncDirChange: next.syncDir || null }
      var save = P.settingsSave(file, paths, sharedRaw, S.toFile(settings))
      return { machine: save.machine, shared: save.shared, refused: save.refused || "" }
    },
    styleName: function (styles, id) { return S.styleName({ styles: styles }, id) }
  }
}

if (typeof module !== "undefined") module.exports = GlueLists
