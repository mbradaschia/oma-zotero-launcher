// The prompt runner's text extraction (daemon/lib/extract.mjs) and chat store (daemon/lib/chat.mjs).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const X = () => import("../../runner/lib/extract.mjs");
const C = () => import("../../runner/lib/chat.mjs");

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

test("pdftotext: macOS refusing the file says where to allow it", async () => {
  const { pdftotextProblem } = await X();
  const denied = "I/O Error: Couldn't open file '/Volumes/Drive/Zotero/storage/K/x.pdf': Operation not permitted.";
  assert.match(pdftotextProblem(denied, 1, "darwin"), /^macOS didn't let the AI features read the PDF: .*Privacy & Security › Files and Folders/);
  assert.doesNotMatch(pdftotextProblem(denied, 1, "darwin"), /storage/, "the paper's path isn't repeated");
  assert.equal(pdftotextProblem(denied, 1, "linux"), "pdftotext failed: " + denied);
  assert.equal(pdftotextProblem("", 3, "darwin"), "pdftotext failed: exit 3");
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
  const T = await import("../../runner/lib/tasks.mjs");
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
  // a day after it finished, a done task goes by itself; a failed one stays
  const day = Date.now() + 25 * 3600 * 1000;
  assert.deepEqual(T.writeIndex(dir, () => false, day).filter((t) => t.id !== c.id).map((t) => t.status), ["error"]);
  assert.equal(fs.existsSync(path.join(dir, a.id + ".json")), false);
  assert.deepEqual(T.clearTasks(dir).map((t) => t.status), []);
});

test("context: measure a turn, decide when to compact, keep the last exchanges, fit the paper", async () => {
  const X = await import("../../runner/lib/context.mjs");
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

test("chats: deleteSession forgets one chat, and only a real one", async () => {
  const c = await C();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oma-chats-"));
  const id = c.newSessionId(new Date("2026-09-30T00:00:00Z"));
  c.saveSession(dir, { id, title: "t", messages: [], updated: "2026-09-30" });
  assert.equal(c.listSessions(dir).length, 1);
  c.deleteSession(dir, id);
  assert.equal(c.listSessions(dir).length, 0);
  assert.throws(() => c.deleteSession(dir, id), /no such chat/);
  assert.throws(() => c.deleteSession(dir, "../../etc/passwd"), /bad session id/);
});

test("automatic extraction: why a paper is left alone (not a paper, extracted, no PDF, too large), and a scan", async () => {
  const { skipReason, isScan } = await X();
  const MB = 1048576;
  assert.equal(skipReason({ paper: true, extracted: false, pdf: true, bytes: 3 * MB, maxBytes: 40 * MB }), "");
  assert.equal(skipReason({ paper: true, extracted: false, pdf: true, bytes: 300 * MB, maxBytes: 0 }), ""); // no limit
  assert.equal(skipReason({ paper: false }), "not a paper");
  assert.equal(skipReason({ paper: true, extracted: true, pdf: true }), "already extracted");
  assert.equal(skipReason({ paper: true, extracted: false, pdf: false }), "no PDF on disk");
  assert.equal(skipReason({ paper: true, extracted: false, pdf: true, bytes: 61 * MB, maxBytes: 40 * MB }), "large PDF (61 MB, over 40 MB)");
  assert.equal(isScan("the PDF has no text layer (a scan?): nothing to extract"), true);
  assert.equal(isScan("pdftotext failed: exit 1"), false);
});

test("OCR: every page kept, the empty ones read by OCR, the languages installed, the reasons a scan is left alone", async () => {
  const { rawPages, pagesToOcr, pickLanguages, systemLanguage, ocrLine, scanReason, tesseractHint, isScan } = await X();
  const text = "Cover sheet: downloaded from a library, with terms of use\f\f\f";
  assert.deepEqual(rawPages(text), ["Cover sheet: downloaded from a library, with terms of use", "", ""]); // a cover sheet, then two scanned pages
  assert.deepEqual(pagesToOcr(rawPages(text)), [1, 2]);
  assert.deepEqual(pagesToOcr(rawPages("\f\f")), [0, 1]); // a scan
  const listed = "List of available languages in \"/usr/share/tessdata/\" (5):\nafr\neng\nosd\npor\nspa\n";
  assert.equal(pickLanguages(listed), "eng"); // not every language installed (Homebrew's tesseract-lang has 160)
  assert.equal(pickLanguages(listed, "por"), "eng+por"); // English and your system's
  assert.equal(pickLanguages(listed, "deu"), "eng"); // yours, when it's installed
  assert.equal(pickLanguages("List of available languages (1):\nfra\n"), "fra"); // no English: the one there is
  assert.equal(pickLanguages("List of available languages (1):\nosd\n"), "");
  assert.equal(systemLanguage({ LANG: "pt_BR.UTF-8" }), "por");
  assert.equal(systemLanguage({ LC_ALL: "de_DE.UTF-8", LANG: "en_US.UTF-8" }), "deu");
  assert.equal(systemLanguage({ LANG: "C" }), "");
  assert.equal(ocrLine(["1", "2", "3", "4", "5"], [1, 2, 4]), "p. 2–3, 5 read by OCR (Tesseract)");
  assert.equal(ocrLine(["7", "8"], [0, 1]), "every page read by OCR (Tesseract)");
  assert.equal(ocrLine(["7", "8"], []), "");
  const needs = `the PDF has no text layer (a scan?): reading it needs Tesseract (OCR: ${tesseractHint("linux")})`;
  assert.ok(isScan(needs));
  assert.equal(tesseractHint("linux"), "omarchy pkg add tesseract tesseract-data-eng");
  assert.equal(tesseractHint("darwin"), "brew install tesseract");
  assert.equal(scanReason(needs), "a scan, with no text layer: reading it needs Tesseract (Settings › Setup › Read scans by OCR)");
  assert.equal(scanReason("the PDF has no text layer (a scan of 120 pages: OCR reads 80 at most)"), "a scan of 120 pages, over the 80 read by OCR");
  assert.equal(scanReason("the PDF has no text layer, and OCR found no text in it (a blank or unreadable scan)"), "a scan, with no text layer: OCR found no text in it");
  assert.equal(scanReason("the PDF has no text layer (a scan of 60 pages: OCR took over 10 minutes)"), "a scan too long to read by OCR (over 10 minutes)");
  assert.equal(scanReason("the PDF has no text layer, and OCR failed (tesseract failed on page 1: Error)"), "a scan, with no text layer: OCR failed on it");
  const S = require("../lib/Settings.js");
  assert.deepEqual(["a scan, with no text layer: OCR it first", scanReason(needs), "a scan, with no text layer", scanReason("a scan of 120 pages"),
    scanReason("OCR found"), scanReason("OCR took over"), scanReason("OCR failed"), "large PDF (61 MB, over 40 MB)"].map(S.isRetryableScan),
  [true, true, true, false, false, false, false, false]); // a scan OCR gave up on isn't offered again
});

test("OCR: the note says which pages OCR read", async () => {
  const { buildNote } = await X();
  const n = buildNote({ title: "T", pages: ["a page of text", "scanned words"], labels: ["1", "2"], source: "pdf", file: "t.pdf", extractor: "pdftotext and Tesseract OCR", date: "2026-10-13", ocr: [1] });
  assert.match(n.html, /with pdftotext and Tesseract OCR on 2026-10-13; page numbers of the PDF; p\. 2 read by OCR \(Tesseract\)\./);
  assert.match(n.html, /<h2>p\. 2<\/h2>\n<p>scanned words<\/p>/); // the page heading as any other (quotes cite it)
  assert.doesNotMatch(buildNote({ title: "T", pages: ["x"], labels: ["1"], source: "pdf", file: "t.pdf", extractor: "pdftotext", date: "d" }).html, /OCR/);
});

test("OCR: pdftoppm draws the page into tesseract, one thread; no tesseract, no languages", async () => {
  const { ocrPage, ocrLanguages } = await X();
  const { EventEmitter } = require("node:events");
  const { PassThrough } = require("node:stream");
  const calls = [];
  const proc = (cmd, args, opts, out, code = 0) => {
    calls.push({ cmd, args, env: opts.env });
    const p = new EventEmitter();
    p.stdout = new PassThrough();
    p.stderr = new PassThrough();
    p.stdin = new PassThrough();
    p.kill = () => {};
    setImmediate(() => { p.stdout.end(out); setImmediate(() => p.emit("close", code)); });
    return p;
  };
  const run = (cmd, args, opts) => proc(cmd, args, opts, cmd === "pdftoppm" ? "PNG" : "Recognized words on the page");
  assert.equal(await ocrPage("/x.pdf", 3, "eng+por", run), "Recognized words on the page");
  assert.deepEqual(calls.map((c) => [c.cmd, c.args.join(" ")]), [["pdftoppm", "-r 300 -gray -f 3 -l 3 -singlefile -png /x.pdf"], ["tesseract", "stdin stdout -l eng+por"]]);
  assert.equal(calls[1].env.OMP_THREAD_LIMIT, "1");
  assert.equal(await ocrLanguages((cmd, args, opts) => proc(cmd, args, opts, "List of available languages (2):\neng\nosd\n")), "eng");
  const missing = () => {
    const p = new EventEmitter();
    p.stdout = new PassThrough();
    p.stderr = new PassThrough();
    setImmediate(() => p.emit("error", Object.assign(new Error("spawn"), { code: "ENOENT" })));
    return p;
  };
  assert.equal(await ocrLanguages(missing), "");
});

test("OCR: tesseract stopping early kills pdftoppm (never left blocked on a full pipe); a slow page times out", async () => {
  const { ocrPage } = await X();
  const { EventEmitter } = require("node:events");
  const { PassThrough } = require("node:stream");
  const made = [];
  const proc = (name, behave) => {
    const p = new EventEmitter();
    p.exitCode = null;
    p.stdout = new PassThrough();
    p.stderr = new PassThrough();
    p.stdin = new PassThrough();
    p.killed = false;
    p.kill = () => { if (p.exitCode !== null) return; p.killed = true; p.exitCode = 137; setImmediate(() => p.emit("close", null)); };
    made.push(p);
    behave(p);
    return p;
  };
  // pdftoppm writes for ever; tesseract reads a little, then fails
  const endless = (p) => { const t = setInterval(() => p.stdout.write(Buffer.alloc(65536)), 1); p.on("close", () => clearInterval(t)); };
  const quits = (p) => setTimeout(() => { p.stderr.end("Error opening data file"); p.exitCode = 1; p.emit("close", 1); }, 20);
  await assert.rejects(ocrPage("/x.pdf", 1, "eng", (cmd) => proc(cmd, cmd === "pdftoppm" ? endless : quits)), /tesseract failed on page 1/);
  assert.ok(made[0].killed, "pdftoppm killed");
  // both hang: the page's time out kills both and settles
  made.length = 0;
  await assert.rejects(ocrPage("/x.pdf", 2, "eng", (cmd) => proc(cmd, () => {}), 0.05), /OCR took over 0.05 s on page 2/);
  assert.ok(made.every((p) => p.killed));
});
