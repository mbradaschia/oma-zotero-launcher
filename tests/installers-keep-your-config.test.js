// R12: installing or updating replaces the app and the runner's own folder, never what's yours: your settings, prompts,
// taxonomies, saved searches (~/.config/omarchy/…), the app's preferences (the hotkey: ~/Library/Preferences) and the
// Keychain. Checked on the installers' text: no path of yours is written, moved or removed there.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const scripts = ["scripts/install-runner.sh", "scripts/install.sh"].filter((p) => fs.existsSync(path.join(__dirname, "..", p)));

test("the installers never touch your configuration", () => {
  assert.ok(scripts.length >= 1);
  for (const p of scripts) {
    const text = fs.readFileSync(path.join(__dirname, "..", p), "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    for (const yours of [".config", "Library/Preferences", "XDG_CONFIG_HOME", "defaults write", "defaults delete", "security delete", "security add"]) {
      assert.equal(text.includes(yours), false, `${p} mentions ${yours}`);
    }
  }
});
