// Glue's wrappers for the settings pages (Settings.js, row = Views.listRow) and saving them, as
// ZoteroSearch.qml's settingsState, settingsRows, settingsIndex and Service.qml's saveSettings do,
// with what the Mac knows. Merged into Glue (Glue.js); JSON in, JSON out.
function GlueSettings(V, C, T, P, S) {
  var L = V.listRow

  // ZoteroSearch.qml's settingsState. ctx (from Swift): { bridge, styles, stylesProblem, info (the
  // runner's providers), models ({ models, groups }), defaults ({ prompts, chat }), tests, runner
  // ({ installed, installing, update: { installed, bundled } | null }), reqs ({ node, pdftotext }),
  // setup ({ zotero, running, node, pdftotext }), rules, instructions, prompts, taxonomies, extract }.
  function settingsState(settings, ctx) {
    var c = ctx || {}
    return { settings: settings, info: c.info || null, models: c.models ? c.models.models || null : null, defaults: c.defaults || { prompts: "", chat: "" },
      rules: c.rules || [], instructions: c.instructions || "", tests: c.tests || {}, open: "",
      runner: c.runner || { installed: false, installing: false }, styles: c.styles || null, stylesProblem: c.stylesProblem || "",
      extract: c.extract || { pending: 0, catchup: null, skipped: 0 }, taxonomies: c.taxonomies || null, prompts: c.prompts || null,
      catchUp: { plan: null, running: false, problem: "" }, reqs: c.reqs || {}, setup: c.setup || null,
      bridge: c.bridge || { status: "unknown", version: "", zoteroVersion: "", expected: "" } }
  }

  // The setup checklist as a Mac shows it: no Hyprland rows (the keybinding, the layer rule),
  // Homebrew for Omarchy's installers (Enter copies the command, for Terminal), the Mac's file
  // picker keys, the app in place of the plugin; and the runner row offering the newer one the app
  // brings (decision 7).
  var HYPRLAND = ["bind-add", "rule-add", "readme-keys"]
  var BREW = { "term:omarchy install dev-env node": "brew install node", "term:omarchy pkg add poppler": "brew install poppler" }
  function macSetup(rows, runner) {
    var out = []
    rows.forEach(function (r) {
      if (r.section !== "Setup") return out.push(r)
      if (HYPRLAND.indexOf(r.value) >= 0) return
      var x = Object.assign({}, r)
      var brew = BREW[r.value]
      if (brew) {
        x.value = "copy:" + brew
        var omarchy = r.value.slice(5)
        x.detail = String(r.detail).replace("runs " + omarchy + " in a terminal", "copies " + brew + " (paste it in Terminal)").replace("runs " + omarchy, "copies " + brew + " (paste it in Terminal)")
      }
      x.label = String(x.label).replace("Ctrl+L, then Ctrl+V", "⌘⇧G, then ⌘V")
      x.detail = String(x.detail).replace("(after an update of the plugin)", "(after an update of the app)").replace("Enter starts it (zotero)", "Enter starts it (Zotero.app)")
      var up = runner && runner.update
      if (r.rowId === "set-install" && up && runner.installed && !runner.installing) {
        x.detail = "This app brings runner " + up.bundled + " (installed: " + up.installed + "): Enter installs it"
        x.badge = "update"
        x.checked = false
      }
      out.push(x)
    })
    return out
  }

  // One page's rows. page: "", general, paper-status, styles, choice, edit, providers, provider,
  // models, defaults; extra: { choice, edit, filter, machineOnly, provider (an id), modelsPath, only }.
  function page(name, settings, ctx, extra) {
    var x = extra || {}
    var state = settingsState(settings, ctx)
    var ps = state.settings.paperStatuses || []
    if (name === "") return macSetup(S.buildRoot(state, L), state.runner)
    if (name === "general") return S.buildGeneral(Object.assign({}, state, { machineOnly: x.machineOnly || null }), L)
    if (name === "paper-status") return S.buildPaperStatusSettings(ps, L).concat([L({ section: "In Zotero", rowId: "pstatus-migrate", icon: "",
      label: "Move the status tags to " + C.PAPER_TAG_PREFIX + "…", detail: "Papers tagged “" + (ps[0] || "reading") + "” before the prefix get “" + C.statusTag(ps[0] || "reading") + "”, and so on", available: ps.length > 0 })])
    if (name === "styles") return S.buildStylePicker(state, L)
    if (name === "choice") return S.buildChoice(state, x.choice, L)
    if (name === "providers") return S.buildProviders(state, L)
    if (name === "provider") return S.buildProvider(state, x.provider, L)
    if (name === "models") return S.buildModelPicker(state, x.modelsPath, L, x.only || "")
    if (name === "defaults") return S.buildDefaults(state, L)
    if (name === "tasks") return T.buildStatusSettings(T.statusesOf(settings), x.todos || [], L).concat(T.buildActionSettings(T.actionsOf(settings), L), T.buildDefaultTaskSettings(settings, L))
    return [L({ rowId: "set-info", icon: S.ICON.info, label: "This page comes to the Mac in a later version", available: false })]
  }

  // The pages the Mac has, for the index (ZoteroSearch.qml:530).
  var INDEXED = [["", "Settings"], ["general", "General"], ["providers", "Models & providers"], ["defaults", "Defaults"], ["paper-status", "Paper status"], ["tasks", "Tasks"]]

  // A settings change made, saved as Service.qml's saveSettings: → { problem } or { machine,
  // shared (null without a sync folder), refused, syncDirChange, id (a new endpoint's) }.
  // op: "value" [path, value], "both" [model] (prompts and chat), "addEndpoint" [name, url],
  // "removeEndpoint" [id], "fillDefaults" [model] (the empty ones).
  function change(settings, op, args) {
    var a = args || []
    if (op === "value") return { next: S.withValue(settings, a[0], a[1]) }
    if (op === "both") return { next: S.withValue(S.withValue(settings, "defaults.prompts.model", a[0]), "defaults.chat.model", a[0]) }
    if (op === "addEndpoint") { var r = S.addEndpoint(settings, a[0], a[1]); return { next: r.settings, id: r.id } }
    if (op === "removeEndpoint") return { next: S.removeEndpoint(settings, a[0]) }
    if (op === "fillDefaults") {
      var d = settings.defaults || {}, next = settings
      if (!(d.prompts && d.prompts.model)) next = S.withValue(next, "defaults.prompts.model", a[0])
      if (!(d.chat && d.chat.model)) next = S.withValue(next, "defaults.chat.model", a[0])
      return { next: next }
    }
    throw new Error("no such settings change: " + op)
  }

  return {
    settingsPage: function (name, settings, ctx, extra) {
      var x = extra || {}
      if (name === "edit") return S.buildEditRows(x.edit, x.filter || "", L)
      return V.filterRows(page(name, settings, ctx, x), x.filter || "")
    },
    // Every row of the pages above, as the results' Go to and a menu's Settings rows find them.
    settingsIndex: function (settings, ctx, todos) {
      var out = []
      INDEXED.forEach(function (p) {
        page(p[0], settings, ctx, { todos: todos }).forEach(function (r) {
          if (!r.label || (r.rowId === "set-info" && !r.available)) return
          var nav = r.rowId === "set-nav"
          out.push({ page: nav ? r.value : p[0], pageTitle: nav ? r.label : p[1], label: r.label, detail: r.detail, section: r.section, rowId: nav ? "" : r.rowId, value: nav ? "" : r.value })
        })
      })
      return out
    },
    settingMenuRows: function (query, index) { return V.settingMenuRows(query, index || []) },
    settingsChange: function (settings, op, args, paths, sharedRaw) {
      var r = change(settings, op, args)
      var file = S.toFile(r.next)
      var res = C.normalizeSettings(file)
      if (res.problems.length) return { problem: res.problems[0] }
      if ((r.next.syncDir || null) !== (settings.syncDir || null)) return { syncDirChange: r.next.syncDir || null }
      var save = P.settingsSave(file, paths, sharedRaw, S.toFile(settings))
      return { machine: save.machine, shared: save.shared, refused: save.refused || "", id: r.id || "" }
    },
    // A setting's edit (the header takes its value): general's, an endpoint's or a provider's base
    // URL and context, the extraction size (ZoteroSearch.qml:3759).
    settingEdit: function (path, settings) {
      var key = path.replace(/^general\./, "")
      var item = S.generalItem(key)
      var cur
      if (item) cur = S.getPath(settings, key)
      else {
        var field = path.split(".").pop()
        item = path === "defaults.catchUpDays" ? { key: path, label: "Papers added lately: the last … days", type: "number", min: 1, max: 3650, help: "Days, 1 to 3650: Catch up looks at the papers added since" }
          : path === "defaults.extractMaxMB" ? { key: path, label: "Skip PDFs larger than", type: "number", min: 1, max: 1000, help: "MB, 1 to 1000: larger PDFs are left out of automatic extraction" }
          : field === "baseURL" ? { key: path, label: "Base URL", type: "url", help: "e.g. http://localhost:11434/v1, or https://gateway.example.edu/v1" }
          : field === "context" ? { key: path, label: "Context size", type: "context", help: "Tokens, e.g. 32768 or 32k; empty: the model's own" } : null
        if (!item) return null
        var m = /^endpoint\.([^.]+)\.(.+)$/.exec(path)
        var ep = m ? (settings.endpoints || []).filter(function (e) { return e.id === m[1] })[0] : null
        cur = m ? (ep ? ep[m[2]] : undefined) : S.getPath(settings, path)
      }
      var text = cur === undefined || cur === null ? "" : Array.isArray(cur) ? cur.join(" ") : String(cur)
      return { path: path, label: item.label, type: item.type, help: item.help || "", current: text, item: item,
        empty: item.type === "argv" || item.type === "context" || item.type === "path" ? "back to the default" : "" }
    },
    // The two steps of a new endpoint (ZoteroSearch.qml:1851, 3786).
    endpointNameEdit: function () { return { path: "", label: "Endpoint name", type: "endpoint-name", help: "A name you'll recognize, e.g. Lab gateway or LM Studio", current: "" } },
    endpointURLEdit: function (name) { return { path: "", label: "Base URL", type: "endpoint-url", name: name, help: "Its OpenAI-compatible API, e.g. http://localhost:1234/v1 (LM Studio) or https://gateway.example.edu/v1", current: "" } },
    // A toggle's value now: general's (its default when unset), an endpoint's, any other path's.
    settingValue: function (settings, path) {
      var m = /^endpoint\.([^.]+)\.enabled$/.exec(path)
      if (m) { var ep = (settings.endpoints || []).filter(function (e) { return e.id === m[1] })[0]; return ep ? !!ep.enabled : false }
      var key = path.replace(/^general\./, "")
      var item = S.generalItem(key)
      var cur = S.getPath(settings, key)
      return cur === undefined || cur === null ? (item ? item.def : false) : cur
    },
    // The runner's argv (settings.promptCommand, else oma-zotero-prompt).
    promptArgv: function (settings, args) { return C.promptArgv(settings, args || []) },
    needsSetup: function (settings, ctx) { return S.needsSetup(settingsState(settings, ctx)) }
  }
}

if (typeof module !== "undefined") module.exports = GlueSettings
