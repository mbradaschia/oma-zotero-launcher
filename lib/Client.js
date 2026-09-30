// Pure helpers for Service.qml's bridge client. The HTTP itself (QML
// XMLHttpRequest + Timer deadlines) lives in Service.qml; everything here is
// plain data in/out so node can test it.

// Zotero drops requests whose User-Agent starts with "Mozilla/" (Qt's default)
// unless they carry this header (PLAN.md §2).
var ALLOWED_HEADER = "Zotero-Allowed-Request"

function baseUrl(bridge) {
  return "http://127.0.0.1:" + bridge.port + "/oma-zotero"
}

function headers(bridge) {
  return [
    [ALLOWED_HEADER, "1"],
    ["Authorization", "Bearer " + bridge.token],
    ["Content-Type", "application/json"]
  ]
}

// $XDG_RUNTIME_DIR/oma-zotero/bridge.json → { port, token, … } or null.
function parseHandshake(text) {
  var h
  try {
    h = JSON.parse(String(text || ""))
  } catch (e) {
    return null
  }
  if (!h || !/^[0-9a-f]{64}$/.test(String(h.token || "")) || !(Number(h.port) > 0)) return null
  return { port: Number(h.port), token: h.token, bridgeVersion: h.bridgeVersion || "", zoteroVersion: h.zoteroVersion || "" }
}

// One HTTP outcome → { kind: "ok", data } | { kind: "timeout" } | { kind: "zotero-down" }
// | { kind: "bridge-missing" } | { kind: "unauthorized" } | { kind: "error", status, code, message }.
function classify(status, text, timedOut) {
  if (timedOut) return { kind: "timeout" }
  if (status === 0) return { kind: "zotero-down" }
  var data = null
  try {
    data = JSON.parse(String(text || ""))
  } catch (e) {
    data = null
  }
  if (status === 200 && data && data.ok) return { kind: "ok", data: data }
  // Zotero answers unknown routes with a plain-text 404: the bridge isn't installed.
  if (status === 404 && !(data && data.error)) return { kind: "bridge-missing" }
  if (status === 401) return { kind: "unauthorized" }
  var err = data && data.error ? data.error : { code: "http-" + status, message: String(text || "").slice(0, 200) }
  return { kind: "error", status: status, code: String(err.code || ""), message: String(err.message || "") }
}

// Search coalescing: at most one request in flight; while it runs, only the
// newest query is kept. Queries may be "" (the open/recent view); null = none.
function newQueue() {
  return { inFlight: null, pending: null }
}

// Returns the query to send now, or null when it was queued behind a running one.
function enqueue(queue, query) {
  if (queue.inFlight !== null) {
    queue.pending = query
    return null
  }
  queue.inFlight = query
  return query
}

// Call when the in-flight request finished; returns the next query to send, or null.
function done(queue) {
  var next = queue.pending
  queue.pending = null
  queue.inFlight = next
  return next
}

// "org.gnome.Evince.desktop" → "Evince" (for "Open PDF externally · Evince …").
function appName(desktopId) {
  var id = String(desktopId || "").trim().replace(/\.desktop$/, "")
  if (!id) return ""
  var last = id.split(".").pop()
  return last.charAt(0).toUpperCase() + last.slice(1)
}

// argv for opening `path` externally: the user's PDF command for PDFs, else xdg-open.
function externalCommand(settings, contentType, path) {
  var custom = settings && Array.isArray(settings.externalPdfCommand) && settings.externalPdfCommand.length
    ? settings.externalPdfCommand.map(String) : null
  var cmd = contentType === "application/pdf" && custom ? custom : ["xdg-open"]
  return ["uwsm-app", "--"].concat(cmd, [String(path)])
}

// A paper's status from its tags ([{ tag }] or names): the first of `statuses` it carries (their
// spelling), else "".
function paperStatusOf(tags, statuses) {
  var have = {}
  ;(tags || []).forEach(function (t) { var n = String(t && t.tag !== undefined ? t.tag : t); have[n.toLowerCase()] = n })
  for (var i = 0; i < (statuses || []).length; i++) if (have[statuses[i].toLowerCase()]) return have[statuses[i].toLowerCase()] // as the paper spells it
  return ""
}

