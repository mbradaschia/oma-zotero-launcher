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

// Keys that reach an object's prototype: never copied, never looked up. JSON.parse keeps a
// "__proto__" key as a plain property, so a settings file (the shared one comes from a synced
// folder) can hold one.
function unsafeKey(k) {
  return k === "__proto__" || k === "constructor" || k === "prototype"
}

// An object's own keys, the unsafe ones left out.
function keysOf(o) {
  return isObject(o) ? Object.keys(o).filter(function (k) { return !unsafeKey(k) }) : []
}

function clone(x) {
  return x === undefined ? undefined : JSON.parse(JSON.stringify(x), function (k, v) { return unsafeKey(k) ? undefined : v })
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

// A provider's address stays on the machine, never in the synced folder: the API keys, kept on each
// machine, go where it says. The compatible endpoints (an address each) stay too; on/off and the
// context size travel.
var MACHINE_PROVIDER_FIELDS = ["baseURL"]

function splitProviders(p) {
  var machine = {}
  var shared = {}
  keysOf(p).forEach(function (id) {
    if (id === "compatible") {
      machine.compatible = clone(p.compatible)
      return
    }
    if (!isObject(p[id])) {
      shared[id] = clone(p[id])
      return
    }
    var m = {}
    var sh = {}
    keysOf(p[id]).forEach(function (k) { (MACHINE_PROVIDER_FIELDS.indexOf(k) >= 0 ? m : sh)[k] = clone(p[id][k]) })
    if (Object.keys(m).length) machine[id] = m
    if (Object.keys(sh).length || !Object.keys(m).length) shared[id] = sh
  })
  return { machine: machine, shared: shared }
}

// The machine's providers, then what the shared file says of each, its addresses and endpoints left out.
function combineProviders(machineProviders, sharedProviders) {
  var out = clone(isObject(machineProviders) ? machineProviders : {})
  keysOf(sharedProviders).forEach(function (id) {
    if (id === "compatible" || !isObject(sharedProviders[id])) return
    var into = Object.prototype.hasOwnProperty.call(out, id) && isObject(out[id]) ? out[id] : {}
    keysOf(sharedProviders[id]).forEach(function (k) { if (MACHINE_PROVIDER_FIELDS.indexOf(k) < 0) into[k] = clone(sharedProviders[id][k]) })
    out[id] = into
  })
  return out
}

function scopeOf(section, key) {
  var name = key === undefined ? section : section + "." + key
  return Object.prototype.hasOwnProperty.call(SETTING_SCOPES, name) ? SETTING_SCOPES[name] : "machine"
}

// The settings file (today's shape) → { machine, shared }; sync off: all of it on the machine.
function splitSettings(file, syncOn) {
  var f = clone(isObject(file) ? file : {})
  if (!syncOn) return { machine: f, shared: null }
  var machine = {}
  var shared = {}
  keysOf(f).forEach(function (sec) {
    if (sec === "general" && isObject(f.general)) {
      var mg = {}
      var sg = {}
      keysOf(f.general).forEach(function (k) { (scopeOf("general", k) === "shared" ? sg : mg)[k] = f.general[k] })
      if (Object.keys(mg).length) machine.general = mg
      if (Object.keys(sg).length) shared.general = sg
    } else if (sec === "providers" && isObject(f.providers)) {
      var sp = splitProviders(f.providers)
      if (Object.keys(sp.machine).length) machine.providers = sp.machine
      if (Object.keys(sp.shared).length) shared.providers = sp.shared
    } else if (scopeOf(sec) === "shared") shared[sec] = f[sec]
    else machine[sec] = f[sec]
  })
  return { machine: machine, shared: shared }
}

// The two files → one in today's shape: the shared file wins the shared keys; where it lacks
// one, the machine file's value stays. No shared file: the machine file as it is.
function combineSettings(machineRaw, sharedRaw) {
  var out = clone(isObject(machineRaw) ? machineRaw : {})
  if (!isObject(sharedRaw)) return out
  keysOf(sharedRaw).forEach(function (sec) {
    if (sec === "general" && isObject(sharedRaw.general)) {
      if (!isObject(out.general)) out.general = {}
      keysOf(sharedRaw.general).forEach(function (k) { if (scopeOf("general", k) === "shared") out.general[k] = clone(sharedRaw.general[k]) })
    } else if (sec === "providers") {
      if (isObject(sharedRaw.providers)) out.providers = combineProviders(out.providers, sharedRaw.providers)
    } else if (scopeOf(sec) === "shared") out[sec] = clone(sharedRaw[sec])
  })
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

// What a shared file holds that this version doesn't know (a newer launcher's, the macOS app's):
// kept when this version rewrites the file. Known keys, shared or machine, are left out.
function unknownShared(shared) {
  var out = {}
  keysOf(shared).forEach(function (sec) {
    if (sec === "general") {
      keysOf(shared.general).forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(SETTING_SCOPES, "general." + k)) (out.general = out.general || {})[k] = clone(shared.general[k])
      })
    } else if (!Object.prototype.hasOwnProperty.call(SETTING_SCOPES, sec)) out[sec] = clone(shared[sec])
  })
  return out
}

