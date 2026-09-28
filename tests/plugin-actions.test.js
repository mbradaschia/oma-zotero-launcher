// Phase 3 view logic: the actions list and file picker (lib/Views.js) and
// external-viewer launching (lib/Client.js). Cases: 0, 1 and several PDFs,
// standalone PDFs, missing files, URL-only attachments, snapshots, loading.
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../lib/Views.js");
const C = require("../lib/Client.js");

const pdf = (key, extra) => Object.assign({ key, libraryID: 1, title: `Paper ${key}`, filename: `${key}.pdf`, contentType: "application/pdf", readerType: "pdf", exists: true, best: false }, extra);
const snapshot = (key, extra) => Object.assign({ key, libraryID: 1, title: "Snapshot", filename: `${key}.html`, contentType: "text/html", readerType: "snapshot", exists: true }, extra);
const docx = (key) => ({ key, libraryID: 1, title: "Draft", filename: "draft.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", readerType: null, exists: true });
const details = (attachments, openAction = "open-reader") => ({ openAction, attachments });
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.rowId, r]));

test("actions: fixed order and ids", () => {
  assert.deepEqual(V.buildActions(details([pdf("A")])).map((r) => r.rowId), ["open", "external", "window", "notes", "tags", "reveal"]);
  // a standalone file has no child notes; a note reads itself
  assert.deepEqual(V.buildActions(Object.assign(details([pdf("A")]), { item: { itemType: "attachment" } })).map((r) => r.rowId), ["open", "external", "window", "tags", "reveal"]);
  assert.deepEqual(V.buildActions(Object.assign(details([]), { item: { itemType: "note" }, notes: [{ key: "NNNNNNNN", title: "N", excerpt: "e" }] })).map((r) => r.rowId), ["open", "external", "window", "read", "tags", "reveal"]);
});

test("one PDF: both file actions enabled, direct (no picker)", () => {
  const a = byId(V.buildActions(details([pdf("A")]), "Evince"));
  assert.equal(a.open.detail, "Open it in Zotero's reader");
  assert.deepEqual([a.external.available, a.external.submenu, a.external.attKey], [true, false, "A"]);
  assert.equal(a.external.label, "Open PDF externally");
  assert.equal(a.external.detail, "Evince · A.pdf");
  assert.deepEqual([a.window.available, a.window.submenu, a.window.attKey], [true, false, "A"]);
  assert.equal(a.window.label, "Open PDF in a new Zotero window");
  assert.equal(a.reveal.available, true);
});

test("several PDFs: file actions open a picker", () => {
  const a = byId(V.buildActions(details([pdf("A", { best: true }), pdf("B"), pdf("C")])));
  assert.deepEqual([a.external.available, a.external.submenu, a.external.attKey], [true, true, ""]);
  assert.equal(a.external.detail, "3 files: choose one…");
  assert.equal(a.window.submenu, true);
});

test("several PDFs, only one on disk: no picker needed", () => {
  const a = byId(V.buildActions(details([pdf("A"), pdf("B", { exists: false }), pdf("C", { exists: false })])));
  assert.deepEqual([a.external.submenu, a.external.attKey, a.window.attKey], [false, "A", "A"]);
});

test("no attachments, URL-only, or missing files: file actions disabled with a reason", () => {
  const none = byId(V.buildActions(details([], "select")));
  assert.deepEqual([none.external.available, none.window.available], [false, false]);
  assert.equal(none.external.detail, "No file attached");
  assert.equal(none.open.detail, "Nothing to open: select it in the library");
  const missing = byId(V.buildActions(details([pdf("A", { exists: false })], "select")));
  assert.equal(missing.external.available, false);
  assert.equal(missing.external.detail, "The file is missing");
  assert.equal(missing.external.label, "Open PDF externally");
  assert.equal(byId(V.buildActions(details([pdf("A", { exists: false }), pdf("B", { exists: false })]))).window.detail, "The files are missing");
});

test("snapshot-only and non-reader files", () => {
  const snap = byId(V.buildActions(details([snapshot("S")])));
  assert.equal(snap.external.label, "Open snapshot externally");
  assert.equal(snap.external.detail, "S.html"); // viewer name is for PDFs only
  assert.equal(snap.window.label, "Open snapshot in a new Zotero window");
  const doc = byId(V.buildActions(details([docx("D")]), "Evince"));
  assert.deepEqual([doc.external.available, doc.window.available], [true, false]);
  assert.equal(doc.window.detail, "Zotero's reader can't open this file type");
});

test("standalone PDF (the item is its own file)", () => {
  const a = byId(V.buildActions(details([pdf("S", { best: false })])));
  assert.deepEqual([a.external.available, a.external.attKey, a.window.attKey], [true, "S", "S"]);
});

test("loading: only the item-level actions are available", () => {
  const a = byId(V.buildActions(null));
  assert.deepEqual([a.open.available, a.reveal.available, a.external.available, a.window.available], [true, true, false, false]);
  assert.equal(a.external.detail, "…");
});

test("file picker: usable rows per purpose, reasons for the rest", () => {
  const files = [pdf("A"), pdf("B", { exists: false }), docx("D"), snapshot("S")];
  const ext = V.buildFileRows(details(files), "external");
  assert.deepEqual(ext.map((r) => [r.attKey, r.available]), [["A", true], ["B", false], ["D", true], ["S", true]]);
  assert.match(ext[1].detail, /missing/);
  const win = V.buildFileRows(details(files), "window");
  assert.deepEqual(win.map((r) => r.available), [true, false, false, true]);
  assert.match(win[2].detail, /can't open/);
  assert.deepEqual(V.usableFiles(details(files), "window").map((f) => f.key), ["A", "S"]);
  // same row shape everywhere (one ListModel serves actions and picker)
  const shape = (r) => Object.keys(r).sort().join(",");
  assert.equal(shape(ext[0]), shape(V.buildActions(null)[0]));
});

test("filterRows: subsequence on labels, word-start matches first", () => {
  const rows = V.buildActions(details([pdf("A")]));
  assert.deepEqual(V.filterRows(rows, "ext").map((r) => r.rowId), ["external"]);
  // "Show in library" also contains w-i-n, but "window" starts a word
  assert.deepEqual(V.filterRows(rows, "win").map((r) => r.rowId), ["window", "reveal"]);
  assert.deepEqual(V.filterRows(rows, "LIB").map((r) => r.rowId), ["reveal"]);
  assert.deepEqual(V.filterRows(rows, "show").map((r) => r.rowId), ["reveal"]);
  assert.equal(V.filterRows(rows, "").length, 6);
  assert.equal(V.filterRows(rows, "zzz").length, 0);
});

test("external viewer: user PDF command for PDFs, xdg-open otherwise, always via uwsm-app", () => {
  assert.deepEqual(C.externalCommand({}, "application/pdf", "/p/a.pdf"), ["uwsm-app", "--", "xdg-open", "/p/a.pdf"]);
  assert.deepEqual(C.externalCommand({ externalPdfCommand: ["zathura", "--fork"] }, "application/pdf", "/p/a b.pdf"), ["uwsm-app", "--", "zathura", "--fork", "/p/a b.pdf"]);
  assert.deepEqual(C.externalCommand({ externalPdfCommand: ["zathura"] }, "text/html", "/p/s.html"), ["uwsm-app", "--", "xdg-open", "/p/s.html"]);
  assert.equal(C.appName("org.gnome.Evince.desktop\n"), "Evince");
  assert.equal(C.appName("zathura.desktop"), "Zathura");
  assert.equal(C.appName(""), "");
});