// Tab / Shift+Tab: none → the first status → … → the last → none.
function nextPaperStatus(statuses, current, delta) {
  var list = [""].concat(statuses || [])
  var i = -1
  for (var k = 0; k < list.length; k++) if (list[k].toLowerCase() === String(current || "").toLowerCase()) i = k
  if (i < 0) i = 0
  return list[(i + delta + list.length) % list.length]
}

// argv that starts Zotero: the zoteroCommand setting, else "zotero" on PATH.
function zoteroArgv(settings) {
  var cmd = settings && Array.isArray(settings.zoteroCommand) && settings.zoteroCommand.length ? settings.zoteroCommand.map(String) : ["zotero"]
  return ["uwsm-app", "--"].concat(cmd)
}

// argv for the prompt runner (daemon/bin/oma-zotero-prompt.mjs) with its arguments.
function promptArgv(settings, args) {
  var cmd = settings && Array.isArray(settings.promptCommand) && settings.promptCommand.length
    ? settings.promptCommand.map(String) : ["oma-zotero-prompt"]
  return cmd.concat(args.map(String))
}

// `oma-zotero-prompt list --json` output → [{ id, title, model, effort }] (null when unreadable).
function parsePromptList(text) {
  var j
  try {
    j = JSON.parse(String(text || ""))
  } catch (e) {
    return null
  }
  if (!j || !Array.isArray(j.prompts)) return null
  return j.prompts.filter(function (p) { return p && /^[a-z0-9][a-z0-9-]*$/.test(String(p.id || "")) }).map(function (p) {
    return { id: String(p.id), title: String(p.title || p.id), model: String(p.model || ""), effort: String(p.effort || ""), excerpt: String(p.excerpt || "") }
  })
}

// A note title → a safe file name (no slashes or control characters, not hidden, ≤ 120 chars).
function fileName(title) {
  var n = String(title || "").replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "")
  if (n.length > 120) n = n.slice(0, 120).trim()
  return n || "Untitled note"
}

// ~/.config/omarchy/oma-zotero-launcher.json → { settings, problems }. Every setting is
// optional; an invalid one falls back to its default and is reported (the overlay
// shows the first problem in its footer, the shell log all of them). The file has sections
// (general, providers, defaults: PLAN-providers.md §5.1); a flat file from before them is read
// as its general section. `settings` is flat for the general keys, plus `providers`,
// `endpoints`, `defaults` and `configured` (the file has a providers section).
var DEFAULT_SETTINGS = {
  enterAction: "reader",
  maxResults: 60,
  port: 23119,
  externalPdfCommand: null,
  accelerators: true,
  emptyQuery: null,
  promptCommand: null, // null → "oma-zotero-prompt" on PATH (make prompts-install)
  zoteroCommand: null, // null → "zotero" on PATH
  keys: "single", // "single": a key acts on its own once you leave the search box; "alt": Alt+key, typing always searches
  keyDelay: 300 // ms: two keys within this are typing (single-key mode)
}

var SECTIONS = ["general", "providers", "defaults", "tasks", "status", "rules"]
// A paper's reading status: the first of these tags it carries (Tab / Shift+Tab changes it).
var DEFAULT_PAPER_STATUSES = ["to read", "reading", "read"]
var TASK_GROUPS = ["backlog", "next", "active", "waiting", "completed"]
var PROVIDER_IDS = ["claude", "chatgpt", "openai", "anthropic", "google", "openrouter", "ollama"]
var EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"]

function isObject(x) {
  return !!x && typeof x === "object" && !Array.isArray(x)
}

// "default" or [provider:]model, as the runner accepts it (daemon/lib/modelspec.mjs).
function validModelSpec(m) {
  return m === "default" || /^([a-z][a-z0-9-]{0,30}:)?[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,160}(\[[0-9a-z]{1,8}\])?$/.test(String(m || ""))
}

function validEndpointId(id) {
  return /^[a-z][a-z0-9-]{1,30}$/.test(String(id || "")) && PROVIDER_IDS.indexOf(id) < 0 && id !== "default"
}

