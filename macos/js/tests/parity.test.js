// scripts/parity.sh: activateAction's case labels in the QML, the ids ActionMap.swift handles,
// per phase from docs/parity-phases.tsv; --phase fails while that phase has an unported id.
const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const SCRIPT = join(__dirname, "..", "..", "scripts", "parity.sh");
const run = (...args) => spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });

function tiny(handled) {
  const dir = mkdtempSync(join(tmpdir(), "parity-"));
  writeFileSync(join(dir, "Z.qml"), [
    "Item {",
    "  function activateAction(i) {",
    "    switch (row.rowId) {",
    '      case "open":',
    '        if (x === "not-a-case") break',
    '      case "reveal": {',
    "        break }",
    '\tcase "pin":',
    "    }",
    "  }",
    "  function other() {",
    '    switch (v) { case "elsewhere": }',
    "  }",
    "}",
  ].join("\n") + "\n");
  writeFileSync(join(dir, "ActionMap.swift"), [
    "enum ActionMap {",
    "    static let handlers: [String: ActionHandler] = [",
    ...handled.map((id) => `        "${id}": { _ in },`),
    "    ]",
    '    static let inert: Set<String> = [',
    '        "notes-empty",',
    '        "set-info",',
    "    ]",
    "}",
  ].join("\n") + "\n");
  writeFileSync(join(dir, "phases.tsv"), "a\topen pin\nb\treveal\n");
  return ["--qml", join(dir, "Z.qml"), "--map", join(dir, "ActionMap.swift"), "--phases", join(dir, "phases.tsv")];
}

test("counts per phase on a tiny QML: three cases, one ported", () => {
  const r = run(...tiny(["pin"]));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^a\s+ported 1 of 2\s+remaining 1$/m);
  assert.match(r.stdout, /^b\s+ported 0 of 1\s+remaining 1$/m);
  assert.match(r.stdout, /^total\s+ported 1 of 3\s+remaining 2\s+inert by design 2$/m); // a set over several lines
});

test("--phase fails while one of its ids is unported, and names it", () => {
  const args = tiny(["pin"]);
  const a = run(...args, "--phase", "a");
  assert.notEqual(a.status, 0);
  assert.match(a.stderr, /open/);
  assert.equal(run(...tiny(["pin", "open"]), "--phase", "a").status, 0);
  assert.notEqual(run(...args, "--phase", "nope").status, 0);
  assert.notEqual(run(...tiny(["pin", "open"]), "--phase", "a", "--phase", "b").status, 0); // b's reveal isn't
  assert.equal(run(...tiny(["pin", "open", "reveal"]), "--phase", "a", "--phase", "b").status, 0);
});

test("an id in no phase, in two, or not in the QML is an error", () => {
  const args = tiny([]);
  const phases = args[args.length - 1];
  writeFileSync(phases, "a\topen\nb\treveal\n");
  assert.match(run(...args).stderr, /pin.*no phase/);
  writeFileSync(phases, "a\topen pin\nb\treveal pin\n");
  assert.match(run(...args).stderr, /pin.*two phases/);
  writeFileSync(phases, "a\topen pin gone\nb\treveal\n");
  assert.match(run(...args).stderr, /gone.*not a case/);
});

test("the real tree: 166 ids, every one in a phase, 3b ported", () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^total\s+ported \d+ of 166\s+remaining \d+\s+inert by design 6$/m);
  assert.equal(run("--phase", "3b").status, 0, "phase 3b's ids are all ported");
});

test("PLAN.md's appendix is the same table as docs/parity-phases.tsv", () => {
  const { readFileSync } = require("node:fs");
  const root = join(__dirname, "..", "..");
  const plan = readFileSync(join(root, "PLAN.md"), "utf8").split("## Appendix: row ids by phase")[1];
  const rows = plan.split("\n").map((l) => /^\| (\w+) \| (\d+) \| ([^|]+) \|$/.exec(l)).filter(Boolean);
  const fromPlan = rows.map((m) => `${m[1]}\t${m[3].trim()}`).join("\n");
  rows.forEach((m) => assert.equal(m[3].trim().split(" ").length, Number(m[2]), `${m[1]}'s count`));
  assert.equal(fromPlan + "\n", readFileSync(join(root, "docs", "parity-phases.tsv"), "utf8"));
});
