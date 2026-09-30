/* Loads the bridge modules into the plugin scope, in dependency order.
 *
 * This list lives here rather than in bootstrap.js on purpose: Zotero keeps
 * bootstrap.js cached until it restarts, while this file and the modules are
 * re-read (uncached) on every hot reload (make bridge-reload). */
/* global Services, Zotero */

var OMA_MODULES = ["noteFormat", "search", "tabs", "rankingsData", "rankings", "index", "collections", "facets", "notes", "tags", "actions", "annotations", "fulltext", "cite", "dev", "bridge"];
// Release builds leave these out (scripts/build-xpi.sh).
var OMA_OPTIONAL_MODULES = ["dev"];

function omaLoadModules(rootURI, target) {
  for (const name of OMA_MODULES) {
    try {
      Services.scriptloader.loadSubScriptWithOptions(`${rootURI}lib/${name}.js`, { target, ignoreCache: true });
    } catch (e) {
      if (!OMA_OPTIONAL_MODULES.includes(name)) throw e;
      if (Services.prefs.getBoolPref("extensions.oma-zotero-bridge.dev", false)) Zotero.logError(e);
    }
  }
}
