// R12: installing or updating replaces the app and the runner's own folder, never what's yours: your settings, prompts,
// taxonomies, saved searches (~/.config/omarchy/…), the app's preferences (the hotkey: ~/Library/Preferences) and the
// Keychain. Checked on the installers' text: no path of yours is written, moved or removed there.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const scripts = ["macos/scripts/install.sh", "macos/scripts/install-runner.sh", "scripts/install-runner.sh"].filter((p) => fs.existsSync(path.join(__dirname, "..", p)));

test("the installers never touch your configuration", () => {
  assert.ok(scripts.length >= 2);
  for (const p of scripts) {
    const text = fs.readFileSync(path.join(__dirname, "..", p), "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    for (const yours of [".config", "Library/Preferences", "XDG_CONFIG_HOME", "defaults write", "defaults delete", "security delete", "security add"]) {
      assert.equal(text.includes(yours), false, `${p} mentions ${yours}`);
    }
  }
});

test("install.sh replaces only ZoteroLauncher.app, and only if it is ours", () => {
  const t = fs.readFileSync(path.join(__dirname, "../macos/scripts/install.sh"), "utf8");
  assert.match(t, /APP="\$DEST\/ZoteroLauncher\.app"/);
  assert.match(t, /isn't Zotero Launcher: not replacing it/);
  for (const m of t.matchAll(/\b(rm -rf|mv) ("[^"]+"|\S+)/g)) assert.ok(/\$(APP|work|old|new)\b|"\$\w+"|\$work/.test(m[2]), `unexpected ${m[0]}`);
});
