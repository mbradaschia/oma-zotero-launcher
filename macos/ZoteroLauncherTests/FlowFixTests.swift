import XCTest
@testable import ZoteroLauncher

// Flows found broken by driving the real app (ZoteroLauncherUITests), checked here on the fakes.
@MainActor
final class FlowFixTests: XCTestCase {
    private var home: URL!
    private var model: LauncherModel!
    private var bridge: FakeBridge!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("flow-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed")
        bridge.answers["/search"] = { body in var a = typed; a["query"] = body["query"] ?? ""; return .ok(a) }
        bridge.answers["/item"] = { _ in .ok(Fixture.bridge("item")) }
        let runner = FakeRunner()
        runner.answers["tasks"] = { _, _ in FakeRunner.json(["tasks": []]) }
        model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: runner, fetcher: FakeFetcher())
        model.willShow()
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private func settle() { RunLoop.main.run(until: Date().addingTimeInterval(0.3)) }

    // ---- empty states draw an SF Symbol (no Nerd Font needed)

    func testEveryEmptyStateHasASymbol() {
        func check(_ what: String) {
            let symbol = model.emptyState.symbol
            XCTAssertFalse(symbol.isEmpty, what)
            XCTAssertNotNil(NSImage(systemSymbolName: symbol, accessibilityDescription: nil), "\(what): \(symbol)")
        }
        model.setFilter("nothing")
        check("no matches")
        model.status = "zotero-down"
        check("Zotero down")
        XCTAssertEqual(model.emptyState.symbol, "exclamationmark.triangle")
        model.status = "ready"
        for place in ["todos", "tasks", "searches", "chats"] {
            model.goHome()
            model.openPlace(place)
            settle()
            check(place)
        }
    }

    // ---- the top level counts the library (GET /ping's index.count), as on Omarchy

    func testTheTopLevelCountsTheLibraryFromPing() {
        bridge.answers["/ping"] = { _ in .ok(["index": ["count": 2648]]) }
        model.willShow()
        settle()
        XCTAssertEqual(model.itemCount, 2648)
        XCTAssertTrue(model.countText.contains("2,648 items"), model.countText)
    }

    func testAnOlderBridgeWithoutACountShowsNone() {
        bridge.answers["/ping"] = { _ in .ok(["bridgeVersion": "0.2.0"]) }
        model.willShow()
        settle()
        XCTAssertEqual(model.itemCount, 0)
        XCTAssertFalse(model.countText.contains("items"), model.countText)
    }

    func testBackOutOfACollectionHighlightsItAgain() throws {
        model.setFilter("work") // (collections show for what's typed)
        settle()
        let collections = model.searchRows.enumerated().filter { $0.element.kind == "collection" }
        let (index, row) = try XCTUnwrap(collections.dropFirst().first, "the fixture has two collections")
        model.store.selectedIndex = index
        model.store.followTop = false
        model.enterActions(index)
        settle()
        XCTAssertEqual(model.store.scope?.key, row.key)
        model.back()
        settle()
        XCTAssertNil(model.store.scope)
        XCTAssertEqual(model.selectedSearchRow?.key, row.key, "back on the collection it left, not the first row")
    }

    func testHomeAndEndGoToTheFirstAndLastRow() throws {
        model.setFilter("work")
        settle()
        model.enterActions(try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "item" }))
        settle()
        let count = model.content.count
        XCTAssertGreaterThan(count, 3)
        _ = model.handle(KeyEvent(key: .end, text: ""))
        XCTAssertEqual(model.store.selectedIndex, count - 1)
        _ = model.handle(KeyEvent(key: .home, text: ""))
        XCTAssertEqual(model.store.selectedIndex, 0)
    }

    func testEnterOnNoTasksStartsOne() {
        model.openPlace("todos")
        XCTAssertEqual(model.store.view, "todos")
        XCTAssertTrue(model.listRows.isEmpty)
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "todo-new")
    }
}
