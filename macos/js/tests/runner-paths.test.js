// The runner finds every file through daemon/lib/paths.mjs (contracts/Paths.js, shared with the
// launcher): no module builds a user-data path of its own, an installed runner gets its copy of
// contracts/Paths.js, and the synced files are written only through atomic.mjs.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", ".."); // macos/
const DAEMON = path.join(ROOT, "runner");

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sources(p);
    return /\.m?js$/.test(e.name) ? [p] : [];
  });
}

test("no runner module but paths.mjs builds a user-data path", () => {
  const own = /XDG_(CONFIG|STATE|CACHE)_HOME|"\.local", "state"|"\.config"|"\.cache"/;
  for (const file of sources(path.join(DAEMON, "lib")).concat(sources(path.join(DAEMON, "bin")))) {
    if (path.basename(file) === "paths.mjs") continue;
    assert.ok(!own.test(fs.readFileSync(file, "utf8")), path.relative(ROOT, file));
  }
});

test("the synced files are written only through atomic.mjs", () => {
  for (const name of ["prompts.mjs", "taxonomies.mjs", "chat.mjs", "artifacts.mjs", "system.mjs", "libs.mjs"]) {
    const src = fs.readFileSync(path.join(DAEMON, "lib", name), "utf8");
    assert.ok(!/\b(writeFileSync|mkdirSync)\(/.test(src), name);
  }
});

test("copy-shared-paths.sh: contracts/Paths.js next to the installed runner's paths.mjs", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "runner-"));
  const r = spawnSync("bash", [path.join(ROOT, "scripts", "copy-shared-paths.sh"), dest], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.readFileSync(path.join(dest, "lib", "shared-paths.cjs")).equals(fs.readFileSync(path.join(ROOT, "..", "contracts", "Paths.js"))));
});
