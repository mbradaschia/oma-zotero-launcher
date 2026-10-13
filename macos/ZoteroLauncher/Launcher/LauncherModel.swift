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
    @Published var windowed = false
    @Published private(set) var shown = 0 // counts openings: the view focuses on each

    // The files (contracts/Paths.js): read on each open.
    var paths: AppPaths?
    var settings: AppSettings?
    var pins: PinsFile?
    var prefs: ViewPrefs?
    let env: [String: String]

    // The search.
    var response: [String: Any]?
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

    // ---- opening (ZoteroSearch.qml:262-408)

    // The launcher shown: the files read again, then where you left it (or the results).
    func willShow(query: String? = nil) {
        shown += 1
        bridge.reload()
        loadFiles()
        let resuming = store.open(query: query)
        flash = ""
        lastError = ""
        if store.inSearch {
            if !resuming { response = nil }
            rebuildSearch()
            requestSearch()
        } else {
            if actionItem != nil && ["actions", "files"].contains(store.view) { refreshDetails() }
            rebuildList()
        }
    }

    func dismiss() {
        close()
        windowed = false
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
            let (paths, machine) = try AppPaths.resolve(core, env: env)
            self.paths = paths
            let settings = AppSettings.load(core, paths: paths, machine: machine)
            self.settings = settings
            pins = PinsFile.load(URL(fileURLWithPath: paths.pins), readOnly: paths.readOnly, core: core)
            prefs = ViewPrefs.load(URL(fileURLWithPath: paths.view), readOnly: paths.readOnly)
            store.searchFirst = settings.searchFirst
            store.keys = KeyBuffer(delay: settings.keyDelay)
        } catch {
            lastError = String(describing: error)
        }
    }

    // A change refused while the sync folder is away, or a write that failed: said in the footer.
    func saved(_ write: () throws -> Void) {
        do { try write() } catch PinsFile.WriteError.readOnly, ViewPrefs.WriteError.readOnly {
            lastError = "The sync folder isn't there: nothing synced is changed (Settings › General)"
        } catch {
            lastError = "Couldn't save it: \(error)"
        }
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
        guard let core, let settings else { return finishSearch(.error(coreError ?? "the view logic didn't load")) }
        searchInFlight = true
        let pinsJSON = (pins?.pins ?? []).map(\.json)
        let body: [String: Any]
        do {
            let json = try core.glueJSON("searchBody", [store.filterText, NSNull(), settings.raw, pinsJSON, [Any](), [Any](), [Any]()])
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
        case .ok(let answer):
            response = answer
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
            let statuses = (settings?.values.paperStatuses ?? []).map { "s/\($0)" }
            let order = prefs?.sectionOrder(sectionKey) ?? []
            do {
                rows = try core.glue("results", [response, Self.accentHex, ["noCommands": true, "statuses": statuses], order.isEmpty ? NSNull() : order], as: [SearchRow].self)
            } catch {
                lastError = String(describing: error)
            }
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
                guard let self else { return }
                for command in self.store.keys.tick(at: Date()) { _ = self.execute(command) }
            }
        }
    }
}
