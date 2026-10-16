import XCTest
@testable import ZoteroLauncher

// R14 and R15: Processes stops everything at once (what waits, and what runs), and its pills show one state at a time.
@MainActor
final class ProcessesControlsTests: XCTestCase {
    private var home: URL!
    private var runner: FakeRunner!
    private var model: LauncherModel!
    private var tasks: [[String: Any]] = []
    private var killed: [Int32] = []

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("pctl-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        runner = FakeRunner()
        runner.answers["tasks"] = { [unowned self] _, _ in FakeRunner.json(["tasks": self.tasks]) }
        model = LauncherModel(bridge: FakeBridge(), desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: runner, fetcher: FakeFetcher())
        model.killProcess = { [unowned self] pid in self.killed.append(pid) }
        model.willShow()
        tasks = [task("r1", "running", pid: 4242), task("r2", "running", pid: 4343), task("d1", "done"), task("e1", "error"), task("e2", "error")]
        model.refreshTasks()
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        model.openTasks()
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private func task(_ id: String, _ status: String, pid: Int = 0) -> [String: Any] {
        ["id": id, "status": status, "title": "Summary", "paper": "Doe (2016)", "key": "K", "libraryID": 1, "started": "2026-10-16T10:00:00Z",
         "finished": status == "running" ? "" : "2026-10-16T10:05:00Z", "pid": pid]
    }

    func testStopAllHeadsTheListAndStopsWhatWaitsAndWhatRuns() throws {
        XCTAssertEqual(model.listRows.first?.rowId, "tasks-stop-all")
        model.saveExtractState(["update": ["kind": "recent", "title": "Catching up", "jobs": [["id": "1:K", "op": "classify"]], "done": 0, "failed": 0]])
        XCTAssertNotEqual(model.listRows[model.store.selectedIndex].rowId, "tasks-stop-all", "the cursor never starts on it")
        model.store.selectedIndex = 0
        model.execute(.activate)
        XCTAssertEqual(model.listRows.map(\.rowId), ["confirm-yes", "confirm-no"], "it asks first")
        XCTAssertTrue(killed.isEmpty)
        model.store.selectedIndex = 0
        model.execute(.activate)
        XCTAssertNil(model.extractFile?.upToDate, "the catch-up's queue emptied")
        XCTAssertEqual(Set(killed), [4242, 4343], "the running ones stopped")
        XCTAssertTrue(model.flash.hasPrefix("Stopped"), model.flash)
    }

    func testNoStopAllWhenNothingRunsOrWaits() {
        tasks = [task("d1", "done")]
        model.refreshTasks()
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        XCTAssertFalse(model.listRows.contains { $0.rowId == "tasks-stop-all" })
    }

    func testThePillsShowOneStateAtATime() {
        let pills = model.processFilters
        XCTAssertEqual(pills.map(\.id), ["", "running", "pending", "done", "error"])
        XCTAssertEqual(pills.first { $0.id == "error" }?.count, 2)
        model.setProcessFilter("error")
        XCTAssertEqual(model.listRows.filter { $0.rowId == "task" }.map(\.value), ["e1", "e2"])
        model.setProcessFilter("")
        XCTAssertEqual(model.listRows.filter { $0.rowId == "task" }.count, 5)
    }
}
