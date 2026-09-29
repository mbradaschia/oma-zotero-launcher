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
    return { id: String(p.id), title: String(p.title || p.id), model: String(p.model || ""), effort: String(p.effort || "") }
  })
}

// ~/.config/omarchy/oma-zotero-launcher.json → { settings, problems }. Every setting is
// optional; an invalid one falls back to its default and is reported (the overlay
// shows the first problem in its footer, the shell log all of them).
var DEFAULT_SETTINGS = {
  enterAction: "reader",
  maxResults: 60,
  port: 23119,
  externalPdfCommand: null,
  accelerators: true,
  emptyQuery: null,
  promptCommand: null // null → "oma-zotero-prompt" on PATH (make prompts-install)
}

function normalizeSettings(raw) {
  var problems = []
  var out = {}
  for (var k in DEFAULT_SETTINGS) out[k] = DEFAULT_SETTINGS[k]
  if (raw === null || raw === undefined) return { settings: out, problems: problems }
  if (typeof raw !== "object" || Array.isArray(raw)) return { settings: out, problems: ["the file must hold a JSON object"] }
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
        if (eq.recent === "added" || eq.recent === "modified" || eq.recent === "none") e.recent = eq.recent
        else problems.push('emptyQuery.recent must be "added", "modified" or "none"')
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
    promptArgv: promptArgv, parsePromptList: parsePromptList,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS, normalizeSettings: normalizeSettings
  }
}