// What saving the settings file (today's shape) writes: { machine (the machine file's text), shared
// (the shared file's, or null: not syncing, or the folder is missing), refused (why a shared change
// wasn't saved, else "") }. currentShared: the shared file as read (what this version doesn't know in
// it is kept). beforeFile: the settings file before the edit, in the same shape (Settings.toFile):
// while the sync folder is missing, the machine's own keys still save, and an edit that changes a
// shared one is refused, never written elsewhere.
function settingsSave(file, paths, currentShared, beforeFile) {
  var parts = splitSettings(file, !!(paths && paths.syncDir))
  if (!parts.shared) return { machine: jsonText(parts.machine), shared: null, refused: "" }
  if (!paths.readOnly) {
    var shared = unknownShared(currentShared)
    keysOf(parts.shared).forEach(function (sec) {
      shared[sec] = sec === "general" ? Object.assign(shared.general || {}, parts.shared.general) : parts.shared[sec]
    })
    return { machine: jsonText(parts.machine), shared: jsonText(shared), refused: "" }
  }
  var was = beforeFile !== undefined && beforeFile !== null ? splitSettings(beforeFile, true).shared : (isObject(currentShared) ? currentShared : {})
  var changed = canonical(parts.shared) !== canonical(was)
  return { machine: jsonText(parts.machine), shared: null, refused: changed ? problemText("sync-unavailable", paths) : "" }
}

// ------------------------------------------------------------ turning sync on and off

function withSyncDir(file, dir) {
  var f = clone(isObject(file) ? file : {})
  delete f.syncDir
  if (!isObject(f.general)) f.general = {}
  if (dir) f.general.syncDir = dir
  else delete f.general.syncDir
  if (!Object.keys(f.general).length) delete f.general
  return f
}

// Every path syncPlan may look at, for the caller to probe first (each: does it exist).
function probePaths(env, settings, nextSyncDir) {
  var local = resolve(env, withSyncDir(settings, null), { syncMarker: true })
  var before = resolve(env, settings, { syncMarker: true })
  var after = resolve(env, withSyncDir(settings, nextSyncDir), { syncMarker: true })
  var out = [local.settings]
  SYNCED.forEach(function (k) { out.push(local[k], before[k], after[k]) })
  if (after.marker) out.push(after.marker, after.stignore, after.sharedSettings)
  return out.filter(function (p, i) { return out.indexOf(p) === i })
}