function normalizeProviders(raw, problems) {
  var out = {}
  for (var i = 0; i < PROVIDER_IDS.length; i++) out[PROVIDER_IDS[i]] = { enabled: false }
  var endpoints = []
  if (raw === undefined) return { providers: out, endpoints: endpoints }
  if (!isObject(raw)) {
    problems.push("providers must be an object")
    return { providers: out, endpoints: endpoints }
  }
  for (var id in raw) {
    var c = raw[id]
    if (id === "compatible") {
      if (!Array.isArray(c)) { problems.push("providers.compatible must be a list"); continue }
      var seen = {}
      c.forEach(function (e, n) {
        if (!isObject(e) || !validEndpointId(e.id) || seen[e.id]) return problems.push("providers.compatible[" + n + "] needs a new id (a-z, 0-9, -; not a provider's name)")
        if (typeof e.baseURL !== "string" || !/^https?:\/\/\S+$/.test(e.baseURL)) return problems.push("providers.compatible[" + n + "].baseURL must be an http(s) URL")
        seen[e.id] = true
        var ep = { id: e.id, name: typeof e.name === "string" && e.name.trim() ? e.name.trim() : e.id, baseURL: e.baseURL, enabled: e.enabled !== false }
        if (e.context !== undefined) {
          if (typeof e.context === "number" && e.context % 1 === 0 && e.context >= 1024) ep.context = e.context
          else problems.push("providers.compatible[" + n + "].context must be a whole number of tokens (1024 or more)")
        }
        endpoints.push(ep)
      })
      continue
    }
    if (PROVIDER_IDS.indexOf(id) < 0) { problems.push('unknown provider "' + id + '"'); continue }
    if (!isObject(c)) { problems.push("providers." + id + " must be an object"); continue }
    if (c.enabled !== undefined) {
      if (typeof c.enabled === "boolean") out[id].enabled = c.enabled
      else problems.push("providers." + id + ".enabled must be true or false")
    }
    if (c.baseURL !== undefined) {
      if (typeof c.baseURL === "string" && /^https?:\/\/\S+$/.test(c.baseURL)) out[id].baseURL = c.baseURL
      else problems.push("providers." + id + ".baseURL must be an http(s) URL")
    }
    if (c.context !== undefined) {
      if (typeof c.context === "number" && c.context % 1 === 0 && c.context >= 1024) out[id].context = c.context
      else problems.push("providers." + id + ".context must be a whole number of tokens (1024 or more)")
    }
  }
  return { providers: out, endpoints: endpoints }
}

// Settings › Rules: the rules turned on or off, { id: true|false } over each rule's default
// (daemon/lib/rules.json).
function normalizeRules(raw, problems) {
  var out = {}
  if (raw === undefined) return out
  if (!isObject(raw)) { problems.push("rules must be an object"); return out }
  for (var id in raw) {
    if (/^[a-z][a-z0-9-]{1,40}$/.test(id) && typeof raw[id] === "boolean") out[id] = raw[id]
    else problems.push("rules." + id + " must be true or false")
  }
  return out
}

// The tasks section: your statuses, each in one of the five groups. Invalid ones are dropped (and
// reported); none left means the defaults (lib/Todos.js).
function normalizeTasks(raw, problems) {
  if (raw === undefined) return null
  if (!isObject(raw)) { problems.push("tasks must be an object"); return null }
  if (raw.statuses === undefined) return null
  if (!Array.isArray(raw.statuses)) { problems.push("tasks.statuses must be a list"); return null }
  var seen = {}
  var out = []
  raw.statuses.forEach(function (s, n) {
    if (!isObject(s) || !/^[a-z0-9][a-z0-9_]{0,29}$/.test(String(s.id || "")) || seen[s.id]) return problems.push("tasks.statuses[" + n + "] needs a new id (a-z, 0-9, _)")
    if (TASK_GROUPS.indexOf(s.group) < 0) return problems.push("tasks.statuses[" + n + "].group must be one of " + TASK_GROUPS.join(", "))
    seen[s.id] = true
    out.push({ id: s.id, name: typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 40) : s.id, group: s.group })
  })
  return out.length ? { statuses: out } : null
}

// The status section: { tags: [...] }, your paper statuses (Zotero tags), in order.
function normalizeStatus(raw, problems) {
  if (raw === undefined) return DEFAULT_PAPER_STATUSES.slice()
  if (!isObject(raw) || !Array.isArray(raw.tags)) { problems.push("status.tags must be a list of tag names"); return DEFAULT_PAPER_STATUSES.slice() }
  var seen = {}
  var out = []
  raw.tags.forEach(function (t, n) {
    var name = typeof t === "string" ? t.trim() : ""
    if (!name || name.length > 255 || /[\r\n]/.test(name)) return problems.push("status.tags[" + n + "] must be a tag name")
    if (seen[name.toLowerCase()]) return
    seen[name.toLowerCase()] = true
    out.push(name)
  })
  return out
}

