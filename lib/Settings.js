// The Settings view (PLAN-providers.md §5): the settings file in sections, and the rows of each
// Settings page. Schema-driven: a General setting is one entry in GENERAL; the provider pages
// read what the runner reports (`oma-zotero-prompt providers`). Pure (node-tested); the rows are
// built with the list-row function the launcher passes in (Views.listRow).

// ---------------------------------------------------------------- the file

// Normalized settings (Client.normalizeSettings) → the file's sections. General keys at their
// default are left out, so the file stays short; a flat file from before sections moves into
// "general" the first time Settings saves.
var GENERAL_DEFAULTS = { artifactsDir: null, enterAction: "reader", maxResults: 60, port: 23119, externalPdfCommand: null, accelerators: true, emptyQuery: null, promptCommand: null, zoteroCommand: null, keys: "single", keyDelay: 300 }

function clone(x) {
  return x === undefined ? undefined : JSON.parse(JSON.stringify(x))
}

function toFile(settings) {
  var general = {}
  for (var k in GENERAL_DEFAULTS) {
    var v = settings[k]
    if (v === undefined || v === null) continue
    if (k === "emptyQuery" && (!v || !Object.keys(v).length)) continue
    if (JSON.stringify(v) !== JSON.stringify(GENERAL_DEFAULTS[k])) general[k] = clone(v)
  }
  var providers = {}
  var p = settings.providers || {}
  for (var id in p) {
    var c = p[id]
    var o = { enabled: !!c.enabled }
    if (c.baseURL) o.baseURL = c.baseURL
    if (c.context) o.context = c.context
    providers[id] = o
  }
  if ((settings.endpoints || []).length) providers.compatible = clone(settings.endpoints)
  var d = settings.defaults || {}
  var defaults = {}
  ;["prompts", "chat"].forEach(function (x) {
    if (d[x] && (d[x].model || d[x].effort !== "high")) defaults[x] = { model: d[x].model || "", effort: d[x].effort }
  })
  if (d.fallback) defaults.fallback = d.fallback
  if (d.autoExtract) defaults.autoExtract = true
  var out = { general: general, providers: providers, defaults: defaults }
  if (settings.tasks && settings.tasks.statuses && settings.tasks.statuses.length) out.tasks = { statuses: clone(settings.tasks.statuses) }
  if (settings.paperStatuses && JSON.stringify(settings.paperStatuses) !== JSON.stringify(["to read", "reading", "read"])) out.status = { tags: clone(settings.paperStatuses) }
  if (settings.rules && Object.keys(settings.rules).length) out.rules = clone(settings.rules)
  return out
}

// ---------------------------------------------------------------- rules

// A rule is on: the settings say so, else its default. `rule`: one of rules.json's.
function ruleOn(settings, rule) {
  var o = (settings && settings.rules) || {}
  return typeof o[rule.id] === "boolean" ? o[rule.id] : rule.on !== false
}

// Settings with one rule flipped; a rule back at its default leaves the file.
function withRuleToggled(settings, rule) {
  var on = !ruleOn(settings, rule)
  var out = clone(settings)
  out.rules = out.rules || {}
  if (on === (rule.on !== false)) delete out.rules[rule.id]
  else out.rules[rule.id] = on
  return out
}

function ruleWhere(rule) {
  var w = [rule.prompt || rule.text ? "prompts" : "", rule.chat || rule.text ? "chat" : "", rule.artifact || rule.text ? "artifacts" : ""].filter(function (x) { return x })
  var t = w.length > 1 ? w.slice(0, -1).join(", ") + " and " + w[w.length - 1] : w[0] || ""
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// A copy of `file` with `path` ("general.maxResults", "providers.ollama.enabled") set;
// undefined deletes it.
function setPath(file, path, value) {
  var out = clone(file)
  var keys = path.split(".")
  var o = out
  for (var i = 0; i < keys.length - 1; i++) {
    if (!o[keys[i]] || typeof o[keys[i]] !== "object") o[keys[i]] = {}
    o = o[keys[i]]
  }
  if (value === undefined) delete o[keys[keys.length - 1]]
  else o[keys[keys.length - 1]] = value
  return out
}

// A copy of normalized settings with one setting changed. `path`: "general.maxResults",
// "general.emptyQuery.recent", "providers.ollama.enabled", "endpoint.lab.baseURL",
// "defaults.chat.model"; undefined removes the value (back to its default).
function withValue(settings, path, value) {
  var out = clone(settings)
  var k = path.split(".")
  var o
  if (k[0] === "endpoint") {
    o = (out.endpoints || []).filter(function (e) { return e.id === k[1] })[0]
    if (!o) return out
    k = k.slice(2)
  } else {
    o = out
    if (k[0] === "general") k = k.slice(1)
  }
  for (var i = 0; i < k.length - 1; i++) {
    if (!o[k[i]] || typeof o[k[i]] !== "object") o[k[i]] = {}
    o = o[k[i]]
  }
  if (value === undefined) delete o[k[k.length - 1]]
  else o[k[k.length - 1]] = value
  return out
}

// A new OpenAI-compatible endpoint (its id from the name, unique) → { settings, id }.
function addEndpoint(settings, name, baseURL) {
  var out = clone(settings)
  out.endpoints = out.endpoints || []
  var base = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24)
  if (!/^[a-z]/.test(base)) base = "endpoint" + (base ? "-" + base : "")
  if (base.length < 2) base = "endpoint"
  var taken = function (id) { return ["claude", "chatgpt", "openai", "anthropic", "google", "openrouter", "ollama", "default"].indexOf(id) >= 0 || out.endpoints.some(function (e) { return e.id === id }) }
  var id = base
  for (var n = 2; taken(id); n++) id = base + "-" + n
  out.endpoints.push({ id: id, name: String(name || id).trim() || id, baseURL: baseURL, enabled: true })
  return { settings: out, id: id }
}

