// daemon/lib/atomic.mjs: the runner's writes to the files a sync folder carries: whole or not at
// all, no temporary file left behind, and refused while the sync folder is missing.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function home(settings) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-"));
  if (settings) {
    fs.mkdirSync(path.join(h, ".config", "omarchy"), { recursive: true });
    fs.writeFileSync(path.join(h, ".config", "omarchy", "oma-zotero-launcher.json"), JSON.stringify(settings));
  }
  return { HOME: h, OMA_ZOTERO_HOSTNAME: "test" };
}

test("writeAtomic: the text, its folder made, no temporary file left", async () => {
  const { writeAtomic } = await import("../daemon/lib/atomic.mjs");
  const env = home(null);
  const file = path.join(env.HOME, "a", "b", "x.json");
  writeAtomic(file, "{}\n", env);
  writeAtomic(file, '{"n":2}\n', env);
  assert.equal(fs.readFileSync(file, "utf8"), '{"n":2}\n');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["x.json"]);
});

test("writeAtomic: a failed write leaves the old file as it was and no temporary file", async () => {
  const { writeAtomic } = await import("../daemon/lib/atomic.mjs");
  const env = home(null);
  const dir = path.join(env.HOME, "d");
  fs.mkdirSync(path.join(dir, "x.json"), { recursive: true }); // a folder where the file would go: the rename fails
  assert.throws(() => writeAtomic(path.join(dir, "x.json"), "new", env));
  assert.deepEqual(fs.readdirSync(dir), ["x.json"]);
});

test("writeAtomic and ensureDir: refused under a sync folder that isn't there, fine elsewhere", async () => {
  const { writeAtomic, ensureDir } = await import("../daemon/lib/atomic.mjs");
  const env = home({ general: { syncDir: "/nonexistent-sync-folder" } });
  assert.throws(() => writeAtomic("/nonexistent-sync-folder/shared/pins.json", "{}", env), /Sync folder not found: \/nonexistent-sync-folder/);
  assert.throws(() => ensureDir("/nonexistent-sync-folder/shared/chats", env), /Sync folder not found/);
  writeAtomic(path.join(env.HOME, "elsewhere.txt"), "ok", env);
});
