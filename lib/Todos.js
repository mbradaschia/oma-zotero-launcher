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

var ICON = { task: "\uf4a0", add: "\uf44d", done: "\uf49e", item: "\uf4a5", note: "\uf24a", chat: "\uf442", status: "\uf412", due: "\uf455", priority: "\uf46e", notes: "\uf448", trash: "\uf48e", group: "\uf413" }

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
// The actions @ offers in a new task's line: yours (Settings › Tasks), else the defaults.
// The default task's description template (Settings › Tasks), else "Read {cite}".
function defaultTemplateOf(settings) {
  var t = settings && settings.tasks && typeof settings.tasks.defaultTask === "string" ? settings.tasks.defaultTask.trim() : ""
  return t || DEFAULT_TASK_TEMPLATE
}

function actionsOf(settings) {
  var list = settings && settings.tasks && Array.isArray(settings.tasks.actions) ? settings.tasks.actions : null
  return list ? list.slice() : TASK_ACTIONS.slice()
}

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
    isDefault: !!t.isDefault, // the paper's default task (Shift+Alt+→ / ←): its status is the paper's task status
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
    priority: fields.priority || "", due: fields.due || "", item: fields.item || null, context: fields.context || null, isDefault: !!fields.isDefault, created: now.toISOString(), updated: now.toISOString() })
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

// ---------------------------------------------------------------- a paper's default task

// A paper's default task: a task status applied to the paper itself, the paper being the to-do ("this
// paper: Reading"). It's a task like the others (status, due date, priority, notes; in Tasks under its
// status), one per paper: the one marked as such, else the paper's first open task. item: { key, libraryID }.
var DEFAULT_TASK_TEMPLATE = "Read {cite}"

function samePaper(t, item) {
  return !!(t.item && item && t.item.key === item.key && (Number(t.item.libraryID) || 1) === (Number(item.libraryID) || 1))
}

function defaultTaskOf(todos, item, statuses) {
  var mine = (todos || []).filter(function (t) { return samePaper(t, item) })
  var marked = mine.filter(function (t) { return t.isDefault })[0]
  if (marked) return marked
  return displayOrder(mine, statuses).filter(function (t) { return statusOfTodo(t, statuses).group !== "completed" })[0] || null
}

// Shift+Alt+→ / ←: the next or previous status. No task yet: the first status (the press creates it).
// Past either end (the "none" step): done, rather than deleted; from done, round again.
function nextDefaultStatus(statuses, currentId, delta) {
  if (!statuses.length) return ""
  var i = -1
  for (var k = 0; k < statuses.length; k++) if (statuses[k].id === currentId) i = k
  if (i < 0) return statuses[0].id
  var done = statuses.filter(function (s) { return s.group === "completed" })[0]
  var j = i + delta
  if (j >= 0 && j < statuses.length) return statuses[j].id
  if (done && done.id !== currentId) return done.id
  return statuses[((j % statuses.length) + statuses.length) % statuses.length].id
}

// The new default task's description, from the template (Settings › Tasks): {cite} the paper's citation
// ("Adner & Helfat (2003)", else its title), {title} its title.
function defaultTaskDescription(template, item) {
  var t = String(template || "").trim() || DEFAULT_TASK_TEMPLATE
  var title = String((item && item.title) || "").trim()
  var cite = String((item && item.cite) || "").trim() || title
  var out = t.replace(/\{cite\}/g, cite).replace(/\{title\}/g, title).replace(/\s+/g, " ").trim()
  return out || cite || "Read it"
}

// The paper's default task set to `statusId`: created (marked default, at the top of its status) when it
// has none. → { todos, todo, created }
function setDefaultTask(todos, item, statusId, statuses, template, now) {
  var t = defaultTaskOf(todos, item, statuses)
  if (t) {
    var list = updateTodo(todos, t.id, { status: statusId, isDefault: true, before: statusById(statuses, statusId) && statusById(statuses, statusId).group === "completed" ? statusOfTodo(t, statuses).id : t.before }, now)
    return { todos: list, todo: list.filter(function (x) { return x.id === t.id })[0], created: false }
  }
  var ref = { key: String(item.key), libraryID: Number(item.libraryID) || 1, title: String(item.title || "") }
  if (item.cite) ref.cite = String(item.cite)
  var r = addTodo(todos, { description: defaultTaskDescription(template, item), status: statusId, item: ref, isDefault: true }, statuses, now)
  return { todos: r.todos, todo: r.todo, created: true }
}

