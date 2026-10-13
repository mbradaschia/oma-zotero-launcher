// Chats and artifacts live in the sync folder, written by your other machine: what a file says
// about itself (a chat's id, an artifact's id and versions) must never steer a write outside its
// own folder. The file names were checked before; the contents weren't.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const ID = "2026-10-12T10-15-00-000-abcdef";

test("a chat file whose content says another id: not loaded, not listed, never saved under that id", async () => {
  const { loadSession, saveSession, listSessions } = await import("../../runner/lib/chat.mjs");
  const dir = path.join(tmp("chats-"), "1-ABCD1234");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ID + ".json"), JSON.stringify({ id: "../../../escaped", title: "t", messages: [] }));
  assert.throws(() => loadSession(dir, ID), /bad session/);
  assert.deepEqual(listSessions(dir), []);
  assert.throws(() => saveSession(dir, { id: "../../../escaped", messages: [] }), /bad session id/);
  assert.ok(!fs.existsSync(path.join(dir, "..", "..", "..", "escaped.json")));
  saveSession(dir, { id: ID, title: "ok", messages: [] }); // a good one still saves
  assert.equal(loadSession(dir, ID).title, "ok");
});

test("an artifact whose meta.json points outside its folder: not an artifact, nothing written", async () => {
  const { rerenderAll, listAllArtifacts } = await import("../../runner/lib/artifacts.mjs");
  const root = path.join(tmp("artifacts-"), "artifacts");
  const dir = path.join(root, "1-ABCD1234", "notes");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "v1.md"), "# hi\n");
  for (const meta of [
    { id: "../../../escaped", title: "x", format: "markdown", current: 1, versions: [{ n: 1, format: "markdown", at: "2026-10-12" }] },
    { id: "notes", title: "x", format: "markdown", current: "../../../escaped", versions: [{ n: "../../../escaped", format: "markdown" }] },
  ]) {
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
    rerenderAll(root);
    assert.deepEqual(listAllArtifacts(root), []);
    assert.deepEqual(fs.readdirSync(path.dirname(root)).sort(), ["artifacts"]);
  }
});
