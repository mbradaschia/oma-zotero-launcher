// OmaFulltext (zotero-bridge/lib/fulltext.js): request options, the text window, which file an
// item's text comes from, and the /fulltext route (cache, on-demand PDF extraction, indexing on
// request, the 409s) against a fake Zotero.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const plain = (x) => JSON.parse(JSON.stringify(x));
const lib = (f) => fs.readFileSync(path.join(__dirname, "../zotero-bridge/lib", f), "utf8");

function omaHttpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

// states / cache / rows / worker are keyed by attachment key.
function setup({ states = {}, cache = {}, rows = {}, worker = {} } = {}) {
  const items = new Map();
  const byKey = new Map();
  const calls = { indexItems: [], worker: [], read: [], errors: [] };
  const cacheText = Object.assign({}, cache);
  function att(fields) {
    const a = Object.assign({ libraryID: 1, itemType: "attachment", contentType: "application/pdf", readerType: "pdf", file: true, exists: true, title: "", filename: "" }, fields);
    a.isRegularItem = () => false;
    a.isAttachment = () => true;
    a.isFileAttachment = () => a.file;
    a.isPDFAttachment = () => a.contentType === "application/pdf";
    a.getDisplayTitle = () => a.title;
    a.attachmentFilename = a.filename;
    a.attachmentContentType = a.contentType;
    a.attachmentReaderType = a.readerType;
    a.getFilePathAsync = async () => (a.file && a.exists ? "/files/" + a.key : null);
    items.set(a.id, a);
    byKey.set(a.key, a);
    return a;
  }
  function regular(fields) {
    const r = Object.assign({ libraryID: 1, itemType: "journalArticle", attachments: [], best: null }, fields);
    r.isRegularItem = () => true;
    r.isAttachment = () => false;
    r.getAttachments = () => r.attachments.slice();
    r.getBestAttachment = async () => (r.best ? items.get(r.best) : false);
    items.set(r.id, r);
    byKey.set(r.key, r);
    return r;
  }
  const note = { id: 9, key: "NOTE0009", libraryID: 1, itemType: "note", isRegularItem: () => false, isAttachment: () => false };
  byKey.set(note.key, note);
  const Zotero = {
    logError: (e) => calls.errors.push(String((e && e.message) || e)),
    Items: {
      get: (x) => (Array.isArray(x) ? x.map((id) => items.get(id)).filter(Boolean) : items.get(x) || false),
      getByLibraryAndKey: (l, key) => byKey.get(key) || false,
    },
    Fulltext: {
      getIndexedState: async (a) => (states[a.key] == null ? 1 : states[a.key]),
      getItemCacheFile: (a) => ({ path: "/cache/" + a.key, exists: () => cacheText[a.key] != null }),
      indexItems: async (ids, opts) => {
        calls.indexItems.push([ids, opts]);
        for (const id of ids) {
          const a = items.get(id);
          cacheText[a.key] = "indexed text of " + a.key;
          states[a.key] = 3;
          rows[a.key] = { indexedPages: 12, totalPages: 12 };
        }
      },
    },
    DB: { rowQueryAsync: async (sql, params) => { calls.sql = [sql, params]; return rows[items.get(params[0]).key] || false; } },
    PDFWorker: {
      getFullText: async (id, maxPages) => {
        calls.worker.push([id, maxPages]);
        const a = items.get(id);
        if (worker[a.key] === "fail") throw new Error("password required");
        return { text: worker[a.key] || "worker text of " + a.key, extractedPages: 7, totalPages: 7 };
      },
    },
  };
  const IOUtils = {
    readUTF8: async (p) => {
      calls.read.push(p);
      const key = p.replace("/cache/", "");
      if (cacheText[key] == null) throw new Error("ENOENT");
      return cacheText[key];
    },
  };
  const ctx = vm.createContext({ omaHttpError, Zotero, IOUtils, console });
  vm.runInContext(lib("actions.js"), ctx);
  vm.runInContext(lib("fulltext.js"), ctx);
  const bridge = {
    async _item(key) {
      const it = byKey.get(key);
      if (!it) throw omaHttpError(404, "not-found", "no item");
      return it;
    },
  };
  return { F: ctx.OmaFulltext, bridge, calls, att, regular, note, cacheText, states, byKey };
}

