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
        for id in ["set-rules-reset", "set-system-reset", "set-key", "set-key-remove", "set-endpoint-remove", "tax-reset", "tax-delete", "set-info"] {
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
}
