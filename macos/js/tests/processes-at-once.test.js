// Settings › Defaults › Processes at once (the Mac's; R3): how many background processes of each kind run at a
// time, 1 to 4, kept in the settings file only when it isn't 1.
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../lib/Client.js");
const S = require("../lib/Settings.js");

test("processes at once: 1 by default, 1 to 4, a whole number", () => {
  assert.equal(C.normalizeSettings(null).settings.defaults.processesAtOnce, 1);
  assert.equal(C.normalizeSettings({ defaults: { processesAtOnce: 3 } }).settings.defaults.processesAtOnce, 3);
  for (const bad of [0, 5, 2.5, "2"]) {
    const n = C.normalizeSettings({ defaults: { processesAtOnce: bad } });
    assert.equal(n.settings.defaults.processesAtOnce, 1, String(bad));
    assert.deepEqual(n.problems, ["defaults.processesAtOnce must be a whole number from 1 to 4"], String(bad));
  }
});

test("processes at once: written to the file only when it isn't 1", () => {
  assert.equal((S.toFile(C.normalizeSettings(null).settings).defaults || {}).processesAtOnce, undefined);
  assert.deepEqual(S.toFile(C.normalizeSettings({ defaults: { processesAtOnce: 2 } }).settings).defaults, { processesAtOnce: 2 });
});
