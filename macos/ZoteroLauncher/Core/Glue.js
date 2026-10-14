// What Swift calls in the view logic, JSON in and JSON out: each wrapper takes plain values,
// supplies what JSON can't carry, and calls into the modules (globals here, as JSCore loads them;
// required in Node, for scripts/goldens.mjs). One wrapper per builder a phase needs.
var Glue = (function () {
  var V = typeof Views !== "undefined" ? Views : require("../../js/lib/Views.js")
  var P = typeof Paths !== "undefined" ? Paths : require("../../../contracts/Paths.js")
  return {
    resolvePaths: function (env, machineSettings, probe) { return P.resolve(env, machineSettings, probe) },
    // A /search answer's rows, matches highlighted in `color`.
    searchRows: function (response, color, extras) { return V.buildRows(response, color, extras || {}) },
    // A paper's menu (Tab). `pinned`: whether it is pinned; `setup`: whether setup is unfinished.
    actions: function (details, viewerName, prompts, promptsProblem, pinned, setup, extras) {
      return V.buildActions(details, viewerName, prompts, promptsProblem, pinned, setup, extras || {})
    },
    orderRows: function (rows, order) { return V.orderRows(rows, order) },
    pinRows: function (rows, pins) { return V.pinRows(rows, pins) },
    otherRows: function (rows, others) { return V.otherRows(rows, others) },
    filterRows: function (rows, text) { return V.filterRows(rows, text) },
    orderSections: function (rows, order) { return V.orderSections(rows, order) },
    fileRows: function (details, purpose) { return V.buildFileRows(details, purpose) },
    selectionAfter: function (rows, previousKey, followTop) { return V.selectionAfter(rows, previousKey, followTop) }
  }
})()

if (typeof module !== "undefined") module.exports = Glue
