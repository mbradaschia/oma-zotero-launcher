// The runner finds every file through daemon/lib/paths.mjs (lib/Paths.js, shared with the
// launcher): no module builds a user-data path of its own, an installed runner gets its copy of
// lib/Paths.js, and the synced files are written only through atomic.mjs.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const DAEMON = path.join(ROOT, "daemon");

test("copy-shared-paths.sh: lib/Paths.js next to the installed runner's paths.mjs", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "runner-"));
  const r = spawnSync("bash", [path.join(ROOT, "scripts", "copy-shared-paths.sh"), dest], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.readFileSync(path.join(dest, "lib", "shared-paths.cjs")).equals(fs.readFileSync(path.join(ROOT, "lib", "Paths.js"))));
});
