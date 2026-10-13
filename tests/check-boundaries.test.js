// scripts/check-boundaries.sh: the two launchers in this repository share only contracts/ (and the
// bridge, over HTTP). macos/ reads nothing of the Omarchy launcher's code, and the root reads
// nothing under macos/.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "scripts", "check-boundaries.sh");

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boundaries-"));
  for (const [p, text] of Object.entries(Object.assign({ "manifest.json": "{}", "lib/Views.js": "", "contracts/Paths.js": "" }, files))) {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), text);
  }
  return root;
}
const run = (root) => spawnSync("bash", [SCRIPT, root], { encoding: "utf8" });

test("a clean tree, and macos/ reading contracts/: no crossing", () => {
  const r = run(tree({
    "macos/js/tests/a.test.js": 'require("../lib/Views.js")',
    "macos/runner/lib/paths.mjs": 'require("../../../contracts/Paths.js")',
    "macos/project.yml": "      - path: ../contracts/Paths.js",
    "Service.qml": 'import "contracts/Paths.js" as Paths',
  }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("macos/ reaching the Omarchy launcher's lib/, daemon/, scripts/ or QML: named and refused", () => {
  for (const [file, text] of [
    ["macos/js/tests/x.test.js", 'require("../../../lib/Views.js")'],
    ["macos/runner/lib/x.mjs", 'import "../../../daemon/lib/chat.mjs"'],
    ["macos/scripts/y.sh", 'bash "$ROOT/../scripts/install-runner.sh"'],
    ["macos/ZoteroLauncher/Z.swift", 'let qml = "../../ZoteroSearch.qml"'],
  ]) {
    const r = run(tree({ [file]: text }));
    assert.equal(r.status, 1, file);
    assert.match(r.stdout, new RegExp(file.replace(/[.]/g, "\\.") + ":1"), file);
  }
});

test("the Omarchy launcher naming macos/: refused", () => {
  const r = run(tree({ "Service.qml": 'import "macos/js/lib/Views.js" as V' }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Service\.qml:1/);
});
