// Taxonomies (daemon/lib/taxonomies.mjs, daemon/lib/providers/jev.mjs) and the runner's classify,
// classify-review and classify-decide, end to end against a fake bridge and a fake Jev.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const T = () => import("../daemon/lib/taxonomies.mjs");
const J = () => import("../daemon/lib/providers/jev.mjs");
const RUNNER = path.join(__dirname, "../daemon/bin/oma-zotero-prompt.mjs");

test("the bundled taxonomies: paper type, ontology, epistemology (one label each), method and theories (several)", async () => {
  const { loadTaxonomies } = await T();
  const { taxonomies, problems } = loadTaxonomies({ dir: path.join(os.tmpdir(), "no-such-dir") });
  assert.deepEqual(problems, []);
  assert.deepEqual(taxonomies.map((t) => [t.id, t.prefix, t.kind]), [["paper-type", "type/", "one"], ["ontology", "ont/", "one"], ["epistemology", "epi/", "one"], ["method", "method/", "several"], ["theories", "theory/", "several"]]);
  assert.ok(taxonomies.every((t) => t.labels.every((l) => l.definition)));
  assert.ok(taxonomies.find((t) => t.id === "ontology").labels.some((l) => l.name === "not stated"));
});

test("your files: one of the same name replaces a bundled one, { off: true } turns it off, others are added; bad ones reported", async () => {
  const { loadTaxonomies, validate } = await T();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tax-"));
  fs.writeFileSync(path.join(dir, "ontology.json"), JSON.stringify({ off: true }));
  fs.writeFileSync(path.join(dir, "method.json"), JSON.stringify({ name: "Method", prefix: "method/", kind: "several", labels: [{ name: "survey", definition: "q" }], threshold: 0.8 }));
  fs.writeFileSync(path.join(dir, "jel.json"), JSON.stringify({ name: "JEL codes", prefix: "jel/", kind: "several", labels: [{ name: "L2", definition: "Firm objectives" }] }));
  fs.writeFileSync(path.join(dir, "bad.json"), "{ nope");
  const { taxonomies, problems } = loadTaxonomies({ dir });
  assert.deepEqual(taxonomies.map((t) => t.id), ["paper-type", "epistemology", "method", "theories", "jel"]);
  assert.deepEqual([taxonomies[2].labels.length, taxonomies[2].threshold, taxonomies[2].own, taxonomies[2].bundled], [1, 0.8, true, true]);
  assert.equal(problems.length, 1);
  assert.match(validate({ name: "X", prefix: "s/", kind: "one", labels: [{ name: "a" }, { name: "b" }] }, "x").error, /not s\/ or t\//);
  assert.match(validate({ name: "X", prefix: "x/", kind: "one", labels: [{ name: "a" }] }, "x").error, /two or more/);
  assert.match(validate({ name: "X", prefix: "x/", kind: "maybe", labels: [] }, "x").error, /"kind"/);
});

const tax = [
  { id: "paper-type", name: "Paper type", prefix: "type/", kind: "one", question: "What type?", labels: [{ name: "conceptual", definition: "theory" }, { name: "case study", definition: "cases" }], threshold: 0.6, low: 0.3 },
  { id: "ontology", name: "Ontology", prefix: "ont/", kind: "one", question: "Ontology?", labels: [{ name: "realist", definition: "r" }, { name: "relativist / constructionist", definition: "c" }, { name: "not stated", definition: "n" }], threshold: 0.6, low: 0.3 },
  { id: "theories", name: "Theories", prefix: "theory/", kind: "several", question: "Builds on it?", labels: [{ name: "resource-based view", definition: "RBV" }, { name: "dynamic capabilities", definition: "DC" }, { name: "agency theory", definition: "agency" }], threshold: 0.6, low: 0.3 },
];

test("Jev: a choice per one-label taxonomy, a yes/no per label of the others; its answers → probabilities; its cost", async () => {
  const { jevQuestions, fromJev, jevCost } = await T();
  const q = jevQuestions(tax);
  assert.deepEqual(Object.keys(q), ["paper-type", "ontology", "theories__0", "theories__1", "theories__2"]);
  assert.deepEqual(q["paper-type"], { type: "choice", instructions: "What type?", criteria: { conceptual: "theory", "case study": "cases" } });
  assert.deepEqual(q.theories__1, { type: "noul", instructions: "Builds on it? dynamic capabilities: DC" });
  const probs = fromJev(tax, {
    "paper-type": { type: "choice", choice: "case study", probabilities: { conceptual: 0.1, "case study": 0.9 } },
    ontology: { type: "choice", choice: "realist", confidence: 0.4 }, // no probabilities: the choice, at its confidence
    theories__0: { type: "noul", noul: 0.82 }, theories__1: { type: "noul", noul: 0.45 }, theories__2: { probability: 0.05 }, // (an older shape still read)
  });
  assert.deepEqual(probs, { "paper-type": { conceptual: 0.1, "case study": 0.9 }, ontology: { realist: 0.4, "relativist / constructionist": 0, "not stated": 0 },
    theories: { "resource-based view": 0.82, "dynamic capabilities": 0.45, "agency theory": 0.05 } });
  assert.equal(jevCost({ input_tokens: 1000000 }), 0.042);
  assert.equal(jevCost(null), 0);
});

test("your AI model as the fallback: the question names every taxonomy and label; its JSON answer read leniently", async () => {
  const { llmPrompt, parseLlm } = await T();
  const p = llmPrompt(tax, "Title: X");
  assert.match(p, /## theories: Theories \(any number of labels/);
  assert.match(p, /- dynamic capabilities: DC/);
  const probs = parseLlm('Here: ```json\n{"paper-type": {"Case Study": 0.7, "conceptual": 0.3}, "theories": {"agency theory": 0.9}}\n```', tax);
  assert.deepEqual(probs["paper-type"], { conceptual: 0.3, "case study": 0.7 });
  assert.deepEqual(probs.ontology, { realist: 0, "relativist / constructionist": 0, "not stated": 0 });
  assert.equal(probs.theories["agency theory"], 0.9);
  assert.throws(() => parseLlm("no json here", tax), /no JSON/);
});

test("confidence decides: tagged from the threshold, suggested from low; one label: not stated rather than a guess; dismissed left out", async () => {
  const { decide } = await T();
  assert.deepEqual(decide(tax[0], { conceptual: 0.1, "case study": 0.9 }), { tagged: [{ label: "case study", p: 0.9 }], suggested: [] });
  assert.deepEqual(decide(tax[1], { realist: 0.45, "relativist / constructionist": 0.3, "not stated": 0.25 }), { tagged: [{ label: "not stated", p: 0.25 }], suggested: [{ label: "realist", p: 0.45 }] });
  assert.deepEqual(decide(tax[0], { conceptual: 0.5, "case study": 0.5 }), { tagged: [], suggested: [{ label: "conceptual", p: 0.5 }] }); // no "not stated" label
  assert.deepEqual(decide(tax[2], { "resource-based view": 0.82, "dynamic capabilities": 0.45, "agency theory": 0.05 }),
    { tagged: [{ label: "resource-based view", p: 0.82 }], suggested: [{ label: "dynamic capabilities", p: 0.45 }] });
  assert.deepEqual(decide(tax[2], { "resource-based view": 0.82, "dynamic capabilities": 0.45 }, ["dynamic capabilities"]).suggested, []);
});

test("the tags: decided and confirmed on; what an earlier pass put on and isn't decided now off; yours by hand stay", async () => {
  const { tagChanges } = await T();
  const t = tax[2];
  const now = { tagged: [{ label: "agency theory", p: 0.7 }], confirmed: ["dynamic capabilities"] };
  const prev = { tagged: [{ label: "resource-based view", p: 0.8 }] };
  assert.deepEqual(tagChanges(t, now, prev, ["theory/resource-based view", "theory/network theory", "notion"]),
    { add: ["theory/dynamic capabilities", "theory/agency theory"], remove: ["theory/resource-based view"] });
  // one label: the confirmed one wins, the earlier pass's comes off
  assert.deepEqual(tagChanges(tax[0], { tagged: [{ label: "conceptual", p: 0.7 }], confirmed: ["case study"] }, { tagged: [{ label: "conceptual", p: 0.7 }] }, ["type/conceptual"]),
    { add: ["type/case study"], remove: ["type/conceptual"] });
  assert.deepEqual(tagChanges(t, { tagged: [{ label: "agency theory", p: 0.9 }] }, {}, ["Theory/Agency Theory"]), { add: [], remove: [] });
  // a unique (one-label) taxonomy: a label you put on by hand wins over the classifier's (which isn't added),
  // and what an earlier pass put on comes off; several labels: yours and the classifier's side by side
  assert.deepEqual(tagChanges(tax[0], { tagged: [{ label: "conceptual", p: 0.8 }] }, {}, ["type/case study"]), { add: [], remove: [], kept: "type/case study" });
  assert.deepEqual(tagChanges(tax[0], { tagged: [{ label: "conceptual", p: 0.8 }] }, { tagged: [{ label: "editorial", p: 0.7 }] }, ["type/case study", "type/editorial"]),
    { add: [], remove: ["type/editorial"], kept: "type/case study" });
  assert.deepEqual(tagChanges(t, { tagged: [{ label: "agency theory", p: 0.9 }] }, {}, ["theory/network theory"]), { add: ["theory/agency theory"], remove: [] });
  // what you confirm wins: the paper keeps that label alone, yours by hand too comes off
  assert.deepEqual(tagChanges(tax[0], { tagged: [], confirmed: ["conceptual"] }, {}, ["type/case study", "notion"]), { add: ["type/conceptual"], remove: ["type/case study"] });
});

test("a taxonomy's fingerprint: what decides the classification (labels, definitions, kind, thresholds), not its name", async () => {
  const { fingerprint, staleTaxonomies } = await T();
  const t = { id: "m", name: "Method", prefix: "method/", kind: "several", question: "Which?", threshold: 0.6, low: 0.3, labels: [{ name: "survey", definition: "Questionnaires" }] };
  const same = fingerprint(t);
  assert.equal(fingerprint(Object.assign({}, t, { name: "Methods", path: "/elsewhere" })), same);
  assert.notEqual(fingerprint(Object.assign({}, t, { threshold: 0.7 })), same);
  assert.notEqual(fingerprint(Object.assign({}, t, { labels: [{ name: "survey", definition: "Surveys" }] })), same);
  assert.notEqual(fingerprint(Object.assign({}, t, { labels: t.labels.concat([{ name: "QCA", definition: "" }]) })), same);
  const other = Object.assign({}, t, { id: "o", prefix: "o/" });
  assert.deepEqual(staleTaxonomies(undefined, [t, other]), ["m", "o"]);
  const kept = { a: 0.1 };
  assert.deepEqual(staleTaxonomies({ taxonomies: { m: { hash: same, probs: kept }, o: { tagged: [] } } }, [t, other]), ["o"]); // o: classified before fingerprints
  assert.deepEqual(staleTaxonomies({ taxonomies: { m: { hash: same, probs: kept }, o: { hash: fingerprint(other), probs: kept } } }, [t, other]), []);
  // before every label's probability was kept (Jev's yes/no answers read wrong then): out of date
  assert.deepEqual(staleTaxonomies({ taxonomies: { m: { hash: same }, o: { hash: fingerprint(other), probs: kept } } }, [t, other]), ["m"]);
});

test("the review list, the text read, a new taxonomy's template", async () => {
  const { reviewList, classificationText, template } = await T();
  const store = { papers: { "1:AAAA0001": { paper: "Adner & Helfat (2003)", taxonomies: {
    theories: { suggested: [{ label: "dynamic capabilities", p: 0.45 }, { label: "agency theory", p: 0.35 }], confirmed: [], dismissed: ["agency theory"] },
    ontology: { suggested: [{ label: "realist", p: 0.5 }], confirmed: [], dismissed: [] } } } } };
  assert.deepEqual(reviewList(store, tax).map((i) => [i.label, i.name, i.p]), [["realist", "Ontology", 0.5], ["dynamic capabilities", "Theories", 0.45]]);
  const text = classificationText({ title: "T", abstract: "A", text: "x".repeat(100) }, 60);
  assert.ok(text.startsWith("Title: T\n\nAbstract: A"));
  assert.ok(text.length <= 60);
  assert.equal(classificationText({ title: "T" }), "Title: T");
  assert.deepEqual([template("JEL codes").prefix, template("JEL codes").kind], ["jel-codes/", "several"]);
});

test("jevClassify: POST /systemone with the key; the API's refusal said", async () => {
  const { jevClassify } = await J();
  let seen = null;
  const ok = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ model: "jev-1.13.0", answers: { a: { probability: 0.5 } }, usage: { input_tokens: 10 } }) }; };
  const r = await jevClassify({ apiKey: "k", state: "S", questions: { a: { type: "noul", instructions: "?" } }, fetchImpl: ok });
  assert.equal(seen.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(seen.init.headers.Authorization, "Bearer k");
  assert.deepEqual(JSON.parse(seen.init.body), { state: "S", model: "jev-latest", questions: { a: { type: "noul", instructions: "?" } } });
  assert.deepEqual([r.model, r.answers.a.probability], ["jev-1.13.0", 0.5]);
  const no = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "invalid key" } }) });
  await assert.rejects(jevClassify({ apiKey: "k", state: "S", questions: {}, fetchImpl: no }), /Jev refused \(401\): invalid key/);
  await assert.rejects(jevClassify({ apiKey: "", state: "S", questions: {} }), /no Jev API key/);
});

