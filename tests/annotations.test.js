// OmaAnnotations (zotero-bridge/lib/annotations.js): sortIndex order, `since` parsing, which
// files a key stands for, and the /annotations route against a fake Zotero.
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

// Library: R (article) with P (PDF: 2 own annotations, 1 embedded, 1 trashed), E (EPUB, none),
// D (a .docx: no reader, no annotations), L (linked URL); N a child note.
function setup() {
  const items = new Map();
  const calls = { load: [], errors: [] };
  function mk(fields) {
    const it = Object.assign(
      { libraryID: 1, kind: "regular", itemType: "journalArticle", attachments: [], annotations: [], parentItemID: null, contentType: "application/pdf", readerType: "pdf", file: true, title: "", deleted: false, tags: [] },
      fields
    );
    it.isRegularItem = () => it.kind === "regular";
    it.isAttachment = () => it.kind === "attachment";
    it.isFileAttachment = () => it.kind === "attachment" && it.file;
    it.isAnnotation = () => it.kind === "annotation";
    it.isNote = () => it.kind === "note";
    it.isTopLevelItem = () => it.parentItemID == null;
    Object.defineProperty(it, "parentItem", { get: () => items.get(it.parentItemID) || undefined });
    Object.defineProperty(it, "topLevelItem", {
      get: () => {
        let x = it;
        while (x.parentItem) x = x.parentItem;
        return x;
      },
    });
    it.getAttachments = () => it.attachments.slice();
    it.getAnnotations = (includeTrashed) => {
      if (!it.isFileAttachment()) throw new Error("getAnnotations() can only be called on file attachments");
      return it.annotations.map((id) => items.get(id)).filter((a) => includeTrashed || !a.deleted);
    };
    it.numAnnotations = () => it.getAnnotations(false).length;
    it.getDisplayTitle = () => it.title;
    it.attachmentFilename = it.filename || "";
    it.attachmentContentType = it.kind === "attachment" ? it.contentType : null;
    it.attachmentReaderType = it.kind === "attachment" ? it.readerType : null;
    it.getTags = () => it.tags.map((tag) => ({ tag }));
    items.set(it.id, it);
    return it;
  }
  const R = mk({ id: 1, key: "REG00001", title: "Resilience of supply chains", attachments: [10, 11, 12, 13] });
  const P = mk({ id: 10, key: "PDF00010", kind: "attachment", parentItemID: 1, title: "Full Text PDF", annotations: [101, 100, 102, 103] });
  const E = mk({ id: 11, key: "EPUB0011", kind: "attachment", parentItemID: 1, title: "Book", contentType: "application/epub+zip", readerType: "epub" });
  mk({ id: 12, key: "DOCX0012", kind: "attachment", parentItemID: 1, title: "Supplement", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", readerType: null });
  const L = mk({ id: 13, key: "LINK0013", kind: "attachment", parentItemID: 1, title: "Publisher page", file: false, contentType: "text/html", readerType: null });
  const N = mk({ id: 20, key: "NOTE0020", kind: "note", itemType: "note", parentItemID: 1 });
  const ann = (id, key, json, extra = {}) =>
    mk(Object.assign({ id, key, kind: "annotation", itemType: "annotation", parentItemID: 10, json, annotationType: json.type, annotationText: json.text, annotationComment: json.comment, annotationColor: json.color, annotationPageLabel: json.pageLabel, annotationSortIndex: json.sortIndex, annotationPosition: JSON.stringify(json.position), annotationIsExternal: !!json.isExternal, dateModified: json.dateModified.replace("T", " ").replace("Z", ""), tags: (json.tags || []).map((t) => t.name) }, extra));
  const A0 = ann(100, "ANN00100", { type: "highlight", text: "first page words", comment: "", color: "#ffd400", pageLabel: "1", sortIndex: "00000|000010|00050", position: { pageIndex: 0, rects: [[1, 2, 3, 4]] }, tags: [{ name: "key idea", color: "#2ea8e5" }, { name: "todo" }], dateModified: "2026-09-01T10:00:00Z" });
  ann(101, "ANN00101", { type: "note", comment: "a sticky note", color: "#5fb236", pageLabel: "2", sortIndex: "00001|000500|00100", position: { pageIndex: 1, rects: [[5, 6, 7, 8]] }, dateModified: "2026-09-20T10:00:00Z" });
  ann(102, "ANN00102", { type: "highlight", text: "embedded in the PDF", comment: "", color: "#aaaaaa", pageLabel: "3", sortIndex: "00002|000000|00000", position: { pageIndex: 2, rects: [] }, isExternal: true, dateModified: "2026-09-25T10:00:00Z" });
  ann(103, "ANN00103", { type: "highlight", text: "trashed", comment: "", color: "#000000", pageLabel: "1", sortIndex: "00000|000000|00000", position: { pageIndex: 0, rects: [] }, dateModified: "2026-09-26T10:00:00Z" }, { deleted: true });

  const Zotero = {
    logError: (e) => calls.errors.push(String((e && e.message) || e)),
    Items: {
      get: (x) => (Array.isArray(x) ? x.map((id) => items.get(id)).filter(Boolean) : items.get(x) || false),
      loadDataTypes: async (objs, types) => calls.load.push([objs.map((o) => o.id), types]),
    },
    Annotations: {
      toJSONSync: (a) => {
        if (a.throwJSON) throw new Error("no deferred data");
        return Object.assign({ key: a.key, libraryID: a.libraryID, readOnly: !!a.json.isExternal }, a.json);
      },
    },
  };
  const ctx = vm.createContext({ omaHttpError, Zotero, console });
  vm.runInContext(lib("actions.js"), ctx);
  vm.runInContext(lib("annotations.js"), ctx);
  const byKey = (key) => [...items.values()].find((i) => i.key === key);
  const bridge = {
    async _item(key) {
      const it = byKey(key);
      if (!it) throw omaHttpError(404, "not-found", "no item");
      return it;
    },
  };
  return { A: ctx.OmaAnnotations, bridge, calls, items, R, P, E, L, N, A0 };
}

test("parseSortIndex and compare: numeric page/offset/y order, non-numeric indexes compared as strings", () => {
  const { A } = setup();
  assert.deepEqual(plain(A.parseSortIndex("00003|001234|00567")), [3, 1234, 567]);
  assert.equal(A.parseSortIndex("abc"), null);
  assert.equal(A.parseSortIndex(""), null);
  const order = (list) => list.slice().sort(A.compare).map((a) => a.sortIndex);
  assert.deepEqual(order([{ sortIndex: "00010|000000|00000" }, { sortIndex: "00009|999999|99999" }, { sortIndex: "00009|000001|00000" }]), ["00009|000001|00000", "00009|999999|99999", "00010|000000|00000"]);
  assert.deepEqual(order([{ sortIndex: "b" }, { sortIndex: "a" }, { sortIndex: "00001|00000" }]), ["00001|00000", "a", "b"]);
});

test("parseSince: ISO dates, unix ms and unix seconds → ms; nothing → null; junk → 400 bad-since", () => {
  const { A } = setup();
  assert.equal(A.parseSince(null), null);
  assert.equal(A.parseSince(""), null);
  assert.equal(A.parseSince("2026-09-10T00:00:00Z"), Date.UTC(2026, 8, 10));
  assert.equal(A.parseSince("2026-09-10"), Date.UTC(2026, 8, 10));
  assert.equal(A.parseSince(1789000000000), 1789000000000);
  assert.equal(A.parseSince("1789000000000"), 1789000000000);
  assert.equal(A.parseSince(1789000000), 1789000000000); // seconds
  for (const bad of ["yesterday", {}, -5, "2026-13-45"]) assert.throws(() => A.parseSince(bad), (e) => e.status === 400 && e.code === "bad-since", String(bad));
  assert.equal(A.sinceToSQL(Date.UTC(2026, 8, 10, 7, 8, 9)), "2026-09-10 07:08:09");
  assert.equal(A.sqlToISO("2026-09-10 07:08:09"), "2026-09-10T07:08:09Z");
});

test("attachmentsOf: an item's reader files, a file itself, an annotation's file; notes and links refused", () => {
  const { A, R, P, E, L, N, A0 } = setup();
  const keys = (item) => plain(A.attachmentsOf(item).map((a) => a.key));
  assert.deepEqual(keys(R), ["PDF00010", "EPUB0011"]); // the .docx and the link are skipped
  assert.deepEqual(keys(P), ["PDF00010"]);
  assert.deepEqual(keys(A0), ["PDF00010"]);
  assert.equal(A.attachmentsOf(E).length, 1);
  assert.throws(() => A.attachmentsOf(L), (e) => e.status === 400 && e.code === "not-a-file");
  assert.throws(() => A.attachmentsOf(N), (e) => e.status === 400 && e.code === "not-annotatable");
});

test("/annotations on an item: one list per file in reading order, embedded and trashed ones left out", async () => {
  const { A, bridge, calls } = setup();
  const r = plain(await A.route.call(bridge, { key: "REG00001" }));
  assert.deepEqual([r.key, r.topKey, r.libraryID, r.total], ["REG00001", "REG00001", 1, 2]);
  assert.deepEqual(r.attachments.map((a) => [a.key, a.readerType, a.count, a.truncated]), [["PDF00010", "pdf", 2, false], ["EPUB0011", "epub", 0, false]]);
  const [first, second] = r.attachments[0].annotations;
  assert.deepEqual(first, {
    key: "ANN00100", type: "highlight", text: "first page words", comment: "", color: "#ffd400", pageLabel: "1", pageIndex: 0,
    sortIndex: "00000|000010|00050", position: { pageIndex: 0, rects: [[1, 2, 3, 4]] }, tags: ["key idea", "todo"],
    dateModified: "2026-09-01T10:00:00Z", isExternal: false, authorName: null,
  });
  assert.deepEqual([second.key, second.type, second.text, second.comment, second.pageIndex], ["ANN00101", "note", null, "a sticky note", 1]);
  // deferred annotation data was loaded for the file's annotations before reading them
  assert.deepEqual(plain(calls.load), [[[101, 100, 102], ["annotation", "annotationDeferred"]]]);
});

test("/annotations: includeExternal and since; a file or an annotation key stands for its file", async () => {
  const { A, bridge } = setup();
  const ext = plain(await A.route.call(bridge, { key: "PDF00010", includeExternal: true }));
  assert.deepEqual([ext.key, ext.topKey, ext.total], ["PDF00010", "REG00001", 3]);
  assert.deepEqual(ext.attachments[0].annotations.map((a) => [a.key, a.isExternal]), [["ANN00100", false], ["ANN00101", false], ["ANN00102", true]]);
  const since = plain(await A.route.call(bridge, { key: "ANN00100", since: "2026-09-10" }));
  assert.deepEqual([since.key, since.topKey], ["ANN00100", "REG00001"]);
  assert.deepEqual(since.attachments.map((a) => a.annotations.map((x) => x.key)), [["ANN00101"]]);
  const sinceMs = plain(await A.route.call(bridge, { key: "REG00001", since: Date.UTC(2026, 8, 20, 10), includeExternal: true }));
  assert.deepEqual(sinceMs.attachments[0].annotations.map((x) => x.key), ["ANN00101", "ANN00102"]); // at or after
  await assert.rejects(A.route.call(bridge, { key: "REG00001", since: "soon" }), (e) => e.code === "bad-since");
  await assert.rejects(A.route.call(bridge, { key: "NOTE0020" }), (e) => e.code === "not-annotatable");
  await assert.rejects(A.route.call(bridge, { key: "LINK0013" }), (e) => e.code === "not-a-file");
});

test("/annotations: when Zotero's JSON fails for one annotation its fields are read directly", async () => {
  const { A, bridge, calls, items } = setup();
  items.get(101).throwJSON = true;
  const r = plain(await A.route.call(bridge, { key: "PDF00010" }));
  const fallback = r.attachments[0].annotations[1];
  assert.deepEqual([fallback.key, fallback.type, fallback.comment, fallback.pageLabel, fallback.pageIndex, fallback.dateModified], ["ANN00101", "note", "a sticky note", "2", 1, "2026-09-20T10:00:00Z"]);
  assert.equal(fallback.text, null); // notes carry no text
  assert.equal(calls.errors.length, 1);
});
