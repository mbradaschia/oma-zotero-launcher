// scripts/sync-conflicts.sh: the sync folder's conflict copies staged for Service.qml to merge
// (contracts/Merge.js), and the merged files put in place. The folder comes from another machine:
// links, odd names and paths outside it never get through.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, symlinkSync, existsSync, lstatSync, realpathSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const M = require("../contracts/Merge.js");

const SCRIPT = join(__dirname, "..", "scripts", "sync-conflicts.sh");

function folder() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "conflicts-")));
  mkdirSync(join(dir, "shared"), { recursive: true });
  return dir;
}

function list(dir) {
  const r = spawnSync("bash", [SCRIPT, "list", join(dir, "shared")], { encoding: "utf8", env: { ...process.env, XDG_RUNTIME_DIR: dir } });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { head: lines[0], copies: lines.slice(1).sort((a, b) => a.copy.localeCompare(b.copy)) };
}

function apply(dir, stage, rows) {
  writeFileSync(join(stage, "manifest"), rows.map((r) => r.join("\t")).join("\n") + "\n");
  const r = spawnSync("bash", [SCRIPT, "apply", join(dir, "shared"), stage], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split("\n").filter(Boolean);
}

test("lists each copy with its file, their times and staged texts; Merge.js agrees on the names", () => {
  const dir = folder();
  mkdirSync(join(dir, "shared", "prompts"));
  const files = {
    "shared/todos.json": "mine", "shared/todos.sync-conflict-20261013-101500-ABCDEFG.json": "theirs",
    "shared/pins (Mac's conflicted copy 2026-10-13).json": "{}",
    "shared/prompts/sum \"q\".sync-conflict-20261013-101500-ABC1234.md": "x",
    "shared/view.json": "{}", "shared/view.json.tmp": "{}"
  };
  for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t);
  utimesSync(join(dir, "shared/todos.json"), 1000, 1000);
  const { head, copies } = list(dir);
  assert.equal(head.root, join(dir, "shared"));
  assert.ok(head.stage.startsWith(dir + "/oma-zotero-merge."));
  assert.equal(copies.length, 3);
  for (const l of copies) {
    const c = M.conflictOf(l.copy.split("/").pop());
    assert.ok(c, l.copy);
    assert.equal(l.base, l.copy.slice(0, l.copy.lastIndexOf("/") + 1) + c.base);
    assert.ok(l.copyText.startsWith(head.stage + "/"));
  }
  const todos = copies.find((l) => l.base.endsWith("todos.json"));
  assert.equal(todos.baseTime, 1000000);
  assert.ok(todos.copyTime > 1000000);
  assert.equal(readFileSync(todos.copyText, "utf8"), "theirs");
  assert.equal(readFileSync(todos.baseText, "utf8"), "mine");
  const pins = copies.find((l) => l.base.endsWith("pins.json"));
  assert.equal(pins.baseTime, 0); // the file beside it is gone
  assert.equal(pins.baseText, undefined);
});

test("links are never listed: a linked copy, or a link where the file should be", () => {
  const dir = folder();
  writeFileSync(join(dir, "secret"), "do not send");
  symlinkSync(join(dir, "secret"), join(dir, "shared", "todos.sync-conflict-20261013-101500-ABCDEFG.json"));
  writeFileSync(join(dir, "shared", "pins.sync-conflict-20261013-101500-ABCDEFG.json"), "{}");
  symlinkSync(join(dir, "secret"), join(dir, "shared", "pins.json"));
  assert.deepEqual(list(dir).copies, []);
});

