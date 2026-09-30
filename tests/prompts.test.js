// The prompt runner's pure parts (daemon/lib/prompts.mjs), the overlay's prompt rows
// (lib/Views.js) and the runner argv / list parsing (lib/Client.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const V = require("../lib/Views.js");
const Fuzzy = require("../lib/Fuzzy.js");
const C = require("../lib/Client.js");

const P = () => import("../daemon/lib/prompts.mjs");

test("parsePrompt: frontmatter, defaults for bad values, a file without frontmatter is all body", async () => {
  const { parsePrompt, serializePrompt } = await P();
  assert.deepEqual(parsePrompt("---\ntitle: Lit Review\nmodel: sonnet\neffort: max\n---\n\nDo it.\n", "lit"), { id: "lit", title: "Lit Review", model: "sonnet", effort: "max", body: "Do it." });
  assert.deepEqual(parsePrompt("---\ntitle: 'Q'\nmodel: gpt\neffort: huge\n---\nX", "q"), { id: "q", title: "Q", model: "gpt", effort: "high", body: "X" });
  assert.deepEqual(parsePrompt("Just this.", "plain"), { id: "plain", title: "plain", model: "default", effort: "high", body: "Just this." });
  assert.equal(parsePrompt("---\nmodel: bad model!\n---\nX", "b").model, "default");
  const p = { id: "a", title: "A: b", model: "haiku", effort: "", body: "line 1\n\nline 2" };
  assert.deepEqual(parsePrompt(serializePrompt(p), "a"), p);
});

test("slugify / validId", async () => {
  const { slugify, validId } = await P();
  assert.equal(slugify("Findings & Takeaways!"), "findings-takeaways");
  assert.equal(slugify("Revisão de Literatura"), "revisao-de-literatura");
  assert.equal(validId("literature-review"), true);
  for (const bad of ["", "-x", "../etc", "A", "a b"]) assert.equal(validId(bad), false, bad);
});

