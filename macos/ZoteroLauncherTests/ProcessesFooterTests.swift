import XCTest
@testable import ZoteroLauncher

// The bottom bar's processes (R2): running and pending while there are any, failures since Processes was last
// opened; nothing when there's nothing going on.
@MainActor
final class ProcessesFooterTests: XCTestCase {
    private var home: URL!
    private var runner: FakeRunner!
    private var model: LauncherModel!
    private var tasks: [[String: Any]] = []

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("pfoot-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        runner = FakeRunner()
        runner.answers["tasks"] = { [unowned self] _, _ in FakeRunner.json(["tasks": self.tasks]) }
        model = LauncherModel(bridge: FakeBridge(), desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: runner, fetcher: FakeFetcher())
        model.willShow()
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private func task(_ id: String, _ status: String, finished: String = "") -> [String: Any] {
        ["id": id, "status": status, "title": "Summary", "paper": "Doe (2016)", "key": "K", "libraryID": 1, "started": "2026-10-16T10:00:00Z", "finished": finished]
    }

    private func reload() {
        model.refreshTasks()
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
    }

    func testNothingGoingOnShowsNothing() {
        tasks = [task("t1", "done", finished: "2026-10-16T10:01:00Z")]
        reload()
        XCTAssertEqual(model.processesFooter, "")
    }

    func testRunningOnesAreCounted() {
        tasks = [task("t1", "running"), task("t2", "running"), task("t3", "done", finished: "2026-10-16T10:01:00Z")]
        reload()
        XCTAssertEqual(model.processesFooter, "2 running")
    }

    func testAFailureCountsUntilProcessesIsOpened() {
        // (ended after the app started; one from before it, a day old, isn't counted)
        let justNow = ISO8601DateFormatter().string(from: Date().addingTimeInterval(1))
        tasks = [task("t1", "running"), task("t2", "error", finished: justNow), task("t3", "error", finished: "2026-10-15T10:00:00Z")]
        reload()
        XCTAssertEqual(model.processesFooter, "1 running · 1 failed")
        RunLoop.main.run(until: Date().addingTimeInterval(1.5))
        model.openTasks()
        model.back()
        reload()
        XCTAssertEqual(model.processesFooter, "1 running", "seen in Processes: no longer counted")
    }

    // (review) in Processes the list says it all: the bar's count isn't repeated (nor clickable into Processes again)
    func testNotShownInProcessesItself() {
        tasks = [task("t1", "running")]
        reload()
        model.openTasks()
        XCTAssertEqual(model.processesFooter, "")
    }
}
