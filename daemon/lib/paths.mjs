// The runner's only path code: contracts/Paths.js, shared with the launcher and the macOS app. An
// installed runner has its copy next to this file (scripts/copy-shared-paths.sh); a checkout
// reads the repository's. Every call reads the machine settings file again: runner commands
// are short-lived, and a sync folder set a moment ago must count.
import { readFileSync, existsSync } from "node:fs";
import { hostname } from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function load() {
  try {
    return require("./shared-paths.cjs");
  } catch {
    return require("../../contracts/Paths.js");
  }
}

export const Paths = load();

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function envOf(env) {
  return {
    HOME: env.HOME, XDG_CONFIG_HOME: env.XDG_CONFIG_HOME, XDG_STATE_HOME: env.XDG_STATE_HOME, XDG_CACHE_HOME: env.XDG_CACHE_HOME,
    OMA_ZOTERO_PROMPTS_DIR: env.OMA_ZOTERO_PROMPTS_DIR, OMA_ZOTERO_INSTRUCTIONS: env.OMA_ZOTERO_INSTRUCTIONS,
    hostname: env.OMA_ZOTERO_HOSTNAME || hostname(),
  };
}

export function machineSettings(env = process.env) {
  return readJson(Paths.settingsFile(envOf(env)));
}

export function settingsFile(env = process.env) {
  return Paths.settingsFile(envOf(env));
}

export function paths(env = process.env) {
  const e = envOf(env);
  const raw = machineSettings(env);
  const first = Paths.resolve(e, raw, { syncMarker: true });
  return Paths.resolve(e, raw, { syncMarker: !!first.marker && existsSync(first.marker) });
}

// The settings in today's shape: the machine file, and the shared one when syncing (while the sync
// folder is missing, this machine's copy of it: the settings stay what they were, not the defaults).
export function combinedSettings(env = process.env) {
  const p = paths(env);
  const shared = p.readOnly ? p.sharedSettingsCache : p.sharedSettings;
  return Paths.combineSettings(machineSettings(env), shared ? readJson(shared) : null);
}

// A write under a sync folder that isn't there would start a second copy of your data: refused.
export function assertWritable(path, env = process.env) {
  const p = paths(env);
  if (p.readOnly && p.syncDir && (path === p.syncDir || String(path).startsWith(p.syncDir + "/"))) {
    throw new Error(Paths.problemText("sync-unavailable", p));
  }
}
