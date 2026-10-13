// lib/Paths.js: the settings file split in two when syncing (the machine's keys, the shared ones)
// and put back together; every key the Settings view can write has a side.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../lib/Paths.js");
const S = require("../lib/Settings.js");

const FILE = {
  general: { port: 1234, promptCommand: ["node", "x.mjs"], syncDir: "/s", machineName: "arch", keyDelay: 200, citationStyle: "apa", automationHost: "arch" },
  providers: { claude: { enabled: true } },
  defaults: { autoExtract: true },
  tasks: { defaultTask: "next" },
  status: { tags: ["s/to read"] },
  rules: { quotes: true },
};

test("every general key has a side", () => {
  for (const key of Object.keys(S.GENERAL_DEFAULTS)) assert.ok(P.SETTING_SCOPES["general." + key], "general." + key);
});

test("every section the Settings view writes is shared", () => {
  const file = S.toFile({
    maxResults: 100,
    providers: { claude: { enabled: true } },
    endpoints: [{ id: "lab", name: "Lab", baseURL: "https://gw/v1", enabled: true }],
    defaults: { prompts: { model: "m", effort: "low" }, autoExtract: true },
    tasks: { statuses: [{ id: "a", name: "A", group: "active" }], defaultTask: "a" },
    paperStatuses: ["x"],
    rules: { quotes: true },
  });
  for (const section of Object.keys(file)) if (section !== "general") assert.equal(P.SETTING_SCOPES[section], "shared", section);
});

test("splitSettings: the machine's keys on the machine, the rest shared", () => {
  const { machine, shared } = P.splitSettings(FILE, true);
  assert.deepEqual(machine, { general: { port: 1234, promptCommand: ["node", "x.mjs"], syncDir: "/s", machineName: "arch" } });
  assert.deepEqual(shared, {
    general: { keyDelay: 200, citationStyle: "apa", automationHost: "arch" },
    providers: { claude: { enabled: true } }, defaults: { autoExtract: true }, tasks: { defaultTask: "next" }, status: { tags: ["s/to read"] }, rules: { quotes: true },
  });
});

test("split then combined: the same file; sync off: all of it on the machine", () => {
  const { machine, shared } = P.splitSettings(FILE, true);
  assert.deepEqual(P.combineSettings(machine, shared), FILE);
  assert.deepEqual(P.splitSettings(FILE, false), { machine: FILE, shared: null });
});

test("unknown keys and sections stay on the machine, nothing is dropped", () => {
  const { machine, shared } = P.splitSettings({ general: { someday: 1 }, newSection: { a: 1 }, maxResults: 80 }, true);
  assert.deepEqual(machine, { general: { someday: 1 }, newSection: { a: 1 }, maxResults: 80 });
  assert.deepEqual(shared, {});
});

test("combineSettings: the shared file wins shared keys only; where it lacks one, the machine's stays", () => {
  assert.deepEqual(P.combineSettings({ general: { port: 1, keyDelay: 300 } }, { general: { keyDelay: 150, port: 2 } }), { general: { port: 1, keyDelay: 150 } });
  assert.deepEqual(P.combineSettings({ general: { keyDelay: 300 } }, {}), { general: { keyDelay: 300 } });
  assert.deepEqual(P.combineSettings({ maxResults: 80 }, null), { maxResults: 80 });
  assert.deepEqual(P.combineSettings(null, { rules: { a: true } }), { rules: { a: true } });
});

test("settingsSave: both files when syncing; one when not", () => {
  const on = P.resolve({ HOME: "/h" }, { general: { syncDir: "/s" } }, { syncMarker: true });
  const off = P.resolve({ HOME: "/h" }, null, {});
  const both = P.settingsSave(FILE, on, null);
  assert.deepEqual(JSON.parse(both.machine).general, { port: 1234, promptCommand: ["node", "x.mjs"], syncDir: "/s", machineName: "arch" });
  assert.equal(JSON.parse(both.shared).general.keyDelay, 200);
  assert.equal(both.refused, "");
  const one = P.settingsSave(FILE, off, null);
  assert.deepEqual(JSON.parse(one.machine), FILE);
  assert.equal(one.shared, null);
});

test("settingsSave with the sync folder missing: the machine's keys save, a shared change is refused", () => {
  const gone = P.resolve({ HOME: "/h" }, { general: { syncDir: "/s" } }, { syncMarker: false });
  const current = P.splitSettings(FILE, true).shared;
  const same = P.settingsSave(Object.assign({}, FILE, { general: Object.assign({}, FILE.general, { port: 9 }) }), gone, JSON.parse(JSON.stringify(current)));
  assert.equal(JSON.parse(same.machine).general.port, 9);
  assert.equal(same.shared, null);
  assert.equal(same.refused, "");
  const changed = P.settingsSave(Object.assign({}, FILE, { rules: { quotes: false } }), gone, current);
  assert.equal(changed.shared, null);
  assert.equal(changed.refused, "Sync folder not found: /s");
});
