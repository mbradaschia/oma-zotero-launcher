import Quickshell
import Quickshell.Wayland
import Quickshell.Hyprland
import QtQuick
import qs.Commons
import qs.Ui
import "lib/Views.js" as Views
import "lib/Fuzzy.js" as Fuzzy

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
  property string promptDropdown: "" // the dropdown showing its options: "model" | "effort" | ""
  property string promptTitleMode: "" // "create" | "rename" in the prompt-title view

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
  property int rowHeight: Math.max(Style.space(54), Style.font.title + Style.font.bodySmall + Style.spacing.rowPaddingX * 2)
  property int sectionHeight: Math.max(Style.space(26), Style.font.caption + Style.space(14))
  property int cardWidth: Math.min(Style.space(780), panel.width - Style.gapsOut * 2)
  property int cardHeight: Math.min(Style.space(640), panel.height - Style.gapsOut * 2)

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
    }
    root.rebuildSearch()
    root.requestSearch()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.opened = false
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
    root.filterText = text
    root.followTop = true
    pointerGate.reset()
    if (root.inSearch) root.requestSearch()
    else if (!root.inNote) root.rebuildList()
  }

  function scopeId(scope) {
    return scope ? scope.key + ":" + scope.libraryID : ""
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
    return { tasks: root.service.tasks, chats: root.service.chats ? root.service.chats.length : -1 }
  }

  function rebuildSearch() {
    const previousKey = root.selectedIndex >= 0 && root.selectedIndex < displayModel.count ? displayModel.get(root.selectedIndex).key : ""
    const rows = Views.buildRows(root.response, String(root.selectedText), root.atRoot ? root.workspaceExtras() : null)
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
    function onModelsChanged() { if (root.view === "prompts" || root.view === "prompt-edit") root.rebuildList() }
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
    root.viewStack = root.viewStack.concat([{ view: root.view, filterText: root.filterText, selectedIndex: root.selectedIndex, followTop: root.followTop, scope: root.collectionScope, pickFor: root.pickFor }])
    root.view = next
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
    else if (root.view === "prompts") rows = Views.buildPromptRows(root.service ? root.service.prompts : [], root.service ? root.service.models : null, root.filterText, color, Fuzzy.filter)
    else if (root.view === "prompt-edit") rows = Views.buildPromptEditor(root.promptEdit, root.service ? root.service.models : null, root.promptDropdown)
    else if (root.view === "prompt-title") rows = Views.buildTitleRows(root.filterText, root.promptTitleMode)
    else if (root.view === "tasks") rows = Views.buildTaskRows(root.service ? root.service.tasks : [], root.filterText, color, Fuzzy.filter)
    else if (root.view === "chats") rows = Views.buildChatRows(root.service ? root.service.chats : [], root.filterText, color, Fuzzy.filter)
    else rows = Views.filterRows(Views.buildActions(root.details, root.service ? root.service.pdfViewerLabel : "",
      root.service ? root.service.prompts : null, root.service ? root.service.promptsProblem : "",
      root.service ? Views.isPinned(root.service.pins, root.actionItem) : false), root.filterText)
    const keep = root.selectedIndex
    actionModel.clear()
    for (let i = 0; i < rows.length; i++) actionModel.append(rows[i])
    root.selectedIndex = root.followTop ? 0 : Math.max(0, Math.min(actionModel.count - 1, keep))
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
    if (row.kind === "collection") {
      if (!quick) root.openCollection(row) // the Alt keys are for papers
      return
    }
    if (row.kind === "tasks" || row.kind === "chats") {
      if (!quick) row.kind === "tasks" ? root.openTasks() : root.openChats()
      return
    }
    if (root.pickFor === "chat") {
      if (!quick) root.openChatWindow({ key: row.key, libraryID: row.libraryID, title: row.title }, "")
      return
    }
    root.actionItem = { key: row.key, libraryID: row.libraryID, title: row.title, itemType: row.itemType }
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
        if (row.noteKey) {
          root.openNoteView({ key: row.noteKey, libraryID: row.noteLibraryID, title: row.label })
        } else if (root.service && root.actionItem) {
          root.service.extractText(root.actionItem)
          root.flashMessage("Extracting the text: it's in Tasks (alt+q)")
        }
        break
      case "task":
        if (row.noteKey) root.openNoteView({ key: row.noteKey, libraryID: row.noteLibraryID, title: row.label })
        break
      case "tasks-clear":
        if (root.service) root.service.refreshTasks(true)
        break
      case "chat-new":
        root.pushView("search")
        root.pickFor = "chat"
        root.response = null
        root.rebuildSearch()
        root.requestSearch()
        break
      case "chat-open":
        root.openChatWindow({ key: row.itemKey, libraryID: row.itemLibraryID, title: row.itemTitle }, row.value)
        break
      case "prompts":
        root.pushView("prompts")
        root.rebuildList()
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
        root.toggleDropdown(row.rowId === "pe-model" ? "model" : "effort")
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
  function altKey(k) {
    const letter = String.fromCharCode(k).toLowerCase()
    if (letter === "z") { root.openInZotero(); return true }
    if (letter === "q") { if (root.view !== "tasks") root.openTasks(); return true } // the task queue, from anywhere
    if (root.view === "prompts") {
      if (letter === "e") { root.editSelectedPrompt(); return true }
    }
    const note = (root.view === "actions" || root.view === "notes" || root.view === "tasks") ? root.selectedNoteTarget() : null
    if (note) {
      if (letter === "w") { root.openNoteWindow(); return true }
      if (letter === "c" || letter === "s") { root.exportNote(letter === "c" ? "copy" : "save"); return true }
    }
    const paper = { o: "external", w: "window", n: "notes", t: "tags" }[letter]
    if (root.inSearch) {
      if (!root.accel) return false
      if (paper) { root.enterActions(root.selectedIndex, paper); return true }
      if (letter === "l") { root.revealSelected(); return true }
      if (letter === "p") { root.togglePinSelected(); return true }
      return false
    }
    if (!root.actionItem || root.view === "prompt-edit" || root.view === "prompt-title") return false
    if (letter === "p") {
      root.togglePin(root.actionItem)
      if (root.view === "actions") { root.followTop = false; root.rebuildList() }
      return true
    }
    if (letter === "l") { root.finish("reveal", null); return true }
    if (paper && root.details) {
      if (paper === root.view) return true // already there
      root.quickAction = paper
      root.runQuick()
      return true
    }
    return false
  }

  // ------------------------------------------------------------ collections

  // Enter on a collection: its papers (and those of its subcollections), searchable;
  // Esc or Backspace goes back to where you were.
  function openCollection(row) {
    root.pushView("search")
    root.collectionScope = { key: row.key, libraryID: row.libraryID, title: row.title }
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

  // Alt+P on a result.
  function togglePinSelected() {
    if (root.selectedIndex < 0 || root.selectedIndex >= displayModel.count) return
    const row = displayModel.get(root.selectedIndex)
    root.togglePin({ key: row.key, libraryID: row.libraryID, title: row.title, type: row.kind === "collection" ? "collection" : "item" })
    root.libraryChanged = false
    root.requestSearch()
  }

  // ------------------------------------------------------------ prompts

  // Enter on a prompt: the runner works in the background (a few minutes); the task shows
  // in Tasks (Alt+Q) and a notification says when the note is saved. The launcher stays.
  function runPrompt(row) {
    const item = root.actionItem
    if (!root.service || !item) return
    root.service.runPrompt(row.promptId, item)
    root.flashMessage("Running “" + row.label + "”: it's in Tasks (alt+q)")
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
    root.promptDropdown = ""
    root.pushView("prompt-edit")
    root.rebuildList()
    if (root.service) root.service.refreshModels()
  }

  // Enter on a Model/Effort row: show its options under it (the checked one selected), or hide them.
  function toggleDropdown(which) {
    const parent = which === "model" ? "pe-model" : "pe-effort"
    root.promptDropdown = root.promptDropdown === which ? "" : which
    root.followTop = false
    root.rebuildList()
    if (!root.selectRow(function(r) { return r.rowId === parent + "-opt" && r.checked })) root.selectRow(function(r) { return r.rowId === parent })
  }

  // An option picked: shown at once, saved by the runner (the list re-read confirms it).
  function choosePrompt(changes, parentRow) {
    const id = root.promptEdit.id
    root.promptEdit = Object.assign({}, root.promptEdit, changes)
    root.promptDropdown = ""
    root.followTop = false
    root.rebuildList()
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
      root.selectRow(function(r) { return r.rowId === "notes" })
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
    root.chatWindows = root.chatWindows.concat([w])
    w.done.connect(function() {
      root.chatWindows = root.chatWindows.filter(function(x) { return x !== w })
      if (root.service) root.service.refreshChats()
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
    return Math.round(Style.font.title * 1.5) * 3
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
      if (root.view === "prompt-edit" && root.promptDropdown) root.toggleDropdown(root.promptDropdown)
      else if (root.filterText && !root.inNote) root.setFilter("")
      else if (!root.atRoot) root.back()
      else root.dismiss()
      return true
    }
    if (root.inNote) return root.handleNoteKey(k, ctrl, shift, alt)
    // The same keys mean the same thing in every view (README: Keys).
    if (enter && shift) { root.openInZotero(); return true }
    if (alt && !ctrl && k >= Qt.Key_A && k <= Qt.Key_Z && root.altKey(k)) return true
    if (root.view === "tags" && ctrl && enter) {
      root.toggleTag(root.filterText, true)
      return true
    }
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
    if (k === Qt.Key_Up || (ctrl && (k === Qt.Key_K || k === Qt.Key_P))) { root.select(-1); return true }
    if (k === Qt.Key_Down || (ctrl && (k === Qt.Key_J || k === Qt.Key_N))) { root.select(1); return true }
    if (k === Qt.Key_PageUp) { root.select(-root.pageSize()); return true }
    if (k === Qt.Key_PageDown) { root.select(root.pageSize()); return true }
    if (root.inSearch) {
      if (k === Qt.Key_Tab || k === Qt.Key_Right) { root.enterActions(root.selectedIndex, ""); return true }
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

  // The note reader has no filter: keys scroll, copy, open or go back.
  // Nothing to edit here, so the list's Alt letters work bare: z (or Shift+Enter) Zotero,
  // w window, c copy, s save; j/k and the arrows scroll.
  function handleNoteKey(k, ctrl, shift, alt) {
    if (k === Qt.Key_Backspace || k === Qt.Key_Left || k === Qt.Key_H || k === Qt.Key_Backtab || (k === Qt.Key_Tab && shift)) root.back()
    else if (k === Qt.Key_C) root.exportNote("copy")
    else if (k === Qt.Key_S) root.exportNote("save")
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
    if (root.view === "tasks") return "‹ Tasks · prompts and extractions"
    if (root.view === "chats") return "‹ Chats · with your papers"
    if (root.pickFor === "chat" && root.inSearch) return "‹ New chat · pick the paper" + (root.collectionScope ? " in " + root.collectionScope.title : "")
    if (root.collectionScope) return "‹ " + root.collectionScope.title + " · search in it"
    return "Search Zotero…"
  }

  function countText() {
    if (root.view === "tasks") return Views.taskSummary(root.service ? root.service.tasks : []).text || "no tasks"
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

  function hints() {
    const listRow = !root.inSearch && root.selectedIndex >= 0 && root.selectedIndex < actionModel.count ? actionModel.get(root.selectedIndex) : null
    const noteKeys = "↵ read     ⇧↵ zotero     alt+w window     alt+c copy .md     alt+s save .md     ⌫ esc back"
    if (root.view === "actions") {
      if (listRow && (listRow.rowId === "note" || listRow.rowId === "read")) return noteKeys
      return "↵ run     ⇧↵ zotero     alt+o/w pdf     alt+n notes     alt+t tags     alt+p pin     ⌫ esc back"
    }
    if (root.view === "notes") return noteKeys
    if (root.inNote) return "⇧↵/z zotero     w window     c copy .md     s save .md     ↑↓ j k scroll     ⌫ esc back"
    if (root.view === "prompts") {
      if (listRow && listRow.rowId === "prompt") return "↵ run with Claude, save as a note     alt+e edit     ⌫ esc back"
      return "↵ create     ⌫ esc back"
    }
    if (root.view === "prompt-edit") {
      if (root.promptDropdown) return "↵ choose     esc close the list     ⌫ back"
      return "↵ change     ⌫ esc back"
    }
    if (root.view === "prompt-title") return (root.promptTitleMode === "create" ? "↵ create" : "↵ rename") + "     esc clear, then back"
    if (root.view === "files") return "↵ open     ⌫ esc back"
    if (root.view === "tasks") {
      if (listRow && listRow.rowId === "task" && listRow.noteKey) return "↵ read the note     ⇧↵ zotero     alt+w window     alt+c copy .md     alt+s save .md     ⌫ esc back"
      return "↵ run     ⌫ esc back"
    }
    if (root.view === "chats") return "↵ open     ⌫ esc back"
    if (root.view === "tags") {
      return root.tagState && !root.tagState.editable ? "read-only     ⌫ esc back"
        : "↵ add/remove     ctrl+↵ new tag     ⌫ esc back"
    }
    const cur = root.inSearch && root.selectedIndex >= 0 && root.selectedIndex < displayModel.count ? displayModel.get(root.selectedIndex) : null
    const esc = root.collectionScope ? "⌫ esc back" : "esc close"
    if (root.pickFor === "chat") return "↵ chat about it     ⌫ esc back"
    if (cur && (cur.kind === "tasks" || cur.kind === "chats")) return "↵ open     alt+q tasks     esc close"
    if (cur && cur.kind === "collection") return "↵ open     ⇧↵ zotero     alt+p pin     " + esc
    if (!root.accel) return "↵ menu     ⇧↵ zotero     " + esc
    return "↵ menu     ⇧↵ zotero     alt+o/w pdf     alt+n notes     alt+t tags     alt+p pin     alt+l library     " + esc
  }

  // Footer, right side: a flash message, else the last error, else a settings problem.
  function footerNote() {
    if (root.flash) return root.flash
    if (root.lastError && root.currentCount() > 0) return root.lastError
    const problems = root.service ? root.service.settingsProblems : []
    if (problems && problems.length) return "oma-zotero-launcher.json: " + problems[0]
    const sum = Views.taskSummary(root.service ? root.service.tasks : [])
    return sum.running ? "⟳ " + sum.text : ""
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
      pageup: Qt.Key_PageUp, pagedown: Qt.Key_PageDown, home: Qt.Key_Home, end: Qt.Key_End, space: Qt.Key_Space
    }
    let code
    let text = ""
    if (named[key] !== undefined) {
      code = named[key]
      if (key === "space") text = " "
      if (key === "tab" && (modifiers & Qt.ShiftModifier)) code = Qt.Key_Backtab
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
        noteKey: a.noteKey, tag: a.tag, checked: a.checked, badge: a.badge, trailing: a.trailing, swatch: a.swatch,
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
    function type(text: string): string { if (!root.opened) return "closed"; if (root.inNote) return "ignored"; root.setFilter(root.filterText + text); return "ok" }
    function key(name: string): string { return root.opened ? root.pressKey(name) : "closed" }
    function state(): string { return JSON.stringify(root.snapshot()) }
  }

  // ------------------------------------------------------------ view

  PointerMoveGate { id: pointerGate; referenceItem: card }

  OverlayWindow {
    id: panel
    shown: root.opened
    WlrLayershell.namespace: "oma-zotero"

    Rectangle {
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

          Text {
            anchors.left: parent.left
            anchors.leftMargin: Style.space(4)
            anchors.right: countLabel.left
            anchors.rightMargin: Style.space(12)
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: root.filterText || root.placeholder()
            color: root.foreground
            opacity: root.filterText ? 1 : 0.58
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
                font.pixelSize: Style.font.caption
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

              readonly property bool hasCursor: row.index === root.selectedIndex
              readonly property color ink: row.hasCursor ? root.selectedText : root.foreground

              width: ListView.view.width
              height: root.rowHeight
              radius: root.cornerRadius
              color: row.hasCursor ? root.selectedBackground : "transparent"
              borderSpec: row.hasCursor ? root.selectedBorderSpec : Border.none()

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
                font.pixelSize: Style.font.iconLarge
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
                  font.pixelSize: Style.font.title
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
                    font.pixelSize: Style.font.bodySmall
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
                    font.pixelSize: Style.font.bodySmall
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
                        font.pixelSize: Style.font.caption
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
                  font.pixelSize: Style.font.bodySmall
                }

                Text {
                  visible: row.noteCount > 0
                  textFormat: Text.PlainText
                  text: " " + row.noteCount
                  color: root.foreground
                  opacity: 0.5
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                }

                // ● open in Zotero; accent = the tab Zotero is showing right now
                Text {
                  visible: row.openState !== ""
                  textFormat: Text.PlainText
                  text: "●"
                  color: row.openState === "current" ? root.selectedText : root.foreground
                  opacity: row.openState === "current" ? 1 : 0.6
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
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

              width: ListView.view.width
              height: actionRow.compact ? Math.round(root.rowHeight * 0.72) : actionRow.small ? Math.round(root.rowHeight * 0.82) : root.rowHeight
              radius: root.cornerRadius
              opacity: actionRow.available ? 1 : 0.4
              color: actionRow.hasCursor ? root.selectedBackground : "transparent"
              borderSpec: actionRow.hasCursor ? root.selectedBorderSpec : Border.none()

              // Icon, or the tag's check mark
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
                font.pixelSize: actionRow.showCheck ? Style.font.title : Style.font.iconLarge
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
                    font.pixelSize: actionRow.small ? Style.font.body : Style.font.title
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
                      font.pixelSize: Style.font.caption
                    }
                  }
                }

                Text {
                  width: parent.width
                  visible: text.length > 0
                  textFormat: Text.PlainText
                  text: actionRow.detail
                  color: root.foreground
                  opacity: 0.55
                  font.family: root.fontFamily
                  font.pixelSize: actionRow.small ? Style.font.caption : Style.font.bodySmall
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
                font.pixelSize: Style.font.bodySmall
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
                text: root.inNote && root.noteData ? Views.noteHtml(root.noteParts.html, { size: Style.font.title, color: root.hex6(root.foreground),
                  accent: root.hex6(root.selectedText), dim: "rgba(" + Math.round(root.foreground.r * 255) + "," + Math.round(root.foreground.g * 255) + "," + Math.round(root.foreground.b * 255) + ",0.7)" }) : ""
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
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
            anchors.right: noteLabel.visible ? noteLabel.left : parent.right
            anchors.rightMargin: noteLabel.visible ? Style.space(12) : 0
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
            anchors.right: parent.right
            anchors.rightMargin: Style.space(4)
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
        }
      }
    }
  }
}
