// Tasks (to-dos) about your papers: the statuses (yours, in five fixed groups), the tasks file, and
// the rows of the Tasks view, a task's page and a paper's Tasks section. Pure (node-tested); rows are
// built with the list-row function the launcher passes in (Views.listRow). In the code they are
// "todos", so as not to mix them up with the process queue (daemon/lib/tasks.mjs).

// The groups every status belongs to, in this order.
var GROUPS = [["backlog", "Backlog"], ["next", "Next"], ["active", "Active"], ["waiting", "Waiting"], ["completed", "Completed"]]

var DEFAULT_STATUSES = [
  { id: "to_read", name: "To read", group: "backlog" },
  { id: "idea", name: "Idea", group: "backlog" },
  { id: "next", name: "Next", group: "next" },
  { id: "reading", name: "Reading", group: "active" },
  { id: "writing", name: "Writing", group: "active" },
  { id: "waiting", name: "Waiting", group: "waiting" },
  { id: "done", name: "Done", group: "completed" }
]

var PRIORITIES = [["", "None"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]]

var ICON = { task: "", add: "", done: "", item: "", note: "", chat: "", status: "", due: "", priority: "", notes: "", trash: "", group: "" }

function groupName(id) {
  for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i][0] === id) return GROUPS[i][1]
  return id
}

function groupIndex(id) {
  for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i][0] === id) return i
  return GROUPS.length
}

function validStatusId(id) {
  return /^[a-z0-9][a-z0-9_]{0,29}$/.test(String(id || ""))
}

// The statuses in force: the settings' (validated by Client.normalizeSettings), else the defaults;
// in group order, each group in your order.
function statusesOf(settings) {
  var list = settings && settings.tasks && Array.isArray(settings.tasks.statuses) && settings.tasks.statuses.length ? settings.tasks.statuses : DEFAULT_STATUSES
  return orderedStatuses(list)
}

function orderedStatuses(list) {
  return list.map(function (s, i) { return { s: s, i: i } }).sort(function (a, b) {
    return groupIndex(a.s.group) - groupIndex(b.s.group) || a.i - b.i
  }).map(function (e) { return e.s })
}

function statusById(statuses, id) {
  for (var i = 0; i < statuses.length; i++) if (statuses[i].id === id) return statuses[i]
  return null
}

// A status name → a free id ("To read" → "to_read", "to_read_2", …).
function statusIdFor(statuses, name) {
  var n = String(name || "").toLowerCase()
  try { n = n.normalize("NFKD").replace(/[\u0300-\u036f]/g, "") } catch (e) {}
  var base = n.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "status"
  if (!/^[a-z0-9]/.test(base)) base = "s_" + base
  var id = base
  for (var n = 2; statusById(statuses, id); n++) id = base + "_" + n
  return id
}

// ---------------------------------------------------------------- editing statuses (Settings › Tasks)

function addStatus(statuses, name, group) {
  var n = String(name || "").trim().slice(0, 40)
  if (!n) return { error: "Type the status's name" }
  if (groupIndex(group) >= GROUPS.length) return { error: "No such group" }
  var list = statuses.slice()
  // At the end of its group.
  var at = list.length
  for (var i = list.length - 1; i >= 0; i--) if (groupIndex(list[i].group) <= groupIndex(group)) { at = i + 1; break }
  if (!list.some(function (s) { return groupIndex(s.group) <= groupIndex(group) })) at = 0
  var s = { id: statusIdFor(list, n), name: n, group: group }
  list.splice(at, 0, s)
  return { statuses: list, status: s }
}

function renameStatus(statuses, id, name) {
  var n = String(name || "").trim().slice(0, 40)
  if (!n) return { error: "Type the new name" }
  return { statuses: statuses.map(function (s) { return s.id === id ? { id: s.id, name: n, group: s.group } : s }) }
}

// Removing a status: its tasks move to another status of the same group, else the first one.
// The last status can't go. → { statuses, moveTo } or { error }
function removeStatus(statuses, id) {
  var s = statusById(statuses, id)
  if (!s) return { error: "No such status" }
  if (statuses.length <= 1) return { error: "Keep at least one status" }
  var list = statuses.filter(function (x) { return x.id !== id })
  var same = list.filter(function (x) { return x.group === s.group })
  return { statuses: list, moveTo: (same[0] || list[0]).id }
}

