// lib/Views.js rows for the notes list and the tag editor (phases 4 and 5), the
// search rows' tags, and lib/Client.js settings validation (phase 6).
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../lib/Views.js");
const C = require("../lib/Client.js");
const Fuzzy = require("../lib/Fuzzy.js");

const note = (key, title, date, excerpt) => ({ key, libraryID: 1, title, dateModified: date, excerpt });
const details = (over) => Object.assign({ item: { itemType: "journalArticle" }, openAction: "select", attachments: [], notes: [], tags: [], library: { libraryID: 1, editable: true } }, over);

test("actions: the Notes section lists the notes (no Notes row); a placeholder without notes", () => {
  const byId = (rows) => Object.fromEntries(rows.map((r) => [r.rowId, r]));
  const rows = V.buildActions(details({ notes: [note("A", "Scan", "2025-05-13 1:00:00", "x"), note("B", "", "2024-01-01", "")] }));
  assert.deepEqual(rows.slice(0, 4).map((r) => [r.rowId, r.section]), [["note", "Notes"], ["note", "Notes"], ["prompts", "Prompts and chat"], ["chat", "Prompts and chat"]]);
  assert.deepEqual(rows.slice(0, 2).map((r) => [r.label, r.detail, r.noteKey, r.available]), [["Scan", "2025-05-13 · x", "A", true], ["Untitled note", "2024-01-01", "B", true]]);
  let a = byId(V.buildActions(details({})));
  assert.deepEqual([a["notes-empty"].label, a["notes-empty"].available, a["notes-empty"].section, a.note], ["No notes yet", false, "Notes", undefined]);
  a = byId(V.buildActions(null));
  assert.deepEqual([a["notes-empty"].label, a.tags.detail, a.tags.available], ["…", "…", false]); // still loading
});

test("actions: Tags row summarizes the item's tags and says when the library is read-only", () => {
  const tags = ["a", "b", "c", "d", "e"].map((t) => ({ tag: t, type: 0 }));
  assert.equal(V.tagSummary(details({ tags })), "a, b, c +2");
  assert.equal(V.tagSummary(details({ tags: tags.slice(0, 1) })), "a");
  assert.equal(V.tagSummary(details({})), "No tags yet: add some");
  assert.equal(V.tagSummary(details({ library: { editable: false } })), "No tags · read-only library");
  assert.equal(V.tagSummary(details({ tags: tags.slice(0, 2), library: { editable: false } })), "a, b · read-only library");
});

test("notes list: date · excerpt, fuzzy filter with title highlight, every role present", () => {
  const d = details({ notes: [note("AAAAAAAA", "Scan", "2025-05-12 14:22:46", "ABS: 5"), note("BBBBBBBB", "Full Read", "2025-05-10 09:00:00", "")] });
  const all = V.buildNoteRows(d, "", "#f00", Fuzzy.filter);
  assert.deepEqual(all.map((r) => [r.rowId, r.label, r.detail, r.noteKey]), [
    ["note", "Scan", "2025-05-12 · ABS: 5", "AAAAAAAA"],
    ["note", "Full Read", "2025-05-10", "BBBBBBBB"],
  ]);
  const keys = Object.keys(V.listRow({})).sort();
  for (const r of all) assert.deepEqual(Object.keys(r).sort(), keys); // a ListModel needs the same roles on every row
  const f = V.buildNoteRows(d, "fr", "#f00", Fuzzy.filter);
  assert.deepEqual(f.map((r) => r.label), ["Full Read"]);
  assert.equal(f[0].labelHtml, '<font color="#f00"><b>F</b></font>ull <font color="#f00"><b>R</b></font>ead');
});

const libTags = [
  { tag: "⚡ Scan", types: [0], count: 4, color: "#A28AE5", position: 0 },
  { tag: "notion", types: [0], count: 1019, color: null, position: null },
  { tag: "Keywords: risk", types: [1], count: 3, color: null, position: null },
  { tag: "resilience", types: [0, 1], count: 2, color: null, position: null },
];

test("tag editor: the item's tags first (as they were when it opened), then the library order", () => {
  const st = { tags: libTags, itemTags: { notion: 0, "Keywords: risk": 1 }, initial: ["notion", "Keywords: risk"], editable: true };
  const rows = V.buildTagRows(st, "", "#f00", Fuzzy.filter);
  assert.deepEqual(rows.map((r) => [r.tag, r.checked, r.badge, r.trailing, r.swatch]), [
    ["notion", true, "", "1,019", ""],
    ["Keywords: risk", true, "auto", "3", ""],
    ["⚡ Scan", false, "", "4", "#A28AE5"],
    ["resilience", false, "", "2", ""], // used both ways in the library: not "auto"
  ]);
  // toggling keeps rows in place: only the check changes
  const after = V.buildTagRows(Object.assign({}, st, { itemTags: { "Keywords: risk": 1 } }), "", "#f00", Fuzzy.filter);
  assert.deepEqual(after.map((r) => [r.tag, r.checked]), [["notion", false], ["Keywords: risk", true], ["⚡ Scan", false], ["resilience", false]]);
});

test("tag editor: typing ranks tags; a Create row appears unless a tag has exactly that name (any case)", () => {
  const st = { tags: libTags, itemTags: {}, initial: [], editable: true };
  let rows = V.buildTagRows(st, "res", "#f00", Fuzzy.filter);
  assert.equal(rows[0].tag, "resilience");
  assert.equal(rows[rows.length - 1].rowId, "create");
  assert.equal(rows[rows.length - 1].label, "Create tag “res”");
  rows = V.buildTagRows(st, "NOTION", "#f00", Fuzzy.filter);
  assert.deepEqual(rows.map((r) => r.rowId), ["tag"]); // exact match (case-insensitive): no Create row
  rows = V.buildTagRows(st, "zz top", "#f00", Fuzzy.filter);
  assert.deepEqual(rows.map((r) => [r.rowId, r.tag]), [["create", "zz top"]]);
});

