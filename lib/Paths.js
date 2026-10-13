// Where every file lives, for the launcher, the prompt runner and the macOS app alike: one answer
// for the three (zotero-launcher-macos PLAN.md, decisions 8 and 12). Pure: the callers read, probe
// and write; this only computes. A sync folder (general.syncDir) moves the files you curate under
// <syncDir>/shared, a folder you sync between machines yourself (Syncthing, Dropbox).
// Design: docs/superpowers/specs/2026-10-12-phase-2.5-paths-design.md.

var MARKER = "oma-zotero-sync.json"
var STIGNORE = "*.tmp\n.DS_Store\n"

// What moves under the sync folder, in the order a plan copies it.
var SYNCED = ["pins", "searches", "todos", "view", "instructions", "prompts", "taxonomies", "taxonomyState", "chats", "artifacts"]

// Which settings travel (shared) and which stay on each machine; anything not listed stays.
var SETTING_SCOPES = {
  "general.port": "machine", "general.externalPdfCommand": "machine", "general.promptCommand": "machine",
  "general.zoteroCommand": "machine", "general.artifactsDir": "machine", "general.syncDir": "machine", "general.machineName": "machine",
  "general.enterAction": "shared", "general.maxResults": "shared", "general.accelerators": "shared", "general.emptyQuery": "shared",
  "general.keys": "shared", "general.keysStart": "shared", "general.keyDelay": "shared", "general.citationStyle": "shared",
  "general.automationHost": "shared",
  providers: "shared", defaults: "shared", tasks: "shared", status: "shared", rules: "shared"
}

function isObject(x) {
  return !!x && typeof x === "object" && !Array.isArray(x)
}

function clone(x) {
  return x === undefined ? undefined : JSON.parse(JSON.stringify(x))
}

// ("/a/", "b") → "/a/b": empty parts skipped, no doubled or trailing slashes.
function join() {
  var parts = []
  for (var i = 0; i < arguments.length; i++) if (arguments[i]) parts.push(String(arguments[i]))
  var s = parts.join("/").replace(/\/{2,}/g, "/")
  return s.length > 1 ? s.replace(/\/$/, "") : s
}

function baseName(p) {
  var s = String(p)
  return s.slice(s.lastIndexOf("/") + 1)
}

function expandHome(p, home) {
  var s = String(p)
  if (s === "~") return home
  if (s.indexOf("~/") === 0) return join(home, s.slice(2))
  return s
}

// A general key of the settings file: its "general" section, else a flat key from before sections.
function generalValue(raw, key) {
  if (!isObject(raw)) return undefined
  if (isObject(raw.general) && raw.general[key] !== undefined) return raw.general[key]
  return raw[key]
}

function bases(env) {
  var e = env || {}
  var home = e.HOME || ""
  var config = e.XDG_CONFIG_HOME || join(home, ".config")
  return {
    home: home,
    config: config,
    cdir: join(config, "omarchy", "oma-zotero-launcher"),
    state: join(e.XDG_STATE_HOME || join(home, ".local", "state"), "oma-zotero"),
    cache: join(e.XDG_CACHE_HOME || join(home, ".cache"), "oma-zotero-launcher")
  }
}

// The machine settings file: from the environment only (it holds the sync folder itself).
function settingsFile(env) {
  return join(bases(env).config, "omarchy", "oma-zotero-launcher.json")
}

// Every other path. env: { HOME, XDG_CONFIG_HOME, XDG_STATE_HOME, XDG_CACHE_HOME,
// OMA_ZOTERO_PROMPTS_DIR, OMA_ZOTERO_INSTRUCTIONS, hostname }; machineSettings: the parsed machine
// file or null; probe: { syncMarker } (does <syncDir>/shared/oma-zotero-sync.json exist).
function resolve(env, machineSettings, probe) {
  var e = env || {}
  var b = bases(e)
  var problems = []
  var syncDir = null
  var wanted = generalValue(machineSettings, "syncDir")
  if (typeof wanted === "string" && wanted.trim()) {
    var abs = expandHome(wanted.trim(), b.home)
    if (abs.charAt(0) === "/") syncDir = join(abs)
    else problems.push("sync-dir-invalid")
  } else if (wanted !== undefined && wanted !== null && wanted !== "") problems.push("sync-dir-invalid")
  var shared = syncDir ? join(syncDir, "shared") : ""
  function place(name, local) { return shared ? join(shared, name) : local }
  var artifactsDir = generalValue(machineSettings, "artifactsDir")
  var name = generalValue(machineSettings, "machineName")
  var out = {
    settings: settingsFile(e),
    sharedSettings: shared ? join(shared, "settings.json") : null,
    pins: place("pins.json", join(b.cdir, "pins.json")),
    searches: place("searches.json", join(b.cdir, "searches.json")),
    todos: place("todos.json", join(b.cdir, "todos.json")),
    view: place("view.json", join(b.cdir, "view.json")),
    instructions: e.OMA_ZOTERO_INSTRUCTIONS || place("instructions.md", join(b.cdir, "instructions.md")),
    prompts: e.OMA_ZOTERO_PROMPTS_DIR || place("prompts", join(b.cdir, "prompts")),
    taxonomies: place("taxonomies", join(b.cdir, "taxonomies")),
    taxonomyState: place("taxonomy.json", join(b.state, "taxonomy.json")),
    chats: place("chats", join(b.state, "chats")),
    artifacts: typeof artifactsDir === "string" && artifactsDir.trim() ? join(expandHome(artifactsDir.trim(), b.home)) : place("artifacts", join(b.state, "artifacts")),
    extract: join(b.cdir, "extract.json"),
    runnerTasks: join(b.state, "tasks"),
    runnerState: b.state,
    promptVersions: join(b.state, "prompt-versions.json"),
    keyTests: join(b.state, "key-tests.json"),
    modelsCache: join(b.cache, "models.json"),
    providerCache: b.cache,
    backups: join(b.cdir, "sync-backups"),
    configDir: b.cdir,
    syncDir: syncDir,
    marker: shared ? join(shared, MARKER) : null,
    stignore: syncDir ? join(syncDir, ".stignore") : null,
    machine: typeof name === "string" && name.trim() ? name.trim() : String(e.hostname || "").trim() || "this machine",
    readOnly: false,
    problems: problems
  }
  if (syncDir && !(probe && probe.syncMarker)) {
    out.readOnly = true
    problems.push("sync-unavailable")
  }
  return out
}

