import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import qs.Commons
import "lib/Client.js" as Client
import "lib/Views.js" as Views
import "lib/Settings.js" as Settings
import "lib/Todos.js" as Todos

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

  // Saved searches, in your order: [{ id, name, query, pinned }]; the pinned ones are the
  // badges above the results.
  readonly property string searchesPath: configDir + "/searches.json"
  property var searches: []

  FileView {
    id: searchesFile
    path: root.searchesPath
    printErrors: false
    blockLoading: true
    watchChanges: true
    onFileChanged: reload()
    onLoaded: root.searches = Views.parseSearches(text())
    onLoadFailed: root.searches = []
  }

  function saveSearches(list) {
    root.searches = list
    searchesFile.setText(JSON.stringify({ searches: list }, null, 2) + "\n")
  }

  // How you arranged things, kept in view.json: the notes' text size (the launcher's reader and the
  // note windows; 0 = the theme's; Ctrl+- / Ctrl++, Ctrl+0), your order of a paper's notes
  // (Shift+↑/↓: { "<libraryID>:<key>": [note keys] }) and of each menu's sections
  // (Ctrl+Shift+↑/↓: { "<view>": [section names] }).
  readonly property string viewPath: configDir + "/view.json"
  property var viewPrefs: ({})
  readonly property int noteFontSize: {
    const n = Number(root.viewPrefs.noteFontSize) || 0
    return n >= 8 && n <= 40 ? Math.round(n) : 0
  }
  readonly property int noteTextSize: root.noteFontSize || Style.font.title
  readonly property var noteOrder: root.viewPrefs.noteOrder && typeof root.viewPrefs.noteOrder === "object" ? root.viewPrefs.noteOrder : ({})
  readonly property var sectionOrder: root.viewPrefs.sectionOrder && typeof root.viewPrefs.sectionOrder === "object" ? root.viewPrefs.sectionOrder : ({})

  FileView {
    id: viewFile
    path: root.viewPath
    printErrors: false
    blockLoading: true
    watchChanges: true
    onFileChanged: reload()
    onLoaded: {
      let j = {}
      try { j = JSON.parse(text()) || {} } catch (e) {}
      root.viewPrefs = typeof j === "object" && !Array.isArray(j) ? j : {}
    }
    onLoadFailed: root.viewPrefs = ({})
  }

  function setViewPref(key, value) {
    const next = Object.assign({}, root.viewPrefs)
    if (value === undefined) delete next[key]
    else next[key] = value
    root.viewPrefs = next
    viewFile.setText(JSON.stringify(next, null, 2) + "\n")
  }

  // step: +1 / -1 (a px at a time), or 0 to reset. → the new size.
  function stepNoteFont(step) {
    const next = step === 0 ? 0 : Math.max(8, Math.min(40, root.noteTextSize + step))
    root.setViewPref("noteFontSize", next === Style.font.title ? 0 : next)
    return root.noteTextSize
  }

  function saveNoteOrder(itemId, keys) {
    const all = Object.assign({}, root.noteOrder)
    all[itemId] = keys
    root.setViewPref("noteOrder", all)
  }

  function saveSectionOrder(view, names) {
    const all = Object.assign({}, root.sectionOrder)
    all[view] = names
    root.setViewPref("sectionOrder", all)
  }

  // Rename or forget one of a paper's chats (the runner): cb(ok, data, error).
  function renameChat(item, id, title, cb) {
    root._promptJob(["chat-rename", "--key", item.key, "--library", String(item.libraryID || 1), "--session", id, "--title", String(title)], function(ok, data, error) {
      root.refreshChats()
      if (cb) cb(ok, data, error)
    })
  }

  function deleteChat(item, id, cb) {
    root._promptJob(["chat-delete", "--key", item.key, "--library", String(item.libraryID || 1), "--session", id], function(ok, data, error) {
      root.refreshChats()
      if (cb) cb(ok, data, error)
    })
  }

  // Tasks (to-dos) about your papers: todos.json in the config folder, newest first unless you
  // reorder them; their statuses come from the settings (Settings › Tasks), else the defaults.
  readonly property string todosPath: configDir + "/todos.json"
  property var todos: []
  readonly property var todoStatuses: Todos.statusesOf(root.settings)

  FileView {
    id: todosFile
    path: root.todosPath
    printErrors: false
    blockLoading: true
    watchChanges: true
    onFileChanged: reload()
    onLoaded: {
      root.todos = Todos.parseTodos(text())
      root.todosLoaded = true
      root.syncTaskTags()
    }
    onLoadFailed: root.todos = []
  }

  // Saved, and the papers they're about tagged in Zotero with their tasks' statuses (t/Reading),
  // gaining and losing tags as tasks change. beforeStatuses: the statuses the old list was read
  // with, when they changed too (a status removed: its tasks moved).
  function saveTodos(list, beforeStatuses) {
    const before = root.todos
    const was = beforeStatuses || root.todoStatuses
    root.todos = list
    todosFile.setText(Todos.serializeTodos(list))
    root.applyTaskTags(Todos.taskTagChanges(before, was, list, root.todoStatuses))
  }

  function applyTaskTags(changes) {
    if (root.status !== "ready") return // a full sync catches up when Zotero is back
    changes.forEach(function(c) {
      const remove = c.remove.filter(function(t) { return c.add.indexOf(t) < 0 })
      if (!c.add.length && !remove.length) return
      root.updateTags(c.item, c.add, remove, function(res) {
        if (res.kind !== "ok") console.warn("oma-zotero: task tags for " + c.item.key + ": " + (res.message || res.kind))
      })
    })
  }

  // Once Zotero answers and the tasks are read: every paper with tasks gets its t/ tags (tasks made
  // before this, or changed while Zotero was closed).
  property bool taskTagsSynced: false
  property bool todosLoaded: false
  function syncTaskTags() {
    if (root.taskTagsSynced || !root.todosLoaded) return
    if (root.status !== "ready") { if (!taskTagRetry.running) taskTagRetry.start(); return } // a ping that answers calls back here
    root.taskTagsSynced = true
    root.applyTaskTags(Todos.taskTagSync(root.todos, root.todoStatuses))
    root.syncStatusLists()
  }
  Connections {
    target: root
    function onStatusChanged() { root.syncTaskTags() }
  }

  // Until Zotero answers (the bridge's handshake may come a moment after the tasks): a ping every
  // 5 s, for two minutes; the launcher opening pings too.
  Timer {
    id: taskTagRetry
    property int tries: 0
    interval: 5000
    repeat: true
    onTriggered: {
      if (root.taskTagsSynced || ++tries > 24) return stop()
      root.ping()
    }
  }

  // Zotero → the status lists (each opening): s/… and t/… tags made in Zotero become statuses, and
  // ones renamed there are renamed here (Todos.statusListsFromZotero). tagChangesSeq: how far into
  // the bridge's log of changes we've read.
  property int tagChangesSeq: 0
  property var removedStatusTags: ({}) // "t/reading": true, removed in this session
  function forgetStatusTag(tag) {
    const m = Object.assign({}, root.removedStatusTags)
    m[String(tag).toLowerCase()] = true
    root.removedStatusTags = m
  }
  property bool statusSyncRunning: false
  function syncStatusLists() {
    if (root.status !== "ready" || root.statusSyncRunning) return
    root.statusSyncRunning = true
    root.request("POST", "/tags/prefixed", { prefixes: [Client.PAPER_TAG_PREFIX, Client.TASK_TAG_PREFIX] }, 8000, function(listed) {
      root.request("POST", "/tags/changes", { since: root.tagChangesSeq }, 8000, function(log) {
        root.statusSyncRunning = false
        if (listed.kind !== "ok" || log.kind !== "ok") return
        if (log.data.seq < root.tagChangesSeq) root.tagChangesSeq = 0 // Zotero restarted: its log too
        // a status removed here a moment ago: its tag may still be on papers (being taken off) or not
        // yet purged; not brought back
        const tags = (listed.data.tags || []).filter(function(t) { return !root.removedStatusTags[String(t).toLowerCase()] })
        const r = Todos.statusListsFromZotero(root.settings.paperStatuses || [], root.todoStatuses, tags, log.data.changes || [],
          Client.PAPER_TAG_PREFIX, Client.TASK_TAG_PREFIX)
        root.tagChangesSeq = log.data.seq
        if (!r.changed) return
        let next = Settings.withValue(root.settings, "paperStatuses", r.paper)
        next = Settings.withValue(next, "tasks", Object.assign({}, root.settings.tasks || {}, { statuses: r.statuses }))
        const err = root.saveSettings(next)
        if (err) console.warn("oma-zotero: status lists from Zotero not saved: " + err)
      })
    })
  }

  // A tag across your libraries: how many papers have it; renamed (merging into an existing one)
  // or deleted on all of them. cb(res).
  function tagCount(name, cb) { root.request("POST", "/tags/count", { name: name }, 8000, cb) }
  function tagRename(from, to, cb) { root.request("POST", "/tags/rename", { from: from, to: to }, 30000, cb || function() {}) }
  function tagDelete(name, cb) { root.request("POST", "/tags/delete", { name: name }, 30000, cb || function() {}) }

  // Your statuses changed (Settings › Tasks): saved in the settings; tasks of a removed status move.
  // → "" when saved, else why not.
  // The actions @ offers in a new task's line (Settings › Tasks).
  readonly property var taskActions: Todos.actionsOf(root.settings)

  function saveTaskActions(list) {
    const tasks = Object.assign({}, root.settings.tasks || {}, { actions: list })
    return root.saveSettings(Settings.withValue(root.settings, "tasks", tasks))
  }

  function saveStatuses(statuses, moveFrom, moveTo) {
    const old = root.todoStatuses
    const err = root.saveSettings(Settings.withValue(root.settings, "tasks", Object.assign({}, root.settings.tasks || {}, { statuses: statuses })))
    if (err) return err
    // a status renamed: its tag on the papers, renamed with it (t/Reading → t/Reading now)
    statuses.forEach(function(s) {
      const o = old.filter(function(x) { return x.id === s.id })[0]
      if (o && o.name !== s.name && root.status === "ready") root.tagRename(Todos.TASK_TAG_PREFIX + o.name, Todos.TASK_TAG_PREFIX + s.name)
    })
    old.forEach(function(o) { if (!statuses.some(function(s) { return s.id === o.id })) root.forgetStatusTag(Todos.TASK_TAG_PREFIX + o.name) })
    // a status removed: its tasks move, and their papers' tags with them
    if (moveFrom) root.saveTodos(root.todos.map(function(t) { return t.status === moveFrom ? Object.assign({}, t, { status: moveTo }) : t }), old)
    return ""
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
  // `scope`: { key, libraryID } to search inside a collection (and its subcollections); type "tag":
  // among a tag's papers; type "search": within a saved search ({ key: its id, title, query }); or null.
  function search(query, scope) {
    const next = Client.enqueue(root._queue, { query: String(query || ""), scope: scope || null })
    if (next !== null) root._sendSearch(next)
  }

  function _sendSearch(req) {
    const query = req.query
    const body = { query: query, limit: root.searchLimit, statusTags: Client.statusTags(root.settings.paperStatuses), statusPrefix: Client.PAPER_TAG_PREFIX, marks: root.searchMarks() }
    if (req.scope && req.scope.type === "search") body.within = { id: req.scope.key, title: req.scope.title, query: req.scope.query }
    else if (req.scope && req.scope.type === "tag") body.tag = { name: req.scope.key, libraryID: req.scope.libraryID }
    else if (req.scope) body.collection = { key: req.scope.key, libraryID: req.scope.libraryID }
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

  // The @ picker's values for one field (tag, author, publication, year, collection, type, has): the
  // best `limit` for what is typed, matched in the bridge (a library has thousands of authors).
  function facets(field, query, limit, cb) {
    root.request("POST", "/facets", { field: field, query: String(query || ""), limit: limit, statusTags: Client.statusTags(root.settings.paperStatuses), statusPrefix: Client.PAPER_TAG_PREFIX, marks: root.searchMarks() }, 8000, cb)
  }

  // What the bridge can't know, for task:, has:task and has:chat: the papers with a task (its
  // status and group) and those with a chat.
  function searchMarks() {
    return Client.searchMarks(root.todos, root.todoStatuses, root.chats, Todos.statusOfTodo)
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
    Util.execArgv(Client.zoteroArgv(root.settings))
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
    tasksStart.restart()
  }

  // A new task shows up once the runner has started (it writes the index itself; this is
  // a fallback when the file watch misses the first write).
  Timer {
    id: tasksStart
    interval: 1500
    onTriggered: tasksFile.reload()
  }

  // ------------------------------------------------------------ tasks and chats

  // The runner's task queue (prompt runs, extractions), newest first, from the index it
  // rewrites on every change: [{ id, kind, title, paper, key, libraryID, status, noteKey, … }].
  readonly property string tasksPath: (Quickshell.env("XDG_STATE_HOME") || Quickshell.env("HOME") + "/.local/state") + "/oma-zotero/tasks/tasks.json"
  property var tasks: []

  FileView {
    id: tasksFile
    path: root.tasksPath
    printErrors: false
    watchChanges: true
    onFileChanged: reload()
    onLoaded: {
      try { root.tasks = JSON.parse(text()).tasks || [] } catch (e) {}
    }
    onLoadFailed: root.tasks = []
  }

  // Re-read the queue through the runner (it also marks runs that died as stopped).
  Process {
    id: tasksProc
    stdout: StdioCollector { id: tasksOut; waitForEnd: true }
    onExited: (code) => {
      try { root.tasks = JSON.parse(tasksOut.text).tasks || [] } catch (e) {}
      tasksFile.reload()
    }
  }

  function refreshTasks(clear) {
    if (tasksProc.running) return
    tasksProc.command = ["bash", "-lc", 'exec "$@"', "bash"].concat(Client.promptArgv(root.settings, clear ? ["tasks", "--clear"] : ["tasks"]))
    tasksProc.running = true
  }

  // Every paper's chats, newest first: [{ id, title, updated, turns, key, libraryID, paper }].
  property var chats: null

  Process {
    id: chatsProc
    stdout: StdioCollector { id: chatsOut; waitForEnd: true }
    onExited: (code) => {
      try { root.chats = JSON.parse(chatsOut.text).chats || [] } catch (e) { root.chats = [] }
    }
  }

  function refreshChats() {
    if (chatsProc.running) return
    chatsProc.command = ["bash", "-lc", 'exec "$@"', "bash"].concat(Client.promptArgv(root.settings, ["chats", "--all"]))
    chatsProc.running = true
  }

  // Every paper's artifacts (diagrams, mind maps, images, pages, documents), the latest changed
  // first: [{ id, title, format, formatLabel, current, versions, updated, by, key, libraryID, paper, view, file, dir }].
  property var artifacts: []
  property string artifactsRoot: ""
  property string _artifactsAt: "" // when the list was read: a prompt or change finishing after that re-reads it

  Process {
    id: artifactsProc
    stdout: StdioCollector { id: artifactsOut; waitForEnd: true }
    onExited: (code) => {
      try {
        const j = JSON.parse(artifactsOut.text)
        root.artifacts = j.artifacts || []
        root.artifactsRoot = j.root || ""
      } catch (e) { root.artifacts = [] }
    }
  }

  function refreshArtifacts() {
    if (artifactsProc.running) return
    root._artifactsAt = new Date().toISOString()
    artifactsProc.command = ["bash", "-lc", 'exec "$@"', "bash"].concat(Client.promptArgv(root.settings, ["artifacts", "--all"]))
    artifactsProc.running = true
  }

  onTasksChanged: {
    if ((root.tasks || []).some(function(t) { return t.status === "done" && t.artifactView && String(t.finished || "") > root._artifactsAt })) root.refreshArtifacts()
  }

  // A file in its app: an artifact's view in the browser, a folder in the file manager.
  function openPath(path) {
    if (path) Util.execArgv(["xdg-open", String(path)])
  }

  // Its source in the user's editor.
  function editPath(path) {
    if (path) Util.execArgv(["omarchy-launch-editor", String(path)])
  }

  // A model changes an artifact, in the background (a task in Processes; the runner notifies).
  function changeArtifact(a, instruction) {
    Util.execArgv(Client.promptArgv(root.settings, ["artifact-edit", "--key", a.key, "--library", String(a.libraryID || 1), "--id", a.id, "--instruction", String(instruction)]))
    tasksStart.restart()
  }

  // undo, rename (title), delete: cb(ok, data, error), then the list is read again.
  function artifactJob(action, a, title, cb) {
    const args = ["artifact-" + action, "--key", a.key, "--library", String(a.libraryID || 1), "--id", a.id]
    if (action === "rename") args.push("--title", String(title))
    root._promptJob(args, function(ok, data, error) {
      root.refreshArtifacts()
      if (cb) cb(ok, data, error)
    })
  }

  // The paper's PDF text as a page-numbered note, in the background (the runner notifies).
  // `replace`: extract again; the new note replaces the old one (which goes to Zotero's trash).
  function extractText(item, replace) {
    Util.execArgv(Client.promptArgv(root.settings, ["extract", "--key", item.key, "--library", String(item.libraryID || 1)].concat(replace ? ["--force"] : [])))
    tasksStart.restart()
  }

  // The prompt's text, in the user's editor.
  function editPromptText(id) {
    Util.execArgv(Client.promptArgv(root.settings, ["edit", id]))
  }

  // Every enabled provider's models ([{ value: "provider:model", displayName, group, description,
  // context, efforts, priceIn, priceOut }]), through the runner (cached there for a day); null
  // until listed. modelGroups: [{ id, name, ok, detail, count }]; modelDefaults: what "default"
  // resolves to, { prompts, chat } ("" when nothing is set up).
  property var models: null
  property var modelGroups: []
  property var modelDefaults: ({ prompts: "", chat: "" })
  property string modelsProblem: ""

  Process {
    id: modelsProc
    stdout: StdioCollector { id: modelsOut; waitForEnd: true }
    stderr: StdioCollector { id: modelsErr; waitForEnd: true }
    onExited: (code) => {
      let list = null
      try {
        const j = JSON.parse(modelsOut.text)
        if (j && Array.isArray(j.models)) {
          list = j.models
          root.modelGroups = j.groups || []
          root.modelDefaults = j.defaults || { prompts: "", chat: "" }
        }
      } catch (e) {}
      root.modelsProblem = list ? "" : String(modelsErr.text || "can't list the models").trim().split("\n").pop()
      root.models = list
      if (root._modelsAgain) { root._modelsAgain = false; root.refreshModels() } // settings changed while it listed
    }
  }

  property bool _modelsAgain: false

  function refreshModels() {
    if (modelsProc.running) { root._modelsAgain = true; return }
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

  // A new prompt written by the default prompts model from `description` (the meta prompt, in the
  // runner): cb(ok, { id, path, title, excerpt, model }, error). Its own process: it takes a while,
  // and the prompt job queue stays free for renames and model changes meanwhile.
  property bool draftingPrompt: false

  Process {
    id: draftProc
    property var cb: null
    stdout: StdioCollector { id: draftOut; waitForEnd: true }
    stderr: StdioCollector { id: draftErr; waitForEnd: true }
    onExited: (code) => {
      const cb = draftProc.cb
      draftProc.cb = null
      root.draftingPrompt = false
      let data = null
      try { data = JSON.parse(draftOut.text) } catch (e) {}
      const error = code === 0 ? "" : String(draftErr.text || "failed").trim().split("\n").pop().replace(/^oma-zotero-prompt: /, "")
      root.refreshPrompts()
      if (cb) cb(code === 0 && !!data, data, error || (data ? "" : "no answer from the runner"))
    }
  }

  function draftPrompt(description, cb) {
    if (draftProc.running) return false
    draftProc.cb = cb
    root.draftingPrompt = true
    draftProc.command = ["bash", "-lc", 'exec "$@"', "bash"].concat(Client.promptArgv(root.settings, ["new-ai", "--describe", String(description), "--json"]))
    draftProc.running = true
    return true
  }

  // Settings › Rules: the rules (the runner's daemon/lib/rules.json, which this plugin carries too)
  // and the user's own instructions (the file the runner reads, <!-- comments --> left out; ""
  // when none), watched so Settings shows them as they are.
  property var rules: []
  property string instructions: ""
  readonly property string instructionsPath: (Quickshell.env("XDG_CONFIG_HOME") || Quickshell.env("HOME") + "/.config") + "/omarchy/oma-zotero-launcher/instructions.md"

  FileView {
    id: rulesFile
    path: root.pluginDir + "/daemon/lib/rules.json"
    printErrors: false
    onLoaded: {
      try { root.rules = JSON.parse(text()).rules || [] } catch (e) { root.rules = [] }
    }
    onLoadFailed: root.rules = []
  }

  FileView {
    id: instructionsFile
    path: root.instructionsPath
    printErrors: false
    watchChanges: true
    onFileChanged: reload()
    onLoaded: root.instructions = String(text() || "").replace(/<!--[\s\S]*?-->/g, "").trim()
    onLoadFailed: root.instructions = ""
  }

  // Re-read them (a file the editor just created isn't watched yet).
  function refreshRules() {
    rulesFile.reload()
    instructionsFile.reload()
  }

  // Open the instructions in the user's editor (the runner writes a template first when there is no file).
  function editInstructions() {
    Util.execArgv(Client.promptArgv(root.settings, ["system", "edit"]))
  }

  function clearInstructions(cb) {
    root._promptJob(["system", "clear"], function(ok, data, error) {
      instructionsFile.reload()
      if (cb) cb(ok, error)
    })
  }

  // changes: { title?, model?, effort? } ("" effort = the model's default).
  function setPrompt(id, changes, cb) {
    const args = ["set", id]
    if (changes.title !== undefined) args.push("--title", String(changes.title))
    if (changes.model !== undefined) args.push("--model", String(changes.model))
    if (changes.effort !== undefined) args.push("--effort", changes.effort === "" ? "default" : String(changes.effort))
    if (changes.output !== undefined) args.push("--output", String(changes.output))
    if (changes.brief !== undefined) args.push("--brief", String(changes.brief))
    root._promptJob(args, cb)
  }

  // ------------------------------------------------------------ settings, providers, AI features

  // The plugin's folder (the runner's source is in daemon/, for Install AI features).
  readonly property string pluginDir: String(Qt.resolvedUrl(".")).replace(/^file:\/\//, "").replace(/\/$/, "")

  // Save changed settings (normalized, as in root.settings): the file in sections. → "" when saved,
  // else why not (the file is left as it was).
  function saveSettings(next) {
    const file = Settings.toFile(next)
    const res = Client.normalizeSettings(file)
    if (res.problems.length) return res.problems[0]
    settingsFile.setText(JSON.stringify(file, null, 2) + "\n")
    root.settings = res.settings
    root.settingsProblems = []
    return ""
  }

  // The runner's report on providers: { configured, keyring, providers: [...], requirements }.
  property var providersInfo: null
  property bool runnerMissing: false

  Process {
    id: providersProc
    stdout: StdioCollector { id: providersOut; waitForEnd: true }
    onExited: (code) => {
      root.runnerMissing = code === 127
      try { root.providersInfo = JSON.parse(providersOut.text) } catch (e) { if (code !== 0) root.providersInfo = null }
      if (root._providersAgain) { root._providersAgain = false; root.refreshProviders() }
    }
  }

  property bool _providersAgain: false

  function refreshProviders() {
    if (providersProc.running) { root._providersAgain = true; return }
    providersProc.command = ["bash", "-lc", 'exec "$@"', "bash"].concat(Client.promptArgv(root.settings, ["providers"]))
    providersProc.running = true
  }

  // What the AI features need, checked by the shell (so it works before the runner is installed).
  property var requirements: ({ node: "", pdftotext: false })

  Process {
    id: reqProc
    stdout: StdioCollector { id: reqOut; waitForEnd: true }
    onExited: (code) => {
      const parts = String(reqOut.text).split("|")
      root.requirements = { node: String(parts[0] || "").trim(), pdftotext: String(parts[1] || "").trim() !== "" }
    }
  }

  function refreshRequirements() {
    if (reqProc.running) return
    reqProc.command = ["bash", "-lc", 'node --version 2>/dev/null; printf "|"; command -v pdftotext']
    reqProc.running = true
  }

  // Test connection, per provider: { id: { running, ok, detail, models } }.
  property var providerTests: ({})

  Component {
    id: testProcComponent
    Process {
      property string providerId: ""
      stdout: StdioCollector { id: testOut; waitForEnd: true }
      stderr: StdioCollector { id: testErr; waitForEnd: true }
      onExited: (code) => {
        let r = null
        try { r = JSON.parse(testOut.text) } catch (e) {}
        const t = Object.assign({}, root.providerTests)
        t[providerId] = r ? { running: false, ok: r.ok, detail: r.detail, models: r.models } : { running: false, ok: false, detail: String(testErr.text || "the test failed").trim().split("\n").pop().replace(/^oma-zotero-prompt: /, "") }
        root.providerTests = t
        destroy()
      }
    }
  }

  function testProvider(id) {
    const t = Object.assign({}, root.providerTests)
    t[id] = { running: true, ok: false, detail: "" }
    root.providerTests = t
    const proc = testProcComponent.createObject(root, { providerId: id })
    proc.command = ["bash", "-lc", 'exec "$@"', "bash"].concat(Client.promptArgv(root.settings, ["provider-test", id]))
    proc.running = true
  }

  // A key from the clipboard straight into the keyring (the launcher never holds it), then the
  // clipboard is cleared. cb(ok, error).
  Component {
    id: keyProcComponent
    Process {
      property var cb: null
      stderr: StdioCollector { id: keyErr; waitForEnd: true }
      onExited: (code) => {
        if (cb) cb(code === 0, String(keyErr.text || "").trim().split("\n").pop().replace(/^oma-zotero-prompt: /, ""))
        root.refreshProviders()
        destroy()
      }
    }
  }

  function setKeyFromClipboard(id, cb) {
    const proc = keyProcComponent.createObject(root, { cb: cb })
    proc.command = ["bash", "-lc", 'k=$(wl-paste -n 2>/dev/null) || k=""; k=$(printf %s "$k" | tr -d "[:space:]"); [ -n "$k" ] || { echo "the clipboard is empty: copy the key first" >&2; exit 3; }; printf %s "$k" | "$@" && { wl-copy --clear 2>/dev/null || true; }', "bash"]
      .concat(Client.promptArgv(root.settings, ["secret", "set", id]))
    proc.running = true
  }

  function removeKey(id, cb) {
    const proc = keyProcComponent.createObject(root, { cb: cb })
    proc.command = ["bash", "-lc", 'exec "$@"', "bash"].concat(Client.promptArgv(root.settings, ["secret", "remove", id]))
    proc.running = true
  }

  // Install AI features: the runner from the plugin's daemon/ (scripts/install-runner.sh), with
  // its progress in Tasks.
  property bool installing: false

  Process {
    id: installProc
    stderr: StdioCollector { id: installErr; waitForEnd: true }
    onExited: (code) => {
      root.installing = false
      root.notify(code === 0 ? "AI features installed" : "Couldn't install the AI features", code === 0 ? "Prompts, chat and text extraction are ready: choose a model in Settings" : String(installErr.text || "").trim().split("\n").pop())
      root.refreshPrompts()
      root.refreshProviders()
      root.refreshModels()
      root.refreshTasks(false)
    }
  }

  function installRunner() {
    if (installProc.running) return
    root.installing = true
    installProc.command = ["bash", "-lc", 'exec "$0" "$@"', root.pluginDir + "/scripts/install-runner.sh"]
    installProc.running = true
    tasksStart.restart()
  }

  // The clipboard's text, for pasting into the launcher's header (a URL, a name). cb(text).
  Component {
    id: pasteProcComponent
    Process {
      property var cb: null
      stdout: StdioCollector { id: pasteOut; waitForEnd: true }
      onExited: (code) => {
        if (cb) cb(code === 0 ? String(pasteOut.text).replace(/[\r\n]+/g, " ").trim() : "")
        destroy()
      }
    }
  }

  function paste(cb) {
    const proc = pasteProcComponent.createObject(root, { cb: cb })
    proc.command = ["wl-paste", "-n", "-t", "text"]
    proc.running = true
  }

  // ------------------------------------------------------------ setup (Settings › Setup)

  // scripts/setup-check.sh: { zotero, running, bind ("ours" | "taken:<what>" | "none"), rule, node, pdftotext }.
  property var setupInfo: null
  readonly property string zoteroCommandText: Array.isArray(root.settings.zoteroCommand) && root.settings.zoteroCommand.length ? root.settings.zoteroCommand.join(" ") : "zotero"
  readonly property string pluginVersion: root.manifest && root.manifest.version ? String(root.manifest.version) : ""

  Process {
    id: setupProc
    stdout: StdioCollector { id: setupOut; waitForEnd: true }
    onExited: (code) => {
      try { root.setupInfo = JSON.parse(setupOut.text) } catch (e) {}
    }
  }

  function refreshSetup() {
    if (setupProc.running) return
    setupProc.command = ["bash", "-lc", 'exec "$0"', root.pluginDir + "/scripts/setup-check.sh"]
    setupProc.environment = { ZOTERO_CMD: root.zoteroCommandText }
    setupProc.running = true
    root.ping() // the bridge's state too
  }

  // A setup script from the plugin's scripts/: cb(ok, lastLine, error).
  Component {
    id: setupJobComponent
    Process {
      property var cb: null
      stdout: StdioCollector { id: jobOut; waitForEnd: true }
      stderr: StdioCollector { id: jobErr; waitForEnd: true }
      onExited: (code) => {
        const last = String(jobOut.text || "").trim().split("\n").pop()
        const err = String(jobErr.text || "").trim().split("\n").pop().replace(/^[a-z-]+: /, "")
        if (cb) cb(code === 0, last, err || "failed")
        root.refreshSetup()
        destroy()
      }
    }
  }

  function runSetupScript(name, args, cb) {
    const proc = setupJobComponent.createObject(root, { cb: cb })
    proc.command = ["bash", "-lc", 'exec "$0" "$@"', root.pluginDir + "/scripts/" + name].concat(args || [])
    proc.environment = { ZOTERO_CMD: root.zoteroCommandText }
    proc.running = true
  }

  // The latest .xpi into Downloads (its path on the clipboard), Zotero started: cb(ok, path, error).
  function installBridge(cb) { root.runSetupScript("install-bridge.sh", [], cb) }

  // SUPER+SHIFT+Z and the layer rule in bindings.lua (backed up; undone on a Hyprland error).
  function addKeybinding(ruleOnly, cb) { root.runSetupScript("add-keybinding.sh", ruleOnly ? ["--rule"] : [], cb) }

  // An install command the user sees run: a floating terminal, the way Omarchy runs its installers.
  function runInTerminal(command) {
    Util.execArgv(["omarchy-launch-floating-terminal-with-presentation", String(command)])
  }

  function openUrl(url) {
    Util.execArgv(["xdg-open", String(url)])
  }

  function notify(summary, body) {
    Util.execArgv(["notify-send", "-a", "Zotero", String(summary), String(body || "")])
  }

  Component.onCompleted: {
    Hyprland.refreshToplevels()
    Quickshell.execDetached(["mkdir", "-p", root.configDir]) // for pins.json (FileView doesn't create it)
  }
}
