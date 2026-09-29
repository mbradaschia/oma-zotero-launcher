// The prompt runner's pure parts (daemon/lib/prompts.mjs), the overlay's prompt rows
// (lib/Views.js) and the runner argv / list parsing (lib/Client.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const V = require("../lib/Views.js");
const C = require("../lib/Client.js");

const P = () => import("../daemon/lib/prompts.mjs");

test("parsePrompt: frontmatter, defaults for bad values, a file without frontmatter is all body", async () => {
  const { parsePrompt, serializePrompt } = await P();
  assert.deepEqual(parsePrompt("---\ntitle: Lit Review\nmodel: sonnet\neffort: max\n---\n\nDo it.\n", "lit"), { id: "lit", title: "Lit Review", model: "sonnet", effort: "max", body: "Do it." });
  assert.deepEqual(parsePrompt("---\ntitle: 'Q'\nmodel: gpt\neffort: huge\n---\nX", "q"), { id: "q", title: "Q", model: "opus", effort: "high", body: "X" });
  assert.deepEqual(parsePrompt("Just this.", "plain"), { id: "plain", title: "plain", model: "opus", effort: "high", body: "Just this." });
  const p = { id: "a", title: "A: b", model: "haiku", effort: "low", body: "line 1\n\nline 2" };
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
    fulltext: { title: "paper.pdf", text: "FULL TEXT", chars: 9, totalChars: 9, truncated: false },
  };
  const m = buildMessage(prompt, ctx);
  for (const want of ["# Task\n\nSummarize.", "APA 7 reference: Sirmon, D. G.", "in-text citation: (Sirmon et al., 2007)", '[p. 273] highlight "RBV suggests" — comment: key', "## Mine\n\nmy note", "<fulltext>\nFULL TEXT\n</fulltext>"]) {
    assert.ok(m.includes(want), want);
  }
  assert.match(buildMessage(prompt, { title: "T", annotations: [], notes: [], fulltextError: "no file" }), /not available: no file/);
  assert.equal(stripTopHeading("# Title\n\n## A\ntext"), "## A\ntext");
  assert.equal(noteTitle(prompt, ctx), "Findings: Sirmon et al., 2007 — Managing Firm Resources");
});

test("actions: prompts listed below the notes, then New prompt…; a problem row when the runner is missing", () => {
  const details = { item: { itemType: "journalArticle" }, openAction: "select", attachments: [], notes: [{ key: "N1", libraryID: 1, title: "n" }], tags: [], library: { editable: true } };
  const prompts = [{ id: "findings-takeaways", title: "Findings and Takeaways", model: "opus" }, { id: "literature-review", title: "Literature Review", model: "opus" }];
  const rows = V.buildActions(details, "", prompts, "");
  assert.deepEqual(rows.slice(0, 6).map((r) => r.rowId), ["notes", "note", "prompt", "prompt", "prompt-new", "open"]);
  assert.deepEqual([rows[2].label, rows[2].promptId, rows[2].available], ["Findings and Takeaways", "findings-takeaways", true]);
  const missing = V.buildActions(details, "", null, "oma-zotero-prompt isn't installed");
  assert.deepEqual([missing[2].rowId, missing[2].available, missing[2].detail], ["prompts", false, "oma-zotero-prompt isn't installed"]);
  assert.deepEqual(V.buildActions(details, "", null, "").map((r) => r.rowId).slice(0, 3), ["notes", "note", "open"]); // not listed yet
  // no prompts on a note or an attachment
  assert.equal(V.buildActions(Object.assign({}, details, { item: { itemType: "attachment" } }), "", prompts, "").some((r) => r.rowId === "prompt"), false);
  // same row shape everywhere
  assert.equal(Object.keys(rows[2]).sort().join(), Object.keys(rows[0]).sort().join());
});

test("Client: prompt runner argv and list parsing", () => {
  assert.deepEqual(C.promptArgv(C.DEFAULT_SETTINGS, ["list", "--json"]), ["oma-zotero-prompt", "list", "--json"]);
  assert.deepEqual(C.promptArgv({ promptCommand: ["node", "/r.mjs"] }, ["run", "x"]), ["node", "/r.mjs", "run", "x"]);
  assert.deepEqual(C.parsePromptList('{"prompts":[{"id":"a","title":"A","model":"opus"},{"id":"../x"}]}'), [{ id: "a", title: "A", model: "opus", effort: "" }]);
  assert.equal(C.parsePromptList("nope"), null);
});
