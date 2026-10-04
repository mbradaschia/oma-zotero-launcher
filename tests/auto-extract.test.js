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

test("Settings › Defaults › The paper's text: on opening, the size limit, every paper (with how many are left), the skipped; new papers' in New papers", () => {
  const r = rows(state());
  assert.deepEqual(r.map((x) => [x.rowId, x.value]), [["set-toggle", "defaults.autoExtract"], ["set-toggle", "defaults.extractOnOpen"], ["set-edit", "defaults.extractMaxMB"], ["set-extract-all", ""]]);
  assert.match(r[1].detail, /^Off · opening the menu of a paper with a PDF and no extracted text extracts it/);
  assert.match(r[2].detail, /^40 MB · scans/);
  assert.equal(r[3].label, "Extract every paper's text");
  assert.match(r[3].detail, /^12 papers with a PDF have no extracted text yet/);
  assert.match(rows(state({ extract: { pending: 0 } }))[3].detail, /^Every paper with a PDF has its text/);
  assert.match(rows(state({ extract: { pending: null } }))[3].detail, /^… papers/);
  const running = rows(state({ extract: { pending: 7, catchup: { done: 5, skipped: 2, failed: 0, title: "" }, skipped: 2 } }));
  assert.deepEqual([running[3].label, running[3].detail], ["Extracting every paper's text", "7 left · 5 done, 2 skipped · Enter stops it (it resumes where it left off)"]);
  assert.equal(running[4].rowId, "set-extract-retry");
  assert.equal(running[4].label, "Try the 2 skipped again");
  assert.equal(rows(state({ extract: { pending: 1, catchup: { done: 0, skipped: 0, title: "“SCM”" } } }))[3].label, "Extracting the text of “SCM”");
  const fresh = S.buildDefaults(state(), V.listRow).find((x) => x.value === "defaults.autoExtractNew");
  assert.deepEqual([fresh.section, /^Off · when a paper with a PDF arrives/.test(fresh.detail)], ["New papers", true]);
});

