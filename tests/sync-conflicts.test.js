// scripts/sync-conflicts.sh: the sync folder's conflict copies listed for Service.qml to merge
// (contracts/Merge.js), each with the file it is a copy of and both modification times.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync, utimesSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const M = require("../contracts/Merge.js");

const SCRIPT = join(__dirname, "..", "scripts", "sync-conflicts.sh");

test("lists each copy with its file and their times; Merge.js agrees on the names", () => {
  const dir = mkdtempSync(join(tmpdir(), "conflicts-"));
  mkdirSync(join(dir, "shared", "prompts"), { recursive: true });
  const files = {
    "shared/todos.json": "{}", "shared/todos.sync-conflict-20261013-101500-ABCDEFG.json": "{}",
    "shared/pins (Mac's conflicted copy 2026-10-13).json": "{}",
    "shared/prompts/sum \"q\".sync-conflict-20261013-101500-ABC1234.md": "x",
    "shared/view.json": "{}", "shared/view.json.tmp": "{}"
  };
  for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t);
  utimesSync(join(dir, "shared/todos.json"), 1000, 1000);
  const r = spawnSync("bash", [SCRIPT, dir], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n").map((l) => JSON.parse(l)).sort((a, b) => a.copy.localeCompare(b.copy));
  assert.equal(lines.length, 3);
  for (const l of lines) {
    const c = M.conflictOf(l.copy.split("/").pop());
    assert.ok(c, l.copy);
    assert.equal(l.base, l.copy.slice(0, l.copy.lastIndexOf("/") + 1) + c.base);
  }
  const todos = lines.find((l) => l.base.endsWith("todos.json"));
  assert.equal(todos.baseTime, 1000000);
  assert.ok(todos.copyTime > 1000000);
  assert.equal(lines.find((l) => l.base.endsWith("pins.json")).baseTime, 0); // the file beside it is gone
});

test("nothing there, or no folder: nothing listed", () => {
  const dir = mkdtempSync(join(tmpdir(), "conflicts-"));
  assert.equal(spawnSync("bash", [SCRIPT, dir], { encoding: "utf8" }).stdout, "");
  assert.equal(spawnSync("bash", [SCRIPT, join(dir, "none")], { encoding: "utf8" }).status, 0);
});
