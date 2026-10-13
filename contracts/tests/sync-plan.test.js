// contracts/Paths.js syncPlan: the steps that turn the sync folder on (fill: the first machine; join: the
// folder has data already, yours goes to a backup) and off (leave), the settings file last.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../Paths.js");

const ENV = { HOME: "/h", hostname: "arch" };
const L = "/h/.config/omarchy/oma-zotero-launcher";
const MACHINE = "/h/.config/omarchy/oma-zotero-launcher.json";
const BACKUP = L + "/sync-backups/2026-10-12-101500";
const WHEN = { date: "2026-10-12-101500", now: "2026-10-12T10:15:00.000Z" };
const SETTINGS = { general: { keyDelay: 200, port: 1234 }, rules: { quotes: true } };

const steps = (plan) => plan.ops.map((o) => [o.op, o.from, o.to].filter(Boolean).join(" "));
const written = (plan, path) => JSON.parse(plan.ops.find((o) => o.op === "write" && o.to === path).text);

test("fill: your files copied into the folder, the marker, then the settings file", () => {
  const plan = P.syncPlan(ENV, SETTINGS, "/s", Object.assign({ exists: { [L + "/pins.json"]: true, [L + "/prompts"]: true } }, WHEN));
  assert.equal(plan.kind, "fill");
  assert.deepEqual(steps(plan), [
    "mkdir /s/shared",
    `copy ${L}/pins.json /s/shared/pins.json`,
    `copy ${L}/prompts /s/shared/prompts`,
    "write /s/shared/settings.json",
    `write ${L}/shared-settings.json`,
    "write /s/.stignore",
    "write /s/shared/oma-zotero-sync.json",
    "write " + MACHINE,
  ]);
  assert.deepEqual(written(plan, "/s/shared/settings.json"), { general: { keyDelay: 200 }, rules: { quotes: true } });
  assert.deepEqual(written(plan, MACHINE), { general: { port: 1234, syncDir: "/s" } });
  assert.deepEqual(written(plan, "/s/shared/oma-zotero-sync.json"), { version: 1, created: "2026-10-12T10:15:00.000Z", by: "arch" });
  assert.equal(plan.ops.find((o) => o.to === "/s/.stignore").text, "*.tmp\n.DS_Store\n");
});

test("fill: a .stignore you already have is left alone", () => {
  const plan = P.syncPlan(ENV, SETTINGS, "/s", Object.assign({ exists: { "/s/.stignore": true } }, WHEN));
  assert.ok(!steps(plan).includes("write /s/.stignore"));
});

test("join: the folder's data wins, yours goes to a dated backup", () => {
  const exists = { [L + "/pins.json"]: true, [L + "/todos.json"]: true, "/s/shared/oma-zotero-sync.json": true, [MACHINE]: true };
  const plan = P.syncPlan(ENV, SETTINGS, "/s", Object.assign({ exists }, WHEN));
  assert.equal(plan.kind, "join");
  assert.deepEqual(steps(plan), [
    "mkdir " + BACKUP,
    `move ${L}/pins.json ${BACKUP}/pins.json`,
    `move ${L}/todos.json ${BACKUP}/todos.json`,
    `copy ${MACHINE} ${BACKUP}/oma-zotero-launcher.json`,
    "write " + MACHINE,
  ]);
  assert.deepEqual(written(plan, MACHINE), { general: { port: 1234, syncDir: "/s" } });
});

test("leave: the folder's files come back here, yours backed up first, the settings in one file", () => {
  const settings = { general: { syncDir: "/s", port: 1234, keyDelay: 200 } };
  const exists = { [L + "/pins.json"]: true, "/s/shared/pins.json": true, "/s/shared/chats": true };
  const plan = P.syncPlan(ENV, settings, null, Object.assign({ exists }, WHEN));
  assert.equal(plan.kind, "leave");
  assert.deepEqual(steps(plan), [
    "mkdir " + BACKUP,
    `move ${L}/pins.json ${BACKUP}/pins.json`,
    `copy /s/shared/pins.json ${L}/pins.json`,
    "copy /s/shared/chats /h/.local/state/oma-zotero/chats",
    "write " + MACHINE,
  ]);
  assert.deepEqual(written(plan, MACHINE), { general: { port: 1234, keyDelay: 200 } });
});