test("options: defaults and clamps; a bad index mode is a 400", () => {
  const { F } = setup();
  assert.deepEqual(plain(F.options({})), { maxChars: 200000, offset: 0, index: "never" });
  assert.deepEqual(plain(F.options({ maxChars: "50", offset: "7", index: "ifMissing" })), { maxChars: 50, offset: 7, index: "ifMissing" });
  assert.deepEqual(plain(F.options({ maxChars: 9e9, offset: -3 })), { maxChars: 500000, offset: 0, index: "never" });
  assert.equal(F.options({ maxChars: 0 }).maxChars, 1);
  assert.throws(() => F.options({ index: "always" }), (e) => e.status === 400 && e.code === "bad-index");
});

test("window: a slice with paging info; an offset past the end gives an empty window", () => {
  const { F } = setup();
  assert.deepEqual(plain(F.window("0123456789", 0, 4)), { text: "0123", offset: 0, chars: 4, totalChars: 10, truncated: true, nextOffset: 4 });
  assert.deepEqual(plain(F.window("0123456789", 4, 4)), { text: "4567", offset: 4, chars: 4, totalChars: 10, truncated: true, nextOffset: 8 });
  assert.deepEqual(plain(F.window("0123456789", 8, 4)), { text: "89", offset: 8, chars: 2, totalChars: 10, truncated: false, nextOffset: null });
  assert.deepEqual(plain(F.window("0123456789", 99, 4)), { text: "", offset: 10, chars: 0, totalChars: 10, truncated: false, nextOffset: null });
  assert.equal(F.window(null, 0, 4).totalChars, 0);
});

test("attachmentFor: the first readable file on disk, else the first readable file; nothing readable → 409", async () => {
  const { F, att, regular, note, byKey } = setup();
  att({ id: 10, key: "PDFMISS1", exists: false, title: "Full Text PDF" });
  att({ id: 11, key: "EPUB0011", contentType: "application/epub+zip", readerType: "epub", title: "Book" });
  att({ id: 12, key: "DOCX0012", contentType: "application/msword", readerType: null, title: "Supplement" });
  att({ id: 13, key: "LINK0013", file: false, contentType: "text/html", readerType: null });
  const R = regular({ id: 1, key: "REG00001", attachments: [10, 11, 12, 13], best: 10 });
  assert.equal((await F.attachmentFor(R)).key, "EPUB0011"); // Zotero's "best" PDF is missing; the EPUB is on disk
  const R2 = regular({ id: 2, key: "REG00002", attachments: [10, 12] });
  assert.equal((await F.attachmentFor(R2)).key, "PDFMISS1"); // nothing on disk: the readable one (its cache may exist)
  const R3 = regular({ id: 3, key: "REG00003", attachments: [12, 13] });
  await assert.rejects(F.attachmentFor(R3), (e) => e.status === 409 && e.code === "missing-file");
  assert.equal((await F.attachmentFor(byKey.get("EPUB0011"))).key, "EPUB0011"); // a file stands for itself
  await assert.rejects(F.attachmentFor(byKey.get("LINK0013")), (e) => e.status === 400 && e.code === "not-a-file");
  await assert.rejects(F.attachmentFor(note), (e) => e.status === 400 && e.code === "not-a-file");
});

test("/fulltext: an indexed PDF comes from Zotero's cache, with its index state and page counts", async () => {
  const { F, bridge, calls, att, regular } = setup({ states: { PDF00010: 3 }, cache: { PDF00010: "line one\r\nline two\r\n" }, rows: { PDF00010: { indexedPages: 12, totalPages: 12 } } });
  att({ id: 10, key: "PDF00010", title: "Full Text PDF" });
  regular({ id: 1, key: "REG00001", attachments: [10], best: 10 });
  const r = plain(await F.route.call(bridge, { key: "REG00001", maxChars: 12 }));
  assert.deepEqual(r, {
    key: "REG00001", libraryID: 1, attachmentKey: "PDF00010", title: "Full Text PDF", contentType: "application/pdf", readerType: "pdf", fileExists: true, source: "cache",
    text: "line one\nlin", offset: 0, chars: 12, totalChars: 18, truncated: true, nextOffset: 12,
    indexedState: 3, indexedStateName: "indexed", indexedPages: 12, totalPages: 12,
  });
  assert.deepEqual(calls.read, ["/cache/PDF00010"]);
  assert.deepEqual(calls.worker, []);
  assert.deepEqual(plain(calls.sql[1]), [10]); // bound parameter, never inlined
  const next = plain(await F.route.call(bridge, { key: "PDF00010", offset: 12, maxChars: 100 }));
  assert.deepEqual([next.text, next.truncated, next.nextOffset, next.key, next.attachmentKey], ["e two\n", false, null, "PDF00010", "PDF00010"]);
});

