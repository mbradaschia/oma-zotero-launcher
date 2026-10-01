// scripts/safe-dest.sh, and the scripts that replace a directory wholesale (rsync --delete):
// install-runner.sh and dev-sync.sh refuse a destination that is a link, sits under a link,
// resolves elsewhere, isn't yours or holds something else, and never touch what a link points to.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const LIB = path.join(ROOT, "scripts/safe-dest.sh");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "safe-dest-"));
}

// safe_dest DEST BASE, with an IS_OURS that looks for a file named "ours".
function check(dest, base) {
  const script = `source "${LIB}"; ours() { [[ -f $1/ours ]]; }; safe_dest "$1" "$2" ours && echo ok`;
  const r = spawnSync("bash", ["-c", script, "bash", dest, base], { encoding: "utf8" });
  return { ok: r.status === 0 && r.stdout.trim() === "ok", err: r.stderr.trim() };
}

test("safe_dest: a new or empty directory, or one of ours, inside the base", () => {
  const t = tmp();
  const base = path.join(t, "base");
  assert.equal(check(path.join(base, "new"), base).ok, true); // doesn't exist yet (the base is made)
  fs.mkdirSync(path.join(base, "empty"));
  assert.equal(check(path.join(base, "empty"), base).ok, true);
  fs.mkdirSync(path.join(base, "mine"));
  fs.writeFileSync(path.join(base, "mine", "ours"), "");
  assert.equal(check(path.join(base, "mine"), base).ok, true);
  assert.equal(check(path.join(base, "a", "b"), base).ok, true); // deeper, not there yet
});

test("safe_dest: refuses links, paths outside the base, files and what isn't ours", () => {
  const t = tmp();
  const base = path.join(t, "base");
  const elsewhere = path.join(t, "elsewhere");
  fs.mkdirSync(base);
  fs.mkdirSync(elsewhere);
  fs.writeFileSync(path.join(elsewhere, "precious"), "keep me");
  fs.writeFileSync(path.join(elsewhere, "ours"), ""); // even a link to something "ours" is refused

  fs.symlinkSync(elsewhere, path.join(base, "link"));
  let r = check(path.join(base, "link"), base);
  assert.equal(r.ok, false);
  assert.match(r.err, /is a symbolic link/);

  fs.symlinkSync(elsewhere, path.join(base, "parent"));
  r = check(path.join(base, "parent", "child"), base); // a link on the way
  assert.equal(r.ok, false);
  assert.match(r.err, /parent is a symbolic link/);

  assert.match(check(base + "/../elsewhere", base).err, /\. or \.\./); // as typed, not normalized
  assert.match(check(elsewhere, base).err, /isn't inside/);
  assert.match(check(base, base).err, /isn't inside/); // the base itself, never

  fs.writeFileSync(path.join(base, "file"), "");
  assert.match(check(path.join(base, "file"), base).err, /isn't a directory/);

  fs.mkdirSync(path.join(base, "foreign"));
  fs.writeFileSync(path.join(base, "foreign", "theirs"), "");
  assert.match(check(path.join(base, "foreign"), base).err, /isn't ours/);

  assert.equal(fs.readFileSync(path.join(elsewhere, "precious"), "utf8"), "keep me");
});

test("dev-sync.sh: a plugins entry that is a link is refused, and what it points to is untouched", () => {
  const home = tmp();
  const id = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).id;
  const plugins = path.join(home, ".config/omarchy/plugins");
  const victim = path.join(home, "victim");
  fs.mkdirSync(plugins, { recursive: true });
  fs.mkdirSync(victim);
  fs.writeFileSync(path.join(victim, "precious"), "keep me");
  fs.symlinkSync(victim, path.join(plugins, id));
  const r = spawnSync("bash", [path.join(ROOT, "scripts/dev-sync.sh")], { encoding: "utf8", env: { ...process.env, HOME: home } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /refusing to write into .*: .* is a symbolic link/);
  assert.deepEqual(fs.readdirSync(victim), ["precious"]);
});

test("dev-sync.sh: a plugins entry holding another plugin is refused", () => {
  const home = tmp();
  const id = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).id;
  const dest = path.join(home, ".config/omarchy/plugins", id);
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "manifest.json"), JSON.stringify({ id: "someone.else" }));
  const r = spawnSync("bash", [path.join(ROOT, "scripts/dev-sync.sh")], { encoding: "utf8", env: { ...process.env, HOME: home } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /isn't ours/);
  assert.deepEqual(fs.readdirSync(dest), ["manifest.json"]);
});

test("install-runner.sh: a runner directory that is a link, or a command that isn't a link, is refused", () => {
  const home = tmp();
  const data = path.join(home, "data");
  const victim = path.join(home, "victim");
  fs.mkdirSync(path.join(data, "oma-zotero-launcher"), { recursive: true });
  fs.mkdirSync(victim);
  fs.writeFileSync(path.join(victim, "precious"), "keep me");
  fs.symlinkSync(victim, path.join(data, "oma-zotero-launcher", "runner"));
  const env = { ...process.env, HOME: home, XDG_DATA_HOME: data, XDG_STATE_HOME: path.join(home, "state") };
  let r = spawnSync("bash", [path.join(ROOT, "scripts/install-runner.sh")], { encoding: "utf8", env });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /refusing to write into .*runner: .* is a symbolic link/);
  assert.deepEqual(fs.readdirSync(victim), ["precious"]);

  fs.unlinkSync(path.join(data, "oma-zotero-launcher", "runner"));
  fs.mkdirSync(path.join(home, ".local/bin"), { recursive: true });
  fs.writeFileSync(path.join(home, ".local/bin/oma-zotero-prompt"), "#!/bin/sh\n# someone else's\n");
  r = spawnSync("bash", [path.join(ROOT, "scripts/install-runner.sh")], { encoding: "utf8", env });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /isn't a link: not replacing it/);
  assert.match(fs.readFileSync(path.join(home, ".local/bin/oma-zotero-prompt"), "utf8"), /someone else's/);
});
