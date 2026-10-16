import XCTest
@testable import ZoteroLauncher

// The results' sort, named above them (R4): relevance, a sort with its direction, or a grouping; g cycles it,
// newest then oldest for each date.
@MainActor
final class SortLabelTests: XCTestCase {
    private var home: URL!
    private var model: LauncherModel!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("sort-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        let bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed")
        bridge.answers["/search"] = { body in var a = typed; a["query"] = body["query"] ?? ""; return .ok(a) }
        let runner = FakeRunner()
        runner.answers["tasks"] = { _, _ in FakeRunner.json(["tasks": []]) }
        model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: runner, fetcher: FakeFetcher())
        model.willShow()
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private func settle() { RunLoop.main.run(until: Date().addingTimeInterval(0.2)) }

    func testNothingTypedNothingSorted() {
        settle()
        XCTAssertEqual(model.sortLabel, "", "the top level's recent papers aren't sorted")
    }

    func testEachModeNamedWithItsDirection() {
        model.setFilter("work")
        settle()
        XCTAssertEqual(model.sortLabel, "By relevance")
        model.cycleGrouping(1)
        XCTAssertEqual(model.sortLabel, "Grouped by paper status")
        // on to the dates: newest, then oldest
        while !model.sortLabel.hasSuffix("added") { model.cycleGrouping(1) }
        XCTAssertEqual(model.sortLabel, "↓ Newest added")
        model.cycleGrouping(1)
        XCTAssertEqual(model.sortLabel, "↑ Oldest added")
        model.cycleGrouping(-1)
        XCTAssertEqual(model.sortLabel, "↓ Newest added")
    }
}