// Shift+↑/↓ on a status: up or down in its group; past the first or last, into the next group.
function moveStatus(statuses, id, delta) {
  var list = orderedStatuses(statuses).slice()
  var i = -1
  for (var k = 0; k < list.length; k++) if (list[k].id === id) i = k
  if (i < 0) return list
  var s = list[i]
  var j = i + delta
  if (j >= 0 && j < list.length && list[j].group === s.group) {
    list[i] = list[j]
    list[j] = s
    return list
  }
  var g = groupIndex(s.group) + delta
  if (g < 0 || g >= GROUPS.length) return list
  var moved = { id: s.id, name: s.name, group: GROUPS[g][0] }
  list.splice(i, 1)
  // First of the next group, or last of the previous one.
  var at = delta > 0 ? list.length : 0
  if (delta > 0) { for (var a = 0; a < list.length; a++) if (groupIndex(list[a].group) >= g) { at = a; break } }
  else { for (var b = list.length - 1; b >= 0; b--) if (groupIndex(list[b].group) <= g) { at = b + 1; break } }
  list.splice(at, 0, moved)
  return orderedStatuses(list)
}

// ---------------------------------------------------------------- the tasks file

function parseTodos(text) {
  var j
  try {
    j = JSON.parse(String(text || ""))
  } catch (e) {
    return []
  }
  var list = j && Array.isArray(j.todos) ? j.todos : []
  return list.filter(function (t) { return t && typeof t.id === "string" && typeof t.description === "string" }).map(normalizeTodo)
}

function ref(x, kind) {
  if (!x || typeof x !== "object" || !x.key) return null
  var r = { key: String(x.key), libraryID: Number(x.libraryID) || 1, title: String(x.title || "") }
  if (kind === "item" && x.cite) r.cite = String(x.cite)
  if (kind === "context") {
    if (x.kind !== "note" && x.kind !== "chat") return null
    r.kind = x.kind
    if (x.id) r.id = String(x.id)
  }
  return r
}

function normalizeTodo(t) {
  return {
    id: String(t.id),
    description: String(t.description).slice(0, 500),
    status: validStatusId(t.status) ? t.status : "",
    priority: ["low", "medium", "high"].indexOf(t.priority) >= 0 ? t.priority : "",
    due: /^\d{4}-\d{2}-\d{2}$/.test(String(t.due || "")) ? t.due : "",
    notes: String(t.notes || "").slice(0, 4000),
    before: validStatusId(t.before) ? t.before : "", // the status before it was marked done (d)
    item: ref(t.item, "item"),
    context: ref(t.context, "context"),
    created: String(t.created || ""),
    updated: String(t.updated || "")
  }
}

function serializeTodos(todos) {
  return JSON.stringify({ todos: todos }, null, 2) + "\n"
}

function newId(now) {
  return "t" + (now || new Date()).getTime().toString(36) + Math.random().toString(36).slice(2, 6)
}

// A new task: in the first status of Backlog (else the first status), at the top of it.
function addTodo(todos, fields, statuses, now) {
  now = now || new Date()
  var first = statuses.filter(function (s) { return s.group === "backlog" })[0] || statuses[0]
  var t = normalizeTodo({ id: newId(now), description: String(fields.description || "").trim(), status: fields.status || (first ? first.id : ""),
    priority: fields.priority || "", due: fields.due || "", item: fields.item || null, context: fields.context || null, created: now.toISOString(), updated: now.toISOString() })
  return { todos: [t].concat(todos), todo: t }
}

function updateTodo(todos, id, changes, now) {
  return todos.map(function (t) {
    if (t.id !== id) return t
    var n = Object.assign({}, t, changes, { updated: (now || new Date()).toISOString() })
    return normalizeTodo(n)
  })
}

function removeTodo(todos, id) {
  return todos.filter(function (t) { return t.id !== id })
}

// A task's status, or the first when its own is gone (a status removed in Settings).
function statusOfTodo(t, statuses) {
  return statusById(statuses, t.status) || statuses[0]
}

// Tab / Shift+Tab: the next or previous status (in the order Settings › Tasks shows them), wrapping.
function cycleStatus(todos, id, statuses, delta, now) {
  var t = todos.filter(function (x) { return x.id === id })[0]
  if (!t || !statuses.length) return todos
  var i = statuses.indexOf(statusOfTodo(t, statuses))
  var next = statuses[(i + delta + statuses.length) % statuses.length]
  return updateTodo(todos, id, { status: next.id }, now)
}