// The steps that turn the sync folder on (fill: the first machine; join: the folder already has
// data, yours goes to a backup) or off (leave: the folder's files come back here). settings: the
// combined settings file (combineSettings); probe: { exists: { path: bool }, date: "YYYY-MM-DD-HHMMSS",
// now: ISO date }. The machine settings file, which carries syncDir, is always written last.
function syncPlan(env, settings, nextSyncDir, probe) {
  var p = probe || {}
  var exists = p.exists || {}
  var target = withSyncDir(settings, nextSyncDir)
  var local = resolve(env, withSyncDir(settings, null), { syncMarker: true })
  var before = resolve(env, settings, { syncMarker: true })
  var after = resolve(env, target, { syncMarker: true })
  if (after.problems.length) return { kind: "invalid", ops: [], message: problemText(after.problems[0], after) }
  if (before.syncDir === after.syncDir) return { kind: "none", ops: [] }
  if (before.syncDir && after.syncDir) return { kind: "refused", ops: [], message: "Clear the sync folder first, then set the new one" }
  var backup = join(local.backups, p.date)
  var synced = after.syncDir ? after : before
  var moving = SYNCED.filter(function (k) { return local[k] !== synced[k] })
  var ops = []
  if (!after.syncDir) {
    ops.push({ op: "mkdir", to: backup })
    // Only what the folder has a copy of is replaced: with the folder gone, your files stay as they are.
    moving.forEach(function (k) {
      if (!exists[before[k]]) return
      if (exists[local[k]]) ops.push({ op: "move", from: local[k], to: join(backup, baseName(local[k])) })
      ops.push({ op: "copy", from: before[k], to: local[k] })
    })
    ops.push({ op: "write", to: local.settings, text: jsonText(target) })
    return { kind: "leave", ops: ops }
  }
  var parts = splitSettings(target, true)
  if (exists[after.marker]) {
    ops.push({ op: "mkdir", to: backup })
    moving.forEach(function (k) {
      if (exists[local[k]]) ops.push({ op: "move", from: local[k], to: join(backup, baseName(local[k])) })
    })
    if (exists[local.settings]) ops.push({ op: "copy", from: local.settings, to: join(backup, baseName(local.settings)) })
    ops.push({ op: "write", to: local.settings, text: jsonText(parts.machine) })
    return { kind: "join", ops: ops }
  }
  // Data but no marker: the other machine filled it, and Syncthing hasn't brought the marker yet
  // (it copies in no set order). Filling now would write over that data.
  var arrived = [after.sharedSettings].concat(moving.map(function (k) { return after[k] })).some(function (p) { return exists[p] })
  if (arrived) return { kind: "refused", ops: [], message: "The sync folder has launcher data but no marker yet: let Syncthing finish, then set it again" }
  ops.push({ op: "mkdir", to: join(after.syncDir, "shared") })
  moving.forEach(function (k) {
    if (exists[local[k]]) ops.push({ op: "copy", from: local[k], to: after[k] })
  })
  ops.push({ op: "write", to: after.sharedSettings, text: jsonText(parts.shared) })
  if (!exists[after.stignore]) ops.push({ op: "write", to: after.stignore, text: STIGNORE })
  ops.push({ op: "write", to: after.marker, text: jsonText({ version: 1, created: p.now, by: after.machine }) })
  ops.push({ op: "write", to: local.settings, text: jsonText(parts.machine) })
  return { kind: "fill", ops: ops }
}

// A plan's steps as the arguments of scripts/sync-apply.sh.
function opsArgv(ops) {
  var out = []
  ;(ops || []).forEach(function (o) {
    if (o.op === "mkdir") out.push("mkdir", o.to)
    else if (o.op === "write") out.push("write", o.to, o.text)
    else out.push(o.op, o.from, o.to)
  })
  return out
}

if (typeof module !== "undefined") module.exports = {
  MARKER: MARKER, SYNCED: SYNCED, SETTING_SCOPES: SETTING_SCOPES, settingsFile: settingsFile, resolve: resolve, problemText: problemText,
  splitSettings: splitSettings, combineSettings: combineSettings, settingsSave: settingsSave, probePaths: probePaths, syncPlan: syncPlan, opsArgv: opsArgv
}
