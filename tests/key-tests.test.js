// Whether a key works, kept (daemon/lib/keytests.mjs): every Test connection's result with the masked key it
// was tested with; the Jev key tested with one tiny question; Settings says it (Settings.testLine).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const K = () => import("../daemon/lib/keytests.mjs");
const RUNNER = path.join(__dirname, "../daemon/bin/oma-zotero-prompt.mjs");

test("a test kept: ok, what it said, when, the masked key; another key since: stale; never the key itself", async () => {
  const { saveTest, loadTests, testFor } = await K();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "keytests-")), "state", "key-tests.json");
  saveTest("openai", { ok: true, detail: "12 models" }, "sk-…abcd", { path: file, now: new Date("2026-10-03T12:00:00Z") });
  saveTest("jev", { ok: false, detail: "Jev refused (401)" }, "ts-…wxyz", { path: file, now: new Date("2026-10-03T12:05:00Z") });
  const all = loadTests(file);
  assert.deepEqual(all.openai, { ok: true, detail: "12 models", at: "2026-10-03T12:00:00.000Z", key: "sk-…abcd" });
  assert.deepEqual(testFor(all, "openai", "sk-…abcd"), { ok: true, detail: "12 models", at: "2026-10-03T12:00:00.000Z", stale: false });
  assert.equal(testFor(all, "openai", "sk-…ef01").stale, true);
  assert.equal(testFor(all, "openai", "").stale, true); // removed since
  assert.equal(testFor(all, "anthropic", "x"), null);
  assert.equal(loadTests(path.join(os.tmpdir(), "no-such", "file.json")).constructor, Object);
});

test("Settings: a provider's line and its key row say whether it works, and since when", () => {
  const S = require("../lib/Settings.js");
  const now = new Date("2026-10-03T14:00:00Z");
  assert.equal(S.testLine(null, { ok: true, detail: "12 models", at: "2026-10-03T12:00:00Z", stale: false }, true, now), "✓ Works: 12 models · tested 2 h ago");
  assert.equal(S.testLine({ running: false, ok: false, detail: "401" }, { ok: true, detail: "old", at: "2026-10-01T12:00:00Z" }, true, now), "✗ Failed: 401 · tested just now"); // this session's first
  assert.equal(S.testLine(null, null, true, now), "Not tested yet · Enter on Test checks it");
  assert.equal(S.testLine(null, { ok: true, detail: "", at: "", stale: true }, true, now), "Not tested since the key changed · Enter on Test checks it");
  assert.equal(S.testLine(null, null, false, now), "");
});

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const out = handler(req.url, body ? JSON.parse(body) : {}, req.headers);
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

test("provider-test jev: one tiny question with the key; works or refused, kept; the taxonomies report says it", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jevtest-"));
  let asked = null;
  const jev = await serve((url, b, h) => {
    asked = { url, b, auth: h.authorization };
    if (h.authorization !== "Bearer good-key-123456") return { status: 401, body: { error: { message: "invalid key" } } };
    return { body: { model: "jev-1.13.0", answers: { check: { probabilities: { yes: 0.9, no: 0.1 } } }, usage: { input_tokens: 12 } } };
  });
  const env = (key) => ({ HOME: tmp, XDG_STATE_HOME: path.join(tmp, "state"), XDG_CONFIG_HOME: path.join(tmp, "config"), XDG_RUNTIME_DIR: path.join(tmp, "run"), JEV_API_KEY: key, OMA_JEV_URL: `http://127.0.0.1:${jev.address().port}/v1`, PATH: path.join(tmp, "bin") }); // no secret-tool: never your keyring
  try {
    const ok = await runner(["provider-test", "jev"], env("good-key-123456"));
    assert.equal(ok.code, 0, ok.err);
    const r = JSON.parse(ok.out);
    assert.deepEqual([r.id, r.ok, r.detail], ["jev", true, "The key works · jev-1.13.0"]);
    assert.equal(asked.url, "/v1/systemone");
    assert.deepEqual(Object.keys(asked.b.questions), ["check"]);
    const kept = JSON.parse(fs.readFileSync(path.join(tmp, "state/oma-zotero/key-tests.json"), "utf8")).jev;
    assert.equal(kept.ok, true);
    assert.ok(!JSON.stringify(kept).includes("good-key-123456")); // the masked key only
    let report = JSON.parse((await runner(["taxonomies", "--json"], env("good-key-123456"))).out);
    assert.deepEqual([report.jev.test.ok, report.jev.test.stale], [true, false]);
    // another key: not tested since; tested: refused, said
    report = JSON.parse((await runner(["taxonomies", "--json"], env("bad-key-654321"))).out);
    assert.equal(report.jev.test.stale, true);
    const bad = JSON.parse((await runner(["provider-test", "jev"], env("bad-key-654321"))).out);
    assert.deepEqual([bad.ok, bad.detail], [false, "Jev refused (401): invalid key"]);
    report = JSON.parse((await runner(["taxonomies", "--json"], env("bad-key-654321"))).out);
    assert.deepEqual([report.jev.test.ok, report.jev.test.stale], [false, false]);
  } finally {
    jev.close();
  }
});
