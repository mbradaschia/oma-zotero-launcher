// A paper's default task (lib/Todos.js): a task status applied to the paper itself, moved with
// Shift+Alt+→ / ← (made on the first press), its pill on the rows, its setting and its menu row.
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../lib/Todos.js");
const C = require("../lib/Client.js");
const S = require("../lib/Settings.js");
const V = require("../lib/Views.js");

const statuses = T.statusesOf(null); // To read, Idea (backlog), Next, Reading, Writing (active), Waiting, Done
const paper = { key: "AAAA0001", libraryID: 1, title: "Corporate effects and dynamic managerial capabilities", cite: "Adner & Helfat (2003)" };
const now = new Date("2026-10-03T12:00:00Z");

test("the default task: the one marked, else the paper's first open task; none for a paper without tasks", () => {
  let todos = T.addTodo([], { description: "Check the method", status: "waiting", item: paper }, statuses, now).todos;
  todos = T.addTodo(todos, { description: "Old", status: "done", item: paper }, statuses, now).todos;
  assert.equal(T.defaultTaskOf(todos, paper, statuses).description, "Check the method"); // first open
  todos = T.addTodo(todos, { description: "Read it", status: "to_read", item: paper, isDefault: true }, statuses, now).todos;
  assert.equal(T.defaultTaskOf(todos, paper, statuses).description, "Read it"); // marked
  assert.equal(T.defaultTaskOf(todos, { key: "ZZZZZZZZ", libraryID: 1 }, statuses), null);
  const onlyDone = T.addTodo([], { description: "Old", status: "done", item: paper }, statuses, now).todos;
  assert.equal(T.defaultTaskOf(onlyDone, paper, statuses), null); // completed ones don't count, unless marked
  assert.equal(T.parseTodos(T.serializeTodos(todos)).filter((t) => t.isDefault).length, 1); // kept in the file
});

test("Shift+Alt+→ / ←: the first status, then along; past either end it's done, not deleted; from done, round again", () => {
  assert.equal(T.nextDefaultStatus(statuses, "", 1), "to_read");
  assert.equal(T.nextDefaultStatus(statuses, "", -1), "to_read");
  assert.equal(T.nextDefaultStatus(statuses, "to_read", 1), "idea");
  assert.equal(T.nextDefaultStatus(statuses, "reading", -1), "next");
  assert.equal(T.nextDefaultStatus(statuses, "to_read", -1), "done"); // the none step: done
  assert.equal(T.nextDefaultStatus(statuses, "done", 1), "to_read"); // done is last: round again
  assert.equal(T.nextDefaultStatus(statuses, "done", -1), "waiting");
  const noDone = statuses.filter((s) => s.group !== "completed");
  assert.equal(T.nextDefaultStatus(noDone, "waiting", 1), "to_read");
  assert.equal(T.nextDefaultStatus([], "", 1), "");
});

test("set: made with the template's description and marked; moved after that; done keeps where it was", () => {
  let r = T.setDefaultTask([], paper, "to_read", statuses, "Read {cite}", now);
  assert.equal(r.created, true);
  assert.deepEqual([r.todo.description, r.todo.status, r.todo.isDefault, r.todo.item.cite], ["Read Adner & Helfat (2003)", "to_read", true, "Adner & Helfat (2003)"]);
  r = T.setDefaultTask(r.todos, paper, "reading", statuses, "Read {cite}", now);
  assert.deepEqual([r.created, r.todos.length, r.todo.status], [false, 1, "reading"]);
  r = T.setDefaultTask(r.todos, paper, "done", statuses, "Read {cite}", now);
  assert.deepEqual([r.todo.status, r.todo.before], ["done", "reading"]); // d brings it back to Reading
  assert.equal(T.toggleDone(r.todos, r.todo.id, statuses, now)[0].status, "reading");
  assert.equal(T.defaultTaskDescription("Skim “{title}”", paper), "Skim “Corporate effects and dynamic managerial capabilities”");
  assert.equal(T.defaultTaskDescription("", { title: "T" }), "Read T");
  // the pills: every paper's default task status
  const pills = T.defaultTaskStatuses(r.todos, statuses);
  assert.deepEqual(Object.keys(pills), ["1:AAAA0001"]);
  assert.equal(pills["1:AAAA0001"].name, "Done");
  // its t/ tag follows, as for any task
  assert.deepEqual(T.taskTagChanges([], statuses, r.todos, statuses), [{ item: { key: "AAAA0001", libraryID: 1 }, add: ["t/Done"], remove: [] }]);
});

test("the setting (Settings › Tasks): the template, one line; Read {cite} by default", () => {
  assert.equal(T.defaultTemplateOf(C.normalizeSettings(null).settings), "Read {cite}");
  const mine = C.normalizeSettings({ tasks: { defaultTask: "Read {cite} closely" } }).settings;
  assert.equal(T.defaultTemplateOf(mine), "Read {cite} closely");
  assert.equal(S.toFile(mine).tasks.defaultTask, "Read {cite} closely");
  assert.match(C.normalizeSettings({ tasks: { defaultTask: "a\nb" } }).problems[0], /one line/);
  assert.equal(S.toFile(S.withValue(C.normalizeSettings(null).settings, "tasks.defaultTask", "Skim {title}")).tasks.defaultTask, "Skim {title}");
  assert.deepEqual(S.parseValue({ type: "template", label: "x" }, "  "), { value: undefined });
  const row = T.buildDefaultTaskSettings(mine, V.listRow)[0];
  assert.deepEqual([row.rowId, row.section, row.value], ["task-default", "A paper's default task", "Read {cite} closely"]);
});

test("a paper's menu: the Task row, its status as a pill; Enter (or Shift+Alt+→) moves it", () => {
  const details = { item: { itemType: "journalArticle" }, attachments: [], notes: [], tags: [], library: { editable: true } };
  const names = statuses.map((s) => s.name);
  let r = V.buildActions(details, "", [], "", false, false, { defaultTask: { status: "", statuses: names, description: "Read Adner & Helfat (2003)" } }).find((x) => x.rowId === "default-task");
  assert.deepEqual([r.section, r.label, r.pill], ["This paper", "No task", ""]);
  assert.match(r.detail, /makes it, “Read Adner & Helfat \(2003\)”: none → To read → Idea/);
  r = V.buildActions(details, "", [], "", false, false, { defaultTask: { status: "Reading", statuses: names } }).find((x) => x.rowId === "default-task");
  assert.deepEqual([r.label, r.pill], ["Task: Reading", "Reading"]);
  assert.ok(V.KEYBINDINGS.some((k) => k[1] === "Shift+Alt+→  Shift+Alt+←"));
});
