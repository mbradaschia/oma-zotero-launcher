// Tasks (to-dos): statuses in five groups, the tasks file, status cycling and reordering (a task
// past the first or last of its status changes status), due dates, and the rows (lib/Todos.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../lib/Todos.js");
const V = require("../lib/Views.js");
const Fuzzy = require("../lib/Fuzzy.js");

const now = new Date(2026, 8, 30, 10, 0); // Wed 30 Sep 2026
const S = T.statusesOf(null);
const ids = (list) => list.map((t) => t.id);

test("statuses: defaults in group order; add, rename, remove (its tasks move), reorder across groups", () => {
  assert.deepEqual(S.map((s) => s.id), ["to_read", "idea", "next", "reading", "writing", "waiting", "done"]);
  const added = T.addStatus(S, "Reviewing", "active");
  assert.deepEqual(added.statuses.map((s) => s.id), ["to_read", "idea", "next", "reading", "writing", "reviewing", "waiting", "done"]);
  assert.equal(T.addStatus(added.statuses, "Reviewing", "active").status.id, "reviewing_2");
  assert.ok(T.addStatus(S, " ", "active").error);
  assert.equal(T.renameStatus(S, "idea", "Someday").statuses[1].name, "Someday");
  const rm = T.removeStatus(S, "reading");
  assert.deepEqual([rm.statuses.length, rm.moveTo], [6, "writing"]); // another of Active
  assert.equal(T.removeStatus(S, "next").moveTo, "to_read"); // the only one of its group: the first
  assert.ok(T.removeStatus([S[0]], "to_read").error);
  // Shift+↑/↓: within the group, then into the next one
  assert.deepEqual(T.moveStatus(S, "writing", -1).map((s) => s.id).slice(3, 5), ["writing", "reading"]);
  const down = T.moveStatus(S, "writing", 1);
  assert.deepEqual([T.statusById(down, "writing").group, down.map((s) => s.id).indexOf("writing")], ["waiting", 4]); // first of Waiting
  const up = T.moveStatus(S, "next", -1);
  assert.deepEqual([T.statusById(up, "next").group, up.map((s) => s.id)[2]], ["backlog", "next"]); // last of Backlog
  assert.deepEqual(T.moveStatus(S, "to_read", -1), S); // nowhere to go
  // the settings' statuses win, in group order
  assert.deepEqual(T.statusesOf({ tasks: { statuses: [{ id: "b", name: "B", group: "completed" }, { id: "a", name: "A", group: "next" }] } }).map((s) => s.id), ["a", "b"]);
});

test("tasks: add (top of Backlog), update, cycle status with Tab, reorder across statuses", () => {
  let todos = [];
  let r = T.addTodo(todos, { description: "Read the method section", item: { key: "VH56BBHJ", libraryID: 1, title: "Managing", cite: "Sirmon et al., 2007" },
    context: { kind: "note", key: "N1", libraryID: 1, title: "Summary" } }, S, now);
  todos = r.todos;
  assert.deepEqual([r.todo.status, r.todo.item.cite, r.todo.context.kind], ["to_read", "Sirmon et al., 2007", "note"]);
  todos = T.addTodo(todos, { description: "Write the review" }, S, now).todos;
  todos = T.addTodo(todos, { description: "Email the author", status: "waiting" }, S, now).todos;
  const [c, b, a] = todos.map((t) => t.id); // newest first
  // Tab / Shift+Tab: the next or previous status, wrapping
  todos = T.cycleStatus(todos, a, S, 1, now);
  assert.equal(todos.find((t) => t.id === a).status, "idea");
  assert.equal(T.cycleStatus(todos, c, S, -1, now).find((t) => t.id === c).status, "writing");
  assert.equal(T.cycleStatus(T.updateTodo(todos, c, { status: "done" }, now), c, S, 1, now).find((t) => t.id === c).status, "to_read");
  // the display order: by status, then yours
  todos = T.updateTodo(todos, a, { status: "to_read" }, now);
  assert.deepEqual(ids(T.displayOrder(todos, S)), [b, a, c]); // to_read: b, a; waiting: c
  // Shift+↓ within a status, then past its last: into the next status
  todos = T.moveTodo(todos, b, S, 1, now);
  assert.deepEqual(ids(T.displayOrder(todos, S)), [a, b, c]);
  todos = T.moveTodo(todos, b, S, 1, now);
  assert.deepEqual([todos.find((t) => t.id === b).status, ids(T.displayOrder(todos, S))], ["idea", [a, b, c]]); // first (and only) of Idea
  // Shift+↑ past the first of a status: the end of the previous one
  todos = T.moveTodo(todos, c, S, -1, now);
  assert.equal(todos.find((t) => t.id === c).status, "writing"); // the status just before Waiting
  assert.deepEqual(T.moveTodo(todos, a, S, -1, now), todos); // the very first: stays
  // the footer's badges: open tasks per group
  assert.deepEqual(T.groupCounts(todos, S), [{ group: "backlog", name: "Backlog", count: 2 }, { group: "active", name: "Active", count: 1 }]);
  // the file round-trips, dropping what isn't a task
  const back = T.parseTodos(T.serializeTodos(todos).replace('"todos": [', '"todos": [{"nope": 1},'));
  assert.deepEqual(back, todos);
  assert.deepEqual(T.parseTodos("not json"), []);
  assert.deepEqual(T.removeTodo(todos, a).length, 2);
});

