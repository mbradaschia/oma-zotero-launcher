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
    theories__0: { type: "noul", probability: 0.82 }, theories__1: { probability: 0.45 }, theories__2: { probability: 0.05 },
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
    Object.keys(b.questions).filter((k) => k.indexOf("method__") === 0 || k.indexOf("theories__") === 0).forEach((k) => (answers[k] = { probability: 0.05 }));
    answers.theories__1 = { probability: 0.9 }; // dynamic capabilities
    answers.method__5 = { probability: 0.4 }; // interviews: to review
    return { body: { model: "jev-1.13.0", answers, usage: { input_tokens: 2000 } } };
  });
  fs.mkdirSync(path.join(tmp, "run/oma-zotero"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "run/oma-zotero/bridge.json"), JSON.stringify({ port: bridge.address().port, token: "a".repeat(64) }));
  const env = { HOME: tmp, XDG_RUNTIME_DIR: path.join(tmp, "run"), XDG_STATE_HOME: path.join(tmp, "state"), XDG_CONFIG_HOME: path.join(tmp, "config"), JEV_API_KEY: "test-key", OMA_JEV_URL: `http://127.0.0.1:${jev.address().port}/v1`, PATH: "/usr/bin:/bin" };
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
  assert.deepEqual(rows.map((r) => r.rowId), ["tax-edit", "tax-edit", "tax-new", "set-info", "set-key", "set-link", "tax-review", "set-toggle", "set-info"]);
  assert.match(rows[0].detail, /^type\/… · one label · 2 labels · tagged from 60% · bundled/);
  assert.match(rows[1].detail, /yours/);
  assert.equal(rows[4].value, "jev");
  assert.match(rows[4].detail, /without it, your prompts model classifies/);
  assert.equal(rows[6].label, "Review 2 suggestions");
  assert.equal(rows[7].value, "defaults.autoTagNew");
  const keyed = S.buildTaxonomies(Object.assign({}, st, { taxonomies: Object.assign({}, report, { jev: { key: { set: true, from: "keyring", masked: "ts-…abcd" } } }) }), V.listRow);
  assert.ok(keyed.some((r) => r.rowId === "set-key-remove"));
  assert.match(keyed.find((r) => r.rowId === "set-key").label, /ts-…abcd/);
  assert.equal(S.buildTaxonomies(Object.assign({}, st, { taxonomies: null }), V.listRow)[0].label, "Reading the taxonomies…");
  assert.deepEqual(C.normalizeSettings({ defaults: { autoTagNew: true } }).settings.defaults.autoTagNew, true);
  // the review list
  const review = S.buildTaxonomyReview([{ id: "1:AAAA0001", paper: "Adner & Helfat (2003)", taxonomy: "method", name: "Method", prefix: "method/", label: "interviews", p: 0.45 }], V.listRow);
  assert.deepEqual([review[0].section, review[0].label, review[0].badge, review[0].value], ["Method", "method/interviews", "45%", "0"]);
  assert.equal(S.buildTaxonomyReview([], V.listRow)[0].label, "Nothing to review");
  // a paper's menu
  const details = { item: { itemType: "journalArticle" }, attachments: [], notes: [], tags: [], library: { editable: true } };
  const row = V.buildActions(details, "", [{ id: "x", title: "X" }], "", false, false, { taxonomies: ["Paper type", "JEL"], jev: false }).find((r) => r.rowId === "classify");
  assert.deepEqual([row.label, row.section, row.available], ["Tag by taxonomies", "Prompts and chat", true]);
  assert.equal(row.detail, "Paper type, JEL · your prompts model · Settings › Taxonomies");
  assert.equal(V.buildActions(details, "", [], "", false, false, { taxonomies: ["Paper type"], classifying: true }).find((r) => r.rowId === "classify").label, "Tagging by taxonomies…");
  // no AI model yet: Jev alone is enough; without it, the row says what it needs
  const setupJev = V.buildActions(details, "", null, "", false, true, { taxonomies: ["Paper type"], jev: true }).find((r) => r.rowId === "classify");
  assert.deepEqual([setupJev.available, setupJev.detail], [true, "Paper type · Jev · Settings › Taxonomies"]);
  const setupNone = V.buildActions(details, "", null, "", false, true, { taxonomies: ["Paper type"], jev: false }).find((r) => r.rowId === "classify");
  assert.deepEqual([setupNone.available, setupNone.detail], [false, "Needs a Jev key or an AI model: Settings › Taxonomies"]);
});

test("Go to: Tag a collection's, a tag's or a saved search's papers by taxonomies (not the whole library)", () => {
  const V = require("../lib/Views.js");
  assert.deepEqual(V.commandRows("tag taxonomies", {}), []);
  const scoped = V.buildRows({ query: "taxonomies", scope: { kind: "collection", key: "C", title: "SCM" }, results: [], total: 0 }, "#fff", { statuses: [], noCommands: true, scopeTitle: "“SCM”" });
  assert.deepEqual(scoped.map((r) => [r.kind, r.title]), [["classify-all", "Tag “SCM”'s papers by taxonomies"]]);
});
