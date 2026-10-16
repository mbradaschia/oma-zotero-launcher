import XCTest
@testable import ZoteroLauncher

// R6: your saved searches found from the picker's search, by name or query; Enter opens one (its papers, as from
// the saved searches list), and the row says so.
@MainActor
final class SavedSearchHitTests: XCTestCase {
    private var home: URL!
    private var bridge: FakeBridge!
    private var model: LauncherModel!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("r6-\(UUID().uuidString)")
        let dir = home.appendingPathComponent(".config/omarchy/oma-zotero-launcher")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let list: [[String: Any]] = [["id": "s1", "name": "Resilience reading", "query": "resilience y:2015-2020", "pinned": false]]
        try JSONSerialization.data(withJSONObject: ["searches": list]).write(to: dir.appendingPathComponent("searches.json"))
        bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed")
        bridge.answers["/search"] = { body in
            var answer = typed
            answer["query"] = body["query"] ?? ""
            if let within = body["within"] as? [String: Any] {
                answer["scope"] = ["kind": "search", "key": within["id"] ?? "", "libraryID": 0, "title": within["title"] ?? "", "query": within["query"] ?? ""]
            }
            return .ok(answer)
        }
        model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: FakeRunner(), fetcher: FakeFetcher())
        model.willShow()
    }
    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    func testASavedSearchIsFoundAndEnterOpensIt() throws {
        model.setFilter("resilience")
        let i = try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "saved-search" }, "\(model.searchRows.map(\.title))")
        XCTAssertEqual(model.searchRows[i].title, "Resilience reading")
        XCTAssertTrue(model.searchRowOpens(model.searchRows[i]), "it opens a list: its arrow")
        model.store.selectedIndex = i
        XCTAssertTrue(model.hintsFor().contains("↵ its papers"), "\(model.hintsFor())")
        model.enterActions(i)
        XCTAssertEqual(model.store.view, "search")
        XCTAssertEqual(model.store.scope?.type, "search")
        XCTAssertEqual((bridge.bodies("/search").last?["within"] as? [String: Any])?["id"] as? String, "s1")
    }

    func testNotWhilePickingAPaper() {
        model.store.pickFor = "todo"
        model.setFilter("resilience")
        XCTAssertFalse(model.searchRows.contains { $0.kind == "saved-search" })
    }
}
