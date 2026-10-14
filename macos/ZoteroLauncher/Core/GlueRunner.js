// Glue's wrappers for phase 6b: prompts, Processes, a paper's extracted text, Settings › Rules'
// instructions.
// Merged into Glue (Glue.js); JSON in, JSON out. `models` here is the runner's list
// (`models --json`'s models), `resolved` the default model it resolves to ("" none).
function GlueRunner(V, C, S, F) {
  var at = function (ms) { return new Date(Number(ms) || Date.now()) }

  return {
    // ---- prompts (`list --json`)
    parsePromptList: function (text) { return C.parsePromptList(text) },
    promptRows: function (prompts, models, query, color, resolved) { return V.buildPromptRows(prompts || [], models || null, query || "", color, F.filter, resolved || "") },
    promptEditor: function (prompt, models, resolved, auto) { return V.buildPromptEditor(prompt, models || null, "", resolved || "", !!auto) },
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
    // (a task's title and its paper joined by " · ", the Mac's way: no dash)
    taskRows: function (tasks, query, color, nowMs) {
      return V.buildTaskRows(tasks || [], query || "", color, F.filter, at(nowMs)).map(function (r) {
        var x = Object.assign({}, r)
        ;["label", "labelHtml"].forEach(function (f) { if (typeof x[f] === "string") x[f] = x[f].split("\u2014").join("·") }) // (inside a highlight too)
        return x
      })
    },
    taskSummary: function (tasks, pending) { return V.taskSummary(tasks || [], pending || 0) },

    // ---- a paper's extracted text
    fulltextNote: function (details) { return V.fulltextNote(details) || null },
    extractMenu: function (details, noRunner) { return V.buildExtractMenu(details, !!noRunner) },

    // ---- Settings › Rules (the page itself: GlueSettings.js's settingsPage "rules")
    instructionsText: function (text) { return String(text || "").replace(/<!--[\s\S]*?-->/g, "").trim() }
  }
}

if (typeof module !== "undefined") module.exports = GlueRunner