function removeEndpoint(settings, id) {
  var out = clone(settings)
  out.endpoints = (out.endpoints || []).filter(function (e) { return e.id !== id })
  return out
}

function getPath(settings, path) {
  var o = settings
  var keys = path.split(".")
  for (var i = 0; i < keys.length; i++) {
    if (o === null || o === undefined) return undefined
    o = o[keys[i]]
  }
  return o
}

// ---------------------------------------------------------------- General

// Grouped in sections, in the order the General page shows them.
var GENERAL = [
  { section: "Keys", key: "keys", label: "How keys act", type: "choice", def: "single",
    options: [["single", "One key, once you leave the search box (Esc); / or Tab goes back to it"], ["alt", "Alt+key; typing always searches"]] },
  { section: "Keys", key: "keyDelay", label: "Typing or a key", type: "number", min: 100, max: 1000, def: 300,
    help: "ms: keys closer than this are typing, and go to the search box (100 to 1000)" },
  { section: "Keys", key: "accelerators", label: "Keys on the results", type: "toggle", def: true, help: "o, w, n, #, p, l act on the highlighted paper" },
  { section: "Search", key: "maxResults", label: "Results per search", type: "number", min: 10, max: 200, def: 60, help: "10 to 200" },
  { section: "Before you type", key: "emptyQuery.showOpen", label: "Papers open in Zotero", type: "toggle", def: true, help: "Listed first, under Open in Zotero" },
  { section: "Before you type", key: "emptyQuery.tabOrder", label: "Open papers, listed by", type: "choice", def: "mru",
    options: [["mru", "The one you used last first"], ["tabbar", "The order of Zotero's tabs"]] },
  { section: "Before you type", key: "emptyQuery.recent", label: "Recent papers", type: "choice", def: "latest",
    options: [["latest", "Newest added or changed"], ["added", "Newest added"], ["modified", "Newest changed"], ["none", "None"]] },
  { section: "Before you type", key: "emptyQuery.recentLimit", label: "How many recent papers", type: "number", min: 0, max: 50, def: 15, help: "0 to 50" },
  { section: "Opening papers", key: "enterAction", label: "Shift+Enter or z on a paper", type: "choice", def: "reader",
    options: [["reader", "Opens it in Zotero, with its PDF in the reader"], ["select", "Selects it in your Zotero library"]] },
  { section: "Opening papers", key: "externalPdfCommand", label: "PDF app", type: "argv", def: null, help: "For o: a command such as zathura; empty: your default PDF app" },
  { section: "Artifacts", key: "artifactsDir", label: "Artifacts folder", type: "path", def: null, defText: "~/.local/state/oma-zotero/artifacts",
    help: "Diagrams, mind maps, images, pages and documents, a folder per paper; empty: the default" },
  { section: "Advanced", key: "zoteroCommand", label: "Zotero command", type: "argv", def: null, defText: "zotero",
    help: "How the launcher starts Zotero: a path such as /opt/zotero/zotero, or flatpak run org.zotero.Zotero" },
  { section: "Advanced", key: "port", label: "Zotero's HTTP port", type: "number", min: 1, max: 65535, def: 23119, help: "Only if you changed it in Zotero" },
  { section: "Advanced", key: "promptCommand", label: "Prompt runner command", type: "argv", def: null,
    help: "How to start the AI features' runner, only if oma-zotero-prompt isn't on your PATH" }
]

function generalItem(key) {
  for (var i = 0; i < GENERAL.length; i++) if (GENERAL[i].key === key) return GENERAL[i]
  return null
}

function valueText(item, v) {
  if (v === undefined || v === null || v === "") v = item.def
  if (item.type === "toggle") return v ? "On" : "Off"
  if (item.type === "choice") {
    for (var i = 0; i < item.options.length; i++) if (item.options[i][0] === v) return item.options[i][1]
    return String(v)
  }
  if (item.type === "argv") return Array.isArray(v) && v.length ? v.join(" ") : item.defText ? item.defText + " (default)" : "Default"
  if (item.type === "path") return v ? String(v) : item.defText + " (default)"
  return String(v)
}