test("/fulltext: a PDF without a cache is extracted on demand; index: ifMissing indexes it instead", async () => {
  const { F, bridge, calls, att, cacheText } = setup({ states: { PDF00010: 1 } });
  att({ id: 10, key: "PDF00010" });
  const r = plain(await F.route.call(bridge, { key: "PDF00010" }));
  assert.deepEqual([r.source, r.text, r.indexedState, r.indexedStateName, r.indexedPages, r.totalPages], ["pdfworker", "worker text of PDF00010", 1, "unindexed", 7, 7]);
  assert.deepEqual(calls.worker, [[10, null]]);
  assert.deepEqual(plain(calls.indexItems), []);
  assert.equal(cacheText.PDF00010, undefined); // nothing stored
  const i = plain(await F.route.call(bridge, { key: "PDF00010", index: "ifMissing" }));
  assert.deepEqual([i.source, i.text, i.indexedState, i.indexedPages, i.totalPages], ["cache", "indexed text of PDF00010", 3, 12, 12]);
  assert.deepEqual(plain(calls.indexItems), [[[10], { complete: true }]]);
  assert.equal(calls.worker.length, 1); // not extracted again
});

test("/fulltext: a partial index is completed on request; an indexed file is left alone", async () => {
  const { F, bridge, calls, att } = setup({ states: { PDF00010: 2, PDF00011: 3 }, cache: { PDF00010: "first 100 pages", PDF00011: "all" }, rows: { PDF00010: { indexedPages: 100, totalPages: 340 } } });
  att({ id: 10, key: "PDF00010" });
  att({ id: 11, key: "PDF00011" });
  const partial = plain(await F.route.call(bridge, { key: "PDF00010" }));
  assert.deepEqual([partial.source, partial.text, partial.indexedStateName, partial.indexedPages, partial.totalPages], ["cache", "first 100 pages", "partial", 100, 340]);
  const completed = plain(await F.route.call(bridge, { key: "PDF00010", index: "ifMissing" }));
  assert.deepEqual([completed.text, completed.indexedStateName, completed.indexedPages], ["indexed text of PDF00010", "indexed", 12]);
  const full = plain(await F.route.call(bridge, { key: "PDF00011", index: "ifMissing" }));
  assert.equal(full.text, "all");
  assert.deepEqual(plain(calls.indexItems), [[[10], { complete: true }]]);
});

test("/fulltext: 409s — no text for an EPUB that isn't indexed, a missing file, a PDF Zotero can't read", async () => {
  const { F, bridge, att, regular } = setup({ states: { EPUB0011: 1, PDFMISS1: 1, PDFBAD01: 1 }, worker: { PDFBAD01: "fail" } });
  att({ id: 11, key: "EPUB0011", contentType: "application/epub+zip", readerType: "epub" });
  att({ id: 12, key: "PDFMISS1", exists: false });
  att({ id: 13, key: "PDFBAD01" });
  regular({ id: 1, key: "REG00001", attachments: [12] });
  await assert.rejects(F.route.call(bridge, { key: "EPUB0011" }), (e) => e.status === 409 && e.code === "not-indexed");
  await assert.rejects(F.route.call(bridge, { key: "PDFMISS1" }), (e) => e.status === 409 && e.code === "missing-file");
  await assert.rejects(F.route.call(bridge, { key: "PDFMISS1", index: "ifMissing" }), (e) => e.code === "missing-file"); // can't index what isn't there
  await assert.rejects(F.route.call(bridge, { key: "REG00001" }), (e) => e.code === "missing-file");
  await assert.rejects(F.route.call(bridge, { key: "PDFBAD01" }), (e) => e.status === 409 && e.code === "extract-failed");
  await assert.rejects(F.route.call(bridge, { key: "NOTE0009" }), (e) => e.status === 400 && e.code === "not-a-file");
  await assert.rejects(F.route.call(bridge, { key: "EPUB0011", index: "sometimes" }), (e) => e.status === 400 && e.code === "bad-index");
  const e = plain(await F.route.call(bridge, { key: "EPUB0011", index: "ifMissing" }));
  assert.deepEqual([e.source, e.text], ["cache", "indexed text of EPUB0011"]);
});

test("/fulltext: a missing file whose cache survived is still served", async () => {
  const { F, bridge, att } = setup({ states: { PDFMISS1: 3 }, cache: { PDFMISS1: "synced text" } });
  att({ id: 12, key: "PDFMISS1", exists: false });
  const r = plain(await F.route.call(bridge, { key: "PDFMISS1" }));
  assert.deepEqual([r.fileExists, r.source, r.text], [false, "cache", "synced text"]);
});