// The tasks in the order the Tasks view shows them: by status (in order), each in your order.
function displayOrder(todos, statuses) {
  var rank = {}
  statuses.forEach(function (s, i) { rank[s.id] = i })
  return todos.map(function (t, i) { return { t: t, i: i } }).sort(function (a, b) {
    var x = rank[statusOfTodo(a.t, statuses).id], y = rank[statusOfTodo(b.t, statuses).id]
    return x - y || a.i - b.i
  }).map(function (e) { return e.t })
}

// Shift+↑/↓: up or down among its status's tasks; the first moving up (or the last moving down)
// goes to the previous (next) status, at its end (start).
function moveTodo(todos, id, statuses, delta, now) {
  var order = displayOrder(todos, statuses)
  var i = -1
  for (var k = 0; k < order.length; k++) if (order[k].id === id) i = k
  if (i < 0) return todos
  var t = order[i]
  var st = statusOfTodo(t, statuses)
  var j = i + delta
  if (j >= 0 && j < order.length && statusOfTodo(order[j], statuses).id === st.id) {
    order[i] = order[j]
    order[j] = t
    return order
  }
  var si = statuses.indexOf(st) + delta
  if (si < 0 || si >= statuses.length) return todos
  var moved = Object.assign({}, t, { status: statuses[si].id, updated: (now || new Date()).toISOString() })
  order.splice(i, 1)
  // At the end of the previous status, or the start of the next one.
  var at
  if (delta < 0) {
    at = 0
    for (var a = 0; a < order.length; a++) if (statuses.indexOf(statusOfTodo(order[a], statuses)) <= si) at = a + 1
  } else {
    at = order.length
    for (var b = 0; b < order.length; b++) if (statuses.indexOf(statusOfTodo(order[b], statuses)) >= si) { at = b; break }
  }
  order.splice(at, 0, moved)
  return order
}

// Open tasks per group, for the footer's badges: [{ group, name, count }] (Completed left out).
function groupCounts(todos, statuses) {
  var n = {}
  todos.forEach(function (t) { var g = statusOfTodo(t, statuses).group; n[g] = (n[g] || 0) + 1 })
  return GROUPS.filter(function (g) { return g[0] !== "completed" && n[g[0]] }).map(function (g) { return { group: g[0], name: g[1], count: n[g[0]] } })
}

// ---------------------------------------------------------------- due dates

function ymd(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")
}

var WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

// "2026-10-03", "today", "tomorrow", "+3d", "+2w", "fri" (the next Friday), "" (none).
// → { value } or { error }
function parseDue(text, now) {
  var t = String(text || "").trim().toLowerCase()
  now = now || new Date()
  var d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (!t || t === "none") return { value: "" }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    var p = t.split("-").map(Number)
    var x = new Date(p[0], p[1] - 1, p[2])
    if (x.getMonth() !== p[1] - 1) return { error: "Not a date: " + text }
    return { value: t }
  }
  if (t === "today") return { value: ymd(d) }
  if (t === "tomorrow") { d.setDate(d.getDate() + 1); return { value: ymd(d) } }
  var m = /^\+(\d{1,3})([dw])$/.exec(t)
  if (m) { d.setDate(d.getDate() + Number(m[1]) * (m[2] === "w" ? 7 : 1)); return { value: ymd(d) } }
  var w = WEEKDAYS.indexOf(t.slice(0, 3))
  if (w >= 0) { var add = (w - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + add); return { value: ymd(d) } }
  return { error: "A date: 2026-10-03, today, tomorrow, +3d, +2w or a weekday" }
}

// "overdue 2d", "due today", "due tomorrow", "due in 3d", "due 12 Oct".
function dueText(due, now) {
  if (!due) return ""
  now = now || new Date()
  var p = due.split("-").map(Number)
  var d = new Date(p[0], p[1] - 1, p[2])
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  var days = Math.round((d - today) / 86400000)
  if (days < 0) return "overdue " + -days + "d"
  if (days === 0) return "due today"
  if (days === 1) return "due tomorrow"
  if (days < 7) return "due in " + days + "d"
  return "due " + d.getDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]
}

