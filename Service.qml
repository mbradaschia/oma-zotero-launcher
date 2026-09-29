import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import qs.Commons
import "lib/Client.js" as Client
import "lib/Views.js" as Views

// Background half of the plugin, mounted at shell start. Talks to the Zotero
// bridge (zotero-bridge/) over its token-protected local routes, tracks whether
// Zotero/the bridge are reachable, and focuses Zotero windows via Hyprland.
Item {
  id: root

  property var shell: null
  property var manifest: null

  readonly property string runtimeDir: Quickshell.env("XDG_RUNTIME_DIR") || "/tmp"
  readonly property string handshakePath: runtimeDir + "/oma-zotero/bridge.json"
  readonly property string settingsPath: Quickshell.env("HOME") + "/.config/omarchy/oma-zotero-launcher.json"
  readonly property string configDir: Quickshell.env("HOME") + "/.config/omarchy/oma-zotero-launcher"
  readonly property string pinsPath: configDir + "/pins.json"

  property var bridge: null // { port, token, bridgeVersion, zoteroVersion }
  // Effective settings (Client.normalizeSettings: defaults for anything missing or invalid).
  property var settings: Client.normalizeSettings(null).settings
  property var settingsProblems: [] // human-readable, e.g. "maxResults must be a number from 10 to 200"
  // unknown | ready | zotero-down | bridge-missing | unauthorized | error
  property string status: "unknown"
  property string statusDetail: ""
  property int itemCount: 0

  readonly property bool selectOnEnter: settings.enterAction === "select"
  readonly property int searchLimit: settings.maxResults
  readonly property int defaultPort: settings.port
  readonly property bool accelerators: settings.accelerators

  signal searchResult(var response)
  signal searchFailed(string kind, string message)

  // ------------------------------------------------------------ files

  FileView {
    id: handshakeFile
    path: root.handshakePath
    printErrors: false
    // Tiny file; loading synchronously means refreshHandshake() + retry sees the new token.
    blockLoading: true
    watchChanges: true
    onFileChanged: reload()
    onLoaded: root.bridge = Client.parseHandshake(text())
    onLoadFailed: root.bridge = null
  }

  // Items pinned to the top of the list before you type: [{ key, libraryID, title }].
  property var pins: []

  FileView {
    id: pinsFile
    path: root.pinsPath
    printErrors: false
    blockLoading: true
    watchChanges: true
    onFileChanged: reload()
    onLoaded: root.pins = Views.parsePins(text())
    onLoadFailed: root.pins = []
  }

  function savePins(list) {
    root.pins = list
    pinsFile.setText(JSON.stringify({ pins: list }, null, 2) + "\n")
  }

  FileView {
    id: settingsFile
    path: root.settingsPath
    printErrors: false
    // Small file; synchronous so refreshSettings() applies before the next search.
    blockLoading: true
    watchChanges: true
    onFileChanged: reload()
    onLoaded: root.applySettings(text())
    onLoadFailed: root.applySettings(null)
  }

  function applySettings(text) {
    let raw = null
    let problems = []
    if (text !== null && String(text).trim()) {
      try {
        raw = JSON.parse(text)
      } catch (e) {
        problems.push("not valid JSON (" + e.message + ")")
      }
    }
    const res = Client.normalizeSettings(raw)
    root.settings = res.settings
    root.settingsProblems = problems.concat(res.problems)
    for (const p of root.settingsProblems) console.warn("oma-zotero: " + root.settingsPath + ": " + p)
  }

  // The handshake dir may not exist until Zotero starts, and a settings file created
  // after the shell started isn't watched yet, so both are re-read on demand too.
  function refreshHandshake() {
    handshakeFile.reload()
  }

  function refreshSettings() {
    settingsFile.reload()
  }

  // ------------------------------------------------------------ HTTP

  // In-flight requests: { xhr, deadline, done, timedOut, cb }. QML's XHR has no
  // timeout, so a Timer aborts overdue ones.
  property var _requests: []
  property int _inFlight: 0

  Timer {
    interval: 100
    repeat: true
    running: root._inFlight > 0
    onTriggered: root._checkDeadlines()
  }

  function _track(rec) {
    root._requests.push(rec)
    root._inFlight = root._requests.length
  }

  function _untrack(rec) {
    const i = root._requests.indexOf(rec)
    if (i >= 0) root._requests.splice(i, 1)
    root._inFlight = root._requests.length
  }

  function _finish(rec, outcome) {
    if (rec.done) return
    rec.done = true
    root._untrack(rec)
    rec.cb(outcome)
  }

  function _checkDeadlines() {
    const now = Date.now()
    for (const rec of root._requests.slice()) {
      if (rec.done || now < rec.deadline) continue
      rec.timedOut = true
      try { rec.xhr.abort() } catch (e) {}
      root._finish(rec, { kind: "timeout" })
    }
  }

  // Raw XHR with a deadline; cb(status, responseText, timedOut).
  function _xhr(method, url, headers, body, timeoutMs, cb) {
    const xhr = new XMLHttpRequest()
    const rec = { xhr: xhr, deadline: Date.now() + timeoutMs, done: false, timedOut: false, cb: null }
    rec.cb = function(outcome) { cb(outcome.status, outcome.text, outcome.kind === "timeout") }
    xhr.onreadystatechange = function() {
      // abort() on a deadline fires DONE (status 0) synchronously: that is a timeout, not "Zotero is down".
      if (xhr.readyState === XMLHttpRequest.DONE) root._finish(rec, rec.timedOut ? { kind: "timeout" } : { status: xhr.status, text: xhr.responseText })
    }
    xhr.open(method, url)
    for (const h of headers) xhr.setRequestHeader(h[0], h[1])
    root._track(rec)
    xhr.send(body === null ? "" : JSON.stringify(body))
  }

  // Bridge call → cb({ kind: "ok", data } | { kind, message }).
  function request(method, path, body, timeoutMs, cb, retried) {
    if (!root.bridge) {
      root.refreshHandshake()
      root.probeZotero(function(up) {
        const kind = up ? "bridge-missing" : "zotero-down"
        root.setStatus(kind, "")
        cb({ kind: kind, message: "" })
      })
      return
    }
    root._xhr(method, Client.baseUrl(root.bridge) + path, Client.headers(root.bridge), body, timeoutMs, function(status, text, timedOut) {
      const res = Client.classify(status, text, timedOut)
      if (res.kind === "unauthorized" && !retried) {
        // Zotero restarted with a new handshake we haven't read yet: re-read once.
        root.refreshHandshake()
        Qt.callLater(function() { root.request(method, path, body, timeoutMs, cb, true) })
        return
      }
      if (res.kind === "ok") root.setStatus("ready", "")
      else if (res.kind === "zotero-down" || res.kind === "bridge-missing" || res.kind === "unauthorized") root.setStatus(res.kind, "")
      cb(res)
    })
  }

  // Is Zotero itself up (connector ping), independent of the bridge?
  function probeZotero(cb) {
    const port = root.bridge ? root.bridge.port : root.defaultPort
    root._xhr("GET", "http://127.0.0.1:" + port + "/connector/ping", [[Client.ALLOWED_HEADER, "1"]], null, 1500, function(status) {
      cb(status === 200)
    })
  }

  function setStatus(status, detail) {
    root.status = status
    root.statusDetail = detail || ""
  }

  // ------------------------------------------------------------ search

  property var _queue: Client.newQueue()

  // Coalesced: one request in flight; results for the newest query win.
  // `scope`: { key, libraryID } to search inside a collection (and its subcollections), or null.
  function search(query, scope) {
    const next = Client.enqueue(root._queue, { query: String(query || ""), scope: scope || null })
    if (next !== null) root._sendSearch(next)
  }

  function _sendSearch(req) {
    const query = req.query
    const body = { query: query, limit: root.searchLimit }
    if (req.scope) body.collection = { key: req.scope.key, libraryID: req.scope.libraryID }
    else if (!query.trim()) {
      if (root.settings.emptyQuery) body.emptyQuery = root.settings.emptyQuery
      if (root.pins.length) body.pinned = root.pins.map(function(p) { return { key: p.key, libraryID: p.libraryID, type: p.type } })
    }
    root.request("POST", "/search", body, 4000, function(res) {
      if (res.kind === "ok") root.searchResult(res.data)
      else root.searchFailed(res.kind, res.message || "")
      const next = Client.done(root._queue)
      if (next !== null) root._sendSearch(next)
    })
  }

  function ping() {
    root.request("GET", "/ping", null, 2000, function(res) {
      if (res.kind === "ok") root.itemCount = res.data.index && res.data.index.count ? res.data.index.count : root.itemCount
    })
  }

  // ------------------------------------------------------------ actions

  // Name of the default PDF app ("Evince"), shown next to "Open PDF externally".
  property string pdfViewer: ""
  readonly property string pdfViewerLabel: {
    const custom = root.settings.externalPdfCommand || []
    return custom.length ? Client.appName(String(custom[0]).split("/").pop()) : root.pdfViewer
  }

  Process {
    running: true
    command: ["xdg-mime", "query", "default", "application/pdf"]
    stdout: StdioCollector { id: pdfAppOut; waitForEnd: true }
    onExited: root.pdfViewer = Client.appName(pdfAppOut.text)
  }

  // Enter: switch to / open the item in Zotero (or just select it), then focus Zotero.
  function openItem(row) {
    const path = root.selectOnEnter ? "/reveal" : "/open"
    root.request("POST", path, { key: row.key, libraryID: row.libraryID }, 8000, function(res) {
      if (res.kind === "ok") {
        root.focusZotero(res.data.windowKind, res.data.windowTitle)
      } else if (res.kind === "zotero-down") {
        root.launchZotero()
      } else {
        root.notify("Couldn't open “" + (row.title || row.key) + "”", res.message || res.kind)
      }
    })
  }

  // Tab → actions: what Enter would do, the item's files, counts.
  // (8 s: right after heavy UI work, e.g. selecting in a large library, Zotero can be slow to answer.)
  function itemDetails(row, cb) {
    root.request("POST", "/item", { key: row.key, libraryID: row.libraryID }, 8000, cb)
  }

  // Show the item selected in Zotero's library, then focus Zotero.
  function reveal(row) {
    root.request("POST", "/reveal", { key: row.key, libraryID: row.libraryID }, 8000, function(res) {
      if (res.kind === "ok") root.focusZotero("main", res.data.windowTitle)
      else if (res.kind === "zotero-down") root.launchZotero()
      else root.notify("Couldn't show “" + (row.title || row.key) + "” in the library", res.message || res.kind)
    })
  }

  // Open one file attachment in the external viewer (the bridge resolves the
  // path and, like Zotero, records it as opened). The viewer's window takes focus.
  function openExternal(att) {
    root.request("POST", "/attachment", { key: att.key, libraryID: att.libraryID, target: "path" }, 4000, function(res) {
      if (res.kind === "ok") Util.execArgv(Client.externalCommand(root.settings, res.data.contentType, res.data.path))
      else root.notify("Couldn't open the file", res.message || res.kind)
    })
  }

  // A note as Markdown. opts.format "display" (cleaned for the overlay; web links in
  // opts.linkColor) or "export" (Zotero's own Export Note → Markdown, for copying).
  function noteContent(note, opts, cb) {
    const body = { key: note.key, libraryID: note.libraryID, format: (opts && opts.format) || "display" }
    if (opts && opts.linkColor) body.linkColor = opts.linkColor
    root.request("POST", "/note", body, 8000, cb)
  }

  // Open a note in Zotero's note editor (or switch to its tab), then focus Zotero.
  function openNote(note) {
    root.request("POST", "/open", { key: note.key, libraryID: note.libraryID }, 8000, function(res) {
      if (res.kind === "ok") root.focusZotero(res.data.windowKind, res.data.windowTitle)
      else if (res.kind === "zotero-down") root.launchZotero()
      else root.notify("Couldn't open the note", res.message || res.kind)
    })
  }

  // Tags: the library's tags for the editor, and add/remove edits on one item.
  function tagList(libraryID, cb) {
    root.request("POST", "/tags/list", { libraryID: libraryID }, 4000, cb)
  }

  function updateTags(item, add, remove, cb) {
    root.request("POST", "/tags/update", { key: item.key, libraryID: item.libraryID, add: add, remove: remove }, 8000, cb)
  }

  // Copy text to the clipboard with wl-copy, fed on stdin (notes can be longer than an argument may be).
  Process {
    id: copyProc
    property string pending: ""
    command: ["wl-copy", "--type", "text/plain;charset=utf-8"]
    stdinEnabled: true
    onStarted: {
      write(copyProc.pending)
      copyProc.pending = ""
      stdinEnabled = false // closes stdin: wl-copy takes the text and serves it in the background
    }
  }

  // Save Markdown as "<name>.md" in the Downloads folder (xdg-user-dir), never over an
  // existing file ("<name> (2).md", …), fed on stdin; cb(path) or cb("", error).
  Process {
    id: saveProc
    property string pending: ""
    property var cb: null
    stdinEnabled: true
    stdout: StdioCollector { id: saveOut; waitForEnd: true }
    stderr: StdioCollector { id: saveErr; waitForEnd: true }
    onStarted: {
      write(saveProc.pending)
      saveProc.pending = ""
      stdinEnabled = false
    }
    onExited: (code) => {
      const cb = saveProc.cb
      saveProc.cb = null
      if (cb) cb(code === 0 ? saveOut.text.trim() : "", code === 0 ? "" : String(saveErr.text || "failed").trim())
    }
  }

  function saveMarkdown(name, text, cb) {
    if (saveProc.running) return false
    const script = 'd=$(xdg-user-dir DOWNLOAD 2>/dev/null); [ -n "$d" ] && [ "$d" != "$HOME" ] || d="$HOME/Downloads"; mkdir -p "$d" || exit 1; '
      + 'f="$d/$1.md"; i=2; while [ -e "$f" ]; do f="$d/$1 ($i).md"; i=$((i+1)); done; cat > "$f" && printf %s "$f"'
    saveProc.command = ["bash", "-c", script, "bash", Client.fileName(name)]
    saveProc.pending = String(text)
    saveProc.cb = cb
    saveProc.stdinEnabled = true
    saveProc.running = true
    return true
  }

  function copyText(text) {
    if (copyProc.running) return false
    copyProc.pending = String(text)
    copyProc.stdinEnabled = true
    copyProc.running = true
    return true
  }

  // Open one file attachment in a separate Zotero reader window, which takes focus when it maps.
  function openInWindow(att) {
    root.request("POST", "/attachment", { key: att.key, libraryID: att.libraryID, target: "window" }, 8000, function(res) {
      if (res.kind !== "ok") root.notify("Couldn't open a Zotero window", res.message || res.kind)
    })
  }

  // The Zotero window to focus: exact title match (reader/note windows), else
  // the main window (initialTitle "Zotero", title "… - Zotero"), else any.
  function zoteroToplevel(windowKind, windowTitle) {
    const list = Hyprland.toplevels.values
    let byTitle = null, main = null, any = null
    for (let i = 0; i < list.length; i++) {
      const t = list[i]
      const ipc = t.lastIpcObject || {}
      const title = String(t.title || "")
      const isZotero = ipc.class === "Zotero" || / - Zotero$/.test(title)
      if (!isZotero) continue
      if (!any) any = t
      if (windowTitle && title === windowTitle) byTitle = t
      if (!main && (ipc.initialTitle === "Zotero" || / - Zotero$/.test(title))) main = t
    }
    return byTitle || (windowKind === "main" ? main : null) || main || any
  }

  // A collection selected in Zotero's collection tree (library tab), then Zotero focused.
  function revealCollection(row) {
    root.request("POST", "/collection/reveal", { key: row.key, libraryID: row.libraryID }, 8000, function(res) {
      if (res.kind === "ok") root.focusZotero("main", res.data.windowTitle)
      else if (res.kind === "zotero-down") root.launchZotero()
      else root.notify("Couldn't show the collection in Zotero", res.message || res.kind)
    })
  }

  function focusZotero(windowKind, windowTitle) {
    const t = root.zoteroToplevel(windowKind, windowTitle)
    const selector = t ? "address:0x" + String(t.address).replace(/^0x/, "") : "class:^(Zotero)$"
    Hyprland.dispatch("hl.dsp.focus({ window = \"" + selector + "\" })")
  }

  function launchZotero() {
    Util.execArgv(["uwsm-app", "--", "zotero"])
  }

  // ------------------------------------------------------------ prompts (daemon/bin/oma-zotero-prompt.mjs)

  // [{ id, title, model, effort }]; null until listed, or when the runner isn't installed.
  property var prompts: null
  property string promptsProblem: ""

  Process {
    id: promptListProc
    stdout: StdioCollector { id: promptListOut; waitForEnd: true }
    stderr: StdioCollector { id: promptListErr; waitForEnd: true }
    onExited: (code) => {
      const list = code === 0 ? Client.parsePromptList(promptListOut.text) : null
      root.promptsProblem = list ? "" : (code === 127 ? "oma-zotero-prompt isn't installed: make prompts-install" : String(promptListErr.text || "can't list the prompts").trim().split("\n").pop())
      root.prompts = list // after promptsProblem: onPromptsChanged handlers read both
    }
  }

  function refreshPrompts() {
    if (promptListProc.running) return
    promptListProc.command = ["bash", "-lc", 'exec "$@"', "bash"].concat(Client.promptArgv(root.settings, ["list", "--json"]))
    promptListProc.running = true
  }

  // Detached: the runner notifies when it starts, when the note is saved, and on errors.
  function runPrompt(id, item) {
    const args = ["run", id, "--key", item.key]
    if (item.libraryID) args.push("--library", String(item.libraryID))
    Util.execArgv(Client.promptArgv(root.settings, args))
  }

  // The paper's PDF text as a page-numbered note, in the background (the runner notifies).
  function extractText(item) {
    Util.execArgv(Client.promptArgv(root.settings, ["extract", "--key", item.key, "--library", String(item.libraryID || 1)]))
  }

  // The prompt's text, in the user's editor.
  function editPromptText(id) {
    Util.execArgv(Client.promptArgv(root.settings, ["edit", id]))
  }

  // Claude's models with their effort levels ([{ value, displayName, description, efforts }]),
  // from the Agent SDK through the runner (cached there for a day); null until listed.
  property var models: null
  property string modelsProblem: ""

  Process {
    id: modelsProc
    stdout: StdioCollector { id: modelsOut; waitForEnd: true }
    stderr: StdioCollector { id: modelsErr; waitForEnd: true }
    onExited: (code) => {
      let list = null
      try {
        const j = JSON.parse(modelsOut.text)
        if (j && Array.isArray(j.models)) list = j.models
      } catch (e) {}
      root.modelsProblem = list ? "" : String(modelsErr.text || "can't list Claude's models").trim().split("\n").pop()
      root.models = list
    }
  }

  function refreshModels() {
    if (modelsProc.running) return
    modelsProc.command = ["bash", "-lc", 'exec "$@"', "bash"].concat(Client.promptArgv(root.settings, ["models", "--json"]))
    modelsProc.running = true
  }

  // Prompt writes (new, set) run one at a time; cb(ok, json, error) after each, then the list is re-read.
  property var _promptJobs: []

  Process {
    id: promptJobProc
    property var job: null
    stdout: StdioCollector { id: promptJobOut; waitForEnd: true }
    stderr: StdioCollector { id: promptJobErr; waitForEnd: true }
    onExited: (code) => {
      const job = promptJobProc.job
      promptJobProc.job = null
      let data = null
      try { data = JSON.parse(promptJobOut.text) } catch (e) {}
      const error = code === 0 ? "" : String(promptJobErr.text || "failed").trim().split("\n").pop().replace(/^oma-zotero-prompt: /, "")
      if (job && job.cb) job.cb(code === 0, data, error)
      root.refreshPrompts()
      root._nextPromptJob()
    }
  }

  function _nextPromptJob() {
    if (promptJobProc.running || !root._promptJobs.length) return
    const job = root._promptJobs[0]
    root._promptJobs = root._promptJobs.slice(1)
    promptJobProc.job = job
    promptJobProc.command = ["bash", "-lc", 'exec "$@"', "bash"].concat(Client.promptArgv(root.settings, job.args))
    promptJobProc.running = true
  }

  function _promptJob(args, cb) {
    root._promptJobs = root._promptJobs.concat([{ args: args, cb: cb }])
    root._nextPromptJob()
  }

  // A new prompt named `title` (not opened in the editor): cb(ok, { id, path }, error).
  function newPrompt(title, cb) {
    root._promptJob(["new", String(title || "New prompt"), "--json", "--no-edit"], cb)
  }

  // changes: { title?, model?, effort? } ("" effort = the model's default).
  function setPrompt(id, changes, cb) {
    const args = ["set", id]
    if (changes.title !== undefined) args.push("--title", String(changes.title))
    if (changes.model !== undefined) args.push("--model", String(changes.model))
    if (changes.effort !== undefined) args.push("--effort", changes.effort === "" ? "default" : String(changes.effort))
    root._promptJob(args, cb)
  }

  function notify(summary, body) {
    Util.execArgv(["notify-send", "-a", "Zotero", String(summary), String(body || "")])
  }

  Component.onCompleted: {
    Hyprland.refreshToplevels()
    Quickshell.execDetached(["mkdir", "-p", root.configDir]) // for pins.json (FileView doesn't create it)
  }
}