// Text typed in the header → the value to save, or { error }.
function parseValue(item, text) {
  var t = String(text || "").trim()
  if (item.type === "number") {
    if (!/^\d+$/.test(t)) return { error: item.label + ": a whole number" + (item.help ? " (" + item.help + ")" : "") }
    var n = Number(t)
    if (n < item.min || n > item.max) return { error: item.label + ": " + item.min + " to " + item.max }
    return { value: n }
  }
  if (item.type === "argv") return { value: t ? t.split(/\s+/) : undefined }
  if (item.type === "path") {
    if (!t) return { value: undefined }
    if (!/^(\/|~\/)\S/.test(t)) return { error: "A folder: a path starting with / or ~/" }
    return { value: t.replace(/\/+$/, "") }
  }
  if (item.type === "url") {
    if (!/^https?:\/\/\S+$/.test(t)) return { error: "A URL starting with http:// or https://" }
    return { value: t.replace(/\/$/, "") }
  }
  if (item.type === "context") {
    if (!t) return { value: undefined }
    if (!/^\d+k?$/i.test(t)) return { error: "A number of tokens, e.g. 32768 or 32k" }
    var c = /k$/i.test(t) ? Number(t.slice(0, -1)) * 1024 : Number(t)
    if (c < 1024) return { error: "At least 1024 tokens" }
    return { value: c }
  }
  if (!t) return { error: "Type a value" }
  return { value: t }
}

// ---------------------------------------------------------------- icons

var ICON = {
  settings: "", general: "", providers: "", defaults: "", back: "",
  on: "", off: "", key: "", link: "", test: "", info: "",
  ok: "", warn: "", add: "", trash: "", install: "", node: "",
  pdf: "", url: "", model: "", lock: "", cloud: "", home: "", card: "", gift: "", rules: "\uf0e3"
}

// ---------------------------------------------------------------- the pages

// state: { settings, info (the runner's providers report, or null while it loads), runner
// ({ installed, problem, installing }), reqs ({ node, pdftotext, keyring }), models (the flat
// list from `models`), defaults (resolved { prompts, chat }), rules (rules.json's list), instructions
// (the user's own, "" when none), tests ({ id: { ok, detail, running, models } }),
// open (the dropdown showing its options: a setting's path) }

function providerInfo(state, id) {
  var list = (state.info && state.info.providers) || []
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]
  return null
}

function enabledNames(state) {
  var list = (state.info && state.info.providers) || []
  return list.filter(function (p) { return p.enabled }).map(function (p) { return p.name })
}

// Nothing works yet: no provider is on (the launcher then offers "Set up an AI model").
function needsSetup(state) {
  if (!state.runner || !state.runner.installed) return true
  if (!state.info) return false
  return !state.info.providers.some(function (p) { return p.enabled })
}

function buildRoot(state, row) {
  var rows = []
  var s = state.settings
  var sec = "Settings"
  var on = enabledNames(state)
  rows.push(row({ section: sec, rowId: "set-nav", value: "providers", icon: ICON.providers, label: "Models & providers", submenu: true, available: true,
    detail: !state.runner.installed ? "Install the AI features first (below)" : !state.info ? "…" : on.length ? on.join(", ") + (on.length === 1 ? " is on" : " are on") : "Nothing set up yet: choose how to run prompts and chat" }))
  rows.push(row({ section: sec, rowId: "set-nav", value: "defaults", icon: ICON.defaults, label: "Defaults", submenu: true, available: true,
    detail: "Prompts: " + (state.defaults.prompts || "none") + " · Chat: " + (state.defaults.chat || "none") }))
  var rules = state.rules || []
  var nOn = rules.filter(function (r) { return ruleOn(s, r) }).length
  rows.push(row({ section: sec, rowId: "set-nav", value: "rules", icon: ICON.rules, label: "Rules for prompts and chat", submenu: true, available: true,
    detail: (rules.length ? nOn + " of " + rules.length + " rules on" : "…") + " · " + (state.instructions ? "your own instructions too" : "no instructions of your own") }))
  var ps = s.paperStatuses || []
  rows.push(row({ section: sec, rowId: "set-nav", value: "paper-status", icon: "\uf02b", label: "Paper status", submenu: true, available: true,
    detail: (ps.length ? ps.join(", ") : "None") + " · the tags Tab / Shift+Tab cycles on a paper" }))
  var sts = s.tasks && s.tasks.statuses ? s.tasks.statuses.length : 7
  rows.push(row({ section: sec, rowId: "set-nav", value: "tasks", icon: "\uf0ae", label: "Tasks", submenu: true, available: true,
    detail: sts + " statuses in Backlog, Next, Active, Waiting and Completed: add, rename, remove, reorder" }))
  rows.push(row({ section: sec, rowId: "set-nav", value: "general", icon: ICON.general, label: "General", submenu: true, available: true,
    detail: (s.keys === "alt" ? "Alt+key" : "One-key actions") + " · results " + s.maxResults + " · before you type, recent and open papers" }))
  setupItems(state).forEach(function (it) {
    rows.push(row({ section: "Setup", rowId: it.rowId || "set-setup", value: it.action, icon: it.icon, label: it.label, detail: it.detail,
      available: !!it.action, badge: it.ok ? "" : it.badge || "", submenu: it.submenu, showCheck: true, checked: !!it.ok }))
    ;(it.steps || []).forEach(function (st, i) {
      rows.push(row({ section: "Setup", rowId: "set-info", icon: "", label: (i + 1) + ". " + st, available: false }))
    })
  })
  return rows
}