// ---------------------------------------------------------------- quick add

// One line, with optional words for the rest: "#reading" a status (by name or id, a prefix will
// do), "!", "!!", "!!!" or "!low" / "!med" / "!high" a priority, "@fri", "@tomorrow", "@+3d",
// "@2026-10-03" a due date. Anything else is the description (a "#word" that isn't a status too).
// → { description, status, priority, due, problems: [] }
function parseQuick(text, statuses, now) {
  var out = { description: "", status: "", priority: "", due: "", problems: [] }
  var words = []
  String(text || "").split(/\s+/).forEach(function (w) {
    if (!w) return
    var m
    if ((m = /^#(.+)$/.exec(w))) {
      var q = m[1].toLowerCase()
      var hits = statuses.filter(function (s) { return s.id === q || s.name.toLowerCase().replace(/\s+/g, "") === q.replace(/_/g, "") })
      if (!hits.length) hits = statuses.filter(function (s) { return s.id.indexOf(q) === 0 || s.name.toLowerCase().replace(/\s+/g, "").indexOf(q) === 0 })
      if (hits.length) { out.status = hits[0].id; return }
    } else if ((m = /^!(!{0,2})$/.exec(w))) {
      out.priority = ["low", "medium", "high"][m[1].length]
      return
    } else if ((m = /^!(low|lo|l|med|medium|m|high|hi|h)$/i.exec(w))) {
      out.priority = /^l/i.test(m[1]) ? "low" : /^m/i.test(m[1]) ? "medium" : "high"
      return
    } else if ((m = /^@(.+)$/.exec(w))) {
      var d = parseDue(m[1], now)
      if (d.error) out.problems.push("@" + m[1] + ": not a date")
      else { out.due = d.value; return }
    }
    words.push(w)
  })
  out.description = words.join(" ")
  return out
}

// What a quick line will set, for its preview: "Reading · high · due Fri 2 Oct".
function quickSummary(q, statuses, now, defaultStatus) {
  var st = statusById(statuses, q.status) || statusById(statuses, defaultStatus) || statuses[0]
  var bits = [st ? st.name : ""]
  if (q.priority) bits.push(priorityName(q.priority).toLowerCase())
  if (q.due) bits.push(dueText(q.due, now))
  return bits.filter(function (x) { return x }).join(" · ")
}

// !: none → low → medium → high → none.
function cyclePriority(todos, id, now) {
  var order = ["", "low", "medium", "high"]
  var t = todos.filter(function (x) { return x.id === id })[0]
  if (!t) return todos
  return updateTodo(todos, id, { priority: order[(order.indexOf(t.priority) + 1) % order.length] }, now)
}

// d: done (the first status of Completed), or, when it's done, back to the status it had (else the
// first of Backlog).
function toggleDone(todos, id, statuses, now) {
  var t = todos.filter(function (x) { return x.id === id })[0]
  if (!t) return todos
  var done = statuses.filter(function (s) { return s.group === "completed" })[0]
  if (!done) return todos
  if (statusOfTodo(t, statuses).group !== "completed") return updateTodo(todos, id, { status: done.id, before: t.status }, now)
  var back = statusById(statuses, t.before) && statusById(statuses, t.before).group !== "completed" ? t.before : (statuses.filter(function (s) { return s.group === "backlog" })[0] || statuses[0]).id
  return updateTodo(todos, id, { status: back, before: "" }, now)
}

// ---------------------------------------------------------------- rows

function priorityName(p) {
  for (var i = 0; i < PRIORITIES.length; i++) if (PRIORITIES[i][0] === p) return PRIORITIES[i][1]
  return "None"
}

// A task's second line: its paper, its note or chat, when it's due, its notes' first line.
function todoDetail(t, now, withItem) {
  var bits = []
  if (withItem !== false && t.item) bits.push(t.item.cite || t.item.title)
  if (t.context) bits.push((t.context.kind === "chat" ? "chat: " : "note: ") + t.context.title)
  var due = dueText(t.due, now)
  if (due) bits.push(due)
  if (t.notes) bits.push(t.notes.split("\n")[0].slice(0, 80))
  if (!bits.length) bits.push(t.item ? "" : "No paper")
  return bits.filter(function (x) { return x }).join(" · ")
}

function todoBadge(t, now) {
  var due = dueText(t.due, now)
  if (/^overdue/.test(due)) return due
  return t.priority ? priorityName(t.priority).toLowerCase() : ""
}

function todoRow(t, statuses, row, section, now, color, positions, highlight) {
  var st = statusOfTodo(t, statuses)
  return row({ section: section, rowId: "todo", icon: st.group === "completed" ? ICON.done : ICON.task, label: t.description,
    labelHtml: highlight ? highlight(t.description, positions, color) : undefined, detail: todoDetail(t, now, true), available: true, submenu: true,
    value: t.id, badge: todoBadge(t, now), itemKey: t.item ? t.item.key : "", itemLibraryID: t.item ? t.item.libraryID : 1, itemTitle: t.item ? t.item.title : "" })
}

// The Tasks view: New task…, then a section per status ("Active · Reading"), in order.
// `rank`/`highlight` as for the other views (Fuzzy.filter, Views.highlight); `rangesFrom` → ranges.
function buildTodoRows(todos, statuses, query, color, rank, row, now, highlight, rangesFrom) {
  var ranked = rank(todos || [], query, [
    { get: function (t) { return t.description } },
    { get: function (t) { return t.item ? (t.item.cite || "") + " " + t.item.title : "" }, weight: 0.6 },
    { get: function (t) { return t.notes || "" }, weight: 0.3 }
  ])
  var pos = {}
  ranked.forEach(function (r) { pos[r.item.id] = r.positions })
  var shown = displayOrder(ranked.map(function (r) { return r.item }), statuses)
  var typed = String(query || "").trim()
  var q = parseQuick(typed, statuses, now)
  var rows = [typed && q.description
    ? row({ rowId: "todo-quick", icon: ICON.add, label: "Add “" + q.description + "”", detail: quickSummary(q, statuses, now) + " · Enter adds it" + (q.problems.length ? " · " + q.problems[0] : ""), available: true, value: typed })
    : row({ rowId: "todo-new", icon: ICON.add, label: "New task…", detail: "Or just type it here: #status !priority @due", available: true, submenu: true })]
  shown.forEach(function (t) {
    var st = statusOfTodo(t, statuses)
    rows.push(todoRow(t, statuses, row, groupName(st.group) + " · " + st.name, now, color, rangesFrom ? rangesFrom(pos[t.id]) : null, highlight))
  })
  return rows
}

// A paper's Tasks section in its menu: its open tasks first, then the completed ones.
function itemTodoRows(todos, item, statuses, row, now) {
  if (!item) return []
  var mine = displayOrder((todos || []).filter(function (t) { return t.item && t.item.key === item.key && t.item.libraryID === (Number(item.libraryID) || 1) }), statuses)
  var rows = mine.map(function (t) {
    var st = statusOfTodo(t, statuses)
    return row({ section: "Tasks", rowId: "todo", icon: st.group === "completed" ? ICON.done : ICON.task, label: t.description, available: true, submenu: true, value: t.id,
      detail: [st.name, todoDetail(t, now, false)].filter(function (x) { return x && x !== "No paper" }).join(" · "), badge: todoBadge(t, now) })
  })
  rows.push(row({ section: "Tasks", rowId: "todo-new", icon: ICON.add, label: "New task…", detail: "About this paper (a on a note or chat: about it too)", available: true, submenu: true }))
  return rows
}

// A task's page: each field, Enter changes it.
function buildTodoEditor(t, statuses, row, now) {
  if (!t) return []
  var st = statusOfTodo(t, statuses)
  var rows = [
    row({ rowId: "todo-edit", value: "description", icon: ICON.notes, label: "Description", detail: t.description, available: true, submenu: true }),
    row({ rowId: "todo-status", icon: ICON.status, label: "Status", detail: groupName(st.group) + " · " + st.name + " · Enter or Tab: next · Shift+Tab: back · d: done", available: true }),
    row({ rowId: "todo-priority", icon: ICON.priority, label: "Priority", detail: priorityName(t.priority) + " · Enter or !: next", available: true }),
    row({ rowId: "todo-edit", value: "due", icon: ICON.due, label: "Due", detail: t.due ? t.due + " · " + dueText(t.due, now) : "No date · today, tomorrow, +3d, fri or 2026-10-03", available: true, submenu: true }),
    row({ rowId: "todo-edit", value: "notes", icon: ICON.notes, label: "Notes", detail: t.notes || "None yet", available: true, submenu: true })
  ]
  if (t.item) {
    rows.push(row({ section: "About", rowId: "todo-item", icon: ICON.item, label: t.item.cite || t.item.title, detail: (t.item.cite ? t.item.title + " · " : "") + "Enter opens its menu", available: true, submenu: true }))
    if (t.context) rows.push(row({ section: "About", rowId: "todo-context", icon: t.context.kind === "chat" ? ICON.chat : ICON.note, label: t.context.title || (t.context.kind === "chat" ? "A chat" : "A note"),
      detail: "Enter opens this " + (t.context.kind === "chat" ? "chat" : "note"), available: true, submenu: true }))
    rows.push(row({ section: "About", rowId: "todo-pick", icon: ICON.item, label: "Another paper…", detail: "Pick the paper this task is about", available: true, submenu: true }))
    rows.push(row({ section: "About", rowId: "todo-unlink", icon: ICON.trash, label: "No paper", detail: "Keep the task, about nothing in particular", available: true }))
  } else {
    rows.push(row({ section: "About", rowId: "todo-pick", icon: ICON.item, label: "Pick a paper…", detail: "What this task is about (optional)", available: true, submenu: true }))
  }
  rows.push(row({ section: "", rowId: "todo-delete", icon: ICON.trash, label: "Delete this task", detail: "Enter deletes it", available: true }))
  return rows
}

function buildStatusChoice(t, statuses, row) {
  return statuses.map(function (s) {
    return row({ section: groupName(s.group), rowId: "todo-status-opt", label: s.name, showCheck: true, checked: t && statusOfTodo(t, statuses).id === s.id, value: s.id, available: true })
  })
}

function buildPriorityChoice(t, row) {
  return PRIORITIES.map(function (p) {
    return row({ rowId: "todo-priority-opt", label: p[1], showCheck: true, checked: t && t.priority === p[0], value: p[0], tag: p[0], available: true })
  })
}

// Settings › Tasks: each group and its statuses (Enter: rename, remove; Shift+↑/↓ reorders),
// and "Add a status…" per group.
function buildStatusSettings(statuses, todos, row) {
  var rows = []
  GROUPS.forEach(function (g) {
    statuses.filter(function (s) { return s.group === g[0] }).forEach(function (s) {
      var n = (todos || []).filter(function (t) { return t.status === s.id }).length
      rows.push(row({ section: g[1], rowId: "status", icon: ICON.status, label: s.name, detail: (n ? n + (n === 1 ? " task" : " tasks") : "No tasks") + " · Enter renames or removes it · Shift+↑↓ moves it", available: true, submenu: true, value: s.id }))
    })
    rows.push(row({ section: g[1], rowId: "status-add", icon: ICON.add, label: "Add a status to " + g[1] + "…", available: true, submenu: true, value: g[0] }))
  })
  return rows
}

if (typeof module !== "undefined") {
  module.exports = {
    GROUPS: GROUPS, DEFAULT_STATUSES: DEFAULT_STATUSES, PRIORITIES: PRIORITIES, ICON: ICON, groupName: groupName, validStatusId: validStatusId, statusesOf: statusesOf,
    orderedStatuses: orderedStatuses, statusById: statusById, statusIdFor: statusIdFor, addStatus: addStatus, renameStatus: renameStatus, removeStatus: removeStatus,
    moveStatus: moveStatus, parseTodos: parseTodos, serializeTodos: serializeTodos, addTodo: addTodo, updateTodo: updateTodo, removeTodo: removeTodo,
    statusOfTodo: statusOfTodo, cycleStatus: cycleStatus, displayOrder: displayOrder, moveTodo: moveTodo, groupCounts: groupCounts, parseDue: parseDue,
    dueText: dueText, todoDetail: todoDetail, buildTodoRows: buildTodoRows, parseQuick: parseQuick, quickSummary: quickSummary, cyclePriority: cyclePriority, toggleDone: toggleDone, itemTodoRows: itemTodoRows, buildTodoEditor: buildTodoEditor,
    buildStatusChoice: buildStatusChoice, buildPriorityChoice: buildPriorityChoice, buildStatusSettings: buildStatusSettings, priorityName: priorityName
  }
}
