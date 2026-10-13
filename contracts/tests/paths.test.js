// contracts/Paths.js: where every file lives, for the launcher, the prompt runner and the macOS app
// (which runs tests/fixtures/paths.json too), with and without a sync folder.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../Paths.js");
const cases = require("../fixtures/paths.json");

for (const c of cases) {
  test("resolve: " + c.name, () => {
    const r = P.resolve(c.env, c.machine, c.probe);
    for (const [key, value] of Object.entries(c.expect)) assert.deepEqual(r[key], value, key);
  });
}

test("settingsFile: from the environment only", () => {
  assert.equal(P.settingsFile({ HOME: "/h" }), "/h/.config/omarchy/oma-zotero-launcher.json");
  assert.equal(P.settingsFile({ HOME: "/h", XDG_CONFIG_HOME: "/c" }), "/c/omarchy/oma-zotero-launcher.json");
});

test("problemText: the problems in words", () => {
  const r = P.resolve({ HOME: "/h" }, { general: { syncDir: "/s" } }, { syncMarker: false });
  assert.equal(P.problemText("sync-unavailable", r), "Sync folder not found: /s");
  assert.match(P.problemText("sync-dir-invalid", r), /starts with \/ or ~\//);
});
