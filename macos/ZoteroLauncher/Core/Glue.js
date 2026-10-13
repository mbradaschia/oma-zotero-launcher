// The view logic's calls as the Swift side makes them: JSON in, JSON out. A builder that takes a
// function (Fuzzy.filter as `rank`, Views.listRow as `row`) or a Date gets it here, so Swift never
// passes one. Evaluated after js/lib/*.js and contracts/Paths.js, whose exports are globals (JSCore).
// Each wrapper has a golden test (ZoteroLauncherTests/GoldenTests.swift, scripts/goldens.mjs).
var Glue = {
  // Every path the app and its runner use (contracts/Paths.js), as the Omarchy launcher resolves them.
  resolvePaths: function (env, machineSettings, probe) {
    return Paths.resolve(env, machineSettings, probe)
  },

  // The launcher's rows for a /search answer, matches highlighted in `color` ("#rrggbb").
  searchRows: function (response, color, extras) {
    return Views.buildRows(response, color, extras || {})
  }
}

if (typeof module !== "undefined") module.exports = Glue