function normalizeDefaults(raw, problems) {
  var out = { prompts: { model: "", effort: "high" }, chat: { model: "", effort: "high" }, fallback: "", autoExtract: false }
  if (raw === undefined) return out
  if (!isObject(raw)) { problems.push("defaults must be an object"); return out }
  ;["prompts", "chat"].forEach(function (p) {
    var d = raw[p]
    if (d === undefined) return
    if (!isObject(d)) return problems.push("defaults." + p + " must be an object")
    if (d.model !== undefined) {
      if (d.model === "" || (validModelSpec(d.model) && d.model !== "default")) out[p].model = d.model
      else problems.push("defaults." + p + ".model must be a model, e.g. \"openai:gpt-5.5\"")
    }
    if (d.effort !== undefined) {
      if (d.effort === "" || EFFORT_LEVELS.indexOf(d.effort) >= 0) out[p].effort = d.effort
      else problems.push("defaults." + p + ".effort must be low, medium, high, xhigh, max or \"\"")
    }
  })
  if (raw.autoExtract !== undefined) {
    if (typeof raw.autoExtract === "boolean") out.autoExtract = raw.autoExtract
    else problems.push("defaults.autoExtract must be true or false")
  }
  if (raw.fallback !== undefined && raw.fallback !== null) {
    if (raw.fallback === "" || (validModelSpec(raw.fallback) && raw.fallback !== "default")) out.fallback = raw.fallback
    else problems.push("defaults.fallback must be a model or null")
  }
  return out
}

