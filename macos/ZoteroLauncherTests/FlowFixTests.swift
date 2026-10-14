import XCTest
@testable import ZoteroLauncher

// Flows found broken by driving the real app (ZoteroLauncherUITests), checked here on the fakes.
@MainActor
final class FlowFixTests: XCTestCase {
    private var home: URL!
    private var model: LauncherModel!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("flow-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        let bridge = FakeBridge()
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
