// Glue's wrappers for phase 6b: prompts, Processes, a paper's extracted text, Settings › Rules'
// instructions.
// Merged into Glue (Glue.js); JSON in, JSON out. `models` here is the runner's list
// (`models --json`'s models), `resolved` the default model it resolves to ("" none).
function GlueRunner(V, C, S, F) {
  var at = function (ms) { return new Date(Number(ms) || Date.now()) }
  // The text character at `at` (tags skipped, an entity one character), a dash, made "·".
  var joinAt = function (html, at) {
    var n = 0
    for (var i = 0; i < html.length; i++) {
      var c = html.charAt(i)
      if (c === "<") { i = html.indexOf(">", i); if (i < 0) break; continue }
      if (n === at) return c === "\u2014" ? html.slice(0, i) + "·" + html.slice(i + 1) : html
      if (c === "&") { var e = html.indexOf(";", i); if (e > i) i = e }
      n++
    }
    return html
  }

  return {
    // ---- prompts (`list --json`)
    parsePromptList: function (text) { return C.parsePromptList(text) },
    promptRows: function (prompts, models, query, color, resolved) { return V.buildPromptRows(prompts || [], models || null, query || "", color, F.filter, resolved || "") },
    promptEditor: function (prompt, models, resolved, auto, host) { return V.buildPromptEditor(prompt, models || null, "", resolved || "", !!auto, host || "") },
    promptModels: function (prompt, models, resolved, query) { return V.filterRows(V.buildPromptModels(prompt, models || null, resolved || ""), query || "") },
    promptEfforts: function (prompt, models, resolved) { return V.buildPromptEfforts(prompt, models || null, resolved || "") },
    promptOutputs: function (prompt) { return V.buildPromptOutputs(prompt) },
    titleRows: function (text, mode, ready, busy) { return V.buildTitleRows(text || "", mode, { ready: !!ready, busy: !!busy }) },
    effortFor: function (models, model, effort) { return V.effortFor(models || null, model, effort) || "" },
    // `set <id> …`'s flags for a change (Service.qml:1830): an empty effort is the default.
    setPromptArgs: function (id, change) {
      var c = change || {}, out = ["set", id]
      if (c.title !== undefined) out.push("--title", String(c.title))
      if (c.model !== undefined) out.push("--model", String(c.model))
      if (c.effort !== undefined) out.push("--effort", String(c.effort) || "default")
      if (c.output !== undefined) out.push("--output", String(c.output))
      if (c.brief !== undefined) out.push("--brief", c.brief === "on" || c.brief === true ? "on" : "off")
      return out
    },

    // ---- Processes (the runner's tasks)
    // (the dash joining a task's title to its paper becomes " · ", the Mac's way; a dash in the
    // title or the paper themselves stays)
    taskRows: function (tasks, query, color, nowMs) {
      return V.buildTaskRows(tasks || [], query || "", color, F.filter, at(nowMs)).map(function (r) {
        if (r.rowId !== "task" || !r.itemTitle) return r
        var x = Object.assign({}, r)
        var p = x.label.length - String(r.itemTitle).length - 2
        if (x.label.charAt(p) !== "\u2014") return r
        x.label = x.label.slice(0, p) + "·" + x.label.slice(p + 1)
        x.labelHtml = joinAt(x.labelHtml, p)
        return x
      })
    },
    taskSummary: function (tasks, pending) { return V.taskSummary(tasks || [], pending || 0) },

    // ---- a paper's extracted text
    hasPdf: function (details) { return !!V.hasPdf(details) },
    fulltextNote: function (details) { return V.fulltextNote(details) || null },
    extractMenu: function (details, noRunner) { return V.buildExtractMenu(details, !!noRunner) },

    // ---- Settings › Rules (the page itself: GlueSettings.js's settingsPage "rules")
    instructionsText: function (text) { return String(text || "").replace(/<!--[\s\S]*?-->/g, "").trim() }
  }
}

if (typeof module !== "undefined") module.exports = GlueRunner