// Settings › Paper status: the tags, in the order Tab cycles them (Enter: rename, remove;
// Shift+↑/↓ moves), then Add a status tag….
function buildPaperStatusSettings(statuses, row) {
  var rows = (statuses || []).map(function (t, i) {
    return row({ section: "Status tags, in order", rowId: "pstatus", icon: "\uf02b", label: t, value: t, available: true, submenu: true,
      detail: (i === 0 ? "First after none" : "") + (i === 0 ? " · " : "") + "Enter renames or removes it · Shift+↑↓ moves it" })
  })
  rows.push(row({ section: "Status tags, in order", rowId: "pstatus-add", icon: ICON.add, label: "Add a status tag…", detail: "A Zotero tag, such as “to read” or “skimmed”", available: true, submenu: true }))
  rows.push(row({ section: "How it works", rowId: "set-info", icon: ICON.info, label: "Tab / Shift+Tab on a paper", available: false,
    detail: "Moves it to the next or previous status (none, then these); Zotero gets the new tag and loses the old one, a second after you stop" }))
  return rows
}

// The setup checklist, in the order you do it: Zotero, its plugin, the keybinding, then what the
// AI features need. [{ id, icon, label, detail, ok, action ("" = nothing to do here), rowId? }]
// state.setup: scripts/setup-check.sh's report (null while it runs); state.bridge: { status,
// version, zoteroVersion, expected }.
function setupItems(state) {
  var su = state.setup || {}
  var br = state.bridge || {}
  var r = state.reqs || {}
  var items = []
  var cmd = state.settings && state.settings.zoteroCommand ? state.settings.zoteroCommand.join(" ") : "zotero"
  var up = br.status === "ready" || br.status === "bridge-missing" || br.status === "unauthorized"
  var zv = br.zoteroVersion ? " " + String(br.zoteroVersion).replace(/^(\d+(?:\.\d+)*).*$/, "$1") : ""
  var installed = up || su.running || !!su.zotero || cmd !== "zotero" || !state.setup
  if (installed) items.push({ id: "zotero-install", icon: ICON.ok, label: "Install Zotero", detail: "Installed" + zv + (cmd !== "zotero" ? " (" + cmd + ")" : ""), ok: true, action: "" })
  else items.push({ id: "zotero-install", icon: ICON.install, label: "Install Zotero", badge: "missing",
    detail: "Zotero 10: Enter opens zotero.org to download it; installed somewhere else? Set its command in General › Advanced", action: "zotero-get" })
  if (up || su.running) items.push({ id: "zotero-start", icon: ICON.ok, label: "Start Zotero", detail: "Running", ok: true, action: "" })
  else items.push({ id: "zotero-start", icon: ICON.warn, label: "Start Zotero", detail: "Enter starts it (" + cmd + ")", action: installed ? "zotero-start" : "" })

  var steps = "then install it in Zotero (the steps below)"
  var zsteps = ["In Zotero: Tools → Plugins", "The ⚙ menu → Install Plugin From File…", "Pick the .xpi in Downloads (its path is on the clipboard: Ctrl+L, then Ctrl+V)"]
  if (br.status === "bridge-missing") items.push({ id: "bridge", icon: ICON.install, label: "Install the Zotero plugin", badge: "missing",
    detail: "Enter downloads it to Downloads (checked) and starts Zotero; " + steps, action: "bridge-install", steps: zsteps })
  else if (br.status === "unauthorized") items.push({ id: "bridge", icon: ICON.warn, label: "Zotero rejected the plugin's token",
    detail: "Restart Zotero: quit it, then Enter here starts it", action: "zotero-start" })
  else if (br.status === "ready" && br.version && br.expected && versionLess(br.version, br.expected)) items.push({ id: "bridge", icon: ICON.install,
    label: "Update the Zotero plugin", badge: br.version, detail: "Zotero has " + br.version + ", the launcher " + br.expected + ": Enter downloads the new one; " + steps, action: "bridge-install", steps: zsteps })
  else if (br.status === "ready") items.push({ id: "bridge", icon: ICON.ok, label: "Install the Zotero plugin", detail: "Installed" + (br.version ? " " + br.version : "") + " and answering; Zotero keeps it up to date", ok: true, action: "" })
  else items.push({ id: "bridge", icon: ICON.info, label: "Install the Zotero plugin", detail: "Start Zotero to check it", action: "" })

  var bind = su.bind || ""
  if (bind === "ours") items.push({ id: "bind", icon: ICON.ok, label: "Add the keybinding", detail: "Set in your Hyprland bindings", ok: true, action: "" })
  else if (bind.indexOf("taken:") === 0) items.push({ id: "bind", icon: ICON.warn, label: "SUPER+SHIFT+Z does “" + bind.slice(6) + "”",
    detail: "Enter opens the README: add the launcher on another key in ~/.config/hypr/bindings.lua", action: "readme-keys" })
  else if (state.setup) items.push({ id: "bind", icon: ICON.add, label: "Add the keybinding", badge: "missing",
    detail: "Enter adds SUPER+SHIFT+Z to ~/.config/hypr/bindings.lua (backed up first; undone if Hyprland complains)", action: "bind-add" })
  if (state.setup && !su.rule) items.push({ id: "rule", icon: ICON.add, label: "Open from the middle (optional)",
    detail: "Enter adds the Hyprland layer rule that stops the launcher sliding in from the corner", action: "rule-add" })
  else if (state.setup) items.push({ id: "rule", icon: ICON.ok, label: "Open from the middle (optional)", detail: "The launcher grows from the middle", ok: true, action: "" })

  var node = r.node || su.node || ""
  if (!node) items.push({ id: "node", icon: ICON.node, label: "Install Node.js", badge: "missing", detail: "For the AI features: Enter runs omarchy install dev-env node in a terminal", action: "term:omarchy install dev-env node" })
  else if (!nodeOk(node)) items.push({ id: "node", icon: ICON.node, label: "Node.js " + node, badge: "old", detail: "The AI features need 22 or newer: Enter runs omarchy install dev-env node", action: "term:omarchy install dev-env node" })
  else items.push({ id: "node", icon: ICON.node, label: "Install Node.js", detail: node + ", for the AI features", ok: true, action: "" })

  if (state.runner && state.runner.installed) items.push({ id: "runner", rowId: "set-install", icon: ICON.install, label: "Install the AI features", ok: true,
    detail: state.runner.installing ? "Installing… (it's in Processes)" : "Enter installs them again (after an update of the plugin)", action: "install" })
  else items.push({ id: "runner", rowId: "set-install", icon: ICON.install, label: "Install the AI features", badge: "missing",
    detail: state.runner && state.runner.installing ? "Installing… (it's in Processes)" : !nodeOk(node) ? "Install Node.js first" : "Prompts, chat and text extraction: Enter installs the runner (a minute)", action: nodeOk(node) ? "install" : "" })

  if (state.runner && state.runner.installed && state.info) {
    var on = enabledNames(state)
    if (on.length) items.push({ id: "model", icon: ICON.ok, label: "Set up an AI model", detail: on.join(", ") + (on.length === 1 ? " is on" : " are on"), ok: true, action: "" })
    else items.push({ id: "model", icon: ICON.providers, label: "Set up an AI model", badge: "missing", detail: "Enter: your subscription, an API key, or a model on this computer", action: "settings-providers" })
  }
  var pdf = r.pdftotext || su.pdftotext
  if (pdf) items.push({ id: "pdftotext", icon: ICON.pdf, label: "Install pdftotext", detail: "Installed: it extracts the text of PDFs", ok: true, action: "" })
  else items.push({ id: "pdftotext", icon: ICON.pdf, label: "Install pdftotext", badge: "missing", detail: "To extract PDFs' text: Enter runs omarchy pkg add poppler in a terminal", action: "term:omarchy pkg add poppler" })
  var kr = state.info && state.info.keyring
  if (kr) items.push({ id: "keyring", icon: ICON.lock, label: "A system keyring", ok: kr.ok,
    detail: kr.ok ? "Holds your API keys (never written to a file)" : kr.detail + ": API keys can only come from the environment", action: "" })
  return items
}

