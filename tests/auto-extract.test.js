// Automatic text extraction: its settings (lib/Client.js) and its rows in Settings › Defaults (lib/Settings.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../lib/Client.js");
const S = require("../lib/Settings.js");
const V = require("../lib/Views.js");

const state = (over) => Object.assign({ settings: C.normalizeSettings(null).settings, defaults: { prompts: "", chat: "" }, extract: { pending: 12, catchup: null, skipped: 0 } }, over || {});
const rows = (st) => S.buildDefaults(st, V.listRow).filter((r) => r.section === "The paper's text");

test("settings: new papers' text off by default; PDFs over 40 MB skipped; both validated and saved when changed", () => {
  const d = C.normalizeSettings(null).settings.defaults;
  assert.deepEqual([d.autoExtractNew, d.extractMaxMB], [false, 40]);
  const on = C.normalizeSettings({ defaults: { autoExtractNew: true, extractMaxMB: 80 } });
  assert.deepEqual([on.settings.defaults.autoExtractNew, on.settings.defaults.extractMaxMB, on.problems], [true, 80, []]);
  assert.deepEqual(S.toFile(on.settings).defaults, { autoExtractNew: true, extractMaxMB: 80 });
  assert.equal(S.toFile(C.normalizeSettings(null).settings).defaults.extractMaxMB, undefined);
  assert.deepEqual(C.normalizeSettings({ defaults: { autoExtractNew: "yes", extractMaxMB: 0 } }).problems,
    ["defaults.autoExtractNew must be true or false", "defaults.extractMaxMB must be a whole number of MB from 1 to 1000"]);
  // on opening a paper's menu: its text, its taxonomies (off by default; saved only when on)
  assert.deepEqual([d.extractOnOpen, d.tagOnOpen], [false, false]);
  const open = C.normalizeSettings({ defaults: { extractOnOpen: true, tagOnOpen: true } });
  assert.deepEqual([open.settings.defaults.extractOnOpen, open.settings.defaults.tagOnOpen, open.problems], [true, true, []]);
  assert.deepEqual(S.toFile(open.settings).defaults, { extractOnOpen: true, tagOnOpen: true });
  assert.deepEqual(C.normalizeSettings({ defaults: { tagOnOpen: 1 } }).problems, ["defaults.tagOnOpen must be true or false"]);
});

test("Settings › Defaults › The paper's text: new papers, the size limit, every paper (with how many are left), the skipped", () => {
  const r = rows(state());
  assert.deepEqual(r.map((x) => [x.rowId, x.value]), [["set-toggle", "defaults.autoExtract"], ["set-toggle", "defaults.autoExtractNew"], ["set-toggle", "defaults.extractOnOpen"], ["set-edit", "defaults.extractMaxMB"], ["set-extract-all", ""]]);
  assert.match(r[1].detail, /^Off · when a paper with a PDF arrives/);
  assert.match(r[2].detail, /^Off · opening the menu of a paper with a PDF and no extracted text extracts it/);
  assert.match(r[3].detail, /^40 MB · scans/);
  assert.equal(r[4].label, "Extract every paper's text");
  assert.match(r[4].detail, /^12 papers with a PDF have no extracted text yet/);
  assert.match(rows(state({ extract: { pending: 0 } }))[4].detail, /^Every paper with a PDF has its text/);
  assert.match(rows(state({ extract: { pending: null } }))[4].detail, /^… papers/);
  const running = rows(state({ extract: { pending: 7, catchup: { done: 5, skipped: 2, failed: 0, title: "" }, skipped: 2 } }));
  assert.deepEqual([running[4].label, running[4].detail], ["Extracting every paper's text", "7 left · 5 done, 2 skipped · Enter stops it (it resumes where it left off)"]);
  assert.equal(running[5].rowId, "set-extract-retry");
  assert.equal(running[5].label, "Try the 2 skipped again");
  assert.equal(rows(state({ extract: { pending: 1, catchup: { done: 0, skipped: 0, title: "“SCM”" } } }))[4].label, "Extracting the text of “SCM”");
});

test("Go to › Extract every paper's text; in a collection, a tag or a saved search: its papers' (the only command there)", () => {
  const top = V.commandRows("extract", { keys: "single" });
  assert.deepEqual(top.map((r) => [r.kind, r.title]), [["tasks", "Processes"], ["extract-all", "Extract every paper's text"]]); // extractions are in Processes too
  const scoped = V.buildRows({ query: "extract text", scope: { kind: "collection", key: "COLL0001", title: "SCM" }, results: [], total: 0 }, "#fff", { statuses: [], noCommands: true, scopeTitle: "“SCM”" });
  assert.deepEqual(scoped.map((r) => [r.kind, r.title]), [["extract-all", "Extract the text of “SCM”'s papers"]]);
  assert.deepEqual(V.buildRows({ query: "settings", scope: { kind: "tag", key: "rbv", title: "rbv" }, results: [], total: 0 }, "#fff", { statuses: [], noCommands: true, scopeTitle: "“#rbv”" }), []);
  assert.match(V.commandRows("extract every", { extracting: true })[0].subtitle, /^Extracting now/);
});
