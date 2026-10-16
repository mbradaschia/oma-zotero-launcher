import XCTest
@testable import ZoteroLauncher

// R7: a setting found from the search does what its row does (a toggle flips, an edit opens its editor), on its
// page so you see it change; the rows that clear, remove or read the clipboard are only shown, never done blind.
@MainActor
final class SettingHitTests: XCTestCase {
    private var home: URL!
    private var model: LauncherModel!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("r7-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        let bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed")
        bridge.answers["/search"] = { body in var a = typed; a["query"] = body["query"] ?? ""; return .ok(a) }
        bridge.answers["/item"] = { _ in .ok(Fixture.bridge("item")) }
        model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: FakeRunner(), fetcher: FakeFetcher())
        model.willShow()
    }
    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private var general: [String: Any] {
        let url = home.appendingPathComponent(".config/omarchy/oma-zotero-launcher.json")
        let file = ((try? Data(contentsOf: url)).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
        return file["general"] as? [String: Any] ?? [:]
    }

    private func enter(_ query: String, _ title: String) throws {
        model.setFilter(query)
        model.enterActions(try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "setting" && $0.title == title }, "no setting “\(title)”"))
    }

    func testAToggleFoundFromTheSearchFlipsOnItsPage() throws {
        try enter("keys on the results", "Keys on the results")
        XCTAssertEqual(model.store.view, "settings-general")
        XCTAssertEqual(model.selectedListRow?.label, "Keys on the results")
        XCTAssertEqual(general["accelerators"] as? Bool, false, "on by default: Enter turned it off")
        XCTAssertEqual(model.selectedListRow?.checked, false)
    }

    func testAnEditFoundFromTheSearchOpensItsEditor() throws {
        try enter("results per search", "Results per search")
        XCTAssertEqual(model.store.view, "settings-edit")
        model.back()
        XCTAssertEqual(model.store.view, "settings-general", "Back: the page it's on")
    }

    func testTheRowsThatClearOrRemoveAreOnlyShown() {
        // (and what runs, installs or stops: a catch-up, extracting everything, the AI features)
        for id in ["set-rules-reset", "set-system-reset", "set-key", "set-key-remove", "set-endpoint-remove", "tax-reset", "tax-delete", "set-info",
                   "set-catchup", "set-catchup-stop", "set-extract-all", "set-extract-retry", "set-extract-scans", "set-install", "set-setup"] {
            XCTAssertFalse(LauncherModel.doneFromTheSearch(id), id)
        }
        for id in ["set-toggle", "set-edit", "set-choice", "set-nav", "set-styles", "tax-review"] {
            XCTAssertTrue(LauncherModel.doneFromTheSearch(id), id)
        }
    }

    func testTheHintSaysWhatEnterDoes() throws {
        model.setFilter("keys on the results")
        model.store.selectedIndex = try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "setting" && $0.title == "Keys on the results" })
        XCTAssertTrue(model.hintsFor().contains("↵ change"), "\(model.hintsFor())")
        model.store.searchFocus = false
        XCTAssertTrue(model.hintsFor().contains("↵ change"), "\(model.hintsFor())")
    }

    func testEnterSaysWhatItDoesOnItsPageToo() {
        XCTAssertEqual(LauncherModel.settingVerb("set-catchup"), "run it")
        XCTAssertEqual(LauncherModel.settingVerb("set-install"), "install")
        XCTAssertEqual(LauncherModel.settingVerb("set-catchup-stop"), "stop it")
        XCTAssertEqual(LauncherModel.settingVerb("tax-review"), "review them")
        XCTAssertEqual(LauncherModel.settingKeyVerb(["defaults", "set-catchup", "recent", "Catch up"].joined(separator: "\u{1}")), "show it")
    }

    // a setting found from a paper's menu's search: its own verb, not the menu's ↵ run
    func testASettingInAMenuSaysItsVerb() throws {
        model.setFilter("work")
        model.enterActions(try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "item" }))
        model.setFilter("keys on the results")
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "setting-go" })
        model.store.searchFocus = false
        XCTAssertEqual(model.hintsFor().first, "↵ change", "\(model.hintsFor())")
    }

    // (review) no saved searches yet: the Mac's key for saving one
    func testTheEmptySavedSearchesSayCommandS() {
        model.openSearches()
        XCTAssertTrue(model.listRows.contains { $0.detail.contains("⌘S") && !$0.detail.contains("Ctrl") }, "\(model.listRows.map(\.detail))")
    }
}
