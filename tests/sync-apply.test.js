// scripts/sync-apply.sh: the steps of a sync plan, run in order, each safe to run again; the first
// that fails stops the run and names itself.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "scripts", "sync-apply.sh");
const run = (...args) => spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });

function tmp() {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), "sync-apply-"));
  fs.mkdirSync(path.join(t, "here", "prompts"), { recursive: true });
  fs.writeFileSync(path.join(t, "here", "prompts", "a.md"), "a");
  fs.writeFileSync(path.join(t, "here", "pins.json"), "{}\n");
  return t;
}

test("probe: 1 or 0 per path", () => {
  const t = tmp();
  const r = run("probe", path.join(t, "here", "pins.json"), path.join(t, "nope"));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "1\n0\n");
});

test("mkdir, copy (a file, a folder), write; run twice: the same result", () => {
  const t = tmp();
  const s = path.join(t, "s", "shared");
  const args = ["mkdir", s, "copy", path.join(t, "here", "pins.json"), path.join(s, "pins.json"),
    "copy", path.join(t, "here", "prompts"), path.join(s, "prompts"), "write", path.join(s, "settings.json"), '{\n  "a": 1\n}\n'];
  for (let i = 0; i < 2; i++) assert.equal(run(...args).status, 0);
  assert.deepEqual(fs.readdirSync(s).sort(), ["pins.json", "prompts", "settings.json"]);
  assert.deepEqual(fs.readdirSync(path.join(s, "prompts")), ["a.md"]); // merged, not nested
  assert.equal(fs.readFileSync(path.join(s, "settings.json"), "utf8"), '{\n  "a": 1\n}\n');
});

test("move: done once, skipped on a rerun; copy of something gone: skipped", () => {
  const t = tmp();
  const from = path.join(t, "here", "pins.json");
  const to = path.join(t, "backup", "pins.json");
  assert.equal(run("move", from, to, "move", from, to, "copy", path.join(t, "gone"), path.join(t, "x")).status, 0);
  assert.ok(fs.existsSync(to) && !fs.existsSync(from));
});

test("a failing step stops the run, names itself, leaves no temporary file", () => {
  const t = tmp();
  fs.writeFileSync(path.join(t, "file"), "");
  const after = path.join(t, "after");
  const r = run("write", path.join(t, "file", "x.json"), "{}", "mkdir", after);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /sync-apply: write .*file\/x\.json failed/);
  assert.ok(!fs.existsSync(after));
  assert.equal(run("bogus").status, 1);
});