test("tag editor: tags added this session come right after the item's original ones", () => {
  // "brand new" isn't in the library list yet; "resilience" is, further down
  const st = { tags: libTags, itemTags: { notion: 0, "brand new": 0, resilience: 0 }, initial: ["notion"], editable: true };
  const rows = V.buildTagRows(st, "", "#f00", Fuzzy.filter);
  assert.deepEqual(rows.map((r) => [r.tag, r.checked]), [
    ["notion", true], ["resilience", true], ["brand new", true], ["⚡ Scan", false], ["Keywords: risk", false],
  ]);
});

test("tag editor: read-only library → rows (and Create) disabled", () => {
  const st = { tags: libTags, itemTags: { notion: 0 }, initial: ["notion"], editable: false };
  const rows = V.buildTagRows(st, "new", "#f00", Fuzzy.filter);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.available === false));
  assert.equal(V.buildTagRows(st, "", "#f00", Fuzzy.filter).every((r) => !r.available), true);
});

test("tag editor: long libraries are capped; header counts", () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ tag: "t" + i, types: [0], count: 1 }));
  assert.equal(V.buildTagRows({ tags: many, itemTags: {}, initial: [] }, "", "#f00", Fuzzy.filter).length, 300);
  assert.equal(V.tagCountText({ tags: libTags, itemTags: { a: 0, b: 1 } }), "4 tags · 2 on this item");
  assert.deepEqual(V.tagMap([{ tag: "a", type: 0 }, { tag: "b", type: 1 }]), { a: 0, b: 1 });
});

test("search rows: first three tags with a +N; recent section follows the emptyQuery setting", () => {
  assert.equal(V.tagsText(["a", "b"], 2), "#a #b");
  assert.equal(V.tagsText(["a", "b", "c"], 7), "#a #b #c +4");
  assert.equal(V.tagsText([], 0), "");
  const resp = { query: "", open: [], recent: [{ key: "K", title: "T", tags: ["x"], tagCount: 1 }], recentBy: "modified" };
  const rows = V.buildRows(resp, "#f00");
  assert.equal(rows[0].section, "Recently modified");
  assert.equal(rows[0].tagsText, "#x");
  assert.equal(V.buildRows(Object.assign({}, resp, { recentBy: "added" }), "#f00")[0].section, "Recently added");
  assert.equal(V.buildRows(Object.assign({}, resp, { recentBy: undefined }), "#f00")[0].section, "Recent"); // the newer of added and modified
  assert.equal(V.buildRows(Object.assign({}, resp, { recentBy: "latest" }), "#f00")[0].section, "Recent");
});

// The general keys of normalized settings (they also carry providers and defaults: providers.test.js).
const general = (s) => {
  const o = {};
  for (const k in C.DEFAULT_SETTINGS) o[k] = s[k];
  return o;
};

test("settings: defaults, valid values kept, invalid ones reported and replaced by defaults", () => {
  const d = C.normalizeSettings(null);
  assert.deepEqual(d.problems, []);
  assert.deepEqual(general(d.settings), C.DEFAULT_SETTINGS);
  const ok = C.normalizeSettings({
    enterAction: "select", maxResults: 100, port: 23120, externalPdfCommand: ["zathura", "--fork"], accelerators: false,
    emptyQuery: { showOpen: false, tabOrder: "tabbar", recent: "modified", recentLimit: 5 }, promptCommand: ["node", "/x/p.mjs"],
  });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(general(ok.settings), {
    enterAction: "select", maxResults: 100, port: 23120, externalPdfCommand: ["zathura", "--fork"], accelerators: false,
    emptyQuery: { showOpen: false, tabOrder: "tabbar", recent: "modified", recentLimit: 5 }, promptCommand: ["node", "/x/p.mjs"],
  });
  const bad = C.normalizeSettings({
    enterAction: "open", maxResults: "60", port: 70000, externalPdfCommand: "zathura", accelerators: "yes", promptCommand: [],
    emptyQuery: { showOpen: 1, tabOrder: "x", recent: "later", recentLimit: 99, extra: 1 }, colour: "red",
  });
  assert.deepEqual(general(bad.settings), Object.assign({}, C.DEFAULT_SETTINGS, { emptyQuery: {} }));
  assert.deepEqual(bad.problems, [
    'enterAction must be "reader" or "select"',
    "maxResults must be a number from 10 to 200",
    "port must be a TCP port number",
    'externalPdfCommand must be a list of strings, e.g. ["zathura"]',
    'promptCommand must be a list of strings, e.g. ["node", "/path/to/oma-zotero-prompt.mjs"]',
    "accelerators must be true or false",
    "emptyQuery.showOpen must be true or false",
    'emptyQuery.tabOrder must be "mru" or "tabbar"',
    'emptyQuery.recent must be "latest", "added", "modified" or "none"',
    "emptyQuery.recentLimit must be a whole number from 0 to 50",
    'unknown setting "emptyQuery.extra"',
    'unknown setting "colour"',
  ]);
  assert.deepEqual(C.normalizeSettings([1]).problems, ["the file must hold a JSON object"]);
  assert.deepEqual(C.normalizeSettings({ emptyQuery: null }).problems, ["emptyQuery must be an object"]);
});
