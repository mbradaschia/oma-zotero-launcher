import Quickshell
import Quickshell.Wayland
import Quickshell.Hyprland
import QtQuick
import qs.Commons
import qs.Ui
import "lib/Views.js" as Views
import "lib/Fuzzy.js" as Fuzzy
import "lib/Settings.js" as Settings

// Zotero search overlay. Summoned by `omarchy-shell shell toggle <id>` (the
// SUPER+SHIFT+Z binding) or scripted through the "oma-zotero-launcher" IPC target.
// Built like the Omarchy menu (header as input, rows, theme tokens); all data
// comes from Service.qml, which talks to the Zotero bridge.
//
// Views: "search" (results) → Tab → "actions" (for the highlighted item) →
//   "files"  (picker, when a file action has several files to choose from)
//   "notes"  (the item's notes) → "note" (one note, read as Markdown)
//   "tags"   (tag editor: toggle, create)
//   "prompts" (run one with Claude, or edit it) → "prompt-edit" (title, model and effort
//             dropdowns, text) → "prompt-title" (new name); "New prompt…" → "prompt-title"
Item {
  id: root

  // Injected by omarchy-shell.
  property string omarchyPath: Quickshell.env("OMARCHY_PATH")
  property var shell: null
  property var manifest: null
  property var service: null

  property bool opened: false
  property string view: "search"
  property string filterText: ""
  property int selectedIndex: 0
  property bool followTop: true // typing keeps the cursor on the best match
  property var response: null // last search response the rows were built from
  property bool loading: false
  property string lastError: ""
  property var viewStack: [] // saved { view, filterText, selectedIndex, followTop } per level
  property bool libraryChanged: false // tags edited: refresh search rows when going back

  // Actions view state
  property var actionItem: null // { key, libraryID, title, itemType }
  property var details: null // bridge /item response; null while loading
  property string filePurpose: "" // "external" | "window" in the file picker
  property string quickAction: "" // Alt accelerator waiting for details
  property int detailsSerial: 0

  // Note view state
  property var noteTarget: null // { key, libraryID, title }
  property var noteData: null // bridge /note response; null while loading
  property string noteError: ""
  property int noteSerial: 0
  property var noteCache: ({}) // note key → /note response, for this opening of the overlay
  // The note's first line (its title) apart from the rest: the header shows it, the body doesn't repeat it.
  readonly property var noteParts: root.noteData ? Views.splitNoteTitle(root.noteData.html, root.noteData.title) : ({ title: "", html: "" })

  // Tag editor state: { tags, itemTags, initial, editable, loading }
  property var tagState: null
  property int tagSerial: 0
  property int tagPending: 0
  property var tagListCache: ({}) // libraryID → tags, for this opening of the overlay

  // Prompt editor state
  property var promptEdit: null // the prompt being edited: { id, title, model, effort, excerpt }
  property string promptTitleMode: "" // "create" | "rename" in the prompt-title view

  // Settings view state (lib/Settings.js builds the rows)
  property string settingsChoice: "" // the setting whose options the settings-choice page lists
  property string settingsProvider: "" // the provider page shown
  property var settingsEdit: null // the value typed in the header: { path, label, type, help, current, item, … }
  property string settingsModelsPath: "" // the setting the model picker sets ("defaults.both": prompts and chat)
  property string settingsModelsOnly: "" // the picker shows one provider's models
  property string autoDefault: "" // a provider just turned on: its first model becomes the default once tested
  readonly property bool inSettings: root.view.indexOf("settings") === 0

  // Keys (README: Keys). "single": the search box has the keys until Esc; then one key acts
  // (after keyDelay, so that two quick keys are typing, which goes back to the search box).
  // "alt": typing always searches and Alt+key acts, as before.
  readonly property bool singleKeys: !root.service || root.service.settings.keys !== "alt"
  readonly property int keyDelay: root.service ? root.service.settings.keyDelay : 300
  property bool searchFocus: true // single-key mode: typing goes to the search box
  property string keyBuffer: "" // keys waiting to be told apart from typing
  // Views where typing is the point: the search box always has the keys.
  readonly property bool textEntry: ["prompt-title", "settings-edit"].indexOf(root.view) >= 0
  readonly property bool typingNow: !root.singleKeys || root.searchFocus || root.textEntry

  Timer {
    id: keyTimer
    interval: root.keyDelay
    onTriggered: root.flushKeys()
  }

  // A short confirmation in the footer ("Copied …", "Added …").
  property string flash: ""

  readonly property string pluginId: (root.manifest && root.manifest.id) || "io.github.mbradaschia.oma-zotero"
  readonly property string status: root.service ? root.service.status : "unknown"
  readonly property bool inSearch: root.view === "search"
  // Searching inside a collection: { key, libraryID, title } (the title is its full path), or null.
  property var collectionScope: null
  // Picking a paper for something else (a new chat): "chat", or "" for a normal search.
  property string pickFor: ""
  // The top level: the only place Esc closes the launcher.
  readonly property bool atRoot: root.inSearch && !root.collectionScope && !root.pickFor
  readonly property bool inNote: root.view === "note"
  readonly property int noteTextSize: root.service ? root.service.noteTextSize : Style.font.title
  readonly property bool accel: root.service ? root.service.accelerators : true

  // Same [menu] tokens as the Omarchy menu, so every theme styles this too.
  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color scrim: Color.menu.scrim
  property color selectedBackground: Color.menu.selectedBackground
  property color selectedText: Color.menu.selectedText
  property color selectedBorder: Color.menu.selectedBorder
  property var borderSpec: Border.surfaceSpec("menu", "border", Color.menu.border, Math.max(1, Style.space(2)))
  property var selectedBorderSpec: Border.surfaceSpec("menu", "selected-border", selectedBorder, 0)
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.menuFamily
  property int contentMargin: Style.spacing.panelPadding
  property int headerHeight: Math.max(Style.space(34), Style.font.title + Style.spacing.controlPaddingY * 2)
  property int footerHeight: Math.max(Style.space(20), Style.font.caption + Style.space(8))
  // Row type in the results and the paper's menu: a step below the theme's list sizes, so more
  // fits (the chat window keeps its own).
  readonly property int rowTitleSize: Style.font.body
  readonly property int rowDetailSize: Style.font.caption
  readonly property int rowIconSize: Style.font.title
  readonly property int rowSmallTitleSize: Style.font.bodySmall
  readonly property int sectionSize: Math.max(8, Style.font.caption - 1)
  property int rowHeight: Math.max(Style.space(44), root.rowTitleSize + root.rowDetailSize + Style.spacing.rowPaddingX * 2)
  property int sectionHeight: Math.max(Style.space(22), root.sectionSize + Style.space(12))
  property int cardWidth: Math.min(Style.space(780), panel.width - Style.gapsOut * 2)
  // Three more rows than it used to hold, within the screen (and a phone-width panel's height).
  property int cardHeight: Math.min(Style.space(640) + 3 * (root.rowHeight + Style.spacing.xxs), panel.height - Style.gapsOut * 2)

  // "#aarrggbb" → "#rrggbb" (the bridge colors note links with it).
  function hex6(c) {
    const s = String(c)
    return s.length === 9 ? "#" + s.slice(3) : s
  }

  // ------------------------------------------------------------ lifecycle

  function open(payloadJson) {
    let payload = ({})
    try {
      payload = JSON.parse(payloadJson || "{}") || ({})
    } catch (e) {
      payload = ({})
    }
    // Reopened with nothing asked (the keybinding): back where you left it, the same view,
    // submenu, query, row and collection or paper. A query, a menu or a settings page asked
    // for starts over from the results.
    const asked = typeof payload.query === "string" || !!payload.menu || typeof payload.settings === "string"
    if (!asked && root.hasState) return root.resume()
    root.hasState = true
    root.searchFocus = true
    root.keyBuffer = ""
    root.view = "search"
    root.viewStack = []
    root.collectionScope = null
    root.pickFor = ""
    root.actionItem = null
    root.details = null
    root.quickAction = ""
    root.noteTarget = null
    root.noteData = null
    root.noteError = ""
    root.noteCache = ({})
    root.tagState = null
    root.tagListCache = ({})
    root.libraryChanged = false
    root.flash = ""
    root.filterText = typeof payload.query === "string" ? payload.query : ""
    root.selectedIndex = 0
    root.followTop = true
    root.lastError = ""
    // Rows cached from last time are only worth showing for the same query.
    if (root.response && (root.response.scope || String(root.response.query) !== root.filterText)) root.response = null
    root.opened = true
    pointerGate.reset()
    Hyprland.refreshToplevels()
    if (root.service) {
      root.service.refreshTasks()
      root.service.refreshChats()
      root.service.refreshHandshake()
      root.service.refreshSettings()
      root.service.ping()
      root.service.refreshSetup()
    }
    root.rebuildSearch()
    root.requestSearch()
    // From a note or chat window: straight to that paper's menu, on the row it came from
    // (Esc goes back to the results as usual).
    const menu = payload.menu
    if (menu && menu.item && /^[A-Z0-9]{8}$/.test(String(menu.item.key))) {
      const sel = menu.select || {}
      root.enterActionsFor({ key: String(menu.item.key), libraryID: Number(menu.item.libraryID) || 1, title: String(menu.item.title || ""), itemType: String(menu.item.itemType || "") }, "",
        sel.rowId ? function(r) { return r.rowId === sel.rowId && (!sel.noteKey || r.noteKey === sel.noteKey) } : null)
    }
    // Settings, from a script (omarchy-shell … settings [general|providers|defaults]).
    if (typeof payload.settings === "string" && root.service) root.openSettings(["general", "providers", "defaults"].indexOf(payload.settings) >= 0 ? payload.settings : "")
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.opened = false
  }

  property bool hasState: false // opened before: reopening resumes (see open())

  function resume() {
    root.flash = ""
    root.lastError = ""
    root.noteCache = ({})
    root.tagListCache = ({})
    root.opened = true
    pointerGate.reset()
    Hyprland.refreshToplevels()
    if (root.service) {
      root.service.refreshTasks()
      root.service.refreshChats()
      root.service.refreshHandshake()
      root.service.refreshSettings()
      root.service.ping()
      if (root.inSettings) {
        root.service.refreshProviders()
        root.service.refreshRequirements()
      }
    }
    root.followTop = false // the row you were on stays selected as the list refreshes
    if (root.inSearch) {
      root.rebuildSearch()
      root.requestSearch()
    } else if (!root.inNote) {
      if (root.actionItem && ["actions", "notes", "files"].indexOf(root.view) >= 0) root.refreshDetails()
      root.rebuildList()
      if (root.currentCount() > 0) root.currentList().positionViewAtIndex(root.selectedIndex, ListView.Contain)
    }
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  // The paper's details again (its notes may have changed while the launcher was closed),
  // keeping the view and the row.
  function refreshDetails() {
    const serial = ++root.detailsSerial
    if (!root.service) return
    root.service.itemDetails(root.actionItem, function(res) {
      if (serial !== root.detailsSerial || !root.opened) return
      if (res.kind !== "ok") return
      root.details = res.data
      if (["actions", "notes", "files"].indexOf(root.view) >= 0) {
        root.followTop = false
        root.rebuildList()
      }
    })
  }

  function dismiss() {
    root.opened = false
    if (root.shell && typeof root.shell.hide === "function") root.shell.hide(root.pluginId)
  }

  function flashMessage(text) {
    root.flash = text
    flashTimer.restart()
  }

  Timer {
    id: flashTimer
    interval: 3000
    onTriggered: root.flash = ""
  }

  // ------------------------------------------------------------ search data

  function requestSearch() {
    if (!root.service) return
    root.loading = true
    root.service.search(root.filterText, root.collectionScope)
  }

  function setFilter(text) {
    blink.on = true
    root.filterText = text
    root.followTop = true
    pointerGate.reset()
    if (root.inSearch) root.requestSearch()
    else if (!root.inNote) root.rebuildList()
  }

  function scopeId(scope) {
    return scope ? (scope.type || scope.kind || "collection") + ":" + scope.key + ":" + scope.libraryID : ""
  }

  function applyResponse(resp) {
    // A response for another level (a collection we left, or the top level we left for one).
    if (root.inSearch && root.scopeId(resp.scope) !== root.scopeId(root.collectionScope)) return
    root.response = resp
    root.loading = String(resp.query) !== (root.inSearch ? root.filterText : root.savedSearchFilter())
    root.lastError = ""
    if (root.opened && root.inSearch) root.rebuildSearch()
  }

  function searchFailed(kind, message) {
    root.loading = false
    if (kind === "timeout" || kind === "error") {
      root.lastError = message || (kind === "timeout" ? "Zotero didn't answer in time" : kind)
    } else {
      // zotero-down / bridge-missing / unauthorized: drop rows, the status card explains
      root.response = null
      root.lastError = ""
    }
    if (root.opened && root.inSearch) root.rebuildSearch()
  }

  // What the Tasks and Chats rows at the top of the results show.
  function workspaceExtras() {
    if (!root.service) return null
    // chats: null until the runner answered (-1: no Chats row; it isn't installed)
    return { tasks: root.service.tasks, chats: root.service.chats ? root.service.chats.length : -1, setup: root.needsSetup(), keys: root.singleKeys ? "single" : "alt" }
  }

  // Zotero or its plugin isn't working: the results show what to do (Settings › Setup's first steps).
  readonly property bool setupNeeded: ["zotero-down", "bridge-missing", "unauthorized"].indexOf(root.status) >= 0

  function setupResultRows() {
    // The first steps, done or not (a check on the done ones), so you see where you are.
    const items = Settings.setupItems(root.settingsState()).filter(function(it) { return ["zotero-install", "zotero-start", "bridge"].indexOf(it.id) >= 0 })
    const rows = []
    items.forEach(function(it) {
      rows.push(Views.setupResultRow(it.action, it.ok ? "\uf058" : it.icon, it.label + (it.ok ? "  ✓" : ""), it.detail))
      ;(it.steps || []).forEach(function(st, i) { rows.push(Views.setupResultRow("", "", (i + 1) + ". " + st, "")) })
    })
    rows.push(Views.setupResultRow("settings-setup", Settings.ICON.settings, "Everything else to set up", "Settings › Setup: the keybinding, the AI features and a model"))
    return rows
  }

  function rebuildSearch() {
    const previousKey = root.selectedIndex >= 0 && root.selectedIndex < displayModel.count ? displayModel.get(root.selectedIndex).key : ""
    const rows = root.setupNeeded && root.atRoot && !root.filterText ? root.setupResultRows()
      : Views.buildRows(root.response, String(root.selectedText), root.atRoot ? root.workspaceExtras() : null)
    displayModel.clear()
    for (let i = 0; i < rows.length; i++) displayModel.append(rows[i])
    root.selectedIndex = Views.selectionAfter(rows, previousKey, root.followTop)
    if (displayModel.count > 0) Qt.callLater(function() { resultList.positionViewAtIndex(root.selectedIndex, ListView.Contain) })
  }

  Connections {
    target: root.service
    function onSearchResult(response) { root.applyResponse(response) }
    function onSearchFailed(kind, message) { root.searchFailed(kind, message) }
    function onPromptsChanged() {
      if (root.promptEdit && root.service.prompts) {
        const fresh = root.service.prompts.find(function(p) { return p.id === root.promptEdit.id })
        if (fresh) root.promptEdit = fresh
      }
      if (["actions", "prompts", "prompt-edit"].indexOf(root.view) >= 0) root.rebuildList()
    }
    function onModelsChanged() { if (root.view === "prompts" || root.view === "prompt-edit" || root.inSettings) { root.followTop = false; root.rebuildList() } }
    function onStatusChanged() {
      if (root.inSearch && root.atRoot) {
        root.rebuildSearch()
        if (root.status === "ready" && !root.response) root.requestSearch()
      } else if (root.inSettings) { root.followTop = false; root.rebuildList() }
    }
    function onSetupInfoChanged() { if (root.inSettings) { root.followTop = false; root.rebuildList() } else if (root.setupNeeded && root.inSearch) root.rebuildSearch() }
    function onProvidersInfoChanged() {
      if (root.inSettings || root.view === "actions") { root.followTop = false; root.rebuildList() }
      else if (root.atRoot && !root.filterText) root.rebuildSearch()
    }
    function onProviderTestsChanged() {
      root.afterTest()
      if (root.inSettings) { root.followTop = false; root.rebuildList() }
    }
    function onRequirementsChanged() { if (root.inSettings) { root.followTop = false; root.rebuildList() } }
    function onInstallingChanged() { if (root.inSettings) { root.followTop = false; root.rebuildList() } }
    function onSettingsChanged() { if (root.inSettings && root.view !== "settings-edit") { root.followTop = false; root.rebuildList() } }
    function onTasksChanged() {
      if (root.view === "tasks") { root.followTop = false; root.rebuildList() }
      else if (root.atRoot && !root.filterText) root.rebuildSearch()
    }
    function onChatsChanged() {
      if (root.view === "chats") { root.followTop = false; root.rebuildList() }
      else if (root.atRoot && !root.filterText) root.rebuildSearch()
    }
  }

  ListModel { id: displayModel }

  // ------------------------------------------------------------ views

  function pushView(next) {
    root.viewStack = root.viewStack.concat([{ view: root.view, filterText: root.filterText, selectedIndex: root.selectedIndex, followTop: root.followTop, scope: root.collectionScope, pickFor: root.pickFor, searchFocus: root.searchFocus }])
    root.view = next
    // Every level starts with the search box (Esc hands the keys to the list); reopening the
    // launcher keeps where the keys were.
    root.searchFocus = true
    root.keyBuffer = ""
    root.filterText = ""
    root.selectedIndex = 0
    root.followTop = true
    root.lastError = ""
    pointerGate.reset()
  }

  // Back one level, restoring that level's query and cursor.
  function back() {
    if (!root.viewStack.length) return false
    const saved = root.viewStack[root.viewStack.length - 1]
    root.viewStack = root.viewStack.slice(0, -1)
    const scopeChanged = root.scopeId(saved.scope) !== root.scopeId(root.collectionScope)
    root.collectionScope = saved.scope || null
    root.pickFor = saved.pickFor || ""
    root.view = saved.view
    root.searchFocus = saved.searchFocus !== undefined ? saved.searchFocus : true
    root.keyBuffer = ""
    root.filterText = saved.filterText
    root.followTop = false
    root.lastError = ""
    pointerGate.reset()
    if (root.inSearch && scopeChanged) {
      root.response = null // the rows were the other level's; get this level's
      root.rebuildSearch()
      root.requestSearch()
    } else if (root.inSearch) {
      root.rebuildSearch()
      if (root.libraryChanged) {
        root.libraryChanged = false
        root.requestSearch() // rows show tags; get them fresh
      }
    } else {
      root.rebuildList()
    }
    root.selectedIndex = Math.max(0, Math.min(root.currentCount() - 1, saved.selectedIndex))
    root.followTop = saved.followTop
    if (root.currentCount() > 0) root.currentList().positionViewAtIndex(root.selectedIndex, ListView.Contain)
    return true
  }

  function savedSearchFilter() {
    for (const s of root.viewStack) if (s.view === "search") return s.filterText
    return root.filterText
  }

  function currentCount() {
    if (root.inNote) return 0
    return root.inSearch ? displayModel.count : actionModel.count
  }

  // Alt+1…9: the row numbered N from the top of what's shown, as Enter would.
  // The first row in view (a section heading may sit at the very top).
  function topIndex(list) {
    for (let dy = 1; dy < root.rowHeight * 2; dy += 6) {
      const i = list.indexAt(Style.space(20), list.contentY + dy)
      if (i >= 0) return i
    }
    return 0
  }

  readonly property int resultTop: { resultList.contentY; resultList.count; return root.topIndex(resultList) }
  readonly property int actionTop: { actionList.contentY; actionList.count; return root.topIndex(actionList) }

  function pickNumber(n) {
    const top = root.inSearch ? root.resultTop : root.actionTop
    const i = top + n - 1
    if (i < 0 || i >= root.currentCount()) return
    root.selectedIndex = i
    if (root.inSearch) root.enterActions(i, "")
    else root.activateAction(i)
  }

  function currentList() {
    return root.inSearch ? resultList : actionList
  }

  // ------------------------------------------------------------ lists (actions, files, notes, tags)

  ListModel { id: actionModel }

  function rebuildList() {
    const color = String(root.selectedText)
    let rows
    if (root.view === "files") rows = Views.filterRows(Views.buildFileRows(root.details, root.filePurpose), root.filterText)
    else if (root.view === "notes") rows = Views.buildNoteRows(root.details, root.filterText, color, Fuzzy.filter)
    else if (root.view === "tags") rows = root.tagState ? Views.buildTagRows(root.tagState, root.filterText, color, Fuzzy.filter) : []
    else if (root.view === "prompts") rows = Views.buildPromptRows(root.service ? root.service.prompts : [], root.service ? root.service.models : null, root.filterText, color, Fuzzy.filter, root.service ? root.service.modelDefaults.prompts : "")
    else if (root.view === "prompt-edit") rows = Views.buildPromptEditor(root.promptEdit, root.service ? root.service.models : null, "", root.service ? root.service.modelDefaults.prompts : "")
    else if (root.view === "prompt-model") rows = Views.filterRows(Views.buildPromptModels(root.promptEdit, root.service ? root.service.models : null, root.service ? root.service.modelDefaults.prompts : ""), root.filterText)
    else if (root.view === "prompt-effort") rows = Views.buildPromptEfforts(root.promptEdit, root.service ? root.service.models : null, root.service ? root.service.modelDefaults.prompts : "")
    else if (root.inSettings) rows = root.settingsRows()
    else if (root.view === "prompt-title") rows = Views.buildTitleRows(root.filterText, root.promptTitleMode)
    else if (root.view === "tasks") rows = Views.buildTaskRows(root.service ? root.service.tasks : [], root.filterText, color, Fuzzy.filter)
    else if (root.view === "chats") rows = Views.buildChatRows(root.service ? root.service.chats : [], root.filterText, color, Fuzzy.filter)
    else rows = Views.filterRows(Views.buildActions(root.details, root.service ? root.service.pdfViewerLabel : "",
      root.service ? root.service.prompts : null, root.service ? root.service.promptsProblem : "",
      root.service ? Views.isPinned(root.service.pins, root.actionItem) : false, root.needsSetup()), root.filterText)
    const keep = root.selectedIndex
    actionModel.clear()
    for (let i = 0; i < rows.length; i++) actionModel.append(rows[i])
    root.selectedIndex = root.followTop ? root.firstRowFor(rows) : Math.max(0, Math.min(actionModel.count - 1, keep))
  }

  // Where the cursor starts in a list: the top, except in Processes, where "Clear finished processes"
  // heads the list and the cursor starts on the first task.
  function firstRowFor(rows) {
    return rows.length > 1 && rows[0].rowId === "tasks-clear" ? 1 : 0
  }

  function selectRow(test) {
    for (let i = 0; i < actionModel.count; i++) {
      if (test(actionModel.get(i))) {
        root.selectedIndex = i
        actionList.positionViewAtIndex(i, ListView.Contain)
        return true
      }
    }
    return false
  }

  // Tab on a result (or an Alt accelerator): the actions for that item.
  function enterActions(index, quick) {
    if (index < 0 || index >= displayModel.count) return
    const row = displayModel.get(index)
    if (row.kind === "collection" || row.kind === "tag") {
      if (!quick) root.openCollection(row) // the Alt keys are for papers
      return
    }
    if (row.kind === "tasks" || row.kind === "chats") {
      if (!quick) row.kind === "tasks" ? root.openTasks() : root.openChats()
      return
    }
    if (row.kind === "settings") {
      if (!quick) root.openSettings(root.needsSetup() ? "providers" : "")
      return
    }
    if (row.kind === "setup") {
      if (!quick) root.runSetupAction(row.key)
      return
    }
    if (row.kind.indexOf("settings-") === 0) {
      if (!quick) root.openSettings(row.kind.slice(9))
      return
    }
    if (row.kind === "chat-new") {
      if (!quick) root.pickPaperForChat()
      return
    }
    if (root.pickFor === "chat") {
      if (!quick) root.openChatWindow({ key: row.key, libraryID: row.libraryID, title: row.title }, "")
      return
    }
    root.enterActionsFor({ key: row.key, libraryID: row.libraryID, title: row.title, itemType: row.itemType }, quick)
  }

  // A row to highlight once the paper's menu has loaded: (row) => bool, or null.
  property var pendingSelect: null

  // The paper's menu (its actions), for an item from the results, a window, or a task.
  function enterActionsFor(item, quick, select) {
    root.actionItem = item
    root.pendingSelect = select || null
    root.details = null
    root.quickAction = quick || ""
    root.lastError = ""
    root.pushView("actions")
    root.rebuildList()
    const serial = ++root.detailsSerial
    if (!root.service) return
    root.service.refreshPrompts()
    root.service.refreshModels()
    root.service.itemDetails(root.actionItem, function(res) {
      if (serial !== root.detailsSerial || !root.opened || root.inSearch) return
      if (res.kind === "ok") {
        root.details = res.data
      } else {
        root.lastError = res.kind === "timeout" ? "Zotero didn't answer in time" : (res.message || res.kind)
        root.quickAction = ""
      }
      if (root.view === "actions") root.rebuildList()
      if (root.view === "actions" && root.pendingSelect) {
        root.followTop = false
        root.selectRow(root.pendingSelect)
      }
      root.pendingSelect = null
      if (root.quickAction) root.runQuick()
    })
  }

  // An Alt accelerator once the item's details are known.
  //   Alt+O / Alt+W: act directly when there is one file, else show the picker;
  //                  with none, stay on the actions (the row says why).
  //   Alt+N: the notes (straight to the note when there is one). Alt+T: the tag editor.
  function runQuick() {
    const kind = root.quickAction
    root.quickAction = ""
    if (kind === "notes") return root.enterNotes()
    if (kind === "tags") return root.enterTags()
    const usable = Views.usableFiles(root.details, kind)
    if (usable.length === 1) {
      root.finish(kind, usable[0])
    } else if (usable.length > 1) {
      root.filePurpose = kind
      root.pushView("files")
      root.rebuildList()
    } else {
      root.selectRow(function(r) { return r.rowId === kind })
      root.followTop = false
    }
  }

  function activateAction(index) {
    if (index < 0 || index >= actionModel.count) return
    const row = actionModel.get(index)
    if (!row.available) {
      if (row.rowId === "tag" || row.rowId === "create") root.lastError = "This library is read-only"
      return
    }
    const att = row.attKey ? { key: row.attKey, libraryID: row.attLibraryID, contentType: row.attContentType } : null
    switch (row.rowId) {
      case "open":
      case "reveal":
        root.finish(row.rowId, null)
        break
      case "external":
      case "window":
        if (row.submenu) {
          root.filePurpose = row.rowId
          root.pushView("files")
          root.rebuildList()
        } else {
          root.finish(row.rowId, att)
        }
        break
      case "pick":
        root.finish(root.filePurpose, att)
        break
      case "notes":
        root.enterNotes()
        break
      case "read":
      case "note":
        root.openNoteView({ key: row.noteKey, libraryID: row.noteLibraryID, title: row.label })
        break
      case "pin":
        root.togglePin(root.actionItem)
        root.followTop = false
        root.rebuildList()
        break
      case "chat":
        root.openChatWindow(root.actionItem, "")
        break
      case "extract":
        if (root.service && root.actionItem) {
          const replace = row.value === "replace"
          root.service.extractText(root.actionItem, replace)
          root.flashMessage((replace ? "Extracting the text again (it replaces the note)" : "Extracting the text") + ": it's in Processes (" + root.keyName(".") + ")")
        }
        break
      case "task":
        if (row.noteKey) root.openNoteView({ key: row.noteKey, libraryID: row.noteLibraryID, title: row.label })
        break
      case "tasks-clear":
        if (root.service) root.service.refreshTasks(true)
        break
      case "chat-new":
        root.pickPaperForChat()
        break
      case "chat-open":
        root.openChatWindow({ key: row.itemKey, libraryID: row.itemLibraryID, title: row.itemTitle }, row.value)
        break
      case "prompts":
        root.pushView("prompts")
        root.rebuildList()
        break
      case "setup":
        root.openSettings("providers")
        break
      case "set-nav":
        if (row.value === "root") root.back()
        else {
          root.pushView("settings-" + row.value)
          root.rebuildList()
        }
        break
      case "set-toggle":
        root.toggleSetting(row.value)
        break
      case "set-choice":
        root.settingsChoice = row.value
        root.pushView("settings-choice")
        root.rebuildList()
        root.selectRow(function(r) { return r.checked })
        break
      case "set-opt": {
        const path = row.value
        if (root.saveSetting(path, row.tag, "")) {
          root.back()
          root.selectRow(function(r) { return r.rowId === "set-choice" && r.value === path })
        }
        break
      }
      case "set-edit":
        root.openSettingsEdit(row.value)
        break
      case "set-save":
        root.saveSettingsEdit(row.value)
        break
      case "set-models":
        root.settingsModelsPath = row.value
        root.settingsModelsOnly = ""
        root.pushView("settings-models")
        root.rebuildList()
        root.selectRow(function(r) { return r.checked })
        break
      case "set-use":
        root.settingsModelsPath = "defaults.both"
        root.settingsModelsOnly = row.value
        root.pushView("settings-models")
        root.rebuildList()
        break
      case "set-model":
        root.chooseDefaultModel(root.settingsModelsPath, row.tag)
        break
      case "set-provider":
        root.openProviderPage(row.value)
        break
      case "set-quick":
        if (root.saveSetting("providers." + row.value + ".enabled", true, "")) {
          root.flashMessage(row.label.replace(/^Use /, "") + " is on")
          root.afterEnable(row.value)
        }
        break
      case "set-test":
        root.service.testProvider(row.value)
        break
      case "set-key": {
        const id = row.value
        root.flashMessage("Reading the key from the clipboard…")
        root.service.setKeyFromClipboard(id, function(ok, error) {
          root.flashMessage(ok ? "The key is in the keyring, and the clipboard is cleared" : "Key not saved: " + error)
          if (ok) root.service.testProvider(id)
        })
        break
      }
      case "set-key-remove": {
        const id = row.value
        root.service.removeKey(id, function(ok, error) { root.flashMessage(ok ? "Key removed from the keyring" : "Couldn't remove the key: " + error) })
        break
      }
      case "set-link":
        root.service.openUrl(row.value)
        root.flashMessage("Opened in your browser")
        break
      case "set-endpoint-new":
        root.settingsEdit = { path: "", label: "Endpoint name", type: "endpoint-name", help: "A name you'll recognize, e.g. Lab gateway or LM Studio", current: "" }
        root.pushView("settings-edit")
        root.rebuildList()
        break
      case "set-endpoint-remove": {
        const err = root.service.saveSettings(Settings.removeEndpoint(root.service.settings, row.value))
        if (err) root.flashMessage("Not saved: " + err)
        else {
          root.flashMessage("Endpoint removed")
          root.service.refreshProviders()
          root.service.refreshModels()
          root.back()
        }
        break
      }
      case "set-setup":
        root.runSetupAction(row.value)
        break
      case "set-install":
        root.service.installRunner()
        root.flashMessage("Installing the AI features: it's in Processes (" + root.keyName(".") + ")")
        break
      case "prompt":
        root.runPrompt(row)
        break
      case "prompt-new":
        root.promptTitleMode = "create"
        root.pushView("prompt-title")
        root.rebuildList()
        break
      case "pe-title":
        root.promptTitleMode = "rename"
        root.pushView("prompt-title")
        root.filterText = root.promptEdit.title
        root.rebuildList()
        break
      case "pe-title-save":
        root.saveTitle(row.value)
        break
      case "pe-model":
      case "pe-effort":
        root.pushView(row.rowId === "pe-model" ? "prompt-model" : "prompt-effort")
        root.rebuildList()
        root.selectRow(function(r) { return r.checked })
        break
      case "pe-model-opt":
        root.choosePrompt({ model: row.value, effort: Views.effortFor(root.service.models, row.value, root.promptEdit.effort) }, "pe-model")
        break
      case "pe-effort-opt":
        root.choosePrompt({ effort: row.value }, "pe-effort")
        break
      case "pe-text": {
        const id = root.promptEdit.id
        root.dismiss()
        if (root.service) root.service.editPromptText(id)
        break
      }
      case "tags":
        root.enterTags()
        break
      case "tag":
        root.toggleTag(row.tag, false)
        break
      case "create":
        root.toggleTag(row.tag, true)
        break
    }
  }

  // ------------------------------------------------------------ keys shared by every view

  // Shift+Enter (Alt+Z; z while reading): whatever is highlighted, in Zotero. A paper opens
  // (its tab or PDF), a collection is selected, a note opens in the note editor; inside a
  // paper's menus, the paper itself unless a note is highlighted.
  function openInZotero() {
    if (root.inSearch) return root.activate(root.selectedIndex)
    const note = root.selectedNoteTarget()
    if (note && (root.view === "actions" || root.view === "notes" || root.view === "tasks")) return root.openSelectedNoteInZotero()
    if (root.actionItem) root.finish("open", null)
  }

  // Alt+letter in the lists: the same letter as in the reader and the note window.
  //   W window (a note: its window; a paper: its PDF in a Zotero window) · C / S copy / save
  //   a note as Markdown · P pin · O PDF externally · N notes · T tags · L show in library ·
  //   E edit a prompt · Z open in Zotero. Returns whether the key did something.
  // One key, one meaning, everywhere (README: Keys): as a single key once the search box has let
  // go of the keys (Esc), or as Alt+key. → handled? (A key that means nothing here is typing.)
  function keyAction(ch) {
    if (/^[1-9]$/.test(ch)) { root.pickNumber(Number(ch)); return true }
    if (ch === "/") { root.searchFocus = true; return true }
    if (ch === "j" || ch === "k") { root.select(ch === "j" ? 1 : -1); return true }
    if (ch === "c") { root.chatKey(); return true }
    if (ch === ".") { if (root.view !== "tasks") root.openTasks(); return true } // Processes (the task queue)
    if (ch === ";") { if (!root.inSettings) root.openSettings(""); return true }
    if (ch === "z") { root.openInZotero(); return true }
    if (ch === "x") return root.extractKey()
    if (ch === "e") {
      if (root.view !== "prompts") return false
      root.editSelectedPrompt()
      return true
    }
    const note = (root.view === "actions" || root.view === "notes" || root.view === "tasks") ? root.selectedNoteTarget() : null
    if (note) {
      if (ch === "w") { root.openNoteWindow(); return true }
      if (ch === "y" || ch === "s") { root.exportNote(ch === "y" ? "copy" : "save"); return true }
    }
    const paper = { o: "external", w: "window", n: "notes", "#": "tags" }[ch]
    if (root.inSearch) {
      if (!root.accel) return false
      if (paper) { root.enterActions(root.selectedIndex, paper); return true }
      if (ch === "l") { root.revealSelected(); return true }
      if (ch === "p") { root.togglePinSelected(); return true }
      return false
    }
    if (!root.actionItem || ["prompt-edit", "prompt-title", "prompt-model", "prompt-effort"].indexOf(root.view) >= 0 || root.inSettings) return false
    if (ch === "p") {
      root.togglePin(root.actionItem)
      if (root.view === "actions") { root.followTop = false; root.rebuildList() }
      return true
    }
    if (ch === "l") { root.finish("reveal", null); return true }
    if (paper && root.details) {
      if (paper === root.view) return true // already there
      root.quickAction = paper
      root.runQuick()
      return true
    }
    return false
  }

  // c: a chat about the highlighted paper (or the paper whose menu this is); else the Chats list.
  function chatKey() {
    let item = null
    if (root.inSearch && !root.pickFor && root.selectedIndex >= 0 && root.selectedIndex < displayModel.count) {
      const r = displayModel.get(root.selectedIndex)
      if (r.kind === "item" && r.itemType !== "note" && r.itemType !== "attachment") item = { key: r.key, libraryID: r.libraryID, title: r.title }
    } else if (!root.inSearch && root.actionItem && ["actions", "notes", "files", "tags", "prompts", "note"].indexOf(root.view) >= 0
               && root.actionItem.itemType !== "note" && root.actionItem.itemType !== "attachment") item = root.actionItem
    if (item) root.openChatWindow(item, "")
    else if (root.view !== "chats") root.openChats()
  }

  // x: extract the paper's text (in its menu), or open the menu on that row (from the results).
  function extractKey() {
    if (root.view === "actions") {
      for (let i = 0; i < actionModel.count; i++) if (actionModel.get(i).rowId === "extract") { root.selectedIndex = i; root.activateAction(i); return true }
      return true
    }
    if (root.inSearch && root.selectedIndex >= 0 && root.selectedIndex < displayModel.count && displayModel.get(root.selectedIndex).kind === "item") {
      const r = displayModel.get(root.selectedIndex)
      root.enterActionsFor({ key: r.key, libraryID: r.libraryID, title: r.title, itemType: r.itemType }, "", function(x) { return x.rowId === "extract" })
      return true
    }
    return false
  }

  // Single keys: a key waits keyDelay; a second one before that means typing, and both go to the
  // search box.
  function queueKey(ch) {
    root.keyBuffer += ch
    if (root.keyBuffer.length > 1) {
      const text = root.keyBuffer
      root.keyBuffer = ""
      keyTimer.stop()
      root.startTyping(text)
      return
    }
    keyTimer.restart()
  }

  function flushKeys() {
    keyTimer.stop()
    const ch = root.keyBuffer
    root.keyBuffer = ""
    if (!ch || !root.opened) return
    if (root.keyAction(ch)) return
    if (root.view === "prompt-edit") return // its rows are fixed: nothing to filter
    root.startTyping(ch)
  }

  // A key as the current mode writes it: "t", or "alt+t".
  function keyName(l) {
    return root.singleKeys ? l : "alt+" + l
  }

  function startTyping(text) {
    root.searchFocus = true
    root.setFilter(root.filterText + text)
  }

  // ------------------------------------------------------------ collections

  // Enter on a collection: its papers (and those of its subcollections), searchable;
  // Esc or Backspace goes back to where you were.
  function openCollection(row) {
    root.pushView("search")
    root.collectionScope = { key: row.key, libraryID: row.libraryID, title: row.kind === "tag" ? "#" + row.title : row.title, type: row.kind === "tag" ? "tag" : "collection" }
    root.response = null
    root.rebuildSearch()
    root.requestSearch()
  }

  // ------------------------------------------------------------ pins

  // Pin or unpin an item: pinned items head the list before you type.
  function togglePin(item) {
    if (!item || !root.service) return
    const was = Views.isPinned(root.service.pins, item)
    root.service.savePins(Views.togglePin(root.service.pins, item))
    root.libraryChanged = true // back in the results: search again for the Pinned section
    root.flashMessage(was ? "Unpinned" : "Pinned to the top")
  }

  // Shift+↑/↓ on a pinned item: moves it up or down among the pins (saved at once).
  function movePinned(delta) {
    const i = root.selectedIndex
    if (!root.service || i < 0 || i >= displayModel.count) return
    const row = displayModel.get(i)
    const j = i + delta
    if (row.section !== "Pinned") return root.flashMessage("Shift+↑↓ reorders the pinned items (before you type)")
    if (j < 0 || j >= displayModel.count || displayModel.get(j).section !== "Pinned") return
    const other = displayModel.get(j)
    const type = function(r) { return r.kind === "collection" || r.kind === "tag" ? r.kind : "item" }
    root.service.savePins(Views.movePin(root.service.pins, { key: row.key, libraryID: row.libraryID, type: type(row) }, { key: other.key, libraryID: other.libraryID, type: type(other) }))
    displayModel.move(i, j, 1) // at once; the search that follows agrees
    root.selectedIndex = j
    root.followTop = false
    resultList.positionViewAtIndex(j, ListView.Contain)
    root.requestSearch()
  }

  // Alt+P on a result.
  function togglePinSelected() {
    if (root.selectedIndex < 0 || root.selectedIndex >= displayModel.count) return
    const row = displayModel.get(root.selectedIndex)
    root.togglePin({ key: row.key, libraryID: row.libraryID, title: row.title, type: row.kind === "collection" || row.kind === "tag" ? row.kind : "item" })
    root.libraryChanged = false
    root.requestSearch()
  }

  // ------------------------------------------------------------ settings (lib/Settings.js)

  // No AI model yet (or no runner): the paper's menu offers "Set up an AI model" instead of
  // Prompts and Chat, and the Settings row says so.
  function needsSetup() {
    return root.service ? Settings.needsSetup(root.settingsState()) : false
  }

  function settingsState() {
    const s = root.service
    return {
      settings: s.settings, info: s.providersInfo, models: s.models, defaults: s.modelDefaults, tests: s.providerTests, open: "",
      runner: { installed: !s.runnerMissing && !/isn't installed/.test(String(s.promptsProblem || "")), installing: s.installing },
      reqs: s.requirements, setup: s.setupInfo,
      bridge: { status: s.status, version: s.bridge ? s.bridge.bridgeVersion : "", zoteroVersion: s.bridge ? s.bridge.zoteroVersion : "", expected: s.pluginVersion }
    }
  }

  function settingsRows() {
    if (!root.service) return []
    const st = root.settingsState()
    const L = Views.listRow
    let rows = []
    if (root.view === "settings") rows = Settings.buildRoot(st, L)
    else if (root.view === "settings-general") rows = Settings.buildGeneral(st, L)
    else if (root.view === "settings-providers") rows = Settings.buildProviders(st, L)
    else if (root.view === "settings-provider") rows = Settings.buildProvider(st, root.settingsProvider, L)
    else if (root.view === "settings-defaults") rows = Settings.buildDefaults(st, L)
    else if (root.view === "settings-models") rows = Settings.buildModelPicker(st, root.settingsModelsPath, L, root.settingsModelsOnly)
    else if (root.view === "settings-choice") rows = Settings.buildChoice(st, root.settingsChoice, L)
    else if (root.view === "settings-edit") return Settings.buildEditRows(root.settingsEdit, root.filterText, L)
    return Views.filterRows(rows, root.filterText)
  }

  // A setup step (Settings › Setup, or the results when Zotero or its plugin isn't working).
  function runSetupAction(action) {
    const s = root.service
    if (!s || !action) return
    if (action === "zotero-start") {
      s.launchZotero()
      root.flashMessage("Starting Zotero…")
      setupPoll.start()
    } else if (action === "zotero-get") {
      s.openUrl("https://www.zotero.org/")
      root.flashMessage("Opened zotero.org in your browser: download Zotero 10 there, then come back")
    } else if (action === "bridge-install") {
      root.flashMessage("Downloading the Zotero plugin…")
      s.installBridge(function(ok, path, error) {
        if (!ok) return root.flashMessage("Couldn't get the Zotero plugin: " + error)
        root.flashMessage("Saved " + path + " (path copied): in Zotero, Tools → Plugins → ⚙ → Install Plugin From File…")
        setupPoll.start()
      })
    } else if (action === "bind-add" || action === "rule-add") {
      s.addKeybinding(action === "rule-add", function(ok, msg, error) {
        root.flashMessage(ok ? (action === "bind-add" ? "SUPER+SHIFT+Z opens the launcher now" : "The launcher opens from the middle now") : "Not added: " + error)
      })
    } else if (action === "readme-keys") {
      s.openUrl("https://github.com/mbradaschia/oma-zotero-launcher#3-the-keybinding")
    } else if (action.indexOf("term:") === 0) {
      s.runInTerminal(action.slice(5))
      root.flashMessage("Running " + action.slice(5) + " in a terminal; come back here when it's done")
    } else if (action === "install") {
      s.installRunner()
      root.flashMessage("Installing the AI features: it's in Processes (" + root.keyName(".") + ")")
    } else if (action === "settings-setup") {
      root.openSettings("")
    } else if (action.indexOf("settings-") === 0) {
      root.openSettings(action.slice(9))
    }
  }

  // After starting Zotero or getting its plugin: check every few seconds until it answers.
  Timer {
    id: setupPoll
    interval: 3000
    repeat: true
    property int left: 60
    onRunningChanged: if (running) left = 60
    onTriggered: {
      if (!root.service || --left <= 0 || root.service.status === "ready") { stop(); if (root.service) root.service.refreshSetup(); return }
      root.service.refreshHandshake()
      root.service.ping()
    }
  }

  // Settings from the results (the Settings row) or the paper's menu (Set up an AI model):
  // the root page, or one of its pages on top of it (Esc goes back through the root).
  function openSettings(page) {
    if (!root.service) return
    root.pushView("settings")
    if (page) root.pushView("settings-" + page)
    root.rebuildList()
    root.service.refreshProviders()
    root.service.refreshRequirements()
    root.service.refreshModels()
    root.service.refreshSetup()
  }

  // Save one setting (validated, as the file would be read). → saved?
  function saveSetting(path, value, message) {
    const err = root.service.saveSettings(Settings.withValue(root.service.settings, path, value))
    if (err) {
      root.flashMessage("Not saved: " + err)
      return false
    }
    if (message) root.flashMessage(message)
    if (!/^general\./.test(path)) {
      root.service.refreshProviders()
      root.service.refreshModels()
    }
    root.followTop = false
    root.rebuildList()
    return true
  }

  function toggleSetting(path) {
    const key = path.replace(/^general\./, "")
    const item = Settings.generalItem(key)
    let cur
    if (/^endpoint\./.test(path)) {
      const ep = (root.service.settings.endpoints || []).find(function(e) { return e.id === path.split(".")[1] })
      cur = ep ? ep.enabled : false
    } else cur = Settings.getPath(root.service.settings, key)
    const on = cur === undefined || cur === null ? (item ? item.def : false) : cur
    if (!root.saveSetting(path, !on, "")) return
    const m = /^(providers|endpoint)\.([^.]+)\.enabled$/.exec(path)
    if (m) {
      root.flashMessage(on ? "Off: its models leave the pickers" : "On")
      if (!on) root.afterEnable(m[2])
    }
  }

  // A value typed in the header: numbers, commands, URLs, a context size.
  function openSettingsEdit(path) {
    const key = path.replace(/^general\./, "")
    let item = Settings.generalItem(key)
    let cur
    if (item) cur = Settings.getPath(root.service.settings, key)
    else {
      const field = path.split(".").pop()
      item = field === "baseURL" ? { key: path, label: "Base URL", type: "url", help: "e.g. http://localhost:11434/v1, or https://gateway.example.edu/v1" }
        : { key: path, label: "Context size", type: "context", help: "Tokens, e.g. 32768 or 32k; empty: the model's own" }
      const m = /^endpoint\.([^.]+)\.(.+)$/.exec(path)
      const ep = m ? (root.service.settings.endpoints || []).find(function(e) { return e.id === m[1] }) : null
      cur = m ? (ep ? ep[m[2]] : undefined) : Settings.getPath(root.service.settings, path)
    }
    const text = cur === undefined || cur === null ? "" : Array.isArray(cur) ? cur.join(" ") : String(cur)
    root.settingsEdit = { path: path, label: item.label, type: item.type, help: item.help || "", current: text, item: item,
      empty: item.type === "argv" || item.type === "context" ? "back to the default" : "" }
    root.pushView("settings-edit")
    root.filterText = text
    root.rebuildList()
  }

  function saveSettingsEdit(text) {
    const e = root.settingsEdit
    if (!e) return
    if (e.type === "endpoint-name") {
      if (!text) return
      root.settingsEdit = { path: "", label: "Base URL", type: "endpoint-url", name: text, help: "Its OpenAI-compatible API, e.g. http://localhost:1234/v1 (LM Studio) or https://gateway.example.edu/v1", current: "" }
      root.filterText = ""
      root.rebuildList()
      return
    }
    const r = Settings.parseValue(e.type === "endpoint-url" ? { type: "url", label: "Base URL" } : e.item, text)
    if (r.error) return root.flashMessage(r.error)
    if (e.type === "endpoint-url") {
      const res = Settings.addEndpoint(root.service.settings, e.name, r.value)
      const err = root.service.saveSettings(res.settings)
      if (err) return root.flashMessage("Not saved: " + err)
      root.back()
      root.service.refreshProviders()
      root.openProviderPage(res.id)
      root.flashMessage("Added “" + e.name + "”: set its key if it needs one, then test it")
      return
    }
    if (root.saveSetting(e.path, r.value, "Saved")) root.back()
  }

  function openProviderPage(id) {
    root.settingsProvider = id
    root.pushView("settings-provider")
    root.rebuildList()
    const t = root.service.providerTests[id]
    if (!t || !t.running) root.service.testProvider(id) // Test before use: it lists the models, or says what's wrong
  }

  // A default model picked (for prompts, chat, both, or the fallback).
  function chooseDefaultModel(path, value) {
    let next = root.service.settings
    if (path === "defaults.both") {
      next = Settings.withValue(next, "defaults.prompts.model", value)
      next = Settings.withValue(next, "defaults.chat.model", value)
    } else next = Settings.withValue(next, path, value)
    const err = root.service.saveSettings(next)
    if (err) return root.flashMessage("Not saved: " + err)
    root.service.refreshModels()
    root.back()
    root.flashMessage(value ? (path === "defaults.both" ? "Prompts and chat use " : "Now ") + value : "No fallback model")
  }

  // A provider just turned on: without a default model yet, its first model becomes the
  // default once its test lists them (Claude needs none: it is the built-in default).
  function afterEnable(id) {
    const d = root.service.settings.defaults
    if (id === "claude" || (d.prompts.model && d.chat.model)) return
    root.autoDefault = id
    root.service.testProvider(id)
  }

  function afterTest() {
    const id = root.autoDefault
    const t = id ? root.service.providerTests[id] : null
    if (!t || t.running) return
    root.autoDefault = ""
    if (!t.ok || !t.models || !t.models.length) return root.flashMessage("On, but not working yet: " + t.detail)
    const d = root.service.settings.defaults
    let next = root.service.settings
    if (!d.prompts.model) next = Settings.withValue(next, "defaults.prompts.model", t.models[0].value)
    if (!d.chat.model) next = Settings.withValue(next, "defaults.chat.model", t.models[0].value)
    if (!root.service.saveSettings(next)) {
      root.service.refreshModels()
      root.flashMessage("Default model: " + t.models[0].value + " (Settings › Defaults to change it)")
    }
  }

  // ------------------------------------------------------------ prompts

  // Enter on a prompt: the runner works in the background (a few minutes); the task shows
  // in Tasks (t) and a notification says when the note is saved. The launcher stays.
  function runPrompt(row) {
    const item = root.actionItem
    if (!root.service || !item) return
    root.service.runPrompt(row.promptId, item)
    root.flashMessage("Running “" + row.label + "”: it's in Processes (" + root.keyName(".") + ")")
  }

  // Alt+E on a prompt: the prompt editor.
  function editSelectedPrompt() {
    if (root.selectedIndex < 0 || root.selectedIndex >= actionModel.count) return
    const row = actionModel.get(root.selectedIndex)
    if (row.rowId !== "prompt") return
    const p = (root.service.prompts || []).find(function(x) { return x.id === row.promptId })
    if (p) root.openPromptEditor(p)
  }

  function openPromptEditor(prompt) {
    root.promptEdit = prompt
    root.pushView("prompt-edit")
    root.rebuildList()
    if (root.service) root.service.refreshModels()
  }

  // An option picked (on the model or effort page): shown at once, saved by the runner (the list
  // re-read confirms it), back on the editor.
  function choosePrompt(changes, parentRow) {
    const id = root.promptEdit.id
    root.promptEdit = Object.assign({}, root.promptEdit, changes)
    root.back()
    root.selectRow(function(r) { return r.rowId === parentRow })
    root.service.setPrompt(id, changes, function(ok, data, error) {
      if (!ok) root.flashMessage("Couldn't save the prompt: " + error)
    })
  }

  // Enter in the name view: create the prompt and open it in the editor, or rename it.
  function saveTitle(title) {
    if (!title || !root.service) return
    if (root.promptTitleMode === "create") {
      root.flashMessage("Creating…")
      root.service.newPrompt(title, function(ok, data, error) {
        if (!ok || !data) return root.flashMessage("Couldn't create the prompt: " + error)
        if (root.view !== "prompt-title") return
        root.back()
        root.openPromptEditor({ id: data.id, title: title, model: "", effort: "", excerpt: "" })
        root.flashMessage("Created “" + title + "”: pick its model and effort, then write it")
      })
    } else {
      const id = root.promptEdit.id
      root.promptEdit = Object.assign({}, root.promptEdit, { title: title })
      root.back()
      root.service.setPrompt(id, { title: title }, function(ok, data, error) {
        if (!ok) root.flashMessage("Couldn't rename the prompt: " + error)
      })
    }
  }

  // Close the overlay first (so Zotero or the viewer can take focus), then act.
  function finish(kind, att) {
    const item = root.actionItem
    const note = root.noteTarget
    root.dismiss()
    if (!root.service) return
    if (kind === "open") root.service.openItem(item)
    else if (kind === "reveal") root.service.reveal(item)
    else if (kind === "external" && att) root.service.openExternal(att)
    else if (kind === "window" && att) root.service.openInWindow(att)
    else if (kind === "note-open" && note) root.service.openNote(note)
  }

  function revealSelected() {
    if (root.selectedIndex < 0 || root.selectedIndex >= displayModel.count) return
    const row = displayModel.get(root.selectedIndex)
    if (row.kind === "collection") return root.activate(root.selectedIndex)
    if (row.kind === "tag") return root.openCollection(row)
    root.actionItem = { key: row.key, libraryID: row.libraryID, title: row.title, itemType: row.itemType }
    root.finish("reveal", null)
  }

  // ------------------------------------------------------------ notes

  // Notes: one note opens straight in the reader, several get the list.
  function enterNotes() {
    const notes = (root.details && root.details.notes) || []
    if (notes.length === 1) {
      root.openNoteView(notes[0])
    } else if (notes.length > 1) {
      root.pushView("notes")
      root.rebuildList()
    } else {
      root.selectRow(function(r) { return r.rowId === "notes-empty" })
      root.followTop = false
    }
  }

  function openNoteView(note) {
    root.noteTarget = { key: note.key, libraryID: note.libraryID, title: note.title || "Untitled note" }
    root.noteError = ""
    root.pushView("note")
    noteFlick.contentY = 0
    const cached = root.noteCache[note.key]
    if (cached) {
      root.noteData = cached
      return
    }
    root.noteData = null
    const serial = ++root.noteSerial
    if (!root.service) return
    root.service.noteContent(root.noteTarget, { format: "html" }, function(res) {
      if (serial !== root.noteSerial || !root.opened || !root.inNote) return
      if (res.kind === "ok") {
        root.noteData = res.data
        root.noteCache[res.data.key] = res.data
      } else {
        root.noteError = res.message || res.kind
      }
    })
  }

  // Shift+Enter (Alt+Z) on a note in a list: open it in Zotero without reading it here.
  function openSelectedNoteInZotero() {
    if (root.selectedIndex < 0 || root.selectedIndex >= actionModel.count) return
    const row = actionModel.get(root.selectedIndex)
    if (!row.noteKey) return
    root.noteTarget = { key: row.noteKey, libraryID: row.noteLibraryID, title: row.label }
    root.finish("note-open", null)
  }

  // ------------------------------------------------------------ note windows

  Component {
    id: noteWindowComponent
    NoteWindow {}
  }

  Component {
    id: chatWindowComponent
    ChatWindow {}
  }

  property var noteWindows: ({}) // note key → its NoteWindow

  // Alt+W (w while reading): the note in its own window (focused if it is open already);
  // the launcher closes.
  function openNoteWindow() {
    const target = root.selectedNoteTarget()
    if (!target || !root.service) return
    root.dismiss()
    const open = root.noteWindows[target.key]
    if (open) {
      Hyprland.dispatch("hl.dsp.focus({ window = \"title:^" + String(open.title).replace(/[\\^$.*+?()[\]{}|"]/g, ".") + "$\" })")
      return
    }
    const w = noteWindowComponent.createObject(root, { service: root.service, note: target })
    if (!w) return
    w.menuRequested.connect(root.showItemMenu)
    w.chatRequested.connect(function(item) { root.openChatWindow(item, "") })
    root.noteWindows[target.key] = w
    w.done.connect(function() { delete root.noteWindows[target.key] })
  }

  property var chatWindows: [] // the open ChatWindows

  // A paper's chat window (`sessionId`: a past chat to open, or "" for its latest state);
  // an open window for the paper is focused (and switched to that chat). The launcher closes.
  function openChatWindow(item, sessionId) {
    if (!item || !item.key || !root.service) return
    const paper = root.actionItem && root.actionItem.key === item.key && root.details ? root.details : null
    root.dismiss()
    const open = root.chatWindows.find(function(w) { return w.item && w.item.key === item.key && w.item.libraryID === item.libraryID })
    if (open) {
      if (sessionId) open.openSession(sessionId)
      Hyprland.dispatch("hl.dsp.focus({ window = \"title:^" + String(open.title).replace(/[\\^$.*+?()[\]{}|"]/g, ".") + "$\" })")
      return
    }
    const w = chatWindowComponent.createObject(root, {
      service: root.service,
      item: { key: item.key, libraryID: item.libraryID || 1, title: item.title || "" },
      paper: paper ? paper.paper : null,
      savedText: paper ? Views.fulltextNote(paper) : null,
      initialSession: sessionId || ""
    })
    if (!w) return
    w.menuRequested.connect(root.showItemMenu)
    root.chatWindows = root.chatWindows.concat([w])
    w.done.connect(function() {
      root.chatWindows = root.chatWindows.filter(function(x) { return x !== w })
      if (root.service) root.service.refreshChats()
    })
  }

  // From a note or chat window: the launcher, on that paper's menu, with the row the window
  // came from highlighted. `select`: { rowId, noteKey? }.
  function showItemMenu(item, select) {
    const payload = JSON.stringify({ menu: { item: item, select: select || null } })
    if (!root.opened && root.shell && typeof root.shell.summon === "function") root.shell.summon(root.pluginId, payload)
    else root.open(payload)
  }

  // New chat…: search for the paper to chat about.
  function pickPaperForChat() {
    root.pushView("search")
    root.pickFor = "chat"
    root.response = null
    root.rebuildSearch()
    root.requestSearch()
  }

  function openTasks() {
    root.pushView("tasks")
    root.rebuildList()
    if (root.service) root.service.refreshTasks()
  }

  function openChats() {
    root.pushView("chats")
    root.rebuildList()
    if (root.service) root.service.refreshChats()
  }

  // The note under the cursor in the actions or notes list, or the one being read.
  function selectedNoteTarget() {
    if (root.inNote) return root.noteTarget
    if (root.selectedIndex < 0 || root.selectedIndex >= actionModel.count) return null
    const row = actionModel.get(root.selectedIndex)
    return row.noteKey ? { key: row.noteKey, libraryID: row.noteLibraryID, title: row.rowId === "read" ? (root.actionItem ? root.actionItem.title : "Note") : row.label } : null
  }

  // Ctrl+C: the note as Zotero exports it (Markdown, whole, with its zotero:// links) to the clipboard.
  // Ctrl+S: the same, saved as a .md file in Downloads.
  function exportNote(how) {
    const target = root.selectedNoteTarget()
    if (!target || !root.service) return
    root.flashMessage(how === "save" ? "Saving…" : "Copying…")
    root.service.noteContent(target, { format: "export" }, function(res) {
      if (res.kind !== "ok") return root.flashMessage("Couldn't get the note" + (res.message ? ": " + res.message : ""))
      if (how === "copy") {
        root.flashMessage(root.service.copyText(res.data.markdown) ? "Copied the note as Markdown" : "Couldn't copy the note")
        return
      }
      const started = root.service.saveMarkdown(target.title, res.data.markdown, function(path, error) {
        if (!path) return root.flashMessage("Couldn't save the note: " + error)
        const shown = path.replace(Quickshell.env("HOME"), "~")
        root.flashMessage("Saved " + shown)
        root.service.notify("Saved the note as Markdown", shown)
      })
      if (!started) root.flashMessage("Still saving the last note")
    })
  }

  function openLink(link) {
    if (!/^(https?|mailto):/i.test(String(link))) return
    root.dismiss()
    Util.execArgv(["uwsm-app", "--", "xdg-open", String(link)])
  }

  function lineStep() {
    return Math.round(root.noteTextSize * 1.5) * 3
  }

  function notePage() {
    return Math.max(root.lineStep(), noteFlick.height - Style.font.title * 3)
  }

  function scrollNote(dy) {
    const max = Math.max(0, noteFlick.contentHeight - noteFlick.height)
    noteFlick.contentY = Math.max(0, Math.min(max, noteFlick.contentY + dy))
  }

  // ------------------------------------------------------------ tags

  function enterTags() {
    const d = root.details || ({})
    const libraryID = d.library ? d.library.libraryID : ((root.actionItem && root.actionItem.libraryID) || 1)
    const cached = root.tagListCache[libraryID]
    root.pushView("tags")
    root.tagState = {
      libraryID: libraryID,
      tags: cached || [],
      itemTags: Views.tagMap(d.tags),
      initial: (d.tags || []).map(function(t) { return t.tag }),
      editable: !(d.library && d.library.editable === false),
      loading: !cached
    }
    root.rebuildList()
    if (cached || !root.service) return
    const serial = ++root.tagSerial
    root.service.tagList(libraryID, function(res) {
      if (serial !== root.tagSerial || !root.opened || root.view !== "tags") return
      if (res.kind === "ok") {
        root.tagListCache[libraryID] = res.data.tags
        root.tagState = Object.assign({}, root.tagState, { tags: res.data.tags, loading: false, editable: root.tagState.editable && res.data.editable })
      } else {
        root.tagState = Object.assign({}, root.tagState, { loading: false })
        root.lastError = "Couldn't load the tags: " + (res.message || res.kind)
      }
      root.rebuildList()
    })
  }

  // Enter on a tag: add or remove it (shown at once, undone if Zotero refuses); create:
  // add the typed name as a new tag. Either way the filter clears for the next tag.
  function toggleTag(name, create) {
    const st = root.tagState
    name = String(name || "").trim()
    if (!st || !name || !root.service) return
    if (!st.editable) {
      root.lastError = "This library is read-only"
      return
    }
    const on = Object.prototype.hasOwnProperty.call(st.itemTags, name)
    if (create && on) {
      root.flashMessage("“" + name + "” is already on this item")
      root.clearFilterKeeping(name)
      return
    }
    const adding = !on
    const itemTags = Object.assign({}, st.itemTags)
    const tags = st.tags.slice()
    if (adding) itemTags[name] = 0
    else delete itemTags[name]
    const i = tags.findIndex(function(t) { return t.tag === name })
    if (i >= 0) tags[i] = Object.assign({}, tags[i], { count: Math.max(0, (tags[i].count || 0) + (adding ? 1 : -1)) })
    else if (adding) tags.push({ tag: name, types: [0], count: 1, color: null, position: null })
    root.tagState = Object.assign({}, st, { itemTags: itemTags, tags: tags })
    root.tagListCache[st.libraryID] = tags
    root.libraryChanged = true
    root.lastError = ""
    root.tagPending++
    const item = root.actionItem
    root.service.updateTags(item, adding ? [name] : [], adding ? [] : [name], function(res) {
      root.tagPending--
      const here = root.opened && root.actionItem === item
      if (res.kind === "ok") {
        if (here && root.details) root.details = Object.assign({}, root.details, { tags: res.data.tags, tagCount: res.data.tags.length })
        if (here && root.tagPending === 0 && root.view === "tags") {
          root.tagState = Object.assign({}, root.tagState, { itemTags: Views.tagMap(res.data.tags) })
          root.refreshTagRows()
        }
        if (here) root.flashMessage((adding ? "Added “" : "Removed “") + name + "”")
      } else if (here) {
        if (root.view === "tags") {
          const cur = Object.assign({}, root.tagState.itemTags)
          if (adding) delete cur[name]
          else cur[name] = st.itemTags[name]
          root.tagState = Object.assign({}, root.tagState, { itemTags: cur })
          root.refreshTagRows()
        }
        root.lastError = "Couldn't " + (adding ? "add" : "remove") + " “" + name + "”: " + (res.message || res.kind)
      }
    })
    root.clearFilterKeeping(name)
  }

  function clearFilterKeeping(tagName) {
    root.filterText = ""
    root.followTop = false
    root.rebuildList()
    root.selectRow(function(r) { return r.rowId === "tag" && r.tag === tagName })
  }

  // Rebuild the tag rows in place (same filter), keeping the cursor on its tag.
  function refreshTagRows() {
    const current = root.selectedIndex >= 0 && root.selectedIndex < actionModel.count ? actionModel.get(root.selectedIndex).tag : ""
    const follow = root.followTop
    root.followTop = false
    root.rebuildList()
    root.followTop = follow
    if (current) root.selectRow(function(r) { return r.tag === current })
  }

  // ------------------------------------------------------------ navigation

  function select(delta) {
    const count = root.currentCount()
    if (count === 0) return
    root.followTop = false
    let i = root.selectedIndex + delta
    if (Math.abs(delta) === 1) i = (i + count) % count
    else i = Math.max(0, Math.min(count - 1, i))
    root.selectedIndex = i
    pointerGate.reset()
    root.currentList().positionViewAtIndex(i, ListView.Contain)
  }

  function pageSize() {
    return Math.max(1, Math.floor(root.currentList().height / root.rowHeight) - 1)
  }

  // Enter in the search view: open the selected item in Zotero; with Zotero down, start it.
  function activate(index) {
    if (index >= 0 && index < displayModel.count) {
      const row = displayModel.get(index)
      if (row.kind === "collection") {
        root.dismiss()
        if (root.service) root.service.revealCollection(row)
        return
      }
      if (row.kind === "tag") return root.openCollection(row) // a tag's papers are in the launcher
      root.actionItem = { key: row.key, libraryID: row.libraryID, title: row.title, itemType: row.itemType }
      root.finish("open", null)
      return
    }
    if (root.status === "zotero-down" && root.service) {
      root.dismiss()
      root.service.launchZotero()
    }
  }

  function handleKey(event) {
    const k = event.key
    const mods = event.modifiers
    const ctrl = (mods & Qt.ControlModifier) !== 0
    const alt = (mods & Qt.AltModifier) !== 0
    const shift = (mods & Qt.ShiftModifier) !== 0
    const enter = k === Qt.Key_Return || k === Qt.Key_Enter
    // Esc: close an open dropdown, else clear the filter, else go back a level; it only
    // closes the launcher from the results.
    if (k === Qt.Key_Escape) {
      root.keyBuffer = ""
      keyTimer.stop()
      // single keys: Esc leaves the search box first (the list takes the keys)
      if (root.singleKeys && root.searchFocus && !root.textEntry && !root.inNote) root.searchFocus = false
      else if (root.filterText && !root.inNote) root.setFilter("")
      else if (!root.atRoot) root.back()
      else root.dismiss()
      return true
    }
    if (root.inNote) return root.handleNoteKey(k, ctrl, shift, alt)
    const printable = !!event.text && event.text.length === 1 && event.text.charCodeAt(0) >= 32 && event.text.charCodeAt(0) !== 127
      && (mods === Qt.NoModifier || mods === Qt.ShiftModifier)
    const listKeys = root.singleKeys && !root.typingNow
    // A key waiting to be told from typing acts before anything else that isn't another key.
    if (root.keyBuffer && !(listKeys && printable)) root.flushKeys()
    // The same keys mean the same thing in every view (README: Keys).
    if (enter && shift) { root.openInZotero(); return true }
    if (alt && !ctrl && k >= Qt.Key_1 && k <= Qt.Key_9) { root.pickNumber(k - Qt.Key_0); return true }
    if (alt && !ctrl && k > 0 && k < 128 && root.keyAction(String.fromCharCode(k).toLowerCase())) return true
    if (root.view === "settings-edit" && ctrl && k === Qt.Key_V) {
      if (root.service) root.service.paste(function(text) { if (text && root.view === "settings-edit") root.setFilter(root.filterText + text) })
      return true
    }
    if (root.view === "tags" && ctrl && enter) {
      root.toggleTag(root.filterText, true)
      return true
    }
    // The list has the keys: one key acts (after keyDelay); / or Tab gives them back to the search box.
    if (listKeys && printable) { root.queueKey(event.text); return true }
    if (root.singleKeys && k === Qt.Key_Tab && !shift) { if (!root.textEntry) root.searchFocus = true; return true }
    // The editor's rows are fixed: typing doesn't filter them.
    if (root.view === "prompt-edit" && event.text && !ctrl && !alt && !enter && k !== Qt.Key_Backspace && k !== Qt.Key_Tab && k !== Qt.Key_Backtab) return true
    if (Util.editsFilter(event, root.filterText)) {
      root.setFilter(Util.editedFilter(event, root.filterText))
      return true
    }
    if (!root.atRoot && (((k === Qt.Key_Backspace || k === Qt.Key_Left) && !root.filterText) || k === Qt.Key_Backtab || (k === Qt.Key_Tab && shift))) {
      root.back()
      return true
    }
    if (shift && !ctrl && !alt && (k === Qt.Key_Up || k === Qt.Key_Down) && root.inSearch) { root.movePinned(k === Qt.Key_Up ? -1 : 1); return true }
    if (k === Qt.Key_Up || (ctrl && (k === Qt.Key_K || k === Qt.Key_P))) { root.select(-1); return true }
    if (k === Qt.Key_Down || (ctrl && (k === Qt.Key_J || k === Qt.Key_N))) { root.select(1); return true }
    if (k === Qt.Key_PageUp) { root.select(-root.pageSize()); return true }
    if (k === Qt.Key_PageDown) { root.select(root.pageSize()); return true }
    if (root.inSearch) {
      if ((k === Qt.Key_Tab && !root.singleKeys) || k === Qt.Key_Right) { root.enterActions(root.selectedIndex, ""); return true }
      if (k === Qt.Key_Backtab) return true // never let Qt move focus
      // Enter: the paper's menu, or into the collection (no rows: start Zotero).
      if (enter && displayModel.count === 0) { root.activate(root.selectedIndex); return true }
      if (enter) { root.enterActions(root.selectedIndex, ""); return true }
    } else if (enter || k === Qt.Key_Tab || k === Qt.Key_Right) {
      root.activateAction(root.selectedIndex)
      return true
    }
    if (event.text && event.text.length === 1 && event.text.charCodeAt(0) >= 32 && event.text.charCodeAt(0) !== 127
        && (mods === Qt.NoModifier || mods === Qt.ShiftModifier)) {
      root.setFilter(root.filterText + event.text)
      return true
    }
    return false
  }

  // The note reader has no filter: keys act at once, the same as everywhere: z (or Shift+Enter)
  // Zotero, w window, y copy, s save, c chat about the paper, t tasks, ; settings; j/k and the
  // arrows scroll.
  function handleNoteKey(k, ctrl, shift, alt) {
    // Ctrl+- / Ctrl++ the text size (kept for the next notes, here and in note windows), Ctrl+0 the theme's
    if (ctrl && (k === Qt.Key_Minus || k === Qt.Key_Plus || k === Qt.Key_Equal || k === Qt.Key_0)) {
      if (root.service) root.flashMessage("Text " + root.service.stepNoteFont(k === Qt.Key_Minus ? -1 : k === Qt.Key_0 ? 0 : 1) + " px")
      return true
    }
    if (k === Qt.Key_Backspace || k === Qt.Key_Left || k === Qt.Key_H || k === Qt.Key_Backtab || (k === Qt.Key_Tab && shift)) root.back()
    else if (k === Qt.Key_Y) root.exportNote("copy")
    else if (k === Qt.Key_S) root.exportNote("save")
    else if (k === Qt.Key_C) root.chatKey()
    else if (k === Qt.Key_Period) root.openTasks()
    else if (k === Qt.Key_Semicolon) root.openSettings("")
    else if (k === Qt.Key_W) root.openNoteWindow()
    else if (k === Qt.Key_Z || ((k === Qt.Key_Return || k === Qt.Key_Enter) && shift)) root.finish("note-open", null)
    else if (alt && k === Qt.Key_P && root.actionItem) root.togglePin(root.actionItem)
    else if (k === Qt.Key_Up || k === Qt.Key_K) root.scrollNote(-root.lineStep())
    else if (k === Qt.Key_Down || k === Qt.Key_J) root.scrollNote(root.lineStep())
    else if (k === Qt.Key_PageUp || k === Qt.Key_B || (shift && k === Qt.Key_Space)) root.scrollNote(-root.notePage())
    else if (k === Qt.Key_PageDown || k === Qt.Key_Space) root.scrollNote(root.notePage())
    else if (k === Qt.Key_Home || (k === Qt.Key_G && !shift)) noteFlick.contentY = 0
    else if (k === Qt.Key_End || (k === Qt.Key_G && shift)) root.scrollNote(1e9)
    return true // swallow the rest (Tab must not move focus)
  }

  // What the list area says when the current view has no rows.
  function emptyState() {
    if (root.inSearch) {
      if (root.status === "zotero-down") return { icon: "", title: "Zotero isn't running", detail: "Press Enter to start it" }
      if (root.status === "bridge-missing") return { icon: "", title: "The Zotero bridge isn't installed", detail: "Install zotero-bridge in Zotero (see the plugin's README)" }
      if (root.status === "unauthorized") return { icon: "", title: "Zotero rejected the bridge token", detail: "Restart Zotero to refresh it" }
      if (root.lastError) return { icon: "", title: "Search failed", detail: root.lastError }
      if (root.loading || root.status === "unknown") return { icon: "", title: "Searching…", detail: "" }
      if (root.filterText) return { icon: "󰈉", title: "No matches for “" + root.filterText + "”", detail: "Tip: a:author  t:title  y:2019..2021  #tag  'exact  !exclude" }
      return { icon: "", title: "Nothing open in Zotero", detail: "Type to search your library" }
    }
    if (root.inNote) {
      if (root.noteError) return { icon: "", title: "Couldn't load the note", detail: root.noteError }
      if (!root.noteData) return { icon: "", title: "Loading the note…", detail: "" }
      return { icon: "", title: "This note is empty", detail: "Press Enter to open it in Zotero" }
    }
    if (root.view === "tags") {
      if (root.tagState && root.tagState.loading) return { icon: "", title: "Loading tags…", detail: "" }
      return { icon: Views.TAG_ICON, title: "No tags in this library yet", detail: "Type a name and press Enter to add it" }
    }
    if (root.details === null && root.lastError) return { icon: "", title: "Couldn't load the item", detail: root.lastError }
    if (root.filterText) return { icon: "󰈉", title: "No matches for “" + root.filterText + "”", detail: "" }
    return { icon: "", title: "Loading…", detail: "" }
  }

  function placeholder() {
    const title = root.actionItem ? root.actionItem.title : ""
    if (root.view === "actions") return "‹ " + title
    if (root.view === "files") return "‹ Choose a file"
    if (root.view === "notes") return "‹ Notes · " + title
    if (root.view === "note") return "‹ " + (root.noteParts.title || (root.noteTarget ? root.noteTarget.title : "Note"))
    if (root.view === "tags") return root.tagState && !root.tagState.editable ? "‹ Tags · read-only library" : "‹ Tags · type to find or create one"
    if (root.view === "prompts") return "‹ Prompts · " + title
    if (root.view === "prompt-edit") return "‹ Edit prompt · " + (root.promptEdit ? root.promptEdit.title : "")
    if (root.view === "prompt-title") return root.promptTitleMode === "create" ? "‹ New prompt · type its name" : "‹ Rename the prompt"
    if (root.view === "settings") return "‹ Settings"
    if (root.view === "settings-general") return "‹ Settings › General"
    if (root.view === "settings-providers") return "‹ Settings › Models & providers"
    if (root.view === "settings-provider") {
      const p = Settings.providerInfo(root.settingsState(), root.settingsProvider)
      return "‹ Models & providers › " + (p ? p.name : root.settingsProvider)
    }
    if (root.view === "settings-defaults") return "‹ Settings › Defaults"
    if (root.view === "settings-models") return root.settingsModelsPath === "defaults.both" ? "‹ The default model for prompts and chat" : "‹ Choose a model · type to find one"
    if (root.view === "settings-edit") return "‹ " + (root.settingsEdit ? root.settingsEdit.label : "") + " · type it (ctrl+v pastes)"
    if (root.view === "tasks") return "‹ Processes · prompt runs and extractions"
    if (root.view === "chats") return "‹ Chats · with your papers"
    const search = root.singleKeys && !root.searchFocus ? " · / to search" : ""
    if (root.pickFor === "chat" && root.inSearch) return "‹ type to find the paper" + search
    if (root.collectionScope) return "‹ type to search in it" + search
    return "Search Zotero…"
  }

  function countText() {
    if (root.view === "tasks") return Views.taskSummary(root.service ? root.service.tasks : []).text || "no processes"
    if (root.view === "chats") {
      const n = root.service && root.service.chats ? root.service.chats.length : 0
      return n + (n === 1 ? " chat" : " chats")
    }
    if (root.inSearch) return root.loading ? "…" : Views.countText(root.response, root.service ? root.service.itemCount : 0)
    if (root.view === "tags") return root.tagState && !root.tagState.loading ? Views.tagCountText(root.tagState) : "…"
    if (root.view === "prompts") {
      const n = ((root.service && root.service.prompts) || []).length
      return n + (n === 1 ? " prompt" : " prompts")
    }
    if (root.view === "prompt-edit") {
      if (!root.service || root.service.models) return ""
      return root.service.modelsProblem ? "models: " + root.service.modelsProblem : "loading models…"
    }
    if (root.view === "prompt-title") return ""
    if (root.view === "settings-models") {
      if (!root.service || !root.service.models) return "…"
      return actionModel.count + (actionModel.count === 1 ? " model" : " models")
    }
    if (root.inSettings) return root.service && root.service.installing ? "installing…" : ""
    if (root.view === "notes") {
      const n = ((root.details && root.details.notes) || []).length
      return n + (n === 1 ? " note" : " notes")
    }
    if (root.inNote) {
      if (!root.noteData) return "…"
      return root.noteData.truncated ? "long note: first part shown" : Views.shortDate(root.noteData.dateModified)
    }
    return root.details === null ? "…" : ""
  }

  // The footer's keys for where you are, in the current key mode (one key, or Alt+key). While the
  // list has the keys, "/ search" comes first: how to get back to the search box.
  function hints() {
    const h = root.hintsFor()
    const sp = "     "
    if (!root.singleKeys || root.searchFocus || root.inNote || root.textEntry) return h
    return "/ search" + sp + h.split("/ search" + sp).join("").replace(sp + "/ search", "")
  }

  function hintsFor() {
    const listRow = !root.inSearch && root.selectedIndex >= 0 && root.selectedIndex < actionModel.count ? actionModel.get(root.selectedIndex) : null
    const K = function(l) { return root.singleKeys ? l : "alt+" + l }
    const back = root.atRoot ? "esc close" : "⌫ esc back"
    const sp = "     "
    const places = K("c") + " chat" + sp + K(".") + " processes" + sp + K(";") + " settings"
    const slash = root.singleKeys ? "/ search" + sp : ""
    const row = (root.singleKeys ? "1…9" : "alt+1…9") + " row"
    // single keys, the search box has them: typing, moving, Enter, and Esc to hand them to the list
    if (root.singleKeys && root.searchFocus && !root.textEntry && !root.inNote)
      return "type to search" + sp + "↑↓ move" + sp + "↵ " + (root.inSearch ? (root.pickFor ? "chat about it" : "menu") : "choose") + sp + "esc one-key actions"
    const noteKeys = "↵ read" + sp + "⇧↵ " + K("z") + " zotero" + sp + K("w") + " window" + sp + K("y") + " copy .md" + sp + K("s") + " save .md" + sp + slash + back
    if (root.inNote) return "z zotero" + sp + "w window" + sp + "y copy .md" + sp + "s save .md" + sp + "c chat" + sp + "j k scroll" + sp + "ctrl -/+ size" + sp + "⌫ esc back"
    if (root.view === "actions") {
      if (listRow && (listRow.rowId === "note" || listRow.rowId === "read")) return noteKeys
      return "↵ run" + sp + row + sp + "⇧↵ " + K("z") + " zotero" + sp + K("o") + "/" + K("w") + " pdf" + sp + K("n") + " notes" + sp + K("#") + " tags" + sp + K("x") + " extract" + sp + K("c") + " chat" + sp + K("p") + " pin" + sp + slash + back
    }
    if (root.view === "notes") return noteKeys
    if (root.view === "prompts") {
      if (listRow && listRow.rowId === "prompt") return "↵ run it, save as a note" + sp + K("e") + " edit" + sp + slash + back
      return "↵ create" + sp + back
    }
    if (root.view === "prompt-title") return (root.promptTitleMode === "create" ? "↵ create" : "↵ rename") + sp + "esc clear, then back"
    if (root.view === "settings-edit") return "↵ save" + sp + "ctrl+v paste" + sp + "esc clear, then back"
    if (["prompt-edit", "prompt-model", "prompt-effort", "settings-choice", "settings-models"].indexOf(root.view) >= 0 || root.inSettings) {
      if (listRow && listRow.rowId === "set-key") return "↵ read the key from the clipboard" + sp + back
      if (listRow && (listRow.rowId === "set-info" || !listRow.available)) return row + sp + back
      const verb = listRow && (listRow.showCheck || listRow.rowId === "set-opt" || listRow.rowId === "set-model") ? "choose" : listRow && listRow.rowId === "set-toggle" ? "change" : listRow && listRow.rowId === "set-test" ? "test" : "open"
      return "↵ " + verb + sp + row + sp + slash + back
    }
    if (root.view === "files") return "↵ open" + sp + row + sp + back
    if (root.view === "tasks") {
      if (listRow && listRow.rowId === "task" && listRow.noteKey) return noteKeys
      return "↵ run" + sp + row + sp + back
    }
    if (root.view === "chats") return "↵ open" + sp + row + sp + slash + back
    if (root.view === "tags") {
      return root.tagState && !root.tagState.editable ? "read-only" + sp + back
        : "↵ add/remove" + sp + "ctrl+↵ new tag" + sp + slash + back
    }
    const cur = root.inSearch && root.selectedIndex >= 0 && root.selectedIndex < displayModel.count ? displayModel.get(root.selectedIndex) : null
    if (root.pickFor === "chat") return "↵ chat about it" + sp + slash + back
    if (cur && (cur.section === "Processes and chats" || cur.section === "Go to")) return "↵ open" + sp + row + sp + slash + places + sp + back
    if (cur && cur.kind === "collection") return "↵ open" + sp + "⇧↵ zotero" + sp + K("p") + " pin" + sp + slash + back
    if (cur && cur.kind === "tag") return "↵ its papers" + sp + K("p") + " pin" + sp + slash + back
    if (!root.accel) return "↵ menu" + sp + "⇧↵ zotero" + sp + slash + places + sp + back
    const pinned = cur && cur.section === "Pinned" ? sp + "⇧↑↓ reorder" : ""
    return "↵ menu" + pinned + sp + row + sp + "⇧↵ " + K("z") + " zotero" + sp + K("o") + "/" + K("w") + " pdf" + sp + K("n") + " notes" + sp + K("#") + " tags" + sp + K("p") + " pin" + sp + K("l") + " library" + sp + places + sp + slash + back
  }

  // Footer, right side: a flash message, else the last error, else a settings problem.
  function footerNote() {
    if (root.flash) return root.flash
    if (root.lastError && root.currentCount() > 0) return root.lastError
    const problems = root.service ? root.service.settingsProblems : []
    if (problems && problems.length) return "oma-zotero-launcher.json: " + problems[0]
    return ""
  }

  // ------------------------------------------------------------ scripting (omarchy-shell oma-zotero-launcher …)

  // "ctrl+enter", "alt+n", "shift+tab", "pagedown", "x" … → the same handleKey() real keys use.
  function pressKey(name) {
    const parts = String(name).toLowerCase().split("+")
    let key = parts.pop()
    let modifiers = Qt.NoModifier
    for (const m of parts) {
      if (m === "ctrl") modifiers |= Qt.ControlModifier
      else if (m === "alt") modifiers |= Qt.AltModifier
      else if (m === "shift") modifiers |= Qt.ShiftModifier
      else return "unknown modifier " + m
    }
    const named = {
      enter: Qt.Key_Return, tab: Qt.Key_Tab, escape: Qt.Key_Escape, backspace: Qt.Key_Backspace,
      left: Qt.Key_Left, right: Qt.Key_Right, up: Qt.Key_Up, down: Qt.Key_Down,
      pageup: Qt.Key_PageUp, pagedown: Qt.Key_PageDown, home: Qt.Key_Home, end: Qt.Key_End, space: Qt.Key_Space,
      minus: Qt.Key_Minus, plus: Qt.Key_Plus, equal: Qt.Key_Equal,
      semicolon: Qt.Key_Semicolon, slash: Qt.Key_Slash, hash: Qt.Key_NumberSign, period: Qt.Key_Period
    }
    let code
    let text = ""
    if (named[key] !== undefined) {
      code = named[key]
      if (key === "space") text = " "
      if (key === "tab" && (modifiers & Qt.ShiftModifier)) code = Qt.Key_Backtab
      if (!(modifiers & (Qt.ControlModifier | Qt.AltModifier))) text = { semicolon: ";", slash: "/", hash: "#", minus: "-", equal: "=", period: "." }[key] || text
    } else if (/^[a-z0-9]$/.test(key)) {
      code = key >= "a" ? Qt.Key_A + key.charCodeAt(0) - 97 : Qt.Key_0 + key.charCodeAt(0) - 48
      if (!(modifiers & (Qt.ControlModifier | Qt.AltModifier))) text = (modifiers & Qt.ShiftModifier) ? key.toUpperCase() : key
    } else {
      return "unknown key " + key
    }
    root.handleKey({ key: code, modifiers: modifiers, text: text })
    return "ok"
  }

  function snapshot() {
    const rows = []
    for (let i = 0; i < displayModel.count; i++) {
      const r = displayModel.get(i)
      rows.push({ kind: r.kind, key: r.key, title: r.title, section: r.section, openState: r.openState, tagsText: r.tagsText, ranks: r.ranks })
    }
    const actionRows = []
    for (let j = 0; j < actionModel.count; j++) {
      const a = actionModel.get(j)
      actionRows.push({
        rowId: a.rowId, label: a.label, detail: a.detail, enabled: a.available, submenu: a.submenu, attKey: a.attKey,
        noteKey: a.noteKey, section: a.section, tag: a.tag, checked: a.checked, badge: a.badge, trailing: a.trailing, swatch: a.swatch, value: a.value,
        highlighted: a.labelHtml !== Views.escapeHtml(a.label)
      })
    }
    return {
      opened: root.opened,
      view: root.view,
      scope: root.collectionScope,
      filterText: root.filterText,
      shownQuery: root.response ? String(root.response.query) : null,
      loading: root.loading,
      status: root.status,
      selectedIndex: root.selectedIndex,
      count: displayModel.count,
      geometry: { panel: [panel.width, panel.height], card: [card.x, card.y, card.width, card.height] },
      // true once the compositor has given the overlay keyboard focus (keys typed
      // before that still go to the previously focused window)
      keyboardFocus: keyCatcher.activeFocus && keyCatcher.Window.active,
      actionItem: root.actionItem,
      detailsLoaded: root.details !== null,
      filePurpose: root.filePurpose,
      actionRows: root.inSearch ? [] : actionRows,
      listCount: actionModel.count,
      rows: rows,
      emptyTitle: (root.inNote ? !noteFlick.visible : root.currentCount() === 0) ? root.emptyState().title : "",
      header: root.filterText || root.placeholder(),
      countText: root.countText(),
      hints: root.hints(),
      footer: root.footerNote(),
      searchFocus: root.searchFocus, singleKeys: root.singleKeys, hints: root.hints(),
      flash: root.flash,
      lastError: root.lastError,
      note: root.noteTarget ? {
        key: root.noteTarget.key,
        title: root.noteTarget.title,
        loaded: root.noteData !== null,
        error: root.noteError,
        truncated: root.noteData ? root.noteData.truncated : false,
        chars: root.noteData ? root.noteData.chars : 0,
        html: root.noteData ? String(root.noteData.html || "").slice(0, 4000) : "",
        rendered: noteText.text.length,
        lineCount: noteText.lineCount,
        linkColored: noteText.text.indexOf('<a style="color:') >= 0,
        contentY: Math.round(noteFlick.contentY),
        contentHeight: Math.round(noteFlick.contentHeight),
        viewHeight: Math.round(noteFlick.height)
      } : null,
      tags: root.tagState ? {
        loading: !!root.tagState.loading,
        editable: root.tagState.editable,
        libraryCount: root.tagState.tags.length,
        onItem: Object.keys(root.tagState.itemTags),
        pending: root.tagPending
      } : null
    }
  }

  ShellIpc {
    target: "oma-zotero-launcher"
    function toggle(): string { if (root.shell) root.shell.toggle(root.pluginId, "{}"); return "ok" }
    function close(): string { if (root.opened) root.dismiss(); return "ok" }
    function search(query: string): string { if (root.shell) root.shell.summon(root.pluginId, JSON.stringify({ query: query })); return "ok" }
    function type(text: string): string { if (!root.opened) return "closed"; if (root.inNote) return "ignored"; root.startTyping(text); return "ok" }
    function key(name: string): string { return root.opened ? root.pressKey(name) : "closed" }
    function state(): string { return JSON.stringify(root.snapshot()) }
    // Tests: the next opening starts fresh, as after a shell restart (instead of where it was left).
    function reset(): string { root.hasState = false; return "ok" }
    function settings(page: string): string { if (root.shell) root.shell.summon(root.pluginId, JSON.stringify({ settings: page || "root" })); return "ok" }
  }

  // ------------------------------------------------------------ view

  PointerMoveGate { id: pointerGate; referenceItem: card }

  // Opening: the card grows a little from the middle as it fades in. (Hyprland doesn't animate the
  // layer: its rule, in the README's keybinding step, keeps it from sliding in from the corner.)
  ParallelAnimation {
    id: openAnim
    NumberAnimation { target: card; property: "scale"; from: 0.94; to: 1; duration: 170; easing.type: Easing.OutCubic }
    NumberAnimation { target: card; property: "opacity"; from: 0; to: 1; duration: 130; easing.type: Easing.OutCubic }
    NumberAnimation { target: scrimFill; property: "opacity"; from: 0; to: 1; duration: 130 }
  }

  onOpenedChanged: if (root.opened) openAnim.restart()

  OverlayWindow {
    id: panel
    shown: root.opened
    WlrLayershell.namespace: "oma-zotero"

    Rectangle {
      id: scrimFill
      anchors.fill: parent
      color: root.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.dismiss()
    }

    BorderSurface {
      id: card
      width: root.cardWidth
      height: root.cardHeight
      anchors.centerIn: parent
      radius: root.cornerRadius
      color: root.background
      borderSpec: root.borderSpec
      padding: root.contentMargin

      MouseArea { anchors.fill: parent; onClicked: {} }

      Item {
        id: keyCatcher
        anchors.fill: parent
        focus: true
        Keys.priority: Keys.BeforeItem
        Keys.onPressed: function(event) {
          if (root.handleKey(event)) event.accepted = true
        }
      }

      Column {
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        spacing: Style.spacing.md

        // Header: the typed query (or placeholder) and a count.
        Item {
          width: parent.width
          height: root.headerHeight

          // What the search is limited to: a collection, a tag, or picking a paper for a chat
          Rectangle {
            id: scopeChip
            readonly property string label: root.pickFor === "chat" ? "New chat · pick a paper" + (root.collectionScope ? " in " + root.collectionScope.title : "")
              : root.collectionScope ? (root.collectionScope.type === "tag" ? "Tag  " : "Collection  ") + root.collectionScope.title : ""
            visible: root.inSearch && label !== ""
            anchors.left: parent.left
            anchors.leftMargin: Style.space(2)
            anchors.verticalCenter: parent.verticalCenter
            width: visible ? Math.min(chipText.implicitWidth + Style.space(16), parent.width * 0.45) : 0
            height: chipText.implicitHeight + Style.space(6)
            radius: height / 2
            color: "transparent"
            border.width: 1
            border.color: root.selectedText
            Text {
              id: chipText
              anchors.centerIn: parent
              width: parent.width - Style.space(16)
              horizontalAlignment: Text.AlignHCenter
              textFormat: Text.PlainText
              text: (root.collectionScope && root.collectionScope.type === "tag" ? "\uf02b  " : root.collectionScope ? "\uf07b  " : "\uf086  ") + scopeChip.label
              color: root.selectedText
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideMiddle
            }
          }

          // A blinking block cursor while the search box has the keys; none while the list has them.
          Rectangle {
            id: blockCursor
            readonly property bool active: root.typingNow && !root.inNote && root.opened
            visible: active && blink.on
            x: root.filterText ? queryText.x + Math.min(queryText.contentWidth, queryText.width) + Style.space(1) : queryText.x - width - Style.space(8)
            anchors.verticalCenter: parent.verticalCenter
            width: Math.max(2, Math.round(Style.font.heading * 0.55))
            height: Math.round(Style.font.heading * 1.15)
            color: root.foreground
            opacity: 0.85
            Timer {
              id: blink
              property bool on: true
              interval: 530
              repeat: true
              running: blockCursor.active
              onRunningChanged: on = true
              onTriggered: on = !on
            }
          }

          Text {
            id: queryText
            // Empty and typing: the placeholder starts after the cursor.
            readonly property bool typing: root.typingNow && !root.inNote
            anchors.left: scopeChip.visible ? scopeChip.right : parent.left
            anchors.leftMargin: (scopeChip.visible ? Style.space(10) : Style.space(4)) + (typing && !root.filterText ? blockCursor.width + Style.space(8) : 0)
            anchors.right: countLabel.left
            anchors.rightMargin: Style.space(12) + blockCursor.width
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: root.filterText || root.placeholder()
            color: root.foreground
            opacity: root.filterText ? (typing ? 1 : 0.7) : 0.58
            font.family: root.fontFamily
            font.pixelSize: Style.font.heading
            elide: root.filterText ? Text.ElideLeft : Text.ElideRight
          }

          Text {
            id: countLabel
            anchors.right: parent.right
            anchors.rightMargin: Style.space(4)
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: root.countText()
            color: root.foreground
            opacity: 0.5
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }
        }

        Item {
          id: listArea
          width: parent.width
          height: parent.height - root.headerHeight - root.footerHeight - parent.spacing * 2

          // ---- search results
          ListView {
            id: resultList
            anchors.fill: parent
            visible: root.inSearch
            model: displayModel
            clip: true
            spacing: Style.spacing.xxs
            boundsBehavior: Flickable.StopAtBounds

            section.property: "section"
            section.criteria: ViewSection.FullString
            section.delegate: Item {
              required property string section
              width: ListView.view.width
              height: section ? root.sectionHeight : 0
              visible: section !== ""

              Text {
                anchors.left: parent.left
                anchors.leftMargin: Style.space(12)
                anchors.bottom: parent.bottom
                anchors.bottomMargin: Style.space(5)
                textFormat: Text.PlainText
                text: parent.section.toUpperCase()
                color: root.foreground
                opacity: 0.45
                font.family: root.fontFamily
                font.pixelSize: root.sectionSize
                font.letterSpacing: 1
              }
            }

            delegate: BorderSurface {
              id: row
              required property int index
              required property string key
              required property string icon
              required property string titleHtml
              required property string subtitle
              required property string tagsText
              required property string ranks
              required property string openState
              required property int pdfCount
              required property int noteCount
              required property string kind

              readonly property bool hasCursor: row.index === root.selectedIndex
              readonly property color ink: row.hasCursor ? root.selectedText : root.foreground
              // The Tasks and Chats entries: smaller type, shorter rows.
              readonly property bool small: row.kind === "tasks" || row.kind === "chats" || row.kind === "settings"

              width: ListView.view.width
              height: row.small ? Math.round(root.rowHeight * 0.72) : root.rowHeight
              radius: root.cornerRadius
              color: row.hasCursor ? root.selectedBackground : "transparent"
              borderSpec: row.hasCursor ? root.selectedBorderSpec : Border.none()

              // Alt+N picks this row
              Text {
                readonly property int num: row.index - root.resultTop + 1
                visible: num >= 1 && num <= 9
                anchors.left: parent.left
                anchors.leftMargin: Style.space(3)
                anchors.verticalCenter: parent.verticalCenter
                textFormat: Text.PlainText
                text: String(num)
                color: row.hasCursor ? root.selectedText : root.foreground
                opacity: row.hasCursor ? 0.8 : 0.3
                font.family: root.fontFamily
                font.pixelSize: root.sectionSize
              }

              Text {
                id: iconText
                anchors.left: parent.left
                anchors.leftMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                width: Style.space(34)
                horizontalAlignment: Text.AlignHCenter
                textFormat: Text.PlainText
                text: row.icon
                color: row.ink
                opacity: 0.85
                font.family: root.fontFamily
                font.pixelSize: row.small ? root.rowSmallTitleSize : root.rowIconSize
              }

              Column {
                anchors.left: iconText.right
                anchors.leftMargin: Style.space(8)
                anchors.right: trail.left
                anchors.rightMargin: Style.space(12)
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(3)

                Text {
                  width: parent.width
                  textFormat: Text.StyledText
                  text: row.titleHtml
                  color: row.ink
                  font.family: root.fontFamily
                  font.pixelSize: row.small ? root.rowSmallTitleSize : root.rowTitleSize
                  font.weight: Font.Medium
                  elide: Text.ElideRight
                  maximumLineCount: 1
                }

                Item {
                  width: parent.width
                  height: subtitleText.implicitHeight
                  visible: row.subtitle.length > 0 || row.tagsText.length > 0

                  Text {
                    id: subtitleText
                    anchors.left: parent.left
                    anchors.right: tagsLabel.visible ? tagsLabel.left : parent.right
                    anchors.rightMargin: tagsLabel.visible ? Style.space(10) : 0
                    textFormat: Text.PlainText
                    text: row.subtitle
                    color: root.foreground
                    opacity: 0.55
                    font.family: root.fontFamily
                    font.pixelSize: row.small ? root.sectionSize : root.rowDetailSize
                    elide: Text.ElideRight
                  }

                  // The first tags, dimmer; they give way to the subtitle when space is short.
                  Text {
                    id: tagsLabel
                    anchors.right: parent.right
                    width: Math.min(implicitWidth, parent.width * 0.4)
                    visible: row.tagsText.length > 0
                    textFormat: Text.PlainText
                    text: row.tagsText
                    color: root.foreground
                    opacity: 0.4
                    font.family: root.fontFamily
                    font.pixelSize: root.rowDetailSize
                    elide: Text.ElideRight
                  }
                }
              }

              Row {
                id: trail
                anchors.right: parent.right
                anchors.rightMargin: Style.space(14)
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(12)

                // Journal rankings: ABS (AJG 2024) rating, FT50, UTD24
                Row {
                  anchors.verticalCenter: parent.verticalCenter
                  spacing: Style.space(4)
                  visible: row.ranks !== ""
                  Repeater {
                    model: row.ranks ? row.ranks.split("|") : []
                    delegate: Rectangle {
                      required property string modelData
                      readonly property bool isTop: Views.rankIsTop(modelData)
                      width: rankText.implicitWidth + Style.space(10)
                      height: rankText.implicitHeight + Style.space(2)
                      radius: height / 2
                      color: "transparent"
                      border.width: 1
                      border.color: isTop ? (row.hasCursor ? root.selectedText : Qt.rgba(root.selectedText.r, root.selectedText.g, root.selectedText.b, 0.7))
                                        : Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.3)
                      Text {
                        id: rankText
                        anchors.centerIn: parent
                        textFormat: Text.PlainText
                        text: parent.modelData
                        color: parent.isTop ? root.selectedText : root.foreground
                        opacity: parent.isTop ? 1 : 0.6
                        font.family: root.fontFamily
                        font.pixelSize: root.sectionSize
                      }
                    }
                  }
                }

                Text {
                  visible: row.pdfCount > 0
                  textFormat: Text.PlainText
                  text: "" + (row.pdfCount > 1 ? " " + row.pdfCount : "")
                  color: root.foreground
                  opacity: 0.5
                  font.family: root.fontFamily
                  font.pixelSize: root.rowDetailSize
                }

                Text {
                  visible: row.noteCount > 0
                  textFormat: Text.PlainText
                  text: " " + row.noteCount
                  color: root.foreground
                  opacity: 0.5
                  font.family: root.fontFamily
                  font.pixelSize: root.rowDetailSize
                }

                // ● open in Zotero; accent = the tab Zotero is showing right now
                Text {
                  visible: row.openState !== ""
                  textFormat: Text.PlainText
                  text: "●"
                  color: row.openState === "current" ? root.selectedText : root.foreground
                  opacity: row.openState === "current" ? 1 : 0.6
                  font.family: root.fontFamily
                  font.pixelSize: root.rowDetailSize
                }
              }

              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onPositionChanged: function(mouse) {
                  if (pointerGate.moved(row, mouse)) {
                    root.followTop = false
                    root.selectedIndex = row.index
                  }
                }
                onClicked: {
                  root.selectedIndex = row.index
                  root.activate(row.index)
                }
              }
            }
          }

          // ---- actions / file picker / notes / tags
          ListView {
            id: actionList
            anchors.fill: parent
            visible: !root.inSearch && !root.inNote
            model: actionModel
            clip: true
            spacing: Style.spacing.xxs
            boundsBehavior: Flickable.StopAtBounds

            // Headings, as in the results (the paper's menu: Notes, Prompts and chat, This paper).
            section.property: "section"
            section.criteria: ViewSection.FullString
            section.delegate: Item {
              required property string section
              width: ListView.view.width
              height: section ? root.sectionHeight : 0
              visible: section !== ""

              Text {
                anchors.left: parent.left
                anchors.leftMargin: Style.space(12)
                anchors.bottom: parent.bottom
                anchors.bottomMargin: Style.space(5)
                textFormat: Text.PlainText
                text: parent.section.toUpperCase()
                color: root.foreground
                opacity: 0.45
                font.family: root.fontFamily
                font.pixelSize: root.sectionSize
                font.letterSpacing: 1
              }
            }

            delegate: BorderSurface {
              id: actionRow
              required property int index
              required property string rowId
              required property string icon
              required property string labelHtml
              required property string detail
              required property bool available
              required property bool submenu
              required property bool showCheck
              required property bool checked
              required property string swatch
              required property string badge
              required property string trailing

              readonly property bool hasCursor: actionRow.index === root.selectedIndex
              readonly property color ink: actionRow.hasCursor ? root.selectedText : root.foreground
              readonly property bool compact: actionRow.rowId === "tag"
              // Task rows: smaller type and a shorter row (the queue can get long).
              readonly property bool small: actionRow.rowId === "task" || actionRow.rowId === "tasks-clear"
              // "Clear finished processes": smaller still, one line.
              readonly property bool tiny: actionRow.rowId === "tasks-clear"

              width: ListView.view.width
              height: actionRow.tiny ? Math.round(root.rowHeight * 0.55) : actionRow.compact ? Math.round(root.rowHeight * 0.72) : actionRow.small ? Math.round(root.rowHeight * 0.82) : root.rowHeight
              radius: root.cornerRadius
              opacity: actionRow.available ? 1 : 0.4
              color: actionRow.hasCursor ? root.selectedBackground : "transparent"
              borderSpec: actionRow.hasCursor ? root.selectedBorderSpec : Border.none()

              // Icon, or the tag's check mark
              // Alt+N picks this row
              Text {
                readonly property int num: actionRow.index - root.actionTop + 1
                visible: num >= 1 && num <= 9
                anchors.left: parent.left
                anchors.leftMargin: Style.space(3)
                anchors.verticalCenter: parent.verticalCenter
                textFormat: Text.PlainText
                text: String(num)
                color: actionRow.hasCursor ? root.selectedText : root.foreground
                opacity: actionRow.hasCursor ? 0.8 : 0.3
                font.family: root.fontFamily
                font.pixelSize: root.sectionSize
              }

              Text {
                id: actionIcon
                anchors.left: parent.left
                anchors.leftMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                width: Style.space(34)
                horizontalAlignment: Text.AlignHCenter
                textFormat: Text.PlainText
                text: actionRow.showCheck ? (actionRow.checked ? "" : "") : actionRow.icon
                color: actionRow.showCheck && actionRow.checked ? root.selectedText : actionRow.ink
                opacity: actionRow.showCheck && !actionRow.checked ? 0.35 : 0.85
                font.family: root.fontFamily
                font.pixelSize: actionRow.showCheck ? root.rowTitleSize : actionRow.tiny ? root.rowSmallTitleSize : root.rowIconSize
              }

              // Colored-tag swatch
              Rectangle {
                id: swatchDot
                anchors.left: actionIcon.right
                anchors.leftMargin: Style.space(6)
                anchors.verticalCenter: parent.verticalCenter
                width: actionRow.swatch ? Style.space(10) : 0
                height: Style.space(10)
                radius: height / 2
                visible: actionRow.swatch !== ""
                color: actionRow.swatch || "transparent"
              }

              Column {
                anchors.left: swatchDot.right
                anchors.leftMargin: actionRow.swatch ? Style.space(8) : Style.space(2)
                anchors.right: trailingText.left
                anchors.rightMargin: Style.space(12)
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(3)

                Row {
                  width: parent.width
                  spacing: Style.space(8)

                  Text {
                    width: Math.min(implicitWidth, parent.width - (badgeBox.visible ? badgeBox.width + parent.spacing : 0))
                    textFormat: Text.StyledText
                    text: actionRow.labelHtml
                    color: actionRow.ink
                    font.family: root.fontFamily
                    font.pixelSize: actionRow.tiny ? root.sectionSize : actionRow.small ? root.rowSmallTitleSize : root.rowTitleSize
                    font.weight: Font.Medium
                    elide: Text.ElideRight
                    maximumLineCount: 1
                  }

                  // "auto": an automatic tag (added by Zotero or an import, not by hand)
                  Rectangle {
                    id: badgeBox
                    visible: actionRow.badge !== ""
                    anchors.verticalCenter: parent.verticalCenter
                    width: badgeText.implicitWidth + Style.space(10)
                    height: badgeText.implicitHeight + Style.space(2)
                    radius: height / 2
                    color: "transparent"
                    border.width: 1
                    border.color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.3)

                    Text {
                      id: badgeText
                      anchors.centerIn: parent
                      textFormat: Text.PlainText
                      text: actionRow.badge
                      color: root.foreground
                      opacity: 0.6
                      font.family: root.fontFamily
                      font.pixelSize: root.sectionSize
                    }
                  }
                }

                Text {
                  width: parent.width
                  visible: text.length > 0 && !actionRow.tiny
                  textFormat: Text.PlainText
                  text: actionRow.detail
                  color: root.foreground
                  opacity: 0.55
                  font.family: root.fontFamily
                  font.pixelSize: actionRow.small ? root.sectionSize : root.rowDetailSize
                  elide: Text.ElideRight
                  maximumLineCount: 1
                }
              }

              Text {
                id: trailingText
                anchors.right: chevron.left
                anchors.rightMargin: text ? Style.space(10) : 0
                anchors.verticalCenter: parent.verticalCenter
                width: text ? implicitWidth : 0
                textFormat: Text.PlainText
                text: actionRow.trailing
                color: root.foreground
                opacity: 0.45
                font.family: root.fontFamily
                font.pixelSize: root.rowDetailSize
              }

              Text {
                id: chevron
                anchors.right: parent.right
                anchors.rightMargin: Style.space(14)
                anchors.verticalCenter: parent.verticalCenter
                textFormat: Text.PlainText
                text: actionRow.submenu ? "›" : ""
                color: actionRow.ink
                opacity: 0.45
                font.family: root.fontFamily
                font.pixelSize: Style.font.heading
              }

              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: actionRow.available ? Qt.PointingHandCursor : Qt.ArrowCursor
                onPositionChanged: function(mouse) {
                  if (pointerGate.moved(actionRow, mouse)) {
                    root.followTop = false
                    root.selectedIndex = actionRow.index
                  }
                }
                onClicked: {
                  root.selectedIndex = actionRow.index
                  root.activateAction(actionRow.index)
                }
              }
            }
          }

          // ---- one note, read as Markdown
          Flickable {
            id: noteFlick
            anchors.fill: parent
            visible: root.inNote && root.noteData !== null && (root.noteData.html || "") !== ""
            clip: true
            contentWidth: width
            contentHeight: noteColumn.implicitHeight + Style.space(12)
            boundsBehavior: Flickable.StopAtBounds

            Column {
              id: noteColumn
              x: Style.space(8)
              width: noteFlick.width - Style.space(16)
              spacing: Style.space(10)

              Text {
                width: parent.width
                visible: text.length > 0
                textFormat: Text.PlainText
                // The paper, cited: "Sirmon et al. (2007) · Managing Firm Resources …"
                text: root.noteData && root.noteData.paper ? [Views.paperCite(root.noteData.paper), root.noteData.paper.title].filter(function(x) { return x }).join(" · ") : ""
                color: root.foreground
                opacity: 0.5
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                elide: Text.ElideRight
              }

              Text {
                id: noteText
                width: parent.width
                textFormat: Text.RichText
                wrapMode: Text.Wrap
                text: root.inNote && root.noteData ? Views.noteHtml(root.noteParts.html, { size: root.noteTextSize, color: root.hex6(root.foreground),
                  accent: root.hex6(root.selectedText), dim: "rgba(" + Math.round(root.foreground.r * 255) + "," + Math.round(root.foreground.g * 255) + "," + Math.round(root.foreground.b * 255) + ",0.7)" }) : ""
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: root.noteTextSize
                onLinkActivated: function(link) { root.openLink(link) }

                HoverHandler {
                  cursorShape: noteText.hoveredLink ? Qt.PointingHandCursor : Qt.ArrowCursor
                }
              }

              Text {
                width: parent.width
                visible: root.noteData !== null && root.noteData.truncated
                textFormat: Text.PlainText
                text: "This note is long: the first part is shown here. Press z to read all of it in Zotero."
                color: root.foreground
                opacity: 0.55
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                wrapMode: Text.Wrap
              }
            }
          }

          // Empty / status card (any view with nothing to show)
          Column {
            anchors.centerIn: parent
            width: parent.width - Style.space(40)
            spacing: Style.space(8)
            visible: root.inNote ? !noteFlick.visible : root.currentCount() === 0
            readonly property var info: root.emptyState()

            Text {
              width: parent.width
              horizontalAlignment: Text.AlignHCenter
              textFormat: Text.PlainText
              text: parent.info.icon
              color: root.selectedText
              opacity: 0.8
              font.family: root.fontFamily
              font.pixelSize: Style.font.displayLarge
            }

            Text {
              width: parent.width
              horizontalAlignment: Text.AlignHCenter
              textFormat: Text.PlainText
              text: parent.info.title
              color: root.foreground
              opacity: 0.8
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
              wrapMode: Text.Wrap
            }

            Text {
              width: parent.width
              visible: text.length > 0
              horizontalAlignment: Text.AlignHCenter
              textFormat: Text.PlainText
              text: parent.info.detail
              color: root.foreground
              opacity: 0.5
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              wrapMode: Text.Wrap
            }
          }
        }

        // Footer: key hints, and on the right a confirmation, the last error or a settings problem
        Item {
          width: parent.width
          height: root.footerHeight

          Text {
            anchors.left: parent.left
            anchors.leftMargin: Style.space(4)
            anchors.right: noteLabel.visible ? noteLabel.left : taskLabel.visible ? taskLabel.left : parent.right
            anchors.rightMargin: noteLabel.visible || taskLabel.visible ? Style.space(12) : 0
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: root.hints()
            color: root.foreground
            opacity: 0.4
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            elide: Text.ElideRight
          }

          Text {
            id: noteLabel
            anchors.right: taskLabel.visible ? taskLabel.left : parent.right
            anchors.rightMargin: taskLabel.visible ? Style.space(14) : Style.space(4)
            anchors.verticalCenter: parent.verticalCenter
            width: Math.min(implicitWidth, parent.width / 2)
            visible: text !== ""
            textFormat: Text.PlainText
            text: root.footerNote()
            color: root.flash ? root.selectedText : root.foreground
            opacity: root.flash ? 0.9 : 0.55
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            elide: Text.ElideRight
          }

          // The task queue, always: running (in the accent), finished, failed
          Text {
            id: taskLabel
            readonly property var sum: Views.taskSummary(root.service ? root.service.tasks : [])
            anchors.right: parent.right
            anchors.rightMargin: Style.space(4)
            anchors.verticalCenter: parent.verticalCenter
            visible: sum.text !== ""
            textFormat: Text.PlainText
            text: (sum.running ? "⟳ " : sum.error ? "⚠ " : "✓ ") + sum.text
            color: sum.running ? root.selectedText : root.foreground
            opacity: sum.running ? 0.9 : 0.5
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }
      }
    }
  }
}
