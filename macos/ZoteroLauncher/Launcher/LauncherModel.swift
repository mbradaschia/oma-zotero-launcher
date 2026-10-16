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
    let runner: Runner
    let bridgeDownloader: BridgeDownloader
    let core: JSCore?
    let coreError: String?
    var close: () -> Void = {}

    @Published var content: Content = .search([])
    var backToKey: String? // the collection or tag just left: its row is highlighted when the results come back
    @Published var flash = ""
    @Published var lastError = ""
    @Published var loading = false
    // Zotero's, from the last answer: ready, zotero-down, bridge-missing, unauthorized
    @Published var status = "unknown" { didSet { if status == "ready" && oldValue != "ready" { zoteroIsBack() } } }
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
    var searchesFile: SearchesFile?
    let env: [String: String]

    // The search.
    var response: [String: Any]?
    var scopeTotal = ""
    var libraryChanged = false
    private var searchInFlight = false
    private var searchPending = false
    var requestedScope = "" // the scope (and a saved search's query) last searched in

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
    var tasks = TaskState()
    @Published var searchState = SearchState()
    var syncTimer: Timer?
    var runnerState = RunnerState()
    var laterNote = "" // failed after the launcher closed: said when it opens
    var ai = AIState()
    var sched = SchedulerState()
    var chat = ChatsState()
    var tax = TaxonomyState()
    var keysHere: [String: Any]? // where the keys view was opened (Views.keysContext): its Here section
    // The paper's pills (the footer's, the taxonomy strip's), made as the list is (not at every redraw: each is a
    // JavaScriptCore call over the paper's details).
    @Published private(set) var paperPills: [Pill] = []
    @Published private(set) var taxonomyStrip: [String: Any]?
    func refreshPaperPills() {
        paperPills = computePaperPills
        taxonomyStrip = computeTaxonomyStrip
    }
    var openChat: (PaperRef, String) -> Void = { _, _ in } // a paper's chat window, on a past chat or its latest (LauncherPanel's ChatWindows)
    var showMenuFor: ((PaperRef, [String: Any]) -> Void)? // the launcher shown, on a paper's menu (a chat window's Menu)
    var showLauncher: (() -> Void)? // the launcher shown (a chat window's About another paper…)
    var chatDeleted: (PaperRef, String) -> Void = { _, _ in } // a chat deleted in the launcher: its window, if open on it, starts anew
    var extractFile: ExtractFile?
    var tasksWatcher: FolderWatcher?
    var instructionsWatcher: FolderWatcher?
    var tasksTimer: Timer?
    var extractTimer: Timer?
    var setupTimer: Timer?
    var expandedNotes: [String: [Any]] = [:] // papers whose notes show under them in the results (Space)
    var statusTimer: Timer?
    var taskTimer: Timer?
    weak var noteDisplay: NoteDisplay?
    var syncWatcher: FolderWatcher?
    var watching = ""
    var openWindow: ([String: Any]) -> Void = { _ in } // a note window (LauncherController's)
    var closeNoteWindow: (String) -> Void = { _ in } // a deleted note's window, if open

    private var flashTimer: Timer?
    private var keyTimer: Timer?

    // `runner` and `fetcher` have no defaults: a test must say what answers for them (never the
    // runner installed on this Mac, nor GitHub).
    init(bridge: Bridge = BridgeClient(), desktop: Desktop = SystemDesktop(), env: [String: String] = AppPaths.environment(), store: AppStore? = nil,
         runner: Runner, fetcher: Fetcher) {
        self.bridge = bridge
        self.desktop = desktop
        self.runner = runner
        self.bridgeDownloader = BridgeDownloader(fetcher: fetcher)
        self.env = env
        self.store = store ?? AppStore()
        do {
            core = try JSCore()
            coreError = nil
        } catch {
            core = nil
            coreError = String(describing: error)
        }
        self.store.levelChanged = { [weak self] in self?.lastError = "" } // as pushView and back do
        self.store.crumbName = { [weak self] in self?.crumbTitle(current: false) ?? "" }
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
        if !resuming { searchState.active = "" } // a fresh start is in All (ZoteroSearch.qml:293)
        if !laterNote.isEmpty {
            flashMessage(laterNote) // something that failed while the launcher was away
            laterNote = ""
        }
        note.cache = [:]
        tags.cache = [:]
        searchState.facetCache = [:]
        refreshSync() // when Zotero last synced: the footer says
        refreshTasks() // the processes, with those whose runner died marked (ZoteroSearch.qml:309)
        refreshChats() // the chats and artifacts: the root's Chats row, a paper's menu
        refreshArtifacts()
        tax.tagCounts = nil // (the @ picker's taxonomy values: counted again this opening)
        refreshTaxonomies() // a paper's taxonomy rows and pills
        // a taxonomy's page left open: read again (its file may have been edited meanwhile; a save would write over it)
        if ["settings-taxonomy", "settings-tax-label"].contains(store.view), !tax.editId.isEmpty { reloadTaxonomy() }
        if store.inSettings { // back in Settings: what may have changed meanwhile (a key, Node, an install)
            refreshProviders()
            refreshModels()
            refreshRequirements()
        }
        if tasks.tagsSynced { syncStatusLists() } // statuses made or renamed in Zotero (the first sync does it too)
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

    // ---- the search (ZoteroSearch.qml:448-486, 625-650; Service.qml:625-645)

    func setFilter(_ text: String) {
        store.filterText = text
        store.caretBack = 0
        store.queryLive = false
        store.followTop = true
        if store.inSearch { requestSearch() } else if store.view == "picker-values" { refreshFacets() } else { rebuildList() }
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
        requestedScope = scopeKey(searchScope)
        let pinsJSON = (pins?.pins ?? []).map(\.json)
        let body: [String: Any]
        do {
            let json = try core.glueJSON("searchBody", [store.filterText, scopeJSON, settings.json, pinsJSON, [Any](), chat.chats ?? [], [Any]()])
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
        noteBridge(result)
        if case .ok = result { syncTaskTags() } // once a session: every paper's t/ tags from its tasks
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
        refreshPaperPills() // (none in the results)
        let previous = backToKey ?? selectedSearchRow?.key ?? ""
        var rows: [SearchRow] = []
        if let response {
            let order = prefs?.sectionOrder(sectionKey) ?? []
            // Go to: the launcher's places that match what is typed, only those the Mac has by now; not while picking a paper
            var extras: [String: Any] = ["noCommands": !store.pickFor.isEmpty, "statuses": paperStatusTags, "keys": singleKeys ? "single" : "alt",
                                         "have": Self.goToPlaces, "sync": searchState.sync ?? NSNull(), "now": nowMs,
                                         "chats": runnerInstalled ? chat.chats?.count ?? 0 : -1, // the root's Chats row
                                         "extracting": extractFile?.catchup != nil] // (Extract every paper's text says it's on)
            if !store.filterText.trimmingCharacters(in: .whitespaces).isEmpty {
                extras["settingsIndex"] = settingsIndex // Settings found by name
                extras["searches"] = searchesJSON // and your saved searches (R6)
            }
            if let scope = searchScope, store.pickFor.isEmpty { extras["scopeTitle"] = "“\(scope.title)”" }
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
        store.selectedIndex = Self.selectionAfter(rows, previousKey: previous, followTop: backToKey == nil && store.followTop)
        if response != nil { backToKey = nil } // (kept while the answer is on its way)
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