// "0.1.0" < "0.2.0"
function versionLess(a, b) {
  var x = String(a).split(".").map(Number)
  var y = String(b).split(".").map(Number)
  for (var i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0)
  return false
}

function nodeOk(v) {
  return Number(String(v || "").replace(/^v/, "").split(".")[0]) >= 22
}

function buildGeneral(state, row) {
  var rows = []
  GENERAL.forEach(function (item) {
    var v = getPath(state.settings, item.key)
    var cur = v === undefined || v === null ? item.def : v
    var path = "general." + item.key
    if (item.type === "toggle") {
      rows.push(row({ section: item.section, rowId: "set-toggle", value: path, icon: cur ? ICON.on : ICON.off, label: item.label, detail: valueText(item, cur) + (item.help ? " · " + item.help : ""), available: true }))
    } else if (item.type === "choice") {
      rows.push(row({ section: item.section, rowId: "set-choice", value: path, icon: ICON.general, label: item.label, detail: valueText(item, v), available: true, submenu: true }))
    } else {
      rows.push(row({ section: item.section, rowId: "set-edit", value: path, icon: ICON.general, label: item.label, detail: valueText(item, v) + (item.help ? " · " + item.help : ""), available: true, submenu: true }))
    }
  })
  return rows
}

// A choice's options, as a page of its own: Enter picks one and goes back.
function choiceItem(path) {
  if (/^general\./.test(path)) return generalItem(path.slice(8))
  if (/^defaults\.(prompts|chat)\.effort$/.test(path)) return { key: path, label: "Effort", def: "high", options: EFFORT_ROWS.map(function (e) { return [e[0], (e[0] || "default") + " · " + e[1]] }) }
  return null
}

function buildChoice(state, path, row) {
  var item = choiceItem(path)
  if (!item) return []
  var v = getPath(state.settings, path.replace(/^general\./, ""))
  var cur = v === undefined || v === null ? item.def : v
  return item.options.map(function (o) {
    return row({ rowId: "set-opt", value: path, tag: o[0], label: o[1], showCheck: true, checked: o[0] === cur, available: true })
  })
}

// How each kind of provider is set up, for "Add a provider".
var WAYS = {
  subscription: "Use my subscription",
  api: "Use an API key",
  local: "Private, on this computer",
  endpoint: "My institution's endpoint"
}

function providerDetail(state, p) {
  var t = state.tests && state.tests[p.id]
  if (t && t.running) return "Testing…"
  var bits = []
  if (p.enabled) bits.push("On")
  if (t) bits.push(t.ok ? "✓ " + t.detail : "✗ " + t.detail)
  else if (p.detected && p.detected.detail) bits.push(p.detected.detail)
  if (p.takesKey) bits.push(p.key.set ? "key " + p.key.masked + (p.key.from !== "keyring" ? " (" + p.key.from + ")" : "") : p.needsKey ? "no key yet" : "")
  if (p.baseURL && p.kind !== "subscription" && (p.endpoint || p.id === "ollama")) bits.push(p.baseURL)
  return bits.filter(function (x) { return x }).join(" · ")
}

