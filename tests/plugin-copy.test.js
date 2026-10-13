// The plugin as `make install` copies it (scripts/dev-sync.sh) holds every script the plugin runs:
// the ones its QML starts (root.pluginDir + "/scripts/..."), and the ones those call in turn.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const included = new Set([...read("scripts/dev-sync.sh").matchAll(/--include='\/(scripts\/[\w.-]+\.sh)'/g)].map((m) => m[1]));

test("every script the QML runs, and every script those run, is in the plugin copy", () => {
  const wanted = new Set();
  for (const qml of fs.readdirSync(ROOT).filter((f) => f.endsWith(".qml"))) {
    for (const m of read(qml).matchAll(/pluginDir \+ "\/(scripts\/[\w.-]+\.sh)"/g)) wanted.add(m[1]);
  }
  for (const s of [...wanted]) {
    for (const m of read(s).matchAll(/\$ROOT\/(scripts\/[\w.-]+\.sh)/g)) wanted.add(m[1]);
  }
  assert.ok(wanted.size > 0);
  for (const s of wanted) assert.ok(included.has(s), s + " is run by the plugin but not copied by dev-sync.sh");
});