function problemText(code, paths) {
  if (code === "sync-unavailable") return "Sync folder not found: " + paths.syncDir
  if (code === "sync-dir-invalid") return "Sync folder ignored: a folder path starts with / or ~/"
  return String(code)
}
// ------------------------------------------------------------ two settings files

function scopeOf(section, key) {
  return SETTING_SCOPES[key === undefined ? section : section + "." + key] || "machine"
}

// The settings file (today's shape) → { machine, shared }; sync off: all of it on the machine.
function splitSettings(file, syncOn) {
  var f = clone(isObject(file) ? file : {})
  if (!syncOn) return { machine: f, shared: null }
  var machine = {}
  var shared = {}
  for (var sec in f) {
    if (sec === "general" && isObject(f.general)) {
      var mg = {}
      var sg = {}
      for (var k in f.general) (scopeOf("general", k) === "shared" ? sg : mg)[k] = f.general[k]
      if (Object.keys(mg).length) machine.general = mg
      if (Object.keys(sg).length) shared.general = sg
    } else if (scopeOf(sec) === "shared") shared[sec] = f[sec]
    else machine[sec] = f[sec]
  }
  return { machine: machine, shared: shared }
}

// The two files → one in today's shape: the shared file wins the shared keys; where it lacks
// one, the machine file's value stays. No shared file: the machine file as it is.
function combineSettings(machineRaw, sharedRaw) {
  var out = clone(isObject(machineRaw) ? machineRaw : {})
  if (!isObject(sharedRaw)) return out
  for (var sec in sharedRaw) {
    if (sec === "general" && isObject(sharedRaw.general)) {
      if (!isObject(out.general)) out.general = {}
      for (var k in sharedRaw.general) if (scopeOf("general", k) === "shared") out.general[k] = clone(sharedRaw.general[k])
    } else if (scopeOf(sec) === "shared") out[sec] = clone(sharedRaw[sec])
  }
  return out
}

function jsonText(x) {
  return JSON.stringify(x, null, 2) + "\n"
}

// JSON with its keys sorted, to compare two settings objects whatever order they were written in.
function canonical(x) {
  if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]"
  if (isObject(x)) return "{" + Object.keys(x).sort().map(function (k) { return JSON.stringify(k) + ":" + canonical(x[k]) }).join(",") + "}"
  return JSON.stringify(x)
}

// What saving the settings file (today's shape) writes: { machine (the machine file's text), shared
// (the shared file's, or null: not syncing, or the folder is missing), refused (why a shared change
// wasn't saved, else "") }. currentShared: the shared file as read. While the sync folder is missing
// the machine's own keys still save; a change to a shared one is refused, never written elsewhere.
function settingsSave(file, paths, currentShared) {
  var parts = splitSettings(file, !!(paths && paths.syncDir))
  if (!parts.shared) return { machine: jsonText(parts.machine), shared: null, refused: "" }
  if (!paths.readOnly) return { machine: jsonText(parts.machine), shared: jsonText(parts.shared), refused: "" }
  var changed = canonical(parts.shared) !== canonical(isObject(currentShared) ? currentShared : {})
  return { machine: jsonText(parts.machine), shared: null, refused: changed ? problemText("sync-unavailable", paths) : "" }
}
if (typeof module !== "undefined") module.exports = {
  MARKER: MARKER, SYNCED: SYNCED, SETTING_SCOPES: SETTING_SCOPES, settingsFile: settingsFile, resolve: resolve, problemText: problemText,
  splitSettings: splitSettings, combineSettings: combineSettings, settingsSave: settingsSave
}