function normalizeSettings(file) {
  var problems = []
  var out = {}
  for (var k in DEFAULT_SETTINGS) out[k] = DEFAULT_SETTINGS[k]
  out.providers = normalizeProviders(undefined, problems).providers
  out.providers.claude.enabled = true // no providers section: Claude, as before sections
  out.endpoints = []
  out.defaults = normalizeDefaults(undefined, problems)
  out.rules = {}
  out.tasks = null
  out.paperStatuses = DEFAULT_PAPER_STATUSES.slice()
  out.configured = false
  if (file === null || file === undefined) return { settings: out, problems: problems }
  if (typeof file !== "object" || Array.isArray(file)) return { settings: out, problems: ["the file must hold a JSON object"] }
  var sectioned = SECTIONS.some(function (s) { return Object.prototype.hasOwnProperty.call(file, s) })
  // The general keys: the general section, over any flat keys left from before sections.
  var raw = {}
  for (var fk in file) if (SECTIONS.indexOf(fk) < 0) raw[fk] = file[fk]
  if (sectioned && file.general !== undefined) {
    if (isObject(file.general)) for (var gk in file.general) raw[gk] = file.general[gk]
    else problems.push("general must be an object")
  }
  if (Object.prototype.hasOwnProperty.call(file, "providers")) {
    var np = normalizeProviders(file.providers, problems)
    out.providers = np.providers
    out.endpoints = np.endpoints
    out.configured = true
  }
  out.defaults = normalizeDefaults(file.defaults, problems)
  out.rules = normalizeRules(file.rules, problems)
  out.tasks = normalizeTasks(file.tasks, problems)
  out.paperStatuses = normalizeStatus(file.status, problems)
  var has = function (key) { return Object.prototype.hasOwnProperty.call(raw, key) }
  if (has("enterAction")) {
    if (raw.enterAction === "reader" || raw.enterAction === "select") out.enterAction = raw.enterAction
    else problems.push('enterAction must be "reader" or "select"')
  }
  if (has("maxResults")) {
    var n = Number(raw.maxResults)
    if (typeof raw.maxResults === "number" && n >= 10 && n <= 200) out.maxResults = Math.round(n)
    else problems.push("maxResults must be a number from 10 to 200")
  }
  if (has("port")) {
    if (typeof raw.port === "number" && raw.port % 1 === 0 && raw.port > 0 && raw.port < 65536) out.port = raw.port
    else problems.push("port must be a TCP port number")
  }
  if (has("externalPdfCommand")) {
    var cmd = raw.externalPdfCommand
    if (Array.isArray(cmd) && cmd.length && cmd.every(function (x) { return typeof x === "string" && x.length > 0 })) out.externalPdfCommand = cmd.slice()
    else problems.push('externalPdfCommand must be a list of strings, e.g. ["zathura"]')
  }
  if (has("promptCommand")) {
    var pc = raw.promptCommand
    if (Array.isArray(pc) && pc.length && pc.every(function (x) { return typeof x === "string" && x.length > 0 })) out.promptCommand = pc.slice()
    else problems.push('promptCommand must be a list of strings, e.g. ["node", "/path/to/oma-zotero-prompt.mjs"]')
  }
  if (has("zoteroCommand")) {
    var zc = raw.zoteroCommand
    if (Array.isArray(zc) && zc.length && zc.every(function (x) { return typeof x === "string" && x.length > 0 })) out.zoteroCommand = zc.slice()
    else problems.push('zoteroCommand must be a list of strings, e.g. ["flatpak", "run", "org.zotero.Zotero"]')
  }
  if (has("keys")) {
    if (raw.keys === "single" || raw.keys === "alt") out.keys = raw.keys
    else problems.push('keys must be "single" or "alt"')
  }
  if (has("keyDelay")) {
    if (typeof raw.keyDelay === "number" && raw.keyDelay % 1 === 0 && raw.keyDelay >= 100 && raw.keyDelay <= 1000) out.keyDelay = raw.keyDelay
    else problems.push("keyDelay must be a whole number of milliseconds from 100 to 1000")
  }
  if (has("accelerators")) {
    if (typeof raw.accelerators === "boolean") out.accelerators = raw.accelerators
    else problems.push("accelerators must be true or false")
  }
  if (has("emptyQuery")) {
    var eq = raw.emptyQuery
    if (!eq || typeof eq !== "object" || Array.isArray(eq)) {
      problems.push("emptyQuery must be an object")
    } else {
      var e = {}
      if (eq.showOpen !== undefined) {
        if (typeof eq.showOpen === "boolean") e.showOpen = eq.showOpen
        else problems.push("emptyQuery.showOpen must be true or false")
      }
      if (eq.tabOrder !== undefined) {
        if (eq.tabOrder === "mru" || eq.tabOrder === "tabbar") e.tabOrder = eq.tabOrder
        else problems.push('emptyQuery.tabOrder must be "mru" or "tabbar"')
      }
      if (eq.recent !== undefined) {
        if (["latest", "added", "modified", "none"].indexOf(eq.recent) >= 0) e.recent = eq.recent
        else problems.push('emptyQuery.recent must be "latest", "added", "modified" or "none"')
      }
      if (eq.recentLimit !== undefined) {
        if (typeof eq.recentLimit === "number" && eq.recentLimit % 1 === 0 && eq.recentLimit >= 0 && eq.recentLimit <= 50) e.recentLimit = eq.recentLimit
        else problems.push("emptyQuery.recentLimit must be a whole number from 0 to 50")
      }
      for (var ek in eq) if (["showOpen", "tabOrder", "recent", "recentLimit"].indexOf(ek) < 0) problems.push('unknown setting "emptyQuery.' + ek + '"')
      out.emptyQuery = e
    }
  }
  for (var key in raw) if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) problems.push('unknown setting "' + key + '"')
  return { settings: out, problems: problems }
}

if (typeof module !== "undefined") {
  module.exports = {
    ALLOWED_HEADER: ALLOWED_HEADER, baseUrl: baseUrl, headers: headers, parseHandshake: parseHandshake, classify: classify,
    newQueue: newQueue, enqueue: enqueue, done: done, appName: appName, externalCommand: externalCommand,
    promptArgv: promptArgv, zoteroArgv: zoteroArgv, parsePromptList: parsePromptList, fileName: fileName,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS, normalizeSettings: normalizeSettings, validModelSpec: validModelSpec, validEndpointId: validEndpointId,
    PROVIDER_IDS: PROVIDER_IDS, EFFORT_LEVELS: EFFORT_LEVELS, DEFAULT_PAPER_STATUSES: DEFAULT_PAPER_STATUSES, nextPaperStatus: nextPaperStatus, paperStatusOf: paperStatusOf
  }
}
