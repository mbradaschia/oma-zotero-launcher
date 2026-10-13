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
  add("settingsPage/later", "settingsPage", "providers", settings, ctx, {});
  add("machineOnly/keys", "machineOnly");
  add("settingEdit/keyDelay", "settingEdit", "general.keyDelay", settings);
  add("settingEdit/unknown", "settingEdit", "general.nope", settings);
  add("parseValue/number-ok", "parseValue", Glue.settingEdit("general.keyDelay", settings).item, "450");
  add("parseValue/number-bad", "parseValue", Glue.settingEdit("general.keyDelay", settings).item, "5000");
  add("settingValue/toggle-default", "settingValue", settings, "general.accelerators");
  const plainPaths = Glue.resolvePaths({ HOME: "/h", hostname: "mac" }, null, null);
  const syncedPaths = Glue.resolvePaths({ HOME: "/h", hostname: "mac" }, { general: { syncDir: "/h/Sync" } }, { syncMarker: true });
  add("settingsSave/plain", "settingsSave", settings, "general.keys", "alt", plainPaths, null);
  add("settingsSave/synced", "settingsSave", { ...settings, syncDir: "/h/Sync" }, "general.citationStyle", "chicago-author-date", syncedPaths, { general: {} });
  add("settingsSave/invalid", "settingsSave", settings, "general.keyDelay", 5, plainPaths, null);
  add("settingsSave/sync-dir", "settingsSave", settings, "general.syncDir", "/h/Sync", plainPaths, null);
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