test("leave with the sync folder gone: your files here stay as they are", () => {
  const plan = P.syncPlan(ENV, { general: { syncDir: "/s" } }, null, Object.assign({ exists: { [L + "/pins.json"]: true } }, WHEN));
  assert.deepEqual(steps(plan), ["mkdir " + BACKUP, "write " + MACHINE]);
});

test("the settings file, which carries the sync folder, is always the last step", () => {
  for (const [settings, next, exists] of [[SETTINGS, "/s", {}], [SETTINGS, "/s", { "/s/shared/oma-zotero-sync.json": true }], [{ general: { syncDir: "/s" } }, null, {}]]) {
    const plan = P.syncPlan(ENV, settings, next, Object.assign({ exists }, WHEN));
    assert.equal(plan.ops[plan.ops.length - 1].to, MACHINE, plan.kind);
  }
});

test("your prompts and artifacts folders stay where you put them", () => {
  const env = Object.assign({ OMA_ZOTERO_PROMPTS_DIR: "/p" }, ENV);
  const settings = { general: { artifactsDir: "/art" } };
  const plan = P.syncPlan(env, settings, "/s", Object.assign({ exists: { "/p": true, "/art": true } }, WHEN));
  assert.ok(steps(plan).every((s) => !s.includes("/p ") && !s.includes("/art")), steps(plan).join("\n"));
});

test("nothing to do, another folder (clear it first), not a folder path", () => {
  assert.equal(P.syncPlan(ENV, SETTINGS, null, WHEN).kind, "none");
  assert.equal(P.syncPlan(ENV, { general: { syncDir: "/s" } }, "/s", WHEN).kind, "none");
  const refused = P.syncPlan(ENV, { general: { syncDir: "/s" } }, "/t", WHEN);
  assert.equal(refused.kind, "refused");
  assert.match(refused.message, /Clear the sync folder first/);
  assert.equal(P.syncPlan(ENV, SETTINGS, "Sync", WHEN).kind, "invalid");
});

test("probePaths: the settings file, each synced path here and in the folder, the marker", () => {
  const paths = P.probePaths(ENV, SETTINGS, "/s");
  for (const p of [MACHINE, L + "/pins.json", "/s/shared/pins.json", "/s/shared/oma-zotero-sync.json", "/s/.stignore"]) assert.ok(paths.includes(p), p);
  assert.equal(new Set(paths).size, paths.length);
});

test("opsArgv: a plan as the script's arguments", () => {
  assert.deepEqual(P.opsArgv([{ op: "mkdir", to: "/a" }, { op: "copy", from: "/b", to: "/c" }, { op: "write", to: "/d", text: "x\n" }]),
    ["mkdir", "/a", "copy", "/b", "/c", "write", "/d", "x\n"]);
});

test("a folder with launcher data but no marker yet is never filled: Syncthing isn't done", () => {
  for (const there of ["/s/shared/settings.json", "/s/shared/pins.json", "/s/shared/chats"]) {
    const plan = P.syncPlan(ENV, SETTINGS, "/s", Object.assign({ exists: { [L + "/pins.json"]: true, [there]: true } }, WHEN));
    assert.equal(plan.kind, "refused", there);
    assert.match(plan.message, /no marker yet/);
    assert.deepEqual(plan.ops, []);
  }
  assert.ok(P.probePaths(ENV, SETTINGS, "/s").includes("/s/shared/settings.json"));
});

test("fill: your whole settings file backed up first; a copy of the shared settings kept here", () => {
  const plan = P.syncPlan(ENV, SETTINGS, "/s", Object.assign({ exists: { [MACHINE]: true } }, WHEN));
  assert.deepEqual(steps(plan).slice(0, 2), ["mkdir " + BACKUP, `copy ${MACHINE} ${BACKUP}/oma-zotero-launcher.json`]);
  assert.deepEqual(written(plan, L + "/shared-settings.json"), written(plan, "/s/shared/settings.json"));
});
