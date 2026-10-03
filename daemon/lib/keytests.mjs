// The last Test connection of each provider (and of the Jev key), kept so Settings can say whether a key
// works after a restart: ~/.local/state/oma-zotero/key-tests.json, { id: { ok, detail, at, key } }. `key`
// is the masked key it was tested with ("" for a provider without one): another key since then makes the
// result stale (not tested yet). Never the key itself.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export function testsPath(env = process.env) {
  return join(env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state"), "oma-zotero", "key-tests.json");
}

export function loadTests(path = testsPath()) {
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    return j && typeof j === "object" && !Array.isArray(j) ? j : {};
  } catch {
    return {};
  }
}

// One test's result, saved (the others kept). → the entry.
export function saveTest(id, result, maskedKey, { path = testsPath(), now = new Date() } = {}) {
  const all = loadTests(path);
  all[id] = { ok: !!result.ok, detail: String(result.detail || "").slice(0, 300), at: now.toISOString(), key: String(maskedKey || "") };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path + ".tmp", JSON.stringify(all, null, 2) + "\n");
  renameSync(path + ".tmp", path);
  return all[id];
}

// A provider's last test as Settings shows it, against the key it has now: { ok, detail, at, stale } or null
// (never tested). stale: the key changed since (or was removed).
export function testFor(tests, id, maskedKey) {
  const t = tests && tests[id];
  if (!t || typeof t !== "object") return null;
  return { ok: !!t.ok, detail: String(t.detail || ""), at: String(t.at || ""), stale: String(t.key || "") !== String(maskedKey || "") };
}