function buildProviders(state, row) {
  var rows = []
  if (!state.runner.installed) {
    rows.push(row({ rowId: "set-nav", value: "root", icon: ICON.install, label: "Install the AI features first", detail: "Settings › Requirements › Install AI features", available: true, submenu: true }))
    return rows
  }
  if (!state.info) {
    rows.push(row({ rowId: "set-info", icon: ICON.info, label: "Checking what's installed…", available: false }))
    return rows
  }
  var list = state.info.providers
  // Detected and not on yet: one Enter turns it on (and makes it the default when there is none).
  var ready = list.filter(function (p) { return !p.enabled && p.detected && p.detected.available && p.detected.signedIn !== false })
  ready.forEach(function (p) {
    rows.push(row({ section: "Ready to use", rowId: "set-quick", value: p.id, icon: ICON.ok, label: "Use " + p.name, available: true,
      detail: (p.detected.detail || "found on this computer") + " · Enter turns it on" }))
  })
  var mine = list.filter(function (p) { return p.enabled || (p.takesKey && p.key.set && p.key.from === "keyring") || p.endpoint })
  mine.forEach(function (p) {
    rows.push(row({ section: "Your providers", rowId: "set-provider", value: p.id, icon: p.enabled ? ICON.on : ICON.off, label: p.name, detail: providerDetail(state, p), available: true, submenu: true,
      badge: p.enabled ? "on" : "" }))
  })
  var ways = ["subscription", "api", "local", "endpoint"]
  ways.forEach(function (w) {
    list.filter(function (p) { return p.kind === w && mine.indexOf(p) < 0 && ready.indexOf(p) < 0 }).forEach(function (p) {
      rows.push(row({ section: "Add a provider", rowId: "set-provider", value: p.id, icon: w === "subscription" ? ICON.card : w === "local" ? ICON.home : ICON.key,
        label: p.name, detail: WAYS[w] + (p.id === "google" || p.id === "openrouter" ? " · free, with limits" : "") + " · " + p.cost, available: true, submenu: true }))
    })
    if (w === "endpoint") rows.push(row({ section: "Add a provider", rowId: "set-endpoint-new", icon: ICON.add, label: "Add an OpenAI-compatible endpoint…",
      detail: WAYS.endpoint + ", LM Studio, vLLM or llama.cpp: a base URL and, if it needs one, a key", available: true, submenu: true }))
  })
  return rows
}

function buildProvider(state, id, row) {
  var p = providerInfo(state, id)
  if (!p) return [row({ rowId: "set-info", icon: ICON.info, label: "…", available: false })]
  var rows = []
  var t = state.tests && state.tests[id]
  var status = t && t.running ? "Testing…" : t ? (t.ok ? "✓ " : "✗ ") + t.detail : p.detected && p.detected.detail ? p.detected.detail : p.signIn || ""
  rows.push(row({ rowId: "set-toggle", value: (p.endpoint ? "endpoint." : "providers.") + id + ".enabled", icon: p.enabled ? ICON.on : ICON.off, label: p.enabled ? "On" : "Off",
    detail: p.enabled ? "Its models are in the pickers · Enter turns it off" : "Enter turns it on", available: true }))
  rows.push(row({ rowId: "set-test", value: id, icon: ICON.test, label: "Test connection", detail: status || "Lists its models, or says what is wrong", available: !(t && t.running) }))
  if (p.takesKey) {
    rows.push(row({ rowId: "set-key", value: id, icon: ICON.key, label: p.key.set && p.key.from === "keyring" ? "Replace the API key from the clipboard" : "Set the API key from the clipboard",
      detail: (p.key.set ? "Now: " + p.key.masked + (p.key.from === "keyring" ? " (in the keyring)" : " (from " + p.key.from + ")") + " · " : p.needsKey ? "" : "Optional · ") +
        "Copy the key, then Enter: it goes to the keyring and the clipboard is cleared", available: !(state.info.keyring && !state.info.keyring.ok) }))
    if (p.key.set && p.key.from === "keyring") rows.push(row({ rowId: "set-key-remove", value: id, icon: ICON.trash, label: "Remove the API key", detail: "From the keyring", available: true }))
    if (p.keyUrl) rows.push(row({ rowId: "set-link", value: p.keyUrl, icon: ICON.link, label: "Get a key", detail: p.keyUrl, available: true }))
    if (p.envNames && p.envNames.length) rows.push(row({ rowId: "set-info", icon: ICON.info, label: "Or set " + p.envNames.join(" or "), detail: "Read from the environment when no key is stored", available: false }))
  }
  if (p.endpoint || id === "ollama") {
    rows.push(row({ rowId: "set-edit", value: (p.endpoint ? "endpoint." + id : "providers." + id) + ".baseURL", icon: ICON.url, label: "Base URL", detail: p.baseURL || "http://localhost:11434/v1", available: true, submenu: true }))
    rows.push(row({ rowId: "set-edit", value: (p.endpoint ? "endpoint." + id : "providers." + id) + ".context", icon: ICON.model, label: "Context size",
      detail: (p.context ? p.context + " tokens" : "The model's own") + " · a cap on what the model reads (a larger one takes more memory)", available: true, submenu: true }))
  }
  if (p.kind === "subscription" && p.signIn) rows.push(row({ rowId: "set-info", icon: ICON.info, label: "Sign in", detail: p.signIn, available: false }))
  if (id === "ollama") {
    rows.push(row({ rowId: "set-info", icon: ICON.info, label: "Set it up", detail: "omarchy pkg add ollama, then ollama pull qwen3:8b (8B or larger quotes more faithfully)", available: false }))
  }
  if (t && t.ok && t.models && t.models.length) {
    rows.push(row({ rowId: "set-use", value: id, icon: ICON.defaults, label: "Use for prompts and chat", detail: "Pick one of its " + t.models.length + " models as the default", available: true, submenu: true }))
  }
  rows.push(row({ section: "Privacy and cost", rowId: "set-info", icon: ICON.cloud, label: p.kind === "local" ? "Stays on this computer" : "What leaves this computer", detail: p.privacy, available: false }))
  rows.push(row({ section: "Privacy and cost", rowId: "set-info", icon: ICON.card, label: "Cost", detail: p.cost, available: false }))
  var est = costEstimate(p, t)
  if (est) rows.push(row({ section: "Privacy and cost", rowId: "set-info", icon: ICON.info, label: "A typical run", detail: est, available: false }))
  if (p.endpoint) rows.push(row({ section: "Privacy and cost", rowId: "set-endpoint-remove", value: id, icon: ICON.trash, label: "Remove this endpoint", detail: "Its key, if any, stays in the keyring until you remove it", available: true }))
  return rows
}

