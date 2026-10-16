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
      catchUp: c.catchUp || { plan: null, running: null, problem: "" }, automation: c.automation || null, reqs: c.reqs || {}, setup: c.setup || null,
      bridge: c.bridge || { status: "unknown", version: "", zoteroVersion: "", expected: "" },
      now: c.now ? new Date(c.now) : undefined } // (the goldens' fixed clock; the app's is the real one)
  }

  // The setup checklist as a Mac shows it: no Hyprland rows (the keybinding, the layer rule),
  // Homebrew for Omarchy's installers (Enter copies the command, for Terminal), the Mac's file
  // picker keys, the app in place of the plugin; and the runner row offering the newer one the app
  // brings (decision 7).
  var HYPRLAND = ["bind-add", "rule-add", "readme-keys"]
  var BREW = { "term:omarchy install dev-env node": "brew install node", "term:omarchy pkg add poppler": "brew install poppler",
    "term:omarchy pkg add tesseract tesseract-data-eng": "brew install tesseract" }
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

  // The Mac's words where Settings.js has Omarchy's: the Keychain holds the keys, Homebrew installs;
  // and the settings the Mac doesn't read (a PDF app, a Zotero command:
  // it opens both through Launch Services) aren't offered.
  var MAC_WORDS = [["A system keyring", "The macOS Keychain"], ["keyring", "Keychain"], ["omarchy pkg add ollama", "brew install ollama"],
    ["; installed somewhere else? Set its command in General › Advanced", ""], [" its 1 models", " its one model"],
    ["under a paper's status line", "under the paper's name at the top"]]
  var NOT_ON_MAC = ["general.externalPdfCommand", "general.zoteroCommand"]
  function macWords(rows) {
    return rows.filter(function (r) { return NOT_ON_MAC.indexOf(r.value) < 0 }).map(function (r) {
      var x = Object.assign({}, r)
      ;["label", "labelHtml", "detail"].forEach(function (f) {
        if (typeof x[f] !== "string") return
        MAC_WORDS.forEach(function (w) { x[f] = x[f].split(w[0]).join(w[1]) })
      })
      return x
    })
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
    if (name === "auto-prompts") return S.buildAutoPrompts(state, L)
    if (name === "rules") {
      // no rules.json to read (installed or bundled): said, not "Reading the rules…" for ever
      if (!state.rules.length && (ctx || {}).rulesMissing) return [L({ rowId: "set-info", icon: S.ICON.info, label: "Couldn't read the rules: " + ctx.rulesMissing + " isn't there", detail: "Settings › Setup installs the AI features", available: false })]
      return S.buildRules(state, L)
    }
    // Settings › Taxonomies (phase 9): x.taxEdit (taxonomy-show), x.taxLabel (its label's place), x.taxDraft, x.review
    if (name === "taxonomies" && !state.taxonomies && x.taxProblem) return [L({ rowId: "set-info", icon: S.ICON.warn, label: "Couldn't read the taxonomies: " + x.taxProblem, detail: "Back, then Settings › Taxonomies tries again", available: false })]
    if (name === "taxonomies") return S.buildTaxonomies(state, L)
    if (name === "taxonomy" && !x.taxEdit && x.taxProblem) return [L({ rowId: "set-info", icon: S.ICON.warn, label: "Couldn't read “" + (x.taxEditId || "it") + "”: " + x.taxProblem, detail: "Back, then Enter on it tries again", available: false })]
    if (name === "taxonomy") return S.buildTaxonomy(x.taxEdit || null, L)
    if (name === "tax-label") return S.buildTaxonomyLabel(x.taxEdit || null, Number(x.taxLabel), L)
    if (name === "tax-ai") return x.taxDraft ? S.buildTaxonomyDraft(x.taxDraft, L) : []
    if (name === "tax-review") return S.buildTaxonomyReview(x.review === undefined ? null : x.review, L)
    if (name === "tasks") return T.buildStatusSettings(T.statusesOf(settings), x.todos || [], L).concat(T.buildActionSettings(T.actionsOf(settings), L), T.buildDefaultTaskSettings(settings, L))
    return [L({ rowId: "set-info", icon: S.ICON.info, label: "Not on the Mac yet: this page comes in a later version", available: false })]
  }

  // The typing page of a taxonomy's field (the Mac types the form's fields there): Ask the AI sends; a definition can
  // be emptied; the others say which field. null: not a taxonomy's.
  function taxonomyEditRows(edit, text) {
    var path = String((edit && edit.path) || "")
    if (path.indexOf("tax:") !== 0) return null
    var t = String(text || "").trim()
    if (path === "tax:ai-request") return [L({ rowId: "set-save", icon: S.ICON.ok, label: t ? "Send “" + t + "”" : "Type what you want", detail: edit.help || "", available: !!t, value: t })]
    if (path === "tax:label-definition") return [L({ rowId: "set-save", icon: S.ICON.ok, label: t ? "Save “" + t + "”" : "Save: no definition", detail: edit.help || "", available: true, value: t })]
      .concat(edit.current ? [L({ rowId: "set-info", icon: S.ICON.info, label: "Now: " + edit.current, available: false })] : [])
    return [L({ rowId: "set-save", icon: S.ICON.ok, label: t ? "Save “" + t + "”" : "Type the value of “" + edit.label + "”", detail: edit.help || "", available: !!t, value: t })]
      .concat(edit.current ? [L({ rowId: "set-info", icon: S.ICON.info, label: "Now: " + edit.current, available: false })] : [])
  }

  // A row's path from this Mac's home folder, with ~ (an editor's file, a folder).
  function tilde(r, home) {
    if (!home || typeof r.detail !== "string" || r.detail.indexOf(home + "/") < 0) return r
    return Object.assign({}, r, { detail: r.detail.split(home + "/").join("~/") })
  }

  // The pages the Mac has, for the index (ZoteroSearch.qml:530).
  var INDEXED = [["", "Settings"], ["general", "General"], ["providers", "Models & providers"], ["defaults", "Defaults"], ["rules", "Rules"], ["paper-status", "Paper status"], ["tasks", "Tasks"], ["taxonomies", "Taxonomies"]]

  // A settings change made, saved as Service.qml's saveSettings: → { problem } or { machine,
  // shared (null without a sync folder), refused, syncDirChange, id (a new endpoint's) }.
  // op: "value" [path, value], "both" [model] (prompts and chat), "addEndpoint" [name, url],
  // "removeEndpoint" [id], "fillDefaults" [model] (the empty ones), "rule" [rule] (toggled).
  function change(settings, op, args) {
    var a = args || []
    // (null: back to the default, the key gone, as parseValue's undefined is in the QML)
    if (op === "value") return { next: S.withValue(settings, a[0], a[1] === null ? undefined : a[1]) }
    if (op === "both") return { next: S.withValue(S.withValue(settings, "defaults.prompts.model", a[0]), "defaults.chat.model", a[0]) }
    if (op === "addEndpoint") { var r = S.addEndpoint(settings, a[0], a[1]); return { next: r.settings, id: r.id } }
    if (op === "removeEndpoint") return { next: S.removeEndpoint(settings, a[0]) }
    if (op === "rule") return { next: S.withRuleToggled(settings, a[0]) } // a rule (rules.json's) on or off
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
      if (name === "edit") return taxonomyEditRows(x.edit, x.filter || "") || S.buildEditRows(x.edit, x.filter || "", L)
      return V.filterRows(macWords(page(name, settings, ctx, x)).map(function (r) { return tilde(r, x.home) }), x.filter || "")
    },
    // Every row of the pages above, as the results' Go to and a menu's Settings rows find them.
    settingsIndex: function (settings, ctx, todos) {
      var out = []
      INDEXED.forEach(function (p) {
        macWords(page(p[0], settings, ctx, { todos: todos })).forEach(function (r) {
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
        empty: ["argv", "context", "path", "text"].indexOf(item.type) >= 0 ? "back to the default" : "" }
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
