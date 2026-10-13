import AppKit
import Combine
import Foundation

// The launcher: where you are (AppStore), what the list shows, and what each key and row does,
// ported from ZoteroSearch.qml view by view. This file: the state, opening, the shared files and
// the search; the menu, the arrangement, the keys and the chrome are in the extensions beside it.
@MainActor
final class LauncherModel: ObservableObject {
    let store: AppStore
    let bridge: Bridge
    let desktop: Desktop
    let core: JSCore?
    let coreError: String?
    var close: () -> Void = {}

    @Published var content: Content = .search([])
    @Published var flash = ""
    @Published var lastError = ""
    @Published var loading = false
    @Published var status = "unknown" // Zotero's, from the last search: ready, zotero-down, bridge-missing, unauthorized
    @Published var windowed = false
    @Published private(set) var shown = 0 // counts openings: the view focuses on each
    private(set) var opened = false // shown: answers and timers for a launcher that closed do nothing

    // The files (contracts/Paths.js): read on each open.
    var paths: AppPaths?
    var pathsJSON: [String: Any] = [:]
    var settings: AppSettings?
    var pins: PinsFile?
    var prefs: ViewPrefs?
    var todos: TodosFile?
    let env: [String: String]

    // The search.
    var response: [String: Any]?
    var scopeTotal = ""
    var libraryChanged = false
    private var searchInFlight = false
    private var searchPending = false

    // A paper's menu and its views.
    var actionItem: PaperRef?
    var details: [String: Any]?
    var detailsSerial = 0
    var quickAction = ""
    var pendingSelect: ((ListRow) -> Bool)?
    var filePurpose = "external"
    var confirmAsk: ConfirmAsk?
    var citePreview: CitePreview?
    var menuRows: [ListRow] = [] // the menu in your order, before the pins and the filter
    var visibleTop = 0 // the first row in view (1…9 count from it)
    var pageSize = 8

    // Phase 4a's views.
    var note = NoteState()
    var tags = TagState()
    var marks = PaperMarks()
    var settingsView = SettingsState()
    var expandedNotes: [String: [Any]] = [:] // papers whose notes show under them in the results (Space)
    var statusTimer: Timer?
    var taskTimer: Timer?
    weak var noteDisplay: NoteDisplay?
    var openWindow: ([String: Any]) -> Void = { _ in } // a note window (LauncherController's)

    private var flashTimer: Timer?
    private var keyTimer: Timer?

    init(bridge: Bridge = BridgeClient(), desktop: Desktop = SystemDesktop(), env: [String: String] = AppPaths.environment(), store: AppStore? = nil) {
        self.bridge = bridge
        self.desktop = desktop
        self.env = env
        self.store = store ?? AppStore()
        do {
            core = try JSCore()
            coreError = nil
        } catch {
            core = nil
            coreError = String(describing: error)
        }
    }

    var searchRows: [SearchRow] { if case .search(let rows) = content { return rows } else { return [] } }
    var listRows: [ListRow] { if case .list(let rows) = content { return rows } else { return [] } }
    var selectedSearchRow: SearchRow? { searchRows.indices.contains(store.selectedIndex) ? searchRows[store.selectedIndex] : nil }
    var selectedListRow: ListRow? { listRows.indices.contains(store.selectedIndex) ? listRows[store.selectedIndex] : nil }
    var singleKeys: Bool { settings?.singleKeys ?? true }
    var settingsJSON: RawJSON { settings?.json ?? RawJSON(text: "{}") }

    // ---- opening (ZoteroSearch.qml:262-408)

    // The launcher shown: the files read again, then where you left it (or the results).
    func willShow(query: String? = nil) {
        shown += 1
        opened = true
        bridge.reload()
        loadFiles()
        let resuming = store.open(query: query)
        flash = ""
        lastError = ""
        // what Zotero has now comes with the search (ZoteroSearch.qml:276); notes and tags are asked again (288, 374)
        if !resuming && marks.statusPending.isEmpty { marks.statusShown = [:] }
        note.cache = [:]
        tags.cache = [:]
        if store.inSearch {
            if !resuming { response = nil }
            rebuildSearch()
            requestSearch()
        } else {
            if actionItem != nil && ["actions", "notes", "files"].contains(store.view) { refreshDetails() }
            rebuildList()
        }
    }