// The models to pick a default from: every enabled provider's, grouped (section = provider),
// or one provider's (`only`).
function buildModelPicker(state, path, row, only) {
  var cur = getPath(state.settings, path.replace(/^defaults\./, "defaults.")) || ""
  var models = (state.models || []).filter(function (m) { return !only || m.value.indexOf(only + ":") === 0 })
  if (only && state.tests && state.tests[only] && state.tests[only].models) models = state.tests[only].models.map(function (m) { return Object.assign({ group: "" }, m) })
  var rows = []
  if (/fallback$/.test(path)) rows.push(row({ rowId: "set-model", value: path, tag: "", label: "None", detail: "When a model fails, the error is shown", showCheck: true, checked: !cur, available: true }))
  models.forEach(function (m) {
    rows.push(row({ section: only ? "" : m.group || "", rowId: "set-model", value: path, tag: m.value, label: m.displayName || m.value, detail: modelDetail(m), showCheck: true, checked: m.value === cur, available: true }))
  })
  if (!models.length) rows.push(row({ rowId: "set-info", icon: ICON.info, label: state.models ? "No models: turn a provider on first" : "Listing the models…", available: false }))
  return rows
}

// "1M context · $1.25/$10 per M · thinks" for a model row.
function modelDetail(m) {
  var bits = []
  if (m.context) bits.push(tokens(m.context) + " context" + (m.context < 32000 ? ": partial text" : ""))
  if (m.free) bits.push("free")
  else if (typeof m.priceIn === "number" && typeof m.priceOut === "number" && (m.priceIn || m.priceOut)) bits.push("$" + round(m.priceIn) + "/$" + round(m.priceOut) + " per M tokens")
  if (m.efforts && m.efforts.length) bits.push("effort levels")
  if (m.description) bits.push(m.description)
  return bits.join(" · ")
}

function round(x) {
  return x >= 10 ? String(Math.round(x)) : String(Math.round(x * 100) / 100)
}

function tokens(n) {
  return n >= 1000000 ? Math.round(n / 100000) / 10 + "M" : n >= 1000 ? Math.round(n / 1000) + "k" : String(n)
}

// Before a first run on a paid API (PLAN-providers.md §6): what a prompt on one paper costs.
// A paper and its notes are often 30–60k tokens in; a note is a few thousand out.
function costEstimate(p, t) {
  if (p.kind !== "api" && !p.endpoint) return ""
  var priced = ((t && t.models) || []).filter(function (m) { return typeof m.priceIn === "number" && typeof m.priceOut === "number" && (m.priceIn || m.priceOut) })
  var base = "A paper is often 30–60k tokens: each prompt run or chat question sends it"
  if (!priced.length) return base + (p.kind === "api" ? "; see the provider's price list for its models" : "")
  var m = priced[0]
  var lo = (30000 * m.priceIn + 3000 * m.priceOut) / 1e6
  var hi = (60000 * m.priceIn + 6000 * m.priceOut) / 1e6
  var money = function (x) { return x < 0.01 ? "< $0.01" : "$" + x.toFixed(2) }
  return base + ": with " + (m.displayName || m.value) + ", about " + money(lo) + "–" + money(hi) + " a run"
}

var EFFORT_ROWS = [["", "The model's default"], ["low", "Fastest, least thinking"], ["medium", "Balanced"], ["high", "Thorough (recommended for notes)"], ["xhigh", "More thinking, slower"], ["max", "Most thinking, slowest"]]