// Every paper's default task status, for the pills on its rows: { "libraryID:key": status }.
function defaultTaskStatuses(todos, statuses) {
  var out = {}
  var seen = {}
  ;(todos || []).forEach(function (t) {
    if (!t.item || !t.item.key) return
    var id = (Number(t.item.libraryID) || 1) + ":" + t.item.key
    if (seen[id]) return
    seen[id] = true
    var d = defaultTaskOf(todos, t.item, statuses)
    if (d) out[id] = statusOfTodo(d, statuses)
  })
  return out
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
// The papers with open tasks (not in a Completed status): { "libraryID:key": { count, overdue } },
// overdue when one is due before today.
function taskMarks(todos, statuses, now) {
  var today = ymd(now || new Date())
  var out = {}
  ;(todos || []).forEach(function (t) {
    if (!t.item || !t.item.key) return
    var st = statusOfTodo(t, statuses)
    if (st && st.group === "completed") return
    var id = (Number(t.item.libraryID) || 1) + ":" + t.item.key
    var m = out[id] || (out[id] = { count: 0, overdue: false })
    m.count++
    if (t.due && t.due < today) m.overdue = true
  })
  return out
}

// Settings › Tasks, after the statuses: the actions @ offers, in order (Enter renames or removes
// one, Shift+↑/↓ moves it), and Add an action….
function buildActionSettings(actions, row) {
  var rows = actions.map(function (a) {
    return row({ section: "Actions (@ in a new task)", rowId: "task-action", icon: ICON.task, label: a, detail: "Enter renames or removes it · Shift+↑↓ moves it", available: true, submenu: true, value: a })
  })
  rows.push(row({ section: "Actions (@ in a new task)", rowId: "task-action-add", icon: ICON.add, label: "Add an action…", detail: "Such as “Read”, “Full review”, “Download the PDF”", available: true, submenu: true }))
  return rows
}

// Settings › Tasks, last: what a paper's default task is called when Shift+Alt+→ makes it.
function buildDefaultTaskSettings(settings, row) {
  var t = defaultTemplateOf(settings)
  return [row({ section: "A paper's default task", rowId: "task-default", icon: ICON.task, label: "Its description", available: true, submenu: true, value: t,
    detail: "“" + t + "” · {cite} is the paper's citation, {title} its title · Shift+Alt+→ on a paper makes it" })]
}

// ---------------------------------------------------------------- task statuses as Zotero tags

// A paper with tasks carries "t/<status>" for each status its tasks have ("t/Reading"), so Zotero
// (and its search) sees them too. Kept in step as tasks change: [{ item: { key, libraryID }, add, remove }].
var TASK_TAG_PREFIX = "t/"

function paperId(t) { return t.item && t.item.key ? (Number(t.item.libraryID) || 1) + ":" + t.item.key : "" }

// { "libraryID:key": { item, tags: { "t/Reading": true } } } for the papers tasks are about.
function taskTagsByPaper(todos, statuses) {
  var out = {}
  ;(todos || []).forEach(function (t) {
    var id = paperId(t)
    if (!id) return
    var p = out[id] || (out[id] = { item: { key: t.item.key, libraryID: Number(t.item.libraryID) || 1 }, tags: {} })
    p.tags[TASK_TAG_PREFIX + statusOfTodo(t, statuses).name] = true
  })
  return out
}

// What changed between two task lists (each read with its own statuses: a status renamed or removed
// in between): the t/ tags each paper gains and loses.
function taskTagChanges(before, beforeStatuses, after, afterStatuses) {
  var a = taskTagsByPaper(before, beforeStatuses), b = taskTagsByPaper(after, afterStatuses)
  var ids = {}
  Object.keys(a).concat(Object.keys(b)).forEach(function (id) { ids[id] = true })
  var out = []
  Object.keys(ids).forEach(function (id) {
    var was = (a[id] || {}).tags || {}, now = (b[id] || {}).tags || {}
    var add = Object.keys(now).filter(function (t) { return !was[t] })
    var remove = Object.keys(was).filter(function (t) { return !now[t] })
    if (add.length || remove.length) out.push({ item: (b[id] || a[id]).item, add: add, remove: remove })
  })
  return out
}

// Every paper with tasks, its t/ tags set from scratch: the ones it should have, and the other
// statuses' removed (a paper tagged before a status changed elsewhere).
function taskTagSync(todos, statuses) {
  var all = statuses.map(function (s) { return TASK_TAG_PREFIX + s.name })
  var by = taskTagsByPaper(todos, statuses)
  return Object.keys(by).map(function (id) {
    var p = by[id]
    return { item: p.item, add: Object.keys(p.tags), remove: all.filter(function (t) { return !p.tags[t] }) }
  })
}

// Zotero → the launcher's lists. A tag renamed in Zotero renames its status; an s/… or t/… tag that
// isn't a status yet (made in Zotero, or there from before) becomes one: a paper status, or a task
// status in Backlog. Deletes aren't followed: Zotero says a tag is gone when it purges unused tags,
// which can come long after a paper merely changed status. paper: the paper statuses' names;
// existing: every prefixed tag in Zotero now; changes: the bridge's log (kind, from, name).
// → { paper, statuses, changed }
function statusListsFromZotero(paper, statuses, existing, changes, paperPrefix, taskPrefix) {
  var out = { paper: (paper || []).slice(), statuses: (statuses || []).slice(), changed: false }
  var lower = function (x) { return String(x).toLowerCase() }
  var nameOf = function (tag, prefix) { return lower(tag).indexOf(lower(prefix)) === 0 ? String(tag).slice(prefix.length).trim() : null }
  var paperIndex = function (n) { for (var i = 0; i < out.paper.length; i++) if (lower(out.paper[i]) === lower(n)) return i; return -1 }
  var task = function (n) { return out.statuses.filter(function (x) { return lower(x.name) === lower(n) })[0] }
  ;(changes || []).forEach(function (c) {
    if (c.kind !== "rename") return
    var a = nameOf(c.from, paperPrefix), b = nameOf(c.name, paperPrefix)
    if (a !== null && b) {
      var i = paperIndex(a)
      if (i >= 0 && lower(a) !== lower(b)) {
        if (paperIndex(b) >= 0) out.paper.splice(i, 1)
        else out.paper[i] = b
        out.changed = true
      } else if (i >= 0 && a !== b) { out.paper[i] = b; out.changed = true } // only its case
    }
    a = nameOf(c.from, taskPrefix); b = nameOf(c.name, taskPrefix)
    if (a !== null && b) {
      var s = task(a)
      if (s && !task(b)) {
        out.statuses = out.statuses.map(function (x) { return x.id === s.id ? { id: x.id, name: b.slice(0, 40), group: x.group } : x })
        out.changed = true
      }
    }
  })
  // what Zotero has now (not the log's adds: a name added, then renamed, would come back)
  ;(existing || []).forEach(function (tag) {
    var n = nameOf(tag, paperPrefix)
    if (n && paperIndex(n) < 0) { out.paper.push(n); out.changed = true }
    n = nameOf(tag, taskPrefix)
    if (n && !task(n)) {
      var r = addStatus(out.statuses, n, "backlog")
      if (!r.error) { out.statuses = r.statuses; out.changed = true }
    }
  })
  return out
}

// ---------------------------------------------------------------- @ in a new task's line

// What a task about a paper usually asks: @ › Actions puts one in as a block ({Read}).
var TASK_ACTIONS = ["Read", "Skim", "Full review", "Download the PDF", "Summarize", "Annotate", "Write notes", "Check the method",
  "Extract the data", "Compare", "Cite it", "Discuss"]

// Quick dates for @ › Due: [label, token]. End of the week is Friday; the month's end its last day.
function quickDates(now) {
  now = now || new Date()
  var d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  var monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  var nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate()))
  return [
    ["Today", "@today"], ["Tomorrow", "@tomorrow"], ["End of the week", "@fri"], ["Next Monday", "@mon"],
    ["In a week", "@+1w"], ["In two weeks", "@+2w"], ["End of the month", "@" + ymd(monthEnd)], ["In a month", "@" + ymd(nextMonth)]
  ]
}