// ---------------------------------------------------------------- the runner, end to end

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const out = handler(req.url, body ? JSON.parse(body) : {});
        res.writeHead(out.status || 200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out.body));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function runner(args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [RUNNER, ...args], { env: Object.assign({}, process.env, env) });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

test("classify: Jev's probabilities → tags in Zotero, the rest to review; accept and dismiss; each paper a task", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "classify-"));
  const tags = ["theory/agency theory", "notion"]; // agency: by hand
  const updates = [];
  const bridge = await serve((url, b) => {
    if (url === "/oma-zotero/item") return { body: { ok: true, item: { key: b.key, libraryID: 1, itemType: "journalArticle", title: "Corporate effects" }, paper: { key: b.key, title: "Corporate effects", authors: "Adner & Helfat", year: "2003", abstract: "We study managers." }, notes: [], tags: tags.map((tag) => ({ tag, type: 0 })) } };
    if (url === "/oma-zotero/tags/update") { updates.push(b); for (const a of b.add) tags.push(a); for (const r of b.remove) tags.splice(tags.indexOf(r), 1); return { body: { ok: true, tags: [] } } }
    return { status: 404, body: { ok: false, error: { code: "nope", message: url } } };
  });
  let asked = null;
  const jev = await serve((url, b) => {
    asked = { url, b };
    const answers = { "paper-type": { probabilities: { "empirical qualitative": 0.85 } }, ontology: { probabilities: { realist: 0.5, "not stated": 0.2 } }, epistemology: { probabilities: { interpretivist: 0.7 } } };
    Object.keys(b.questions).filter((k) => k.indexOf("method__") === 0 || k.indexOf("theories__") === 0).forEach((k) => (answers[k] = { type: "noul", noul: 0.05 })); // Jev's shape for a yes/no question
    answers.theories__1 = { type: "noul", noul: 0.9 }; // dynamic capabilities
    answers.method__5 = { type: "noul", noul: 0.4 }; // interviews: to review
    return { body: { model: "jev-1.13.0", answers, usage: { input_tokens: 2000 } } };
  });
  fs.mkdirSync(path.join(tmp, "run/oma-zotero"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "run/oma-zotero/bridge.json"), JSON.stringify({ port: bridge.address().port, token: "a".repeat(64) }));
  const env = { HOME: tmp, XDG_RUNTIME_DIR: path.join(tmp, "run"), XDG_STATE_HOME: path.join(tmp, "state"), XDG_CONFIG_HOME: path.join(tmp, "config"), JEV_API_KEY: "test-key", OMA_JEV_URL: `http://127.0.0.1:${jev.address().port}/v1`, PATH: path.join(tmp, "bin") }; // no secret-tool: never your keyring
  try {
    const r = await runner(["classify", "--items", "1:AAAA0001"], env);
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out).results[0];
    assert.equal(out.status, "tagged");
    assert.equal(asked.url, "/v1/systemone");
    assert.match(asked.b.state, /^Title: Corporate effects\n\nAbstract: We study managers\./);
    assert.deepEqual(updates[0].add.sort(), ["epi/interpretivist", "ont/not stated", "theory/dynamic capabilities", "type/empirical qualitative"]);
    assert.deepEqual(updates[0].remove, []); // agency theory, by hand: stays
    const review = JSON.parse((await runner(["classify-review", "--json"], env)).out).items;
    assert.deepEqual(review.map((i) => [i.taxonomy, i.label]), [["ontology", "realist"], ["method", "interviews"]]);
    // accepted: tagged (ontology keeps one: realist replaces not stated); dismissed: off the list
    assert.equal((await runner(["classify-decide", "--item", "1:AAAA0001", "--taxonomy", "ontology", "--label", "realist", "--accept"], env)).code, 0);
    assert.deepEqual([updates[1].add, updates[1].remove], [["ont/realist"], ["ont/not stated"]]);
    await runner(["classify-decide", "--item", "1:AAAA0001", "--taxonomy", "method", "--label", "interviews", "--dismiss"], env);
    assert.deepEqual(JSON.parse((await runner(["classify-review", "--json"], env)).out).items, []);
    // a later pass keeps what you decided
    await runner(["classify", "--items", "1:AAAA0001"], env);
    assert.ok(tags.includes("ont/realist") && !tags.includes("ont/not stated"));
    const tasks = JSON.parse(fs.readFileSync(path.join(tmp, "state/oma-zotero/tasks/tasks.json"), "utf8")).tasks;
    assert.ok(tasks.some((t) => t.kind === "classify" && t.status === "done" && t.model === "jev:jev-1.13.0"));
    // up to date with every taxonomy (a decision kept it so); a paper never classified: out of date with all
    const status = async () => JSON.parse((await runner(["classify-status", "--items", "1:AAAA0001,1:BBBB0002", "--json"], env)).out).items;
    let st = await status();
    assert.deepEqual([st[0].classified, st[0].stale], [true, []]);
    assert.deepEqual([st[1].classified, st[1].stale], [false, ["paper-type", "ontology", "epistemology", "method", "theories"]]);
    // your Method taxonomy, with another label: the paper is out of date with Method alone…
    fs.mkdirSync(path.join(tmp, "config/omarchy/oma-zotero-launcher/taxonomies"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "config/omarchy/oma-zotero-launcher/taxonomies/method.json"), JSON.stringify({ name: "Method", prefix: "method/", kind: "several", labels: [{ name: "survey", definition: "Questionnaires" }, { name: "diary study", definition: "Daily entries" }] }));
    st = await status();
    assert.deepEqual(st[0].stale, ["method"]);
    const report = JSON.parse((await runner(["taxonomies", "--json"], env)).out);
    assert.match(report.taxonomies.find((t) => t.id === "method").hash, /^[0-9a-f]{12}$/);
    // …and classified again for it, up to date
    assert.equal((await runner(["classify", "--items", "1:AAAA0001", "--taxonomies", "method"], env)).code, 0);
    assert.deepEqual((await status())[0].stale, []);
  } finally {
    bridge.close();
    jev.close();
  }
});

