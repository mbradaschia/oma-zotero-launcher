// The prompt runner's text extraction (daemon/lib/extract.mjs) and chat store (daemon/lib/chat.mjs).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const X = () => import("../daemon/lib/extract.mjs");
const C = () => import("../daemon/lib/chat.mjs");

test("splitPages / pageLabels: printed page numbers, else the item's range, else the PDF's", async () => {
  const { splitPages, pageLabels } = await X();
  assert.deepEqual(splitPages("a\fb\f\f"), ["a", "b"]);
  // journal pages printed at the top: 273, 274, … (the first page has none)
  const printed = ["Title page\ntext", "274\nAcademy\ntext", "text\nmore\n275", "276\ntext", "text\n277"];
  assert.deepEqual(pageLabels(printed, ""), { labels: ["273", "274", "275", "276", "277"], source: "printed" });
  // nothing printed: the item's page range, when its length matches
  const plain = ["a", "b", "c"];
  assert.deepEqual(pageLabels(plain, "10-12"), { labels: ["10", "11", "12"], source: "range" });
  assert.deepEqual(pageLabels(plain, "10–13"), { labels: ["10", "11", "12"], source: "range" }); // one page off is fine
  assert.deepEqual(pageLabels(plain, "10-30"), { labels: ["1", "2", "3"], source: "pdf" });
  assert.deepEqual(pageLabels(plain, ""), { labels: ["1", "2", "3"], source: "pdf" });
  // stray numbers (a table's cells) don't win against too few votes
  assert.equal(pageLabels(["5\nx", "y", "z", "w", "v"], "").source, "pdf");
});

test("paragraphs: lines joined, hyphenated breaks mended, blank lines split", async () => {
  const { paragraphs } = await X();
  assert.deepEqual(paragraphs("high environmental uncer-\ntainty and\nmore\n\nNext para-\ngraph"), ["high environmental uncertainty and more", "Next paragraph"]);
  assert.deepEqual(paragraphs("Well-\nKnown"), ["Well- Known"]); // a capital after the break: a real hyphen
});

test("buildNote: title, provenance, one section per page, escaped, cut under Zotero's size", async () => {
  const { buildNote, groundingText, MAX_NOTE_CHARS } = await X();
  const n = buildNote({ title: "A & B", pages: ["x < y", "z"], labels: ["273", "274"], source: "printed", file: "p.pdf", extractor: "pdftotext", date: "2026-09-29" });
  assert.match(n.html, /^<h1>Full text: A &amp; B<\/h1>/);
  assert.match(n.html, /page numbers as printed in the paper/);
  assert.match(n.html, /<h2>p\. 273<\/h2>\n<p>x &lt; y<\/p>/);
  assert.equal(n.cut, false);
  const big = buildNote({ title: "T", pages: Array(10).fill("w ".repeat(40000)), labels: Array(10).fill("1"), source: "pdf", file: "f", extractor: "e", date: "d" });
  assert.equal(big.cut, true);
  assert.ok(big.chars < MAX_NOTE_CHARS + 500);
  assert.match(big.html, /The text stops here/);
  assert.equal(groundingText(["a\nb", "c"], ["5", "6"]), "[p. 5]\na b\n\n[p. 6]\nc");
});

test("pdftotext: a missing pdftotext says how to install it", async () => {
  const { pdftotext } = await X();
  const { EventEmitter } = require("node:events");
  const fake = () => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stdout.setEncoding = () => {};
    p.stderr = new EventEmitter();
    setImmediate(() => p.emit("error", Object.assign(new Error("spawn"), { code: "ENOENT" })));
    return p;
  };
  await assert.rejects(pdftotext("/x.pdf", fake), /poppler/);
});

test("chat store: sessions saved per paper, listed newest first; ids and titles", async () => {
  const { chatsDir, newSessionId, validSessionId, titleFor, saveSession, loadSession, listSessions, groundingMessage, replayMessage } = await C();
  const env = { XDG_STATE_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "oma-chat-")) };
  const dir = chatsDir("VH56BBHJ", 1, env);
  assert.throws(() => chatsDir("../x", 1, env), /bad item key/);
  const a = newSessionId(new Date("2026-09-29T10:00:00Z"));
  const b = newSessionId(new Date("2026-09-29T11:00:00Z"));
  assert.equal(validSessionId(a), true);
  assert.equal(validSessionId("../../etc"), false);
  saveSession(dir, { id: a, title: "First", created: "1", updated: "2026-09-29T10:00:00Z", messages: [{ role: "user", text: "q" }, { role: "assistant", text: "a" }] });
  saveSession(dir, { id: b, title: "Second", created: "1", updated: "2026-09-29T11:00:00Z", messages: [] });
  assert.deepEqual(listSessions(dir).map((s) => [s.title, s.turns]), [["Second", 0], ["First", 1]]);
  assert.equal(loadSession(dir, a).title, "First");
  assert.throws(() => loadSession(dir, "nope"), /bad session id/);
  assert.deepEqual(listSessions(path.join(dir, "none")), []);
  assert.equal(titleFor("  What   is the main argument?  "), "What is the main argument?");
  assert.equal(titleFor("x".repeat(100)).length, 70);
  const ctx = { title: "T", reference: "Ref.", citation: "(A, 2007)", annotations: [{ pageLabel: "3", text: "hl" }], notes: [], text: "[p. 3]\nbody", grounding: { label: "the extracted-text note" } };
  const m = groundingMessage(ctx, "Why?");
  for (const want of ["APA 7 in-text citation: (A, 2007)", '[p. 3] "hl"', "(the extracted-text note)", "<paper>\n[p. 3]\nbody\n</paper>", "# The question\n\nWhy?"]) assert.ok(m.includes(want), want);
  assert.match(replayMessage(ctx, [{ role: "user", text: "q1" }, { role: "assistant", text: "a1" }], "q2"), /\*\*User:\*\* q1\n\n\*\*You:\*\* a1\n\n\(Now:\) q2/);
});