// The blocks already in a task's line, by kind: those kinds don't show again in the @ menu.
function taskBlockKinds(text, statuses, actions) {
  var kinds = {}
  actions = actions || TASK_ACTIONS
  String(text || "").replace(/\{([^}]*)\}/g, function (all, inner) {
    kinds[actions.indexOf(inner) >= 0 ? "action" : "cite"] = true
    return ""
  }).split(/\s+/).forEach(function (w) {
    if (/^#./.test(w)) kinds.status = true
    else if (/^!(!{0,2}|low|lo|l|med|medium|m|high|hi|h)$/i.test(w)) kinds.priority = true
    else if (/^@./.test(w)) kinds.due = true
  })
  return kinds
}

// The @ menu in a new task's line: what it can hold, by section, but the kinds it already has.
// draft: the task's paper ({ item: { cite, title } }). → rows; value is the token to put in.
function buildTaskTagRows(text, draft, statuses, query, row, now, actions) {
  actions = actions || TASK_ACTIONS
  var have = taskBlockKinds(text, statuses, actions)
  var rows = []
  var add = function (section, icon, label, detail, token) { rows.push(row({ section: section, rowId: "task-tag", icon: icon, label: label, detail: detail, available: true, value: token })) }
  if (!have.action) actions.forEach(function (a) { add("Actions", ICON.task, a, "", "{" + a + "}") })
  var item = draft && draft.item
  if (!have.cite && item && (item.cite || item.title)) add("Citation", ICON.item, item.cite || item.title, item.cite ? item.title || "" : "", "{" + (item.cite || item.title) + "}")
  if (!have.status) statuses.forEach(function (s) { add("Status", ICON.status, s.name, groupName(s.group), "#" + s.id) })
  if (!have.due) quickDates(now).forEach(function (q) {
    var d = parseDue(q[1].slice(1), now)
    add("Due", ICON.due, q[0], d.value ? d.value + " · " + dueText(d.value, now) : "", q[1])
  })
  if (!have.priority) PRIORITIES.forEach(function (p) { if (p[0]) add("Priority", ICON.priority, p[1], "", "!" + p[0]) })
  var q = String(query || "").trim().toLowerCase()
  if (!q) return rows
  return rows.filter(function (r) { return (r.label + " " + r.detail + " " + r.section).toLowerCase().indexOf(q) >= 0 })
}