test("due dates: typed forms, and how they read", () => {
  assert.deepEqual(T.parseDue("2026-10-03", now), { value: "2026-10-03" });
  assert.deepEqual(T.parseDue("today", now), { value: "2026-09-30" });
  assert.deepEqual(T.parseDue("tomorrow", now), { value: "2026-10-01" });
  assert.deepEqual(T.parseDue("+2w", now), { value: "2026-10-14" });
  assert.deepEqual(T.parseDue("fri", now), { value: "2026-10-02" });
  assert.deepEqual(T.parseDue("wednesday", now), { value: "2026-10-07" }); // today is Wednesday: the next one
  assert.deepEqual(T.parseDue("", now), { value: "" });
  assert.ok(T.parseDue("2026-02-31", now).error && T.parseDue("soon", now).error);
  assert.deepEqual(["2026-09-28", "2026-09-30", "2026-10-01", "2026-10-03", "2026-10-20"].map((d) => T.dueText(d, now)),
    ["overdue 2d", "due today", "due tomorrow", "due in 3d", "due 20 Oct"]);
});

test("rows: the Tasks view by status, a paper's Tasks section, a task's page, Settings › Tasks", () => {
  let todos = T.addTodo([], { description: "Read it", item: { key: "VH56BBHJ", libraryID: 1, title: "Managing", cite: "Sirmon et al., 2007" } }, S, now).todos;
  todos = T.addTodo(todos, { description: "Plan the chapter", status: "next" }, S, now).todos;
  todos = T.updateTodo(todos, todos[0].id, { due: "2026-09-28", priority: "high" }, now);
  const rows = T.buildTodoRows(todos, S, "", "#fff", Fuzzy.filter, V.listRow, now);
  // nothing typed: only the tasks (the search box's placeholder says how to add one)
  assert.deepEqual(rows.map((r) => [r.section, r.label]), [["Backlog · To read", "Read it"], ["Next · Next", "Plan the chapter"]]);
  assert.deepEqual([rows[1].detail, rows[1].badge], ["overdue 2d", "overdue 2d"]);
  assert.equal(rows[0].detail, "Sirmon et al., 2007");
  assert.deepEqual(T.buildTodoRows([], S, "", "#fff", Fuzzy.filter, V.listRow, now), []);
  // typing: an Add row for it (with what it will set), then the tasks it matches
  const typed = T.buildTodoRows(todos, S, "chapter", "#fff", Fuzzy.filter, V.listRow, now);
  assert.deepEqual(typed.map((r) => [r.rowId, r.label]), [["todo-quick", "Add “chapter”"], ["todo", "Plan the chapter"]]);
  assert.equal(T.buildTodoRows(todos, S, "Email Ana #waiting !high @tomorrow", "#fff", Fuzzy.filter, V.listRow, now)[0].detail, "Waiting · high · due tomorrow · Enter adds and opens it, Shift+Enter just adds it");
  // a paper's section: its tasks, then New task…
  const mine = T.itemTodoRows(todos, { key: "VH56BBHJ", libraryID: 1 }, S, V.listRow, now);
  assert.deepEqual(mine.map((r) => [r.section, r.rowId, r.label]), [["Tasks", "todo", "Read it"], ["Tasks", "todo-new", "New task…"]]);
  assert.deepEqual([mine[0].pill, mine[0].detail], ["To read", ""]); // its status as a pill
  // its page
  const page = T.buildTodoEditor(todos.find((t) => t.item), S, V.listRow, now);
  assert.deepEqual(page.map((r) => r.rowId), ["todo-desc", "todo-status", "todo-priority", "todo-due", "todo-notes", "todo-item", "todo-pick", "todo-unlink", "todo-delete"]);
  // a form: the description and notes edited in place, status and priority as pills
  assert.deepEqual(page.slice(0, 5).map((r) => [r.field, r.editText, r.pillOn]), [
    ["text", "Read it", ""], ["pills", "", "To read"], ["pills", "", "None"], ["", "", ""], ["multiline", "", ""],
  ]);
  assert.equal(page[1].pills.split("|")[0], "To read");
  assert.equal(page[2].pills, "None|Low|Medium|High");
  assert.equal(T.buildTodoEditor(todos.find((t) => !t.item), S, V.listRow, now).find((r) => r.rowId === "todo-pick").label, "Pick a paper…");
  // Settings › Tasks: a section per group, its statuses, and Add a status…
  const st = T.buildStatusSettings(S, todos, V.listRow);
  assert.deepEqual([...new Set(st.map((r) => r.section))], ["Backlog", "Next", "Active", "Waiting", "Completed"]);
  assert.deepEqual(st.filter((r) => r.section === "Backlog").map((r) => r.label), ["To read", "Idea", "Add a status to Backlog…"]);
  assert.match(st[0].detail, /^1 task · /);
});

