/* Zotero Omarchy Bridge: bootstrap for Zotero 10.
 *
 * Hooks are called as fn({ id, version, rootURI }, reason) inside a
 * system-principal sandbox (Zotero, Services, IOUtils, PathUtils, crypto, …).
 * All logic lives in lib/*.js, loaded into one scope object so the files can
 * reference each other's top-level `var`s. Keep this file minimal: Zotero
 * caches it until restart, whereas lib/loader.js is re-read on hot reload.
 */
/* global Services, APP_SHUTDOWN */

var bridge = null;

async function startup({ id, version, rootURI }, reason) {
  const scope = {};
  Services.scriptloader.loadSubScriptWithOptions(`${rootURI}lib/loader.js`, { target: scope, ignoreCache: true });
  scope.omaLoadModules(rootURI, scope);
  bridge = new scope.OmaBridge({ id, version, rootURI });
  await bridge.start(reason);
}

async function shutdown(data, reason) {
  // On app shutdown Zotero is going away anyway; skip cleanup work.
  if (reason === APP_SHUTDOWN) return;
  const current = bridge;
  bridge = null;
  if (current) await current.stop();
}

function install() {}
function uninstall() {}