// A task's line as the search box draws it: its blocks ({Read}, #status, !priority, @due) as
// labelled pills, the rest as text; a block being typed (the caret in it) stays text.
function taskSegments(text, caret, statuses, now, actions) {
  actions = actions || TASK_ACTIONS
  text = String(text == null ? "" : text)
  caret = caret == null ? text.length : Number(caret)
  var segs = []
  var plain = function (s, at) {
    if (!s) return
    var last = segs[segs.length - 1]
    if (last && !last.block) { last.text += s; last.label += s; last.end += s.length; return }
    segs.push({ text: s, label: s, start: at, end: at + s.length, block: false, role: "" })
  }
  var re = /\{[^}]*\}|[#!@][^\s{}]+/g
  var m, at = 0
  while ((m = re.exec(text))) {
    var w = m[0], i = m.index, j = i + w.length
    var label = null, role = "field"
    if (w.charAt(0) === "{") {
      if (w.length > 2) { label = w.slice(1, -1); role = actions.indexOf(label) >= 0 ? "op" : "quote" }
    } else if (caret <= i || caret > j) {
      var q = parseQuick(w, statuses, now)
      if (q.status) label = "Status: " + (statusById(statuses, q.status) || { name: q.status }).name
      else if (q.priority) label = "Priority: " + priorityName(q.priority)
      else if (q.due) { var when = dueText(q.due, now); label = when.charAt(0).toUpperCase() + when.slice(1) }
    }
    if (label === null) continue
    plain(text.slice(at, i), at)
    segs.push({ text: w, label: label, start: i, end: j, block: true, role: role })
    at = j
  }
  plain(text.slice(at), at)
  return segs
}

// ---------------------------------------------------------------- the due date's calendar

function isoDate(d) {
  var p = function (n) { return (n < 10 ? "0" : "") + n }
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate())
}

function fromIso(iso) {
  var p = String(iso || "").split("-").map(Number)
  return p.length === 3 && p[0] ? new Date(p[0], p[1] - 1, p[2]) : null
}

// A day moved by n days, or by n months (the same day, or the month's last when it has fewer).
function addDays(iso, n) {
  var d = fromIso(iso)
  d.setDate(d.getDate() + n)
  return isoDate(d)
}

function addMonths(iso, n) {
  var d = fromIso(iso)
  var day = d.getDate()
  var first = new Date(d.getFullYear(), d.getMonth() + n, 1)
  var last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return isoDate(new Date(first.getFullYear(), first.getMonth(), Math.min(day, last)))
}