    func dismiss() {
        close()
        windowed = false
    }

    // The launcher is hidden (dismissed, or it lost the keys): nothing waits to act.
    func didHide() {
        opened = false
        keyTimer?.invalidate()
        store.keys.clear()
        quickAction = ""
    }

    func flashMessage(_ text: String) {
        flash = text
        flashTimer?.invalidate()
        flashTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.flash = "" }
        }
    }

    // ---- the shared files

    func loadFiles() {
        guard let core else { return }
        do {
            let (paths, machine, raw) = try AppPaths.resolveAll(core, env: env)
            self.paths = paths
            pathsJSON = raw
            let settings = AppSettings.load(core, paths: paths, machine: machine)
            self.settings = settings
            pins = PinsFile.load(URL(fileURLWithPath: paths.pins), readOnly: paths.readOnly, core: core)
            prefs = ViewPrefs.load(URL(fileURLWithPath: paths.view), readOnly: paths.readOnly)
            todos = TodosFile.load(URL(fileURLWithPath: paths.todos), readOnly: paths.readOnly, core: core)
            store.searchFirst = settings.searchFirst
            store.keys = KeyBuffer(delay: settings.keyDelay)
        } catch {
            lastError = String(describing: error)
        }
    }

    // A change refused while the sync folder is away, or a write that failed: said in the footer.
    func saved(_ write: () throws -> Void) {
        if syncFolderGone {
            lastError = "The sync folder isn't there: nothing synced is changed (Settings › General)"
            return
        }
        do { try write() } catch PinsFile.WriteError.readOnly, ViewPrefs.WriteError.readOnly, TodosFile.WriteError.readOnly {
            lastError = "The sync folder isn't there: nothing synced is changed (Settings › General)"
        } catch PinsFile.WriteError.damaged {
            lastError = "pins.json isn't valid: not changed, so your pins aren't lost (fix or remove it)"
        } catch TodosFile.WriteError.damaged {
            lastError = "todos.json isn't valid: not changed, so your tasks aren't lost (fix or remove it)"
        } catch ViewPrefs.WriteError.damaged {
            lastError = "view.json isn't valid: not changed, so your arrangement isn't lost (fix or remove it)"
        } catch {
            lastError = "Couldn't save it: \(error)"
        }
    }

    // A sync folder set whose marker went away since the files were read (renamed, a drive gone):
    // writing would make a lone copy of the folder.
    var syncFolderGone: Bool {
        guard let marker = paths?.marker, paths?.readOnly == false else { return false }
        return !FileManager.default.fileExists(atPath: marker)
    }

    // ---- the search (ZoteroSearch.qml:448-486, 625-650; Service.qml:625-645)

    func setFilter(_ text: String) {
        store.filterText = text
        store.caretBack = 0
        store.followTop = true
        if store.inSearch { requestSearch() } else { rebuildList() }
    }

    // One search in flight; a newer query waits and replaces any other waiting (Client.enqueue).
    func requestSearch() {
        loading = true
        if searchInFlight {
            searchPending = true
            return
        }
        guard let core, let settings else { return finishSearch(.error(coreError ?? (lastError.isEmpty ? "the settings didn't load" : lastError))) }
        searchInFlight = true
        let pinsJSON = (pins?.pins ?? []).map(\.json)
        let body: [String: Any]
        do {
            let json = try core.glueJSON("searchBody", [store.filterText, scopeJSON, settings.json, pinsJSON, [Any](), [Any](), [Any]()])
            body = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] ?? [:]
        } catch {
            searchInFlight = false
            return finishSearch(.error(String(describing: error)))
        }
        bridge.post("/search", body, timeout: 4) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.searchInFlight = false
                if self.searchPending {
                    self.searchPending = false
                    self.requestSearch() // the newest query; this answer is already old
                } else {
                    self.finishSearch(result)
                }
            }
        }
    }

    private func finishSearch(_ result: BridgeResult) {
        loading = false
        switch result {
        case .ok: status = "ready"
        case .zoteroDown, .noHandshake: status = "zotero-down"
        case .bridgeMissing: status = "bridge-missing"
        case .unauthorized: status = "unauthorized"
        default: break
        }
        switch result {
        case .ok(let answer):
            guard !store.inSearch || answerFitsHere(answer) else { return } // another level's (one you left)
            response = answer
            noteScopeTotal(answer)
            lastError = ""
            if store.inSearch { rebuildSearch() }
        case .zoteroDown, .noHandshake:
            response = nil
            lastError = result.message
            if store.inSearch { rebuildSearch() }
        default:
            lastError = result.message
        }
    }

    // The results' rows from the last answer (Glue.results), the selection kept or at the top.
    func rebuildSearch() {
        guard let core else { return }
        let previous = selectedSearchRow?.key ?? ""
        var rows: [SearchRow] = []
        if let response {
            let order = prefs?.sectionOrder(sectionKey) ?? []
            var extras: [String: Any] = ["noCommands": true, "statuses": paperStatusTags]
            if let scope = store.scope, store.pickFor.isEmpty { extras["scopeTitle"] = "“\(scope.title)”" }
            let mode = prefs?.values["grouping"] as? String ?? "relevance"
            let grouping: Any = mode == "relevance" ? NSNull() : ["mode": mode, "info": ["statuses": paperStatusTags, "tasks": defaultTasks, "taskStatuses": todoStatuses]]
            do {
                rows = try core.glue("results", [response, Self.accentHex, extras, order.isEmpty ? NSNull() : order, grouping, expandedNotes.isEmpty ? NSNull() : expandedNotes], as: [SearchRow].self)
            } catch {
                lastError = String(describing: error)
            }
        }
        // statuses changed here win over what the last search said (Zotero may not have them yet)
        for i in rows.indices where rows[i].kind == "item" {
            if let shown = marks.statusShown["\(rows[i].libraryID):\(rows[i].key)"] { rows[i].status = shown }
        }
        content = .search(rows)
        store.selectedIndex = Self.selectionAfter(rows, previousKey: previous, followTop: store.followTop)
    }

    // lib/Views.js's selectionAfter: the same row if it is still there and you moved, else the first
    // row that isn't a place to go.
    static func selectionAfter(_ rows: [SearchRow], previousKey: String, followTop: Bool) -> Int {
        guard !rows.isEmpty else { return 0 }
        let first = rows.firstIndex { $0.section != "Processes and chats" && $0.section != "Go to" } ?? 0
        if followTop || previousKey.isEmpty { return first }
        return rows.firstIndex { $0.key == previousKey } ?? first
    }

    // Which menu's section order applies (ZoteroSearch.qml's sectionKey).
    var sectionKey: String {
        if store.inSearch { return "search:" + (store.scope != nil ? "scope" : store.filterText.isEmpty ? "empty" : "typed") }
        return store.view
    }

    // The highlight color for matches: the system accent, as lib/Views.js wants it ("#rrggbb").
    static var accentHex: String {
        guard let color = NSColor.controlAccentColor.usingColorSpace(.sRGB) else { return "#0a84ff" }
        let r = Int((color.redComponent * 255).rounded()), g = Int((color.greenComponent * 255).rounded()), b = Int((color.blueComponent * 255).rounded())
        return String(format: "#%02x%02x%02x", r, g, b)
    }

    // ---- the single-key wait

    func scheduleKeyTick() {
        keyTimer?.invalidate()
        guard let deadline = store.keys.deadline else { return }
        keyTimer = Timer.scheduledTimer(withTimeInterval: max(0, deadline.timeIntervalSinceNow), repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.opened else { return }
                for command in self.store.keys.tick(at: Date()) { _ = self.execute(command) }
            }
        }
    }
}
