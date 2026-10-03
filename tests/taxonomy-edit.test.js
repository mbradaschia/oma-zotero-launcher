// Editing taxonomies in the launcher (Settings › Taxonomies › one of them): the runner's taxonomy-show, -save and
// -remove; the pages (Settings.buildTaxonomy, buildTaxonomyLabel) and their changes (editTaxonomy, taxonomyValue);
// a taxonomy as a filter in the @ picker; every setting found from the results (Views.settingRows).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const S = require("../lib/Settings.js");
const V = require("../lib/Views.js");

const RUNNER = path.join(__dirname, "../daemon/bin/oma-zotero-prompt.mjs");

function runner(args, env, input) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [RUNNER, ...args], { env: Object.assign({}, process.env, env) });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
    if (input !== undefined) p.stdin.end(input);
    else p.stdin.end();
  });
}

test("the runner: one taxonomy in full; saved as yours (checked: valid, its prefix not another's); off, back, deleted", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "taxedit-"));
  const env = { HOME: tmp, XDG_CONFIG_HOME: path.join(tmp, "config"), XDG_STATE_HOME: path.join(tmp, "state"), PATH: path.join(tmp, "bin") };
  const dir = path.join(tmp, "config/omarchy/oma-zotero-launcher/taxonomies");
  const show = async (id) => JSON.parse((await runner(["taxonomy-show", id], env)).out);
  const method = await show("method");
  assert.deepEqual([method.id, method.prefix, method.kind, method.bundled, method.own], ["method", "method/", "several", true, false]);
  assert.ok(method.labels.every((l) => typeof l.definition === "string" && l.definition));
  // a label added: saved as your copy, which replaces the bundled one
  const next = S.editTaxonomy(method, { label: true, i: -1, value: "diary study" });
  let r = await runner(["taxonomy-save", "method"], env, JSON.stringify(next));
  assert.equal(r.code, 0, r.err);
  const saved = JSON.parse(r.out);
  assert.deepEqual([saved.own, saved.bundled, saved.labels[saved.labels.length - 1].name], [true, true, "diary study"]);
  assert.notEqual(saved.hash, method.hash); // papers tagged before are out of date with it
  assert.ok(fs.existsSync(path.join(dir, "method.json")));
  // refused: another taxonomy's prefix; not valid
  r = await runner(["taxonomy-save", "method"], env, JSON.stringify(Object.assign({}, next, { prefix: "theory/" })));
  assert.equal(r.code, 1);
  assert.match(r.err, /the prefix “theory\/” is Theories'/);
  r = await runner(["taxonomy-save", "method"], env, JSON.stringify(Object.assign({}, next, { kind: "one", labels: [{ name: "only" }] })));
  assert.match(r.err, /two or more/);
  // turned off (a bundled one), listed as off; back as bundled
  assert.equal((await runner(["taxonomy-remove", "ontology"], env)).code, 0);
  let report = JSON.parse((await runner(["taxonomies", "--json"], env)).out);
  assert.ok(!report.taxonomies.some((t) => t.id === "ontology"));
  assert.deepEqual(report.off.map((t) => [t.id, t.name]), [["ontology", "Ontology"]]);
  assert.equal((await runner(["taxonomy-remove", "ontology", "--reset"], env)).code, 0);
  assert.equal((await runner(["taxonomy-remove", "method", "--reset"], env)).code, 0); // your copy dropped
  report = JSON.parse((await runner(["taxonomies", "--json"], env)).out);
  assert.deepEqual([report.off, report.taxonomies.find((t) => t.id === "method").own], [[], false]);
  // a new one, yours, deleted
  const made = JSON.parse((await runner(["taxonomy-new", "--name", "Codes", "--no-edit", "--json"], env)).out);
  assert.equal(made.id, "codes");
  assert.equal((await show("codes")).bundled, false);
  assert.equal((await runner(["taxonomy-remove", "codes"], env)).code, 0);
  assert.ok(!fs.existsSync(made.path));
  assert.equal((await runner(["taxonomy-show", "codes"], env)).code, 1);
});