test("store: seeded with the two defaults; new prompts get a free id", async () => {
  const { ensureStore, listPrompts, createPrompt, loadPrompt } = await P();
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oma-prompts-")), "prompts");
  ensureStore(dir);
  const list = listPrompts(dir);
  assert.deepEqual(list.map((p) => p.title), ["Findings and Takeaways", "Literature Review"]);
  for (const p of list) assert.match(p.body, /## References/);
  for (const p of list) assert.match(p.body, /APA 7/);
  const a = createPrompt("Methods Critique", dir);
  const b = createPrompt("Methods Critique", dir);
  assert.deepEqual([a.id, b.id], ["methods-critique", "methods-critique-2"]);
  assert.equal(loadPrompt("methods-critique", dir).title, "Methods Critique");
  assert.throws(() => loadPrompt("../x", dir), /bad prompt id/);
});

test("buildMessage: task, reference, citation, highlights with pages, notes, full text", async () => {
  const { buildMessage, stripTopHeading, noteTitle } = await P();
  const prompt = { title: "Findings", body: "Summarize." };
  const ctx = {
    title: "Managing Firm Resources", itemType: "journalArticle", citekey: "sirmon2007",
    reference: "Sirmon, D. G., Hitt, M. A., & Ireland, R. D. (2007). Managing ... 273–292.", citation: "(Sirmon et al., 2007)",
    annotations: [{ pageLabel: "273", type: "highlight", text: "RBV suggests", comment: "key" }],
    notes: [{ title: "Mine", markdown: "my note" }],
    text: "[p. 273]\nFULL TEXT", grounding: { source: "note", label: "the extracted-text note, page by page" },
  };
  const m = buildMessage(prompt, ctx);
  for (const want of ["# Task\n\nSummarize.", "APA 7 reference: Sirmon, D. G.", "in-text citation: (Sirmon et al., 2007)", '[p. 273] highlight "RBV suggests" — comment: key', "## Mine\n\nmy note", "<fulltext>\n[p. 273]\nFULL TEXT\n</fulltext>", "each page starts with its page number"]) {
    assert.ok(m.includes(want), want);
  }
  assert.match(buildMessage(prompt, { title: "T", annotations: [], notes: [], textError: "no file" }), /not available: no file/);
  assert.match(buildMessage(prompt, { title: "T", annotations: [], notes: [], text: "x", grounding: { source: "zotero", label: "Zotero's full-text index" } }), /page breaks are not marked/);
  assert.equal(stripTopHeading("# Title\n\n## A\ntext"), "## A\ntext");
  assert.equal(noteTitle(prompt, ctx), "Findings: Sirmon et al., 2007 — Managing Firm Resources");
});

const CLAUDE = "Claude (subscription)";
const MODELS = [
  { value: "claude:opus[1m]", displayName: "Opus (1M context)", group: CLAUDE, description: "Opus 5", efforts: ["low", "medium", "high", "xhigh", "max"] },
  { value: "claude:sonnet", displayName: "Sonnet", group: CLAUDE, description: "Sonnet 5", efforts: ["low", "medium", "high"] },
  { value: "claude:haiku", displayName: "Haiku", group: CLAUDE, description: "Haiku 4.5", efforts: [] },
  { value: "ollama:qwen3:8b", displayName: "qwen3:8b", group: "Ollama", description: "8.2B · on this computer", efforts: ["low", "medium", "high"] },
];
const PROMPTS = [{ id: "findings-takeaways", title: "Findings and Takeaways", model: "opus[1m]", effort: "high", excerpt: "Write a focused note" }, { id: "literature-review", title: "Literature Review", model: "sonnet", effort: "", excerpt: "Write a complete" }];

test("actions: one Prompts row under the notes opens the submenu; disabled with the runner's problem", () => {
  const details = { item: { itemType: "journalArticle" }, openAction: "select", attachments: [], notes: [{ key: "N1", libraryID: 1, title: "n" }], tags: [], library: { editable: true } };
  const rows = V.buildActions(details, "", PROMPTS, "");
  assert.deepEqual(rows.slice(0, 3).map((r) => r.rowId), ["note", "prompts", "chat"]);
  assert.deepEqual([rows[1].detail, rows[1].available, rows[1].submenu], ["2 prompts · the model writes a new note", true, true]);
  const missing = V.buildActions(details, "", null, "oma-zotero-prompt isn't installed");
  assert.deepEqual([missing[1].rowId, missing[1].available, missing[1].detail], ["prompts", false, "oma-zotero-prompt isn't installed"]);
  assert.equal(V.buildActions(Object.assign({}, details, { item: { itemType: "attachment" } }), "", PROMPTS, "").some((r) => r.rowId === "prompts"), false);
  assert.equal(Object.keys(rows[1]).sort().join(), Object.keys(rows[0]).sort().join()); // same row shape
});

test("prompts submenu: fuzzy over titles, model names from Claude's list, then New prompt…", () => {
  const rows = V.buildPromptRows(PROMPTS, MODELS, "", "#fff", Fuzzy.filter);
  assert.deepEqual(rows.map((r) => r.rowId), ["prompt", "prompt", "prompt-new"]);
  assert.equal(rows[0].detail, "Opus (1M context) · high · Write a focused note");
  assert.equal(rows[1].detail, "Sonnet · model default · Write a complete");
  assert.deepEqual(V.buildPromptRows(PROMPTS, null, "lit", "#fff", Fuzzy.filter).map((r) => r.promptId || r.rowId), ["literature-review", "prompt-new"]);
});

test("prompt editor: title, model and effort (each a page of its own), text", () => {
  const p = PROMPTS[0]; // a prompt file from before providers: a bare Claude name
  assert.deepEqual(V.buildPromptEditor(p, MODELS, "").map((r) => [r.rowId, r.detail, r.submenu]), [
    ["pe-title", "Findings and Takeaways", true],
    ["pe-model", "Opus (1M context) · Opus 5", true],
    ["pe-effort", "high", true],
    ["pe-text", "Write a focused note", true],
  ]);
  // the model page: the default, then every provider's models under its name
  const models = V.buildPromptModels(p, MODELS, "ollama:qwen3:8b");
  assert.deepEqual(models.map((r) => [r.value, r.checked, r.section]), [
    ["default", false, ""], ["claude:opus[1m]", true, CLAUDE], ["claude:sonnet", false, CLAUDE], ["claude:haiku", false, CLAUDE], ["ollama:qwen3:8b", false, "Ollama"]]);
  // the effort page: the levels the model takes
  const efforts = V.buildPromptEfforts(Object.assign({}, p, { model: "claude:sonnet" }), MODELS, "");
  assert.deepEqual(efforts.map((r) => [r.value, r.checked]), [["low", false], ["medium", false], ["high", true]]);
  // a model without effort levels: the row says so and doesn't open
  const haiku = V.buildPromptEditor(Object.assign({}, p, { model: "haiku", effort: "" }), MODELS, "");
  const row = haiku.find((r) => r.rowId === "pe-effort");
  assert.deepEqual([row.available, row.submenu, row.detail], [false, false, "Haiku takes no effort level"]);
  // a model not in the lists is still shown, and offered, as the current one
  const odd = Object.assign({}, p, { model: "opus" });
  assert.equal(V.buildPromptEditor(odd, MODELS, "")[1].detail, "opus (not in your providers' lists)");
  assert.deepEqual(V.buildPromptModels(odd, MODELS, "").filter((r) => r.checked).map((r) => r.value), ["opus"]);
  // "default": follows Settings › Defaults
  const def = V.buildPromptEditor(Object.assign({}, p, { model: "default" }), MODELS, "", "ollama:qwen3:8b");
  assert.equal(def[1].detail, "Default model · now Ollama · qwen3:8b (Settings › Defaults)");
  assert.equal(V.modelLabel(MODELS, "default", "claude:sonnet"), "Default · Sonnet");
  assert.equal(V.modelLabel(MODELS, "sonnet"), "Sonnet");
  // models still loading
  assert.equal(V.buildPromptEditor(p, null, "")[1].detail, "opus[1m]");
});

test("Go to: what you type also finds the launcher's places, on top, with their keys; the cursor starts on the papers", () => {
  const item = { kind: "item", key: "KKKKKKKK", libraryID: 1, title: "Settlement dynamics", itemType: "journalArticle" };
  const rows = V.buildRows({ query: "sett", results: [item] }, "#fff", { tasks: [], chats: 0, keys: "single" });
  assert.deepEqual(rows.map((r) => [r.section, r.kind]), [["Go to", "settings"], ["Go to", "settings-general"], ["Papers", "item"]]);
  assert.equal(rows[0].subtitle, "Models & providers, defaults, general · ;");
  assert.equal(V.selectionAfter(rows, "", true), 2); // on top, but the cursor starts on the paper
  const only = V.buildRows({ query: "tasks", results: [] }, "#fff", { keys: "single" });
  assert.deepEqual([only.map((r) => r.kind), V.selectionAfter(only, "", true)], [["todos"], 0]); // nothing else: on the place
  assert.equal(V.commandRows("ollama", { keys: "alt" })[0].title, "Models & providers");
  assert.equal(V.commandRows("processes", { keys: "alt" })[0].title, "Processes");
  assert.equal(V.commandRows("tasks", { keys: "alt" })[0].subtitle, "Your tasks, by status · alt+t");
  assert.equal(V.commandRows("processes", { keys: "alt" })[0].subtitle, "Prompt runs and text extractions · alt+.");
  assert.deepEqual(V.commandRows("", {}), []);
  assert.deepEqual(V.buildRows({ query: "sett", scope: { key: "C", libraryID: 1 }, results: [] }, "#fff", { keys: "single" }), []); // not inside a collection
});

test("effortFor: keep the level when the new model takes it, else high, else none", () => {
  assert.equal(V.effortFor(MODELS, "sonnet", "high"), "high");
  assert.equal(V.effortFor(MODELS, "sonnet", "max"), "high");
  assert.equal(V.effortFor(MODELS, "haiku", "high"), "");
  assert.equal(V.effortFor(MODELS, "opus[1m]", ""), "high");
  assert.equal(V.effortFor(MODELS, "unknown", "low"), "low");
  assert.deepEqual(V.buildTitleRows("  Methods  ").map((r) => [r.label, r.value, r.available]), [["Rename to “Methods”", "Methods", true]]);
  assert.equal(V.buildTitleRows(" ")[0].available, false);
  assert.equal(V.buildTitleRows("Methods", "create")[0].label, "Create “Methods”");
  // a new prompt can be written with AI from what the header says it should do
  const ai = (text, a) => V.buildTitleRows(text, "create", a).map((r) => [r.rowId, r.label, r.available]);
  assert.deepEqual(ai("Critique the methods", { ready: true }), [["pe-title-save", "Create “Critique the methods”", true], ["pe-title-ai", "Write it with AI: “Critique the methods”", true]]);
  assert.deepEqual(ai("", { ready: true })[1], ["pe-title-ai", "Or describe what it should do, and let AI write it", false]);
  assert.equal(ai("x", { ready: false })[1][2], false);
  assert.match(V.buildTitleRows("x", "create", { ready: false })[1].detail, /Set up an AI model first/);
  assert.deepEqual(ai("x", { ready: true, busy: true })[1], ["pe-title-ai", "Writing the prompt with AI…", false]);
  assert.equal(V.buildTitleRows("x", "rename", { ready: true }).length, 1); // renaming: no AI row
});

test("updatePrompt / models: title, model and effort saved; the SDK list normalized and cached", async () => {
  const { ensureStore, updatePrompt, loadPrompt, validModel } = await P();
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oma-prompts-")), "prompts");
  ensureStore(dir);
  updatePrompt("literature-review", { title: "Lit Review", model: "haiku", effort: "default" }, dir);
  assert.deepEqual((({ title, model, effort }) => ({ title, model, effort }))(loadPrompt("literature-review", dir)), { title: "Lit Review", model: "haiku", effort: "" });
  assert.throws(() => updatePrompt("literature-review", { effort: "huge" }, dir), /bad effort/);
  assert.throws(() => updatePrompt("literature-review", { title: " " }, dir), /empty/);
  for (const ok of ["opus", "opus[1m]", "claude-fable-5[1m]", "claude-haiku-4-5-20251001", "default", "openai:gpt-5.5", "ollama:qwen3:8b"]) assert.equal(validModel(ok), true, ok);
  for (const bad of ["", "a b", "x;rm", "[1m]"]) assert.equal(validModel(bad), false, bad);

  const { getModels, normalizeModels } = await import("../daemon/lib/models.mjs");
  const rows = [{ value: "sonnet", displayName: "Sonnet", description: "d", supportsEffort: true, supportedEffortLevels: ["low", "high"] }, { value: "haiku", displayName: "Haiku", description: "h" }];
  assert.deepEqual(normalizeModels(rows).map((m) => [m.value, m.efforts]), [["sonnet", ["low", "high"]], ["haiku", []]]);
  const cache = path.join(path.dirname(dir), "models.json");
  let calls = 0;
  const queryImpl = () => ({ supportedModels: async () => { calls++; return rows; }, close() {} });
  const a = await getModels({ path: cache, queryImpl, now: 1e12 });
  const b = await getModels({ path: cache, queryImpl, now: 1e12 + 1000 });
  assert.deepEqual([a.models.length, b.models.length, calls], [2, 2, 1]); // second one from the cache
  const failing = () => ({ supportedModels: async () => { throw new Error("offline"); }, close() {} });
  const c = await getModels({ path: cache, queryImpl: failing, now: 1e12 + 2 * 86400000 });
  assert.deepEqual([c.stale, c.error, c.models.length], [true, "offline", 2]); // stale cache beats nothing
});

test("Client: prompt runner argv and list parsing", () => {
  assert.deepEqual(C.promptArgv(C.DEFAULT_SETTINGS, ["list", "--json"]), ["oma-zotero-prompt", "list", "--json"]);
  assert.deepEqual(C.promptArgv({ promptCommand: ["node", "/r.mjs"] }, ["run", "x"]), ["node", "/r.mjs", "run", "x"]);
  assert.deepEqual(C.parsePromptList('{"prompts":[{"id":"a","title":"A","model":"opus","excerpt":"e"},{"id":"../x"}]}'), [{ id: "a", title: "A", model: "opus", effort: "", excerpt: "e" }]);
  assert.equal(C.parsePromptList("nope"), null);
});

test("pins: parse the file, toggle, the action's label, the Pinned section first", () => {
  const pins = V.parsePins('{"pins":[{"key":"AAAAAAAA","libraryID":1,"title":"A"},{"key":"bad"},{"key":"BBBBBBBB"}]}');
  assert.deepEqual(pins, [{ key: "AAAAAAAA", libraryID: 1, title: "A", type: "item" }, { key: "BBBBBBBB", libraryID: 1, title: "", type: "item" }]);
  assert.deepEqual(V.parsePins("not json"), []);
  assert.equal(V.isPinned(pins, { key: "AAAAAAAA", libraryID: 1 }), true);
  assert.equal(V.isPinned(pins, { key: "AAAAAAAA", libraryID: 2 }), false);
  const added = V.togglePin(pins, { key: "CCCCCCCC", libraryID: 3, title: "C" });
  assert.deepEqual(added.map((p) => p.key), ["AAAAAAAA", "BBBBBBBB", "CCCCCCCC"]);
  assert.deepEqual(V.togglePin(added, { key: "AAAAAAAA", libraryID: 1 }).map((p) => p.key), ["BBBBBBBB", "CCCCCCCC"]);
  assert.equal(V.pinRow(false).label, "Pin to the top");
  assert.equal(V.pinRow(true).label, "Unpin");
  const row = (key) => ({ key, libraryID: 1, title: key, itemType: "journalArticle" });
  const rows = V.buildRows({ query: "", pinned: [row("P")], open: [row("O")], recent: [row("R")] }, "#fff");
  assert.deepEqual(rows.map((r) => [r.section, r.key]), [["Pinned", "P"], ["Open in Zotero", "O"], ["Recent", "R"]]);
  assert.deepEqual(V.buildRows({ query: "x", pinned: [], results: [row("S")] }, "#fff").map((r) => r.section), [""]);
});

test("fileName: a note title → a safe .md name", () => {
  assert.equal(C.fileName("Findings: Sirmon et al., 2007 — A/B"), "Findings Sirmon et al., 2007 — A B");
  assert.equal(C.fileName("..hidden"), "hidden");
  assert.equal(C.fileName("  "), "Untitled note");
  assert.equal(C.fileName("x".repeat(300)).length, 120);
  assert.equal(C.fileName('a\u0000b<c>"d|e?*'), "a b c d e");
});

test("noteHtml: headings as sized paragraphs (not Qt's 2× h1), styled blocks and links", () => {
  // a small gap between paragraphs; none between bullets, even as Zotero's <li><p>
  const list = V.noteHtml("<p>a</p><ul><li><p>x</p></li><li>y</li></ul>", { size: 20, color: "#fff", accent: "#f00", dim: "#aaa" });
  assert.match(list, /<p style="margin-top:0px;margin-bottom:9px;[^"]*">a<\/p>/);
  assert.match(list, /<li style="margin-top:0px;margin-bottom:0px;[^"]*"><p style="margin-top:0px;margin-bottom:0px;[^"]*">x<\/p><\/li>/);
  assert.match(list, /<li style="margin-top:0px;margin-bottom:0px;[^"]*">y<\/li>/);
  const o = { size: 14, color: "#eeeeee", accent: "#ffaa00", dim: "rgba(238,238,238,0.7)" };
  const out = V.noteHtml('<h1>Title</h1><h2>Part</h2><p>Text <a href="https://x.org">link</a></p><blockquote><p>q</p></blockquote><table><tr><th>a</th></tr></table>', o);
  assert.ok(!/<h[1-6]/.test(out));
  assert.match(out, /<p style="font-size:18px;font-weight:600;[^"]*">Title<\/p>/);
  assert.match(out, /<p style="font-size:16px;font-weight:600;[^"]*">Part<\/p>/);
  assert.match(out, /<a style="color:#ffaa00;text-decoration:none" href="https:\/\/x.org">/);
  assert.match(out, /<blockquote style="margin-left:17px;[^"]*font-style:italic">/);
  assert.match(out, /<table border="1" cellspacing="0" cellpadding="5"/);
  assert.match(out, /^<div style="font-size:14px;color:#eeeeee">/);
});

test("splitNoteTitle: the repeated first line comes out, with its full text for the header", () => {
  const long = "Findings and Takeaways: Sirmon et al., 2007 — Managing Firm Resources in Dynamic Environments to Create Value: Looking Inside the Black Box";
  const cut = long.slice(0, 120);
  assert.deepEqual(V.splitNoteTitle(`<h1>${long.replace("&", "&amp;")}</h1><h2>In One Sentence</h2>`, cut), { title: long, html: "<h2>In One Sentence</h2>" });
  assert.deepEqual(V.splitNoteTitle("<p><strong>Summary: Sirmon et al. 2007</strong></p><p>Aim</p>", "Summary: Sirmon et al. 2007"), { title: "Summary: Sirmon et al. 2007", html: "<p>Aim</p>" });
  // a first block that isn't the title stays
  assert.deepEqual(V.splitNoteTitle("<p>Other text</p><p>b</p>", "Summary"), { title: "Summary", html: "<p>Other text</p><p>b</p>" });
  assert.deepEqual(V.splitNoteTitle("", "T"), { title: "T", html: "" });
  assert.equal(V.paperCite({ authors: "Sirmon et al.", year: "2007" }), "Sirmon et al. (2007)");
  assert.equal(V.paperCite({ authors: "World Bank", year: "" }), "World Bank");
  assert.equal(V.paperCite(null), "");
});

test("actions: Chat and the extraction row; it says whether the text is extracted, and extracts or replaces it", () => {
  const pdf = { key: "PPPPPPPP", libraryID: 1, contentType: "application/pdf", exists: true };
  const base = { item: { itemType: "journalArticle" }, openAction: "select", attachments: [pdf], notes: [], tags: [], library: { editable: true } };
  const byId = (rows) => Object.fromEntries(rows.map((r) => [r.rowId, r]));
  let a = byId(V.buildActions(base, "", PROMPTS, ""));
  assert.deepEqual([a.chat.label, a.chat.available, a.extract.label, a.extract.available, a.extract.value], ["Chat with the paper", true, "Text not extracted", true, "extract"]);
  const saved = { key: "FFFFFFFF", libraryID: 1, title: "Full text: T", fulltext: true, dateModified: "2026-09-29 10:00:00" };
  a = byId(V.buildActions(Object.assign({}, base, { notes: [saved] }), "", PROMPTS, ""));
  assert.deepEqual([a.extract.label, a.extract.value, a.extract.available, a.extract.detail], ["Text extracted", "replace", true, "Saved 2026-09-29 · Enter extracts it again and replaces the note"]);
  assert.equal(a.note.noteKey, "FFFFFFFF"); // the note itself is read from the Notes section
  assert.match(a.chat.detail, /extracted text/);
  a = byId(V.buildActions(Object.assign({}, base, { attachments: [] }), "", PROMPTS, ""));
  assert.deepEqual([a.extract.available, a.extract.detail], [false, "No PDF to extract from"]);
  a = byId(V.buildActions(base, "", null, "oma-zotero-prompt isn't installed"));
  assert.deepEqual([a.chat.available, a.chat.detail], [false, "oma-zotero-prompt isn't installed"]);
});

test("tasks view: Clear finished tasks first, then the tasks newest first", () => {
  const tasks = [
    { id: "b", title: "Findings", paper: "Sirmon et al., 2007", status: "running", started: "2026-09-29T12:00:00Z" },
    { id: "a", title: "Lit Review", paper: "Pimm, 1984", status: "done", started: "2026-09-29T11:00:00Z", finished: "2026-09-29T11:05:00Z", noteKey: "NNNNNNNN", key: "AAAAAAAA", libraryID: 1 },
  ];
  const rows = V.buildTaskRows(tasks, "", "#fff", Fuzzy.filter);
  assert.deepEqual(rows.map((r) => r.rowId), ["tasks-clear", "task", "task"]);
  assert.deepEqual([rows[1].label, rows[1].available, rows[2].noteKey], ["Findings — Sirmon et al., 2007", false, "NNNNNNNN"]);
  // only running tasks: nothing to clear
  assert.deepEqual(V.buildTaskRows([tasks[0]], "", "#fff", Fuzzy.filter).map((r) => r.rowId), ["task"]);
  // Processes: a heading per state, running first, then finished, then failed (each newest first)
  const all = tasks.concat([{ id: "c", title: "Extract", paper: "X", status: "error", started: "2026-09-29T13:00:00Z", finished: "2026-09-29T13:01:00Z", error: "no PDF" },
    { id: "d", title: "Findings", paper: "Y", status: "done", started: "2026-09-29T12:30:00Z", finished: "2026-09-29T12:40:00Z", noteKey: "MMMMMMMM" }]);
  assert.deepEqual(V.buildTaskRows(all, "", "#fff", Fuzzy.filter).map((r) => [r.section, r.value]), [["", ""], ["Running", "b"], ["Finished", "d"], ["Finished", "a"], ["Failed", "c"]]);
});

test("results: before you type, only papers (Chats, Tasks and Settings are keys, and Go to when typing)", () => {
  const item = (k) => ({ key: k, libraryID: 1, title: k, itemType: "journalArticle" });
  const rows = V.buildRows({ query: "", pinned: [], open: [item("O")], recent: [item("R")] }, "#fff", { tasks: [{ status: "done" }], chats: 2 });
  assert.deepEqual(rows.map((r) => r.kind), ["item", "item"]);
  assert.equal(V.selectionAfter(rows, "", true), 0);
  assert.equal(V.selectionAfter(rows, "R", false), 1); // a row you moved to stays
  assert.equal(V.workspaceRows({ tasks: [], chats: -1, setup: true })[0].subtitle, "Set up an AI model for prompts and chat · ;");
});

test("chats: grouped by paper (a heading each), the paper with the newest chat first, its chats newest first", () => {
  const chat = (id, title, updated, key, paper) => ({ id, title, updated, turns: 1, key, libraryID: 1, paper });
  const chats = [chat("1", "q about A", "2026-09-28", "AAAAAAAA", "A et al., 2007"), chat("2", "q about B", "2026-09-30", "BBBBBBBB", "B, 2020"),
    chat("3", "older about B", "2026-09-20", "BBBBBBBB", "B, 2020"), chat("4", "newer about A", "2026-09-29", "AAAAAAAA", "A et al., 2007")];
  const rows = V.buildChatRows(chats, "", "#fff", Fuzzy.filter);
  assert.deepEqual(rows.map((r) => [r.section, r.label]), [["", "New chat…"],
    ["B, 2020", "q about B"], ["B, 2020", "older about B"], ["A et al., 2007", "newer about A"], ["A et al., 2007", "q about A"]]);
  assert.equal(rows[1].detail, "2026-09-30 · 1 question"); // the paper is the heading, not repeated
  // typing: the paper whose chat matches best first, still grouped
  assert.deepEqual(V.buildChatRows(chats, "newer", "#fff", Fuzzy.filter).slice(1).map((r) => r.section), ["A et al., 2007"]);
});

test("the paper's menu: its chats, notes in your order, a running extraction; sections in your order", () => {
  const details = { item: { itemType: "journalArticle" }, attachments: [{ exists: true, contentType: "application/pdf" }], tags: [], library: { editable: true },
    notes: [{ key: "N1", libraryID: 1, title: "one" }, { key: "N2", libraryID: 1, title: "two" }, { key: "N3", libraryID: 1, title: "three" }] };
  const chats = [{ id: "2026-09-30T01-00-00-000-aaaaaa", title: "What is bundling?", updated: "2026-09-30", turns: 2, model: "claude:haiku" }];
  const rows = V.buildActions(details, "", PROMPTS, "", false, false, { chats, noteOrder: ["N3", "N1"], extracting: true });
  assert.deepEqual(rows.filter((r) => r.section === "Notes").map((r) => r.noteKey), ["N3", "N1", "N2"]); // yours first, then the rest
  const chat = rows.find((r) => r.rowId === "chat-session");
  assert.deepEqual([chat.section, chat.label, chat.value, chat.detail], ["Chats", "What is bundling?", chats[0].id, "2026-09-30 · 2 questions · claude:haiku"]);
  const ex = rows.find((r) => r.rowId === "extract");
  assert.deepEqual([ex.label, ex.available, ex.badge], ["Extracting the text…", false, "running"]);
  assert.deepEqual(V.orderNotes([{ key: "a" }, { key: "b" }], []).map((n) => n.key), ["a", "b"]);
  // Ctrl+Shift+↑/↓: sections move as a whole, and the order sticks
  const sections = [...new Set(rows.map((r) => r.section))];
  assert.deepEqual(sections, ["Notes", "Chats", "Prompts and chat", "This paper"]);
  const moved = V.moveSection(rows, "This paper", -1);
  assert.deepEqual(moved, ["Notes", "Chats", "This paper", "Prompts and chat"]);
  assert.deepEqual([...new Set(V.orderSections(rows, moved).map((r) => r.section))], moved);
  assert.equal(V.orderSections(rows, moved).length, rows.length);
  assert.equal(V.moveSection(rows, "Notes", -1), null); // already first
  // a section the saved order doesn't know stays where it was
  assert.deepEqual([...new Set(V.orderSections(rows, ["This paper", "Notes"]).map((r) => r.section))], ["This paper", "Chats", "Prompts and chat", "Notes"]);
});

test("meta prompt: the request carries the description, the rules and own instructions, and the bundled prompts as examples", async () => {
  const { buildMetaMessage, defaultPrompts, META_SYSTEM } = await P();
  const examples = defaultPrompts();
  assert.deepEqual(examples.map((e) => e.title).sort(), ["Findings and Takeaways", "Literature Review"]);
  const m = buildMetaMessage("  Critique the methods  ", { main: "## Rigor\n- be careful", examples });
  assert.match(m, /^# What the user wants the prompt to do\n\nCritique the methods\n/);
  assert.match(m, /# The user's rules and own instructions[^\n]*\n\n## Rigor\n- be careful/);
  assert.equal((m.match(/<title>/g) || []).length, 2);
  assert.match(buildMetaMessage("x"), /own instructions[^\n]*\n\n\(none\)/);
  assert.match(META_SYSTEM, /<title>[\s\S]*<prompt>[\s\S]*<\/prompt>$/);
});

test("meta prompt: the answer → title and text, leniently", async () => {
  const { parseMetaAnswer } = await P();
  assert.deepEqual(parseMetaAnswer("<title>Methods Critique</title>\n<prompt>\nWrite a note.\n\n## References\nAPA 7.\n</prompt>"), { title: "Methods Critique", body: "Write a note.\n\n## References\nAPA 7." });
  // preamble, a fenced block, no closing tag
  assert.deepEqual(parseMetaAnswer("Sure!\n<title>**Gaps**</title>\n<prompt>\n```markdown\nFind the gaps.\n```"), { title: "Gaps", body: "Find the gaps." });
  // no tags: a "Title:" line and the rest
  assert.deepEqual(parseMetaAnswer("Title: Theory Map\n\nMap the theories."), { title: "Theory Map", body: "Map the theories." });
  // no title at all: the description, shortened
  assert.deepEqual(parseMetaAnswer("Just the text.", "compare this paper with the RBV literature for my chapter two"), { title: "compare this paper with the RBV literature for my chapter tw", body: "Just the text." });
});

test("createPrompt: with a body (written with AI), the file holds it", async () => {
  const { createPrompt, loadPrompt, ensureStore } = await P();
  const dir = ensureStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oma-prompts-")), "prompts"));
  const { id } = createPrompt("Methods\nCritique", dir, "## Design\nIts design.");
  assert.deepEqual(loadPrompt(id, dir), { id: "methods-critique", title: "Methods Critique", model: "default", effort: "high", body: "## Design\nIts design." });
  assert.match(loadPrompt(createPrompt("Stub", dir).id, dir).body, /^Describe the note/);
});

test("system prompt: the runner's description, then the rules on for prompts or chat, then the user's own instructions", async () => {
  const { loadRules, activeRules, rulesMarkdown, systemFor, standingText, loadInstructions, ensureInstructionsFile, clearInstructions, instructionsPath, INSTRUCTIONS_TEMPLATE } = await import("../daemon/lib/system.mjs");
  const { SYSTEM } = await P();
  const { CHAT_SYSTEM } = await import("../daemon/lib/chat.mjs");
  // no rules are hard-coded in the runner's own text
  for (const base of [SYSTEM, CHAT_SYSTEM]) assert.doesNotMatch(base, /never invent|verbatim|References|Markdown|concise/i);
  const rules = loadRules();
  assert.ok(rules.every((r) => /^[a-z][a-z0-9-]{1,40}$/.test(r.id) && r.section && r.label && (r.text || r.prompt || r.chat)));
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length);
  const ids = (ctx, over) => activeRules(rules, over, ctx).map((r) => r.id);
  assert.ok(ids("prompt").includes("only-the-note") && !ids("prompt").includes("concise"));
  assert.ok(ids("chat").includes("concise") && !ids("chat").includes("only-the-note"));
  assert.ok(!ids("prompt", { references: false }).includes("references"));
  const p = systemFor(SYSTEM, { rules, context: "prompt" });
  assert.ok(p.startsWith(SYSTEM + "\n\n# Rules\n\n## Grounded in the paper\n- Work from the material given"));
  assert.match(p, /## References \(APA 7\)\n- End with a "## References" section in APA 7/);
  assert.doesNotMatch(p, /own instructions/);
  const c = systemFor(CHAT_SYSTEM, { rules, overrides: { concise: false, markdown: false }, instructions: "Use Harvard style.", context: "chat" });
  assert.match(c, /When you cite any work, end with a short "References" list/);
  assert.doesNotMatch(c, /## Format|Be concise/); // a section with nothing on goes
  assert.ok(c.endsWith("# The user's own instructions\n\nWhere they differ from the rules above, follow them.\n\nUse Harvard style."));
  const none = Object.fromEntries(rules.map((r) => [r.id, false]));
  assert.equal(systemFor(SYSTEM, { rules, overrides: none }), SYSTEM);
  assert.equal(standingText({ rules, overrides: none }), "");
  assert.equal(standingText({ rules, overrides: none, instructions: "X" }), "## The user's own instructions\n\nX");
  assert.equal(rulesMarkdown([], "prompt"), "");
  // the instructions file: none, the template (comments left out), yours
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oma-instr-")), "cfg", "instructions.md");
  assert.equal(loadInstructions(file), "");
  ensureInstructionsFile(file);
  assert.equal(fs.readFileSync(file, "utf8"), INSTRUCTIONS_TEMPLATE + "\n");
  assert.equal(loadInstructions(file), "");
  fs.writeFileSync(file, INSTRUCTIONS_TEMPLATE + "\r\nUse Harvard style.\r\n");
  assert.equal(loadInstructions(file), "Use Harvard style.");
  ensureInstructionsFile(file); // an existing file is left alone
  assert.equal(loadInstructions(file), "Use Harvard style.");
  clearInstructions(file);
  assert.equal(fs.existsSync(file), false);
  assert.equal(instructionsPath({ HOME: "/h" }), "/h/.config/omarchy/oma-zotero-launcher/instructions.md");
  assert.equal(instructionsPath({ HOME: "/h", XDG_CONFIG_HOME: "/x" }), "/x/omarchy/oma-zotero-launcher/instructions.md");
});

test("settings: the rules section, read leniently by the runner", async () => {
  const { readSettings } = await import("../daemon/lib/settings.mjs");
  assert.deepEqual(readSettings(null).rules, {});
  assert.deepEqual(readSettings({ rules: { concise: false, markdown: true, "Bad!": false, x: "no" } }).rules, { concise: false, markdown: true });
});
