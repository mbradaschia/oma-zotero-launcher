// The runner's settings while the sync folder is missing: the copy of the shared settings this
// machine keeps (shared-settings.json), not the defaults: your providers, models and rules stay.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("loadSettings with the sync folder missing: the shared settings this machine last saw", async () => {
  const { loadSettings } = await import("../../runner/lib/settings.mjs");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "runner-settings-"));
  const cdir = path.join(home, ".config", "omarchy", "oma-zotero-launcher");
  fs.mkdirSync(cdir, { recursive: true });
  fs.writeFileSync(path.join(home, ".config", "omarchy", "oma-zotero-launcher.json"), JSON.stringify({ general: { syncDir: path.join(home, "gone") } }));
  fs.writeFileSync(path.join(cdir, "shared-settings.json"), JSON.stringify({ providers: { openai: { enabled: true } }, rules: { quotes: false } }));
  // HOME decides only when the XDG folders aren't set (Linux CI sets XDG_CONFIG_HOME): clear them too.
  const names = ["HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"];
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  for (const n of names.slice(1)) delete process.env[n];
  process.env.HOME = home;
  try {
    const s = loadSettings();
    assert.equal(s.configured, true);
    assert.equal(s.providers.openai.enabled, true);
    assert.deepEqual(s.rules, { quotes: false });
  } finally {
    for (const n of names) if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n];
  }
});
