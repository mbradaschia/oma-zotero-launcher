// scripts/goldens.mjs: the goldens are what Node gives for each Glue wrapper on the fixtures, and
// --check fails when the committed file is missing or differs (CI's drift check).
const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const SCRIPT = join(__dirname, "..", "..", "scripts", "goldens.mjs");
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

test("--check fails with no goldens, passes after writing them, fails after a change", () => {
  const out = join(mkdtempSync(join(tmpdir(), "goldens-")), "cases.json");
  assert.notEqual(run("--check", "--out", out).status, 0);
  assert.equal(run("--out", out).status, 0);
  assert.equal(run("--check", "--out", out).status, 0);
  const cases = JSON.parse(readFileSync(out, "utf8"));
  cases[0].expect = [];
  writeFileSync(out, JSON.stringify(cases, null, 2) + "\n");
  assert.notEqual(run("--check", "--out", out).status, 0);
});

test("every 3a wrapper has a case, and each case's expect is the wrapper's answer", () => {
  const out = join(mkdtempSync(join(tmpdir(), "goldens-")), "cases.json");
  assert.equal(run("--out", out).status, 0);
  const cases = JSON.parse(readFileSync(out, "utf8"));
  const Glue = require("../../ZoteroLauncher/Core/Glue.js");
  const wrappers = new Set(cases.map((c) => c.wrapper));
  for (const name of Object.keys(Glue)) if (name !== "resolvePaths") assert.ok(wrappers.has(name), `no golden for Glue.${name}`); // contracts/fixtures/paths.json covers it
  assert.equal(new Set(cases.map((c) => c.name)).size, cases.length);
  for (const c of cases) assert.deepEqual(c.expect, JSON.parse(JSON.stringify(Glue[c.wrapper](...c.args))), c.name);
});

test("the committed goldens are current", () => {
  assert.equal(run("--check").status, 0, run("--check").stderr);
});