test("quick add: one line with #status !priority @due; ! cycles the priority, d toggles done", () => {
  const q = T.parseQuick("Read the method section #read !! @fri", S, now);
  assert.deepEqual(q, { description: "Read the method section", status: "reading", priority: "medium", due: "2026-10-02", problems: [] });
  assert.deepEqual(T.parseQuick("x !high #to_read @+1w", S, now), { description: "x", status: "to_read", priority: "high", due: "2026-10-07", problems: [] });
  assert.deepEqual(T.parseQuick("x !!! !l", S, now).priority, "low"); // the last one wins
  // a #word that isn't a status, and a date that isn't one, stay in the text (and say so)
  assert.deepEqual(T.parseQuick("tag #rbv @soon", S, now), { description: "tag #rbv @soon", status: "", priority: "", due: "", problems: ["@soon: not a date"] });
  assert.equal(T.quickSummary(T.parseQuick("x", S, now), S, now), "To read");
  let todos = T.addTodo([], { description: q.description, status: q.status, priority: q.priority, due: q.due }, S, now).todos;
  assert.deepEqual([todos[0].status, todos[0].priority, todos[0].due], ["reading", "medium", "2026-10-02"]);
  const id = todos[0].id;
  todos = T.cyclePriority(todos, id, now);
  assert.equal(todos[0].priority, "high");
  assert.equal(T.cyclePriority(todos, id, now)[0].priority, "");
  todos = T.toggleDone(todos, id, S, now);
  assert.deepEqual([todos[0].status, todos[0].before], ["done", "reading"]);
  todos = T.toggleDone(todos, id, S, now);
  assert.deepEqual([todos[0].status, todos[0].before], ["reading", ""]); // back where it was
});

