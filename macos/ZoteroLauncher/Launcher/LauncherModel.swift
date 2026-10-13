import AppKit
import Combine
import Foundation

// What the launcher shows: the query, the rows the bridge's answer becomes (through lib/Views.js),
// the highlighted row, and a status line. One search in flight at a time; the newest query wins.
final class LauncherModel: ObservableObject {
    @Published var query = "" {
        didSet { if query != oldValue { search() } }
    }
    @Published private(set) var rows: [SearchRow] = []
    @Published var selection = 0
    @Published private(set) var status = ""
    @Published private(set) var shown = 0 // counts openings: the view focuses the search box on each

    let bridge: BridgeClient
    private let core: JSCore?
    private let coreError: String?
    private var searching = false
    private var searchAgain = false

    init(bridge: BridgeClient = BridgeClient()) {
        self.bridge = bridge
        do {
            core = try JSCore()
            coreError = nil
        } catch {
            core = nil
            coreError = String(describing: error)
        }
    }

    func willShow() {
        shown += 1
        bridge.reload()
        search()
    }

    func search() {
        if searching {
            searchAgain = true
            return
        }
        searching = true
        let sent = query
        bridge.post("/search", ["query": sent, "limit": 50], timeout: 4) { [weak self] result in
            guard let self else { return }
            self.searching = false
            self.apply(result)
            if self.searchAgain || sent != self.query {
                self.searchAgain = false
                self.search()
            }
        }
    }

    private func apply(_ result: BridgeResult) {
        guard case .ok(let response) = result else {
            rows = []
            status = result.message
            return
        }
        guard let core else {
            status = coreError ?? "the view logic didn't load"
            return
        }
        do {
            rows = try core.searchRows(response, color: Self.accentHex)
            status = rows.isEmpty ? "Nothing matches" : ""
        } catch {
            rows = []
            status = String(describing: error)
        }
        selection = rows.firstIndex { $0.isPaper } ?? 0
    }

    func move(_ delta: Int) {
        guard !rows.isEmpty else { return }
        selection = min(max(selection + delta, 0), rows.count - 1)
    }

    // Enter: the paper in Zotero (its tab or PDF); Shift+Enter: selected in the library.
    func activate(reveal: Bool, then close: @escaping () -> Void) {
        guard rows.indices.contains(selection) else { return }
        let row = rows[selection]
        guard row.isPaper, !row.key.isEmpty else {
            status = "Only papers open from here, so far"
            return
        }
        bridge.post(reveal ? "/reveal" : "/open", ["key": row.key, "libraryID": row.libraryID]) { [weak self] result in
            if case .ok = result {
                Self.activateZotero()
                close()
            } else {
                self?.status = "Couldn't open “\(row.title)”: \(result.message)"
            }
        }
    }

    static func activateZotero() {
        _ = NSRunningApplication.runningApplications(withBundleIdentifier: "org.zotero.zotero").first?.activate()
    }

    // The highlight color for matches: the system accent, as lib/Views.js wants it ("#rrggbb").
    static var accentHex: String {
        guard let color = NSColor.controlAccentColor.usingColorSpace(.sRGB) else { return "#0a84ff" }
        let r = Int((color.redComponent * 255).rounded()), g = Int((color.greenComponent * 255).rounded()), b = Int((color.blueComponent * 255).rounded())
        return String(format: "#%02x%02x%02x", r, g, b)
    }
}