// The month of `iso` as six weeks, Monday first: [{ date, day, inMonth }] × 42; and its name.
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
function calendarMonth(iso) {
  var d = fromIso(iso)
  var first = new Date(d.getFullYear(), d.getMonth(), 1)
  var start = new Date(first)
  start.setDate(1 - ((first.getDay() + 6) % 7))
  var days = []
  for (var i = 0; i < 42; i++) {
    var c = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    days.push({ date: isoDate(c), day: c.getDate(), inMonth: c.getMonth() === d.getMonth() })
  }
  return { title: MONTHS[d.getMonth()] + " " + d.getFullYear(), days: days }
}

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
  // {Read}, {Adner & Helfat (2003)}: blocks put in with @, words of the description
  out.description = words.join(" ").replace(/[{}]/g, "").replace(/\s+/g, " ").trim()
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
function cyclePriority(todos, id, now, delta) {
  var order = ["", "low", "medium", "high"]
  var t = todos.filter(function (x) { return x.id === id })[0]
  if (!t) return todos
  var n = order.length
  return updateTodo(todos, id, { priority: order[((order.indexOf(t.priority) + (delta || 1)) % n + n) % n] }, now)
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
  // What you type is a new task, first (the search box's placeholder says how); nothing typed, only your tasks.
  var rows = typed && q.description
    ? [row({ rowId: "todo-quick", icon: ICON.add, label: "Add “" + q.description + "”", detail: quickSummary(q, statuses, now) + " · Enter adds and opens it, Shift+Enter just adds it" + (q.problems.length ? " · " + q.problems[0] : ""), available: true, value: typed })]
    : []
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
      pill: st.name, detail: [todoDetail(t, now, false)].filter(function (x) { return x && x !== "No paper" }).join(" · "), badge: todoBadge(t, now) })
  })
  rows.push(row({ section: "Tasks", rowId: "todo-new", icon: ICON.add, label: "New task…", detail: "About this paper (a on a note or chat: about it too)", available: true, submenu: true }))
  return rows
}

// A task's page: each field, Enter changes it.
function buildTodoEditor(t, statuses, row, now) {
  if (!t) return []
  var st = statusOfTodo(t, statuses)
  // A form: the description and notes are edited in place, status and priority are pills (Tab /
  // Shift+Tab on their row), the due date opens a calendar.
  var rows = [
    row({ rowId: "todo-desc", field: "text", icon: ICON.task, label: "Description", editText: t.description, available: true }),
    row({ rowId: "todo-status", field: "pills", icon: ICON.status, label: "Status", pills: statuses.map(function (x) { return x.name }).join("|"), pillOn: st.name, available: true }),
    row({ rowId: "todo-priority", field: "pills", icon: ICON.priority, label: "Priority", pills: PRIORITIES.map(function (p) { return p[1] }).join("|"), pillOn: priorityName(t.priority), pillKind: "priority", available: true }),
    row({ rowId: "todo-due", icon: ICON.due, label: "Due", detail: t.due ? t.due + " · " + dueText(t.due, now) : "No date", available: true, submenu: true }),
    row({ rowId: "todo-notes", field: "multiline", icon: ICON.notes, label: "Notes", editText: t.notes || "", available: true })
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
    taskMarks: taskMarks, statusListsFromZotero: statusListsFromZotero, TASK_TAG_PREFIX: TASK_TAG_PREFIX, taskTagChanges: taskTagChanges, taskTagSync: taskTagSync, TASK_ACTIONS: TASK_ACTIONS, actionsOf: actionsOf, buildActionSettings: buildActionSettings, quickDates: quickDates, taskBlockKinds: taskBlockKinds, buildTaskTagRows: buildTaskTagRows, taskSegments: taskSegments,
    DEFAULT_TASK_TEMPLATE: DEFAULT_TASK_TEMPLATE, buildDefaultTaskSettings: buildDefaultTaskSettings, defaultTaskOf: defaultTaskOf, nextDefaultStatus: nextDefaultStatus, defaultTaskDescription: defaultTaskDescription, setDefaultTask: setDefaultTask,
    defaultTaskStatuses: defaultTaskStatuses, defaultTemplateOf: defaultTemplateOf,
    isoDate: isoDate, addDays: addDays, addMonths: addMonths, calendarMonth: calendarMonth,
    buildStatusChoice: buildStatusChoice, buildPriorityChoice: buildPriorityChoice, buildStatusSettings: buildStatusSettings, priorityName: priorityName
  }
}