test("the launcher: Settings › Taxonomies, the review list, Tag by taxonomies in a paper's menu", () => {
  const S = require("../lib/Settings.js");
  const V = require("../lib/Views.js");
  const C = require("../lib/Client.js");
  const report = { taxonomies: [{ id: "paper-type", name: "Paper type", prefix: "type/", kind: "one", labels: ["a", "b"], threshold: 0.6, own: false }, { id: "jel", name: "JEL", prefix: "jel/", kind: "several", labels: ["L2"], threshold: 0.7, own: true }],
    problems: ["bad: not a JSON object"], jev: { key: { set: false } }, review: 2, classified: 5 };
  const st = { settings: C.normalizeSettings(null).settings, taxonomies: report, runner: { installed: true } };
  const rows = S.buildTaxonomies(st, V.listRow);
  assert.deepEqual(rows.map((r) => r.rowId), ["tax-open", "tax-open", "tax-new", "tax-ai-new", "set-info", "set-key", "set-link", "tax-review", "set-toggle", "set-toggle", "set-info"]);
  assert.match(rows[0].detail, /^type\/… · unique \(one label per paper\) · 2 labels · tagged from 60% · bundled/);
  assert.match(rows[1].detail, /yours/);
  assert.equal(rows[5].value, "jev");
  assert.match(rows[5].detail, /without it, your prompts model classifies/);
  assert.equal(rows[7].label, "Review 2 suggestions");
  assert.deepEqual([rows[8].value, rows[9].value], ["defaults.autoTagNew", "defaults.tagOnOpen"]);
  assert.match(rows[9].detail, /^Off · opening its menu tags it by the taxonomies it isn't up to date with/);
  // a key: its test, kept by the runner (works, failed, never, or the key changed since)
  const withKey = (test) => S.buildTaxonomies(Object.assign({}, st, { now: new Date("2026-10-03T12:10:00Z"), taxonomies: Object.assign({}, report, { jev: { key: { set: true, from: "keyring", masked: "ts-…abcd" }, test: test } }) }), V.listRow);
  const keyed = withKey(null);
  assert.ok(keyed.some((r) => r.rowId === "set-key-remove"));
  assert.match(keyed.find((r) => r.rowId === "set-key").label, /ts-…abcd/);
  assert.match(keyed.find((r) => r.rowId === "set-test").detail, /^Not tested yet · Enter checks it/);
  assert.equal(withKey({ ok: true, detail: "The key works · jev-1.13.0", at: "2026-10-03T12:00:00Z", stale: false }).find((r) => r.rowId === "set-test").detail, "✓ Works: The key works · jev-1.13.0 · tested 10 min ago");
  assert.match(withKey({ ok: false, detail: "Jev refused (401): bad key", at: "2026-10-03T12:09:30Z", stale: false }).find((r) => r.rowId === "set-test").detail, /^✗ Failed: Jev refused \(401\): bad key · tested just now/);
  assert.match(withKey({ ok: true, detail: "ok", at: "2026-10-01T12:00:00Z", stale: true }).find((r) => r.rowId === "set-test").detail, /^Not tested since the key changed/);
  assert.equal(S.testLine({ running: true }, null, true), "Testing…");
  assert.equal(S.buildTaxonomies(Object.assign({}, st, { taxonomies: null }), V.listRow)[0].label, "Reading the taxonomies…");
  assert.deepEqual(C.normalizeSettings({ defaults: { autoTagNew: true } }).settings.defaults.autoTagNew, true);
  // the review list
  const review = S.buildTaxonomyReview([{ id: "1:AAAA0001", paper: "Adner & Helfat (2003)", taxonomy: "method", name: "Method", prefix: "method/", label: "interviews", p: 0.45 }], V.listRow);
  assert.deepEqual([review[0].section, review[0].label, review[0].badge, review[0].value], ["Method", "method/interviews", "45%", "0"]);
  assert.equal(S.buildTaxonomyReview([], V.listRow)[0].label, "Nothing to review");
  // a paper's menu: Tag by taxonomies in Prompts and chat; its labels are pills under its status line, not rows
  const taxonomies = [{ id: "paper-type", name: "Paper type", prefix: "type/" }, { id: "method", name: "Method", prefix: "method/" }, { id: "jel", name: "JEL", prefix: "jel/" }];
  const details = { item: { itemType: "journalArticle" }, attachments: [], notes: [], library: { editable: true },
    tags: [{ tag: "type/case study" }, { tag: "Method/survey" }, { tag: "method/interviews" }, { tag: "notion" }] };
  const menu = V.buildActions(details, "", [{ id: "x", title: "X" }], "", false, false, { taxonomies: taxonomies, taxStatus: { classified: true, stale: [] }, jev: false });
  assert.ok(!menu.some((r) => r.section === "Taxonomies"));
  const row = menu.find((r) => r.rowId === "classify");
  assert.deepEqual([row.label, row.section, row.available], ["Tag again by taxonomies", "Prompts and chat", true]);
  assert.equal(row.detail, "Paper type, Method, JEL · your prompts model · Settings › Taxonomies");
  assert.deepEqual(V.taxonomyStrip(details.tags, taxonomies, { classified: true, stale: [] }, false),
    { items: [{ id: "paper-type", name: "Paper type", prefix: "type/", labels: ["case study"] }, { id: "method", name: "Method", prefix: "method/", labels: ["survey", "interviews"] }], note: "" });
  // out of date with a taxonomy (an earlier version of it), never tagged, being tagged, no labels
  const old = V.classifyRow({ taxonomies: taxonomies, taxStatus: { classified: true, stale: ["method", "jel"] }, jev: true }, false);
  assert.deepEqual([old.label, old.detail], ["Tag again by taxonomies: out of date", "Out of date with Method, JEL · Jev · Settings › Taxonomies"]);
  assert.equal(V.taxonomyStrip(details.tags, taxonomies, { classified: true, stale: ["method", "jel"] }, false).note, "out of date: Method, JEL");
  assert.equal(V.taxonomyStrip([], taxonomies, { classified: false, stale: ["paper-type"] }, false).note, "not tagged yet");
  assert.equal(V.taxonomyStrip([], taxonomies, { classified: true, stale: [] }, false).note, "no labels");
  assert.equal(V.taxonomyStrip(details.tags, taxonomies, null, true).note, "tagging…");
  assert.equal(V.buildActions(Object.assign({}, details, { tags: [] }), "", [], "", false, false, { taxonomies: taxonomies, taxStatus: { classified: false, stale: ["paper-type"] } }).find((r) => r.rowId === "classify").label, "Tag by taxonomies");
  const busy = V.buildActions(details, "", [], "", false, false, { taxonomies: taxonomies, classifying: true }).find((r) => r.rowId === "classify");
  assert.deepEqual([busy.label, busy.available], ["Tagging by taxonomies…", false]);
  // no AI model yet: Jev alone is enough; without it, the row says what it needs
  const setupJev = V.buildActions(details, "", null, "", false, true, { taxonomies: taxonomies.slice(0, 1), jev: true }).find((r) => r.rowId === "classify");
  assert.deepEqual([setupJev.available, setupJev.detail], [true, "Paper type · Jev · Settings › Taxonomies"]);
  const setupNone = V.buildActions(details, "", null, "", false, true, { taxonomies: taxonomies.slice(0, 1), jev: false }).find((r) => r.rowId === "classify");
  assert.deepEqual([setupNone.available, setupNone.detail], [false, "Needs a Jev key or an AI model: Settings › Taxonomies"]);
});

test("Go to: Tag a collection's, a tag's or a saved search's papers by taxonomies (not the whole library)", () => {
  const V = require("../lib/Views.js");
  assert.deepEqual(V.commandRows("tag taxonomies", {}), []);
  const scoped = V.buildRows({ query: "taxonomies", scope: { kind: "collection", key: "C", title: "SCM" }, results: [], total: 0 }, "#fff", { statuses: [], noCommands: true, scopeTitle: "“SCM”" });
  assert.deepEqual(scoped.map((r) => [r.kind, r.title]), [["classify-all", "Tag “SCM”'s papers by taxonomies"]]);
});

test("the audit: every label's probability and what became of it, the likeliest first; older results without them", async () => {
  const { auditView, fingerprint } = await T();
  const t = tax[2]; // theories, several
  const entry = { at: "2026-10-03T16:00:00Z", by: "jev:jev-1.13.0", taxonomies: { theories: { hash: fingerprint(t), probs: { "resource-based view": 0.2, "dynamic capabilities": 0.9, "agency theory": 0.45 },
    tagged: [{ label: "dynamic capabilities", p: 0.9 }], suggested: [{ label: "agency theory", p: 0.45 }], confirmed: [], dismissed: ["resource-based view"] } } };
  const a = auditView(entry, [t]);
  assert.deepEqual([a.classified, a.by, a.taxonomies[0].kept, a.taxonomies[0].stale], [true, "jev:jev-1.13.0", true, false]);
  assert.deepEqual(a.taxonomies[0].labels.slice(0, 3).map((l) => [l.name, l.p, l.state]), [["dynamic capabilities", 0.9, "tagged"], ["agency theory", 0.45, "suggested"], ["resource-based view", 0.2, "dismissed"]]);
  // a result from before: only what was tagged or suggested is known, and it's out of date
  const old = auditView({ taxonomies: { theories: { hash: fingerprint(t), tagged: [{ label: "agency theory", p: 0.7 }] } } }, [t]).taxonomies[0];
  assert.deepEqual([old.kept, old.stale, old.labels[0].name, old.labels[0].p, old.labels[1].p], [false, true, "agency theory", 0.7, null]);
  assert.equal(auditView(undefined, [t]).classified, false);
});

test("the paper's menu: Audit the taxonomies once it's tagged; its page, every label with its probability", () => {
  const V = require("../lib/Views.js");
  const details = { item: { itemType: "journalArticle" }, attachments: [], notes: [], tags: [], library: { editable: true } };
  const taxonomies = [{ id: "theories", name: "Theories", prefix: "theory/", kind: "several" }];
  assert.ok(V.buildActions(details, "", [], "", false, false, { taxonomies, taxStatus: { classified: true, stale: [] } }).some((r) => r.rowId === "classify-audit"));
  assert.ok(!V.buildActions(details, "", [], "", false, false, { taxonomies, taxStatus: { classified: false, stale: ["theories"] } }).some((r) => r.rowId === "classify-audit"));
  const rows = V.buildTaxonomyAudit({ id: "1:AAAA0001", classified: true, at: "2026-10-03T16:08:36.000Z", by: "jev:jev-1.13.0", taxonomies: [{ id: "theories", name: "Theories", kind: "several", threshold: 0.6, low: 0.3, kept: true, stale: false, classified: true,
    labels: [{ name: "dynamic capabilities", p: 0.9, state: "tagged" }, { name: "agency theory", p: 0.45, state: "suggested" }, { name: "network theory", p: 0.05, state: "" }] }] });
  assert.deepEqual([rows[0].rowId, rows[0].detail], ["classify", "Last by Jev jev-1.13.0 · 2026-10-03 16:08 UTC"]);
  assert.equal(rows[1].section, "Theories · several · tagged from 60%, suggested from 30%");
  assert.deepEqual(rows.slice(1).map((r) => [r.label, r.trailing, r.badge, r.value, r.tag]), [["dynamic capabilities", "90%", "tagged", "theories", "dynamic capabilities"], ["agency theory", "45%", "suggested", "theories", "agency theory"], ["network theory", "5%", "", "theories", "network theory"]]);
  assert.match(rows[3].detail, /^Below 30%: left out · Enter tags it$/);
  assert.equal(V.buildTaxonomyAudit(null)[0].label, "Reading the result…");
});

test("shown or hidden on papers: kept in the file, not part of the fingerprint (no paper out of date for it)", async () => {
  const { validate, toFile, fingerprint } = await T();
  const raw = { name: "Theories", prefix: "theory/", kind: "several", labels: [{ name: "rbv", definition: "x" }] };
  const shown = validate(raw, "theories").taxonomy, hidden = validate(Object.assign({}, raw, { show: false }), "theories").taxonomy;
  assert.deepEqual([shown.show, hidden.show], [true, false]);
  assert.equal(toFile(hidden).show, false);
  assert.ok(!("show" in toFile(shown)));
  assert.equal(fingerprint(shown), fingerprint(hidden));
});

test("the paper's menu › Taxonomies: a section per taxonomy (hidden ones too), its labels on the paper", () => {
  const V = require("../lib/Views.js");
  const taxonomies = [{ id: "ontology", name: "Ontology", prefix: "ont/", kind: "one" }, { id: "theories", name: "Theories", prefix: "theory/", kind: "several", show: false }];
  const details = { item: { itemType: "journalArticle" }, attachments: [], notes: [], library: { editable: true }, tags: [{ tag: "theory/rbv" }, { tag: "theory/dynamic capabilities" }] };
  const row = V.buildActions(details, "", [], "", false, false, { taxonomies }).find((r) => r.rowId === "tax-paper");
  assert.deepEqual([row.section, row.detail], ["This paper", "Theories: rbv, dynamic capabilities"]);
  const rows = V.buildPaperTaxonomies(details, taxonomies, true);
  assert.deepEqual(rows.map((r) => [r.section, r.rowId, r.label]), [["Ontology · unique", "tax-none", "No label"], ["Theories · several · hidden on papers", "tax-label-papers", "rbv"],
    ["Theories · several · hidden on papers", "tax-label-papers", "dynamic capabilities"], ["More", "classify-audit", "Audit the taxonomies"], ["More", "classify", "Tag again by taxonomies"]]);
  assert.equal(rows[1].tag, "theory/rbv");
  assert.ok(!V.buildPaperTaxonomies(details, taxonomies, false).some((r) => r.rowId === "classify-audit"));
});
