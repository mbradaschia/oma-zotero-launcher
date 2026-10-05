// Zotero's sync from the launcher (zotero-bridge/lib/sync.js): /sync/status and /sync/start against
// a fake Zotero.Sync.Runner.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const plain = (x) => JSON.parse(JSON.stringify(x));

function omaHttpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

// A fake Zotero: sync resolves when `finish()` is called, after reporting `errors` through onError.
function load({ enabled = true, inProgress = false, lastSync = new Date("2026-10-02T10:00:00Z"), errors = [], throws = null } = {}) {
  const calls = { sync: [], added: [] };
  let finish;
  const Runner = {
    enabled, syncInProgress: inProgress, lastSyncStatus: inProgress ? "Syncing…" : undefined,
    sync(options) {
      calls.sync.push(options);
      if (throws) return Promise.reject(throws);
      return new Promise((resolve) => { finish = () => { errors.forEach((e) => options.onError(e)); resolve(); }; });
    },
    addError(e) { calls.added.push(e); },
  };
  const Zotero = { Sync: { Runner, Data: { Local: { getLastSyncTime: () => lastSync } } }, Error: { ERROR_API_KEY_NOT_SET: 7 } };
  const ctx = vm.createContext({ omaHttpError, Zotero, console, Promise, setTimeout });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../zotero-bridge/lib/sync.js"), "utf8"), ctx);
  return { S: ctx.OmaSync, calls, finish: () => finish(), Runner };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("status: set up or not, running or not, the last sync's time", async () => {
  const { S } = load();
  assert.deepEqual(plain(await S.status()), { configured: true, running: false, status: "", lastSync: "2026-10-02T10:00:00.000Z", run: { running: false, started: "", finished: "", ok: null, error: "" } });
  const off = load({ enabled: false, lastSync: false }).S;
  const st = plain(await off.status());
  assert.deepEqual([st.configured, st.lastSync], [false, ""]);
  const busy = plain(await load({ inProgress: true }).S.status());
  assert.deepEqual([busy.running, busy.status], [true, "Syncing…"]);
});

test("start: runs Zotero's sync in the background, answers at once; the run ends synced", async () => {
  const { S, calls, finish } = load();
  const r = plain(await S.start());
  assert.deepEqual([r.started, r.run.running], [true, true]);
  await tick();
  assert.equal(calls.sync.length, 1);
  assert.equal(calls.sync[0].background, true);
  assert.equal(plain(await S.status()).running, true);
  const again = plain(await S.start()); // one at a time
  assert.equal(again.started, false);
  assert.equal(calls.sync.length, 1);
  finish();
  await tick(); await tick();
  const st = plain(await S.status());
  assert.deepEqual([st.running, st.run.ok, st.run.error], [false, true, ""]);
  assert.ok(st.run.finished >= st.run.started);
});

test("start: Zotero's errors end the run failed, and still reach Zotero's sync icon", async () => {
  const e = new Error("The Zotero sync server could not be reached.\nDetails…");
  const { S, calls, finish } = load({ errors: [e] });
  await S.start();
  await tick();
  finish();
  await tick(); await tick();
  const st = plain(await S.status());
  assert.deepEqual([st.run.ok, st.run.error], [false, "The Zotero sync server could not be reached."]);
  assert.deepEqual(calls.added, [e]);
  const key = Object.assign(new Error("API key not set"), { error: 7 });
  const k = load({ throws: key });
  await k.S.start();
  await tick(); await tick(); await tick();
  assert.equal(plain(await k.S.status()).run.error, "Not signed in: Zotero › Settings › Sync");
});

test("start: not set up → 409 not-configured, nothing started", async () => {
  const { S, calls } = load({ enabled: false });
  await assert.rejects(S.start(), (e) => e.status === 409 && e.code === "not-configured");
  assert.equal(calls.sync.length, 0);
});

test("the launcher: Sync Zotero under Go to, its line from the bridge's status; the footer's word on it", () => {
  const V = require("../lib/Views.js");
  const now = Date.parse("2026-10-03T12:00:00Z");
  const row = (sync) => V.commandRows("sync", { keys: "single", sync, now })[0];
  assert.deepEqual([row(null).kind, row(null).title, row(null).section], ["sync", "Sync Zotero", "Go to"]);
  assert.equal(row(null).subtitle, "Zotero's own sync, without leaving the launcher · S");
  assert.equal(row({ configured: false }).subtitle, "Not set up: sign in under Zotero › Settings › Sync · S");
  assert.equal(row({ configured: true, running: true, status: "Syncing “My Library”" }).subtitle, "Syncing… · Syncing “My Library” · it's in Processes · S");
  assert.equal(row({ configured: true, running: false, lastSync: "2026-10-03T11:55:00Z" }).subtitle, "Last synced 5 min ago · S");
  assert.equal(V.commandRows("synchronize", { keys: "alt" })[0].subtitle, "Zotero's own sync, without leaving the launcher · alt+S");
  assert.equal(V.syncFooter({ configured: true, lastSync: "2026-10-03T10:00:00Z" }, now), "synced 2 h ago");
  assert.equal(V.syncFooter({ configured: true, running: true }, now), "syncing…");
  assert.equal(V.syncFooter({ configured: false, lastSync: "2026-10-03T10:00:00Z" }, now), "");
  assert.equal(V.syncFooter(null, now), "");
  // in Processes: a finished sync says so, without a dangling separator
  const rows = V.buildTaskRows([{ id: "zotero-sync", kind: "sync", title: "Sync Zotero", status: "done", started: "2026-10-03T11:59:00Z", finished: "2026-10-03T11:59:00Z", detail: "Synced" }], "", "#fff", (list) => list.map((item) => ({ item, positions: [] })), now);
  assert.equal(rows.find((r) => r.rowId === "task").detail, "Finished 1 min ago · Synced");
});

test("the queue at a glance: running, pending (waiting their turn: not tasks yet), finished, failed", () => {
  const V = require("../lib/Views.js");
  const tasks = [{ status: "running" }, { status: "done" }, { status: "done" }, { status: "error" }];
  assert.equal(V.taskSummary(tasks, 12).text, "1 running · 12 pending · 2 finished · 1 failed");
  assert.equal(V.taskSummary(tasks).text, "1 running · 2 finished · 1 failed");
  assert.deepEqual([V.taskSummary([], 3).text, V.taskSummary([], 3).pending, V.taskSummary([], -1).text], ["3 pending", 3, ""]);
});
