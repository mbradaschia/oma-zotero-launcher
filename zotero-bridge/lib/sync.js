// @ts-check
/* Zotero's own sync, started from the launcher: /sync/start runs it as Zotero's sync button does
 * (Zotero.Sync.Runner.sync, in the background: no dialogs, errors on Zotero's sync icon as usual),
 * and /sync/status says whether sync is set up, whether one is running, how the last one the
 * launcher started ended and when Zotero last synced. The helpers that shape the answers are pure
 * (node-tested). */
/* global Zotero, omaHttpError */

var OmaSync = {
  // The last sync started here: { running, started, finished, ok, error } (ISO dates).
  run: { running: false, started: "", finished: "", ok: null, error: "" },

  register(bridge) {
    bridge.route("POST", "/sync/status", OmaSync.status);
    bridge.route("POST", "/sync/start", OmaSync.start);
  },

  // An error from a sync → one line for the launcher: Zotero's message, or what to do about a missing key.
  errorText(e) {
    if (!e) return "";
    const code = e.error != null ? e.error : null;
    const notSet = typeof Zotero !== "undefined" && Zotero.Error && code === Zotero.Error.ERROR_API_KEY_NOT_SET;
    if (notSet || /API key not set/i.test(String(e.message || ""))) return "Not signed in: Zotero › Settings › Sync";
    return String(e.message || e).split("\n")[0].trim().slice(0, 300) || "the sync failed";
  },

  // A date (or false/null) → ISO, or "" when there's none.
  iso(d) {
    if (!d) return "";
    const t = d instanceof Date ? d : new Date(d);
    return isNaN(t.getTime()) ? "" : t.toISOString();
  },

  // What /sync/status answers, from Zotero's state ({ enabled, inProgress, statusText, lastSync }) and the
  // last run started here.
  describe(z, run) {
    return {
      configured: !!z.enabled,
      running: !!(run.running || z.inProgress),
      status: z.statusText ? String(z.statusText) : "",
      lastSync: OmaSync.iso(z.lastSync),
      run: Object.assign({}, run),
    };
  },

  _zotero() {
    const runner = Zotero.Sync.Runner;
    let lastSync = null;
    try {
      lastSync = Zotero.Sync.Data.Local.getLastSyncTime();
    } catch (e) {
      lastSync = null; // not loaded yet
    }
    return { enabled: runner.enabled, inProgress: runner.syncInProgress, statusText: runner.lastSyncStatus, lastSync };
  },

  /** POST /sync/status. */
  async status() {
    return OmaSync.describe(OmaSync._zotero(), OmaSync.run);
  },

  /**
   * POST /sync/start: starts a sync and answers at once ({ started: true }); /sync/status follows it.
   * Not set up → 409 not-configured; one already running → { started: false } (it's followed the same).
   */
  async start() {
    const z = OmaSync._zotero();
    if (!z.enabled) throw omaHttpError(409, "not-configured", "Zotero sync isn't set up: sign in under Zotero › Settings › Sync");
    if (OmaSync.run.running || z.inProgress) return Object.assign({ started: false }, OmaSync.describe(z, OmaSync.run));
    const errors = [];
    OmaSync.run = { running: true, started: new Date().toISOString(), finished: "", ok: null, error: "" };
    const runner = Zotero.Sync.Runner;
    Promise.resolve()
      .then(() =>
        runner.sync({
          background: true,
          onError: (e) => {
            errors.push(e);
            runner.addError(e); // Zotero's sync icon shows it too, as for its own syncs
          },
        })
      )
      .catch((e) => errors.push(e))
      .then(() => {
        OmaSync.run = { running: false, started: OmaSync.run.started, finished: new Date().toISOString(), ok: !errors.length, error: OmaSync.errorText(errors[0]) };
      });
    return Object.assign({ started: true }, OmaSync.describe(z, OmaSync.run));
  },
};

if (typeof module !== "undefined") module.exports = OmaSync;