const t = { id: "method", name: "Method", prefix: "method/", kind: "several", question: "Which methods?", threshold: 0.6, low: 0.3, bundled: true, own: false, path: "/x/method.json",
  labels: [{ name: "survey", definition: "Questionnaires" }, { name: "interviews", definition: "" }] };

test("Settings › Taxonomies: each opens its page; the ones turned off come back with Enter", () => {
  const st = { settings: require("../lib/Client.js").normalizeSettings(null).settings, runner: { installed: true },
    taxonomies: { taxonomies: [{ id: "method", name: "Method", prefix: "method/", kind: "several", labels: ["survey"], threshold: 0.6, own: false, bundled: true }], off: [{ id: "ontology", name: "Ontology" }], problems: [], jev: { key: { set: false } }, review: 0, classified: 0 } };
  const rows = S.buildTaxonomies(st, V.listRow).filter((r) => r.section === "Taxonomies");
  assert.deepEqual(rows.map((r) => [r.rowId, r.value, r.label, r.submenu]), [["tax-open", "method", "Method", true], ["tax-on", "ontology", "Ontology", false], ["tax-new", "", "New taxonomy…", true], ["tax-ai-new", "", "New taxonomy with AI…", true]]);
  assert.match(rows[0].detail, /several labels per paper/);
});

test("a taxonomy's page, a form like a task's: its fields edited on their rows, the kind as pills, its labels (each a page)", () => {
  const rows = S.buildTaxonomy(t, V.listRow);
  assert.deepEqual(rows.map((r) => r.rowId + (r.value ? ":" + r.value : "") + (r.field ? "/" + r.field : "")), ["tax-field:name/text", "tax-field:prefix/text", "tax-kind/pills", "tax-field:question/multiline",
    "tax-field:threshold/text", "tax-field:low/text", "tax-label:0", "tax-label:1", "tax-label-add", "tax-ai-edit:method", "tax-editor:method", "tax-off:method", "set-info"]);
  assert.deepEqual([rows[0].editText, rows[1].editText, rows[4].editText, rows[5].editText], ["Method", "method/", "60%", "30%"]);
  assert.deepEqual([rows[2].pills, rows[2].pillOn, rows[2].pillKind], ["unique|several", "several", "taxonomy"]);
  assert.equal(S.buildTaxonomy(Object.assign({}, t, { kind: "one" }), V.listRow)[2].pillOn, "unique");
  assert.equal(rows[6].section, "Labels · 2");
  assert.match(rows[7].detail, /^No definition yet/);
  const mine = S.buildTaxonomy(Object.assign({}, t, { own: true }), V.listRow).map((r) => r.rowId);
  assert.ok(mine.includes("tax-reset") && mine.includes("tax-off")); // your copy of a bundled one
  assert.ok(S.buildTaxonomy(Object.assign({}, t, { bundled: false, own: true }), V.listRow).some((r) => r.rowId === "tax-delete"));
  assert.equal(S.buildTaxonomy(null, V.listRow)[0].label, "Reading the taxonomy…");
  const label = S.buildTaxonomyLabel(t, 0, V.listRow);
  assert.deepEqual(label.map((r) => [r.rowId, r.value, r.field, r.editText]), [["tax-label-field", "label-name", "text", "survey"], ["tax-label-field", "label-definition", "multiline", "Questionnaires"], ["tax-label-delete", "", "", ""]]);
});