test("Settings › Defaults › New papers: their text, their taxonomies, and the prompts to run on them (a page of its own: defaults.autoPrompts)", () => {
  const st = state({ prompts: [{ id: "findings", title: "Findings and Takeaways" }, { id: "litreview", title: "Literature Review" }] });
  st.settings = C.normalizeSettings({ defaults: { autoPrompts: ["litreview"] } }).settings;
  const r = S.buildDefaults(st, V.listRow).filter((x) => x.section === "New papers");
  assert.deepEqual(r.map((x) => [x.rowId, x.value, x.label]), [["set-toggle", "defaults.autoExtractNew", "Extract new papers' text"],
    ["set-toggle", "defaults.autoTagNew", "Tag new papers by taxonomies"], ["set-nav", "auto-prompts", "Prompts to run on new papers"]]);
  assert.match(r[2].detail, /^“Literature Review” · each runs once/);
  assert.match(S.buildDefaults(state({ prompts: [] }), V.listRow).find((x) => x.value === "auto-prompts").detail, /^None · /);
  const page = S.buildAutoPrompts(st, V.listRow);
  assert.deepEqual(page.map((x) => [x.rowId, x.value, x.label, x.checked]), [["set-auto-prompt", "findings", "Findings and Takeaways", false], ["set-auto-prompt", "litreview", "Literature Review", true]]);
  assert.match(page[1].detail, /^On · on each paper added from when it's turned on, once/);
  assert.equal(S.buildAutoPrompts(state({ prompts: [] }), V.listRow)[0].label, "No prompts yet");
  // the setting: prompt ids, in order; saved only when there are some
  assert.deepEqual(C.normalizeSettings(null).settings.defaults.autoPrompts, []);
  assert.deepEqual(S.toFile(st.settings).defaults, { autoPrompts: ["litreview"] });
  assert.deepEqual(C.normalizeSettings({ defaults: { autoPrompts: "litreview" } }).problems, ["defaults.autoPrompts must be a list of prompt ids"]);
  // the prompt's editor shows the same choice
  const editor = V.buildPromptEditor({ id: "litreview", title: "Literature Review", excerpt: "x" }, null, "", "", true);
  assert.deepEqual([editor[editor.length - 1].rowId, editor[editor.length - 1].checked], ["pe-auto", true]);
});

test("Go to › Extract every paper's text; in a collection, a tag or a saved search: its papers' (the only command there)", () => {
  const top = V.commandRows("extract", { keys: "single" });
  assert.deepEqual(top.map((r) => [r.kind, r.title]), [["tasks", "Processes"], ["extract-all", "Extract every paper's text"]]); // extractions are in Processes too
  const scoped = V.buildRows({ query: "extract text", scope: { kind: "collection", key: "COLL0001", title: "SCM" }, results: [], total: 0 }, "#fff", { statuses: [], noCommands: true, scopeTitle: "“SCM”" });
  assert.deepEqual(scoped.map((r) => [r.kind, r.title]), [["extract-all", "Extract the text of “SCM”'s papers"]]);
  assert.deepEqual(V.buildRows({ query: "settings", scope: { kind: "tag", key: "rbv", title: "rbv" }, results: [], total: 0 }, "#fff", { statuses: [], noCommands: true, scopeTitle: "“#rbv”" }), []);
  assert.match(V.commandRows("extract every", { extracting: true })[0].subtitle, /^Extracting now/);
});

test("Settings › Defaults › Bring papers up to date: taxonomies and prompts changed since, the last days' papers; counting, running", () => {
  const sec = (st) => S.buildDefaults(st, V.listRow).filter((x) => x.section === "Bring papers up to date");
  const job = (id, op, extra) => Object.assign({ id, op }, extra || {});
  // counting
  let r = sec(state({ catchUp: { plan: null } }));
  assert.deepEqual(r.map((x) => [x.rowId, x.value]), [["set-catchup", "taxonomies"], ["set-catchup", "prompts"], ["set-edit", "defaults.catchUpDays"], ["set-catchup", "recent"]]);
  assert.deepEqual([r[0].detail, r[1].detail], ["Counting…", "Counting…"]);
  assert.match(r[3].detail, /^Turn on something above first/); // nothing on in New papers
  assert.equal(r[3].available, false);
  // counted
  const st = state({ prompts: [{ id: "findings", title: "Findings" }], catchUp: { plan: {
    taxonomies: { jobs: [job("1:A", "classify"), job("1:B", "classify")], papers: 2 },
    prompts: { jobs: [job("1:A", "prompt", { prompt: "findings" })], papers: 1, unknown: 3 },
    recent: { jobs: [job("1:C", "classify"), job("1:C", "prompt", { prompt: "findings" })], papers: 1, added: 4 } } } });
  st.settings = C.normalizeSettings({ defaults: { autoTagNew: true, autoPrompts: ["findings"], catchUpDays: 7 } }).settings;
  r = sec(st);
  assert.match(r[0].detail, /^2 papers were tagged by an older version of a taxonomy · Enter tags them again/);
  assert.match(r[1].detail, /^1 note or artifact comes from an older version of their prompt · Enter runs them again: a new note next to the old one, its title says the version · 3 notes from before versions were kept stay as they are$/);
  assert.equal(r[2].detail, "7 days · what Catch up looks at");
  assert.equal(r[3].label, "Catch up the last 7 days");
  assert.match(r[3].detail, /^1 paper added in the last 7 days misses their taxonomies, “Findings”, or have an older version/);
  // running: a row to stop it, first
  r = sec(state({ catchUp: { plan: {}, running: { title: "Catching up the last 7 days", left: 3, done: 2, failed: 1 } } }));
  assert.deepEqual([r[0].rowId, r[0].label, r[0].detail], ["set-catchup-stop", "Catching up the last 7 days", "3 left · 2 done, 1 failed · Enter stops it"]);
  assert.match(r[1].detail, /^Can't tell/); // the plan had no taxonomies part
  // the setting
  assert.equal(C.normalizeSettings(null).settings.defaults.catchUpDays, 30);
  assert.deepEqual(C.normalizeSettings({ defaults: { catchUpDays: 0 } }).problems, ["defaults.catchUpDays must be a whole number of days from 1 to 3650"]);
  assert.equal(S.toFile(C.normalizeSettings({ defaults: { catchUpDays: 30 } }).settings).defaults.catchUpDays, undefined);
  assert.equal(S.toFile(C.normalizeSettings({ defaults: { catchUpDays: 7 } }).settings).defaults.catchUpDays, 7);
});