test("tasks: start, finish, fail, the index newest first, dead runs stopped, clear", async () => {
  const T = await import("../daemon/lib/tasks.mjs");
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "oma-tasks-")), "tasks");
  const a = T.startTask({ kind: "prompt", title: "Lit Review", key: "AAAAAAAA", libraryID: 1, paper: "Sirmon et al., 2007" }, dir);
  await new Promise((r) => setTimeout(r, 5)); // a later start, not the same millisecond
  const b = T.startTask({ kind: "extract", title: "Extract the text", key: "BBBBBBBB", libraryID: 1 }, dir);
  let idx = JSON.parse(fs.readFileSync(path.join(dir, "tasks.json"), "utf8")).tasks;
  assert.deepEqual(idx.map((t) => [t.title, t.status]), [["Extract the text", "running"], ["Lit Review", "running"]]);
  T.finishTask(a, { noteKey: "NNNNNNNN", noteTitle: "Lit Review: …" }, dir);
  T.failTask(b, "no PDF", dir);
  idx = JSON.parse(fs.readFileSync(path.join(dir, "tasks.json"), "utf8")).tasks;
  assert.deepEqual(idx.map((t) => [t.status, t.noteKey || t.error]), [["error", "no PDF"], ["done", "NNNNNNNN"]]);
  // a run whose process died is reported as stopped
  const c = T.startTask({ kind: "prompt", title: "Crashed", key: "CCCCCCCC", libraryID: 1, pid: 999999999 }, dir);
  assert.equal(T.listTasks(dir, () => false).find((t) => t.id === c.id).error, "stopped before it finished");
  assert.deepEqual(T.clearTasks(dir).map((t) => t.status), []);
});

test("context: measure a turn, decide when to compact, keep the last exchanges, fit the paper", async () => {
  const X = await import("../daemon/lib/context.mjs");
  // a turn's usage: input (cached or not) + output, and the model's window
  assert.deepEqual(X.measure({ input_tokens: 10, cache_read_input_tokens: 50000, cache_creation_input_tokens: 2000, output_tokens: 800 }, { "claude-x": { contextWindow: 200000 } }), { used: 52810, window: 200000 });
  assert.deepEqual(X.measure(null, null), { used: 0, window: 0 });
  // windows: learned > known > default
  assert.equal(X.windowFor("opus[1m]", {}), 1000000);
  assert.equal(X.windowFor("haiku", {}), 200000);
  assert.equal(X.windowFor("haiku", { haiku: 180000 }), 180000);
  // compaction threshold: 75% of the window, with room for the answer and the question
  assert.equal(X.needsCompaction({ used: 100000, window: 200000 }, "why?"), false);
  assert.equal(X.needsCompaction({ used: 140000, window: 200000 }, "why?"), true); // 140k + 16k reserve > 150k
  assert.equal(X.needsCompaction(null, "why?"), false);
  // the last two exchanges stay verbatim; notes are skipped
  const msgs = [
    { role: "user", text: "q1" }, { role: "assistant", text: "a1" }, { role: "note", text: "summarized" },
    { role: "user", text: "q2" }, { role: "assistant", text: "a2" }, { role: "user", text: "q3" }, { role: "assistant", text: "a3" },
  ];
  const { older, recent } = X.splitHistory(msgs);
  assert.deepEqual(older.map((m) => m.text), ["q1", "a1"]);
  assert.deepEqual(recent.map((m) => m.text), ["q2", "a2", "q3", "a3"]);
  assert.deepEqual(X.splitHistory(msgs.slice(0, 2)).older, []); // too short: nothing to summarize
  // the summary request keeps quotes with pages and builds on an earlier summary
  const p = X.compactionPrompt(older, "- earlier: x");
  assert.match(p, /verbatim quote with its citation and page/);
  assert.match(p, /# Summary of the conversation before this part\n\n- earlier: x/);
  assert.match(p, /\*\*User:\*\* q1\n\n\*\*Assistant:\*\* a1/);
  // the fresh session: the paper whole, the summary, the recent turns verbatim, the question
  const ctx = { title: "T", annotations: [], notes: [], text: "[p. 1]\nbody", grounding: { label: "the note" } };
  const m = X.compactedMessage(ctx, "- the summary", recent, "q4");
  for (const want of ["<paper>\n[p. 1]\nbody\n</paper>", "(Our conversation so far, summarized:)\n\n- the summary", "**User:** q3", "(Now:) q4"]) assert.ok(m.includes(want), want);
  // the paper only gets cut when it can't fit the model at all (60% of the window)
  assert.deepEqual(X.fitPaper("short", 200000), { text: "short", cut: false });
  const cut = X.fitPaper("x".repeat(100000), 20000);
  assert.equal(cut.cut, true);
  assert.ok(cut.text.length < 100000 && /cut here/.test(cut.text));
  assert.equal(X.estimateTokens("x".repeat(360)), 100);
});
