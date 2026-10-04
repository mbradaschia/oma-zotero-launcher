import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Hyprland
import QtQuick
import qs.Commons
import qs.Ui
import "lib/Views.js" as Views
import "lib/Fuzzy.js" as Fuzzy
import "lib/Settings.js" as Settings
import "lib/Todos.js" as Todos
import "lib/Client.js" as Client

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
//             dropdowns, text) → "prompt-title" (new name); "New prompt…" → "prompt-title" (a name, or
//             what it should do: Write it with AI drafts it)
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
  property var chatMenu: null // the chat Shift+Enter opened a menu for: { id, title }
  property var artifactMenu: null // the artifact Shift+Enter opened a menu for (Service.artifacts' entry)
  // Tasks (to-dos; lib/Todos.js)
  property string todoId: "" // the task whose page is open
  property string todoField: "" // the field typed in the header: description | due | notes
  property var todoDraft: null // a new task being named: { item, context }
  property var statusEdit: null // Settings › Tasks: { id, name } of a status, or { mode: "add", group }
  property var lastDeletedTodo: null // { todo, index }: u brings it back
  // Paper statuses changed with Tab, shown at once and saved to Zotero a second after the last change:
  // "<lib>:<key>" → the status shown; and what each will change ({ item, from, to }).
  property var statusShown: ({})
  property var statusPending: ({})
  // A paper's default task moved with Shift+Alt+→ / ←, shown at once and saved a second after the last press:
  // "<lib>:<key>" → the status id shown; and what each will set ({ item, status }).
  property var taskShown: ({})
  property var taskPending: ({})
  readonly property var todoStatuses: root.service ? root.service.todoStatuses : Todos.statusesOf(null)
  property string detailsAt: "" // when the paper's details were last read (a process finishing after that re-reads them)
  // The paper's citation and bibliography entry, formatted for its menu's Copy rows (and copied at once
  // from there): { id: "libraryID:key", style, citation, bibliography, error }.
  property var citePreview: null
  property string settingsProvider: "" // the provider page shown
  property var settingsEdit: null // the value typed in the header: { path, label, type, help, current, item, … }
  property string settingsModelsPath: "" // the setting the model picker sets ("defaults.both": prompts and chat)
  property string settingsModelsOnly: "" // the picker shows one provider's models
  property string autoDefault: "" // a provider just turned on: its first model becomes the default once tested
  readonly property bool inSettings: root.view.indexOf("settings") === 0

  // Saved searches: the one a menu is open for ({ id, name, query, pinned }), what the
  // search-edit view does ("save" | "rename" | "query") and the search it would save.
  property var searchMenu: null
  property string searchEditMode: ""
  property string searchToSave: ""
  // The pinned search whose badge is selected above the results ("" = All): the top level
  // searches within it. Tab / Shift+Tab move along the badges.
  property string activeSearch: ""
  readonly property var pinnedSearches: root.service ? Views.pinnedSearches(root.service.searches) : []
  // The @ picker: the field whose values are listed; the bridge's best values for what is typed
  // ({ field, query, values, total, count }); each field's first page (nothing typed), for this opening.
  property string pickerField: ""
  property var facetResult: null

  // The search box colours its syntax (Views.queryHtml) with the theme's named colours
  // (colors.toml, followed as the theme changes), else the shell's accent, muted and urgent.
  property var themeColors: ({})
  readonly property var queryColors: ({
    op: root.themeColors.yellow || String(Color.accent),
    paren: root.themeColors.orange || String(Color.muted),
    field: root.themeColors.cyan || String(Color.accent),
    quote: root.themeColors.green || String(root.foreground),
    neg: root.themeColors.red || String(Color.urgent)
  })
  // Every pill's colour, by kind (Views.pillPalette: status, task, rank, taxonomy, scope, priority, neutral).
  readonly property var pillColors: Views.pillPalette(root.themeColors, { accent: root.hex6(root.selectedText), foreground: root.hex6(root.foreground), background: root.hex6(root.background) })
  // The typed text is a search (coloured) in the results and when editing a saved search.
  readonly property bool queryTyped: root.inSearch || (root.view === "search-edit" && root.searchEditMode === "query") || root.view === "todo-new"
  // Where the caret is in a search, counted from the end (0: at the end, where typing adds, and where
  // every other text entry keeps it); ← → Home End move it, and ( and " close themselves around it.
  property int caretBack: 0
  readonly property int caret: Math.max(0, root.filterText.length - root.caretBack)
  // The word at the caret is being typed: it stays text until finished (then it may be a block).
  property bool queryLive: false

  FileView {
    id: themeColorsFile
    path: Quickshell.env("HOME") + "/.local/state/omarchy/current/theme/colors.toml"
    printErrors: false
    watchChanges: true
    onFileChanged: reload()
    onLoaded: root.themeColors = Views.parseThemeColors(text())
    onLoadFailed: root.themeColors = ({})
  }

  // A theme switch repoints current/theme (the file itself may not change): read it again then.
  readonly property string shellTheme: String(Color.accent) + String(Color.foreground) + String(Color.background)
  onShellThemeChanged: themeColorsFile.reload()
  property var facetCache: ({})
  property bool facetLoading: false
  property int facetSerial: 0

  // Keys (README: Keys). "single": the search box has the keys until Esc; then one key acts
  // (after keyDelay, so that two quick keys are typing, which goes back to the search box).
  // "alt": typing always searches and Alt+key acts, as before.
  readonly property bool singleKeys: !root.service || root.service.settings.keys !== "alt"
  readonly property int keyDelay: root.service ? root.service.settings.keyDelay : 300
  property bool searchFocus: true // single-key mode: typing goes to the search box
  property string keyBuffer: "" // keys waiting to be told apart from typing
  // Views where typing is the point: the search box always has the keys.
  // Where the search box has the keys on arriving: pages for typing (a name, a task's line, a date)
  // and the pickers you type into (@, a task's @, the tag editor). Anywhere else the list has them
  // unless something is typed (/ or typing gives them to the search box).
  // Settings › General › Where the keys start: "search" brings back the search box first everywhere.
  readonly property bool searchFirst: !!(root.service && root.service.settings.keysStart === "search")
  readonly property bool typingView: root.textEntry || ["picker", "picker-values", "todo-tags", "tags"].indexOf(root.view) >= 0
  readonly property bool textEntry: ["prompt-title", "settings-edit", "chat-rename", "artifact-change", "artifact-rename", "todo-new", "todo-text", "todo-due", "status-name", "search-edit", "tag-name"].indexOf(root.view) >= 0
  readonly property bool typingNow: !root.singleKeys || root.searchFocus || root.textEntry

  Timer {
    id: statusSave
    interval: 1000
    onTriggered: root.flushStatuses()
  }

  Timer {
    id: taskSave
    interval: 1000
    onTriggered: root.flushDefaultTasks()
  }

  Timer {
    id: keyTimer
    interval: root.keyDelay
    onTriggered: root.flushKeys()
  }

  // A short confirmation in the footer ("Copied …", "Added …").
  property string flash: ""

  readonly property string pluginId: (root.manifest && root.manifest.id) || "io.github.mbradaschia.oma-zotero"
  // omarchy-shell oma-zotero-launcher …; a copy installed under another id (a development
  // checkout: io.github.mbradaschia.oma-zotero-<name>) answers as oma-zotero-launcher-<name>.
  readonly property string ipcTarget: !root.manifest ? "" : "oma-zotero-launcher" + root.pluginId.replace(/^io\.github\.mbradaschia\.oma-zotero/, "")
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
  // Two lines: the key hints wrap beside the badges on the right.
  property int footerGap: Style.space(8) // between the footer's key hints and its status row
  property int footerHeight: Math.max(Style.space(30), Math.ceil(Style.font.caption * 2.6) + Style.space(6)) + root.footerGap
  // Row type in the results and the paper's menu: a step below the theme's list sizes, so more
  // fits (the chat window keeps its own).
  readonly property int rowTitleSize: Style.font.body
  readonly property int rowDetailSize: Style.font.caption
  // One size for every list's icons (results, menus, tasks, settings), short rows included.
  readonly property int rowIconSize: Style.font.body
  readonly property int rowSmallTitleSize: Style.font.bodySmall
  readonly property int sectionSize: Math.max(8, Style.font.caption - 1)
  // The search box's text, and its blocks' labels (a size smaller, so a block sits within the line).
  readonly property int searchFontSize: Style.font.title
  readonly property int searchBlockSize: Style.font.bodySmall
  // A row's two lines: each as tall as its font's line (FontMetrics: the font's own ascent and descent,
  // so a font with tall metrics doesn't overflow), a fixed gap between them; pills on the second line
  // are sized to it, so they never reach the first.
  readonly property int titleLine: Math.ceil(titleMetrics.height)
  readonly property int detailLine: Math.ceil(detailMetrics.height)
  readonly property int lineGap: Style.space(3)
  FontMetrics { id: titleMetrics; font.family: root.fontFamily; font.pixelSize: root.rowTitleSize; font.weight: Font.Medium }
  FontMetrics { id: detailMetrics; font.family: root.fontFamily; font.pixelSize: root.rowDetailSize }
  // One row height for every list (results, menus, tasks, settings…), with the same gap between rows;
  // never less than its two lines and a little room around them.
  property int rowHeight: Math.max(Style.space(38), root.rowTitleSize + root.rowDetailSize + Style.space(16), root.titleLine + root.lineGap + root.detailLine + Style.space(5))
  property int statusStripHeight: Math.max(Style.space(18), root.sectionSize + Style.space(8))
  property int contextHeight: Math.max(Style.space(16), Style.font.bodySmall + Style.space(4))
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
    if (!Object.keys(root.statusPending).length) root.statusShown = ({}) // what Zotero has now comes with the search
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
    root.facetCache = ({})
    root.tagCounts = null
    root.activeSearch = ""
    root.libraryChanged = false
    root.flash = ""
    root.filterText = typeof payload.query === "string" ? payload.query : ""
    root.caretBack = 0
    root.queryLive = false
    root.selectedIndex = 0
    root.followTop = true
    root.lastError = ""
    // Rows cached from last time are only worth showing for the same query.
    if (root.response && (root.response.scope || String(root.response.query) !== root.filterText)) root.response = null
    root.opened = true
    pointerGate.reset()
    Hyprland.refreshToplevels()
    if (root.service) {
      root.service.syncStatusLists() // statuses made or renamed in Zotero
      root.service.refreshTasks()
      root.service.refreshChats()
      root.service.refreshArtifacts()
      root.service.refreshHandshake()
      root.service.refreshSettings()
      root.service.ping()
      root.service.refreshSetup()
      root.service.refreshSync()
      root.service.refreshTaxonomies()
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
    if (typeof payload.settings === "string" && root.service) root.openSettings(["general", "providers", "defaults", "rules"].indexOf(payload.settings) >= 0 ? payload.settings : "")
    // Nothing typed (the keybinding): the list has the keys; a query asked for keeps the search box.
    if (!root.filterText) root.searchFocus = root.searchFirst || root.typingView
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.windowed = false
    root.opened = false
  }

  // ------------------------------------------------------------ as a window (W)

  // The launcher in a regular window instead of the overlay: the same card, moved into floatWin;
  // it stays when you click elsewhere. W again (or the keybinding) puts it back as the overlay.
  property bool windowed: false
  property Item cardHome: null

  function toggleWindowed() {
    root.windowed = !root.windowed
    root.flashMessage(root.windowed ? "A window now: W puts it back" : "")
  }

  onWindowedChanged: {
    card.parent = root.windowed ? floatWin.contentItem : root.cardHome
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  FloatingWindow {
    id: floatWin
    visible: root.windowed && root.opened
    title: "Zotero"
    implicitWidth: root.cardWidth
    implicitHeight: root.cardHeight
    color: root.background
    // Closed by the compositor (a close-window key, the title bar): the launcher closes.
    onVisibleChanged: if (!visible && root.windowed) root.dismiss()
  }

  property bool hasState: false // opened before: reopening resumes (see open())

  function resume() {
    root.flash = ""
    root.lastError = ""
    root.noteCache = ({})
    root.tagListCache = ({})
    root.facetCache = ({})
    root.tagCounts = null
    root.opened = true
    pointerGate.reset()
    // Reopened with nothing typed: the list has the keys (/ for the search box), but on a page for typing.
    if (!root.filterText && (!root.searchFirst || root.atRoot)) root.searchFocus = root.searchFirst ? false : root.typingView
    root.keyBuffer = ""
    Hyprland.refreshToplevels()
    if (root.service) {
      root.service.syncStatusLists() // statuses made or renamed in Zotero
      root.service.refreshTasks()
      root.service.refreshChats()
      root.service.refreshArtifacts()
      root.service.refreshHandshake()
      root.service.refreshSettings()
      root.service.ping()
      root.service.refreshSync()
      root.service.refreshTaxonomies()
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
      root.detailsAt = new Date().toISOString()
      if (["actions", "notes", "files", "extract-menu", "tax-paper", "tax-audit"].indexOf(root.view) >= 0) {
        root.followTop = false
        root.rebuildList()
      }
    })
  }

  function dismiss() {
    if (root.fieldDraft) root.commitField()
    root.windowed = false
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
    const scope = root.searchScope()
    root.requestedScope = root.scopeKey(scope)
    root.service.search(root.filterText, scope)
  }

  property string requestedScope: "" // the scope (and a saved search's query) last searched in

  function scopeKey(scope) {
    return root.scopeId(scope) + (scope && scope.type === "search" ? "|" + scope.query : "")
  }

  // What the results are searched within: the collection, tag or saved search opened, else (at the
  // top level) the pinned search whose badge is selected, else nothing.
  function searchScope() {
    if (root.collectionScope) return root.collectionScope
    if (root.pickFor || !root.activeSearch) return null
    const s = Views.findSearch(root.pinnedSearches, root.activeSearch)
    return s ? Views.searchScope(s) : null
  }

  // `caret` (optional): where the caret goes; else the end. `live`: the word there is being typed.
  function setFilter(text, caret, live) {
    blink.on = true
    root.filterText = text
    root.caretBack = caret === undefined ? 0 : Math.max(0, text.length - caret)
    root.queryLive = !!live
    root.followTop = true
    pointerGate.reset()
    if (root.inSearch) root.requestSearch()
    else if (root.view === "picker-values") root.refreshFacets()
    else if (!root.inNote) root.rebuildList()
  }

  function scopeId(scope) {
    return scope ? (scope.type || scope.kind || "collection") + ":" + scope.key + ":" + scope.libraryID : ""
  }

  function applyResponse(resp) {
    // A response for another level (a collection we left, or the top level we left for one).
    if (root.inSearch && root.scopeId(resp.scope) !== root.scopeId(root.searchScope())) return
    root.response = resp
    if (resp.scope) {
      const n = resp.scope.itemCount !== undefined ? resp.scope.itemCount : resp.scope.count !== undefined && resp.scope.kind === "tag" ? resp.scope.count : !String(resp.query || "").trim() ? resp.total : null
      if (n !== null && n !== undefined) root.scopeTotal = Views.scopeCount(n)
    } else root.scopeTotal = ""
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
    return { tasks: root.service.processes, chats: root.service.chats ? root.service.chats.length : -1, setup: root.needsSetup(), keys: root.singleKeys ? "single" : "alt", statuses: root.paperStatusTags, sync: root.service.syncInfo,
      extracting: !!root.service.extractState.catchup, scopeTitle: root.searchScope() ? "“" + root.searchScope().title + "”" : "",
      settingsIndex: root.filterText.trim() ? root.settingsIndex() : [] }
  }

  // Every Settings row as it is now, for the results' Go to (typing extract, jev, citation, keyring…): its page
  // (the one Enter opens: a page's own row opens that page) and the row, to land on it.
  function settingsIndex() {
    if (!root.service) return []
    const st = root.settingsState()
    const L = Views.listRow
    const pages = [
      ["", "Settings", Settings.buildRoot(st, L)],
      ["general", "General", Settings.buildGeneral(st, L)],
      ["providers", "Models & providers", Settings.buildProviders(st, L)],
      ["defaults", "Defaults", Settings.buildDefaults(st, L)],
      ["rules", "Rules", Settings.buildRules(st, L)],
      ["paper-status", "Paper status", Settings.buildPaperStatusSettings(root.paperStatuses, L)],
      ["taxonomies", "Taxonomies", Settings.buildTaxonomies(st, L)],
      ["tasks", "Tasks", Todos.buildStatusSettings(root.todoStatuses, root.service.todos, L).concat(Todos.buildActionSettings(root.service.taskActions, L), Todos.buildDefaultTaskSettings(root.service.settings, L))]
    ]
    const out = []
    pages.forEach(function(p) {
      p[2].forEach(function(r) {
        if (!r.label || (r.rowId === "set-info" && !r.available)) return
        const nav = r.rowId === "set-nav"
        out.push({ page: nav ? r.value : p[0], pageTitle: nav ? r.label : p[1], label: r.label, detail: r.detail, section: r.section, rowId: nav ? "" : r.rowId, value: nav ? "" : r.value })
      })
    })
    return out
  }

  // A setting found in the results: its page, on its row.
  function openSettingAt(key) {
    const k = String(key).split("\u0001")
    root.openSettings(k[0])
    if (!k[1]) return
    root.followTop = false
    root.selectRow(function(r) { return r.rowId === k[1] && r.value === k[2] && r.label === k[3] })
      || root.selectRow(function(r) { return r.rowId === k[1] && r.value === k[2] })
  }

  // Zotero or its plugin isn't working: the results show what to do (Settings › Setup's first steps).
  readonly property bool setupNeeded: ["zotero-down", "bridge-missing", "unauthorized"].indexOf(root.status) >= 0

  function setupResultRows() {
    // The first steps, done or not (a check on the done ones), so you see where you are.
    const items = Settings.setupItems(root.settingsState()).filter(function(it) { return ["zotero-install", "zotero-start", "bridge"].indexOf(it.id) >= 0 })
    const rows = []
    items.forEach(function(it) {
      rows.push(Views.setupResultRow(it.action, it.ok ? "\uf49e" : it.icon, it.label + (it.ok ? "  ✓" : ""), it.detail))
      ;(it.steps || []).forEach(function(st, i) { rows.push(Views.setupResultRow("", "", (i + 1) + ". " + st, "")) })
    })
    rows.push(Views.setupResultRow("settings-setup", Settings.ICON.settings, "Everything else to set up", "Settings › Setup: the keybinding, the AI features and a model"))
    return rows
  }

  // How the results' papers are grouped or sorted (g / G; Views.GROUPINGS), kept in view.json.
  readonly property string grouping: root.service && root.service.viewPrefs.grouping ? String(root.service.viewPrefs.grouping) : "relevance"
  readonly property bool groupable: !!(root.response && (root.response.scope || String(root.response.query || "").trim()) && !root.setupNeeded)
  // The taxonomies g also groups by (Settings › Taxonomies): [{ id, name, prefix, labels }].
  readonly property var taxonomyList: root.service && root.service.taxonomies ? root.service.taxonomies.taxonomies || [] : []

  function cycleGrouping(delta) {
    if (!root.service) return
    const next = Views.nextGrouping(root.grouping, delta, root.taxonomyList)
    root.service.setViewPref("grouping", next === "relevance" ? undefined : next)
    root.followTop = false
    if (root.inSearch) root.rebuildSearch()
    const name = Views.groupingName(next, root.taxonomyList)
    root.flashMessage("Papers: " + (name || "by relevance") + (root.groupable || !root.inSearch ? "" : " (once you search)"))
  }

  // Papers whose notes show under them in the results (Space): { "libraryID:key": [notes] }.
  property var expandedNotes: ({})

  // Space on a paper (or one of its notes): show or hide its notes under it.
  function toggleNotes() {
    if (!root.inSearch || root.selectedIndex < 0 || root.selectedIndex >= displayModel.count) return false
    let i = root.selectedIndex
    while (i > 0 && displayModel.get(i).kind === "note-child") i--
    const r = displayModel.get(i)
    if (r.kind !== "item" || r.itemType === "note" || r.itemType === "attachment") return false
    const id = r.libraryID + ":" + r.key
    const paper = { key: r.key, libraryID: r.libraryID }
    if (root.expandedNotes[id]) {
      const ex = Object.assign({}, root.expandedNotes)
      delete ex[id]
      root.expandedNotes = ex
      root.followTop = false
      root.selectedIndex = i // the paper keeps the cursor
      root.rebuildSearch()
      return true
    }
    if (!r.noteCount) { root.flashMessage("No notes on this paper"); return true }
    if (!root.service) return true
    root.service.itemDetails(paper, function(res) {
      if (res.kind !== "ok") return root.flashMessage("Couldn't list its notes: " + (res.message || res.kind))
      const ex = Object.assign({}, root.expandedNotes)
      ex[id] = Views.orderNotes(Views.ownNotes(res.data), root.service.noteOrder[id] || [])
      root.expandedNotes = ex
      root.followTop = false
      if (root.inSearch) root.rebuildSearch()
    })
    return true
  }

  function rebuildSearch() {
    const previousKey = root.selectedIndex >= 0 && root.selectedIndex < displayModel.count ? displayModel.get(root.selectedIndex).key : ""
    let rows = root.setupNeeded && root.atRoot && !root.filterText ? root.setupResultRows()
      : Views.buildRows(root.response, String(root.selectedText), root.atRoot ? root.workspaceExtras()
        : { statuses: root.paperStatusTags, noCommands: true, scopeTitle: root.collectionScope && !root.pickFor ? "“" + root.collectionScope.title + "”" : "", extracting: root.service && !!root.service.extractState.catchup })
    // Statuses changed here win over what the last search said (Zotero may not have them yet).
    rows.forEach(function(r) { const s = root.statusShown[r.libraryID + ":" + r.key]; if (r.kind === "item" && s !== undefined) r.status = s })
    if (root.service) rows = Views.orderSections(rows, root.service.sectionOrder[root.sectionKey()])
    // In a saved search (a badge, or one opened): what you pinned first, under Pinned.
    if (root.response && root.response.scope && root.response.scope.kind === "search") rows = Views.pinnedFirst(rows, root.pinnedSet)
    // The papers grouped or sorted (g), once there are search results: typed, or in a saved search, a collection or a tag
    if (root.groupable) rows = Views.groupRows(rows, root.grouping, { results: root.response.results, statuses: root.paperStatusTags, tasks: root.defaultTasks,
      taskStatuses: root.todoStatuses, groups: Todos.GROUPS, taxonomies: root.taxonomyList })
    rows = Views.withNoteRows(rows, root.expandedNotes)
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
    function onDraftingPromptChanged() { if (root.view === "prompt-title") { root.followTop = false; root.rebuildList() } }
    function onRulesChanged() { if (root.view === "settings" || root.view === "settings-rules") { root.followTop = false; root.rebuildList() } }
    function onInstructionsChanged() { if (root.view === "settings" || root.view === "settings-rules") { root.followTop = false; root.rebuildList() } }
    function onTodosChanged() {
      if (["todos", "todo-edit", "actions", "settings-tasks"].indexOf(root.view) >= 0) { root.followTop = false; root.rebuildList() }
    }
    function onStatusChanged() {
      if (root.inSearch && root.atRoot) {
        root.rebuildSearch()
        if (root.status === "ready" && !root.response) root.requestSearch()
      } else if (root.inSettings) { root.followTop = false; root.rebuildList() }
    }
    function onSetupInfoChanged() { if (root.inSettings) { root.followTop = false; root.rebuildList() } else if (root.setupNeeded && root.inSearch) root.rebuildSearch() }
    function onProvidersInfoChanged() {
      root.autoTestKeys()
      if (root.inSettings || root.view === "actions") { root.followTop = false; root.rebuildList() }
      else if (root.atRoot && !root.filterText) root.rebuildSearch()
    }
    function onProviderTestsChanged() {
      root.afterTest()
      if (root.inSettings) { root.followTop = false; root.rebuildList() }
    }
    function onRequirementsChanged() { if (root.inSettings) { root.followTop = false; root.rebuildList() } }
    function onExtractStateChanged() { if (root.view === "settings-defaults") { root.followTop = false; root.rebuildList() } }
    function onExtractPendingChanged() { if (root.view === "settings-defaults") { root.followTop = false; root.rebuildList() } }
    function onTaxonomiesChanged() {
      root.autoTestKeys()
      if (root.view === "settings" || root.view === "settings-taxonomies" || root.view === "actions") { root.followTop = false; root.rebuildList() }
      else if (root.inSearch && root.groupable && /^tax:/.test(root.grouping)) root.rebuildSearch()
    }
    function onTaxonomyReviewChanged() { if (root.view === "settings-tax-review") { root.followTop = false; root.rebuildList() } }
    function onClassifyingChanged() {
      if (root.view === "tax-paper") { root.followTop = false; root.rebuildList(); return }
      if (root.view !== "actions") return
      root.followTop = false
      root.rebuildList()
      // this paper tagged: what it's up to date with now
      const it = root.actionItem
      if (it && !root.service.classifying[(Number(it.libraryID) || 1) + ":" + it.key]) root.loadTaxStatus(null)
    }
    function onCitationStylesChanged() {
      if (root.view === "settings-styles" || root.view === "settings-general") {
        root.followTop = false
        root.rebuildList()
        if (root.view === "settings-styles") root.selectRow(function(r) { return r.checked })
      }
    }
    function onInstallingChanged() { if (root.inSettings) { root.followTop = false; root.rebuildList() } }
    function onSettingsChanged() { if (root.inSettings && root.view !== "settings-edit") { root.followTop = false; root.rebuildList() } }
    function onTasksChanged() {
      if (root.view === "tasks") { root.followTop = false; root.rebuildList() }
      else if (root.actionItem && (root.view === "actions" || root.view === "notes" || root.view === "extract-menu")) {
        // A process on this paper finished since its details were read (an extraction, a prompt's
        // note): read them again, so its rows say so.
        const key = root.actionItem.key
        const done = (root.service.tasks || []).some(function(t) { return t.key === key && t.status !== "running" && String(t.finished || "") > root.detailsAt })
        if (done) root.refreshDetails()
        root.followTop = false
        root.rebuildList()
      }
      else if (root.atRoot && !root.filterText) root.rebuildSearch()
    }
    function onSyncTaskChanged() {
      if (root.view === "tasks") { root.followTop = false; root.rebuildList() }
      else if (root.atRoot && !root.filterText) root.rebuildSearch()
    }
    function onSyncInfoChanged() { if (root.inSearch && root.filterText) root.rebuildSearch() } // Sync Zotero's line under Go to
    function onSyncFinished(ok, error) {
      if (!root.opened) return
      root.flashMessage(ok ? "Zotero synced" : "Zotero couldn't sync: " + error)
      if (root.inSearch) root.requestSearch() // what the sync brought
      else root.libraryChanged = true
    }
    function onArtifactsChanged() {
      if (root.artifactMenu) {
        const m = root.artifactMenu
        const fresh = (root.service.artifacts || []).find(function(a) { return a.id === m.id && a.key === m.key && a.libraryID === m.libraryID })
        if (fresh) root.artifactMenu = fresh
      }
      if (["actions", "artifact-menu", "artifact-change"].indexOf(root.view) >= 0) { root.followTop = false; root.rebuildList() }
    }
    function onChatsChanged() {
      if (root.view === "chats" || root.view === "actions") { root.followTop = false; root.rebuildList() }
      else if (root.atRoot && !root.filterText) root.rebuildSearch()
    }
    function onSearchesChanged() {
      // Its badge gone (unpinned, deleted): back to All. Edited: search again with the new query.
      if (root.activeSearch && !Views.findSearch(root.pinnedSearches, root.activeSearch)) root.activeSearch = ""
      if (root.view === "searches" || root.view === "search-menu" || root.view === "picker") { root.followTop = false; root.rebuildList() }
      else if (root.inSearch && root.atRoot && root.scopeKey(root.searchScope()) !== root.requestedScope) root.requestSearch()
    }
  }

  ListModel { id: displayModel }

  // ------------------------------------------------------------ views

  function pushView(next) {
    root.viewStack = root.viewStack.concat([{ view: root.view, filterText: root.filterText, caretBack: root.caretBack, selectedIndex: root.selectedIndex, followTop: root.followTop, scope: root.collectionScope, pickFor: root.pickFor, searchFocus: root.searchFocus }])
    root.caretBack = 0
    root.queryLive = false
    root.view = next
    // The list has the keys, but on a page for typing (typingView), or with the search box first
    root.searchFocus = root.searchFirst || root.typingView
    root.keyBuffer = ""
    root.filterText = ""
    root.selectedIndex = 0
    root.followTop = true
    root.lastError = ""
    pointerGate.reset()
  }

  // Back one level, restoring that level's query and cursor.
  function back() {
    if (root.fieldDraft) root.commitField()
    if (!root.viewStack.length) return false
    const saved = root.viewStack[root.viewStack.length - 1]
    root.viewStack = root.viewStack.slice(0, -1)
    const scopeChanged = root.scopeId(saved.scope) !== root.scopeId(root.collectionScope)
    root.collectionScope = saved.scope || null
    root.pickFor = saved.pickFor || ""
    root.view = saved.view
    // Back in the results (the top level) with nothing typed: the list has the keys, not the search box.
    // Back with something typed there: the keys where they were; else the list (a page for typing: the box)
    root.searchFocus = saved.filterText ? (saved.searchFocus !== undefined ? saved.searchFocus : true)
      : root.searchFirst ? (root.atRoot ? false : saved.searchFocus !== undefined ? saved.searchFocus : true)
      : root.typingView
    root.keyBuffer = ""
    root.filterText = saved.filterText
    root.caretBack = saved.caretBack || 0 // where the caret was (the @ picker puts its term there)
    root.queryLive = false
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

  function deadKeyText(k) {
    if (k === Qt.Key_Dead_Diaeresis) return { key: Qt.Key_QuoteDbl, text: '"' }
    if (k === Qt.Key_Dead_Acute) return { key: Qt.Key_Apostrophe, text: "'" }
    if (k === Qt.Key_Dead_Circumflex) return { key: Qt.Key_AsciiCircum, text: "^" }
    if (k === Qt.Key_Dead_Tilde) return { key: Qt.Key_AsciiTilde, text: "~" }
    if (k === Qt.Key_Dead_Grave) return { key: Qt.Key_QuoteLeft, text: "`" }
    return null
  }

  // @ in a new task's line: what it can add, as blocks; each kind once.
  function openTaskTags() {
    root.pushView("todo-tags")
    root.rebuildList()
  }

  // Keybindings (? or F1): the keys for where you are first ("Here"), then every key, by section; typing finds one.
  property var keysHere: null
  function openKeys() {
    if (root.view === "keys") return
    root.keysHere = Object.assign(Views.keysContext(root.view, { scope: !!root.collectionScope, pickFor: root.pickFor, inSettings: root.inSettings, textEntry: root.textEntry }), { alt: !root.singleKeys })
    root.pushView("keys")
    root.rebuildList()
  }

  // Every level back to the results, as that many Esc presses would (without clearing what's typed there).
  function goHome() {
    while (!root.atRoot && root.back()) {}
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
    else if (root.view === "notes") rows = Views.buildNoteRows(root.details, root.filterText, color, Fuzzy.filter, root.noteOrderFor())
    else if (root.view === "chat-menu") rows = root.chatMenuRows()
    else if (root.view === "extract-menu") rows = Views.buildExtractMenu(root.details, !(root.service && root.service.prompts))
    else if (root.view === "artifact-menu") rows = Views.buildArtifactMenu(root.artifactMenu)
    else if (root.view === "artifact-change") rows = Views.buildArtifactChangeRows(root.artifactMenu, root.filterText, !root.needsSetup())
    else if (root.view === "artifact-rename") rows = [Views.listRow({ rowId: "art-rename-save", icon: "\uf044", label: root.filterText.trim() ? "Rename to “" + root.filterText.trim() + "”" : "Type the new name", available: !!root.filterText.trim(), value: root.filterText.trim() })]
    else if (root.view === "prompt-output") rows = Views.buildPromptOutputs(root.promptEdit)
    else if (root.view === "todos") rows = Todos.buildTodoRows(root.service ? root.service.todos : [], root.todoStatuses, root.filterText, color, Fuzzy.filter, Views.listRow, new Date(), Views.highlight, Views.rangesFrom)
    else if (root.view === "todo-edit") rows = Todos.buildTodoEditor(root.currentTodo(), root.todoStatuses, Views.listRow, new Date())
    else if (root.view === "todo-status") rows = Todos.buildStatusChoice(root.currentTodo(), root.todoStatuses, Views.listRow)
    else if (root.view === "todo-priority") rows = Todos.buildPriorityChoice(root.currentTodo(), Views.listRow)
    else if (root.view === "todo-new" || root.view === "todo-text" || root.view === "status-name") rows = root.entryRows()
    else if (root.view === "todo-due") rows = [] // the calendar is drawn on its own
    else if (root.view === "keys") rows = Views.buildKeyRows(root.filterText, root.keysHere)
    else if (root.view === "tax-paper") rows = Views.filterRows(Views.buildPaperTaxonomies(root.details, root.taxonomyList, !!(root.taxStatus && root.taxStatus.classified)), root.filterText)
    else if (root.view === "tax-audit") rows = Views.filterRows(Views.buildTaxonomyAudit(root.taxAudit, root.details ? root.details.tags : []), root.filterText)
    else if (root.view === "confirm") rows = root.confirmRows()
    else if (root.view === "tag-menu") rows = root.tagMenuRows()
    else if (root.view === "tag-status") rows = Views.buildTagStatusRows(root.tagStatusKind, root.tagMenuName, root.paperStatuses, root.todoStatuses)
    else if (root.view === "tag-name") rows = [Views.listRow({ rowId: "tag-name-save", icon: "\uf412", label: root.filterText.trim() ? "Rename “" + root.tagMenuName + "” to “" + root.filterText.trim() + "”" : "Type the new name",
      detail: "On every paper that has it", available: !!root.filterText.trim() && root.filterText.trim() !== root.tagMenuName, value: root.filterText.trim() })]
    else if (root.view === "todo-tags") {
      const line = root.viewStack.length ? root.viewStack[root.viewStack.length - 1].filterText : ""
      rows = Todos.buildTaskTagRows(line, root.todoDraft, root.todoStatuses, root.filterText, Views.listRow, new Date(), root.service ? root.service.taskActions : null)
    }
    else if (root.view === "status-menu") rows = root.statusMenuRows()
    else if (root.view === "chat-rename") rows = [Views.listRow({ rowId: "chat-rename-save", icon: Views.ICONS ? "\uf448" : "", label: root.filterText.trim() ? "Rename to “" + root.filterText.trim() + "”" : "Type the new name", available: !!root.filterText.trim(), value: root.filterText.trim() })]
    else if (root.view === "tags") rows = root.tagState ? Views.buildTagRows(root.tagState, root.filterText, color, Fuzzy.filter) : []
    else if (root.view === "prompts") rows = Views.buildPromptRows(root.service ? root.service.prompts : [], root.service ? root.service.models : null, root.filterText, color, Fuzzy.filter, root.service ? root.service.modelDefaults.prompts : "")
    else if (root.view === "prompt-edit") rows = Views.buildPromptEditor(root.promptEdit, root.service ? root.service.models : null, "", root.service ? root.service.modelDefaults.prompts : "")
    else if (root.view === "prompt-model") rows = Views.filterRows(Views.buildPromptModels(root.promptEdit, root.service ? root.service.models : null, root.service ? root.service.modelDefaults.prompts : ""), root.filterText)
    else if (root.view === "prompt-effort") rows = Views.buildPromptEfforts(root.promptEdit, root.service ? root.service.models : null, root.service ? root.service.modelDefaults.prompts : "")
    else if (root.inSettings) rows = root.settingsRows()
    else if (root.view === "prompt-title") rows = Views.buildTitleRows(root.filterText, root.promptTitleMode, { ready: !root.needsSetup(), busy: !!(root.service && root.service.draftingPrompt) })
    else if (root.view === "tasks") rows = Views.buildTaskRows(root.service ? root.service.processes : [], root.filterText, color, Fuzzy.filter)
    else if (root.view === "chats") rows = Views.buildChatRows(root.service ? root.service.chats : [], root.filterText, color, Fuzzy.filter)
    else if (root.view === "searches") rows = Views.buildSearchRows(root.service ? root.service.searches : [], root.filterText, color, Fuzzy.filter)
    else if (root.view === "search-menu") rows = Views.searchMenuRows(root.searchMenu)
    else if (root.view === "search-edit") rows = Views.buildSearchEditRows(root.searchEditMode, root.filterText, root.searchToSave)
    else if (root.view === "picker") rows = Views.buildPickerRows(root.filterText, !!(root.service && root.service.searches.length), root.taxonomyList)
    else if (root.view === "picker-values" && Views.DATE_FIELDS[root.pickerField]) rows = Views.buildDateValueRows(root.pickerField, new Date().getFullYear(), root.filterText)
    else if (root.view === "picker-values") rows = root.pickerField === "search" || /^tax:/.test(root.pickerField) ? Views.buildPickerValueRows(root.pickerValues(), root.filterText, color, Fuzzy.filter)
      : Views.buildPickerValueRows(root.pickerValues(), "", color, null) // ranked by the bridge
    else {
      const act = Views.buildActions(root.details, root.service ? root.service.pdfViewerLabel : "",
        root.service ? root.service.prompts : null, root.service ? root.service.promptsProblem : "",
        root.service ? Views.isPinned(root.service.pins, root.actionItem) : false, root.needsSetup(), root.actionExtras())
      // The paper's tasks, after its notes and chats.
      if (root.actionItem && root.details && root.details.item && root.details.item.itemType !== "note" && root.details.item.itemType !== "attachment") {
        let at = act.findIndex(function(r) { return r.section === "Prompts and chat" || r.section === "This paper" }) // after its taxonomies, notes, chats, artifacts
        if (at < 0) at = act.length
        Array.prototype.splice.apply(act, [at, 0].concat(Todos.itemTodoRows(root.service ? root.service.todos : [], root.actionItem, root.todoStatuses, Views.listRow, new Date())))
      }
      // your order within each section (Shift+↑/↓), then the rows you pinned (p) in Pinned, on top
      const ordered = root.service ? Views.orderRows(act, root.service.menuOrder[root.view]) : act
      root.menuRows = ordered
      rows = Views.filterRows(root.service ? Views.otherRows(Views.pinRows(ordered, root.service.menuPins[root.view]), root.service.menuOther[root.view]) : ordered, root.filterText)
    }
    if (root.service) rows = Views.orderSections(rows, root.service.sectionOrder[root.sectionKey()])
    const keep = root.selectedIndex
    const scrolled = actionList.contentY // refilling the model scrolls to the top: put it back after
    actionModel.clear()
    for (let i = 0; i < rows.length; i++) actionModel.append(rows[i])
    root.selectedIndex = root.followTop ? root.firstRowFor(rows) : Math.max(0, Math.min(actionModel.count - 1, keep))
    // a list starting from its top shows its first heading too (not the last view's scroll)
    if (root.followTop && root.selectedIndex === 0) actionList.positionViewAtBeginning()
    else if (!root.followTop) {
      // the same rows, refreshed (a toggle, a process finishing): stay where you were, the cursor in view
      actionList.forceLayout()
      actionList.contentY = Math.max(actionList.originY, Math.min(scrolled, actionList.originY + Math.max(0, actionList.contentHeight - actionList.height)))
      if (actionModel.count) actionList.positionViewAtIndex(root.selectedIndex, ListView.Contain)
    }
  }

  // Where the cursor starts in a list: the top, except in Processes, where "Clear finished processes"
  // heads the list and the cursor starts on the first task.
  function firstRowFor(rows) {
    if (rows.length > 1 && rows[0].rowId === "todo-quick" && rows[1].rowId === "todo") return 1 // searching your tasks: the first match
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
    if (row.kind === "note-child") {
      if (!quick) root.openNoteView({ key: row.key, libraryID: row.libraryID, title: row.title })
      return
    }
    if (row.kind === "keys") {
      if (!quick) root.openKeys()
      return
    }
    if (row.kind === "collection" || row.kind === "tag") {
      if (!quick) root.openCollection(row) // the Alt keys are for papers
      return
    }
    if (row.kind === "tasks" || row.kind === "chats") {
      if (!quick) row.kind === "tasks" ? root.openTasks() : root.openChats()
      return
    }
    if (row.kind === "searches") {
      if (!quick) root.openSearches()
      return
    }
    if (row.kind === "sync") {
      if (!quick) root.syncZotero()
      return
    }
    if (row.kind === "extract-all") {
      if (!quick) root.extractAllHere()
      return
    }
    if (row.kind === "classify-all") {
      if (!quick) root.classifyAllHere()
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
    if (row.kind === "setting") {
      if (!quick) root.openSettingAt(row.key)
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
    if (root.pickFor === "todo") {
      if (!quick && row.kind === "item") root.pickTodoItem(row)
      return
    }
    if (row.kind === "todos") {
      if (!quick) root.openTodos()
      return
    }
    if (row.kind === "todo-new") {
      if (!quick) root.startNewTodo({})
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

  // The paper's taxonomies it isn't up to date with ({ classified, stale: [ids] }; null while asked, or
  // without the runner): its menu's Taxonomies say so, and Tag a paper when you open it tags it by those.
  property var taxStatus: null
  property int taxStatusSerial: 0
  function loadTaxStatus(then) {
    const it = root.actionItem
    const serial = ++root.taxStatusSerial
    if (!root.service || !it || !root.taxonomyList.length) { root.taxStatus = null; if (then) then(null); return }
    root.service.taxonomyStatus([it], function(items) {
      if (serial !== root.taxStatusSerial || root.actionItem !== it) return
      root.taxStatus = items && items[0] ? items[0] : null
      if (root.view === "actions") { root.followTop = false; root.rebuildList() }
      if (then) then(root.taxStatus)
    })
  }

  // The paper's menu has its details: its text extracted and it tagged, as Settings says (Service.paperOpened).
  function paperOpened() {
    const it = root.actionItem
    const d = root.details
    if (!root.service || !it || !d || !d.item || d.item.itemType === "note" || d.item.itemType === "attachment") return
    root.loadTaxStatus(function(st) {
      if (root.actionItem !== it) return
      const started = root.service.paperOpened(it, d, st ? st.stale : null)
      if (started.extract || started.tag) root.flashMessage(started.extract && started.tag ? "Extracting its text, then tagging it by taxonomies" : started.extract ? "Extracting its text" : "Tagging it by taxonomies")
    })
  }

  // The paper's menu (its actions), for an item from the results, a window, or a task.
  function enterActionsFor(item, quick, select) {
    root.actionItem = item
    root.pendingSelect = select || null
    root.taxStatus = null
    root.details = null
    root.quickAction = quick || ""
    root.lastError = ""
    root.pushView("actions")
    root.rebuildList()
    const serial = ++root.detailsSerial
    if (!root.service) return
    root.service.refreshPrompts()
    root.service.refreshModels()
    root.service.refreshChats()
    root.service.itemDetails(root.actionItem, function(res) {
      if (serial !== root.detailsSerial || !root.opened || root.inSearch) return
      if (res.kind === "ok") {
        root.details = res.data
        root.detailsAt = new Date().toISOString()
        root.loadCitePreview()
        root.paperOpened()
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
      case "classify": {
        const it = root.actionItemRef()
        if (!it) break
        root.service.classify([it], function(results) {
          const r = results[0] || {}
          root.flashMessage(r.status !== "tagged" ? "Not tagged: " + (r.reason || r.status || "failed")
            : "Tagged by taxonomies" + (r.add && r.add.length ? ": " + r.add.join(", ") : " (nothing new)") + (r.suggested ? " · " + r.suggested + " to review in Settings › Taxonomies" : ""))
          if (root.actionItem && root.actionItem.key === it.key) root.refreshDetails()
          if (root.view === "tax-audit") root.loadTaxonomyAudit()
        })
        root.flashMessage("Tagging it by taxonomies: it's in Processes (" + root.keyName(".") + ")")
        break
      }
      case "extract":
        if (row.value === "read") { root.readExtracted(); break }
        if (root.service && root.actionItem) {
          root.service.extractText(root.actionItem, false)
          root.flashMessage("Extracting the text: it's in Processes (" + root.keyName(".") + ")")
        }
        break
      case "ext-read":
        root.readExtracted()
        break
      case "ext-again":
        if (root.service && root.actionItem) {
          root.service.extractText(root.actionItem, true)
          root.back()
          root.flashMessage("Extracting the text again (it replaces this one): it's in Processes (" + root.keyName(".") + ")")
        }
        break
      case "ext-zotero":
        root.noteTarget = { key: row.noteKey, libraryID: row.noteLibraryID, title: "Extracted text" }
        root.finish("note-open", null)
        break
      case "ext-delete": {
        const note = { key: row.noteKey, libraryID: row.noteLibraryID }
        root.back()
        root.askConfirm({ title: "Delete the extracted text?", yes: "Delete it (to Zotero's trash)", no: "Keep it",
          detail: "A prompt or chat on this paper extracts it again when it needs it", run: function() {
            root.service.trashNote(note, function(res) {
              root.flashMessage(res.kind === "ok" ? "The extracted text is in Zotero's trash" : "Couldn't delete it: " + (res.message || res.kind))
              root.refreshDetails()
            })
          } })
        break
      }
      case "task":
        if (row.noteKey) root.openNoteView({ key: row.noteKey, libraryID: row.noteLibraryID, title: row.label })
        else if (row.path) root.openArtifactPath(row.path)
        else if (row.session) root.openChatWindow({ key: row.itemKey, libraryID: row.itemLibraryID, title: row.itemTitle }, row.session)
        else if (row.promptId) {
          const p = (root.service.prompts || []).find(function(x) { return x.id === row.promptId })
          if (p) root.openPromptEditor(p)
          else root.flashMessage("That prompt isn't there any more")
        }
        break
      case "artifact":
      case "art-open":
        root.openArtifactPath(row.path)
        break
      case "art-change":
        root.pushView("artifact-change")
        root.rebuildList()
        break
      case "art-change-go": {
        const a = root.artifactMenu
        root.service.changeArtifact(a, row.value)
        root.back()
        root.back()
        root.flashMessage("Changing “" + a.title + "”: it's in Processes (" + root.keyName(".") + "); the new version shows here when it's done")
        break
      }
      case "art-brief":
      case "art-source":
        root.dismiss()
        root.service.editPath(row.path)
        break
      case "art-folder":
        root.dismiss()
        root.service.openPath(row.path)
        break
      case "art-undo":
        root.service.artifactJob("undo", root.artifactMenu, "", function(ok, data, error) {
          root.flashMessage(ok ? "Back to version " + data.current + " (the later ones are kept)" : "Couldn't undo it: " + error)
        })
        break
      case "art-rename":
        root.pushView("artifact-rename")
        root.filterText = root.artifactMenu.title
        root.rebuildList()
        break
      case "art-rename-save": {
        root.service.artifactJob("rename", root.artifactMenu, row.value, function(ok, data, error) { root.flashMessage(ok ? "Renamed" : "Couldn't rename it: " + error) })
        root.back()
        root.back()
        break
      }
      case "art-delete": {
        const title = root.artifactMenu.title
        root.service.artifactJob("delete", root.artifactMenu, "", function(ok, data, error) { root.flashMessage(ok ? "Deleted “" + title + "”" : "Couldn't delete it: " + error) })
        root.artifactMenu = null
        root.back()
        break
      }
      case "tasks-clear":
        if (root.service) root.service.refreshTasks(true)
        break
      case "chat-new":
        root.pickPaperForChat()
        break
      case "paper-status":
        root.cyclePaperStatus(1)
        break
      case "default-task":
        root.cycleDefaultTask(1)
        break
      case "task-default":
        root.settingsEdit = { path: "tasks.defaultTask", label: "Default task's description", type: "text", help: "{cite}: the paper's citation, {title}: its title; empty: " + Todos.DEFAULT_TASK_TEMPLATE,
          current: row.value, item: { label: "Default task's description", type: "template" }, empty: "back to " + Todos.DEFAULT_TASK_TEMPLATE }
        root.pushView("settings-edit")
        root.filterText = row.value
        root.rebuildList()
        break
      case "todo":
        root.openTodo(row.value)
        break
      case "todo-new":
        root.startNewTodo(root.view === "actions" ? { item: root.actionItemRef() } : {})
        break
      case "todo-new-save":
        root.saveNewTodo(row.value, true)
        break
      case "todo-quick":
        root.addQuickHere(row.value, true)
        break
      case "todo-save":
        root.back()
        break
      case "todo-edit":
        root.openTodoText(row.value)
        break
      case "todo-text-save":
        root.saveTodoText(row.value)
        break
      case "todo-status":
      case "todo-priority":
      case "todo-desc":
        root.back() // a task's page: Enter keeps it (every change is saved) and goes back
        break
      case "todo-notes":
        break // its text box has the keys (Enter is a new line)
      case "todo-due":
        root.openDuePicker()
        break
      case "todo-status-opt":
        root.setTodo({ status: row.value })
        root.back()
        root.selectRow(function(r) { return r.rowId === "todo-status" })
        break
      case "todo-priority-opt":
        root.setTodo({ priority: row.tag })
        root.back()
        root.selectRow(function(r) { return r.rowId === "todo-priority" })
        break
      case "todo-item": {
        const t = root.currentTodo()
        if (t && t.item) root.enterActionsFor({ key: t.item.key, libraryID: t.item.libraryID, title: t.item.title, itemType: "" }, "")
        break
      }
      case "todo-context": {
        const t = root.currentTodo()
        if (!t || !t.context) break
        if (t.context.kind === "chat" && t.item) root.openChatWindow({ key: t.item.key, libraryID: t.item.libraryID, title: t.item.title }, t.context.id || "")
        else root.openNoteView({ key: t.context.key, libraryID: t.context.libraryID, title: t.context.title })
        break
      }
      case "todo-pick":
        root.pushView("search")
        root.pickFor = "todo"
        root.response = null
        root.rebuildSearch()
        root.requestSearch()
        break
      case "todo-unlink":
        root.setTodo({ item: null, context: null })
        root.flashMessage("The task isn't about a paper any more")
        break
      case "todo-delete": {
        const id = root.todoId
        root.service.saveTodos(Todos.removeTodo(root.service.todos, id))
        root.back()
        root.flashMessage("Task deleted")
        break
      }
      case "pstatus":
        root.statusEdit = { kind: "paper", id: row.value, name: row.label }
        root.pushView("status-menu")
        root.rebuildList()
        break
      case "pstatus-add":
        root.statusEdit = { kind: "paper", mode: "add" }
        root.pushView("status-name")
        root.rebuildList()
        break
      case "status":
        root.statusEdit = { id: row.value, name: row.label }
        root.pushView("status-menu")
        root.rebuildList()
        break
      case "task-action":
        root.statusEdit = { kind: "action", id: row.value, name: row.label }
        root.pushView("status-menu")
        root.rebuildList()
        break
      case "task-action-add":
        root.statusEdit = { kind: "action", mode: "add" }
        root.pushView("status-name")
        root.rebuildList()
        break
      case "status-add":
        root.statusEdit = { mode: "add", group: row.value }
        root.pushView("status-name")
        root.rebuildList()
        break
      case "status-rename":
        root.statusEdit = Object.assign({}, root.statusEdit, { mode: "rename" })
        root.pushView("status-name")
        root.filterText = root.statusEdit.name
        root.rebuildList()
        break
      case "status-name-save":
        root.saveStatusName(row.value)
        break
      case "status-remove": {
        if (root.statusEdit.kind === "action") {
          const name = root.statusEdit.id
          const err = root.service.saveTaskActions(root.service.taskActions.filter(function(a) { return a !== name }))
          root.back()
          root.flashMessage(err ? "Not saved: " + err : "Removed the action “" + name + "”")
          break
        }
        if (root.statusEdit.kind === "paper") {
          // removing it deletes its tag from every paper: asked first (Zotero's Undo can't bring it back)
          const name = root.statusEdit.id
          const tag = Client.statusTag(name)
          root.back()
          root.askConfirm({ title: "Remove the status “" + name + "”?", yes: "Remove it, and delete " + tag + " from every paper", no: "Cancel (keep both)",
            detail: "Counting the papers…", run: function() {
              const err = root.savePaperStatuses(root.paperStatuses.filter(function(t) { return t !== name }))
              if (err) return root.flashMessage("Not saved: " + err)
              root.service.forgetStatusTag(tag)
              root.deleteTagEverywhere(tag, function() { root.requestSearch() })
            } })
          root.countIntoConfirm([tag], function(n) { return "On " + n + (n === 1 ? " paper" : " papers") })
          break
        }
        const r = Todos.removeStatus(root.todoStatuses, root.statusEdit.id)
        if (r.error) { root.flashMessage(r.error); break }
        const err = root.service.saveStatuses(r.statuses, root.statusEdit.id, r.moveTo)
        root.back()
        root.flashMessage(err ? "Not saved: " + err : "Removed; its tasks are now " + Todos.statusById(r.statuses, r.moveTo).name)
        break
      }
      case "chat-session":
        root.openChatWindow(root.actionItem, row.value)
        break
      case "chat-menu-open":
        root.openChatWindow(root.actionItem, root.chatMenu.id)
        break
      case "chat-menu-rename":
        root.pushView("chat-rename")
        root.filterText = root.chatMenu.title
        root.rebuildList()
        break
      case "chat-rename-save": {
        const id = root.chatMenu.id
        root.service.renameChat(root.actionItem, id, row.value, function(ok, data, error) { root.flashMessage(ok ? "Renamed" : "Couldn't rename it: " + error) })
        root.back()
        root.back()
        break
      }
      case "chat-menu-delete": {
        const id = root.chatMenu.id
        root.service.deleteChat(root.actionItem, id, function(ok, data, error) { root.flashMessage(ok ? "Chat deleted" : "Couldn't delete it: " + error) })
        root.back()
        break
      }
      case "chat-open":
        root.openChatWindow({ key: row.itemKey, libraryID: row.itemLibraryID, title: row.itemTitle }, row.value)
        break
      case "search":
        root.openSavedSearch(Views.findSearch(root.service.searches, row.value))
        break
      case "search-open":
        root.openSavedSearch(Views.findSearch(root.service.searches, root.searchMenu.id))
        break
      case "search-pin":
        root.toggleSearchPin(root.searchMenu.id)
        root.searchMenu = Views.findSearch(root.service.searches, root.searchMenu.id)
        root.followTop = false
        root.rebuildList()
        break
      case "search-rename":
      case "search-query":
        root.searchEditMode = row.rowId === "search-rename" ? "rename" : "query"
        root.searchToSave = root.searchMenu.query
        root.pushView("search-edit")
        root.filterText = row.rowId === "search-rename" ? root.searchMenu.name : root.searchMenu.query
        root.rebuildList()
        break
      case "search-delete": {
        const s = root.searchMenu
        root.service.saveSearches(Views.removeSearch(root.service.searches, s.id))
        root.flashMessage("Deleted “" + s.name + "”")
        root.back()
        break
      }
      case "search-save":
      case "search-save-pin": {
        const added = Views.addSearch(root.service.searches, row.value, root.searchToSave, row.rowId === "search-save-pin")
        root.service.saveSearches(added.list)
        root.back()
        if (row.rowId === "search-save-pin" && root.atRoot) {
          root.filterText = "" // its badge now holds what was typed
          root.selectSearch(added.search.id)
        }
        root.flashMessage(row.rowId === "search-save-pin" ? "Saved and pinned: Tab switches to it" : "Saved: " + root.keyName("f") + " lists your searches")
        break
      }
      case "search-rename-save":
      case "search-query-save": {
        const change = row.rowId === "search-rename-save" ? { name: row.value } : { query: row.value }
        root.service.saveSearches(Views.updateSearch(root.service.searches, root.searchMenu.id, change))
        root.flashMessage(row.rowId === "search-rename-save" ? "Renamed" : "Search saved")
        root.back()
        root.searchMenu = Views.findSearch(root.service.searches, root.searchMenu.id)
        root.rebuildList()
        break
      }
      case "pick-field":
        root.openPickerValues(row.value)
        break
      case "confirm-yes": {
        const a = root.confirmAsk
        root.confirmAsk = null
        root.back()
        if (a && a.run) a.run()
        break
      }
      case "confirm-no": {
        const a = root.confirmAsk
        root.confirmAsk = null
        root.back()
        if (a && a.cancel) a.cancel()
        break
      }
      case "tags-status":
        root.openSettings(row.value)
        break
      case "tag-to-paper":
      case "tag-to-task":
        root.tagStatusKind = row.rowId === "tag-to-paper" ? "paper" : "task"
        root.pushView("tag-status")
        root.rebuildList()
        root.selectRow(function(r) { return r.available }) // a status by that name already: its merge row
        break
      case "tag-status-opt":
        root.convertTag(root.tagStatusKind, root.tagMenuName, row.value)
        break
      case "tag-rename":
        root.pushView("tag-name")
        root.filterText = root.tagMenuName
        root.rebuildList()
        break
      case "tag-name-save": {
        const from = root.tagMenuName, to = row.value
        root.back()
        root.back()
        root.renameTagEverywhere(from, to, function() { root.reloadTagEditor(from, to) })
        break
      }
      case "tag-delete": {
        const name = root.tagMenuName
        root.back()
        root.askConfirm({ title: "Delete the tag “" + name + "”?", yes: "Delete it from every paper", no: "Keep it", detail: "Counting the papers…",
          run: function() { root.deleteTagEverywhere(name, function() { root.reloadTagEditor(name, "") }) } })
        root.countIntoConfirm([name], function(n) { return "On " + n + (n === 1 ? " paper" : " papers") + "; Zotero's Undo doesn't bring it back" })
        break
      }
      case "pstatus-migrate": {
        const names = root.paperStatuses.slice()
        root.askConfirm({ title: "Move the status tags to " + Client.PAPER_TAG_PREFIX + "…?", yes: "Rename them in Zotero", no: "Not now",
          detail: "Counting the papers…", run: function() {
            names.forEach(function(n) { root.renameTagEverywhere(n, Client.statusTag(n), function() { root.requestSearch() }) })
          } })
        root.countIntoConfirm(names, function(n) { return names.map(function(x) { return x + " → " + Client.statusTag(x) }).join(", ") + " · " + n + (n === 1 ? " paper" : " papers") })
        break
      }
      case "pick-op":
      case "task-tag":
        root.addToSearch(row.value, root.view === "picker-values" ? 2 : 1) // a date field's After/Before/Between: from its values
        break
      case "pick-value":
        root.addToSearch(row.value, 2)
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
          if (row.value === "rules") root.service.refreshRules()
          if (row.value === "taxonomies") root.service.refreshTaxonomies()
          root.rebuildList()
        }
        break
      case "set-toggle":
        root.toggleSetting(row.value)
        break
      case "set-extract-all":
        if (root.service.extractState.catchup) {
          root.service.stopExtractAll()
          root.flashMessage("Stopped: the papers done keep their text; Enter here goes on")
        } else {
          root.service.startExtractAll(null, "")
          root.flashMessage("Extracting every paper's text, a few at a time: it's in Processes (" + root.keyName(".") + ")")
        }
        root.followTop = false
        root.rebuildList()
        break
      case "set-extract-retry":
        root.service.retrySkipped()
        root.flashMessage("The skipped papers will be tried again")
        root.followTop = false
        root.rebuildList()
        break
      case "set-rule": {
        const rule = (root.service.rules || []).find(function(r) { return r.id === row.value })
        if (!rule) break
        const err = root.service.saveSettings(Settings.withRuleToggled(root.service.settings, rule))
        if (err) root.flashMessage("Not saved: " + err)
        root.followTop = false
        root.rebuildList()
        break
      }
      case "set-rules-reset": {
        const err = root.service.saveSettings(Settings.withValue(root.service.settings, "rules", {}))
        root.flashMessage(err ? "Not saved: " + err : "The rules are back to their defaults")
        root.followTop = false
        root.rebuildList()
        break
      }
      case "set-system-edit":
        root.dismiss()
        root.service.editInstructions()
        break
      case "set-system-reset":
        root.service.clearInstructions(function(ok, error) {
          root.flashMessage(ok ? "Your own instructions are cleared: the rules stay" : "Couldn't clear them: " + error)
        })
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
          if (ok && id === "jev") root.service.refreshTaxonomies()
          if (ok) root.service.testProvider(id) // tested at once: Settings says whether it works
        })
        break
      }
      case "set-key-remove": {
        const id = row.value
        root.service.removeKey(id, function(ok, error) {
          root.flashMessage(ok ? "Key removed from the keyring" : "Couldn't remove the key: " + error)
          if (id === "jev") root.service.refreshTaxonomies()
        })
        break
      }
      case "tax-open":
        root.openTaxonomy(row.value)
        break
      case "tax-on":
        root.service.removeTaxonomy(row.value, true, function(ok, data, error) { root.flashMessage(ok ? row.label + " is back on" : "Not turned on: " + error) })
        break
      case "tax-new":
        root.newTaxonomy()
        break
      case "tax-show": {
        const t = root.taxEdit
        if (!t) break
        root.saveTaxonomyChange({ field: "show", value: t.show === false }, t.show === false ? "Shown under a paper's status line" : "Hidden on papers (still tagged)")
        break
      }
      case "tax-kind": {
        const t = root.taxEdit
        if (!t) break
        root.saveTaxonomyChange({ field: "kind", value: t.kind === "one" ? "several" : "one" }, t.kind === "one" ? "Several labels per paper now" : "Unique now: one label per paper (a paper with several keeps them until it's tagged again)")
        break
      }
      case "tax-label":
        root.taxLabel = Number(row.value)
        root.pushView("settings-tax-label")
        root.rebuildList()
        break
      case "tax-label-add":
        root.addTaxonomyLabel()
        break
      case "tax-paper":
        root.pushView("tax-paper")
        root.rebuildList()
        break
      case "tax-label-papers":
        root.openTaggedPapers(row.tag)
        break
      case "classify-audit":
        root.openTaxonomyAudit()
        break
      case "tax-audit":
        // auto → on, by you → off, by you → auto
        root.decideAudit(row, row.decision === "confirmed" ? false : row.decision === "dismissed" ? "auto" : true)
        break
      case "tax-ai-new":
        root.openTaxonomyDraft("")
        break
      case "tax-ai-edit":
        root.openTaxonomyDraft(root.taxEditId)
        break
      case "tax-ai-accept":
        root.acceptTaxonomyDraft()
        break
      case "tax-ai-discard":
        root.back()
        root.flashMessage("Discarded: nothing saved")
        break
      case "tax-label-delete":
        root.deleteTaxonomyLabel()
        break
      case "tax-editor":
        root.service.editTaxonomy(row.value)
        root.flashMessage("Opened in your editor: Settings › Taxonomies shows the changes once you save the file")
        break
      case "tax-reset":
        root.askConfirm({ title: "Back to the bundled “" + root.taxEdit.name + "”?", yes: "Drop my changes", no: "Keep them", detail: "Papers tagged with your version are then out of date with it",
          run: function() { root.removeTaxonomyHere(true, "Back to the bundled one") } })
        break
      case "tax-off":
        root.removeTaxonomyHere(false, "Turned off: Settings › Taxonomies turns it back on")
        break
      case "tax-delete":
        root.askConfirm({ title: "Delete the taxonomy “" + root.taxEdit.name + "”?", yes: "Delete it", no: "Keep it", detail: "Its file goes; the tags it put on papers stay",
          run: function() { root.removeTaxonomyHere(false, "Deleted") } })
        break
      case "tax-review":
        root.pushView("settings-tax-review")
        root.rebuildList()
        root.service.refreshTaxonomyReview()
        break
      case "tax-suggestion":
        root.decideSuggestion(row, true)
        break
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
      case "pe-title-ai":
        root.draftPrompt(row.value)
        break
      case "pe-model":
      case "pe-effort":
      case "pe-output":
        root.pushView(row.rowId === "pe-model" ? "prompt-model" : row.rowId === "pe-effort" ? "prompt-effort" : "prompt-output")
        root.rebuildList()
        root.selectRow(function(r) { return r.checked })
        break
      case "pe-brief": {
        const on = root.promptEdit.brief === false
        root.promptEdit = Object.assign({}, root.promptEdit, { brief: on })
        root.followTop = false
        root.rebuildList()
        root.service.setPrompt(root.promptEdit.id, { brief: on ? "on" : "off" }, function(ok, data, error) {
          if (!ok) root.flashMessage("Couldn't save the prompt: " + error)
        })
        root.flashMessage(on ? "Plans it first: a brief, then the final version" : "Draws it in one go")
        break
      }
      case "pe-output-opt":
        root.choosePrompt({ output: row.value }, "pe-output")
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
      case "cite-copy":
        root.copyCite(row.value)
        break
      case "set-styles":
        root.pushView("settings-styles")
        root.service.refreshStyles()
        root.rebuildList()
        root.selectRow(function(r) { return r.checked })
        break
      case "set-style-opt":
        if (root.saveSetting("general.citationStyle", row.value === Client.DEFAULT_CITATION_STYLE ? undefined : row.value, "Citations in " + row.label)) {
          root.back()
          root.selectRow(function(r) { return r.rowId === "set-styles" })
        }
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
    if (ch === "W") { root.toggleWindowed(); return true } // the launcher as a window, and back
    if (ch === " " && root.inSearch && root.toggleNotes()) return true // a paper's notes, under it
    if (ch === "?") { if (root.view !== "keys") root.openKeys(); return true }
    if (ch === ".") { if (root.view !== "tasks") root.openTasks(); return true } // Processes (the task queue)
    if (ch === "t") { if (root.view !== "todos") root.openTodos(); return true } // Tasks (to-dos)
    if (ch === "a") return root.addTodoKey()
    if (ch === "!" && root.tabTodoId()) { root.todoKey("priority"); return true }
    if (ch === "d" && root.tabTodoId()) { root.todoKey("done"); return true }
    if (ch === "u" && root.lastDeletedTodo && (root.view === "todos" || root.view === "actions")) { root.todoKey("undo"); return true }
    if (ch === ";") { if (!root.inSettings) root.openSettings(""); return true }
    if (ch === "f") { if (root.view !== "searches") root.openSearches(); return true } // saved searches
    if (ch === "S") { root.syncZotero(); return true } // Zotero's own sync
    if ((ch === "g" || ch === "G") && root.inSearch && !root.pickFor) { root.cycleGrouping(ch === "g" ? 1 : -1); return true } // group or sort the papers
    if (ch === "@") { if (!root.inSearch) return false; root.openPicker(); return true }
    if (ch === "p" && root.view === "searches") { root.toggleSelectedSearchPin(); return true }
    if (ch === "z") { root.openInZotero(); return true }
    if (ch === "x") return root.extractKey()
    if ((ch === "i" || ch === "r") && (!root.inSearch || root.accel) && root.citeTarget()) { root.copyCite(ch === "i" ? "citation" : "bibliography"); return true }
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
      if (ch === "s" && !root.pickFor) { root.saveSearchPrompt(); return true }
      if (!root.accel) return false
      if (paper) { root.enterActions(root.selectedIndex, paper); return true }
      if (ch === "l") { root.revealSelected(); return true }
      if (ch === "p") { root.togglePinSelected(); return true }
      return false
    }
    if (!root.actionItem || ["prompt-edit", "prompt-title", "prompt-model", "prompt-effort", "prompt-output", "artifact-menu", "artifact-change", "artifact-rename"].indexOf(root.view) >= 0 || root.inSettings) return false
    if (ch === "p" && root.menuPinViews.indexOf(root.view) >= 0) { root.toggleMenuPin(); return true } // the highlighted row, into Pinned
    if (ch === "P" && root.menuPinViews.indexOf(root.view) >= 0) { root.toggleMenuOther(); return true } // …or out of the way, into Other
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
      // extracted already: its menu (read it, extract it again…); else extract it
      for (let i = 0; i < actionModel.count; i++) if (actionModel.get(i).rowId === "extract") {
        root.selectedIndex = i
        if (actionModel.get(i).noteKey) root.openExtractMenu()
        else root.activateAction(i)
        return true
      }
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
    if (root.queryTyped) root.editSearch({ insert: text })
    else root.setFilter(root.filterText + text)
  }

  // A search edited at its caret (Views.editQuery: ( " closing themselves, blocks as one).
  function editSearch(op) {
    const r = Views.editQuery(root.filterText, root.caret, op, true, root.queryLive)
    if (r.text !== root.filterText) return root.setFilter(r.text, r.caret, r.live)
    blink.on = true // the caret moved: show it
    root.caretBack = r.text.length - r.caret
    root.queryLive = r.live
  }

  // The keys that edit a search where its caret is (the search box has the keys). → handled?
  // Backspace, Ctrl+Backspace (a word), Delete, Ctrl+U (all), ← → Home End, and typing. With nothing
  // typed, Backspace and ← still go back a level; with the caret at the end, → still opens the menu.
  function editSearchKey(event, ctrl, alt) {
    const k = event.key
    const has = root.filterText !== ""
    if (alt || (event.modifiers & Qt.MetaModifier)) return false
    if (k === Qt.Key_Backspace && has) { root.editSearch(ctrl ? "word" : "backspace"); return true }
    if (k === Qt.Key_Delete && has) { root.editSearch("delete"); return true }
    if (ctrl && k === Qt.Key_U && event.modifiers === Qt.ControlModifier && has) { root.editSearch("clear"); return true }
    if (ctrl) return false
    if (k === Qt.Key_Left && has) { root.editSearch("left"); return true }
    if (k === Qt.Key_Right && root.caretBack > 0) { root.editSearch("right"); return true }
    if ((k === Qt.Key_Home || k === Qt.Key_End) && has) { root.editSearch(k === Qt.Key_Home ? "home" : "end"); return true }
    const t = event.text
    if (t && t.length === 1 && t.charCodeAt(0) >= 32 && t.charCodeAt(0) !== 127) { root.editSearch({ insert: t }); return true }
    return false
  }

  // ------------------------------------------------------------ collections

  // Enter on a collection: its papers (and those of its subcollections), searchable;
  // Esc or Backspace goes back to where you were.
  // ------------------------------------------------------------ Audit the taxonomies (Views.buildTaxonomyAudit)

  property var taxAudit: null // the runner's classify-show for the paper whose menu this is

  function openTaxonomyAudit() {
    root.taxAudit = null
    root.pushView("tax-audit")
    root.rebuildList()
    root.loadTaxonomyAudit()
  }

  function loadTaxonomyAudit() {
    const it = root.actionItemRef()
    if (!it || !root.service) return
    root.service.classifyShow(it, function(ok, data, error) {
      if (!ok) return root.flashMessage("Couldn't read the result: " + error)
      root.taxAudit = data
      if (root.view === "tax-audit") { root.followTop = false; root.rebuildList() }
    })
  }

  // Enter on a label: toggled on or off the paper (your decision, kept on later passes).
  function decideAudit(row, accept) {
    if (!root.taxAudit || !row || row.rowId !== "tax-audit") return
    root.service.decideSuggestion({ id: root.taxAudit.id, taxonomy: row.value, label: row.tag }, accept, function(ok, error) {
      if (!ok) return root.flashMessage("Not done: " + error)
      root.flashMessage(accept === "auto" ? "Auto: " + row.tag + " (the classifier decides)" : (accept ? "On, by you: " : "Off, by you: ") + row.tag + " (kept on later passes)")
      root.loadTaxonomyAudit()
      root.refreshDetails()
    })
  }

  // A tag's papers, in the launcher (a taxonomy label's: a click on its pill under the paper's status).
  function openTaggedPapers(tag) {
    const lib = root.actionItem ? Number(root.actionItem.libraryID) || 1 : 1
    root.openCollection({ kind: "tag", key: tag, libraryID: lib, title: tag })
  }

  // ------------------------------------------------------------ Settings › Taxonomies › one of them (Settings.buildTaxonomy)

  property string taxEditId: ""
  property var taxEdit: null // the runner's taxonomy-show: { id, name, prefix, kind, question, threshold, low, labels, bundled, own, path }
  property int taxLabel: -1 // the label whose page is open

  function openTaxonomy(id) {
    root.taxEditId = id
    root.taxEdit = null
    root.pushView("settings-taxonomy")
    root.rebuildList()
    root.reloadTaxonomy()
  }

  function reloadTaxonomy() {
    const id = root.taxEditId
    root.service.taxonomyShow(id, function(ok, data, error) {
      if (root.taxEditId !== id) return
      if (!ok) return root.flashMessage("Couldn't read it: " + error)
      root.taxEdit = data
      if (root.view === "settings-taxonomy" || root.view === "settings-tax-label") { root.followTop = false; root.rebuildList() }
    })
  }

  // One change saved (Settings.editTaxonomy; the runner checks it): the page shows it, then done(before, saved).
  function saveTaxonomyChange(change, message, done) {
    const before = root.taxEdit
    const next = before ? Settings.editTaxonomy(before, change) : null
    if (!next) return
    root.service.saveTaxonomy(root.taxEditId, next, function(ok, data, error) {
      if (!ok) {
        root.flashMessage("Not saved: " + error)
        if (root.inForm) { root.followTop = false; root.rebuildList() } // the field as it was
        return
      }
      root.taxEdit = data
      if (root.inSettings) { root.followTop = false; root.rebuildList() }
      if (message) root.flashMessage(message)
      if (done) done(before, data)
    })
  }

  // A field typed on the taxonomy's page or a label's (root.commitField): checked here (Settings.taxonomyValue),
  // then by the runner as it saves; a bad value puts the field back as it was.
  function commitTaxonomyField(d) {
    const t = root.taxEdit
    if (!t || d.id.split(":")[0] !== root.taxEditId) return
    if (["name", "prefix", "question", "threshold", "low", "label-name", "label-definition"].indexOf(d.field) < 0) return
    const revert = function(error) { root.flashMessage(error); root.followTop = false; root.rebuildList() }
    if (d.field === "label-name" || d.field === "label-definition") {
      const i = Number(d.id.split(":")[1])
      const l = t.labels[i]
      if (!l) return
      if (d.field === "label-definition") {
        const def = d.text.replace(/\s+$/, "")
        if (def === (l.definition || "")) return
        return root.saveTaxonomyChange({ label: true, i: i, field: "definition", value: def }, "Saved: papers tagged before are out of date with it")
      }
      const r = Settings.taxonomyValue("label", d.text, t)
      if (r.error) return revert(r.error + ": kept “" + l.name + "”")
      if (r.value === l.name) return
      if (t.labels.some(function(x, k) { return k !== i && x.name.toLowerCase() === r.value.toLowerCase() })) return revert("It has “" + r.value + "” already")
      const fresh = /^new label( \d+)?$/.test(l.name) // just added: no paper has its tag yet
      return root.saveTaxonomyChange({ label: true, i: i, field: "name", value: r.value }, fresh ? "Named “" + r.value + "”" : "", function() {
        if (!fresh) root.offerTagRename([[t.prefix + l.name, t.prefix + r.value]], "Renamed the label")
      })
    }
    const r = Settings.taxonomyValue(d.field, d.text, t)
    if (r.error) return revert(r.error)
    if (r.value === t[d.field]) return
    if (d.field === "prefix") return root.saveTaxonomyChange({ field: "prefix", value: r.value }, "", function(before) {
      root.offerTagRename(before.labels.map(function(l) { return [before.prefix + l.name, r.value + l.name] }), "Changed the prefix")
    })
    root.saveTaxonomyChange({ field: d.field, value: r.value }, d.field === "name" ? "Renamed" : "Saved: papers tagged before are out of date with it")
  }

  // ------------------------------------------------------------ a taxonomy drafted with AI (Settings.buildTaxonomyDraft)

  // { id (the one changed, "" for a new one), base, input, turns: [{ request, taxonomy, notes }], busy, error, proposal, notes }
  property var taxDraft: null

  function openTaxonomyDraft(id) {
    if (root.needsSetup()) return root.flashMessage("Set up an AI model first: Settings › Models & providers")
    root.taxDraft = { id: id, base: id ? root.taxEdit : null, input: "", turns: [], busy: false, error: "", proposal: null, notes: "" }
    root.pushView("settings-tax-ai")
    root.rebuildList()
  }

  // Enter in Ask the AI: the request (with the conversation so far) to your prompts model; its proposal shown.
  function sendTaxonomyRequest() {
    const d = root.taxDraft
    if (!d || d.busy) return
    const request = String(d.input || "").trim()
    if (!request) return root.flashMessage("Type what you want first")
    const turns = d.turns.slice()
    const busyDraft = Object.assign({}, d, { busy: true, error: "", input: request })
    if (!root.service.draftTaxonomy({ id: d.id, request: request, turns: turns.map(function(t) { return { request: t.request, taxonomy: t.taxonomy, notes: t.notes } }) }, function(r) {
      if (!root.taxDraft || root.taxDraft !== busyDraft) return // left, or another one since
      const next = Object.assign({}, root.taxDraft, { busy: false })
      if (r.error) next.error = r.error + (r.notes ? " (" + r.notes + ")" : "")
      else {
        next.turns = turns.concat([{ request: request, taxonomy: r.taxonomy, notes: r.notes }])
        next.proposal = r.taxonomy
        next.notes = r.notes
        next.input = ""
      }
      root.taxDraft = next
      if (root.view === "settings-tax-ai") { root.followTop = false; root.rebuildList(); root.selectRow(function(x) { return x.rowId === (r.error ? "tax-ai-ask" : "tax-ai-accept") }) }
      root.flashMessage(r.error ? "The AI couldn't: " + r.error : "A proposal: accept it, or ask for changes")
    })) return root.flashMessage("One request at a time: wait for the one running")
    root.taxDraft = busyDraft
    root.followTop = false
    root.rebuildList()
  }

  // Accept: saved (a new one as yours; a change over this one), then its page.
  function acceptTaxonomyDraft() {
    const d = root.taxDraft
    if (!d || !d.proposal || d.busy) return
    const p = d.proposal
    const t = { name: p.name, prefix: p.prefix, kind: p.kind, question: p.question, threshold: p.threshold, low: p.low, labels: p.labels }
    root.service.saveTaxonomy(d.id, t, function(ok, data, error) {
      if (!ok || !data) return root.flashMessage("Not saved: " + error)
      root.taxDraft = null
      if (root.view === "settings-tax-ai") root.back()
      if (d.id) {
        root.taxEdit = data
        root.followTop = false
        root.rebuildList()
        root.flashMessage("Accepted: saved as yours")
      } else {
        root.openTaxonomy(data.id)
        root.flashMessage("Made “" + data.name + "”: tag papers by it from a paper's menu, or a collection's Go to")
      }
    })
  }

  // New taxonomy: made at once (with two example labels), its page open on its name, ready to type over.
  function newTaxonomy() {
    root.service.createTaxonomy("New taxonomy", function(ok, data, error) {
      if (!ok || !data) return root.flashMessage("Not made: " + error)
      root.selectAllField = "name"
      root.openTaxonomy(data.id)
      root.flashMessage("Type its name; then its labels (Enter on one), Add a label for more")
    })
  }

  // Add a label: “new label” added at once, its page open on its name, ready to type over.
  function addTaxonomyLabel() {
    const t = root.taxEdit
    if (!t) return
    let name = "new label"
    for (let n = 2; t.labels.some(function(l) { return l.name.toLowerCase() === name }); n++) name = "new label " + n
    root.saveTaxonomyChange({ label: true, i: -1, value: name }, "Type its name, then its definition", function(before, after) {
      root.taxLabel = after.labels.length - 1
      root.selectAllField = "label-name"
      root.pushView("settings-tax-label")
      root.rebuildList()
    })
  }

  // A label (or the prefix) renamed: the tags already on papers renamed too, if you say so. pairs: [[from, to]].
  function offerTagRename(pairs, did) {
    root.askConfirm({ title: did + ": rename the tag" + (pairs.length > 1 ? "s" : "") + " on papers too?", yes: "Rename " + (pairs.length > 1 ? pairs.length + " tags" : pairs[0][0] + " → " + pairs[0][1]) + " on every paper",
      no: "Leave the papers' tags as they are", detail: "Counting the papers…", noDetail: "Papers tagged before keep " + pairs[0][0] + (pairs.length > 1 ? "…" : ""),
      run: function() {
        const next = function(i) { if (i < pairs.length) root.renameTagEverywhere(pairs[i][0], pairs[i][1], function() { next(i + 1) }) }
        next(0)
      } })
    root.countIntoConfirm(pairs.map(function(p) { return p[0] }), function(n) { return n ? "On " + n + (n === 1 ? " paper" : " papers") : "No paper has " + (pairs.length > 1 ? "them" : "it") + " yet" })
  }

  // Delete this label: from the taxonomy, then, if you say so, its tag from every paper.
  function deleteTaxonomyLabel() {
    const t = root.taxEdit
    const l = t && t.labels[root.taxLabel]
    if (!l) return
    const tag = t.prefix + l.name
    root.askConfirm({ title: "Delete the label “" + l.name + "”?", yes: "Delete the label, and " + tag + " from every paper", no: "Delete the label only (papers keep " + tag + ")",
      detail: "Counting the papers…", noDetail: "Esc: keep it",
      run: function() { root.removeLabel(function() { root.deleteTagEverywhere(tag) }) },
      cancel: function() { root.removeLabel(null) } })
    root.countIntoConfirm([tag], function(n) { return n ? tag + " is on " + n + (n === 1 ? " paper" : " papers") : "No paper has " + tag })
  }

  function removeLabel(then) {
    const i = root.taxLabel
    root.saveTaxonomyChange({ label: true, remove: true, i: i }, "Label deleted", function() {
      if (root.view === "settings-tax-label") root.back()
      if (then) then()
    })
  }

  // Off (bundled), deleted (yours) or back to the bundled one (reset): then the list of taxonomies.
  function removeTaxonomyHere(reset, message) {
    root.service.removeTaxonomy(root.taxEditId, reset, function(ok, data, error) {
      if (!ok) return root.flashMessage("Not done: " + error)
      if (reset) { root.reloadTaxonomy(); root.flashMessage(message); return }
      if (root.view === "settings-taxonomy") root.back()
      root.flashMessage(message)
    })
  }

  // Shift+↑/↓ on a label (a taxonomy's page): moved up or down, saved.
  function moveTaxonomyLabel(delta) {
    const row = root.rowAt(root.selectedIndex)
    if (!row || row.rowId !== "tax-label") return
    const i = Number(row.value)
    root.saveTaxonomyChange({ move: delta, i: i }, "", function() {
      root.selectRow(function(r) { return r.rowId === "tax-label" && Number(r.value) === i + delta })
    })
  }

  function openCollection(row) {
    root.pushView("search")
    root.collectionScope = { key: row.key, libraryID: row.libraryID, title: row.kind === "tag" ? "#" + row.title : row.title, type: row.kind === "tag" ? "tag" : "collection" }
    root.scopeTotal = ""
    root.response = null
    root.rebuildSearch()
    root.requestSearch()
  }

  // ------------------------------------------------------------ saved searches and the @ picker

  // f: your saved searches (Enter opens one, Shift+Enter its menu, p pins it, Shift+↑/↓ reorders).
  function openSearches() {
    root.pushView("searches")
    root.rebuildList()
  }

  // Enter on a saved search: its papers, searchable within, like a collection; Esc goes back.
  function openSavedSearch(s) {
    if (!s) return
    root.pushView("search")
    root.collectionScope = Views.searchScope(s)
    root.response = null
    root.rebuildSearch()
    root.requestSearch()
  }

  function openSearchMenu(row) {
    root.searchMenu = root.service ? Views.findSearch(root.service.searches, row.value) : null
    if (!root.searchMenu) return
    root.pushView("search-menu")
    root.rebuildList()
  }

  function toggleSearchPin(id) {
    const s = Views.findSearch(root.service.searches, id)
    if (!s) return
    root.service.saveSearches(Views.updateSearch(root.service.searches, id, { pinned: !s.pinned }))
    root.flashMessage(s.pinned ? "Unpinned" : "Pinned: its badge is above the results; Tab switches to it")
  }

  // p in Searches.
  function toggleSelectedSearchPin() {
    const i = root.selectedIndex
    if (!root.service || i < 0 || i >= actionModel.count || actionModel.get(i).rowId !== "search") return
    const id = actionModel.get(i).value
    root.toggleSearchPin(id)
    root.followTop = false
    root.rebuildList()
    root.selectRow(function(r) { return r.rowId === "search" && r.value === id })
  }

  // Shift+↑/↓ in Searches: a search trades places with its neighbour in the same section (the
  // pinned ones: their badges too).
  function moveSearchRow(delta) {
    const i = root.selectedIndex
    const j = i + delta
    if (!root.service || i < 0 || j < 0 || i >= actionModel.count || j >= actionModel.count) return
    const row = actionModel.get(i), other = actionModel.get(j)
    if (row.rowId !== "search" || other.rowId !== "search" || row.section !== other.section) return
    const id = row.value
    root.service.saveSearches(Views.moveSearch(root.service.searches, id, other.value))
    root.followTop = false
    root.rebuildList()
    root.selectRow(function(r) { return r.rowId === "search" && r.value === id })
  }

  // s (Ctrl+S while typing) in the results: save what they show, the typed search within the
  // collection, tag or saved search it's in; the header takes its name.
  function saveSearchPrompt() {
    if (root.pickFor) return
    const query = Views.combinedQuery(Views.scopeQuery(root.searchScope()), root.filterText)
    if (!query) return root.flashMessage("Type a search first; then " + (root.singleKeys ? "Esc s" : "Alt+S") + " or Ctrl+S saves it")
    root.searchToSave = query
    root.searchEditMode = "save"
    root.pushView("search-edit")
    root.rebuildList()
  }

  // The badges above the results: "" (All) or a pinned search's id.
  function selectSearch(id) {
    root.activeSearch = id || ""
    root.followTop = true
    root.requestSearch() // the rows stay until its answer
  }

  function cycleSearch(delta) {
    root.selectSearch(Views.nextSearch(root.pinnedSearches, root.activeSearch, delta))
  }

  // @ in the search box: what to add to the search, a tag, an author, a year, … or an operator.
  function openPicker() {
    root.pushView("picker")
    root.rebuildList()
  }

  function openPickerValues(field) {
    root.pickerField = field
    root.facetResult = null
    root.pushView("picker-values")
    root.refreshFacets()
  }

  // The values for what is typed. The bridge matches them (a library has thousands of authors: too
  // many to filter here on every key) and sends the best 100; the newest answer wins, and the rows
  // shown stay until it comes. Nothing typed: the field's first page, kept for this opening.
  function refreshFacets() {
    const field = root.pickerField
    if (/^tax:/.test(field)) return root.refreshTagCounts()
    if (Views.DATE_FIELDS[field]) { root.facetLoading = false; return root.rebuildList() } // its values are here
    const query = root.filterText
    const kept = !query.trim() ? root.facetCache[field] : null
    if (field === "search" || kept || !root.service) {
      if (kept) root.facetResult = kept
      root.facetSerial++ // an answer still on its way is for other text
      root.facetLoading = false
      root.rebuildList()
      return
    }
    const serial = ++root.facetSerial
    root.facetLoading = true
    root.rebuildList()
    root.service.facets(field, query, 100, function(res) {
      if (serial !== root.facetSerial) return
      root.facetLoading = false
      if (res.kind === "ok") {
        root.facetResult = res.data
        root.lastError = ""
        if (!String(res.data.query).trim()) {
          const cache = Object.assign({}, root.facetCache)
          cache[field] = res.data
          root.facetCache = cache
        }
      } else {
        root.lastError = "Couldn't list them: " + (res.message || res.kind)
      }
      if (root.opened && root.view === "picker-values" && root.pickerField === field) root.rebuildList()
    })
  }

  // A taxonomy's labels in the picker: every tag's count, read once per opening (the bridge's tag facets, unranked).
  property var tagCounts: null // { tag (lowercase): papers }
  function refreshTagCounts() {
    if (root.tagCounts || !root.service) { root.facetLoading = false; return root.rebuildList() }
    root.facetLoading = true
    root.rebuildList()
    root.service.facets("tag", "", null, function(res) {
      root.facetLoading = false
      if (res.kind === "ok") {
        const counts = {}
        ;(res.data.values || []).forEach(function(v) { counts[String(v.value).toLowerCase()] = v.count })
        root.tagCounts = counts
      } else root.lastError = "Couldn't count them: " + (res.message || res.kind)
      if (root.opened && root.view === "picker-values") root.rebuildList()
    })
  }

  function pickerValues() {
    if (root.pickerField === "search") return Views.savedSearchValues(root.service ? root.service.searches : [])
    if (/^tax:/.test(root.pickerField)) return Views.taxonomyValues(Views.taxonomyOfField(root.pickerField, root.taxonomyList), root.tagCounts)
    return root.facetResult && root.facetResult.field === root.pickerField ? root.facetResult.values || [] : []
  }

  // A picked term or operator goes into the search where its caret was, `levels` menus back; the
  // search box keeps the keys.
  function addToSearch(token, levels) {
    for (let i = 0; i < levels; i++) root.back()
    root.searchFocus = true
    const r = Views.insertAt(root.filterText, root.caret, token)
    root.setFilter(r.text, r.caret, r.live)
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

  // ------------------------------------------------------------ paper status (Settings › Paper status)

  readonly property var paperStatuses: root.service ? root.service.settings.paperStatuses || [] : []
  // …and as the Zotero tags they are ("s/pending"): what papers carry, cycle through and match.
  readonly property var paperStatusTags: Client.statusTags(root.paperStatuses)

  // What you pinned, by "type:libraryID:key": the pin icon on their rows wherever they show up.
  readonly property var pinnedSet: {
    const out = {}
    for (const p of (root.service ? root.service.pins : [])) out[(p.type || "item") + ":" + (Number(p.libraryID) || 1) + ":" + p.key] = true
    return out
  }

  // Papers with open tasks, for the task icon on their rows (red when one is overdue).
  readonly property var taskMarks: root.service ? Todos.taskMarks(root.service.todos, root.todoStatuses, new Date()) : ({})

  // The status shown in the header of a paper's menu and its submenus: its status, "" for none,
  // null elsewhere.
  readonly property var headerStatus: {
    root.statusShown
    if (!root.actionItem || !root.details || !root.details.item || !root.paperStatuses.length) return null
    if (root.details.item.itemType === "note" || root.details.item.itemType === "attachment") return null
    if (["actions", "notes", "files", "tags", "prompts", "note"].indexOf(root.view) < 0) return null
    if (root.inNote && !root.notePaperInView()) return null // a note on no paper, or on another one
    return root.menuPaperStatus()
  }

  // ------------------------------------------------------------ the context bar (above the search box)

  // A paper's menu and its submenus: the bar names the paper ("Authors, Year · Title"), then the submenu.
  readonly property var paperViews: ({ actions: "", "tax-paper": "Taxonomies", "tax-audit": "Audit the taxonomies", notes: "Notes", files: "Choose a file", tags: "Tags", prompts: "Prompts", "extract-menu": "Extracted text",
    "chat-menu": "Chat", "chat-rename": "Rename the chat", "artifact-menu": "Artifact", "artifact-change": "Change the artifact", "artifact-rename": "Rename the artifact",
    "tag-menu": "Tag", "tag-name": "Rename the tag", "tag-status": "Tag into a status", note: "" })
  property string scopeTotal: "" // a scope's paper count, as last known (a saved search knows it untyped)

  // What the bar shows (null at the top level, where there's nothing to name): { text, ranks, count }.
  readonly property var context: {
    root.view; root.actionItem; root.details; root.noteData; root.collectionScope; root.pickFor; root.response; root.todoId; root.filterText
    return root.contextInfo()
  }

  function contextInfo() {
    if (root.atRoot) return null
    if (root.view in root.paperViews && root.actionItem && (!root.inNote || root.notePaperInView())) {
      let sub = root.paperViews[root.view]
      if (root.view === "chat-menu" && root.chatMenu) sub = root.chatMenu.title
      if (root.view === "artifact-menu" && root.artifactMenu) sub = root.artifactMenu.title
      if (root.view.indexOf("tag-") === 0 && root.tagMenuName) sub += " · " + root.tagMenuName
      return { text: root.paperLabel() + (sub ? "  ›  " + sub : ""), ranks: root.menuRanks, count: "" }
    }
    if (root.inNote) return { text: "A note on no paper", ranks: [], count: "" }
    if (root.view === "todo-edit") {
      const t = root.currentTodo()
      return { text: "Task · " + (t ? t.description + (t.item ? "  ›  " + (t.item.cite || t.item.title) : "") : ""), ranks: [], count: "" }
    }
    if (root.inSearch) {
      const sc = root.collectionScope
      if (root.pickFor === "chat") return { text: "New chat · pick a paper" + (sc ? " in " + sc.title : ""), ranks: [], count: "" }
      if (root.pickFor === "todo") return { text: "Pick the paper this task is about", ranks: [], count: "" }
      // its papers, while you type (the header counts the matches; untyped, the papers, as here)
      if (sc) return { text: ({ tag: "Tag  ", search: "Saved search  " }[sc.type] || "Collection  ") + sc.title, ranks: [], count: root.filterText ? root.scopeTotal : "" }
      return null
    }
    return { text: Views.contextLabel(root.placeholder()), ranks: [], count: "" }
  }

  // The search box's placeholder: under the bar, only what to type.
  function headerPlaceholder() {
    if (root.inNote && root.context && root.notePaperInView()) return root.noteParts.title || (root.noteTarget ? root.noteTarget.title : "Note") // the bar names its paper
    if (!root.context || root.inNote) return root.placeholder()
    // pages where typing doesn't filter
    if (root.view === "todo-edit") return "Type to edit the description or the notes, on their row"
    if (root.view === "settings-taxonomy" || root.view === "settings-tax-label") return "Type on a field to edit it: Enter, or moving off it, keeps it"
    if (root.view === "settings-tax-ai") return "Type what you want in Ask the AI; Enter sends it; accept the proposal, or ask for changes"
    if (root.view === "prompt-edit") return "↵ changes the highlighted row"
    if (root.view === "confirm") return "↵ chooses · esc leaves things as they are"
    if (root.inSearch) return (root.pickFor ? "Type to find the paper" : "Type to search in it") + (root.singleKeys && !root.searchFocus ? " · / to search" : "")
    return Views.typeHint(root.placeholder(), root.textEntry)
  }

  // Under the status line: the paper's labels in each taxonomy, as pills, and a word on them (Views.taxonomyStrip);
  // null where there's no status line, or no taxonomies.
  readonly property var headerTaxonomies: {
    if (root.headerStatus === null || !root.taxonomyList.length || !root.details) return null
    const it = root.actionItem
    const busy = !!(it && root.service && root.service.classifying[(Number(it.libraryID) || 1) + ":" + it.key])
    return Views.taxonomyStrip(root.details.tags, root.taxonomyList, root.taxStatus, busy)
  }

  // The footer's status row in a paper's menu and its submenus: its text and its taxonomies (Views.paperFooter).
  readonly property var paperFooterPills: {
    if (root.headerStatus === null || !root.service || !root.actionItem) return []
    const it = root.actionItem
    const id = (Number(it.libraryID) || 1) + ":" + it.key
    return Views.paperFooter({ details: root.details, taxonomies: root.taxonomyList, taxStatus: root.taxStatus, classifying: !!root.service.classifying[id],
      extracting: (root.service.tasks || []).some(function(t) { return t.kind === "extract" && t.status === "running" && t.key === it.key }) })
  }

  // Its default task's status, beside them ("" for none; null where there's no paper status line).
  readonly property var headerTask: {
    if (root.headerStatus === null || !root.actionItem) return null
    const st = root.defaultTasks[(Number(root.actionItem.libraryID) || 1) + ":" + root.actionItem.key]
    return st ? st.name : ""
  }

  // The journal rankings shown on the right of that line (ABS 4*, ABDC A*, FT50, UTD24), in full.
  readonly property var menuRanks: {
    if (!root.actionItem || !root.details || !root.details.paper) return []
    if (!(root.view in root.paperViews) || (root.inNote && !root.notePaperInView())) return []
    return Views.rankLabels(root.details.paper.rank)
  }

  // The paper Alt+→ / Alt+← would change: the highlighted result, or the paper whose menu this is.
  // In the results, only once the list has the keys (after Esc): while you type, Tab belongs to the
  // search box (the saved searches' badges).
  function statusTarget() {
    if (root.inSearch && !root.pickFor && root.selectedIndex >= 0 && root.selectedIndex < displayModel.count) {
      const r = displayModel.get(root.selectedIndex)
      if (r.kind !== "item" || r.itemType === "note" || r.itemType === "attachment") return null
      return { item: { key: r.key, libraryID: r.libraryID }, current: r.status, index: root.selectedIndex }
    }
    if ((root.view === "actions" || (root.inNote && root.notePaperInView())) && root.actionItem && root.details && root.details.item && root.details.item.itemType !== "note" && root.details.item.itemType !== "attachment") {
      return { item: { key: root.actionItem.key, libraryID: Number(root.actionItem.libraryID) || 1 }, current: root.menuPaperStatus(), index: -1 }
    }
    return null
  }

  // Reading a note: its paper is the one in view (its details loaded: the header's pills, the status keys).
  function notePaperInView() {
    const p = root.noteData && root.noteData.parent
    return !!(p && root.actionItem && p.key === root.actionItem.key && (Number(p.libraryID) || 1) === (Number(root.actionItem.libraryID) || 1) && root.details)
  }

  function menuPaperStatus() {
    const id = (Number(root.actionItem.libraryID) || 1) + ":" + root.actionItem.key
    if (root.statusShown[id] !== undefined) return root.statusShown[id]
    return Client.paperStatusOf(root.details ? root.details.tags : [], root.paperStatusTags)
  }

  // ------------------------------------------------------------ citations (Settings › General › Citation style)

  // The paper i / r would cite: the highlighted result, the paper whose menu (or submenu) this is, or the
  // note's paper being read. → { key, libraryID, title } or null.
  function citeTarget() {
    if (root.inSearch) {
      if (root.pickFor || root.selectedIndex < 0 || root.selectedIndex >= displayModel.count) return null
      const r = displayModel.get(root.selectedIndex)
      return r.kind === "item" && r.itemType !== "note" && r.itemType !== "attachment" ? { key: r.key, libraryID: r.libraryID, title: r.title } : null
    }
    if (root.inNote && root.noteData && root.noteData.parent) {
      const p = root.noteData.parent
      return p.itemType === "attachment" || p.itemType === "note" ? null : { key: p.key, libraryID: Number(p.libraryID) || 1, title: p.title || "" }
    }
    if (["actions", "notes", "files", "tags", "prompts", "note"].indexOf(root.view) < 0 || !root.actionItem || !root.details || !root.details.item) return null
    if (root.details.item.itemType === "note" || root.details.item.itemType === "attachment") return null
    return { key: root.actionItem.key, libraryID: Number(root.actionItem.libraryID) || 1, title: root.actionItem.title }
  }

  // The paper's citation and bibliography entry for its menu, asked once per paper and style.
  function loadCitePreview() {
    const it = root.actionItem
    if (!it || !root.service || !root.details || !root.details.item || root.details.item.itemType === "note" || root.details.item.itemType === "attachment") return
    const id = (Number(it.libraryID) || 1) + ":" + it.key
    const style = Client.citationStyle(root.service.settings)
    const p = root.citePreview
    if (p && p.id === id && p.style === style && !p.error) return
    root.citePreview = { id: id, style: style, citation: "", bibliography: "", error: "" }
    ;["citation", "bibliography"].forEach(function(mode) {
      root.service.cite(it, mode, function(res) {
        const cur = root.citePreview
        if (!cur || cur.id !== id || cur.style !== style) return
        const next = Object.assign({}, cur)
        if (res.kind === "ok" && res.data.entries && res.data.entries[0]) next[mode] = res.data.entries[0].text
        else next.error = res.message || res.kind
        root.citePreview = next
        if (root.view === "actions") { root.followTop = false; root.rebuildList() }
      })
    })
  }

  // What the Copy rows show: the texts, once formatted.
  function citeExtra() {
    const it = root.actionItem
    const p = root.citePreview
    const mine = p && it && p.id === (Number(it.libraryID) || 1) + ":" + it.key && p.style === Client.citationStyle(root.service.settings)
    return { citation: mine ? p.citation : "", bibliography: mine ? p.bibliography : "", error: mine ? p.error : "", keys: root.singleKeys ? "single" : "alt" }
  }

  // i / r (or Enter on a Copy row): the paper's citation or bibliography entry to the clipboard, said in the footer.
  function copyCite(mode) {
    const t = root.citeTarget()
    if (!t || !root.service) return root.flashMessage("Nothing to cite here: highlight a paper")
    const id = t.libraryID + ":" + t.key
    const style = Client.citationStyle(root.service.settings)
    const p = root.citePreview
    const copy = function(text) {
      if (!text) return root.flashMessage("Zotero gave no text for it")
      root.flashMessage(root.service.copyText(text) ? "Copied: " + text.replace(/\s+/g, " ") : "Couldn't copy it: still copying the last one")
    }
    if (p && p.id === id && p.style === style && p[mode]) return copy(p[mode])
    root.service.cite(t, mode, function(res) {
      if (res.kind !== "ok" || !res.data.entries || !res.data.entries[0]) return root.flashMessage("Couldn't format it: " + (res.message || res.kind))
      copy(res.data.entries[0].text)
    })
  }

  // Alt+→ / Alt+←: the next or previous status (none, then Settings › Paper status's tags), shown
  // now, saved to Zotero a second after the last press (so a few presses make one change).
  function cyclePaperStatus(delta) {
    const t = root.statusTarget()
    if (!t) return false
    if (!root.paperStatuses.length) { root.flashMessage("No paper statuses: add some in Settings › Paper status"); return true }
    if (t.current === "\u0000") { root.flashMessage("Update the Zotero plugin to see and change statuses (Settings › Setup)"); return true }
    const id = t.item.libraryID + ":" + t.item.key
    const next = Client.nextPaperStatus(root.paperStatusTags, t.current, delta)
    const shown = Object.assign({}, root.statusShown)
    shown[id] = next
    root.statusShown = shown
    const pending = Object.assign({}, root.statusPending)
    pending[id] = { item: t.item, from: pending[id] ? pending[id].from : t.current, to: next }
    root.statusPending = pending
    if (t.index >= 0) displayModel.setProperty(t.index, "status", next)
    else if (!root.inNote) { root.followTop = false; root.rebuildList() }
    statusSave.restart()
    root.flashMessage("Status: " + (Client.statusName(next) || "none"))
    return true
  }

  // A second after the last change: each paper loses its old status tag and gets the new one.
  function flushStatuses() {
    const pending = root.statusPending
    root.statusPending = ({})
    Object.keys(pending).forEach(function(id) {
      const p = pending[id]
      root.service.changePaperStatus(p.item, p.from, p.to, function(res) {
        if (res.kind === "ok") { root.libraryChanged = true; return }
        const shown = Object.assign({}, root.statusShown)
        delete shown[id]
        root.statusShown = shown
        root.flashMessage("Couldn't save the status: " + (res.message || res.kind))
        if (root.inSearch) root.rebuildSearch()
        else root.rebuildList()
      })
    })
  }

  // ------------------------------------------------------------ a paper's default task (Shift+Alt+→ / ←)

  // Every paper's default task status (its pill on the rows and in the menu's header), the presses not yet
  // saved included: { "<lib>:<key>": status ({ id, name, group }) }.
  readonly property var defaultTasks: {
    const out = root.service ? Todos.defaultTaskStatuses(root.service.todos, root.todoStatuses) : ({})
    for (const id in root.taskShown) out[id] = Todos.statusById(root.todoStatuses, root.taskShown[id])
    return out
  }

  // The paper Shift+Alt+→ / ← would change: the highlighted result, or the paper whose menu this is.
  // → { item: { key, libraryID, title, cite }, id } or null.
  function taskTarget() {
    if (root.inSearch && !root.pickFor && root.selectedIndex >= 0 && root.selectedIndex < displayModel.count) {
      const r = displayModel.get(root.selectedIndex)
      if (r.kind !== "item" || r.itemType === "note" || r.itemType === "attachment") return null
      const parts = String(r.subtitle || "").split(" · ")
      const cite = /^\d{4}$/.test(parts[1] || "") ? parts[0] + " (" + parts[1] + ")" : "" // "Adner & Helfat (2003)", as from its menu
      return { item: { key: r.key, libraryID: r.libraryID, title: r.title, cite: cite }, id: r.libraryID + ":" + r.key }
    }
    if ((root.view === "actions" || (root.inNote && root.notePaperInView())) && root.actionItem && root.details && root.details.item && root.details.item.itemType !== "note" && root.details.item.itemType !== "attachment") {
      const it = root.actionItemRef()
      return { item: it, id: it.libraryID + ":" + it.key }
    }
    return null
  }

  // Shift+Alt+→ / ←: the paper's default task to its next or previous status; the first press makes it.
  function cycleDefaultTask(delta) {
    const t = root.taskTarget()
    if (!t || !root.service) return false
    const cur = root.defaultTasks[t.id]
    const next = Todos.nextDefaultStatus(root.todoStatuses, cur ? cur.id : "", delta)
    if (!next) return true
    const shown = Object.assign({}, root.taskShown)
    shown[t.id] = next
    root.taskShown = shown
    const pending = Object.assign({}, root.taskPending)
    pending[t.id] = { item: t.item, status: next }
    root.taskPending = pending
    if (!root.inSearch && !root.inNote) { root.followTop = false; root.rebuildList() }
    taskSave.restart()
    const st = Todos.statusById(root.todoStatuses, next)
    root.flashMessage((cur ? "Task: " : "New task, “" + Todos.defaultTaskDescription(Todos.defaultTemplateOf(root.service.settings), t.item) + "”: ") + (st ? st.name : next))
    return true
  }

  // A second after the last press: each paper's default task made or moved, saved once (its t/ tag follows).
  function flushDefaultTasks() {
    const pending = root.taskPending
    root.taskPending = ({})
    if (!root.service || !Object.keys(pending).length) return
    root.service.setDefaultTasks(Object.keys(pending).map(function(id) { return pending[id] }))
    const shown = Object.assign({}, root.taskShown)
    Object.keys(pending).forEach(function(id) { if (!root.taskPending[id]) delete shown[id] })
    root.taskShown = shown
  }

  // ------------------------------------------------------------ tasks (to-dos; lib/Todos.js)

  function currentTodo() {
    const list = root.service ? root.service.todos : []
    for (let i = 0; i < list.length; i++) if (list[i].id === root.todoId) return list[i]
    return null
  }

  function openTodos() {
    root.pushView("todos")
    root.rebuildList()
  }

  function openTodo(id) {
    root.todoId = id
    root.pushView("todo-edit")
    root.searchFocus = false // nothing to search on a task's page: its keys act at once (d, !, Tab, Delete)
    root.rebuildList()
  }

  // The paper whose menu is open, as a task refers to it.
  function actionItemRef() {
    const it = root.actionItem
    if (!it) return null
    const p = root.details && root.details.paper
    return { key: it.key, libraryID: Number(it.libraryID) || 1, title: (p && p.title) || it.title || "", cite: p ? Views.paperCite(p) : "" }
  }

  // "Sirmon et al. · 2007 · Journal" (a result's second line) → "Sirmon et al., 2007".
  function citeFromRow(row) {
    const parts = String(row.subtitle || "").split(" · ")
    return /^\d{4}$/.test(parts[1] || "") ? parts[0] + ", " + parts[1] : ""
  }

  // a: a new task, about what's highlighted: a paper (from the results or its menu), and the note
  // or chat highlighted in its menu (or the note being read).
  function addTodoKey() {
    if (root.inSearch && !root.pickFor && root.selectedIndex >= 0 && root.selectedIndex < displayModel.count) {
      const r = displayModel.get(root.selectedIndex)
      if (r.kind === "item" && r.itemType !== "note" && r.itemType !== "attachment") return root.startNewTodo({ item: { key: r.key, libraryID: r.libraryID, title: r.title, cite: root.citeFromRow(r) } })
    }
    if (root.inNote && root.noteTarget) {
      // about the note's own paper (opened from the results, the paper menu may be another's)
      const d = root.noteData
      const paperRef = d && d.parent ? { key: d.parent.key, libraryID: Number(d.parent.libraryID) || 1, title: (d.paper && d.paper.title) || d.parent.title || "", cite: d.paper ? Views.paperCite(d.paper) : "" }
        : root.actionItem ? root.actionItemRef() : null
      return root.startNewTodo({ item: paperRef,
        context: { kind: "note", key: root.noteTarget.key, libraryID: root.noteTarget.libraryID, title: root.noteParts.title || root.noteTarget.title || "" } })
    }
    if (root.actionItem && (root.view === "actions" || root.view === "notes")) {
      const sel = root.selectedIndex >= 0 && root.selectedIndex < actionModel.count ? actionModel.get(root.selectedIndex) : null
      const item = root.actionItemRef()
      let ctx = null
      if (sel && sel.rowId === "note") ctx = { kind: "note", key: sel.noteKey, libraryID: sel.noteLibraryID, title: sel.label }
      else if (sel && sel.rowId === "chat-session") ctx = { kind: "chat", key: item.key, libraryID: item.libraryID, id: sel.value, title: sel.label }
      return root.startNewTodo({ item: item, context: ctx })
    }
    return root.startNewTodo({})
  }

  function startNewTodo(draft) {
    root.todoDraft = draft || {}
    root.pushView("todo-new")
    root.rebuildList()
    return true
  }

  // Enter: add it and go back to where you were; Shift+Enter (`open`): add it and open its page.
  function saveNewTodo(text, open) {
    if (!text || !root.service) return
    const d = root.todoDraft || {}
    const r = root.addQuickTodo(text, d.item || null, d.context || null)
    if (!r) return
    root.back()
    if (open) root.openTodo(r.todo.id)
    else {
      root.followTop = false
      root.rebuildList()
      root.selectRow(function(x) { return x.rowId === "todo" && x.value === r.todo.id })
    }
  }

  // A quick line (#status !priority @due) → the task, saved. → { todo } or null.
  function addQuickTodo(text, item, context) {
    const q = Todos.parseQuick(text, root.todoStatuses, new Date())
    if (!q.description) { root.flashMessage("Type what to do"); return null }
    const r = Todos.addTodo(root.service.todos, { description: q.description, status: q.status, priority: q.priority, due: q.due, item: item, context: context }, root.todoStatuses, new Date())
    root.service.saveTodos(r.todos)
    root.flashMessage("Added to " + Todos.statusOfTodo(r.todo, root.todoStatuses).name + (q.problems.length ? " (" + q.problems[0] + ")" : ""))
    return r
  }

  // Typed in the Tasks view: Enter adds it and opens its page (Shift+Enter: just adds it).
  function addQuickHere(text, open) {
    const r = root.addQuickTodo(text, null, null)
    if (!r) return
    root.setFilter("")
    if (open) return root.openTodo(r.todo.id)
    root.followTop = false
    root.rebuildList()
    root.selectRow(function(x) { return x.rowId === "todo" && x.value === r.todo.id })
  }

  // !, d, Delete, u on a task (the Tasks view, a paper's Tasks, a task's page).
  function todoKey(what) {
    const id = root.tabTodoId()
    if (what === "undo") {
      const u = root.lastDeletedTodo
      if (!u) return root.flashMessage("Nothing to bring back")
      const list = root.service.todos.slice()
      list.splice(Math.min(u.index, list.length), 0, u.todo)
      root.service.saveTodos(list)
      root.lastDeletedTodo = null
      root.followTop = false
      root.rebuildList()
      return root.flashMessage("Brought back “" + u.todo.description + "”")
    }
    if (!id) return
    const list = root.service.todos
    let next = list
    if (what === "priority") next = Todos.cyclePriority(list, id, new Date())
    else if (what === "done") next = Todos.toggleDone(list, id, root.todoStatuses, new Date())
    else if (what === "delete") {
      const i = list.findIndex(function(t) { return t.id === id })
      if (i < 0) return
      root.lastDeletedTodo = { todo: list[i], index: i }
      root.service.saveTodos(Todos.removeTodo(list, id))
      if (root.view === "todo-edit") root.back()
      root.followTop = false
      root.rebuildList()
      return root.flashMessage("Deleted “" + list[i].description + "” · u brings it back")
    }
    root.service.saveTodos(next)
    const t = next.filter(function(x) { return x.id === id })[0]
    root.followTop = false
    root.rebuildList()
    if (root.view !== "todo-edit") root.selectRow(function(r) { return r.rowId === "todo" && r.value === id })
    if (t) root.flashMessage(what === "priority" ? "Priority: " + Todos.priorityName(t.priority) : "Now: " + Todos.statusOfTodo(t, root.todoStatuses).name)
  }

  function setTodo(changes) {
    if (!root.service || !root.todoId) return
    root.service.saveTodos(Todos.updateTodo(root.service.todos, root.todoId, changes, new Date()))
    root.followTop = false
    root.rebuildList()
  }

  function cycleTodoPriority(delta) {
    const list = Todos.cyclePriority(root.service.todos, root.todoId, new Date(), delta)
    root.service.saveTodos(list)
    const t = list.filter(function(x) { return x.id === root.todoId })[0]
    root.followTop = false
    root.rebuildList()
    if (t) root.flashMessage("Priority: " + Todos.priorityName(t.priority))
  }

  // A task's description or notes, edited in place: saved when you leave the row (or the page, or
  // close the launcher). fieldDraft holds what is typed until then.
  property var fieldDraft: null // { id, field, text }

  // Pages that are forms, their text fields edited in place on their row (a task's, a taxonomy's, a label's).
  readonly property var formViews: ["todo-edit", "settings-taxonomy", "settings-tax-label", "settings-tax-ai"]
  readonly property bool inForm: root.formViews.indexOf(root.view) >= 0
  property string selectAllField: "" // a field whose text typing replaces (a new label's name)

  // What the form is about: the task, the taxonomy, the taxonomy's label.
  function formId() {
    if (root.view === "todo-edit") return root.todoId
    if (root.view === "settings-tax-label") return root.taxEditId + ":" + root.taxLabel
    if (root.view === "settings-tax-ai") return "ai:" + (root.taxDraft ? root.taxDraft.id : "")
    return root.taxEditId
  }

  function draftField(field, text) {
    root.fieldDraft = { view: root.view, id: root.formId(), field: field, text: text }
  }

  // What was typed in a field, kept: the row moved on, Enter, going back, closing.
  function commitField() {
    const d = root.fieldDraft
    root.fieldDraft = null
    if (!d || !root.service) return
    if (d.view === "settings-tax-ai") { if (root.taxDraft) root.taxDraft = Object.assign({}, root.taxDraft, { input: d.text }); return } // sent with Enter
    if (d.view !== "todo-edit") return root.commitTaxonomyField(d)
    const t = root.service.todos.filter(function(x) { return x.id === d.id })[0]
    if (!t) return
    const value = d.field === "description" ? d.text.replace(/\s+/g, " ").trim() : d.text.replace(/\s+$/, "")
    if (d.field === "description" && !value) { root.flashMessage("A task needs a description: kept the old one"); root.rebuildList(); return }
    if (String(t[d.field] || "") === value) return
    const changes = {}
    changes[d.field] = value
    root.service.saveTodos(Todos.updateTodo(root.service.todos, d.id, changes, new Date()))
  }

  // Keys in a task's description or notes box: typing, the caret and paste stay in the box; Enter
  // keeps it and goes back (in the notes: a new line; Ctrl+Enter goes back); ↑ ↓ move to the
  // next row (in the notes, from its first or last line); Esc, Tab and paging act as on the page.
  function fieldKey(event, multiline, box) {
    const k = event.key
    const ctrl = (event.modifiers & Qt.ControlModifier) !== 0
    const enter = k === Qt.Key_Return || k === Qt.Key_Enter
    const toPage = function() {
      keyCatcher.forceActiveFocus()
      root.handleKey(event)
      return true
    }
    if (k === Qt.Key_Escape) return toPage()
    if (enter) {
      if (multiline && !ctrl) return false
      if (root.view === "settings-tax-ai") { root.commitField(); root.sendTaxonomyRequest(); return true } // to the AI
      if (root.view !== "todo-edit") { root.commitField(); return true } // a taxonomy's field: kept, still on it
      keyCatcher.forceActiveFocus()
      root.back()
      return true
    }
    if (k === Qt.Key_Up || k === Qt.Key_Down) {
      if (multiline) {
        const r = box.cursorRectangle
        const atTop = r.y < r.height / 2
        const atBottom = r.y + r.height * 1.5 > box.contentHeight
        if ((k === Qt.Key_Up && !atTop) || (k === Qt.Key_Down && !atBottom)) return false
      }
      return toPage()
    }
    if (k === Qt.Key_Tab || k === Qt.Key_Backtab || k === Qt.Key_PageUp || k === Qt.Key_PageDown) return toPage()
    return false
  }

  // The due date: a calendar (calDate is the highlighted day); typing a date works too (fri, +3d).
  property string calDate: ""

  function openDuePicker() {
    const t = root.currentTodo()
    if (!t) return
    root.calDate = t.due || Todos.isoDate(new Date())
    root.pushView("todo-due")
    root.searchFocus = false
    root.filterText = ""
    root.rebuildList()
  }

  function calendarKey(k, enter) {
    if (k === Qt.Key_Left || k === Qt.Key_Right) { root.calDate = Todos.addDays(root.calDate, k === Qt.Key_Left ? -1 : 1); return true }
    if (k === Qt.Key_Up || k === Qt.Key_Down) { root.calDate = Todos.addDays(root.calDate, k === Qt.Key_Up ? -7 : 7); return true }
    if (k === Qt.Key_PageUp || k === Qt.Key_PageDown) { root.calDate = Todos.addMonths(root.calDate, k === Qt.Key_PageUp ? -1 : 1); return true }
    if (k === Qt.Key_Home) { root.calDate = Todos.isoDate(new Date()); return true }
    if (k === Qt.Key_Delete) { root.pickDue(""); return true }
    if (enter) {
      const typed = root.filterText.trim()
      if (!typed) { root.pickDue(root.calDate); return true }
      const d = Todos.parseDue(typed, new Date())
      if (d.error) root.flashMessage(d.error)
      else root.pickDue(d.value)
      return true
    }
    return false
  }

  function pickDue(iso) {
    root.back()
    root.setTodo({ due: iso })
    root.selectRow(function(r) { return r.rowId === "todo-due" })
    const when = iso ? Todos.dueText(iso, new Date()) : ""
    root.flashMessage(iso ? when.charAt(0).toUpperCase() + when.slice(1) : "No due date")
  }

  function openTodoText(field) {
    const t = root.currentTodo()
    if (!t) return
    root.todoField = field
    root.pushView("todo-text")
    root.filterText = String(t[field] || "")
    root.rebuildList()
  }

  function saveTodoText(text) {
    const f = root.todoField
    let value = String(text || "").trim()
    if (f === "description" && !value) return root.flashMessage("A task needs a description")
    if (f === "due") {
      const d = Todos.parseDue(value, new Date())
      if (d.error) return root.flashMessage(d.error)
      value = d.value
    }
    const changes = {}
    changes[f] = value
    root.back()
    root.setTodo(changes)
    root.selectRow(function(r) { return r.rowId === "todo-edit" && r.value === f })
  }

  // The header's one row for a new task, a task's field, or a status's name.
  function entryRows() {
    const t = root.filterText.trim()
    const L = Views.listRow
    if (root.view === "todo-new") {
      const d = root.todoDraft || {}
      const q = Todos.parseQuick(t, root.todoStatuses, new Date())
      const rows = [L({ rowId: "todo-new-save", icon: Todos.ICON.add, label: q.description ? "Add “" + q.description + "”" : "Type what to do", available: !!q.description, value: t,
        detail: q.description ? Todos.quickSummary(q, root.todoStatuses, new Date()) + (q.problems.length ? " · " + q.problems[0] : "") + " · ↵ adds and opens it · ⇧↵ just adds it"
          : "Then, if you like: #status  !priority (! !! !!!)  @due (@fri @tomorrow @+3d)" })]
      if (d.item) rows.push(L({ section: "About", rowId: "info", icon: Todos.ICON.item, label: d.item.cite || d.item.title, detail: d.item.cite ? d.item.title : "", available: false }))
      if (d.context) rows.push(L({ section: "About", rowId: "info", icon: d.context.kind === "chat" ? Todos.ICON.chat : Todos.ICON.note, label: d.context.title, detail: d.context.kind === "chat" ? "A chat" : "A note", available: false }))
      if (!d.item) rows.push(L({ section: "About", rowId: "info", icon: Todos.ICON.item, label: "No paper", detail: "Pick one later on its page, if you like", available: false }))
      return rows
    }
    if (root.view === "todo-text") {
      const f = root.todoField
      const label = f === "description" ? (t ? "Save “" + t + "”" : "Type the description") : f === "due" ? (t ? "Due: " + t : "Save: no date") : (t ? "Save the notes" : "Save: no notes")
      const help = f === "due" ? "today, tomorrow, +3d, +2w, fri, or 2026-10-03" : f === "notes" ? "One line; Ctrl+V pastes" : ""
      return [L({ rowId: "todo-text-save", icon: Todos.ICON.notes, label: label, detail: help, available: f !== "description" || !!t, value: t })]
    }
    const e = root.statusEdit || {}
    if (e.kind === "action") return [L({ rowId: "status-name-save", icon: Todos.ICON.task, label: t ? (e.mode === "add" ? "Add the action “" + t + "”" : "Rename to “" + t + "”") : "Type the action",
      detail: "What @ offers in a new task's line, as a block", available: !!t, value: t })]
    if (e.kind === "paper") return [L({ rowId: "status-name-save", icon: Todos.ICON.status, label: t ? (e.mode === "add" ? "Add the status “" + t + "”" : "Rename to “" + t + "”") : "Type the tag",
      detail: "A Zotero tag: papers with it show it as their status", available: !!t, value: t })]
    return [L({ rowId: "status-name-save", icon: Todos.ICON.status, label: t ? (e.mode === "add" ? "Add “" + t + "” to " + Todos.groupName(e.group) : "Rename to “" + t + "”") : "Type the status's name",
      available: !!t, value: t })]
  }

  function savePaperStatuses(list) {
    const err = root.service.saveSettings(Settings.withValue(root.service.settings, "paperStatuses", list))
    if (!err) { root.followTop = false; root.requestSearch() }
    return err
  }

  function statusMenuRows() {
    const e = root.statusEdit || {}
    if (e.kind === "action") return [
      Views.listRow({ rowId: "status-rename", icon: Todos.ICON.notes, label: "Rename…", detail: e.name || "", available: true, submenu: true }),
      Views.listRow({ rowId: "status-remove", icon: Todos.ICON.trash, label: "Remove this action", detail: "@ won't offer it; tasks keep their words", available: true })
    ]
    if (e.kind === "paper") return [
      Views.listRow({ rowId: "status-rename", icon: Todos.ICON.notes, label: "Rename…", detail: "Its tag " + Client.statusTag(e.name) + " too, on every paper with it", available: true, submenu: true }),
      Views.listRow({ rowId: "status-remove", icon: Todos.ICON.trash, label: "Remove this status", detail: "And delete its tag " + Client.statusTag(e.name) + " from every paper (asked first)", available: true })
    ]
    const n = (root.service ? root.service.todos : []).filter(function(t) { return t.status === e.id }).length
    const rm = Todos.removeStatus(root.todoStatuses, e.id)
    return [
      Views.listRow({ rowId: "status-rename", icon: Todos.ICON.notes, label: "Rename…", detail: e.name || "", available: true, submenu: true }),
      Views.listRow({ rowId: "status-remove", icon: Todos.ICON.trash, label: "Remove this status", available: !rm.error,
        detail: rm.error ? rm.error : n ? "Its " + n + (n === 1 ? " task moves" : " tasks move") + " to " + Todos.statusById(rm.statuses, rm.moveTo).name : "No task has it" })
    ]
  }

  function saveStatusName(text) {
    const e = root.statusEdit || {}
    if (e.kind === "action") {
      const name = text.replace(/[{}]/g, "").replace(/\s+/g, " ").trim()
      if (!name) return root.flashMessage("Type the action")
      const list = root.service.taskActions.slice()
      if (list.some(function(a) { return a.toLowerCase() === name.toLowerCase() && a !== e.id })) return root.flashMessage("It's there already")
      if (e.mode === "add") list.push(name)
      else list[list.indexOf(e.id)] = name
      const err = root.service.saveTaskActions(list)
      if (err) return root.flashMessage("Not saved: " + err)
      root.back()
      if (e.mode !== "add") root.back()
      root.followTop = false
      root.rebuildList()
      root.selectRow(function(r) { return r.rowId === "task-action" && r.value === name })
      return root.flashMessage(e.mode === "add" ? "Added “" + name + "”" : "Renamed")
    }
    if (e.kind === "paper") {
      const list = root.paperStatuses.slice()
      if (list.some(function(t) { return t.toLowerCase() === text.toLowerCase() && t !== e.id })) return root.flashMessage("It's there already")
      if (e.mode === "add") list.push(text)
      else list[list.indexOf(e.id)] = text
      const err = root.savePaperStatuses(list)
      if (err) return root.flashMessage("Not saved: " + err)
      root.back()
      if (e.mode !== "add") root.back()
      root.followTop = false
      root.rebuildList()
      if (e.mode === "add") return root.flashMessage("Added “" + text + "”")
      // its tag, renamed on every paper with it (a rename here is a rename in Zotero)
      root.renameTagEverywhere(Client.statusTag(e.id), Client.statusTag(text), function() { root.requestSearch() })
      return
    }
    const r = e.mode === "add" ? Todos.addStatus(root.todoStatuses, text, e.group) : Todos.renameStatus(root.todoStatuses, e.id, text)
    if (r.error) return root.flashMessage(r.error)
    const err = root.service.saveStatuses(r.statuses)
    if (err) return root.flashMessage("Not saved: " + err)
    root.back()
    if (e.mode !== "add") root.back()
    root.followTop = false
    root.rebuildList()
    root.flashMessage(e.mode === "add" ? "Added “" + text + "”" : "Renamed")
  }

  // Tab / Shift+Tab on a task (its page, the Tasks view, a paper's Tasks): the next or previous status.
  function tabTodoId() {
    if (root.view === "todo-edit") return root.todoId
    if (root.inSearch || root.inNote) return ""
    const sel = root.selectedIndex >= 0 && root.selectedIndex < actionModel.count ? actionModel.get(root.selectedIndex) : null
    return sel && sel.rowId === "todo" ? sel.value : ""
  }

  function cycleTodo(id, delta) {
    const list = Todos.cycleStatus(root.service.todos, id, root.todoStatuses, delta, new Date())
    root.service.saveTodos(list)
    const t = list.filter(function(x) { return x.id === id })[0]
    root.followTop = false
    root.rebuildList()
    if (root.view !== "todo-edit") root.selectRow(function(r) { return r.rowId === "todo" && r.value === id })
    if (t) root.flashMessage("Now: " + Todos.statusOfTodo(t, root.todoStatuses).name)
  }

  // Shift+↑/↓ in the Tasks view: within its status; past the first or last, into the next status.
  function moveTodoRow(delta) {
    const sel = root.selectedIndex >= 0 && root.selectedIndex < actionModel.count ? actionModel.get(root.selectedIndex) : null
    if (!sel || sel.rowId !== "todo") return
    const id = sel.value
    root.service.saveTodos(Todos.moveTodo(root.service.todos, id, root.todoStatuses, delta, new Date()))
    root.followTop = false
    root.rebuildList()
    root.selectRow(function(r) { return r.rowId === "todo" && r.value === id })
  }

  // Shift+↑/↓ in Settings › Tasks: a status within its group; past the first or last, into the next group.
  function moveStatusRow(delta) {
    const sel = root.selectedIndex >= 0 && root.selectedIndex < actionModel.count ? actionModel.get(root.selectedIndex) : null
    if (sel && sel.rowId === "task-action") {
      const list = root.service.taskActions.slice()
      const name = sel.value
      const i = list.indexOf(name), j = i + delta
      if (i < 0 || j < 0 || j >= list.length) return
      list[i] = list[j]
      list[j] = name
      const err = root.service.saveTaskActions(list)
      if (err) return root.flashMessage("Not saved: " + err)
      root.followTop = false
      root.rebuildList()
      return root.selectRow(function(r) { return r.rowId === "task-action" && r.value === name })
    }
    if (!sel || sel.rowId !== "status") return
    const id = sel.value
    const err = root.service.saveStatuses(Todos.moveStatus(root.todoStatuses, id, delta))
    if (err) return root.flashMessage("Not saved: " + err)
    root.followTop = false
    root.rebuildList()
    root.selectRow(function(r) { return r.rowId === "status" && r.value === id })
  }

  function movePaperStatusRow(delta) {
    const sel = root.selectedIndex >= 0 && root.selectedIndex < actionModel.count ? actionModel.get(root.selectedIndex) : null
    if (!sel || sel.rowId !== "pstatus") return
    const list = root.paperStatuses.slice()
    const i = list.indexOf(sel.value), j = i + delta
    if (i < 0 || j < 0 || j >= list.length) return
    list[i] = list[j]
    list[j] = sel.value
    const err = root.savePaperStatuses(list)
    if (err) return root.flashMessage("Not saved: " + err)
    root.followTop = false
    root.rebuildList()
    root.selectRow(function(r) { return r.rowId === "pstatus" && r.value === sel.value })
  }

  // Picking the paper a task is about (its page's Pick a paper…): back to the task.
  function pickTodoItem(row) {
    const item = { key: row.key, libraryID: row.libraryID, title: row.title, cite: root.citeFromRow(row) }
    root.back()
    root.setTodo({ item: item, context: null })
    root.flashMessage("About " + (item.cite || item.title))
  }

  // The paper's chats (newest first), your note order and a running extraction, for its menu.
  function actionExtras() {
    const it = root.actionItem
    if (!it || !root.service) return {}
    const lib = Number(it.libraryID) || 1
    const chats = (root.service.chats || []).filter(function(c) { return c.key === it.key && (Number(c.libraryID) || 1) === lib })
    const extracting = (root.service.tasks || []).some(function(t) { return t.kind === "extract" && t.status === "running" && t.key === it.key })
    const paper = root.details && root.details.item && root.details.item.itemType !== "note" && root.details.item.itemType !== "attachment"
    const artifacts = (root.service.artifacts || []).filter(function(a) { return a.key === it.key && (Number(a.libraryID) || 1) === lib })
    return { chats: chats, artifacts: artifacts, noteOrder: root.noteOrderFor(), extracting: extracting, paperStatus: paper ? Client.statusName(root.menuPaperStatus()) : undefined, statusTags: root.paperStatuses,
      cite: paper ? root.citeExtra() : null, defaultTask: paper ? root.defaultTaskExtra() : null,
      taxonomies: paper && root.taxonomyList.length ? root.taxonomyList : null, taxStatus: root.taxStatus,
      jev: !!(root.service.taxonomies && root.service.taxonomies.jev && root.service.taxonomies.jev.key && root.service.taxonomies.jev.key.set),
      classifying: !!root.service.classifying[lib + ":" + it.key] }
  }

  // The paper's default task for its menu's Task row: its status, the statuses in order, what a new one is called.
  function defaultTaskExtra() {
    const it = root.actionItemRef()
    if (!it || !root.service) return null
    const st = root.defaultTasks[it.libraryID + ":" + it.key]
    return { status: st ? st.name : "", statuses: root.todoStatuses.map(function(s) { return s.name }), description: Todos.defaultTaskDescription(Todos.defaultTemplateOf(root.service.settings), it) }
  }

  function noteOrderFor() {
    const it = root.actionItem
    return it && root.service ? root.service.noteOrder[(Number(it.libraryID) || 1) + ":" + it.key] || [] : []
  }

  // Which menu's section order applies here: each list view, and the results (before you type, or typed).
  function sectionKey() {
    if (root.inSearch) return "search:" + (root.collectionScope ? "scope" : root.filterText ? "typed" : "empty")
    return root.view
  }

  // Shift+Enter on one of a paper's chats: open, rename or delete it.
  function chatMenuRows() {
    const c = root.chatMenu || {}
    return [
      Views.listRow({ rowId: "chat-menu-open", icon: "\uf442", label: "Open", detail: "Continue it in its chat window", available: true, submenu: true }),
      Views.listRow({ rowId: "chat-menu-rename", icon: "\uf448", label: "Rename…", detail: c.title || "", available: true, submenu: true }),
      Views.listRow({ rowId: "chat-menu-delete", icon: "\uf48e", label: "Delete this chat", detail: "Its answers saved as notes stay in Zotero", available: true })
    ]
  }

  // The paper's extracted text, read in the note view (Enter on Text extracted, or its menu's Read it).
  function readExtracted() {
    const note = Views.fulltextNote(root.details)
    if (note) root.openNoteView({ key: note.key, libraryID: note.libraryID, title: note.title || "Extracted text" })
  }

  // Shift+Enter on Text extracted (or x there): read it, extract it again, open it in Zotero, delete it.
  function openExtractMenu() {
    if (!Views.fulltextNote(root.details)) return
    root.pushView("extract-menu")
    root.rebuildList()
  }

  // Shift+Enter on one of a paper's artifacts: its menu.
  function openArtifactMenu(row) {
    const a = (root.service.artifacts || []).find(function(x) { return x.id === row.value && x.key === row.itemKey && (Number(x.libraryID) || 1) === (Number(row.itemLibraryID) || 1) })
    if (!a) return
    root.artifactMenu = a
    root.pushView("artifact-menu")
    root.rebuildList()
  }

  // An artifact's view in the browser (the overlay closes so the browser takes focus).
  function openArtifactPath(path) {
    if (!path) return
    root.dismiss()
    root.service.openPath(path)
  }

  function openChatMenu(row) {
    root.chatMenu = { id: row.value, title: row.label }
    root.pushView("chat-menu")
    root.rebuildList()
  }

  // Shift+↑/↓ on a note in a paper's menu or its notes: moves it among the notes (kept per paper).
  function moveNote(delta) {
    const i = root.selectedIndex
    if (i < 0 || i >= actionModel.count) return
    const row = actionModel.get(i)
    const j = i + delta
    if (row.rowId !== "note" || j < 0 || j >= actionModel.count || actionModel.get(j).rowId !== "note") return
    const keys = []
    for (let n = 0; n < actionModel.count; n++) if (actionModel.get(n).rowId === "note") keys.push(actionModel.get(n).noteKey)
    const a = keys.indexOf(row.noteKey), b = keys.indexOf(actionModel.get(j).noteKey)
    keys[a] = actionModel.get(j).noteKey
    keys[b] = row.noteKey
    root.service.saveNoteOrder((Number(root.actionItem.libraryID) || 1) + ":" + root.actionItem.key, keys)
    const key = row.noteKey
    root.followTop = false
    root.rebuildList()
    root.selectRow(function(r) { return r.rowId === "note" && r.noteKey === key })
  }

  // ------------------------------------------------------------ a menu's own pins and order (Views.rowIdentity)

  readonly property var menuPinViews: ["actions"] // the menus where p pins a row and Shift+↑/↓ moves any row
  property var menuRows: [] // the menu's rows in your order, before the pins and the filter

  function rowAt(i) {
    return i >= 0 && i < actionModel.count ? actionModel.get(i) : null
  }

  // p in a paper's menu: the highlighted row pinned into Pinned on top (or out again).
  function toggleMenuPin() {
    const row = root.rowAt(root.selectedIndex)
    if (!row || !root.service) return
    const id = Views.rowIdentity(row)
    const pins = Views.toggleIdentity(root.service.menuPins[root.view], id)
    const pinned = pins.indexOf(id) >= 0
    const others = root.service.menuOther[root.view] || []
    if (pinned && others.indexOf(id) >= 0) root.service.saveMenuOther(root.view, Views.toggleIdentity(others, id)) // out of Other, into Pinned
    root.service.saveMenuPins(root.view, pins)
    root.followTop = false
    root.rebuildList()
    root.selectRow(function(r) { return Views.rowIdentity(r) === id && (r.section === "Pinned") === pinned })
    root.flashMessage(pinned ? "Pinned to the top of this menu (p again unpins it)" : "Unpinned")
  }

  // P in a paper's menu: the highlighted row out of the way, into Other at the bottom (of every paper's menu); P
  // again puts it back in its section. A pinned row leaves the pins.
  function toggleMenuOther() {
    const row = root.rowAt(root.selectedIndex)
    if (!row || !root.service) return
    const id = Views.rowIdentity(row)
    const others = Views.toggleIdentity(root.service.menuOther[root.view], id)
    const away = others.indexOf(id) >= 0
    if (away && row.section === "Pinned") root.service.saveMenuPins(root.view, Views.toggleIdentity(root.service.menuPins[root.view], id))
    root.service.saveMenuOther(root.view, others)
    root.followTop = false
    root.rebuildList()
    root.selectRow(function(r) { return Views.rowIdentity(r) === id })
    root.flashMessage(away ? "Moved to Other, at the bottom (P again puts it back)" : "Back in its section")
  }

  // Shift+↑/↓ in a paper's menu: the highlighted row moves within its section (a note: among the notes, kept per
  // paper; a pinned row: among the pins; any other: kept for every paper's menu).
  function moveMenuRow(delta) {
    const i = root.selectedIndex
    const row = root.rowAt(i), other = root.rowAt(i + delta)
    if (!row || !root.service) return
    if (!other || other.section !== row.section) return root.flashMessage("It's at the " + (delta < 0 ? "top" : "bottom") + " of " + (row.section || "the menu") + " (ctrl+⇧↑↓ moves the section)")
    if (row.rowId === "note" && other.rowId === "note" && row.section !== "Pinned") return root.moveNote(delta)
    const id = Views.rowIdentity(row), to = Views.rowIdentity(other)
    const section = row.section // the model's rows are gone once it's rebuilt
    if (section === "Pinned") {
      const pins = Views.moveIdentity(root.service.menuPins[root.view], id, to)
      if (pins) root.service.saveMenuPins(root.view, pins)
    } else if (section === "Other") {
      const others = Views.moveIdentity(root.service.menuOther[root.view], id, to)
      if (others) root.service.saveMenuOther(root.view, others)
    } else {
      const ids = root.menuRows.filter(function(r) { return r.section === section }).map(Views.rowIdentity)
      const next = Views.moveIdentity(ids, id, to)
      if (next) root.service.saveMenuOrder(root.view, section, next)
    }
    root.followTop = false
    root.rebuildList()
    root.selectRow(function(r) { return Views.rowIdentity(r) === id && r.section === section })
  }

  // Ctrl+Shift+↑/↓: moves the highlighted row's section (in every menu and the results; kept per menu).
  function moveSectionOf(delta) {
    if (!root.service) return
    const model = root.inSearch ? displayModel : actionModel
    const i = root.selectedIndex
    if (i < 0 || i >= model.count) return
    const rows = []
    for (let n = 0; n < model.count; n++) rows.push({ section: model.get(n).section })
    const cur = model.get(i)
    const names = Views.moveSection(rows, cur.section, delta)
    if (!names) return
    const id = root.inSearch ? { key: cur.key, kind: cur.kind } : { rowId: cur.rowId, value: cur.value, noteKey: cur.noteKey, label: cur.label }
    root.service.saveSectionOrder(root.sectionKey(), names)
    root.followTop = false
    if (root.inSearch) {
      root.rebuildSearch()
      for (let n = 0; n < displayModel.count; n++) if (displayModel.get(n).key === id.key && displayModel.get(n).kind === id.kind) { root.selectedIndex = n; resultList.positionViewAtIndex(n, ListView.Contain); break }
    } else {
      root.rebuildList()
      root.selectRow(function(r) { return r.rowId === id.rowId && r.value === id.value && r.noteKey === id.noteKey && r.label === id.label })
    }
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
      settings: s.settings, info: s.providersInfo, models: s.models, defaults: s.modelDefaults, rules: s.rules, instructions: s.instructions, tests: s.providerTests, open: "",
      runner: { installed: !s.runnerMissing && !/isn't installed/.test(String(s.promptsProblem || "")), installing: s.installing },
      styles: s.citationStyles, stylesProblem: s.citationStylesProblem,
      extract: { pending: s.extractPending, catchup: s.extractState.catchup, skipped: Object.keys(s.extractState.skipped || {}).length },
      taxonomies: s.taxonomies,
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
    else if (root.view === "settings-rules") rows = Settings.buildRules(st, L)
    else if (root.view === "settings-models") rows = Settings.buildModelPicker(st, root.settingsModelsPath, L, root.settingsModelsOnly)
    else if (root.view === "settings-choice") rows = Settings.buildChoice(st, root.settingsChoice, L)
    else if (root.view === "settings-styles") rows = Settings.buildStylePicker(st, L)
    else if (root.view === "settings-taxonomies") rows = Settings.buildTaxonomies(st, L)
    else if (root.view === "settings-tax-review") rows = Settings.buildTaxonomyReview(root.service.taxonomyReview, L)
    else if (root.view === "settings-taxonomy") rows = Settings.buildTaxonomy(root.taxEdit, L)
    else if (root.view === "settings-tax-label") rows = Settings.buildTaxonomyLabel(root.taxEdit, root.taxLabel, L)
    else if (root.view === "settings-tax-ai") rows = root.taxDraft ? Settings.buildTaxonomyDraft(root.taxDraft, L) : []
    else if (root.view === "settings-tasks") rows = Todos.buildStatusSettings(root.todoStatuses, root.service.todos, L).concat(Todos.buildActionSettings(root.service.taskActions, L), Todos.buildDefaultTaskSettings(root.service.settings, L))
    else if (root.view === "settings-paper-status") rows = Settings.buildPaperStatusSettings(root.paperStatuses, L).concat([L({ section: "In Zotero", rowId: "pstatus-migrate", icon: "\uf412",
      label: "Move the status tags to " + Client.PAPER_TAG_PREFIX + "…", detail: "Papers tagged “" + (root.paperStatuses[0] || "reading") + "” before the prefix get “" + Client.statusTag(root.paperStatuses[0] || "reading") + "”, and so on", available: root.paperStatuses.length > 0 })])
    else if (root.view === "settings-edit") return Settings.buildEditRows(root.settingsEdit, root.filterText, L)
    if (root.inForm) return rows // a form: typing goes to its fields, not a filter
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
  // Keys never tested (or not since they changed): each tested once per opening of Settings, so its row says
  // whether it works (the result is kept by the runner).
  property var autoTested: ({})
  function autoTestKeys() {
    if (!root.service || !root.opened || !root.inSettings) return
    const s = root.service
    const want = []
    if (s.providersInfo && s.providersInfo.providers) s.providersInfo.providers.forEach(function(p) { if (p.takesKey && p.key && p.key.set && (!p.test || p.test.stale)) want.push(p.id) })
    const jev = s.taxonomies && s.taxonomies.jev
    if (jev && jev.key && jev.key.set && (!jev.test || jev.test.stale)) want.push("jev")
    const done = Object.assign({}, root.autoTested)
    want.forEach(function(id) {
      if (done[id] || s.providerTests[id]) return
      done[id] = true
      s.testProvider(id)
    })
    root.autoTested = done
  }

  function openSettings(page) {
    if (!root.service) return
    root.autoTested = ({})
    root.pushView("settings")
    if (page) root.pushView("settings-" + page)
    root.rebuildList()
    root.service.refreshProviders()
    root.service.refreshRequirements()
    root.service.refreshModels()
    root.service.refreshSetup()
    root.service.refreshRules()
    root.service.refreshExtractCount()
    root.service.refreshTaxonomies()
    root.autoTestKeys()
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
    if (path === "defaults.autoExtractNew" && !on) {
      root.service.extractNewTurnedOn()
      root.flashMessage("On: a paper's text is extracted when its PDF arrives (the ones from before: Extract every paper's text)")
    }
    if (path === "defaults.autoTagNew" && !on) {
      root.service.tagNewTurnedOn()
      root.flashMessage("On: each new paper is tagged by the taxonomies once (the ones from before: type tag in a collection)")
    }
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
      item = path === "defaults.extractMaxMB" ? { key: path, label: "Skip PDFs larger than", type: "number", min: 1, max: 1000, help: "MB, 1 to 1000: larger PDFs are left out of automatic extraction" }
        : field === "baseURL" ? { key: path, label: "Base URL", type: "url", help: "e.g. http://localhost:11434/v1, or https://gateway.example.edu/v1" }
        : { key: path, label: "Context size", type: "context", help: "Tokens, e.g. 32768 or 32k; empty: the model's own" }
      const m = /^endpoint\.([^.]+)\.(.+)$/.exec(path)
      const ep = m ? (root.service.settings.endpoints || []).find(function(e) { return e.id === m[1] }) : null
      cur = m ? (ep ? ep[m[2]] : undefined) : Settings.getPath(root.service.settings, path)
    }
    const text = cur === undefined || cur === null ? "" : Array.isArray(cur) ? cur.join(" ") : String(cur)
    root.settingsEdit = { path: path, label: item.label, type: item.type, help: item.help || "", current: text, item: item,
      empty: item.type === "argv" || item.type === "context" || item.type === "path" ? "back to the default" : "" }
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
        root.openPromptEditor({ id: data.id, title: title, model: "", effort: "", output: "note", excerpt: "" })
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

  // "Write it with AI" in the name view: the default prompts model writes the prompt from the
  // description in the header; it opens in the editor when ready, if the view is still here.
  function draftPrompt(description) {
    if (!description || !root.service) return
    const started = root.service.draftPrompt(description, function(ok, data, error) {
      if (!ok) return root.flashMessage("Couldn't write the prompt: " + error)
      if (root.view !== "prompt-title" || root.promptTitleMode !== "create") return root.flashMessage("Wrote “" + data.title + "”: it's under Prompts")
      root.back()
      root.openPromptEditor({ id: data.id, title: data.title, model: "", effort: "", output: data.output || "note", excerpt: data.excerpt || "" })
      root.flashMessage("Wrote “" + data.title + "” with " + data.model + ": review its text (Prompt text) before you run it")
    })
    root.flashMessage(started ? "Writing the prompt with AI…" : "A prompt is already being written")
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
    const notes = Views.ownNotes(root.details)
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
    root.pushView("note")
    root.loadNote(note)
  }

  // The note shown in the note view (opened, or Shift+↑/↓ to another of its paper's).
  function loadNote(note) {
    root.lastCopied = ""
    root.noteTarget = { key: note.key, libraryID: note.libraryID, title: note.title || "Untitled note" }
    root.noteError = ""
    noteFlick.contentY = 0
    const cached = root.noteCache[note.key]
    if (cached) {
      root.noteData = cached
      root.loadNoteSiblings(cached.parent)
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
        root.loadNoteSiblings(res.data.parent)
      } else {
        root.noteError = res.message || res.kind
      }
    })
  }

  // The notes of the paper the note belongs to, in your order, listed above it (none for a
  // standalone note).
  property var noteSiblings: []
  property string noteSiblingsOf: "" // "libraryID:key" of that paper

  function loadNoteSiblings(parent) {
    if (!parent || !root.service) { root.noteSiblings = []; root.noteSiblingsOf = ""; return }
    const id = (Number(parent.libraryID) || 1) + ":" + parent.key
    if (id === root.noteSiblingsOf && root.noteSiblings.length) return
    root.noteSiblingsOf = id
    root.noteSiblings = []
    root.service.itemDetails({ key: parent.key, libraryID: parent.libraryID }, function(res) {
      if (res.kind !== "ok" || root.noteSiblingsOf !== id) return
      root.noteSiblings = Views.orderNotes(Views.ownNotes(res.data), root.service.noteOrder[id] || [])
      // Opened from the results (not its paper's menu): this paper becomes the one in view, so the
      // header shows its status pills and rankings, and its keys (Alt+→/←, t) act on it.
      const it = root.actionItem
      if (!it || (Number(it.libraryID) || 1) + ":" + it.key !== id) {
        const info = res.data.item || {}
        root.actionItem = { key: parent.key, libraryID: Number(parent.libraryID) || 1, title: info.title || parent.title || "", itemType: info.itemType || "" }
        root.details = res.data
        root.detailsAt = new Date().toISOString()
      }
    })
  }

  readonly property int noteIndex: {
    const t = root.noteTarget
    if (!t) return -1
    for (let i = 0; i < root.noteSiblings.length; i++) if (root.noteSiblings[i].key === t.key) return i
    return -1
  }

  // Text selected in the note view: copied, said in the footer (once per selection).
  property string lastCopied: ""
  function copySelection(text) {
    const t = String(text || "").replace(/\u2029/g, "\n").trim()
    if (!t || t === root.lastCopied || !root.service) return
    root.lastCopied = t
    root.service.copyText(t)
    const words = t.split(/\s+/).length
    root.flashMessage("Copied " + (words === 1 ? "a word" : words + " words"))
  }

  // Shift+↑/↓ in the note view: the paper's previous or next note, round and round.
  function cycleNote(delta) {
    const n = root.noteSiblings.length
    if (n < 2) return root.flashMessage(n ? "The paper's only note" : "No other notes")
    const i = root.noteIndex < 0 ? 0 : root.noteIndex
    root.loadNote(root.noteSiblings[((i + delta) % n + n) % n])
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
    const w = noteWindowComponent.createObject(root, { service: root.service, note: target, pillColors: Qt.binding(function() { return root.pillColors }) })
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
      pillColors: Qt.binding(function() { return root.pillColors }),
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

  // Go to › Extract every paper's text (in a collection, a tag or a saved search: its papers'): the catch-up,
  // a few at a time in the background; Settings › Defaults shows how many are left and stops it.
  function extractAllHere() {
    if (!root.service) return
    if (root.needsSetup() && root.service.runnerMissing) return root.flashMessage("Install the AI features first (Settings › Setup): they extract the text")
    const sc = root.searchScope()
    const scope = !sc ? null : sc.type === "search" ? { within: { query: sc.query } } : sc.type === "tag" ? { tag: { name: sc.key, libraryID: sc.libraryID } } : { collection: { key: sc.key, libraryID: sc.libraryID } }
    root.service.startExtractAll(scope, sc ? "“" + sc.title + "”" : "")
    root.flashMessage("Extracting the text of " + (sc ? "“" + sc.title + "”'s papers" : "every paper") + " with a PDF, a few at a time: it's in Processes (" + root.keyName(".") + ")")
  }

  // Go to › Tag the papers by taxonomies (in a collection, a tag or a saved search): asks first, with how many.
  function classifyAllHere() {
    if (!root.service) return
    if (root.service.runnerMissing) return root.flashMessage("Install the AI features first (Settings › Setup): they tag the papers")
    const sc = root.searchScope()
    if (!sc) return
    const scope = sc.type === "search" ? { within: { query: sc.query } } : sc.type === "tag" ? { tag: { name: sc.key, libraryID: sc.libraryID } } : { collection: { key: sc.key, libraryID: sc.libraryID } }
    root.flashMessage("Counting “" + sc.title + "”'s papers…")
    root.service.papersIn(scope, function(data, error) {
      if (!data) return root.flashMessage("Couldn't list the papers: " + error)
      const items = data.items || []
      if (!items.length) return root.flashMessage("No papers in “" + sc.title + "”")
      const tx = root.service.taxonomies
      const jev = !!(tx && tx.jev && tx.jev.key && tx.jev.key.set)
      root.flash = ""
      root.askConfirm({ title: "Tag " + items.length + (items.length === 1 ? " paper" : " papers") + " by taxonomies?", yes: "Tag them", no: "Not now",
        detail: (data.total > items.length ? "The first " + items.length + " of “" + sc.title + "”'s · " : "") + (jev ? "Jev: a few cents for thousands of papers" : "Your prompts model: one request per paper, at its price")
          + " · the unsure labels wait in Settings › Taxonomies › Review",
        run: function() {
          root.service.classify(items, function(results) {
            const tagged = results.filter(function(r) { return r.status === "tagged" }).length
            const failed = results.filter(function(r) { return r.status === "failed" }).length
            root.flashMessage("Tagged " + tagged + " of " + results.length + " by taxonomies" + (failed ? " (" + failed + " failed: see Processes)" : ""))
          })
          root.flashMessage("Tagging " + items.length + " papers by taxonomies: it's in Processes (" + root.keyName(".") + ")")
        } })
    })
  }

  // Settings › Taxonomies › Review: Enter tags the paper with the label, Delete dismisses it.
  function decideSuggestion(row, accept) {
    const s = (root.service.taxonomyReview || [])[Number(row.value)]
    if (!s) return
    root.service.decideSuggestion(s, accept, function(ok, error) {
      root.flashMessage(!ok ? "Not saved: " + error : accept ? "Tagged " + s.prefix + s.label : "Dismissed")
    })
  }

  // Go to › Sync Zotero, or S: Zotero's own sync, in the background; its progress in Processes.
  function syncZotero() {
    if (!root.service) return
    const info = root.service.syncInfo
    if (info && !info.configured) return root.flashMessage("Zotero sync isn't set up: sign in under Zotero › Settings › Sync")
    root.service.startSync(function(ok, error) {
      if (!ok) return root.flashMessage("Couldn't start the sync: " + error)
      root.flashMessage((error === "already running" ? "Zotero is already syncing" : "Syncing Zotero") + ": it's in Processes (" + root.keyName(".") + ")")
    })
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

  // ------------------------------------------------------------ asking first

  // A change to many papers asks first: { title, yes, no, detail (filled in when the count comes),
  // run(), cancel() }. Enter on the first row does it; the second (or Esc) leaves things be.
  property var confirmAsk: null

  function askConfirm(ask) {
    root.confirmAsk = ask
    root.pushView("confirm")
    root.searchFocus = false
    root.rebuildList()
  }

  function confirmRows() {
    const a = root.confirmAsk || {}
    return [
      Views.listRow({ rowId: "confirm-yes", icon: "\uf49e", label: a.yes || "Yes", detail: a.detail || "", available: true }),
      Views.listRow({ rowId: "confirm-no", icon: "\uf467", label: a.no || "No", detail: a.noDetail || "", available: true })
    ]
  }

  // How many papers carry a tag, into the open question's detail: "On 14 papers".
  function countIntoConfirm(tags, say) {
    if (!root.service) return
    let total = 0, left = tags.length
    tags.forEach(function(t) {
      root.service.tagCount(t, function(res) {
        if (res.kind === "ok") total += res.data.count
        if (--left > 0 || !root.confirmAsk || root.view !== "confirm") return
        root.confirmAsk = Object.assign({}, root.confirmAsk, { detail: say(total) })
        root.rebuildList()
      })
    })
  }

  // ------------------------------------------------------------ a tag across the library

  // Rename or delete a tag on every paper that has it (Zotero's own rename merges into an existing
  // tag). done(count) after; the search is redone, so rows and statuses show it.
  function renameTagEverywhere(from, to, done) {
    if (!root.service) return
    root.service.tagRename(from, to, function(res) {
      if (res.kind !== "ok") return root.flashMessage("Couldn't rename “" + from + "”: " + (res.message || res.kind))
      root.tagListCache = ({})
      root.libraryChanged = true
      root.flashMessage("Renamed on " + res.data.count + (res.data.count === 1 ? " paper" : " papers") + ": " + from + " → " + to + (res.data.left ? " (" + res.data.left + " still had it: try again)" : ""))
      if (done) done(res.data.count)
    })
  }

  function deleteTagEverywhere(name, done) {
    if (!root.service) return
    root.service.tagDelete(name, function(res) {
      if (res.kind !== "ok") return root.flashMessage("Couldn't delete “" + name + "”: " + (res.message || res.kind))
      root.tagListCache = ({})
      root.libraryChanged = true
      root.flashMessage("Deleted “" + name + "” from " + res.data.count + (res.data.count === 1 ? " paper" : " papers") + (res.data.left ? " (" + res.data.left + " still have it: try again)" : ""))
      if (done) done(res.data.count)
    })
  }

  // The tag editor's tag (Shift+Enter): rename or delete it on every paper.
  property string tagMenuName: ""

  function openTagMenu(name) {
    root.tagMenuName = name
    root.pushView("tag-menu")
    root.rebuildList()
  }

  function tagMenuRows() {
    const n = root.tagMenuName
    return [
      Views.listRow({ rowId: "tag-rename", icon: "\uf448", label: "Rename…", detail: "On every paper that has “" + n + "” (into an existing tag: merged)", available: true, submenu: true }),
      Views.listRow({ rowId: "tag-to-paper", icon: "\uf412", label: "Make it a paper status…", detail: "A new one (s/" + n + "), or merged into one of yours; renamed on every paper", available: true, submenu: true }),
      Views.listRow({ rowId: "tag-to-task", icon: Todos.ICON.task, label: "Make it a task status…", detail: "Each paper with it gets its default task in that status; the tag becomes t/…", available: true, submenu: true }),
      Views.listRow({ rowId: "tag-delete", icon: "\uf48e", label: "Delete from every paper", detail: "Take “" + n + "” off every paper in your library", available: true })
    ]
  }

  // A tag turned into a status (the tag menu's Make it a … status): kind "paper" or "task"; target: ""
  // for a new status named after it, else the paper status's name or the task status's id to merge into.
  property string tagStatusKind: ""

  function convertTag(kind, tag, target) {
    const paper = kind === "paper"
    const name = paper ? (target || tag) : (target ? (Todos.statusById(root.todoStatuses, target) || { name: tag }).name : tag)
    const into = (paper ? Client.PAPER_TAG_PREFIX : Todos.TASK_TAG_PREFIX) + name
    root.back()
    root.back()
    root.askConfirm({ title: "“" + tag + "” → " + into + "?", yes: target ? "Merge it into “" + name + "”" : "Make it the " + (paper ? "paper" : "task") + " status “" + name + "”", no: "Cancel",
      detail: "Counting the papers…", run: function() {
        if (paper) {
          if (!target) {
            const err = root.savePaperStatuses(root.paperStatuses.concat([tag]))
            if (err) return root.flashMessage("Not saved: " + err)
          }
          return root.renameTagEverywhere(tag, into, function() { root.reloadTagEditor(tag, into); root.requestSearch() })
        }
        let statusId = target
        if (!target) {
          const r = Todos.addStatus(root.todoStatuses, tag, "backlog")
          if (r.error) return root.flashMessage(r.error)
          const err = root.service.saveStatuses(r.statuses)
          if (err) return root.flashMessage("Not saved: " + err)
          statusId = r.status.id
        }
        // each paper with the tag: its default task in that status (its t/ tag follows), then the tag renamed
        root.service.tagItems(tag, function(res) {
          if (res.kind !== "ok") return root.flashMessage("Couldn't list its papers: " + (res.message || res.kind))
          root.service.setDefaultTasks(res.data.items.map(function(it) {
            return { item: { key: it.key, libraryID: it.libraryID, title: it.title, cite: it.creator && it.year ? it.creator + " (" + it.year + ")" : "" }, status: statusId }
          }))
          root.renameTagEverywhere(tag, into, function() { root.reloadTagEditor(tag, into); root.requestSearch() })
        })
      } })
    root.countIntoConfirm([tag], function(n) {
      return "On " + n + (n === 1 ? " paper" : " papers") + (paper ? "" : ": each gets its default task in " + name + " (made where it has none)") + "; renamed in Zotero"
    })
  }

  // After a rename or delete in the tag editor: the library's tags again, and this paper's.
  function reloadTagEditor(from, to) {
    if (!root.tagState || !root.service) return
    const it = Object.assign({}, root.tagState.itemTags || {})
    if (it[from]) { delete it[from]; if (to) it[to] = true }
    root.tagState = Object.assign({}, root.tagState, { itemTags: it, loading: true })
    const lib = root.tagState.libraryID
    root.service.tagList(lib, function(res) {
      if (res.kind === "ok" && root.tagState) {
        root.tagListCache[lib] = res.data.tags
        root.tagState = Object.assign({}, root.tagState, { tags: res.data.tags, loading: false })
      }
      if (root.view === "tags") root.rebuildList()
    })
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
    // a unique taxonomy's label (ontology, epistemology, paper type): it takes the place of the paper's other one
    const clash = adding ? Views.uniqueLabelClash(name, Object.keys(st.itemTags), root.taxonomyList) : null
    const off = clash ? clash.others : []
    const itemTags = Object.assign({}, st.itemTags)
    const tags = st.tags.slice()
    if (adding) itemTags[name] = 0
    else delete itemTags[name]
    off.forEach(function(o) { delete itemTags[o] })
    const count = function(tagName, delta) {
      const k = tags.findIndex(function(t) { return t.tag === tagName })
      if (k >= 0) tags[k] = Object.assign({}, tags[k], { count: Math.max(0, (tags[k].count || 0) + delta) })
      else if (delta > 0) tags.push({ tag: tagName, types: [0], count: 1, color: null, position: null })
    }
    count(name, adding ? 1 : -1)
    off.forEach(function(o) { count(o, -1) })
    root.tagState = Object.assign({}, st, { itemTags: itemTags, tags: tags })
    root.tagListCache[st.libraryID] = tags
    root.libraryChanged = true
    root.lastError = ""
    root.tagPending++
    const item = root.actionItem
    root.service.updateTags(item, adding ? [name] : [], adding ? off : [name], function(res) {
      root.tagPending--
      const here = root.opened && root.actionItem === item
      if (res.kind === "ok") {
        if (here && root.details) root.details = Object.assign({}, root.details, { tags: res.data.tags, tagCount: res.data.tags.length })
        if (here && root.tagPending === 0 && root.view === "tags") {
          root.tagState = Object.assign({}, root.tagState, { itemTags: Views.tagMap(res.data.tags) })
          root.refreshTagRows()
        }
        if (here) root.flashMessage((adding ? "Added “" : "Removed “") + name + "”" + (off.length ? " (" + clash.taxonomy.name + " takes one label: removed " + off.join(", ") + ")" : ""))
      } else if (here) {
        if (root.view === "tags") {
          const cur = Object.assign({}, root.tagState.itemTags)
          if (adding) delete cur[name]
          else cur[name] = st.itemTags[name]
          off.forEach(function(o) { cur[o] = st.itemTags[o] })
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
    // Dead keys (US intl. and the like: " ' ^ ~ ` wait for a letter to accent) type themselves here: the
    // launcher reads keys, not composed text, so they would otherwise type nothing.
    const dead = root.deadKeyText(event.key)
    if (dead) event = { key: dead.key, modifiers: event.modifiers, text: dead.text }
    const k = event.key
    const mods = event.modifiers
    const ctrl = (mods & Qt.ControlModifier) !== 0
    const alt = (mods & Qt.AltModifier) !== 0
    const shift = (mods & Qt.ShiftModifier) !== 0
    const enter = k === Qt.Key_Return || k === Qt.Key_Enter
    // Esc: close an open dropdown, else clear the filter, else go back a level; it only
    // closes the launcher from the results.
    // Shift+Esc: straight back to the results (the top level) from anywhere; there, it closes.
    if (k === Qt.Key_Escape && shift) {
      root.keyBuffer = ""
      keyTimer.stop()
      if (root.atRoot && !root.inNote) root.dismiss()
      else root.goHome()
      return true
    }
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
    // F1: the keys for where you are, from anywhere (while typing too, and reading a note)
    if (k === Qt.Key_F1) {
      root.keyBuffer = ""
      keyTimer.stop()
      root.openKeys()
      return true
    }
    if (root.inNote) return root.handleNoteKey(k, ctrl, shift, alt)
    const printable = !!event.text && event.text.length === 1 && event.text.charCodeAt(0) >= 32 && event.text.charCodeAt(0) !== 127
      && (mods === Qt.NoModifier || mods === Qt.ShiftModifier)
    const listKeys = root.singleKeys && !root.typingNow
    // A key waiting to be told from typing acts before anything else that isn't another key.
    if (root.keyBuffer && !(listKeys && printable)) root.flushKeys()
    if (k === Qt.Key_Delete && !ctrl && !alt && root.tabTodoId()) { root.todoKey("delete"); return true }
    if (k === Qt.Key_Delete && !ctrl && !alt && root.view === "settings-tax-review" && !root.filterText) {
      const cur = root.selectedIndex >= 0 && root.selectedIndex < actionModel.count ? actionModel.get(root.selectedIndex) : null
      if (cur && cur.rowId === "tax-suggestion") root.decideSuggestion(cur, false)
      return true
    }
    // A task's page: Tab / Shift+Tab change the status or the priority, on their row only.
    if ((k === Qt.Key_Tab || k === Qt.Key_Backtab) && !ctrl && !alt && root.view === "todo-edit") {
      const cur = root.selectedIndex >= 0 && root.selectedIndex < actionModel.count ? actionModel.get(root.selectedIndex) : null
      const dir = k === Qt.Key_Backtab || shift ? -1 : 1
      if (cur && cur.rowId === "todo-status") root.cycleTodo(root.todoId, dir)
      else if (cur && cur.rowId === "todo-priority") root.cycleTodoPriority(dir)
      return true
    }
    // A taxonomy's page: Tab / Shift+Tab change its kind (one label per paper, or several), on its row.
    if ((k === Qt.Key_Tab || k === Qt.Key_Backtab) && !ctrl && !alt && root.view === "settings-taxonomy") {
      const cur = root.rowAt(root.selectedIndex)
      if (cur && (cur.rowId === "tax-kind" || cur.rowId === "tax-show")) root.activateAction(root.selectedIndex)
      return true
    }
    // The due date's calendar: arrows move the day, PgUp / PgDn the month, Home today, Delete no date.
    if (root.view === "todo-due" && !ctrl && !alt && root.calendarKey(k, enter)) return true
    // Tab / Shift+Tab on a task (the Tasks view, a paper's Tasks): its next or previous status.
    if ((k === Qt.Key_Tab || k === Qt.Key_Backtab) && !ctrl && !alt && root.tabTodoId()) { root.cycleTodo(root.tabTodoId(), k === Qt.Key_Backtab || shift ? -1 : 1); return true }
    // Tab / Shift+Tab in the results, with pinned searches: the next or previous search badge.
    if ((k === Qt.Key_Tab || k === Qt.Key_Backtab) && !ctrl && !alt && root.atRoot && root.pinnedSearches.length) {
      root.cycleSearch(k === Qt.Key_Backtab || shift ? -1 : 1)
      return true
    }
    // Shift+Alt+→ / Shift+Alt+← on a paper: its default task's next or previous status (the first press makes it).
    if ((k === Qt.Key_Right || k === Qt.Key_Left) && alt && shift && !ctrl && root.taskTarget() && root.cycleDefaultTask(k === Qt.Key_Left ? -1 : 1)) return true
    // Alt+→ / Alt+← on a paper (a result, or its menu): its next or previous status.
    if ((k === Qt.Key_Right || k === Qt.Key_Left) && alt && !shift && !ctrl && root.statusTarget() && root.cyclePaperStatus(k === Qt.Key_Left ? -1 : 1)) return true
    // The same keys mean the same thing in every view (README: Keys).
    if (enter && shift) {
      const sel = !root.inSearch && root.selectedIndex >= 0 && root.selectedIndex < actionModel.count ? actionModel.get(root.selectedIndex) : null
      if (sel && sel.rowId === "chat-session") root.openChatMenu(sel)
      else if (sel && sel.rowId === "artifact") root.openArtifactMenu(sel)
      else if (sel && sel.rowId === "extract" && sel.noteKey) root.openExtractMenu()
      else if (root.view === "todo-new") root.saveNewTodo(root.filterText.trim(), false)
      else if (sel && sel.rowId === "todo-quick") root.addQuickHere(sel.value, false)
      else if (sel && sel.rowId === "search") root.openSearchMenu(sel)
      else if (sel && sel.rowId === "tag" && root.view === "tags") root.openTagMenu(sel.tag)
      else root.openInZotero()
      return true
    }
    // Alt+Backspace: clear the search box (and give it the keys).
    if (alt && !ctrl && k === Qt.Key_Backspace) {
      if (root.filterText) root.setFilter("")
      if (!root.textEntry) root.searchFocus = true
      return true
    }
    if (alt && !ctrl && k >= Qt.Key_1 && k <= Qt.Key_9) { root.pickNumber(k - Qt.Key_0); return true }
    if (alt && !ctrl && k > 0 && k < 128 && root.keyAction(String.fromCharCode(k).toLowerCase())) return true
    if ((root.view === "settings-edit" || root.textEntry) && ctrl && k === Qt.Key_V) {
      const v = root.view
      if (root.service) root.service.paste(function(text) { if (text && root.view === v) root.setFilter(root.filterText + text) })
      return true
    }
    if (root.view === "tags" && ctrl && enter) {
      root.toggleTag(root.filterText, true)
      return true
    }
    // Saved searches: Ctrl+S saves what the results show; @ picks something to add to the search.
    if (root.inSearch && ctrl && !alt && !shift && k === Qt.Key_S) { root.saveSearchPrompt(); return true }
    if (root.inSearch && event.text === "@" && !ctrl && !alt) { root.openPicker(); return true }
    // A new task's line: @ adds a block (an action, the citation, a status, a due date, a priority).
    if (root.view === "todo-new" && event.text === "@" && !ctrl && !alt) { root.openTaskTags(); return true }
    // The list has the keys: one key acts (after keyDelay); / or Tab gives them back to the search box.
    if (listKeys && printable) { root.queueKey(event.text); return true }
    if (root.queryTyped && root.typingNow && root.editSearchKey(event, ctrl, alt)) return true
    if (root.singleKeys && k === Qt.Key_Tab && !shift) { if (!root.textEntry) root.searchFocus = true; return true }
    // The editor's rows are fixed: typing doesn't filter them.
    if (root.view === "prompt-edit" && event.text && !ctrl && !alt && !enter && k !== Qt.Key_Backspace && k !== Qt.Key_Tab && k !== Qt.Key_Backtab) return true
    if (Util.editsFilter(event, root.filterText)) {
      root.setFilter(Util.editedFilter(event, root.filterText))
      return true
    }
    // ← on a note shown under its paper: hide them.
    if (k === Qt.Key_Left && !alt && !ctrl && root.inSearch && !root.typingNow && root.selectedIndex >= 0 && root.selectedIndex < displayModel.count
        && displayModel.get(root.selectedIndex).kind === "note-child") { root.toggleNotes(); return true }
    if (!root.atRoot && (((k === Qt.Key_Backspace || k === Qt.Key_Left) && !root.filterText) || k === Qt.Key_Backtab || (k === Qt.Key_Tab && shift))) {
      root.back()
      return true
    }
    if (shift && ctrl && !alt && (k === Qt.Key_Up || k === Qt.Key_Down)) { root.moveSectionOf(k === Qt.Key_Up ? -1 : 1); return true }
    if (shift && !ctrl && !alt && (k === Qt.Key_Up || k === Qt.Key_Down) && root.view === "todos") { root.moveTodoRow(k === Qt.Key_Up ? -1 : 1); return true }
    if (shift && !ctrl && !alt && (k === Qt.Key_Up || k === Qt.Key_Down) && root.view === "settings-tasks") { root.moveStatusRow(k === Qt.Key_Up ? -1 : 1); return true }
    if (shift && !ctrl && !alt && (k === Qt.Key_Up || k === Qt.Key_Down) && root.view === "settings-paper-status") { root.movePaperStatusRow(k === Qt.Key_Up ? -1 : 1); return true }
    if (shift && !ctrl && !alt && (k === Qt.Key_Up || k === Qt.Key_Down) && root.view === "settings-taxonomy") { root.moveTaxonomyLabel(k === Qt.Key_Up ? -1 : 1); return true }
    if (shift && !ctrl && !alt && (k === Qt.Key_Up || k === Qt.Key_Down) && root.inSearch) { root.movePinned(k === Qt.Key_Up ? -1 : 1); return true }
    if (shift && !ctrl && !alt && (k === Qt.Key_Up || k === Qt.Key_Down) && root.menuPinViews.indexOf(root.view) >= 0) { root.moveMenuRow(k === Qt.Key_Up ? -1 : 1); return true }
    if (shift && !ctrl && !alt && (k === Qt.Key_Up || k === Qt.Key_Down) && root.view === "notes") { root.moveNote(k === Qt.Key_Up ? -1 : 1); return true }
    if (shift && !ctrl && !alt && (k === Qt.Key_Up || k === Qt.Key_Down) && root.view === "searches") { root.moveSearchRow(k === Qt.Key_Up ? -1 : 1); return true }
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
    // Alt+→ / Alt+←: the paper's status; Shift+Alt+→ / ←: its default task (the header's pills move at once)
    if (alt && !ctrl && (k === Qt.Key_Right || k === Qt.Key_Left)) {
      const delta = k === Qt.Key_Left ? -1 : 1
      if (!(shift ? root.cycleDefaultTask(delta) : root.cyclePaperStatus(delta))) root.flashMessage("This note isn't on a paper")
      return true
    }
    // Ctrl+- / Ctrl++ the text size (kept for the next notes, here and in note windows), Ctrl+0 the theme's
    if (ctrl && (k === Qt.Key_Minus || k === Qt.Key_Plus || k === Qt.Key_Equal || k === Qt.Key_0)) {
      if (root.service) root.flashMessage("Text " + root.service.stepNoteFont(k === Qt.Key_Minus ? -1 : k === Qt.Key_0 ? 0 : 1) + " px")
      return true
    }
    if (k === Qt.Key_Question) root.openKeys()
    else if (shift && (k === Qt.Key_Up || k === Qt.Key_Down)) root.cycleNote(k === Qt.Key_Up ? -1 : 1)
    else if (k === Qt.Key_Backspace || k === Qt.Key_Left || k === Qt.Key_H || k === Qt.Key_Backtab || (k === Qt.Key_Tab && shift)) root.back()
    else if (k === Qt.Key_Y) root.exportNote("copy")
    else if (k === Qt.Key_S) root.exportNote("save")
    else if (k === Qt.Key_C) root.chatKey()
    else if (k === Qt.Key_Period) root.openTasks()
    else if (k === Qt.Key_T || k === Qt.Key_A) root.addTodoKey() // a task about this note
    else if (k === Qt.Key_Semicolon) root.openSettings("")
    else if (k === Qt.Key_I || k === Qt.Key_R) root.copyCite(k === Qt.Key_I ? "citation" : "bibliography") // its paper's
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
      if (root.status === "zotero-down") return { icon: "", title: "Zotero isn't running", detail: "Press Enter to start it" }
      if (root.status === "bridge-missing") return { icon: "", title: "The Zotero bridge isn't installed", detail: "Install zotero-bridge in Zotero (see the plugin's README)" }
      if (root.status === "unauthorized") return { icon: "", title: "Zotero rejected the bridge token", detail: "Restart Zotero to refresh it" }
      if (root.lastError) return { icon: "", title: "Search failed", detail: root.lastError }
      if (root.loading || root.status === "unknown") return { icon: "", title: "Searching…", detail: "" }
      if (root.filterText) return { icon: "󰈉", title: "No matches for “" + root.filterText + "”", detail: "Tip: @ adds a filter · a:author  #tag  c:collection  y:2019..2021  \"exact\"  AND OR NOT ( )" }
      if (root.searchScope()) return { icon: "󰈉", title: "No papers match this search", detail: root.searchScope().type === "search" ? root.searchScope().query : "" }
      return { icon: "", title: "Nothing open in Zotero", detail: "Type to search your library" }
    }
    if (root.inNote) {
      if (root.noteError) return { icon: "", title: "Couldn't load the note", detail: root.noteError }
      if (!root.noteData) return { icon: "", title: "Loading the note…", detail: "" }
      return { icon: "", title: "This note is empty", detail: "Press Enter to open it in Zotero" }
    }
    if (root.view === "tags") {
      if (root.tagState && root.tagState.loading) return { icon: "", title: "Loading tags…", detail: "" }
      return { icon: Views.TAG_ICON, title: "No tags in this library yet", detail: "Type a name and press Enter to add it" }
    }
    if (root.view === "picker-values") {
      if (root.facetLoading && !actionModel.count) return { icon: "", title: "Loading…", detail: "" }
      if (root.lastError) return { icon: "", title: "Couldn't list them", detail: root.lastError }
      if (!root.filterText) return { icon: "", title: "None in your library", detail: "" }
    }
    if (root.details === null && root.lastError) return { icon:"", title: "Couldn't load the item", detail: root.lastError }
    if (root.filterText) return { icon: "󰈉", title: "No matches for “" + root.filterText + "”", detail: "" }
    return { icon: "", title: "Loading…", detail: "" }
  }

  // The paper whose menu this is, as "Sirmon et al., 2007 · Managing Firm Resources…".
  function paperLabel() {
    if (!root.actionItem) return ""
    const p = root.details && root.details.paper
    const cite = p ? [p.authors, p.year].filter(function(x) { return x }).join(", ") : ""
    const title = (p && p.title) || root.actionItem.title || ""
    return cite ? cite + " · " + title : title
  }

  function placeholder() {
    const title = root.paperLabel()
    if (root.view === "actions") return "‹ " + title
    if (root.view === "files") return "‹ Choose a file"
    if (root.view === "notes") return "‹ Notes · " + title
    if (root.view === "chat-menu") return "‹ " + (root.chatMenu ? root.chatMenu.title : "Chat")
    if (root.view === "extract-menu") return "‹ Extracted text · " + title
    if (root.view === "artifact-menu") return "‹ " + (root.artifactMenu ? root.artifactMenu.title + " · " + root.artifactMenu.formatLabel : "Artifact")
    if (root.view === "artifact-change") return "‹ Change “" + (root.artifactMenu ? root.artifactMenu.title : "") + "” · type what to change"
    if (root.view === "artifact-rename") return "‹ Rename the artifact"
    if (root.view === "prompt-output") return "‹ What “" + (root.promptEdit ? root.promptEdit.title : "") + "” makes"
    if (root.view === "todos") return "‹ Tasks · type one to add it (#status !priority @due), or to find one"
    if (root.view === "todo-edit") { const t = root.currentTodo(); return "‹ Task · " + (t ? t.description : "") }
    if (root.view === "todo-new") return "‹ New task · type what to do"
    if (root.view === "todo-text") return "‹ " + ({ description: "Description", due: "Due date", notes: "Notes" }[root.todoField] || "") + " · type it"
    if (root.view === "todo-due") return "‹ Due · pick a day, or type one: fri, tomorrow, +3d, 2026-10-03"
    if (root.view === "keys") return "‹ Keybindings · type to find one"
    if (root.view === "tax-audit") return "‹ Audit the taxonomies · " + root.paperLabel()
    if (root.view === "tax-paper") return "‹ Taxonomies · " + root.paperLabel()
    if (root.view === "confirm") return "‹ " + (root.confirmAsk ? root.confirmAsk.title : "Sure?")
    if (root.view === "tag-menu") return "‹ Tag · " + root.tagMenuName
    if (root.view === "tag-status") return "‹ “" + root.tagMenuName + "” into a " + (root.tagStatusKind === "paper" ? "paper" : "task") + " status"
    if (root.view === "tag-name") return "‹ Rename the tag “" + root.tagMenuName + "”"
    if (root.view === "todo-tags") return "‹ Add to the task · type to find"
    if (root.view === "todo-status") return "‹ Status"
    if (root.view === "todo-priority") return "‹ Priority"
    if (root.view === "settings-tasks") return "‹ Settings › Tasks · statuses and actions"
    if (root.view === "settings-paper-status") return "‹ Settings › Paper status"
    if (root.view === "status-menu") return (root.statusEdit && root.statusEdit.kind === "action" ? "‹ Action · " : "‹ Status · ") + (root.statusEdit ? root.statusEdit.name : "")
    if (root.view === "status-name" && root.statusEdit && root.statusEdit.kind === "action") return root.statusEdit.mode === "add" ? "‹ New action" : "‹ Rename the action"
    if (root.view === "status-name") return root.statusEdit && root.statusEdit.mode === "add" ? "‹ New status in " + Todos.groupName(root.statusEdit.group) : "‹ Rename the status"
    if (root.view === "chat-rename") return "‹ Rename the chat"
    if (root.view === "note") return "‹ " + (root.noteParts.title || (root.noteTarget ? root.noteTarget.title : "Note"))
    if (root.view === "tags") return root.tagState && !root.tagState.editable ? "‹ Tags · read-only library" : "‹ Tags · type to find or create one"
    if (root.view === "prompts") return "‹ Prompts · " + title
    if (root.view === "prompt-edit") return "‹ Edit prompt · " + (root.promptEdit ? root.promptEdit.title : "")
    if (root.view === "prompt-title") return root.promptTitleMode === "create" ? "‹ New prompt · type its name, or what it should do" : "‹ Rename the prompt"
    if (root.view === "settings") return "‹ Settings"
    if (root.view === "settings-general") return "‹ Settings › General"
    if (root.view === "settings-styles") return "‹ Settings › General › Citation style · type to find one"
    if (root.view === "settings-providers") return "‹ Settings › Models & providers"
    if (root.view === "settings-provider") {
      const p = Settings.providerInfo(root.settingsState(), root.settingsProvider)
      return "‹ Models & providers › " + (p ? p.name : root.settingsProvider)
    }
    if (root.view === "settings-defaults") return "‹ Settings › Defaults"
    if (root.view === "settings-taxonomies") return "‹ Settings › Taxonomies"
    if (root.view === "settings-tax-review") return "‹ Settings › Taxonomies › Review"
    if (root.view === "settings-taxonomy") return "‹ Settings › Taxonomies › " + (root.taxEdit ? root.taxEdit.name : "…")
    if (root.view === "settings-tax-label") return "‹ Settings › Taxonomies › " + (root.taxEdit ? root.taxEdit.name + " › " + ((root.taxEdit.labels[root.taxLabel] || {}).name || "") : "…")
    if (root.view === "settings-tax-ai") return "‹ Settings › Taxonomies › " + (root.taxDraft && root.taxDraft.id && root.taxEdit ? root.taxEdit.name + " › Change it with AI" : "New taxonomy with AI")
    if (root.view === "settings-rules") return "‹ Settings › Rules"
    if (root.view === "settings-models") return root.settingsModelsPath === "defaults.both" ? "‹ The default model for prompts and chat" : "‹ Choose a model · type to find one"
    if (root.view === "settings-edit") return "‹ " + (root.settingsEdit ? root.settingsEdit.label : "") + " · type it (ctrl+v pastes)"
    if (root.view === "tasks") return "‹ Processes · prompt runs, extractions and syncs"
    if (root.view === "chats") return "‹ Chats · with your papers"
    if (root.view === "searches") return "‹ Saved searches"
    if (root.view === "search-menu") return "‹ " + (root.searchMenu ? root.searchMenu.name : "Search")
    if (root.view === "search-edit") return root.searchEditMode === "save" ? "‹ Name it (↵ names it after the search)" : root.searchEditMode === "rename" ? "‹ Rename the search" : "‹ Edit the search"
    if (root.view === "picker") return "‹ Add to the search · a filter or an operator"
    if (root.view === "picker-values") return "‹ " + Views.pickerFieldLabel(root.pickerField, root.taxonomyList) + " · type to find one"
    const search = root.singleKeys && !root.searchFocus ? " · / to search" : ""
    if (root.pickFor === "chat" && root.inSearch) return "‹ type to find the paper" + search
    if (root.collectionScope) return "‹ type to search in it" + search
    const badge = root.searchScope()
    if (badge) return "Search in “" + badge.title + "”…" + search
    return "Search Zotero… · @ adds a filter"
  }

  function countText() {
    if (root.view === "tasks") return Views.taskSummary(root.service ? root.service.processes : []).text || "no processes"
    if (root.view === "todos") {
      const all = root.service ? root.service.todos : []
      const open = all.filter(function(t) { return Todos.statusOfTodo(t, root.todoStatuses).group !== "completed" }).length
      return open + " open · " + all.length + (all.length === 1 ? " task" : " tasks")
    }
    if (root.view === "chats") {
      const n = root.service && root.service.chats ? root.service.chats.length : 0
      return n + (n === 1 ? " chat" : " chats")
    }
    if (root.inSearch) return root.loading ? "…" : Views.countText(root.response, root.service ? root.service.itemCount : 0) + (root.groupable && Views.groupingName(root.grouping, root.taxonomyList) ? " · " + Views.groupingName(root.grouping, root.taxonomyList) : "")
    if (root.view === "searches") {
      const n = root.service ? root.service.searches.length : 0
      return n + (n === 1 ? " search" : " searches")
    }
    if (root.view === "picker-values") {
      if (root.pickerField === "search") return actionModel.count + (actionModel.count === 1 ? " search" : " searches")
      if (/^tax:/.test(root.pickerField)) return actionModel.count + (actionModel.count === 1 ? " label" : " labels")
      if (Views.DATE_FIELDS[root.pickerField]) return ""
      const r = root.facetResult
      if (!r || r.field !== root.pickerField) return "…"
      // "651 of 11,033" while typing; "11,033" before
      return String(r.query).trim() ? Views.thousands(r.total) + " of " + Views.thousands(r.count) : Views.thousands(r.count)
    }
    if (["picker", "search-menu", "search-edit"].indexOf(root.view) >= 0) return ""
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
    if (root.view === "settings-styles") {
      const n = root.service && root.service.citationStyles ? root.service.citationStyles.length : -1
      return n < 0 ? "…" : n + (n === 1 ? " style" : " styles")
    }
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
  // First, always: how to see every key for where you are (? while the list has the keys, else F1).
  function hints() {
    const sp = "     "
    let h = root.hintsFor()
    const cur = root.inForm ? root.rowAt(root.selectedIndex) : null
    const inBox = !!cur && (cur.field === "text" || cur.field === "multiline") // ? types there
    const help = root.view === "keys" ? "" : (root.inNote || (root.singleKeys && !root.typingNow && !inBox) ? "? keys" : "F1 keys") + sp
    if (root.singleKeys && !root.searchFocus && !root.inNote && !root.textEntry)
      h = "/ search" + sp + help + h.split("/ search" + sp).join("").replace(sp + "/ search", "")
    else h = help + h
    return h
  }

  function hintsFor() {
    const listRow = !root.inSearch && root.selectedIndex >= 0 && root.selectedIndex < actionModel.count ? actionModel.get(root.selectedIndex) : null
    const K = function(l) { return root.singleKeys ? l : "alt+" + l }
    const sp = "     "
    const back = root.atRoot ? "esc close" : "⌫ esc back" + sp + "⇧esc home"
    const places = K("t") + " tasks" + sp + K("c") + " chat" + sp + K(".") + " processes" + sp + K("f") + " searches" + sp + K(";") + " settings" + sp + K("W") + (root.windowed ? " overlay" : " window")
    const slash = root.singleKeys ? "/ search" + sp : ""
    const row = (root.singleKeys ? "1…9" : "alt+1…9") + " row"
    const badges = root.atRoot && root.pinnedSearches.length ? "tab next search" + sp : ""
    // single keys, the search box has them: typing, moving, Enter, and Esc to hand them to the list
    if (root.singleKeys && root.searchFocus && !root.textEntry && !root.inNote)
      return (root.view === "todos" ? "type to add or find" : "type to search") + sp + (root.inSearch && !root.pickFor ? "@ filters" + sp + badges + "ctrl+s save" + sp : "") + "↑↓ move" + sp + "↵ " + (root.inSearch ? (root.pickFor ? "chat about it" : "menu") : "choose") + sp + "esc one-key actions"
    if (root.view === "searches") {
      if (listRow && listRow.rowId === "search") return "↵ open" + sp + "⇧↵ rename, edit, delete" + sp + K("p") + " " + (listRow.badge ? "unpin" : "pin") + sp + "⇧↑↓ reorder" + sp + slash + back
      return back
    }
    if (root.view === "search-menu" || root.view === "extract-menu") return "↵ choose" + sp + row + sp + back
    if (root.view === "search-edit") return "↵ save" + sp + "esc clear, then back"
    if (root.view === "picker") return "↵ " + (listRow && listRow.rowId === "pick-op" ? "add it" : "its values") + sp + row + sp + slash + back
    if (root.view === "picker-values") return "↵ add it to the search" + sp + row + sp + slash + back
    const noteKeys = "↵ read" + sp + "⇧↵ " + K("z") + " zotero" + sp + K("w") + " window" + sp + K("y") + " copy .md" + sp + K("s") + " save .md" + sp + slash + back
    if (root.inNote) return (root.noteSiblings.length > 1 ? "⇧↑↓ other notes" + sp : "") + (root.headerStatus !== null ? "alt+→← status" + sp + "⇧alt+→← task" + sp : "") + "t task" + sp + "z zotero" + sp + "w window" + sp + "y copy .md" + sp + "s save .md" + sp + "i/r cite" + sp + "c chat" + sp + "j k scroll" + sp + "ctrl -/+ size" + sp + "⌫ esc back"
    if (root.view === "chat-rename" || root.view === "artifact-rename") return "↵ rename" + sp + "esc clear, then back"
    if (root.view === "artifact-change") return "↵ change it" + sp + "ctrl+v paste" + sp + "esc clear, then back"
    if (root.view === "todo-new") return "↵ add and open" + sp + "⇧↵ just add" + sp + "@ add a block" + sp + "#status !priority @due" + sp + "esc clear, then back"
    if (root.view === "todo-text" || root.view === "status-name") return "↵ save" + sp + "ctrl+v paste" + sp + "esc clear, then back"
    if (root.view === "todos") {
      if (listRow && listRow.rowId === "todo") return "↵ open" + sp + "tab ⇧tab status" + sp + K("d") + " done" + sp + K("!") + " priority" + sp + "del delete" + sp + "⇧↑↓ reorder" + sp + slash + back
      if (listRow && listRow.rowId === "todo-quick") return "↵ add and open it" + sp + "⇧↵ just add it" + sp + "#status !priority @due" + sp + back
      return "↵ new task, or just type it" + sp + slash + back
    }
    if (root.view === "todo-edit") {
      const id = listRow ? listRow.rowId : ""
      if (id === "todo-desc") return "type to edit" + sp + "↵ save and back" + sp + "↑↓ move" + sp + "esc back"
      if (id === "todo-notes") return "type to edit" + sp + "↵ new line" + sp + "ctrl+↵ save and back" + sp + "↑↓ at the ends: move" + sp + "esc back"
      if (id === "todo-status" || id === "todo-priority") return "tab ⇧tab change" + sp + "↵ save and back" + sp + K("d") + " done" + sp + "del delete" + sp + back
      if (id === "todo-due") return "↵ pick a date" + sp + K("d") + " done" + sp + "del delete" + sp + back
      return "↵ open" + sp + K("d") + " done" + sp + K("!") + " priority" + sp + "del delete" + sp + back
    }
    if (root.view === "todo-tags") return "↵ add it" + sp + "↑↓ move" + sp + "esc back"
    if (root.view === "confirm") return "↵ choose" + sp + "↑↓ move" + sp + "esc back (nothing changes)"
    if (root.view === "tag-menu" || root.view === "tag-status") return "↵ choose" + sp + back
    if (root.view === "tag-name") return "↵ rename everywhere" + sp + "esc clear, then back"
    if (root.view === "keys") return "type to find a key" + sp + "↑↓ move" + sp + "esc clear, then back"
    if (root.view === "todo-due") return "←→↑↓ day" + sp + "pgup pgdn month" + sp + "home today" + sp + "del no date" + sp + "↵ pick (or what you typed)" + sp + "esc back"
    if (root.view === "settings-tasks") return "↵ " + (listRow && (listRow.rowId === "status" || listRow.rowId === "task-action") ? "rename or remove" : "add") + sp + "⇧↑↓ move" + sp + back
    if (root.view === "settings-paper-status") return "↵ " + (listRow && listRow.rowId === "pstatus" ? "rename or remove" : "add") + sp + "⇧↑↓ move" + sp + back
    if ((root.view === "actions") && listRow && listRow.rowId === "todo") return "↵ open" + sp + "tab ⇧tab status" + sp + K("d") + " done" + sp + K("!") + " priority" + sp + K("a") + " new task" + sp + K("p") + " pin" + sp + "⇧↑↓ move" + sp + slash + back
    // a paper's menu: p pins the highlighted row (Pinned, on top), ⇧↑↓ moves it in its section
    const pinRow = root.view === "actions" && listRow ? K("p") + (listRow.section === "Pinned" ? " unpin" : " pin") + sp + K("P") + (listRow.section === "Other" ? " back" : " to other") + sp + "⇧↑↓ move" + sp : ""
    if (root.view === "actions" || root.view === "notes") {
      if (listRow && listRow.rowId === "note") return "↵ read" + sp + (pinRow || "⇧↑↓ reorder" + sp) + K("w") + " window" + sp + K("y") + " copy .md" + sp + K("s") + " save .md" + sp + "⇧↵ " + K("z") + " zotero" + sp + slash + back
      if (listRow && listRow.rowId === "chat-session") return "↵ continue it" + sp + "⇧↵ rename or delete" + sp + pinRow + slash + back
      if (listRow && listRow.rowId === "artifact") return "↵ open it" + sp + "⇧↵ change it with AI, rename, undo, delete" + sp + pinRow + slash + back
      if (listRow && listRow.rowId === "extract" && listRow.noteKey) return "↵ read it" + sp + "⇧↵ " + K("x") + " extract again, zotero, delete" + sp + pinRow + K("w") + " window" + sp + K("y") + " copy .md" + sp + slash + back
    }
    if (root.view === "actions") {
      if (listRow && listRow.rowId === "read") return noteKeys
      return "↵ run" + sp + pinRow + "alt+→← status" + sp + "⇧alt+→← task" + sp + row + sp + "⇧↵ " + K("z") + " zotero" + sp + K("o") + "/" + K("w") + " pdf" + sp + K("n") + " notes" + sp + K("#") + " tags" + sp + K("x") + " extract" + sp + K("i") + "/" + K("r") + " cite" + sp + K("c") + " chat" + sp + K("a") + " task" + sp + K("l") + " library" + sp + slash + back
    }
    if (root.view === "notes") return noteKeys
    if (root.view === "prompts") {
      if (listRow && listRow.rowId === "prompt") return "↵ run it, save as a note" + sp + K("e") + " edit" + sp + slash + back
      return "↵ create" + sp + back
    }
    if (root.view === "prompt-title") return (root.promptTitleMode !== "create" ? "↵ rename" : listRow && listRow.rowId === "pe-title-ai" ? "↵ write it with AI" : "↵ create") + sp + "esc clear, then back"
    if (root.view === "settings-edit") return "↵ save" + sp + "ctrl+v paste" + sp + "esc clear, then back"
    if (root.view === "tax-paper") return (listRow && listRow.rowId === "tax-label-papers" ? "↵ the papers with it" : "↵ choose") + sp + row + sp + slash + back
    if (root.view === "tax-audit") return (listRow && listRow.rowId === "tax-audit" ? "↵ " + (listRow.decision === "confirmed" ? "→ off, by you" : listRow.decision === "dismissed" ? "→ auto" : "→ on, by you") + sp : listRow && listRow.rowId === "classify" ? "↵ tag again" + sp : "") + "↑↓ move" + sp + slash + back
    if (root.view === "settings-tax-ai") {
      if (listRow && listRow.rowId === "tax-ai-ask") return "type what you want" + sp + "↵ send it" + sp + "↓ the proposal" + sp + "esc back (nothing saved)"
      if (listRow && listRow.rowId === "tax-ai-accept") return "↵ accept it" + sp + "↑ ask for changes" + sp + back
      return "↑↓ move" + sp + "↵ on Accept or Discard" + sp + back
    }
    if (root.view === "settings-taxonomy" || root.view === "settings-tax-label") {
      const f = listRow ? listRow.field : ""
      if (f === "text") return "type to edit" + sp + "↵ keep it" + sp + "↑↓ move (keeps it)" + sp + "esc back"
      if (f === "multiline") return "type to edit" + sp + "↵ new line" + sp + "ctrl+↵ keep it" + sp + "↑↓ at the ends: move" + sp + "esc back"
      if (f === "pills") return "tab ⇧tab ↵ change" + sp + "↑↓ move" + sp + back
      if (listRow && listRow.rowId === "tax-label") return "↵ edit it" + sp + "⇧↑↓ move" + sp + row + sp + back
    }
    if (["prompt-edit", "prompt-model", "prompt-effort", "prompt-output", "settings-choice", "settings-models"].indexOf(root.view) >= 0 || root.inSettings) {
      if (listRow && listRow.rowId === "set-key") return "↵ read the key from the clipboard" + sp + back
      if (listRow && listRow.rowId === "tax-suggestion") return "↵ tag it" + sp + "del dismiss it" + sp + slash + back
      if (listRow && listRow.rowId === "tax-edit") return "↵ edit it in your editor" + sp + slash + back
      if (listRow && (listRow.rowId === "set-info" || !listRow.available)) return row + sp + back
      const verb = listRow && listRow.rowId === "set-rule" ? "change" : listRow && (listRow.showCheck || listRow.rowId === "set-opt" || listRow.rowId === "set-model") ? "choose" : listRow && (listRow.rowId === "set-toggle" || listRow.rowId === "set-rule") ? "change" : listRow && listRow.rowId === "set-test" ? "test" : listRow && listRow.rowId === "set-system-reset" ? "clear" : listRow && listRow.rowId === "set-rules-reset" ? "reset" : "open"
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
        : "↵ add/remove" + sp + "⇧↵ rename or delete everywhere" + sp + "ctrl+↵ new tag" + sp + slash + back
    }
    const cur = root.inSearch && root.selectedIndex >= 0 && root.selectedIndex < displayModel.count ? displayModel.get(root.selectedIndex) : null
    if (root.pickFor === "chat") return "↵ chat about it" + sp + slash + back
    if (cur && (cur.section === "Processes and chats" || cur.section === "Go to")) return "↵ open" + sp + row + sp + slash + places + sp + back
    if (cur && cur.kind === "note-child") return "↵ read" + sp + "space ← hide the notes" + sp + "⇧↵ " + K("z") + " zotero" + sp + slash + back
    if (cur && cur.kind === "collection") return "↵ open" + sp + "⇧↵ zotero" + sp + K("p") + " pin" + sp + slash + back
    if (cur && cur.kind === "tag") return "↵ its papers" + sp + K("p") + " pin" + sp + slash + back
    const searchKeys = "@ filters" + sp + badges + K("s") + " save search" + sp
    if (!root.accel) return "↵ menu" + sp + "⇧↵ zotero" + sp + searchKeys + slash + places + sp + back
    const pinned = (cur && cur.kind === "item" ? sp + "alt+→← status" + sp + "⇧alt+→← task" + (cur.noteCount ? sp + "space notes" : "") : "") + (cur && cur.section === "Pinned" ? sp + "⇧↑↓ reorder" : "")
    return "↵ menu" + pinned + sp + row + sp + "⇧↵ " + K("z") + " zotero" + sp + K("o") + "/" + K("w") + " pdf" + sp + K("n") + " notes" + sp + K("#") + " tags" + sp + K("p") + " pin" + sp + K("l") + " library" + sp + K("i") + "/" + K("r") + " cite" + sp + K("g") + " group" + sp + searchKeys + places + sp + slash + back
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

  // The form field the keyboard is in (a task's, a taxonomy's), or null: scripted typing and keys go there.
  function focusedField() {
    const f = keyCatcher.Window.activeFocusItem
    return f && f !== keyCatcher && typeof f.insert === "function" && !f.readOnly ? f : null
  }

  function typeIntoField(f, text) {
    if (f.selectedText) f.remove(f.selectionStart, f.selectionEnd)
    f.insert(f.cursorPosition, text)
  }

  // "ctrl+enter", "alt+n", "shift+tab", "pagedown", "x" … → the same handleKey() real keys use (in a form's field:
  // its keys, as fieldKey, and the field's own editing for backspace and ctrl+a).
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
      enter: Qt.Key_Return, tab: Qt.Key_Tab, escape: Qt.Key_Escape, backspace: Qt.Key_Backspace, delete: Qt.Key_Delete,
      left: Qt.Key_Left, right: Qt.Key_Right, up: Qt.Key_Up, down: Qt.Key_Down,
      pageup: Qt.Key_PageUp, pagedown: Qt.Key_PageDown, home: Qt.Key_Home, end: Qt.Key_End, space: Qt.Key_Space,
      minus: Qt.Key_Minus, plus: Qt.Key_Plus, equal: Qt.Key_Equal, f1: Qt.Key_F1, question: Qt.Key_Question,
      semicolon: Qt.Key_Semicolon, slash: Qt.Key_Slash, hash: Qt.Key_NumberSign, period: Qt.Key_Period, at: Qt.Key_At
    }
    let code
    let text = ""
    if (named[key] !== undefined) {
      code = named[key]
      if (key === "space") text = " "
      if (key === "tab" && (modifiers & Qt.ShiftModifier)) code = Qt.Key_Backtab
      if (!(modifiers & (Qt.ControlModifier | Qt.AltModifier))) text = { semicolon: ";", slash: "/", hash: "#", minus: "-", equal: "=", period: ".", at: "@", question: "?" }[key] || text
    } else if (/^[a-z0-9]$/.test(key)) {
      code = key >= "a" ? Qt.Key_A + key.charCodeAt(0) - 97 : Qt.Key_0 + key.charCodeAt(0) - 48
      if (!(modifiers & (Qt.ControlModifier | Qt.AltModifier))) text = (modifiers & Qt.ShiftModifier) ? key.toUpperCase() : key
    } else {
      return "unknown key " + key
    }
    const event = { key: code, modifiers: modifiers, text: text }
    const f = root.focusedField()
    if (f) {
      if (root.fieldKey(event, "textDocument" in f, f)) return "ok"
      if (code === Qt.Key_Backspace) { if (f.selectedText) f.remove(f.selectionStart, f.selectionEnd); else if (f.cursorPosition > 0) f.remove(f.cursorPosition - 1, f.cursorPosition) }
      else if (code === Qt.Key_A && (modifiers & Qt.ControlModifier)) f.selectAll()
      else if (code === Qt.Key_Return) root.typeIntoField(f, "\n")
      else if (text) root.typeIntoField(f, text)
      return "ok"
    }
    root.handleKey(event)
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
      activeSearch: root.activeSearch,
      badges: root.pinnedSearches.map(function(s) { return s.name }),
      searches: root.service ? root.service.searches.length : 0,
      filterText: root.filterText,
      caret: root.caret,
      // the search box's pieces: [a block's label], text as typed
      pieces: queryBox.segs.map(function(s) { return s.block ? "[" + s.label + "]" : s.text }),
      shownQuery: root.response ? String(root.response.query) : null,
      loading: root.loading,
      status: root.status,
      selectedIndex: root.selectedIndex,
      top: root.inSearch ? root.resultTop : root.actionTop, // the first row in view
      count: displayModel.count,
      windowed: root.windowed,
      geometry: { panel: [panel.width, panel.height], card: [card.x, card.y, card.width, card.height] },
      // true once the compositor has given the overlay keyboard focus (keys typed
      // before that still go to the previously focused window)
      keyboardFocus: keyCatcher.activeFocus && keyCatcher.Window.active,
      windowActive: keyCatcher.Window.active, // the launcher has the keyboard (a field on a form may hold it)
      focusItem: String(keyCatcher.Window.activeFocusItem || ""),
      editing: root.fieldDraft ? root.fieldDraft.field : "",
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
    target: root.ipcTarget
    enabled: root.ipcTarget !== ""
    function toggle(): string { if (root.shell) root.shell.toggle(root.pluginId, "{}"); return "ok" }
    function close(): string { if (root.opened) root.dismiss(); return "ok" }
    function search(query: string): string { if (root.shell) root.shell.summon(root.pluginId, JSON.stringify({ query: query })); return "ok" }
    function type(text: string): string { if (!root.opened) return "closed"; if (root.inNote) return "ignored"; const f = root.focusedField(); if (f) root.typeIntoField(f, text); else root.startTyping(text); return "ok" }
    function key(name: string): string { return root.opened ? root.pressKey(name) : "closed" }
    function state(): string { return JSON.stringify(root.snapshot()) }
    // For a key that closes windows (Super+W): "closed" if the launcher was open (now closed), else
    // "not-open" (the key can then act on the window). hyprland: see the README's Keybinding.
    function closeIfOpen(): string { if (!root.opened) return "not-open"; root.dismiss(); return "closed" }
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
    shown: root.opened && !root.windowed
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
      width: root.windowed ? parent.width : root.cardWidth
      height: root.windowed ? parent.height : root.cardHeight
      anchors.centerIn: parent
      Component.onCompleted: root.cardHome = card.parent
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

        // The context bar: what this level is about (a paper and the submenu, a note's paper, a collection with
        // its papers, a Settings page), always shown below the top level; the paper's rankings on the right.
        Item {
          id: contextBar
          width: parent.width
          height: visible ? root.contextHeight : 0
          visible: root.context !== null

          Text {
            anchors.left: parent.left
            anchors.leftMargin: Style.space(4)
            anchors.right: contextRight.left
            anchors.rightMargin: Style.space(12)
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: root.context ? "‹  " + root.context.text : ""
            color: root.foreground
            opacity: 0.6
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            elide: Text.ElideRight
          }

          Row {
            id: contextRight
            anchors.right: parent.right
            anchors.rightMargin: Style.space(4)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(4)
            Text {
              visible: !!(root.context && root.context.count)
              anchors.verticalCenter: parent.verticalCenter
              textFormat: Text.PlainText
              text: root.context ? root.context.count : ""
              color: root.foreground
              opacity: 0.45
              font.family: root.fontFamily
              font.pixelSize: root.sectionSize
            }
            Repeater {
              model: root.context ? root.context.ranks : []
              // a top grade as a tag, the others faint
              delegate: Pill {
                required property string modelData
                anchors.verticalCenter: parent.verticalCenter
                text: modelData
                kind: "rank"
                mode: Views.rankIsTop(modelData) ? "tag" : "off"
                colors: root.pillColors
                background: root.background
                foreground: root.foreground
                fontFamily: root.fontFamily
                fontSize: root.sectionSize
              }
            }
          }
        }

        // Header: the typed query (or placeholder) and a count.
        Item {
          width: parent.width
          height: root.headerHeight

          // What the search is limited to: a collection, a tag, or picking a paper for a chat
          Pill {
            id: scopeChip
            readonly property string label: root.pickFor === "chat" ? "New chat · pick a paper" + (root.collectionScope ? " in " + root.collectionScope.title : "")
              : root.collectionScope ? ({ tag: "Tag  ", search: "Search  " }[root.collectionScope.type] || "Collection  ") + root.collectionScope.title : ""
            visible: root.inSearch && label !== "" && root.context === null // the context bar names it
            anchors.left: parent.left
            anchors.leftMargin: Style.space(2)
            anchors.verticalCenter: parent.verticalCenter
            width: visible ? implicitWidth : 0
            maxWidth: parent.width * 0.45
            text: (!root.collectionScope ? "\uf442  " : ({ tag: "\uf412  ", search: "\uf002  " }[root.collectionScope.type] || "\uf413  ")) + scopeChip.label
            kind: "scope"
            mode: "on"
            colors: root.pillColors
            background: root.background
            foreground: root.foreground
            fontFamily: root.fontFamily
            fontSize: Style.font.caption
            padX: Style.space(16)
            padY: Style.space(6)
          }

          // A blinking block cursor while the search box has the keys; none while the list has them. In a
          // search with the caret before the end, a bar where the caret is.
          Rectangle {
            id: blockCursor
            readonly property bool active: root.typingNow && !root.inNote && root.opened
            readonly property int blockWidth: Math.max(2, Math.round(root.searchFontSize * 0.55))
            readonly property bool bar: queryBox.visible && root.caretBack > 0
            visible: active && blink.on
            x: queryBox.visible ? queryBox.x + queryBox.layout.caretX - queryBox.scroll + (bar ? 0 : Style.space(1))
              : root.filterText ? queryText.x + Math.min(queryText.contentWidth, queryText.width) + Style.space(1) : queryText.x - width - Style.space(8)
            anchors.verticalCenter: parent.verticalCenter
            width: bar ? Math.max(2, Style.space(2)) : blockWidth
            height: Math.round(root.searchFontSize * 1.15)
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
            anchors.leftMargin: (scopeChip.visible ? Style.space(10) : Style.space(4)) + (typing && !root.filterText ? blockCursor.blockWidth + Style.space(8) : 0)
            anchors.right: countLabel.left
            anchors.rightMargin: Style.space(12) + blockCursor.blockWidth
            anchors.verticalCenter: parent.verticalCenter
            visible: !queryBox.visible // a search is drawn by queryBox
            textFormat: Text.PlainText
            text: root.filterText || root.headerPlaceholder()
            color: root.foreground
            opacity: root.filterText ? (typing ? 1 : 0.7) : 0.58
            font.family: root.fontFamily
            font.pixelSize: root.searchFontSize
            elide: root.filterText ? Text.ElideLeft : Text.ElideRight
          }

          FontMetrics {
            id: queryMetrics
            font.family: root.fontFamily
            font.pixelSize: root.searchFontSize
          }

          FontMetrics {
            id: blockMetrics
            font.family: root.fontFamily
            font.pixelSize: root.searchBlockSize
          }

          // A search, in pieces (Views.querySegments): operators and finished terms as blocks, by
          // their labels ("A: Smith, John", "# risk", "OR"); the rest as text in its syntax colour.
          // It scrolls to keep the caret in view.
          Item {
            id: queryBox
            readonly property int pad: Style.space(4) // inside a block
            readonly property int gap: Style.space(1) // around a block
            // Spaces alone between pieces (around blocks) are drawn at half a space's width.
            readonly property real thinSpace: queryMetrics.advanceWidth(" ") / 2
            readonly property var segs: !visible ? []
              : root.view === "todo-new" ? Todos.taskSegments(root.filterText, root.caret, root.todoStatuses, new Date(), root.service ? root.service.taskActions : null)
              : Views.querySegments(root.filterText, root.caret, root.queryLive)
            // Each piece's x and width, the row's width, and the caret's x (never inside a block).
            readonly property var layout: {
              const xs = [], ws = []
              let x = 0, caretX = -1
              const plain = function(s) { return s.replace(/ /g, " ") } // spaces keep their width
              for (const s of queryBox.segs) {
                const thin = !s.block && /^ +$/.test(s.text)
                const width = function(t) { return thin ? t.length * queryBox.thinSpace : queryMetrics.advanceWidth(plain(t)) }
                const w = s.block ? blockMetrics.advanceWidth(s.label) + 2 * (queryBox.pad + queryBox.gap) : width(s.text)
                if (caretX < 0 && root.caret <= s.start) caretX = x
                else if (caretX < 0 && !s.block && root.caret < s.end) caretX = x + width(s.text.slice(0, root.caret - s.start))
                xs.push(x)
                ws.push(w)
                x += w
              }
              return { xs: xs, ws: ws, total: x, caretX: caretX < 0 ? x : caretX }
            }
            readonly property real scroll: Math.max(0, queryBox.layout.caretX + blockCursor.blockWidth + Style.space(2) - queryBox.width)
            visible: !!root.filterText && root.queryTyped
            anchors.left: queryText.left
            anchors.right: queryText.right
            anchors.verticalCenter: parent.verticalCenter
            height: parent.height
            clip: true
            opacity: queryText.typing ? 1 : 0.7

            Repeater {
              model: queryBox.segs
              delegate: Item {
                id: piece
                required property var modelData
                required property int index
                readonly property color ink: ({ op: root.queryColors.op, field: root.queryColors.field, neg: root.queryColors.neg,
                  quote: root.queryColors.quote, paren: root.queryColors.paren })[piece.modelData.role] || root.foreground
                x: (queryBox.layout.xs[piece.index] || 0) - queryBox.scroll
                width: queryBox.layout.ws[piece.index] || 0
                height: queryBox.height

                Rectangle {
                  visible: piece.modelData.block
                  x: queryBox.gap
                  width: parent.width - 2 * queryBox.gap
                  height: Math.round(root.searchBlockSize * 1.7)
                  anchors.verticalCenter: parent.verticalCenter
                  radius: Style.space(4)
                  color: Util.alpha(piece.ink, 0.16)
                  border.width: 1
                  border.color: Util.alpha(piece.ink, 0.6)
                }

                Text {
                  x: piece.modelData.block ? queryBox.gap + queryBox.pad : 0
                  anchors.verticalCenter: parent.verticalCenter
                  textFormat: Text.PlainText
                  text: piece.modelData.block ? piece.modelData.label : piece.modelData.text.replace(/ /g, " ")
                  color: piece.ink
                  font.family: root.fontFamily
                  font.pixelSize: piece.modelData.block ? root.searchBlockSize : root.searchFontSize
                }
              }
            }
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

        // Under the search box, in a paper's menu and its submenus: every status, its own filled, the
        // others faint (Alt+→ / Alt+← moves along them); on the right, its journal's rankings.
        Item {
          id: statusStrip
          width: parent.width
          height: visible ? root.statusStripHeight : 0
          visible: root.headerStatus !== null // its rankings are in the context bar

          Row {
            id: headerStatusPill
            visible: root.headerStatus !== null
            anchors.left: parent.left
            anchors.leftMargin: Style.space(4)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(4)
            Text {
              anchors.verticalCenter: parent.verticalCenter
              textFormat: Text.PlainText
              text: "Status"
              color: root.foreground
              opacity: 0.4
              font.family: root.fontFamily
              font.pixelSize: root.sectionSize
              rightPadding: Style.space(4)
            }
            // every status a choice: the paper's on, the others off
            Repeater {
              model: statusStrip.visible ? [""].concat(root.paperStatuses) : []
              delegate: Pill {
                required property string modelData
                anchors.verticalCenter: parent.verticalCenter
                text: modelData || "no status"
                kind: "status"
                mode: Client.statusName(root.headerStatus || "").toLowerCase() === modelData.toLowerCase() ? "on" : "off"
                colors: root.pillColors
                background: root.background
                foreground: root.foreground
                fontFamily: root.fontFamily
                fontSize: root.sectionSize
              }
            }
            Text {
              anchors.verticalCenter: parent.verticalCenter
              textFormat: Text.PlainText
              text: "alt+→ ←"
              color: root.foreground
              opacity: 0.3
              font.family: root.fontFamily
              font.pixelSize: root.sectionSize
              leftPadding: Style.space(6)
            }
            // Its default task: a tag, with the task icon (none: off)
            Text {
              visible: root.headerTask !== null
              anchors.verticalCenter: parent.verticalCenter
              textFormat: Text.PlainText
              text: "Task"
              color: root.foreground
              opacity: 0.4
              font.family: root.fontFamily
              font.pixelSize: root.sectionSize
              leftPadding: Style.space(14)
              rightPadding: Style.space(4)
            }
            Pill {
              visible: root.headerTask !== null
              anchors.verticalCenter: parent.verticalCenter
              text: Todos.ICON.task + " " + (root.headerTask || "no task")
              kind: "task"
              mode: root.headerTask ? "tag" : "off"
              colors: root.pillColors
              background: root.background
              foreground: root.foreground
              fontFamily: root.fontFamily
              fontSize: root.sectionSize
            }
            Text {
              visible: root.headerTask !== null
              anchors.verticalCenter: parent.verticalCenter
              textFormat: Text.PlainText
              text: "⇧alt+→ ←"
              color: root.foreground
              opacity: 0.3
              font.family: root.fontFamily
              font.pixelSize: root.sectionSize
              leftPadding: Style.space(6)
            }
          }
        }

        // Under it: the paper's taxonomy labels, as pills (a click: the papers with that label); a word when they're
        // being tagged, out of date or missing.
        Item {
          id: taxStrip
          // a word per taxonomy, then its labels; as many lines as they need, wrapping between pills
          readonly property var parts: {
            const out = []
            const h = root.headerTaxonomies
            if (!h) return out
            h.items.forEach(function(t, i) {
              out.push({ name: t.name, first: i === 0 })
              t.labels.forEach(function(l) { out.push({ label: l, tag: t.prefix + l }) })
            })
            if (h.note) out.push({ note: h.note })
            return out
          }
          readonly property real line: Math.max(root.sectionSize + Style.space(8), Style.space(18))
          width: parent.width
          height: visible ? taxFlow.implicitHeight + Style.space(4) : 0
          visible: root.headerTaxonomies !== null && taxStrip.parts.length > 0

          Flow {
            id: taxFlow
            anchors.left: parent.left
            anchors.leftMargin: Style.space(4)
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.topMargin: Style.space(2)
            spacing: Style.space(4)
            Text {
              height: taxStrip.line
              verticalAlignment: Text.AlignVCenter
              textFormat: Text.PlainText
              text: "Taxonomies"
              color: root.foreground
              opacity: 0.4
              font.family: root.fontFamily
              font.pixelSize: root.sectionSize
              rightPadding: Style.space(4)
            }
            Repeater {
              model: taxStrip.parts
              delegate: Item {
                id: part
                required property var modelData
                width: part.modelData.label !== undefined ? taxPill.width : partText.implicitWidth
                height: taxStrip.line
                Text {
                  id: partText
                  visible: part.modelData.label === undefined
                  anchors.verticalCenter: parent.verticalCenter
                  textFormat: Text.PlainText
                  text: part.modelData.name !== undefined ? part.modelData.name : (part.modelData.note || "")
                  color: root.foreground
                  opacity: 0.35
                  font.family: root.fontFamily
                  font.pixelSize: root.sectionSize
                  leftPadding: part.modelData.first ? 0 : Style.space(8)
                }
                Pill {
                  id: taxPill
                  visible: part.modelData.label !== undefined
                  anchors.verticalCenter: parent.verticalCenter
                  text: part.modelData.label || ""
                  kind: "taxonomy"
                  mode: "tag"
                  colors: root.pillColors
                  background: root.background
                  foreground: root.foreground
                  fontFamily: root.fontFamily
                  fontSize: root.sectionSize
                  MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.openTaggedPapers(part.modelData.tag)
                  }
                }
              }
            }
          }
        }

        // All (the whole library) and the pinned searches as badges, always at the top: the results
        // search within the selected one. Tab / Shift+Tab move along them; a click picks one. Last, a
        // badge that saves what you typed as a search (Ctrl+S).
        ListView {
          id: badgeBar
          readonly property int activeIndex: {
            const list = root.pinnedSearches
            for (let i = 0; i < list.length; i++) if (list[i].id === root.activeSearch) return i + 1
            return 0
          }
          width: parent.width
          height: Style.font.caption + Style.space(12)
          visible: root.inSearch && root.atRoot
          orientation: ListView.Horizontal
          spacing: Style.space(6)
          clip: true
          interactive: false
          model: badgeBar.visible ? [{ id: "", name: "All" }].concat(root.pinnedSearches, [{ id: "+save", name: root.filterText.trim() ? "+ Save “" + root.filterText.trim() + "” as a search · ctrl+s" : "+ Type, then ctrl+s saves it as a search" }]) : []
          onActiveIndexChanged: if (badgeBar.count > 0) badgeBar.positionViewAtIndex(badgeBar.activeIndex, ListView.Contain)

          // the search the results are in: on; the others: off; "+ Save…": a neutral hint, no outline
          delegate: Pill {
            id: badge
            required property var modelData
            required property int index
            readonly property bool save: badge.modelData.id === "+save"
            readonly property bool active: !badge.save && badge.modelData.id === root.activeSearch
            height: badgeBar.height
            maxWidth: Style.space(badge.save ? 360 : 240)
            padX: Style.space(22)
            text: (badge.index === 0 ? "" : "\uf002  ") + badge.modelData.name
            kind: badge.save ? "neutral" : "scope"
            mode: badge.active ? "on" : "off"
            border.width: badge.save || badge.active ? 0 : 1
            opacity: badge.save ? 0.6 : 1
            colors: root.pillColors
            background: root.background
            foreground: root.foreground
            fontFamily: root.fontFamily
            fontSize: Style.font.caption

            MouseArea {
              anchors.fill: parent
              onClicked: badge.save ? root.saveSearchPrompt() : root.selectSearch(badge.modelData.id)
            }
          }
        }

        Item {
          id: listArea
          width: parent.width
          height: parent.height - root.headerHeight - root.footerHeight - parent.spacing * 2 - (contextBar.visible ? contextBar.height + parent.spacing : 0) - (statusStrip.visible ? statusStrip.height + parent.spacing : 0) - (taxStrip.visible ? taxStrip.height + parent.spacing : 0) - (badgeBar.visible ? badgeBar.height + parent.spacing : 0)

          // ---- a task's due date: a month, Monday first; the highlighted day, today outlined.
          Item {
            id: calendar
            anchors.fill: parent
            visible: root.view === "todo-due"
            readonly property var month: visible && root.calDate ? Todos.calendarMonth(root.calDate) : ({ title: "", days: [] })
            readonly property string today: { root.opened; return Todos.isoDate(new Date()) }
            readonly property string due: { const t = root.view === "todo-due" ? root.currentTodo() : null; return t ? t.due : "" }
            readonly property real cell: Math.min(width / 7, (height - Style.space(70)) / 7, Style.space(40))

            Column {
              anchors.horizontalCenter: parent.horizontalCenter
              anchors.top: parent.top
              anchors.topMargin: Style.space(10)
              spacing: Style.space(6)

              Item {
                width: calendar.cell * 7
                height: monthTitle.implicitHeight + Style.space(6)
                Text {
                  anchors.left: parent.left
                  anchors.verticalCenter: parent.verticalCenter
                  text: "‹"
                  color: root.foreground
                  opacity: 0.6
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.heading
                  MouseArea { anchors.fill: parent; anchors.margins: -Style.space(8); onClicked: root.calDate = Todos.addMonths(root.calDate, -1) }
                }
                Text {
                  id: monthTitle
                  anchors.centerIn: parent
                  textFormat: Text.PlainText
                  text: calendar.month.title
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: root.rowTitleSize
                  font.weight: Font.Medium
                }
                Text {
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  text: "›"
                  color: root.foreground
                  opacity: 0.6
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.heading
                  MouseArea { anchors.fill: parent; anchors.margins: -Style.space(8); onClicked: root.calDate = Todos.addMonths(root.calDate, 1) }
                }
              }

              Grid {
                columns: 7
                Repeater {
                  model: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
                  delegate: Text {
                    required property string modelData
                    width: calendar.cell
                    horizontalAlignment: Text.AlignHCenter
                    textFormat: Text.PlainText
                    text: modelData
                    color: root.foreground
                    opacity: 0.45
                    font.family: root.fontFamily
                    font.pixelSize: root.sectionSize
                  }
                }
                Repeater {
                  model: calendar.month.days
                  delegate: Item {
                    id: dayCell
                    required property var modelData
                    readonly property bool picked: modelData.date === root.calDate
                    width: calendar.cell
                    height: calendar.cell
                    Rectangle {
                      anchors.centerIn: parent
                      width: Math.round(calendar.cell * 0.82)
                      height: width
                      radius: width / 2
                      color: dayCell.picked ? root.selectedText : "transparent"
                      border.width: !dayCell.picked && (dayCell.modelData.date === calendar.today || dayCell.modelData.date === calendar.due) ? 1 : 0
                      border.color: dayCell.modelData.date === calendar.due ? root.selectedText : Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.5)
                    }
                    Text {
                      anchors.centerIn: parent
                      textFormat: Text.PlainText
                      text: String(dayCell.modelData.day)
                      color: dayCell.picked ? root.background : root.foreground
                      opacity: dayCell.picked ? 1 : dayCell.modelData.inMonth ? 0.85 : 0.3
                      font.family: root.fontFamily
                      font.pixelSize: root.rowTitleSize
                      font.weight: dayCell.picked ? Font.Bold : Font.Normal
                    }
                    MouseArea {
                      anchors.fill: parent
                      cursorShape: Qt.PointingHandCursor
                      onClicked: root.pickDue(dayCell.modelData.date)
                    }
                  }
                }
              }
            }
          }

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
              required property int libraryID
              required property string icon
              required property string titleHtml
              required property string subtitle
              required property string tagsText
              required property string ranks
              required property string status
              required property string openState
              required property int pdfCount
              required property int noteCount
              required property string kind

              readonly property bool hasCursor: row.index === root.selectedIndex
              readonly property color ink: row.hasCursor ? root.selectedText : root.foreground
              // The Tasks and Chats entries: smaller type, shorter rows.
              readonly property bool small: row.kind === "tasks" || row.kind === "chats" || row.kind === "settings"
              // A note shown under its paper (Space): indented, a little shorter.
              readonly property bool child: row.kind === "note-child"

              width: ListView.view.width
              height: root.rowHeight
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
                anchors.leftMargin: Style.space(8) + (row.child ? Style.space(28) : 0)
                anchors.verticalCenter: parent.verticalCenter
                width: Style.space(34)
                horizontalAlignment: Text.AlignHCenter
                textFormat: Text.PlainText
                text: row.icon
                color: row.ink
                opacity: 0.85
                font.family: root.fontFamily
                font.pixelSize: root.rowIconSize
              }

              Column {
                anchors.left: iconText.right
                anchors.leftMargin: Style.space(8)
                anchors.right: trail.left
                anchors.rightMargin: Style.space(12)
                anchors.verticalCenter: parent.verticalCenter
                spacing: root.lineGap

                Text {
                  width: parent.width
                  height: root.titleLine
                  verticalAlignment: Text.AlignVCenter
                  textFormat: Text.StyledText
                  text: row.titleHtml
                  color: row.ink
                  font.family: root.fontFamily
                  font.pixelSize: root.rowTitleSize
                  font.weight: Font.Medium
                  elide: Text.ElideRight
                  maximumLineCount: 1
                }

                Item {
                  width: parent.width
                  height: root.detailLine
                  visible: row.subtitle.length > 0 || row.tagsText.length > 0

                  Text {
                    id: subtitleText
                    anchors.left: parent.left
                    anchors.right: tagsLabel.visible ? tagsLabel.left : parent.right
                    anchors.rightMargin: tagsLabel.visible ? Style.space(10) : 0
                    anchors.verticalCenter: parent.verticalCenter
                    textFormat: Text.PlainText
                    text: row.subtitle
                    color: root.foreground
                    opacity: 0.55
                    font.family: root.fontFamily
                    font.pixelSize: root.rowDetailSize
                    elide: Text.ElideRight
                  }

                  // The first tags, dimmer; they give way to the subtitle when space is short.
                  Text {
                    id: tagsLabel
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
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

                // Its status (Settings › Paper status: Alt+→ / Alt+←) over its default task's (Shift+Alt+→ / ←)
                Column {
                  id: rowPills
                  readonly property real pillHeight: Math.floor((root.rowHeight - Style.space(8) - spacing) / 2)
                  readonly property int pillFont: Math.min(root.sectionSize, Math.max(8, pillHeight - Style.space(4)))
                  readonly property var task: row.kind === "item" ? root.defaultTasks[row.libraryID + ":" + row.key] : undefined
                  anchors.verticalCenter: parent.verticalCenter
                  spacing: Style.space(2)
                  visible: rowStatusPill.visible || rowTaskPill.visible
                  Pill {
                    id: rowStatusPill
                    visible: row.status !== "" && row.status !== "\u0000"
                    anchors.right: parent.right
                    maxHeight: rowPills.pillHeight
                    padY: Style.space(2)
                    text: Client.statusName(row.status)
                    kind: "status"
                    mode: "tag"
                    hot: row.hasCursor
                    colors: root.pillColors
                    background: root.background
                    foreground: root.foreground
                    fontFamily: root.fontFamily
                    fontSize: rowPills.pillFont
                  }
                  Pill {
                    id: rowTaskPill
                    visible: !!rowPills.task
                    anchors.right: parent.right
                    maxHeight: rowPills.pillHeight
                    padY: Style.space(2)
                    text: rowPills.task ? Todos.ICON.task + " " + rowPills.task.name : ""
                    kind: "task"
                    mode: "tag"
                    hot: row.hasCursor
                    colors: root.pillColors
                    background: root.background
                    foreground: root.foreground
                    fontFamily: root.fontFamily
                    fontSize: rowPills.pillFont
                  }
                }

                // Journal rankings (ABS, ABDC, FT50, UTD24) on two lines; a top grade as a tag, the others faint
                Grid {
                  readonly property var ranks: row.ranks ? row.ranks.split("|") : []
                  anchors.verticalCenter: parent.verticalCenter
                  columns: Math.max(1, Math.ceil(ranks.length / 2))
                  rowSpacing: Style.space(2)
                  columnSpacing: Style.space(4)
                  visible: ranks.length > 0
                  Repeater {
                    model: parent.ranks
                    delegate: Pill {
                      required property string modelData
                      maxHeight: rowPills.pillHeight
                      padX: Style.space(10)
                      padY: Style.space(2)
                      text: Views.rankShort(modelData)
                      kind: "rank"
                      mode: Views.rankIsTop(modelData) ? "tag" : "off"
                      hot: row.hasCursor
                      colors: root.pillColors
                      background: root.background
                      foreground: root.foreground
                      fontFamily: root.fontFamily
                      fontSize: rowPills.pillFont
                    }
                  }
                }

                // Open tasks about it (t lists them); red when one is overdue
                Text {
                  readonly property var mark: row.kind === "item" ? root.taskMarks[row.libraryID + ":" + row.key] : undefined
                  visible: !!mark
                  textFormat: Text.PlainText
                  text: Todos.ICON.task + (mark && mark.count > 1 ? " " + mark.count : "")
                  color: mark && mark.overdue ? root.queryColors.neg : root.foreground
                  opacity: mark && mark.overdue ? 1 : 0.6
                  font.family: root.fontFamily
                  font.pixelSize: root.rowDetailSize
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
                  text: " " + row.noteCount
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
            visible: !root.inSearch && !root.inNote && root.view !== "todo-due"
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
              required property string field
              required property string editText
              required property string pills
              required property string pillOn
              required property string pill
              required property string pillKind
              required property string chips
              required property string chipKind
              required property string value // which field of a form this row edits (a taxonomy's)

              readonly property bool hasCursor: actionRow.index === root.selectedIndex
              // A task's description or notes, edited in place while the row has the cursor.
              readonly property bool isBox: actionRow.field === "text" || actionRow.field === "multiline"
              // (the same on a taxonomy's page and a label's: root.formViews)
              readonly property bool editing: actionRow.isBox && actionRow.hasCursor && root.opened && root.inForm
              readonly property string boxField: root.view === "todo-edit" ? (actionRow.field === "text" ? "description" : "notes") : actionRow.value
              function takeFocus() {
                if (!actionRow.editing) return
                const box = actionRow.field === "text" ? descInput : notesEdit
                box.forceActiveFocus()
                if (root.selectAllField === actionRow.boxField) { box.selectAll(); root.selectAllField = "" } // a new one's name: typing replaces it
                else box.cursorPosition = box.text.length
              }
              onEditingChanged: {
                if (actionRow.editing) Qt.callLater(actionRow.takeFocus)
                else if (actionRow.isBox) {
                  if (root.fieldDraft) Qt.callLater(root.commitField)
                  keyCatcher.forceActiveFocus()
                }
              }
              Component.onCompleted: {
                if (!actionRow.isBox) return
                const d = root.fieldDraft
                const box = actionRow.field === "text" ? descInput : notesEdit
                box.text = d && d.view === root.view && d.id === root.formId() && d.field === actionRow.boxField ? d.text : actionRow.editText
                if (actionRow.editing) Qt.callLater(actionRow.takeFocus)
              }
              readonly property color ink: actionRow.hasCursor ? root.selectedText : root.foreground
              readonly property bool compact: actionRow.rowId === "tag"
              // Task rows: smaller type and a shorter row (the queue can get long).
              readonly property bool small: actionRow.rowId === "task" || actionRow.rowId === "tasks-clear"
              // "Clear finished processes": smaller still, one line.
              readonly property bool tiny: actionRow.rowId === "tasks-clear"

              width: ListView.view.width
              height: actionRow.field === "multiline" ? Math.max(root.rowHeight, Math.min(root.rowHeight * 5, notesEdit.contentHeight + root.rowDetailSize + Style.space(24)))
                : root.rowHeight
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
                font.pixelSize: root.rowIconSize
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
                spacing: root.lineGap

                Row {
                  width: parent.width
                  height: actionRow.field ? root.detailLine : root.titleLine
                  spacing: Style.space(8)

                  Text {
                    width: Math.min(implicitWidth, parent.width - (badgeBox.visible ? badgeBox.width + parent.spacing : 0) - (chipRow.visible ? Math.min(chipRow.implicitWidth, parent.width * 0.6) + parent.spacing : 0))
                    height: parent.height
                    verticalAlignment: Text.AlignVCenter
                    textFormat: Text.StyledText
                    text: actionRow.labelHtml
                    color: actionRow.ink
                    font.family: root.fontFamily
                    font.pixelSize: actionRow.field ? root.rowDetailSize : root.rowTitleSize
                    font.weight: actionRow.field ? Font.Normal : Font.Medium
                    opacity: actionRow.field ? 0.6 : 1
                    elide: Text.ElideRight
                    maximumLineCount: 1
                  }

                  // A task's status (a paper's Tasks, the Task row), or another kind's (pillKind)
                  Pill {
                    visible: actionRow.pill !== ""
                    anchors.verticalCenter: parent.verticalCenter
                    maxHeight: root.titleLine - Style.space(2)
                    text: actionRow.pill
                    kind: actionRow.pillKind || "task"
                    mode: "tag"
                    hot: actionRow.hasCursor
                    colors: root.pillColors
                    background: root.background
                    foreground: root.foreground
                    fontFamily: root.fontFamily
                    fontSize: root.sectionSize
                  }

                  // Labels as pills (a paper's taxonomy labels), in chipKind's colour
                  Row {
                    id: chipRow
                    visible: actionRow.chips !== ""
                    anchors.verticalCenter: parent.verticalCenter
                    width: Math.min(implicitWidth, parent.width * 0.6)
                    clip: true
                    spacing: Style.space(4)
                    Repeater {
                      model: actionRow.chips ? actionRow.chips.split("|") : []
                      delegate: Pill {
                        required property string modelData
                        anchors.verticalCenter: parent.verticalCenter
                        maxHeight: root.titleLine - Style.space(2)
                        text: modelData
                        kind: actionRow.chipKind || "neutral"
                        mode: "tag"
                        hot: actionRow.hasCursor
                        colors: root.pillColors
                        background: root.background
                        foreground: root.foreground
                        fontFamily: root.fontFamily
                        fontSize: root.sectionSize
                      }
                    }
                  }

                  // A mark: "auto" (an automatic tag), a percentage, "on" (a provider), a paper's status
                  Pill {
                    id: badgeBox
                    visible: actionRow.badge !== ""
                    anchors.verticalCenter: parent.verticalCenter
                    maxHeight: root.titleLine - Style.space(2)
                    padX: Style.space(10)
                    text: actionRow.badge
                    // a proposal's marks (new, changed, removed): new and changed as tags, removed faint
                    kind: actionRow.rowId === "paper-status" ? "status" : actionRow.badge === "new" ? "task" : actionRow.badge === "changed" ? "priority" : "neutral"
                    mode: actionRow.rowId === "paper-status" || actionRow.badge === "new" || actionRow.badge === "changed" ? "tag" : "off"
                    hot: actionRow.hasCursor
                    colors: root.pillColors
                    background: root.background
                    foreground: root.foreground
                    fontFamily: root.fontFamily
                    fontSize: root.sectionSize
                  }
                }

                // A task's description: one line, edited in place.
                TextInput {
                  id: descInput
                  width: parent.width
                  height: root.titleLine
                  verticalAlignment: TextInput.AlignVCenter
                  visible: actionRow.field === "text"
                  readOnly: !actionRow.editing
                  activeFocusOnPress: false
                  clip: true
                  color: actionRow.ink
                  selectionColor: Util.alpha(root.selectedText, 0.35)
                  font.family: root.fontFamily
                  font.pixelSize: root.rowTitleSize
                  font.weight: Font.Medium
                  cursorVisible: activeFocus
                  onTextChanged: if (activeFocus) root.draftField(actionRow.boxField, text)
                  Keys.onPressed: (event) => { if (root.fieldKey(event, false, descInput)) event.accepted = true }
                }

                // A task's notes: several lines (Enter is a new line), edited in place.
                TextEdit {
                  id: notesEdit
                  width: parent.width
                  visible: actionRow.field === "multiline"
                  readOnly: !actionRow.editing
                  activeFocusOnPress: false
                  wrapMode: TextEdit.Wrap
                  textFormat: TextEdit.PlainText
                  color: actionRow.ink
                  selectionColor: Util.alpha(root.selectedText, 0.35)
                  font.family: root.fontFamily
                  font.pixelSize: root.rowTitleSize
                  cursorVisible: activeFocus
                  onTextChanged: if (activeFocus) root.draftField(actionRow.boxField, text)
                  Keys.onPressed: (event) => { if (root.fieldKey(event, true, notesEdit)) event.accepted = true }
                  Text {
                    visible: !parent.text && !parent.activeFocus
                    textFormat: Text.PlainText
                    text: "None yet"
                    color: root.foreground
                    opacity: 0.4
                    font: parent.font
                  }
                }

                // A task's status or priority: every choice a pill, its own filled; as tall as the line.
                Row {
                  visible: actionRow.field === "pills"
                  height: root.detailLine
                  spacing: Style.space(4)
                  Repeater {
                    model: actionRow.field === "pills" ? actionRow.pills.split("|") : []
                    // every choice: the task's own on, the others off (Tab / Shift+Tab move along them)
                    delegate: Pill {
                      required property string modelData
                      anchors.verticalCenter: parent.verticalCenter
                      height: root.detailLine
                      text: modelData
                      kind: actionRow.pillKind || "task"
                      mode: modelData === actionRow.pillOn ? "on" : "off"
                      hot: actionRow.hasCursor
                      colors: root.pillColors
                      background: root.background
                      foreground: root.foreground
                      fontFamily: root.fontFamily
                      fontSize: root.sectionSize
                    }
                  }
                }

                Text {
                  width: parent.width
                  height: root.detailLine
                  verticalAlignment: Text.AlignVCenter
                  visible: text.length > 0 && !actionRow.field
                  textFormat: Text.PlainText
                  text: actionRow.detail
                  color: root.foreground
                  opacity: 0.55
                  font.family: root.fontFamily
                  font.pixelSize: root.rowDetailSize
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

          // ---- the paper's other notes, above the one being read (Shift+↑/↓ moves along them)
          ListView {
            id: noteSiblingList
            readonly property int lineHeight: root.sectionSize + Style.space(9)
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            height: visible ? Math.min(4, count) * lineHeight + Style.space(4) : 0
            visible: root.inNote && root.noteSiblings.length > 1
            model: visible ? root.noteSiblings : []
            clip: true
            interactive: false
            currentIndex: root.noteIndex
            onCurrentIndexChanged: if (currentIndex >= 0) positionViewAtIndex(currentIndex, ListView.Contain)
            delegate: Rectangle {
              id: sib
              required property var modelData
              required property int index
              readonly property bool current: sib.index === root.noteIndex
              width: ListView.view.width
              height: noteSiblingList.lineHeight
              radius: height / 2
              color: sib.current ? Util.alpha(root.selectedText, 0.16) : "transparent"
              border.width: sib.current ? 1 : 0
              border.color: Util.alpha(root.selectedText, 0.6)
              Text {
                anchors.left: parent.left
                anchors.leftMargin: Style.space(10)
                anchors.right: parent.right
                anchors.rightMargin: Style.space(10)
                anchors.verticalCenter: parent.verticalCenter
                textFormat: Text.PlainText
                text: (sib.index + 1) + "/" + root.noteSiblings.length + "   " + (sib.modelData.title || "Untitled note")
                color: sib.current ? root.selectedText : root.foreground
                opacity: sib.current ? 1 : 0.5
                font.family: root.fontFamily
                font.pixelSize: root.sectionSize
                font.weight: sib.current ? Font.Medium : Font.Normal
                elide: Text.ElideRight
              }
              MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: root.loadNote(sib.modelData)
              }
            }
          }

          // ---- one note, read as Markdown
          Flickable {
            id: noteFlick
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            anchors.top: noteSiblingList.visible ? noteSiblingList.bottom : parent.top
            anchors.topMargin: noteSiblingList.visible ? Style.space(6) : 0
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
                visible: text.length > 0 && !root.notePaperInView() // else the context bar names it
                textFormat: Text.PlainText
                // The paper, cited: "Sirmon et al. (2007) · Managing Firm Resources …"
                text: root.noteData && root.noteData.paper ? [Views.paperCite(root.noteData.paper), root.noteData.paper.title].filter(function(x) { return x }).join(" · ") : ""
                color: root.foreground
                opacity: 0.5
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                elide: Text.ElideRight
              }

              // Select with the mouse: the selection is copied as soon as it settles (a short "Copied"
              // in the footer); the keys stay with the launcher.
              TextEdit {
                id: noteText
                width: parent.width
                readOnly: true
                selectByMouse: true
                activeFocusOnPress: false
                selectionColor: Util.alpha(root.selectedText, 0.3)
                selectedTextColor: root.foreground
                textFormat: TextEdit.RichText
                wrapMode: TextEdit.Wrap
                onSelectedTextChanged: if (selectedText) noteCopyTimer.restart()
                Timer {
                  id: noteCopyTimer
                  interval: 350
                  onTriggered: root.copySelection(noteText.selectedText)
                }
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
            visible: root.inNote ? !noteFlick.visible : root.currentCount() === 0 && root.view !== "todo-due"
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

        // Footer, two rows under a faint line: the keys for where you are (as many whole hints as fit, the keys
        // brighter than what they do; ? keys lists them all), then what's going on: a confirmation, the last
        // error or a settings problem on the left; your open tasks, Zotero's last sync and the processes on the right.
        Item {
          id: footer
          width: parent.width
          height: root.footerHeight

          Rectangle {
            anchors.top: parent.top
            anchors.left: parent.left
            anchors.right: parent.right
            height: 1
            color: Util.alpha(root.foreground, 0.08)
          }

          FontMetrics { id: hintKeyMetrics; font.family: root.fontFamily; font.pixelSize: Style.font.caption; font.weight: Font.Medium }
          FontMetrics { id: hintTextMetrics; font.family: root.fontFamily; font.pixelSize: Style.font.caption }

          Item {
            id: hintRow
            anchors.top: parent.top
            anchors.topMargin: Style.space(3)
            anchors.left: parent.left
            anchors.leftMargin: Style.space(4)
            anchors.right: parent.right
            anchors.rightMargin: Style.space(4)
            height: (footer.height - Style.space(3) - root.footerGap) / 2
            clip: true

            readonly property int gap: Style.space(16)
            readonly property int inner: Style.space(5)
            readonly property var shown: {
              const all = root.hints().split("     ").map(function(h) { return h.trim() }).filter(function(h) { return h })
              const w = function(h) {
                const p = Views.hintParts(h)
                return (p.keys ? hintKeyMetrics.advanceWidth(p.keys) + (p.desc ? hintRow.inner : 0) : 0) + hintTextMetrics.advanceWidth(p.desc)
              }
              return Views.fitHints(all, w, hintRow.width, hintRow.gap)
            }

            Row {
              anchors.verticalCenter: parent.verticalCenter
              spacing: hintRow.gap
              Repeater {
                model: hintRow.shown
                delegate: Row {
                  id: hint
                  required property string modelData
                  readonly property var parts: Views.hintParts(modelData)
                  spacing: parts.keys && parts.desc ? hintRow.inner : 0
                  Text {
                    visible: hint.parts.keys !== ""
                    textFormat: Text.PlainText
                    text: hint.parts.keys
                    color: root.foreground
                    opacity: 0.8
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    font.weight: Font.Medium
                  }
                  Text {
                    textFormat: Text.PlainText
                    text: hint.parts.desc
                    color: root.foreground
                    opacity: 0.42
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                  }
                }
              }
            }
          }

          Item {
            id: statusRow
            anchors.bottom: parent.bottom
            anchors.left: parent.left
            anchors.leftMargin: Style.space(4)
            anchors.right: parent.right
            anchors.rightMargin: Style.space(4)
            height: hintRow.height

            // a paper's: its text and its taxonomies (when there's no message to show)
            Row {
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(6)
              visible: !noteLabel.visible && root.paperFooterPills.length > 0
              Repeater {
                model: root.paperFooterPills
                delegate: Pill {
                  required property var modelData
                  anchors.verticalCenter: parent.verticalCenter
                  padX: Style.space(10)
                  padY: Style.space(2)
                  text: modelData.text
                  kind: modelData.kind
                  mode: modelData.mode
                  colors: root.pillColors
                  background: root.background
                  foreground: root.foreground
                  fontFamily: root.fontFamily
                  fontSize: root.sectionSize
                }
              }
            }

            Text {
              id: noteLabel
              anchors.left: parent.left
              anchors.right: statusRight.left
              anchors.rightMargin: Style.space(14)
              anchors.verticalCenter: parent.verticalCenter
              visible: text !== ""
              textFormat: Text.PlainText
              text: root.footerNote()
              color: root.flash ? root.selectedText : root.lastError ? root.queryColors.neg : root.foreground
              opacity: root.flash ? 0.9 : 0.6
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
            }

            Row {
              id: statusRight
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(14)

              // Your open tasks per group, as badges (Tasks: t): the active group as a tag, the others faint
              Row {
                id: todoBadges
                readonly property var counts: root.service ? Todos.groupCounts(root.service.todos, root.todoStatuses) : []
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(4)
                visible: counts.length > 0
                Repeater {
                  model: todoBadges.counts
                  delegate: Pill {
                    required property var modelData
                    anchors.verticalCenter: parent.verticalCenter
                    padX: Style.space(10)
                    padY: Style.space(2)
                    text: modelData.name + " " + modelData.count
                    kind: "task"
                    mode: modelData.group === "active" ? "tag" : "off"
                    colors: root.pillColors
                    background: root.background
                    foreground: root.foreground
                    fontFamily: root.fontFamily
                    fontSize: root.sectionSize
                  }
                }
              }

              // In the results: when Zotero last synced (Sync Zotero, S)
              Text {
                id: syncLabel
                readonly property string say: root.atRoot && root.service ? Views.syncFooter(root.service.syncInfo, Date.now()) : ""
                anchors.verticalCenter: parent.verticalCenter
                visible: say !== ""
                textFormat: Text.PlainText
                text: "\uf021 " + say
                color: root.foreground
                opacity: 0.45
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
              }

              // The task queue, always: running (in the accent), finished, failed (the failures in red)
              Row {
                id: taskLabel
                readonly property var sum: Views.taskSummary(root.service ? root.service.processes : [])
                readonly property var parts: sum.text.split(" · ")
                anchors.verticalCenter: parent.verticalCenter
                visible: sum.text !== ""
                spacing: 0
                Repeater {
                  model: taskLabel.parts
                  delegate: Text {
                    required property string modelData
                    required property int index
                    readonly property bool failed: /failed/.test(modelData)
                    textFormat: Text.PlainText
                    text: (index === 0 ? (taskLabel.sum.running ? "⟳ " : taskLabel.sum.error ? "⚠ " : "✓ ") : " · ") + modelData
                    color: taskLabel.sum.running && index === 0 ? root.selectedText : failed ? root.queryColors.neg : root.foreground
                    opacity: (taskLabel.sum.running && index === 0) || failed ? 0.9 : 0.5
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
