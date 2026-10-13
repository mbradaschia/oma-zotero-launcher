// Copied for the Mac app (macos/VENDORED.md): its tests of the launcher's view logic; the bridge's
// tests stay with the bridge.
// Zotero's sync from the launcher (zotero-bridge/lib/sync.js): /sync/status and /sync/start against
// a fake Zotero.Sync.Runner.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const plain = (x) => JSON.parse(JSON.stringify(x));


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