test("a change: a field, a label added, renamed, described, moved, removed; values checked first", () => {
  assert.equal(S.editTaxonomy(t, { field: "name", value: "Methods" }).name, "Methods");
  assert.deepEqual(S.editTaxonomy(t, { label: true, i: -1, value: "QCA" }).labels.map((l) => l.name), ["survey", "interviews", "QCA"]);
  assert.equal(S.editTaxonomy(t, { label: true, i: 1, field: "definition", value: "Talks" }).labels[1].definition, "Talks");
  assert.deepEqual(S.editTaxonomy(t, { move: 1, i: 0 }).labels.map((l) => l.name), ["interviews", "survey"]);
  assert.equal(S.editTaxonomy(t, { move: -1, i: 0 }), null);
  assert.deepEqual(S.editTaxonomy(t, { label: true, remove: true, i: 0 }).labels.map((l) => l.name), ["interviews"]);
  assert.equal(t.labels.length, 2); // a copy: the page's taxonomy stays as it was until it's saved
  assert.deepEqual(Object.keys(S.editTaxonomy(t, { field: "name", value: "x" })).sort(), ["kind", "labels", "low", "name", "prefix", "question", "threshold"]);
  assert.deepEqual(S.taxonomyValue("threshold", "70%", t), { value: 0.7 });
  assert.match(S.taxonomyValue("threshold", "20", t).error, /below Suggested from/);
  assert.match(S.taxonomyValue("low", "65", t).error, /above Tagged from/);
  assert.match(S.taxonomyValue("low", "0", t).error, /1 to 99/);
  assert.deepEqual(S.taxonomyValue("prefix", "Codes", t), { value: "codes/" });
  assert.match(S.taxonomyValue("prefix", "s", t).error, /not s\/ or t\//);
  assert.match(S.taxonomyValue("name", "  ", t).error, /empty/);
});

test("the @ picker: each taxonomy a filter; its labels as tags, with how many papers have each", () => {
  const taxonomies = [{ id: "method", name: "Method", prefix: "method/", kind: "several", labels: ["survey", "case \"study\""] }];
  const rows = V.buildPickerRows("", false, taxonomies);
  const tax = rows.filter((r) => r.section === "Taxonomies");
  assert.deepEqual(tax.map((r) => [r.rowId, r.label, r.value]), [["pick-field", "Method", "tax:method"]]);
  assert.deepEqual(V.buildPickerRows("meth", false, taxonomies).map((r) => r.label).slice(0, 1), ["Method"]);
  const t = V.taxonomyOfField("tax:method", taxonomies);
  assert.equal(V.pickerFieldLabel("tax:method", taxonomies), "Method");
  assert.deepEqual(V.taxonomyValues(t, { "method/survey": 12 }), [
    { value: "survey", label: "survey", count: 12, token: '#"method/survey"', detail: "" },
    { value: 'case "study"', label: 'case "study"', count: 0, token: '#"method/case study"', detail: "" }]);
  assert.equal(V.taxonomyOfField("tag", taxonomies), null);
});

test("every setting, from the results: the ones whose name has what you typed, its page and section; not twice", () => {
  const index = [
    { page: "defaults", pageTitle: "Defaults", label: "Extract new papers' text", detail: "Off", section: "The paper's text", rowId: "set-toggle", value: "defaults.autoExtractNew" },
    { page: "defaults", pageTitle: "Defaults", label: "Extract a paper's text when you open it", detail: "On", section: "The paper's text", rowId: "set-toggle", value: "defaults.extractOnOpen" },
    { page: "taxonomies", pageTitle: "Taxonomies", label: "Test the Jev key", detail: "✓ Works", section: "Classifier", rowId: "set-test", value: "jev" },
    { page: "providers", pageTitle: "Models & providers", label: "Models & providers", detail: "", section: "Settings", rowId: "", value: "" },
    { page: "general", pageTitle: "General", label: "Citation style", detail: "APA", section: "Citations", rowId: "set-styles", value: "" }];
  const find = (q) => V.commandRows(q, { settingsIndex: index }).filter((r) => r.kind === "setting");
  assert.deepEqual(find("extract open").map((r) => r.title), ["Extract a paper's text when you open it"]);
  assert.deepEqual(find("jev").map((r) => [r.title, r.subtitle]), [["Test the Jev key", "Settings › Taxonomies › Classifier · ✓ Works"]]);
  assert.deepEqual(find("citation").map((r) => r.section), ["Go to"]);
  assert.equal(find("citation")[0].key, "general\u0001set-styles\u0001\u0001Citation style");
  assert.deepEqual(find("classifier"), []); // a section's word alone finds nothing: the name must match
  assert.deepEqual(find("a"), []);
  assert.equal(V.settingRows(["text"], index).length, 2);
});

test("with AI: the conversation the model gets; its answer checked; a proposal against the taxonomy now", async () => {
  const T = await import("../daemon/lib/taxonomies.mjs");
  const others = [{ id: "theories", name: "Theories", prefix: "theory/" }];
  // a new one: what exists, then what you want
  let m = T.draftMessages(null, others, [], "supply chain risks");
  assert.deepEqual(m.map((x) => x.role), ["user"]);
  assert.equal(m[0].content, "Make a new taxonomy.\n\nOther taxonomies (their prefixes are taken): Theories (theory/)\n\nWhat I want: supply chain risks");
  // discussing: each request and its proposal, then the new request
  const proposal = { name: "Risks", prefix: "risk/", kind: "several", question: "Which risks?", threshold: 0.6, labels: [{ name: "supply", definition: "Supplier failure" }, { name: "demand", definition: "Demand shocks" }] };
  m = T.draftMessages(t, others, [{ request: "add risks", taxonomy: proposal, notes: "Two labels" }], "merge them");
  assert.deepEqual(m.map((x) => x.role), ["user", "assistant", "user"]);
  assert.match(m[0].content, /^The taxonomy to change:\n\{/);
  assert.deepEqual(JSON.parse(m[1].content).taxonomy.labels.map((l) => l.name), ["supply", "demand"]);
  assert.equal(m[2].content, "merge them");
  assert.match(T.DRAFT_SYSTEM, /unique: each paper gets exactly one label/);
  // the answer: JSON inside text read; checked (valid, the prefix not another's)
  const ok = T.parseDraft("Here it is: " + JSON.stringify({ taxonomy: proposal, notes: "Made two labels." }) + " done", "draft", others);
  assert.deepEqual([ok.taxonomy.prefix, ok.taxonomy.labels.length, ok.notes], ["risk/", 2, "Made two labels."]);
  assert.match(T.parseDraft(JSON.stringify({ taxonomy: Object.assign({}, proposal, { prefix: "theory/" }) }), "draft", others).error, /is Theories'/);
  assert.match(T.parseDraft("no json here", "draft", others).error, /no JSON/);
  // what it changes
  const next = { name: "Method", prefix: "method/", kind: "several", question: "Which methods?", threshold: 0.7, labels: [{ name: "survey", definition: "Questionnaires" }, { name: "QCA", definition: "Set theory" }] };
  const d = S.taxonomyDiff(t, next);
  assert.deepEqual(d.fields.filter((f) => f.changed).map((f) => [f.label, f.before, f.value]), [["Tagged from", "60%", "70%"]]);
  assert.deepEqual(d.labels.map((l) => [l.name, l.status]), [["survey", ""], ["QCA", "new"], ["interviews", "removed"]]);
  assert.ok(S.taxonomyDiff(null, next).labels.every((l) => l.status === ""));
});

test("the proposal page, a form: Ask (Enter sends), what you asked, then accept / discard and the changes marked", () => {
  const empty = S.buildTaxonomyDraft({ id: "", base: null, input: "", turns: [], busy: false, error: "", proposal: null }, V.listRow);
  assert.deepEqual(empty.map((r) => [r.rowId, r.field]), [["tax-ai-ask", "text"]]);
  assert.match(empty[0].label, /^Describe the taxonomy you want/);
  const busy = S.buildTaxonomyDraft({ id: "method", base: t, input: "add QCA", turns: [], busy: true, proposal: null }, V.listRow);
  assert.deepEqual([busy[0].available, busy[1].label], [false, "Thinking… (a minute or so)"]);
  const next = Object.assign({}, t, { labels: t.labels.concat([{ name: "QCA", definition: "Set theory" }]) });
  const shown = S.buildTaxonomyDraft({ id: "method", base: t, input: "", turns: [{ request: "add QCA", taxonomy: next, notes: "Added QCA." }], proposal: next, notes: "Added QCA." }, V.listRow);
  assert.deepEqual(shown.slice(0, 4).map((r) => r.rowId), ["tax-ai-ask", "set-info", "tax-ai-accept", "tax-ai-discard"]);
  assert.match(shown[0].label, /^Ask for changes/);
  assert.deepEqual([shown[1].label, shown[1].detail], ["You asked: add QCA", "Added QCA."]);
  assert.equal(shown[2].label, "Accept these changes");
  const labels = shown.filter((r) => /^Its labels/.test(r.section));
  assert.equal(labels[0].section, "Its labels · 3, 1 new");
  assert.deepEqual(labels.map((r) => [r.label, r.badge]), [["survey", ""], ["interviews", ""], ["QCA", "new"]]);
  const made = S.buildTaxonomyDraft({ id: "", base: null, turns: [], proposal: Object.assign({}, next, { name: "Risks" }) }, V.listRow);
  assert.equal(made.find((r) => r.rowId === "tax-ai-accept").label, "Accept it: make “Risks”");
  assert.equal(S.buildTaxonomyDraft({ id: "", turns: [], error: "the model's answer has no JSON" }, V.listRow)[1].label, "Couldn't make it: the model's answer has no JSON");
});

test("unique taxonomies (one label per paper): a label added by hand replaces the other; two shown are flagged", () => {
  const taxonomies = [{ id: "ontology", name: "Ontology", prefix: "ont/", kind: "one" }, { id: "theories", name: "Theories", prefix: "theory/", kind: "several" }];
  assert.deepEqual(V.uniqueLabelClash("ont/realist", ["ont/not stated", "theory/rbv", "notion"], taxonomies), { taxonomy: taxonomies[0], others: ["ont/not stated"] });
  assert.equal(V.uniqueLabelClash("theory/agency", ["theory/rbv"], taxonomies), null); // several: side by side
  assert.equal(V.uniqueLabelClash("ont/realist", ["ont/realist"], taxonomies), null);
  assert.equal(V.uniqueLabelClash("notion", ["ont/realist"], taxonomies), null);
  const strip = V.taxonomyStrip([{ tag: "ont/realist" }, { tag: "ont/relativist" }, { tag: "theory/rbv" }, { tag: "theory/agency" }], taxonomies, { classified: true, stale: [] }, false);
  assert.equal(strip.note, "Ontology takes one label: keep one (# tags)");
});

test("taxonomy-save --new: a new one, its id from its prefix, never over a bundled one or one of yours", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "taxnew-"));
  const env = { HOME: tmp, XDG_CONFIG_HOME: path.join(tmp, "config"), XDG_STATE_HOME: path.join(tmp, "state"), PATH: path.join(tmp, "bin") };
  const body = (name, prefix) => JSON.stringify({ name: name, prefix: prefix, kind: "several", question: "Q?", threshold: 0.6, labels: [{ name: "a", definition: "A" }] });
  const make = async (name, prefix) => JSON.parse((await runner(["taxonomy-save", "--new"], env, body(name, prefix))).out);
  assert.equal((await make("Risk", "risk/")).id, "risk");
  assert.equal((await make("Risks", "risks/")).id, "risks");
  const again = await runner(["taxonomy-save", "--new"], env, body("Risk again", "risk/"));
  assert.match(again.err, /the prefix “risk\/” is Risk's/); // a prefix taken: refused
  assert.equal((await make("Methods too", "method-x/")).id, "method-x");
  // a prefix that would be a bundled one's id: another id, the bundled one untouched
  const method = await make("My method", "method2/");
  assert.equal(method.id, "method2");
});