test("a name with a newline can't forge a line of its own", () => {
  const dir = folder();
  const forged = JSON.stringify({ copy: "/h/.b.sync-conflict-20261013-101500-ABCDEFG", base: "/h/.b", copyTime: 1, baseTime: 1 }).replace(/\//g, "\\u002f"); // no slash in a name: JSON's escape
  writeFileSync(join(dir, "shared", "x\n" + forged + "\n.sync-conflict-20261013-101500-ABCDEFG.json"), "{}");
  assert.deepEqual(list(dir).copies, []);
});

test("apply: the kept file first, then the file, then the copy removed, and the stage gone", () => {
  const dir = folder();
  const sh = join(dir, "shared");
  writeFileSync(join(sh, "a.md"), "old");
  writeFileSync(join(sh, "a.sync-conflict-20261013-101500-ABCDEFG.md"), "new");
  const { head } = list(dir);
  writeFileSync(join(head.stage, "1.merged"), "new");
  writeFileSync(join(head.stage, "1.kept"), "old");
  const done = apply(dir, head.stage, [[join(sh, "a.sync-conflict-20261013-101500-ABCDEFG.md"), join(sh, "a.md"), join(head.stage, "1.merged"), join(sh, "a.conflict-mac.md"), join(head.stage, "1.kept")]]);
  assert.equal(done.length, 1);
  assert.equal(readFileSync(join(sh, "a.md"), "utf8"), "new");
  assert.equal(readFileSync(join(sh, "a.conflict-mac.md"), "utf8"), "old");
  assert.ok(!existsSync(join(sh, "a.sync-conflict-20261013-101500-ABCDEFG.md")));
  assert.ok(!existsSync(head.stage));
});

test("apply: a link put where the file is gets replaced, never written through", () => {
  const dir = folder();
  const sh = join(dir, "shared");
  writeFileSync(join(dir, "secret"), "untouched");
  writeFileSync(join(sh, "a.sync-conflict-20261013-101500-ABCDEFG.md"), "new");
  const { head } = list(dir);
  symlinkSync(join(dir, "secret"), join(sh, "a.md")); // swapped in after the listing
  writeFileSync(join(head.stage, "1.merged"), "merged");
  apply(dir, head.stage, [[join(sh, "a.sync-conflict-20261013-101500-ABCDEFG.md"), join(sh, "a.md"), join(head.stage, "1.merged")]]);
  assert.equal(readFileSync(join(dir, "secret"), "utf8"), "untouched");
  assert.ok(!lstatSync(join(sh, "a.md")).isSymbolicLink());
  assert.equal(readFileSync(join(sh, "a.md"), "utf8"), "merged");
});

test("apply: paths outside the folder, or texts outside the stage, are refused", () => {
  const dir = folder();
  const sh = join(dir, "shared");
  writeFileSync(join(dir, ".bashrc"), "mine");
  writeFileSync(join(dir, ".bashrc.sync-conflict-20261013-101500-ABCDEFG"), "x");
  writeFileSync(join(sh, "b.md"), "b");
  writeFileSync(join(sh, "b.sync-conflict-20261013-101500-ABCDEFG.md"), "x");
  const { head } = list(dir);
  writeFileSync(join(head.stage, "1.merged"), "evil");
  writeFileSync(join(dir, "elsewhere"), "evil");
  const done = apply(dir, head.stage, [
    [join(dir, ".bashrc.sync-conflict-20261013-101500-ABCDEFG"), join(dir, ".bashrc"), join(head.stage, "1.merged")],
    [join(sh, "b.sync-conflict-20261013-101500-ABCDEFG.md"), join(sh, "..", ".bashrc"), join(head.stage, "1.merged")],
    [join(sh, "b.sync-conflict-20261013-101500-ABCDEFG.md"), join(sh, "b.md"), join(dir, "elsewhere")]
  ]);
  assert.deepEqual(done, []);
  assert.equal(readFileSync(join(dir, ".bashrc"), "utf8"), "mine");
  assert.equal(readFileSync(join(sh, "b.md"), "utf8"), "b");
  assert.ok(existsSync(join(sh, "b.sync-conflict-20261013-101500-ABCDEFG.md")));
});

test("nothing there, or no folder: nothing listed", () => {
  const dir = folder();
  assert.deepEqual(list(dir).copies, []);
  assert.equal(spawnSync("bash", [SCRIPT, "list", join(dir, "none")], { encoding: "utf8" }).status, 0);
});
