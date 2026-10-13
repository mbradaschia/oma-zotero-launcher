// Glue's wrappers for tasks (phase 4b): the Tasks view, a task's page, quick add, the due date,
// Settings › Tasks, and the merge of the sync folder's conflict copies (contracts/Merge.js).
// Dates cross as epoch milliseconds; each wrapper makes the real Date lib/Todos.js wants.
function GlueTodos(V, C, T, M, F) {
  var L = V.listRow
  var at = function (ms) { return new Date(Number(ms) || Date.now()) }
  var statuses = function (settings) { return T.statusesOf(settings) }
  var save = function (list) { return { todos: list, text: T.serializeTodos(list) } }

  return {
    // ---- the lists
    todoRows: function (todos, settings, query, color, nowMs) {
      return T.buildTodoRows(todos, statuses(settings), query || "", color, F.filter, L, at(nowMs), V.highlight, V.rangesFrom)
    },
    itemTodoRows: function (todos, item, settings, nowMs) { return T.itemTodoRows(todos, item, statuses(settings), L, at(nowMs)) },
    todoEditor: function (todo, settings, nowMs) { return T.buildTodoEditor(todo, statuses(settings), L, at(nowMs)) },
    statusChoice: function (todo, settings) { return T.buildStatusChoice(todo, statuses(settings), L) },
    priorityChoice: function (todo) { return T.buildPriorityChoice(todo, L) },
    taskTagRows: function (line, draft, settings, query, nowMs) { return T.buildTaskTagRows(line, draft, statuses(settings), query || "", L, at(nowMs), T.actionsOf(settings)) },
    statusSettings: function (settings, todos, filter) {
      return V.filterRows(T.buildStatusSettings(statuses(settings), todos, L).concat(T.buildActionSettings(T.actionsOf(settings), L), T.buildDefaultTaskSettings(settings, L)), filter || "")
    },
    taskMarks: function (todos, settings, nowMs) { return T.taskMarks(todos, statuses(settings), at(nowMs)) },
    taskActions: function (settings) { return T.actionsOf(settings) },
    groupName: function (id) { return T.groupName(id) },
    priorityName: function (p) { return T.priorityName(p) },

    // ---- a new task's line: { description, status, priority, due, problems }
    parseQuick: function (text, settings, nowMs) { return T.parseQuick(text, statuses(settings), at(nowMs)) },
    quickSummary: function (q, settings, nowMs) { return T.quickSummary(q, statuses(settings), at(nowMs)) },
    parseDue: function (text, nowMs) { return T.parseDue(text, at(nowMs)) },
    dueText: function (iso, nowMs) { return T.dueText(iso, at(nowMs)) },
    isoDate: function (nowMs) { return T.isoDate(at(nowMs)) },
    addDays: function (iso, n) { return T.addDays(iso, n) },
    addMonths: function (iso, n) { return T.addMonths(iso, n) },

    // ---- changes, each → { todos, text } (the text to write) and what the change says
    addTodo: function (todos, fields, settings, nowMs) {
      var r = T.addTodo(todos, fields, statuses(settings), at(nowMs))
      var out = save(r.todos)
      out.todo = r.todo
      out.statusName = T.statusOfTodo(r.todo, statuses(settings)).name
      return out
    },
    updateTodo: function (todos, id, changes, nowMs) { return save(T.updateTodo(todos, id, changes, at(nowMs))) },
    removeTodo: function (todos, id) { return save(T.removeTodo(todos, id)) },
    cycleTodo: function (todos, id, settings, delta, nowMs) { return save(T.cycleStatus(todos, id, statuses(settings), delta, at(nowMs))) },
    cyclePriority: function (todos, id, delta, nowMs) { return save(T.cyclePriority(todos, id, at(nowMs), delta)) },
    toggleDone: function (todos, id, settings, nowMs) { return save(T.toggleDone(todos, id, statuses(settings), at(nowMs))) },
    moveTodo: function (todos, id, settings, delta, nowMs) { return save(T.moveTodo(todos, id, statuses(settings), delta, at(nowMs))) },
    restoreTodo: function (todos, todo, index) {
      var list = todos.slice()
      list.splice(Math.min(index, list.length), 0, todo)
      return save(list)
    },
    statusOf: function (todo, settings) { return T.statusOfTodo(todo, statuses(settings)) },
    // A removed status's tasks, moved to another (Service.qml's saveStatuses).
    moveTasks: function (todos, from, to, nowMs) {
      return save(todos.map(function (t) { return t.status === from ? T.updateTodo([t], t.id, { status: to }, at(nowMs))[0] : t }))
    },
    // The t/ tags each paper gains and loses between two lists (each with its statuses).
    taskTagChanges: function (before, beforeSettings, after, afterSettings) {
      return T.taskTagChanges(before, statuses(beforeSettings), after, statuses(afterSettings))
    },
    taskTagSync: function (todos, settings) { return T.taskTagSync(todos, statuses(settings)) },
    statusListsFromZotero: function (settings, existing, changes) {
      return T.statusListsFromZotero(settings.paperStatuses || [], statuses(settings), existing, changes, C.PAPER_TAG_PREFIX, T.TASK_TAG_PREFIX)
    },

    // ---- statuses (Settings › Tasks): → { statuses } or { error }; moved: the status its tasks go to
    renameStatus: function (settings, id, name) { return T.renameStatus(statuses(settings), id, name) },
    removeStatus: function (settings, id) { return T.removeStatus(statuses(settings), id) },
    moveStatus: function (settings, id, delta) { return T.moveStatus(statuses(settings), id, delta) },
    addStatusIn: function (settings, name, group) { return T.addStatus(statuses(settings), name, group) },

    // The header's one row for a new task, a task's field, or a status's name (ZoteroSearch.qml's
    // entryRows). view: "todo-new", "todo-text" or "status-name"; draft: { item, context };
    // field: "description" | "due" | "notes"; edit: { kind, mode, group, id, name }.
    entryRows: function (view, typed, settings, draft, field, edit, nowMs) {
      var t = String(typed || "").trim()
      var sts = statuses(settings), now = at(nowMs)
      if (view === "todo-new") {
        var d = draft || {}
        var q = T.parseQuick(t, sts, now)
        var rows = [L({ rowId: "todo-new-save", icon: T.ICON.add, label: q.description ? "Add “" + q.description + "”" : "Type what to do", available: !!q.description, value: t,
          detail: q.description ? T.quickSummary(q, sts, now) + (q.problems.length ? " · " + q.problems[0] : "") + " · ↵ adds and opens it · ⇧↵ just adds it"
            : "Then, if you like: #status  !priority (! !! !!!)  @due (@fri @tomorrow @+3d)" })]
        if (d.item) rows.push(L({ section: "About", rowId: "info", icon: T.ICON.item, label: d.item.cite || d.item.title, detail: d.item.cite ? d.item.title : "", available: false }))
        if (d.context) rows.push(L({ section: "About", rowId: "info", icon: d.context.kind === "chat" ? T.ICON.chat : T.ICON.note, label: d.context.title, detail: d.context.kind === "chat" ? "A chat" : "A note", available: false }))
        if (!d.item) rows.push(L({ section: "About", rowId: "info", icon: T.ICON.item, label: "No paper", detail: "Pick one later on its page, if you like", available: false }))
        return rows
      }
      if (view === "todo-text") {
        var label = field === "description" ? (t ? "Save “" + t + "”" : "Type the description") : field === "due" ? (t ? "Due: " + t : "Save: no date") : (t ? "Save the notes" : "Save: no notes")
        var help = field === "due" ? "today, tomorrow, +3d, +2w, fri, or 2026-10-03" : field === "notes" ? "One line; Ctrl+V pastes" : ""
        return [L({ rowId: "todo-text-save", icon: T.ICON.notes, label: label, detail: help, available: field !== "description" || !!t, value: t })]
      }
      var e = edit || {}
      if (e.kind === "action") return [L({ rowId: "status-name-save", icon: T.ICON.task, label: t ? (e.mode === "add" ? "Add the action “" + t + "”" : "Rename to “" + t + "”") : "Type the action",
        detail: "What @ offers in a new task's line, as a block", available: !!t, value: t })]
      if (e.kind === "paper") return [L({ rowId: "status-name-save", icon: T.ICON.status, label: t ? (e.mode === "add" ? "Add the status “" + t + "”" : "Rename to “" + t + "”") : "Type the tag",
        detail: "A Zotero tag: papers with it show it as their status", available: !!t, value: t })]
      return [L({ rowId: "status-name-save", icon: T.ICON.status, label: t ? (e.mode === "add" ? "Add “" + t + "” to " + T.groupName(e.group) : "Rename to “" + t + "”") : "Type the status's name",
        available: !!t, value: t })]
    },
    // A status's (or an action's) menu in Settings (ZoteroSearch.qml's statusMenuRows).
    statusMenuRows: function (edit, todos, settings) {
      var e = edit || {}
      if (e.kind === "action") return [
        L({ rowId: "status-rename", icon: T.ICON.notes, label: "Rename…", detail: e.name || "", available: true, submenu: true }),
        L({ rowId: "status-remove", icon: T.ICON.trash, label: "Remove this action", detail: "@ won't offer it; tasks keep their words", available: true })
      ]
      if (e.kind === "paper") return [
        L({ rowId: "status-rename", icon: T.ICON.notes, label: "Rename…", detail: "Its tag " + C.statusTag(e.name) + " too, on every paper with it", available: true, submenu: true }),
        L({ rowId: "status-remove", icon: T.ICON.trash, label: "Remove this status", detail: "And delete its tag " + C.statusTag(e.name) + " from every paper (asked first)", available: true })
      ]
      var sts = statuses(settings)
      var n = (todos || []).filter(function (t) { return t.status === e.id }).length
      var rm = T.removeStatus(sts, e.id)
      return [
        L({ rowId: "status-rename", icon: T.ICON.notes, label: "Rename…", detail: e.name || "", available: true, submenu: true }),
        L({ rowId: "status-remove", icon: T.ICON.trash, label: "Remove this status", available: !rm.error,
          detail: rm.error ? rm.error : n ? "Its " + n + (n === 1 ? " task moves" : " tasks move") + " to " + T.statusById(rm.statuses, rm.moveTo).name : "No task has it" })
      ]
    },
    // A term put in at the caret (Views.insertAt): → { text, caret, live }.
    insertAt: function (text, caret, token) { return V.insertAt(text, caret, token) },
    defaultTemplate: function () { return T.DEFAULT_TASK_TEMPLATE },
    // Settings' tasks with these statuses (or actions) instead, as JSON text for saving (its keys in order).
    tasksWith: function (settings, change) {
      var tasks = {}
      var cur = settings.tasks || {}
      for (var k in cur) tasks[k] = cur[k]
      for (var c in change) tasks[c] = change[c]
      return JSON.stringify(tasks)
    },
    calendarMonth: function (iso, nowMs) { return T.calendarMonth(iso, at(nowMs)) },

    // ---- conflict copies (contracts/Merge.js)
    conflictOf: function (name) { return M.conflictOf(name) },
    keptName: function (base, machine) { return M.keptName(base, machine) },
    merge: function (base, mine, theirs, mineMs, theirsMs, nowMs) { return M.merge(base, mine, theirs, mineMs, theirsMs, at(nowMs).toISOString()) },
    stamp: function (base, before, after, nowMs) { return M.stamp(base, before, after, at(nowMs).toISOString()) }
  }
}

if (typeof module !== "undefined") module.exports = GlueTodos