test("the due date's calendar: six weeks from Monday; days and months move, a month's end kept", () => {
  const m = T.calendarMonth("2026-09-30");
  assert.equal(m.title, "September 2026");
  assert.equal(m.days.length, 42);
  assert.deepEqual(m.days[0], { date: "2026-08-31", day: 31, inMonth: false }); // Sep 1 2026 is a Tuesday
  assert.deepEqual(m.days[1], { date: "2026-09-01", day: 1, inMonth: true });
  assert.equal(T.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(T.addDays("2026-03-01", -7), "2026-02-22");
  assert.equal(T.addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(T.addMonths("2026-01-15", -1), "2025-12-15");
});

test("priority cycles both ways", () => {
  let todos = T.addTodo([], { description: "x" }, S, now).todos;
  const id = todos[0].id;
  todos = T.cyclePriority(todos, id, now, -1);
  assert.equal(todos[0].priority, "high");
  todos = T.cyclePriority(todos, id, now);
  assert.equal(todos[0].priority, "");
});

test("@ in a new task's line: blocks by section, each kind once; the line keeps them as words", () => {
  const nowD = new Date(2026, 9, 1); // a Thursday
  const draft = { item: { key: "AAAA1111", libraryID: 1, cite: "Adner & Helfat (2003)", title: "Corporate effects" } };
  const all = T.buildTaskTagRows("", draft, S, "", V.listRow, nowD);
  assert.deepEqual([...new Set(all.map((r) => r.section))], ["Actions", "Citation", "Status", "Due", "Priority"]);
  assert.equal(all.find((r) => r.section === "Citation").value, "{Adner & Helfat (2003)}");
  assert.deepEqual(all.filter((r) => r.section === "Due").slice(0, 3).map((r) => r.value), ["@today", "@tomorrow", "@fri"]);
  const left = T.buildTaskTagRows("check {Read} #next !high", draft, S, "", V.listRow, nowD);
  assert.deepEqual([...new Set(left.map((r) => r.section))], ["Citation", "Due"]);
  assert.deepEqual(T.buildTaskTagRows("", draft, S, "week", V.listRow, nowD).map((r) => r.label), ["End of the week", "In a week", "In two weeks"]);
  const line = "check {Read} {Adner & Helfat (2003)} #reading !high @fri ";
  const q = T.parseQuick(line, S, nowD);
  assert.deepEqual([q.description, q.status, q.priority, q.due], ["check Read Adner & Helfat (2003)", "reading", "high", "2026-10-02"]);
  assert.deepEqual(T.taskSegments(line, line.length, S, nowD).filter((x) => x.block).map((x) => x.label),
    ["Read", "Adner & Helfat (2003)", "Status: Reading", "Priority: High", "Due tomorrow"]);
  // a block being typed stays text
  assert.equal(T.taskSegments("x #rea", 6, S, nowD).some((x) => x.block), false);
});

test("task marks: papers with open tasks, overdue when one is past its date; completed ones don't count", () => {
  const nowD = new Date(2026, 9, 1);
  const item = { key: "AAAA1111", libraryID: 1 };
  let todos = T.addTodo([], { description: "a", item, due: "2026-09-30" }, S, nowD).todos;
  todos = T.addTodo(todos, { description: "b", item }, S, nowD).todos;
  todos = T.addTodo(todos, { description: "c", item: { key: "BBBB2222", libraryID: 1 }, status: "done" }, S, nowD).todos;
  assert.deepEqual(T.taskMarks(todos, S, nowD), { "1:AAAA1111": { count: 2, overdue: true } });
});

test("actions for @: yours from the settings (kept by the settings file), else the defaults; Settings › Tasks lists them", () => {
  const C = require("../lib/Client.js");
  const Se = require("../lib/Settings.js");
  assert.deepEqual(T.actionsOf({}), T.TASK_ACTIONS);
  const n = C.normalizeSettings({ tasks: { actions: ["Read", " Full  review ", "read", "{x}", 3] } });
  assert.deepEqual(n.settings.tasks.actions, ["Read", "Full review", "x"]);
  assert.ok(n.problems.some((p) => /tasks\.actions\[2\]/.test(p)));
  assert.deepEqual(T.actionsOf(n.settings), ["Read", "Full review", "x"]);
  // the statuses and the actions survive each other in the file
  const both = C.normalizeSettings({ tasks: { statuses: [{ id: "to_read", name: "To read", group: "backlog" }], actions: ["Skim"] } }).settings;
  const file = Se.toFile(both);
  assert.deepEqual([file.tasks.actions, file.tasks.statuses.length], [["Skim"], 1]);
  // a custom action is an action block, not the citation
  assert.equal(T.taskBlockKinds("{Skim}", S, ["Skim"]).action, true);
  assert.equal(T.buildTaskTagRows("", {}, S, "", V.listRow, new Date(), ["Skim"]).filter((r) => r.section === "Actions").length, 1);
  const rows = T.buildActionSettings(["Read", "Skim"], V.listRow);
  assert.deepEqual(rows.map((r) => [r.rowId, r.label]), [["task-action", "Read"], ["task-action", "Skim"], ["task-action-add", "Add an action…"]]);
});

test("task statuses as Zotero tags: what each paper gains and loses, and a full sync", () => {
  const nowD = new Date(2026, 9, 2);
  const A = { key: "AAAA1111", libraryID: 1 }, B = { key: "BBBB2222", libraryID: 1 };
  let before = T.addTodo([], { description: "a", item: A, status: "to_read" }, S, nowD).todos;
  before = T.addTodo(before, { description: "b", item: A, status: "reading" }, S, nowD).todos;
  before = T.addTodo(before, { description: "free" }, S, nowD).todos; // no paper: no tag
  // one of A's tasks moves on; a new task about B
  let after = T.updateTodo(before, before.find((t) => t.description === "a").id, { status: "reading" }, nowD);
  after = T.addTodo(after, { description: "c", item: B, status: "next" }, S, nowD).todos;
  const ch = T.taskTagChanges(before, S, after, S);
  assert.deepEqual(ch.map((c) => [c.item.key, c.add, c.remove]).sort(), [["AAAA1111", [], ["t/To read"]], ["BBBB2222", ["t/Next"], []]]);
  // a status renamed between the lists: its tag follows
  const S2 = S.map((s) => (s.id === "reading" ? Object.assign({}, s, { name: "Reading now" }) : s));
  assert.deepEqual(T.taskTagChanges(after, S, after, S2).map((c) => [c.item.key, c.add, c.remove]), [["AAAA1111", ["t/Reading now"], ["t/Reading"]]]);
  // nothing changed: nothing to do
  assert.deepEqual(T.taskTagChanges(after, S, after, S), []);
  // a full sync: each paper's tags, the other statuses' removed
  const sync = T.taskTagSync(after, S);
  const a = sync.find((x) => x.item.key === "AAAA1111");
  assert.deepEqual(a.add, ["t/Reading"]);
  assert.ok(a.remove.includes("t/To read") && !a.remove.includes("t/Reading"));
});

test("Zotero → the lists: renames follow, new s/ and t/ tags join, deletes don't", () => {
  const paper = ["pending", "skimmed"];
  const r = T.statusListsFromZotero(paper, S,
    ["s/pending", "s/skim", "s/to cite", "t/Next", "t/Drafting", "notion", "s/"],
    [{ kind: "rename", from: "s/skimmed", name: "s/skim" }, { kind: "rename", from: "t/Reading", name: "t/Reading now" },
      { kind: "delete", name: "s/pending" }, { kind: "add", name: "t/Waiting" }],
    "s/", "t/");
  assert.equal(r.changed, true);
  assert.deepEqual(r.paper, ["pending", "skim", "to cite"]); // renamed in place, a new one at the end, the deleted one kept
  assert.equal(r.statuses.find((s) => s.id === "reading").name, "Reading now");
  const drafting = r.statuses.find((s) => s.name === "Drafting");
  assert.equal(drafting.group, "backlog");
  assert.equal(r.statuses.filter((s) => s.name === "Waiting").length, 1); // there already: not twice
  // added, then renamed, in Zotero: only the new name (the log's adds aren't replayed)
  const ar = T.statusListsFromZotero([], S, ["s/new"], [{ kind: "add", name: "s/old" }, { kind: "rename", from: "s/old", name: "s/new" }], "s/", "t/");
  assert.deepEqual(ar.paper, ["new"]);
  // a rename into an existing status: merged (the old one goes)
  assert.deepEqual(T.statusListsFromZotero(["a", "b"], S, [], [{ kind: "rename", from: "s/a", name: "s/b" }], "s/", "t/").paper, ["b"]);
  // the launcher's own changes come back as no-ops
  const same = T.statusListsFromZotero(["skim"], S, ["s/skim"], [{ kind: "rename", from: "s/skimmed", name: "s/skim" }], "s/", "t/");
  assert.equal(same.changed, false);
});
