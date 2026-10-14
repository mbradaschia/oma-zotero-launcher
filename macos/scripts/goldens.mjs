// The goldens: each Glue wrapper on the captured bridge answers (ZoteroLauncherTests/Fixtures/bridge,
// scrubbed), as Node computes it. GoldenTests runs the same cases through JavaScriptCore and
// compares. Each case carries its arguments, so the Swift side only calls and compares.
//   node scripts/goldens.mjs            write ZoteroLauncherTests/Fixtures/goldens/cases.json
//   node scripts/goldens.mjs --check    fail if that file is missing or differs (CI)
//   --out <path>                        another file (the tests)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(import.meta.url);
const Glue = require(join(root, "ZoteroLauncher", "Core", "Glue.js"));
const Views = require(join(root, "js", "lib", "Views.js"));
// Captured from a library and scrubbed (bridge/), or written by hand to exercise text the scrubber
// flattens: accents, CJK, emoji, capitals, markup (synthetic/).
const fixture = (name, dir = "bridge") => JSON.parse(readFileSync(join(root, "ZoteroLauncherTests", "Fixtures", dir, name + ".json"), "utf8"));

const args = process.argv.slice(2);
const at = args.indexOf("--out");
const out = at >= 0 ? args[at + 1] : join(root, "ZoteroLauncherTests", "Fixtures", "goldens", "cases.json");

const COLOR = "#0a84ff";
const identity = (r) => String(r.rowId) + ((r.noteKey || r.value || r.promptId) ? ":" + (r.noteKey || r.value || r.promptId) : "");
const sections = (rows) => rows.map((r) => r.section).filter((s, i, all) => all.indexOf(s) === i);

