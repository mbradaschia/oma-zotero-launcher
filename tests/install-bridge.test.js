// scripts/install-bridge.sh picks the bridge's release, not the newest one: this repository also
// releases the Mac app (macos-v*), and GitHub's "latest" may be one of those.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "scripts", "install-bridge.sh");
const asset = (tag, name) => ({ name, browser_download_url: `https://example/${tag}/${name}` });
const release = (tag, o = {}) => Object.assign({ tag_name: tag, draft: false, prerelease: false, assets: [] }, o);

function pick(releases) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "install-bridge-"));
  const file = path.join(dir, "releases.json");
  fs.writeFileSync(file, JSON.stringify(releases));
  return spawnSync("bash", [SCRIPT], { encoding: "utf8", env: Object.assign({}, process.env, { OMA_ZOTERO_RELEASES_FILE: file, OMA_ZOTERO_DRY_RUN: "1", OMA_DOWNLOAD_DIR: dir }) });
}

test("the newest v* release with an .xpi, past a newer macos-v* release, a prerelease and a draft", () => {
  const r = pick([
    release("macos-v0.1.0", { assets: [asset("macos-v0.1.0", "ZoteroLauncher.zip")] }),
    release("v0.3.0", { prerelease: true, assets: [asset("v0.3.0", "oma-zotero-launcher-0.3.0.xpi")] }),
    release("v0.2.9", { draft: true, assets: [asset("v0.2.9", "oma-zotero-launcher-0.2.9.xpi")] }),
    release("v0.2.2", { assets: [asset("v0.2.2", "oma-zotero-launcher-0.2.2.xpi"), asset("v0.2.2", "oma-zotero-launcher-0.2.2.xpi.sha256")] }),
    release("v0.2.1", { assets: [asset("v0.2.1", "oma-zotero-launcher-0.2.1.xpi")] }),
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "https://example/v0.2.2/oma-zotero-launcher-0.2.2.xpi");
});

test("no bridge release at all: says so", () => {
  const r = pick([release("macos-v0.1.0", { assets: [asset("macos-v0.1.0", "ZoteroLauncher.zip")] })]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no release of the bridge/);
});
