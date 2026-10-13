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
    statusSettings: function (settings, todos) {
      return T.buildStatusSettings(statuses(settings), todos, L).concat(T.buildActionSettings(T.actionsOf(settings), L), T.buildDefaultTaskSettings(settings, L))
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

    // ---- conflict copies (contracts/Merge.js)
    conflictOf: function (name) { return M.conflictOf(name) },
    keptName: function (base, machine) { return M.keptName(base, machine) },
    merge: function (base, mine, theirs, mineMs, theirsMs, nowMs) { return M.merge(base, mine, theirs, mineMs, theirsMs, at(nowMs).toISOString()) },
    stamp: function (base, before, after, nowMs) { return M.stamp(base, before, after, at(nowMs).toISOString()) }
  }
}

if (typeof module !== "undefined") module.exports = GlueTodos