function cases() {
  const empty = fixture("search-empty");
  const typed = fixture("search-typed");
  const item = fixture("item");
  const list = [];
  const add = (name, wrapper, ...a) => list.push({ name, wrapper, args: a, expect: JSON.parse(JSON.stringify(Glue[wrapper](...a))) });

  add("searchRows/empty", "searchRows", empty, COLOR, { noCommands: true });
  add("searchRows/typed", "searchRows", typed, COLOR, { noCommands: true });
  add("searchRows/unicode", "searchRows", fixture("search-unicode", "synthetic"), COLOR, { noCommands: true });

  const prompts = [{ id: "summary", title: "Summary", model: "default" }];
  add("actions/loading", "actions", null, "Preview", null, "", false, false, {});
  add("actions/item", "actions", item, "Preview", null, "no prompts yet", false, false, {});
  add("actions/item-pinned-with-prompts", "actions", item, "Preview", prompts, "", true, false, {});
  add("actions/item-setup-unfinished", "actions", item, "Preview", prompts, "", false, true, {});

  const menu = Glue.actions(item, "Preview", prompts, "", false, false, {});
  const firstSection = menu[0].section;
  const own = menu.filter((r) => r.section === firstSection).map(identity);
  add("orderRows/first-section-reversed", "orderRows", menu, { [firstSection]: own.slice().reverse() });
  add("orderRows/none", "orderRows", menu, null);
  add("pinRows/two", "pinRows", menu, [identity(menu[menu.length - 1]), identity(menu[0])]);
  add("pinRows/unknown", "pinRows", menu, ["no-such-row"]);
  add("otherRows/one", "otherRows", menu, [identity(menu[0])]);
  add("filterRows/win", "filterRows", menu, "win");
  add("filterRows/empty", "filterRows", menu, "");
  const labels = ["Étude über Straße", "İstanbul notes", "ıslak", "知識の創造", "Growth 🚀 plan", "Cafe\u0301 society", "CAFÉ"];
  const unicodeRows = labels.map((label) => Views.listRow({ rowId: "x", label, available: true }));
  for (const q of ["étu", "STRASSE", "i̇st", "ı", "知識", "🚀", "café", "Ca"]) add(`filterRows/unicode-${q}`, "filterRows", unicodeRows, q);
  add("orderSections/reversed", "orderSections", menu, sections(menu).reverse());
  add("fileRows/external", "fileRows", item, "external");
  add("fileRows/window", "fileRows", item, "window");

  const rows = Glue.searchRows(empty, COLOR, { noCommands: true });
  const papers = rows.filter((r) => r.kind === "item");
  add("selectionAfter/kept", "selectionAfter", rows, papers[2].key, false);
  add("selectionAfter/follow-top", "selectionAfter", rows, papers[2].key, true);
  add("selectionAfter/gone", "selectionAfter", rows, "ZZZZZZZZ", false);
  add("selectionAfter/no-rows", "selectionAfter", [], "", false);

  // phase 3b
  add("settings/none", "settings", null, null);
  add("settings/machine-and-shared", "settings", { general: { keys: "alt", keyDelay: 450, syncDir: "~/Sync" } }, { general: { citationStyle: "apa", maxResults: 40 }, status: { tags: ["queued", "done"] } });
  add("settings/not-an-object", "settings", [1, 2], null);
  add("settingsText/machine-and-shared", "settingsText", { general: { keys: "alt" } }, { general: { citationStyle: "apa" } });
  const settings = Glue.settings(null, null).settings;
  const pins = Glue.parsePins(JSON.stringify({ pins: [{ key: "ABCD1234", libraryID: 1, title: "p", type: "item" }, { key: "WXYZ9876", libraryID: 1, type: "collection" }, { key: "a tag", type: "tag" }] }));
  add("searchBody/empty-with-pins", "searchBody", "", null, { ...settings, emptyQuery: { recent: "latest" } }, pins, [], [], []);
  add("searchBody/typed", "searchBody", "teece dyn", null, settings, pins, [], [], []);
  add("searchBody/collection", "searchBody", "", { type: "collection", key: "WXYZ9876", libraryID: 1, title: "c" }, settings, pins, [], [], []);
  add("searchBody/tag", "searchBody", "x", { type: "tag", key: "a tag", libraryID: 1, title: "#a tag" }, settings, [], [], [], []);
  add("searchBody/saved-search", "searchBody", "", { type: "search", key: "s1", libraryID: 1, title: "S", query: "y:2020" }, settings, [], [], [], []);

  const base = { details: item, viewerName: "Preview", prompts: null, promptsProblem: "", pinned: false, setup: true, extras: {} };
  add("menu/plain", "menu", base);
  add("menu/loading", "menu", { ...base, details: null });
  const plain = Glue.menu(base).rows;
  const ids = plain.map(identity);
  add("menu/arranged", "menu", { ...base, pins: [ids[ids.length - 1]], others: [ids[0]], order: { [plain[1].section]: plain.filter((r) => r.section === plain[1].section).map(identity).reverse() }, sections: sections(plain).reverse() });
  add("menu/filtered", "menu", { ...base, filter: "lib" });
  add("menu/with-tasks", "menu", { ...base, todoRows: [Views.listRow({ section: "Tasks", rowId: "todo", label: "Read it", value: "t1", available: true }), Views.listRow({ section: "Tasks", rowId: "todo-new", label: "New task…", available: true })] });
  add("fileRows/filtered", "fileRows", item, "external", "pdf");
  add("usableFiles/window", "usableFiles", item, "window");
  add("confirmRows/ask", "confirmRows", { yes: "Delete it", no: "Keep it", detail: "On 3 papers" });
  add("confirmRows/defaults", "confirmRows", null);

  add("parsePins/mixed", "parsePins", JSON.stringify({ pins: [{ key: "ABCD1234", libraryID: "2" }, { key: "bad" }, { key: "t", type: "tag" }, null] }));
  add("parsePins/not-json", "parsePins", "{");
  add("togglePin/add", "togglePin", pins, { key: "QQQQ1111", libraryID: 1, title: "new" });
  add("togglePin/remove", "togglePin", pins, { key: "ABCD1234", libraryID: 1 });
  add("isPinned/yes", "isPinned", pins, { key: "WXYZ9876", libraryID: 1, type: "collection" });
  add("isPinned/other-type", "isPinned", pins, { key: "WXYZ9876", libraryID: 1 });
  add("movePin/down", "movePin", pins, { key: "ABCD1234", libraryID: 1 }, { key: "WXYZ9876", libraryID: 1, type: "collection" });
  add("toggleIdentity/add", "toggleIdentity", ["open"], "pin");
  add("toggleIdentity/remove", "toggleIdentity", ["open", "pin"], "open");
  add("moveIdentity/swap", "moveIdentity", ["a", "b", "c"], "c", "a");
  add("moveIdentity/missing", "moveIdentity", ["a"], "a", "z");
  add("moveSection/up", "moveSection", plain, plain[plain.length - 1].section, -1);
  add("moveSection/top", "moveSection", plain, plain[0].section, -1);
  add("rowIdentity/note", "rowIdentity", plain.find((r) => r.noteKey) || plain[0]);
  add("rowIdentity/plain", "rowIdentity", Views.listRow({ rowId: "open" }));
  add("contextLabel/menu", "contextLabel", "‹ Teece, 1997 · Dynamic capabilities");
  add("typeHint/tags", "typeHint", "‹ Tags · type to find or create one", false);
  add("rankLabels/full", "rankLabels", { ajg: "4*", abdc: "A*", ft50: true, utd24: true });
  add("rankLabels/none", "rankLabels", null);
  add("paperFooter/item", "paperFooter", { details: item });
  add("paperFooter/extracting", "paperFooter", { details: item, extracting: true });
  add("statusName/tag", "statusName", "s/reading");
  add("citationStyle/default", "citationStyle", settings);
  add("results/typed-sections-reversed", "results", typed, COLOR, { noCommands: true, statuses: ["s/reading"] }, sections(Glue.searchRows(typed, COLOR, { noCommands: true })).reverse());
  add("results/empty", "results", empty, COLOR, { noCommands: true }, null);
  add("countText/typed", "countText", typed, 0);
  add("countText/empty", "countText", empty, 1234);

  // phase 4a
  const noteHtml = fixture("note-html", "synthetic");
  const tagsList = fixture("tags-list");
  add("noteRows/all", "noteRows", item, "", COLOR, []);
  add("noteRows/typed", "noteRows", item, (item.notes[0].title || "x").slice(0, 3), COLOR, []);
  add("noteRows/ordered", "noteRows", item, "", COLOR, item.notes.map((n) => n.key).reverse());
  add("ownNotes/ordered", "ownNotes", item, item.notes.map((n) => n.key).reverse());
  add("noteParts/title-block", "noteParts", noteHtml.html, noteHtml.title);
  add("noteParts/other-title", "noteParts", noteHtml.html, "Something else");
  const looks = { size: 15, color: "#1d1d1f", accent: COLOR, dim: "#6e6e73" };
  add("noteHtml/synthetic", "noteHtml", Glue.noteParts(noteHtml.html, noteHtml.title).html, looks);
  add("paperCite/synthetic", "paperCite", noteHtml.paper);
  const resultRows = Glue.searchRows(typed, COLOR, { noCommands: true });
  const paperRow = resultRows.find((r) => r.kind === "item");
  add("withNoteRows/one-paper", "withNoteRows", resultRows, { [paperRow.libraryID + ":" + paperRow.key]: Glue.ownNotes(item, []) });
  add("fileName/unsafe", "fileName", "A/B: notes? <draft>");
  const tagState = { tags: tagsList.tags, itemTags: Glue.tagMap(item.tags), initial: item.tags.map((t) => t.tag), editable: true };
  add("tagRows/untyped", "tagRows", tagState, "", COLOR);
  add("tagRows/typed-new", "tagRows", tagState, "zzzz new", COLOR);
  add("tagRows/typed", "tagRows", tagState, tagsList.tags[0].tag.slice(0, 3), COLOR);
  add("tagRows/read-only", "tagRows", { ...tagState, editable: false }, "", COLOR);
  add("tagMap/item", "tagMap", item.tags);
  add("tagCountText/item", "tagCountText", tagState);
  add("uniqueLabelClash/none", "uniqueLabelClash", "x", ["y"], []);
  const statuses = Glue.todoStatuses(settings);
  add("tagStatusRows/paper", "tagStatusRows", "paper", "skimmed", ["to read", "reading", "read"], statuses);
  add("tagStatusRows/task", "tagStatusRows", "task", "write up", ["to read"], statuses);
  add("tagMenuRows/name", "tagMenuRows", "a tag");
  add("tagNameRows/typed", "tagNameRows", "old", "new name");
  add("tagNameRows/same", "tagNameRows", "old", "old");
  add("statusTags/defaults", "statusTags", settings.paperStatuses);
  add("paperStatusOf/reading", "paperStatusOf", [{ tag: "s/reading" }, { tag: "x" }], Glue.statusTags(settings.paperStatuses));
  add("nextPaperStatus/forward", "nextPaperStatus", Glue.statusTags(settings.paperStatuses), "s/reading", 1);
  add("nextPaperStatus/from-none-back", "nextPaperStatus", Glue.statusTags(settings.paperStatuses), "", -1);
  add("statusTag/name", "statusTag", "to read");
  add("parseTodos/mixed", "parseTodos", JSON.stringify({ todos: [{ id: "t1", description: "Read it", status: "next", item: { key: "ABCD1234", libraryID: 1 } }, { id: 2 }] }));
  add("todoStatuses/defaults", "todoStatuses", settings);
  const todos = Glue.parseTodos(JSON.stringify({ todos: [{ id: "t1", description: "Read it", status: statuses[1].id, isDefault: true, item: { key: "ABCD1234", libraryID: 1, title: "P" } }] }));
  add("defaultTasks/one", "defaultTasks", todos, statuses);
  add("nextDefaultStatus/none-yet", "nextDefaultStatus", statuses, "", 1);
  add("nextDefaultStatus/past-the-end", "nextDefaultStatus", statuses, statuses[statuses.length - 1].id, 1);
  add("defaultTaskDescription/cite", "defaultTaskDescription", settings, { title: "Dynamic capabilities", cite: "Teece et al. (1997)" });
  // (a new task gets a random id: making one is tested in Swift, not here)
  add("setDefaultTasks/move", "setDefaultTasks", todos, [{ item: { key: "ABCD1234", libraryID: 1, title: "P" }, status: statuses[2].id }], settings, Date.UTC(2026, 9, 13));
  add("statusById/first", "statusById", statuses, statuses[0].id);
  add("addStatus/backlog", "addStatus", statuses, "write up", "backlog");
  add("addStatus/empty", "addStatus", statuses, "  ", "backlog");
  add("taskTagPrefix/t", "taskTagPrefix");
  add("tasksWithStatus/added", "tasksWithStatus", settings, "write up", "backlog");
  add("tasksWithStatus/empty", "tasksWithStatus", settings, "", "backlog");
  const ctx = { bridge: { status: "ready", version: "0.2.1", zoteroVersion: "7.0.11", expected: "0.2.1" }, styles: [{ id: "apa", title: "APA 7th" }, { id: "chicago-author-date", title: "Chicago" }] };
  for (const page of ["", "general", "paper-status", "styles"]) add(`settingsPage/${page || "root"}`, "settingsPage", page, settings, ctx, {});
  add("settingsPage/general-synced", "settingsPage", "general", settings, ctx, { machineOnly: Glue.machineOnly() });
  add("settingsPage/general-filtered", "settingsPage", "general", settings, ctx, { filter: "key" });
  add("settingsPage/choice", "settingsPage", "choice", settings, ctx, { choice: "general.keys" });
  add("settingsPage/edit", "settingsPage", "edit", settings, ctx, { edit: Glue.settingEdit("general.keyDelay", settings), filter: "450" });
  add("settingsPage/styles-loading", "settingsPage", "styles", settings, {}, {});
  add("settingsPage/later", "settingsPage", "rules", settings, ctx, {});
  add("machineOnly/keys", "machineOnly");
  add("settingEdit/keyDelay", "settingEdit", "general.keyDelay", settings);
  add("settingEdit/unknown", "settingEdit", "general.nope", settings);
  add("parseValue/number-ok", "parseValue", Glue.settingEdit("general.keyDelay", settings).item, "450");
  add("parseValue/number-bad", "parseValue", Glue.settingEdit("general.keyDelay", settings).item, "5000");
  add("settingValue/toggle-default", "settingValue", settings, "general.accelerators");
  const plainPaths = Glue.resolvePaths({ HOME: "/h", hostname: "mac" }, null, null);
  const syncedPaths = Glue.resolvePaths({ HOME: "/h", hostname: "mac" }, { general: { syncDir: "/h/Sync" } }, { syncMarker: true });
  add("settingsChange/save-plain", "settingsChange", settings, "value", ["general.keys", "alt"], plainPaths, null);
  add("settingsChange/save-synced", "settingsChange", { ...settings, syncDir: "/h/Sync" }, "value", ["general.citationStyle", "chicago-author-date"], syncedPaths, { general: {} });
  add("settingsChange/save-invalid", "settingsChange", settings, "value", ["general.keyDelay", 5], plainPaths, null);
  add("settingsChange/save-sync-dir", "settingsChange", settings, "value", ["general.syncDir", "/h/Sync"], plainPaths, null);
  add("styleName/known", "styleName", ctx.styles, "chicago-author-date");
  add("styleName/default", "styleName", ctx.styles, null);
  add("nextGrouping/forward", "nextGrouping", "relevance", 1, []);
  add("groupingName/year", "groupingName", Glue.nextGrouping("relevance", 1, []), []);
  add("results/grouped", "results", typed, COLOR, { noCommands: true }, null, { mode: Glue.nextGrouping("relevance", 1, []), info: { statuses: [] } }, null);

  // phase 4b (a fixed clock: 2026-10-13 12:00 UTC)
  const T0 = Date.UTC(2026, 9, 13, 12);
  const sts = Glue.todoStatuses(settings);
  const tasks = Glue.parseTodos(JSON.stringify({ todos: [
    { id: "t1", description: "Read the intro", status: sts[0].id, priority: "high", due: "2026-10-14", item: { key: "ABCD1234", libraryID: 1, title: "Dynamic capabilities", cite: "Teece (1997)" }, created: "2026-10-01T00:00:00.000Z", updated: "2026-10-01T00:00:00.000Z" },
    { id: "t2", description: "Write the review", status: sts[2].id, notes: "two pages", created: "2026-10-02T00:00:00.000Z", updated: "2026-10-02T00:00:00.000Z" },
    { id: "t3", description: "Done one", status: sts[sts.length - 1].id, item: { key: "ABCD1234", libraryID: 1, title: "Dynamic capabilities" }, created: "2026-10-03T00:00:00.000Z", updated: "2026-10-03T00:00:00.000Z" }
  ] }));
  add("todoRows/all", "todoRows", tasks, settings, "", COLOR, T0);
  add("todoRows/typed-quick", "todoRows", tasks, settings, "review #next !! @fri", COLOR, T0);
  add("itemTodoRows/paper", "itemTodoRows", tasks, { key: "ABCD1234", libraryID: 1 }, settings, T0);
  add("todoEditor/with-paper", "todoEditor", tasks[0], settings, T0);
  add("todoEditor/none", "todoEditor", null, settings, T0);
  add("statusChoice/t1", "statusChoice", tasks[0], settings);
  add("priorityChoice/t1", "priorityChoice", tasks[0]);
  add("taskTagRows/line", "taskTagRows", "Read it", {}, settings, "", T0);
  add("statusSettings/defaults", "statusSettings", settings, tasks, "");
  add("statusSettings/filtered", "statusSettings", settings, tasks, "add");
  add("taskMarks/tasks", "taskMarks", tasks, settings, T0);
  add("taskActions/defaults", "taskActions", settings);
  add("groupName/backlog", "groupName", "backlog");
  add("priorityName/high", "priorityName", "high");
  add("parseQuick/full", "parseQuick", "Read the intro #next !!! @tomorrow", settings, T0);
  add("parseQuick/bad-date", "parseQuick", "x @someday", settings, T0);
  add("quickSummary/full", "quickSummary", Glue.parseQuick("Read #next !! @fri", settings, T0), settings, T0);
  add("parseDue/fri", "parseDue", "fri", T0);
  add("parseDue/bad", "parseDue", "nope", T0);
  add("dueText/tomorrow", "dueText", "2026-10-14", T0);
  add("isoDate/t0", "isoDate", T0);
  add("addDays/week", "addDays", "2026-10-13", 7);
  add("addMonths/back", "addMonths", "2026-03-31", -1);
  add("updateTodo/notes", "updateTodo", tasks, "t2", { notes: "three pages" }, T0);
  add("removeTodo/t2", "removeTodo", tasks, "t2");
  add("cycleTodo/next", "cycleTodo", tasks, "t1", settings, 1, T0);
  add("cyclePriority/t2", "cyclePriority", tasks, "t2", 1, T0);
  add("toggleDone/t1", "toggleDone", tasks, "t1", settings, T0);
  add("moveTodo/down", "moveTodo", tasks, "t1", settings, 1, T0);
  add("restoreTodo/back", "restoreTodo", tasks.slice(1), tasks[0], 0);
  add("statusOf/t2", "statusOf", tasks[1], settings);
  add("moveTasks/first-status", "moveTasks", tasks, sts[0].id, sts[1].id, T0);
  add("taskTagChanges/done", "taskTagChanges", tasks, settings, Glue.toggleDone(tasks, "t1", settings, T0).todos, settings);
  add("taskTagSync/tasks", "taskTagSync", tasks, settings);
  add("statusListsFromZotero/new-tags", "statusListsFromZotero", settings, ["s/skimmed", "t/Drafting"], [{ kind: "rename", from: "t/Reading", name: "t/Studying" }]);
  add("renameStatus/first", "renameStatus", settings, sts[0].id, "Ideas");
  add("removeStatus/first", "removeStatus", settings, sts[0].id);
  add("moveStatus/down", "moveStatus", settings, sts[0].id, 1);
  add("addStatusIn/waiting", "addStatusIn", settings, "On hold", "waiting");
  add("entryRows/todo-new", "entryRows", "todo-new", "Read it #next", settings, { item: { key: "ABCD1234", libraryID: 1, title: "P", cite: "A (2020)" } }, "", null, T0);
  add("entryRows/todo-new-empty", "entryRows", "todo-new", "", settings, {}, "", null, T0);
  add("entryRows/todo-text-due", "entryRows", "todo-text", "fri", settings, null, "due", null, T0);
  add("entryRows/status-name-paper", "entryRows", "status-name", "skimmed", settings, null, "", { kind: "paper", mode: "add" }, T0);
  add("entryRows/status-name-task", "entryRows", "status-name", "", settings, null, "", { mode: "add", group: "next" }, T0);
  add("statusMenuRows/task", "statusMenuRows", { id: sts[0].id, name: sts[0].name }, tasks, settings);
  add("statusMenuRows/paper", "statusMenuRows", { kind: "paper", id: "reading", name: "reading" }, tasks, settings);
  add("statusMenuRows/action", "statusMenuRows", { kind: "action", id: "Read", name: "Read" }, tasks, settings);
  add("insertAt/block", "insertAt", "Read it", 7, "#next");
  add("defaultTemplate/t", "defaultTemplate");
  add("tasksWith/actions", "tasksWith", { ...settings, tasks: { defaultTask: "Read {cite}" } }, { actions: ["Read", "Write"] });
  add("calendarMonth/october", "calendarMonth", "2026-10-13", T0);
  add("conflictOf/syncthing", "conflictOf", "todos.sync-conflict-20261013-101500-ABCDEFG.json");
  add("keptName/md", "keptName", "summary.md", "laptop");
  add("merge/todos", "merge", "todos.json", JSON.stringify({ todos: [tasks[0]] }), JSON.stringify({ todos: [tasks[1]], deleted: [{ id: "t1", at: "2026-09-01T00:00:00.000Z" }] }), 1, 2, T0);
  add("stamp/pins", "stamp", "pins.json", JSON.stringify({ pins: [{ key: "ABCD1234", libraryID: 1, type: "item" }] }), JSON.stringify({ pins: [] }), T0);

  // ---- phase 5: saved searches, pickers, the search box's blocks, Go to, sync
  const searches = Glue.parseSearches(JSON.stringify({ searches: [
    { id: "s1", name: "Capabilities", query: "dynamic capabilities y:2010..", pinned: true },
    { id: "s2", name: "Teece", query: "a:teece", pinned: false },
    { id: "s3", name: "Reviews", query: "#review", pinned: true }
  ] }));
  add("parseSearches/three", "parseSearches", JSON.stringify({ searches }));
  add("parseSearches/bad", "parseSearches", "{nope");
  add("searchesText/two", "searchesText", searches.slice(0, 2));
  add("addSearch/pinned", "addSearch", searches, "Mine", "a:smith", true, T0);
  add("addSearch/unnamed", "addSearch", searches, "", "y:2020", false, T0);
  add("updateSearch/rename", "updateSearch", searches, "s2", { name: "Teece's work" });
  add("removeSearch/s1", "removeSearch", searches, "s1");
  add("moveSearch/s3-up", "moveSearch", searches, "s3", "s1");
  const pinned = searches.filter((x) => x.pinned);
  add("nextSearch/from-all", "nextSearch", pinned, "", 1);
  add("nextSearch/back-to-all", "nextSearch", pinned, "s1", -1);
  add("searchScope/s1", "searchScope", searches[0]);
  add("searchScope/none", "searchScope", null);
  add("combinedQuery/badge-and-typed", "combinedQuery", Glue.searchScope(searches[0]), "teece");
  add("combinedQuery/typed", "combinedQuery", null, "a:teece");
  add("savedSearchRows/all", "savedSearchRows", searches, "", COLOR);
  add("savedSearchRows/typed", "savedSearchRows", searches, "rev", COLOR);
  add("searchMenuRows/s1", "searchMenuRows", searches[0]);
  add("searchEditRows/save", "searchEditRows", "save", "", "dynamic capabilities");
  add("searchEditRows/rename", "searchEditRows", "rename", "New name", "a:teece");
  add("searchEditRows/query", "searchEditRows", "query", "a:teece y:2000..", "a:teece");
  add("pickerRows/all", "pickerRows", "", true, []);
  add("pickerRows/typed", "pickerRows", "yea", false, []);
  add("pickerValueRows/tags", "pickerValueRows", fixture("facets-tag").values, "", COLOR, false);
  add("pickerValueRows/years", "pickerValueRows", fixture("facets-year").values, "", COLOR, false);
  add("pickerValueRows/searches", "pickerValueRows", Glue.savedSearchValues(searches), "rev", COLOR, true);
  add("dateValueRows/year", "dateValueRows", "year", T0, "");
  add("dateValueRows/added-typed", "dateValueRows", "added", T0, "last");
  add("dateField/year", "dateField", "year");
  add("dateField/tag", "dateField", "tag");
  add("savedSearchValues/three", "savedSearchValues", searches);
  add("pickerFieldLabel/author", "pickerFieldLabel", "author");
  add("facetsBody/tag", "facetsBody", "tag", "strat", 100, settings);
  add("thousands/big", "thousands", 11033);
  add("querySegments/mixed", "querySegments", 'a:smith !#draft "deep learning" OR (y:2020 Teece)', 46, false);
  add("querySegments/live", "querySegments", "a:smi", 5, true);
  add("querySegments/unicode", "querySegments", "a:Müller 知識 🚀 #x", 17, false);
  add("taskSegments/line", "taskSegments", "Read it #next !! @fri", 21, settings, T0);
  add("syncFooter/synced", "syncFooter", { configured: true, running: false, lastSync: new Date(T0 - 5 * 60000).toISOString() }, T0);
  add("syncFooter/running", "syncFooter", { configured: true, running: true }, T0);
  add("syncFooter/off", "syncFooter", { configured: false }, T0);
  const have = ["todos", "todo-new", "searches", "sync", "settings", "settings-general"];
  add("results/go-to-only-mac", "results", { ...typed, query: "sync" }, COLOR, { keys: "single", sync: { configured: true }, have }, null, null, null);
  add("results/go-to-later-dropped", "results", { ...typed, query: "chats", collections: [], tags: [] }, COLOR, { keys: "single", have }, null, null, null);

  // ---- phase 6a: the runner, setup, models and providers, settings found from the search
  const info = fixture("providers", "synthetic"), models = fixture("models", "synthetic");
  const run6 = { bridge: ctx.bridge, info, models, defaults: models.defaults, tests: { openai: { running: false, ok: true, detail: "2 models", models: [{ value: "openai:gpt-5", displayName: "GPT-5" }], at: "2026-10-12T10:00:00.000Z" } },
    runner: { installed: true, installing: false, update: null }, reqs: { node: "22.4.1", pdftotext: true }, setup: { zotero: true, running: true, node: "22.4.1", pdftotext: true } };
  const fresh = { bridge: { status: "zotero-down", version: "", zoteroVersion: "", expected: "0.2.1" }, runner: { installed: false, installing: false, update: null }, reqs: {}, setup: { zotero: false, running: false, node: "", pdftotext: false } };
  add("settingsPage/root-mac-setup-fresh", "settingsPage", "", settings, fresh, {});
  add("settingsPage/root-mac-setup-ready", "settingsPage", "", settings, run6, {});
  add("settingsPage/root-runner-update", "settingsPage", "", settings, { ...run6, runner: { installed: true, installing: false, update: { installed: "0.2.0", bundled: "0.2.1" } } }, {});
  add("settingsPage/providers", "settingsPage", "providers", settings, run6, {});
  add("settingsPage/providers-no-runner", "settingsPage", "providers", settings, fresh, {});
  add("settingsPage/provider-openai", "settingsPage", "provider", settings, run6, { provider: "openai" });
  add("settingsPage/provider-endpoint", "settingsPage", "provider", { ...settings, endpoints: [{ id: "lab-gateway", name: "Lab gateway", baseURL: "https://gateway.example.edu/v1", enabled: true }] }, run6, { provider: "lab-gateway" });
  add("settingsPage/models-prompts", "settingsPage", "models", settings, run6, { modelsPath: "defaults.prompts.model" });
  add("settingsPage/models-use-openai", "settingsPage", "models", settings, run6, { modelsPath: "defaults.both", only: "openai" });
  add("settingsPage/defaults", "settingsPage", "defaults", settings, run6, {});
  add("settingsPage/tasks", "settingsPage", "tasks", settings, run6, { todos: tasks });
  const index = Glue.settingsIndex(settings, run6, tasks);
  add("settingsIndex/all", "settingsIndex", settings, run6, tasks);
  add("settingMenuRows/key", "settingMenuRows", "key delay", index);
  add("settingsChange/value", "settingsChange", settings, "value", ["providers.ollama.enabled", true], plainPaths, null);
  add("settingsChange/both", "settingsChange", settings, "both", ["claude:opus"], plainPaths, null);
  add("settingsChange/add-endpoint", "settingsChange", settings, "addEndpoint", ["LM Studio", "http://localhost:1234/v1"], plainPaths, null);
  add("settingsChange/remove-endpoint", "settingsChange", { ...settings, endpoints: [{ id: "lm-studio", name: "LM Studio", baseURL: "http://localhost:1234/v1", enabled: true }] }, "removeEndpoint", ["lm-studio"], plainPaths, null);
  add("settingsChange/clear-context", "settingsChange", { ...settings, endpoints: [{ id: "lab", name: "Lab", baseURL: "https://gateway.example.edu/v1", context: 32768, enabled: true }] }, "value", ["endpoint.lab.context", null], plainPaths, null);
  add("settingsChange/fill-defaults", "settingsChange", settings, "fillDefaults", ["openai:gpt-5"], plainPaths, null);
  add("settingEdit/endpoint-url", "settingEdit", "endpoint.lab-gateway.baseURL", { ...settings, endpoints: [{ id: "lab-gateway", name: "Lab gateway", baseURL: "https://gateway.example.edu/v1", enabled: true }] });
  add("settingEdit/provider-context", "settingEdit", "providers.ollama.context", settings);
  add("settingEdit/extract-mb", "settingEdit", "defaults.extractMaxMB", settings);
  add("endpointNameEdit/step-1", "endpointNameEdit");
  add("endpointURLEdit/step-2", "endpointURLEdit", "LM Studio");
  add("settingValue/endpoint", "settingValue", { ...settings, endpoints: [{ id: "x", enabled: true }] }, "endpoint.x.enabled");
  add("settingValue/general-default", "settingValue", settings, "general.accelerators");
  add("promptArgv/default", "promptArgv", settings, ["providers", "--quiet"]);
  add("promptArgv/own-command", "promptArgv", { ...settings, promptCommand: ["/opt/x/run", "--flag"] }, ["models", "--json"]);
  add("needsSetup/fresh", "needsSetup", settings, fresh);
  add("needsSetup/ready", "needsSetup", settings, run6);

  // ---- the UX pass: the Mac's key notation, counts
  add("macKeys/modifiers", "macKeys", "Shift+Alt+→ makes it · Alt+→ / Alt+← · Shift+↑↓ moves it · Ctrl+V · Ctrl+L · alt+c · Alt+key");
  add("shortDate/iso", "shortDate", "2026-10-01T09:30:00.000Z");
  add("todoCount/three", "todoCount", tasks, settings);

  // ---- phase 6b: prompts, Processes, extraction, rules
  const promptsText = JSON.stringify(fixture("prompts", "synthetic"));
  const promptList = Glue.parsePromptList(promptsText);
  const runnerTasks = fixture("tasks", "synthetic").tasks;
  const rules = JSON.parse(readFileSync(join(root, "runner", "lib", "rules.json"), "utf8")).rules;
  add("parsePromptList/two", "parsePromptList", promptsText);
  add("parsePromptList/bad", "parsePromptList", "nope");
  add("promptRows/all", "promptRows", promptList, models.models, "", COLOR, "claude:opus");
  add("promptRows/typed", "promptRows", promptList, models.models, "map", COLOR, "claude:opus");
  add("promptRows/listing", "promptRows", null, null, "", COLOR, "");
  add("promptEditor/summary", "promptEditor", promptList[0], models.models, "claude:opus", false);
  add("promptEditor/mindmap-auto", "promptEditor", promptList[1], models.models, "claude:opus", true);
  add("promptModels/summary", "promptModels", promptList[0], models.models, "claude:opus", "");
  add("promptModels/typed", "promptModels", promptList[0], models.models, "claude:opus", "sonnet");
  add("promptEfforts/opus", "promptEfforts", promptList[1], models.models, "claude:opus");
  add("promptOutputs/mindmap", "promptOutputs", promptList[1]);
  add("titleRows/create", "titleRows", "Key claims", "create", true, false);
  add("titleRows/create-busy", "titleRows", "Key claims", "create", true, true);
  add("titleRows/rename-empty", "titleRows", "", "rename", true, false);
  add("effortFor/opus-max", "effortFor", models.models, "claude:opus", "max");
  add("effortFor/default", "effortFor", models.models, "default", "");
  add("setPromptArgs/all", "setPromptArgs", "summary", { title: "Short summary", model: "claude:opus", effort: "", output: "note", brief: "off" });
  add("setPromptArgs/brief", "setPromptArgs", "summary", { brief: "on" });
  add("taskRows/all", "taskRows", runnerTasks, "", COLOR, T0);
  add("taskRows/typed", "taskRows", runnerTasks, "barney", COLOR, T0);
  add("taskSummary/three", "taskSummary", runnerTasks, 0);
  add("fulltextNote/item", "fulltextNote", item);
  add("extractMenu/item", "extractMenu", item, false);
  add("extractMenu/no-runner", "extractMenu", item, true);
  add("instructionsText/comments", "instructionsText", "<!-- your own rules -->\nCite page numbers.\n<!-- end -->\n");
  add("settingsPage/rules", "settingsPage", "rules", { ...settings, rules: { [rules[0].id]: rules[0].on === false } }, { ...run6, rules, instructions: "Cite page numbers." }, {});
  add("settingsPage/defaults-extract", "settingsPage", "defaults", settings, { ...run6, promptList, extract: { pending: 12, catchup: null, skipped: 2 } }, {});
  add("settingsChange/rule", "settingsChange", settings, "rule", [rules[0]], plainPaths, null);

  // ---- phase 7: the scheduler's pages
  add("hasPdf/item", "hasPdf", item);
  add("hasPdf/none", "hasPdf", null);
  const plan = { taxonomies: { papers: 1, jobs: [{ id: "1:K1", op: "classify" }] }, recent: { papers: 2, added: 2, jobs: [{ id: "1:K2", op: "extract" }, { id: "1:K3", op: "prompt", prompt: "summary" }] } };
  const on = { ...settings, defaults: { ...settings.defaults, autoExtractNew: true, autoPrompts: ["summary"] } };
  add("settingsPage/defaults-planned", "settingsPage", "defaults", on, { ...run6, prompts: promptList, catchUp: { plan, running: null, problem: "" }, automation: { host: "", here: true } }, {});
  add("settingsPage/defaults-running", "settingsPage", "defaults", on, { ...run6, prompts: promptList, catchUp: { plan, running: { title: "Catching up the last 30 days", left: 1, done: 1, failed: 0 }, problem: "" } }, {});
  add("settingsPage/defaults-elsewhere", "settingsPage", "defaults", on, { ...run6, prompts: promptList, automation: { host: "lab-mac", here: false, machine: "studio", synced: true } }, {});
  add("settingsPage/defaults-host-here", "settingsPage", "defaults", on, { ...run6, prompts: promptList, automation: { host: "studio", here: true, machine: "studio", synced: true } }, {});
  add("settingsPage/defaults-every-machine", "settingsPage", "defaults", on, { ...run6, prompts: promptList, automation: { host: "", here: true, machine: "studio", synced: true } }, {});
  add("settingsPage/defaults-ocr", "settingsPage", "defaults", settings, { ...run6, prompts: promptList, reqs: { node: "22.1.0", pdftotext: true, tesseract: true }, extract: { pending: 3, catchup: null, skipped: 3, scans: 2 } }, {});
  add("settingsPage/defaults-no-runner", "settingsPage", "defaults", on, { ...run6, runner: { installed: false }, prompts: null }, {});
  add("settingsPage/general-machine", "settingsPage", "general", settings, { ...run6, automation: { host: "", here: true, machine: "studio", synced: false } }, {});
  add("settingEdit/machine-name", "settingEdit", "general.machineName", settings);
  add("promptEditor/elsewhere", "promptEditor", promptList[1], models.models, "claude:opus", true, "lab-mac");
  add("settingsPage/auto-prompts", "settingsPage", "auto-prompts", on, { ...run6, prompts: promptList }, {});

  // ---- phase 8: chat and artifacts (made-up chats and artifacts)
  const chats = [{ id: "2026-10-13T10-00-00-000Z-abc123", title: "What is the main claim?", updated: "2026-10-13T10:05:00Z", turns: 2, model: "claude:opus", key: "ABCD1234", libraryID: 1, paper: "Doe (2016)" },
    { id: "2026-10-12T09-00-00-000Z-def456", title: "Methods", updated: "2026-10-12T09:01:00Z", turns: 1, model: "", key: "EFGH5678", libraryID: 1, paper: "Roe (2020)" }];
  const art = { id: "concept-map-1a2b", title: "Concept map", format: "mermaid", formatLabel: "Mind map", current: 2, versions: 2, updated: "2026-10-13", by: "chat", key: "ABCD1234", libraryID: 1,
    paper: "Doe (2016)", view: "/tmp/a/v.html", file: "/tmp/a/v.mmd", dir: "/tmp/a", brief: "/tmp/a/brief.md", promptMade: false };
  add("chatRows/all", "chatRows", chats, "", "#7aa2f7");
  add("chatRows/typed", "chatRows", chats, "meth", "#7aa2f7");
  add("chatMenuRows/one", "chatMenuRows", chats[0]);
  add("renameRows/chat-empty", "renameRows", "chat-rename-save", "");
  add("renameRows/artifact", "renameRows", "art-rename-save", "Map");
  add("artifactMenu/one", "artifactMenu", art);
  add("artifactChangeRows/typed", "artifactChangeRows", art, "add the methods", true);
  add("artifactChangeRows/not-ready", "artifactChangeRows", art, "x", false);
  const turn = [{ role: "user", text: "What <b>is</b> it?" }, { role: "assistant", text: "**X**, see [▣ Map · Mind map, version 1](oma-artifact:abc) ![i](x.png)", pending: false, failed: false, info: "Opus · free" }];
  add("chatHtml/turn", "chatHtml", turn, { cite: "Doe (2016)" });
  add("chatHtml/links", "chatHtml", [{ role: "assistant", text: "[web](https://example.org) [save](oma-answer:save/0) [js](javascript:alert(1)) [file](file:///etc/passwd) [map](oma-artifact:m1)", pending: false, failed: false, info: "" }], { cite: "Doe" });
  add("chatHtml/empty", "chatHtml", [], { cite: "Doe (2016)" });
  add("chatHtml/pending", "chatHtml", [{ role: "user", text: "Q" }, { role: "assistant", text: "", pending: true }], { cite: "Doe", status: "Summarizing earlier questions…" });
  add("streamView/writing", "streamView", "Here: <artifact id=\"m\" format=\"mermaid\" title=\"Map\">graph TD");
  const st = { messages: [{ role: "user", text: "q" }, { role: "assistant", text: "", pending: true }], sessionId: "", grounding: "", model: "default", contextUsed: 0, contextWindow: 0, statusText: "", pendingQuotes: null };
  add("chatEvent/delta", "chatEvent", st, JSON.stringify({ type: "delta", text: "Hel" }), models.models);
  add("chatEvent/done", "chatEvent", Object.assign({}, st, { pendingQuotes: { checked: 3, missing: ["a quote not in the paper"] } }), JSON.stringify({ type: "done", text: "Hello", model: "claude:opus", costUsd: 0.004 }), models.models);
  add("turnEnded/stopped", "turnEnded", st, "killed");
  add("transcript/turn", "transcript", turn, { title: "Q", cite: "Doe (2016)", paperTitle: "A paper", models: models.models });
  add("chatArgs/new", "chatArgs", { key: "ABCD1234", libraryID: 1 }, { model: "default", effort: "high", source: "note" });
  add("chatArgs/resume", "chatArgs", { key: "ABCD1234", libraryID: 1 }, { model: "claude:opus", effort: "", sessionId: "s1" });
  add("modelMenu/default", "modelMenu", models.models, "default", "high", "claude:opus");
  add("kTokens/k", "kTokens", 12400);
  add("kTokens/m", "kTokens", 1500000);
  add("answerInfo/quotes", "answerInfo", models.models, "claude:opus", { checked: 1, missing: [] }, 0.25);
  add("sessionMessages/one", "sessionMessages", { messages: [{ role: "user", text: "Q" }, { role: "assistant", text: "A", model: "claude:opus", costUsd: 0 }, { role: "note", text: "n" }] }, models.models);
  add("questionBefore/answer", "questionBefore", turn, 1);
  add("chatTitle/long", "chatTitle", "A question that is much longer than sixty characters, so it is cut short with an ellipsis");
  add("modelLabel/default", "modelLabel", models.models, "default", "claude:opus");
  // ---- phase 9: taxonomies (a made-up one)
  const taxRep = { taxonomies: [{ id: "methods", name: "Methods", prefix: "method/", kind: "several", labels: ["survey", "case study"], threshold: 0.6, own: false, bundled: true, show: true }],
    off: [{ id: "theories", name: "Theories", bundled: true }], problems: [], jev: { key: { set: false } }, review: 2, classified: 5 };
  const taxShow = { id: "methods", name: "Methods", prefix: "method/", kind: "several", question: "Which methods?", threshold: 0.6, low: 0.3,
    labels: [{ name: "survey", definition: "Questionnaires" }, { name: "case study", definition: "One case in depth" }], bundled: true, own: true, path: "/tmp/t/methods.json" };
  add("settingsPage/taxonomies", "settingsPage", "taxonomies", settings, { ...run6, taxonomies: taxRep }, {});
  add("settingsPage/taxonomy", "settingsPage", "taxonomy", settings, run6, { taxEdit: taxShow });
  add("settingsPage/tax-label", "settingsPage", "tax-label", settings, run6, { taxEdit: taxShow, taxLabel: 1 });
  add("settingsPage/tax-ai", "settingsPage", "tax-ai", settings, run6, { taxDraft: { id: "methods", base: taxShow, input: "", turns: [{ request: "add experiments", taxonomy: null, notes: "one more" }], busy: false, error: "",
    proposal: Object.assign({}, taxShow, { labels: taxShow.labels.concat([{ name: "experiment", definition: "A manipulation" }]) }), notes: "one more" } });
  add("settingsPage/tax-review", "settingsPage", "tax-review", settings, run6, { review: [{ id: "1:ABCD1234", paper: "Doe (2016)", taxonomy: "methods", name: "Methods", prefix: "method/", label: "survey", p: 0.42 }] });
  add("editTaxonomy/label-renamed", "editTaxonomy", taxShow, { label: true, i: 0, field: "name", value: "surveys" });
  add("taxonomyValue/threshold", "taxonomyValue", "threshold", "45%", taxShow);
  add("taxonomyValue/bad-prefix", "taxonomyValue", "prefix", "t/", taxShow);
  const taxItem = { item: { key: "ABCD1234", libraryID: 1, itemType: "journalArticle" }, tags: [{ tag: "method/survey", type: 0 }] };
  add("paperTaxonomies/one", "paperTaxonomies", taxItem, taxRep.taxonomies, true);
  add("taxonomyAudit/one", "taxonomyAudit", { id: "1:ABCD1234", classified: true, taxonomies: [{ id: "methods", name: "Methods", prefix: "method/", kind: "several", threshold: 0.6, low: 0.3,
    labels: [{ name: "survey", p: 0.8, state: "tagged" }, { name: "case study", p: 0.1, state: "" }] }] }, taxItem.tags);
  add("taxonomyStrip/stale", "taxonomyStrip", taxItem.tags, taxRep.taxonomies, { classified: true, stale: ["methods"] }, false);
  // (what the runner's taxonomy-draft returns: validate fills in low 0.3 and show true)
  add("acceptedDraft/keeps", "acceptedDraft", { name: "M", prefix: "method/", kind: "several", question: "Q", threshold: 0.6, low: 0.3, show: true, labels: [] }, { show: false, low: 0.2 });
  add("acceptedDraft/new", "acceptedDraft", { name: "M", prefix: "method/", kind: "several", question: "Q", threshold: 0.6, low: 0.3, show: true, labels: [] }, null);
  add("settingsPage/edit-ai", "settingsPage", "edit", settings, run6, { edit: { path: "tax:ai-request", label: "Ask the AI", help: "Describe it", current: "" }, filter: "a map of methods" });
  add("settingsPage/edit-definition", "settingsPage", "edit", settings, run6, { edit: { path: "tax:label-definition", label: "Label definition", help: "What the classifier reads", current: "Old" }, filter: "" });
  add("taxonomyValueRows/methods", "taxonomyValueRows", "tax:methods", taxRep.taxonomies, { "method/survey": 7 }, "", "#7aa2f7");
  add("pickerFieldLabel/tax", "pickerFieldLabel", "tax:methods", taxRep.taxonomies);
  add("paperFooter/taxonomies", "paperFooter", { details: taxItem, taxonomies: taxRep.taxonomies, taxStatus: { classified: true, stale: [] }, classifying: false });
  add("chatInfoLine/high", "chatInfoLine", { sessionId: "s", grounding: "the PDF", model: "default", effort: "high", contextUsed: 150000, contextWindow: 200000 }, models.models, "claude:opus");
  // phase 10: the keys view (? or F1) in the Mac's notation
  const hereResults = Glue.keysContext("search", { scope: false, pickFor: "", inSettings: false, textEntry: false }, false);
  const hereAlt = Glue.keysContext("settings", { scope: false, pickFor: "", inSettings: true, textEntry: false }, true);
  add("keysContext/results", "keysContext", "search", { scope: false, pickFor: "", inSettings: false, textEntry: false }, false);
  add("keysContext/settings-alt", "keysContext", "settings", { scope: false, pickFor: "", inSettings: true, textEntry: false }, true);
  add("keyRows/here", "keyRows", "", hereResults);
  add("keyRows/typed", "keyRows", "sync", hereResults);
  add("keyRows/alt", "keyRows", "", hereAlt);
  add("windowKeys/note-window", "windowKeys", "note-window");
  add("windowKeys/chat-window", "windowKeys", "chat-window");
  return list;
}

const text = JSON.stringify(cases(), null, 1) + "\n";
if (args.includes("--check")) {
  let committed = null;
  try { committed = readFileSync(out, "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (committed !== text) {
    console.error(committed === null ? `${out} is missing: run node scripts/goldens.mjs` : `${out} is out of date: run node scripts/goldens.mjs and look at the diff`);
    process.exit(1);
  }
} else {
  writeFileSync(out, text);
  console.log(`wrote ${out}`);
}
