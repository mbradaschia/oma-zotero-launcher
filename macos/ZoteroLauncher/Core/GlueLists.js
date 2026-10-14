// Glue's wrappers for the lists of phase 4a on: notes, tags, statuses, the paper's default task
// (the settings pages: GlueSettings.js). Merged into Glue (Glue.js); JSON in, JSON out, as there.
function GlueLists(V, C, T, P, F, S) {
  var L = V.listRow
  var asDate = function (ms) { return new Date(Number(ms) || Date.now()) }

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

    // ---- settings (the pages and saving them: GlueSettings.js)
    // The rows that stay on this machine with a sync folder (ZoteroSearch.qml's machineOnlyKeys).
    machineOnly: function () {
      var out = {}
      Object.keys(P.SETTING_SCOPES).forEach(function (k) { if (k.indexOf("general.") === 0 && P.SETTING_SCOPES[k] === "machine") out[k.slice(8)] = true })
      return out
    },
    parseValue: function (item, text) { return S.parseValue(item, text) },
    styleName: function (styles, id) { return S.styleName({ styles: styles }, id) }
  }
}

if (typeof module !== "undefined") module.exports = GlueLists