function buildDefaults(state, row) {
  var d = state.settings.defaults || {}
  var rows = []
  ;[["prompts", "Prompts"], ["chat", "Chat"]].forEach(function (x) {
    var p = x[0]
    var cur = d[p] || {}
    rows.push(row({ section: x[1], rowId: "set-models", value: "defaults." + p + ".model", icon: ICON.model, label: "Model",
      detail: cur.model || (state.defaults[p] ? state.defaults[p] + " (automatic)" : "None: turn a provider on first"), available: true, submenu: true }))
    rows.push(row({ section: x[1], rowId: "set-choice", value: "defaults." + p + ".effort", icon: ICON.defaults, label: "Effort", detail: effortText(cur.effort), available: true, submenu: true }))
  })
  rows.push(row({ section: "The paper's text", rowId: "set-toggle", value: "defaults.autoExtract", icon: d.autoExtract ? ICON.on : ICON.off, label: "Extract the text first",
    detail: (d.autoExtract ? "On" : "Off") + " · when a chat opens or a prompt runs on a paper whose text isn't extracted, save its page-numbered note first", available: true }))
  rows.push(row({ section: "When a model fails", rowId: "set-models", value: "defaults.fallback", icon: ICON.model, label: "Fallback model",
    detail: d.fallback ? d.fallback + " answers instead, and the answer says so" : "None: the error is shown", available: true, submenu: true }))
  rows.push(row({ section: "When a model fails", rowId: "set-info", icon: ICON.info, label: "Prompts can name their own model", detail: "In the prompt editor (e on a prompt); \"default\" follows these settings", available: false }))
  return rows
}

// Settings › Rules: every rule to turn on or off, by section (each says where it applies: prompts
// that write notes, chat, artifacts), then your own instructions.
function buildRules(state, row) {
  var s = state.settings
  var rows = []
  var rules = state.rules || []
  if (!rules.length) rows.push(row({ rowId: "set-info", icon: ICON.info, label: "Reading the rules…", available: false }))
  rules.forEach(function (r) {
    var text = r.text || [r.prompt ? "Prompts: " + r.prompt : "", r.chat ? "Chat: " + r.chat : "", r.artifact ? "Artifacts: " + r.artifact : ""].filter(function (x) { return x }).join(" ")
    rows.push(row({ section: r.section, rowId: "set-rule", value: r.id, label: r.label, detail: ruleWhere(r) + " · " + text, showCheck: true, checked: ruleOn(s, r), available: true }))
  })
  var own = String(state.instructions || "")
  var first = own.split("\n").filter(function (l) { return l.trim() })[0] || ""
  rows.push(row({ section: "Your own instructions", rowId: "set-system-edit", icon: ICON.general, label: own ? "Edit your own instructions" : "Write your own instructions", submenu: true, available: true, trailing: "editor",
    detail: own ? first.slice(0, 100) : "Added after the rules, to every prompt and chat; where they differ, yours win" }))
  if (own) rows.push(row({ section: "Your own instructions", rowId: "set-system-reset", icon: ICON.trash, label: "Clear your own instructions", detail: "The rules stay as they are", available: true }))
  if (s.rules && Object.keys(s.rules).length) rows.push(row({ section: "Reset", rowId: "set-rules-reset", icon: ICON.back, label: "Reset the rules to the defaults", detail: Object.keys(s.rules).length + " changed", available: true }))
  return rows
}

function effortText(e) {
  if (e === undefined) e = "high"
  for (var i = 0; i < EFFORT_ROWS.length; i++) if (EFFORT_ROWS[i][0] === e) return (e || "default") + " · " + EFFORT_ROWS[i][1]
  return String(e)
}

// The header holds a value being typed: one row saves it.
function buildEditRows(edit, text, row) {
  var t = String(text || "").trim()
  var rows = [row({ rowId: "set-save", icon: ICON.ok, label: t ? "Save “" + t + "”" : edit.empty ? "Save: " + edit.empty : "Type the " + edit.label.toLowerCase(), detail: edit.help || "", available: !!t || !!edit.empty, value: t })]
  if (edit.current) rows.push(row({ rowId: "set-info", icon: ICON.info, label: "Now: " + edit.current, available: false }))
  return rows
}

if (typeof module !== "undefined") {
  module.exports = {
    GENERAL: GENERAL, GENERAL_DEFAULTS: GENERAL_DEFAULTS, toFile: toFile, setPath: setPath, withValue: withValue, addEndpoint: addEndpoint, removeEndpoint: removeEndpoint, getPath: getPath, generalItem: generalItem, valueText: valueText, parseValue: parseValue,
    needsSetup: needsSetup, setupItems: setupItems, versionLess: versionLess, nodeOk: nodeOk, providerInfo: providerInfo, buildRoot: buildRoot, buildGeneral: buildGeneral, buildProviders: buildProviders, buildProvider: buildProvider,
    buildModelPicker: buildModelPicker, buildChoice: buildChoice, choiceItem: choiceItem, costEstimate: costEstimate, buildDefaults: buildDefaults, buildRules: buildRules, ruleOn: ruleOn, withRuleToggled: withRuleToggled, buildPaperStatusSettings: buildPaperStatusSettings, buildEditRows: buildEditRows, modelDetail: modelDetail, tokens: tokens, ICON: ICON
  }
}
