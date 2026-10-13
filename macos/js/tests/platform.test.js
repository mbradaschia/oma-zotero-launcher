// daemon/lib/platform.mjs and the runner's other macOS paths: tools found where Homebrew puts
// them, notifications and editors through macOS's own commands, the bridge handshake where
// Zotero writes it.
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const P = () => import("../../runner/lib/platform.mjs");
const B = () => import("../../runner/lib/bridge.mjs");

// A spawn that records what it was asked to run.
function recorder() {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    const child = new EventEmitter();
    child.unref = () => {};
    return child;
  };
  return { calls, run };
}

test("platform: on macOS, Homebrew and ~/.local/bin join PATH once; elsewhere PATH stays as it is", async () => {
  const { toolPath } = await P();
  const env = { HOME: "/Users/me", PATH: "/usr/bin:/bin" };
  assert.equal(toolPath(env, "darwin"), "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:/Users/me/.local/bin");
  assert.equal(toolPath({ ...env, PATH: "/opt/homebrew/bin:/usr/bin" }, "darwin"), "/opt/homebrew/bin:/usr/bin:/usr/local/bin:/Users/me/.local/bin");
  assert.equal(toolPath(env, "linux"), "/usr/bin:/bin");
});

test("platform: install hints name the platform's package manager", async () => {
  const { installHint } = await P();
  assert.equal(installHint("poppler", "darwin"), "brew install poppler");
  assert.equal(installHint("poppler", "linux"), "omarchy pkg add poppler");
});

test("platform: a notification's text goes to osascript as arguments, not into its script", async () => {
  const { notify } = await P();
  const mac = recorder();
  notify('Saved "x"', "end tell; do shell script \"rm -rf ~\"", "low", { platform: "darwin", run: mac.run });
  const [cmd, ...args] = mac.calls[0];
  assert.equal(cmd, "osascript");
  assert.deepEqual(args.slice(-2), ['Saved "x"', "end tell; do shell script \"rm -rf ~\""]);
  assert.ok(args.slice(0, -2).every((a) => a === "-e" || !a.includes("rm -rf")));
  const linux = recorder();
  notify("Saved", "", "low", { platform: "linux", run: linux.run });
  assert.deepEqual(linux.calls[0], ["notify-send", "-a", "Zotero", "-u", "low", "Saved", ""]);
});

test("platform: a file opens in the text editor (open -t) on macOS, omarchy-launch-editor elsewhere", async () => {
  const { openInEditor } = await P();
  const mac = recorder();
  openInEditor("/tmp/p.md", { platform: "darwin", run: mac.run });
  assert.deepEqual(mac.calls, [["open", "-t", "/tmp/p.md"]]);
  const linux = recorder();
  openInEditor("/tmp/p.md", { platform: "linux", run: linux.run });
  assert.deepEqual(linux.calls, [["omarchy-launch-editor", "/tmp/p.md"]]);
});

test("bridge: the handshake is looked up where Zotero writes it: XDG_RUNTIME_DIR, else TMPDIR, else /tmp", async () => {
  const { handshakePath } = await B();
  assert.equal(handshakePath({ XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/x" }), "/run/user/1000/oma-zotero/bridge.json");
  assert.equal(handshakePath({ TMPDIR: "/var/folders/ab/cd/T/" }), "/var/folders/ab/cd/T/oma-zotero/bridge.json");
  assert.equal(handshakePath({}), "/tmp/oma-zotero/bridge.json");
});
