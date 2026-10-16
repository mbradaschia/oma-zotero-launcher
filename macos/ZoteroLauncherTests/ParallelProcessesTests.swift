import XCTest
@testable import ZoteroLauncher

// Processes at once (R3, Settings › Defaults › Processes): extraction, tagging and prompts on new papers each run up
// to that many at a time, never the same paper twice; 1 (the default) is one at a time, as before.
@MainActor
final class ParallelProcessesTests: XCTestCase {
    private var home: URL!
    private var bridge: FakeBridge!
    private var runner: FakeRunner!
    private var model: LauncherModel!
    private let pool = (1...9).map { String(format: "AAAA%04d", $0) }

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("par-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed")
        bridge.answers["/search"] = { body in var a = typed; a["query"] = body["query"] ?? ""; return .ok(a) } // (Zotero ready)
        // the papers left, minus the ones asked to leave out (in flight, done, skipped)
        bridge.answers["/extract/pending"] = { [unowned self] body in
            let out = Set((body["exclude"] as? [String]) ?? [])
            let left = self.pool.filter { !out.contains("1:" + $0) }
            if body["limit"] as? Int == 0 { return .ok(["total": left.count, "items": []]) }
            return .ok(["total": left.count, "items": left.prefix(body["limit"] as? Int ?? 3).map { ["key": $0, "libraryID": 1] }])
        }
        runner = FakeRunner()
        runner.answers["tasks"] = { _, _ in FakeRunner.json(["tasks": []]) }
        runner.answers["catchup-plan"] = { _, _ in FakeRunner.json([String: Any]()) }
        runner.answers["list"] = { _, _ in FakeRunner.json(Fixture.synthetic("prompts")) }
        runner.answers["providers"] = { _, _ in FakeRunner.json(Fixture.synthetic("providers")) }
        runner.answers["models"] = { _, _ in FakeRunner.json(Fixture.synthetic("models")) }
        runner.hold = ["extract-batch", "classify"]
        model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: runner, fetcher: FakeFetcher())
        model.willShow()
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private func items(_ argv: [String]) -> Set<String> {
        guard let i = argv.firstIndex(of: "--items"), i + 1 < argv.count else { return [] }
        return Set(argv[i + 1].split(separator: ",").map(String.init))
    }

    private func startCatchUp() throws {
        model.openSettings("defaults")
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "set-extract-all" })
        model.execute(.activate)
    }

    func testTheLimitIsASettingOfDefaults() throws {
        model.openSettings("defaults")
        let row = try XCTUnwrap(model.listRows.first { $0.value == "defaults.processesAtOnce" })
        XCTAssertEqual(row.section, "Processes")
        XCTAssertTrue(row.detail.hasPrefix("1 at a time"), row.detail)
    }

    func testOneAtATimeByDefault() throws {
        try startCatchUp()
        XCTAssertEqual(runner.calls("extract-batch").count, 1)
    }

    func testTwoBatchesAtOnceNeverTheSamePaper() throws {
        XCTAssertTrue(model.saveSetting("defaults.processesAtOnce", 2, ""))
        try startCatchUp()
        let batches = runner.calls("extract-batch").map { items($0.argv) }
        XCTAssertEqual(batches.count, 2)
        guard batches.count == 2 else { return }
        XCTAssertTrue(batches[0].isDisjoint(with: batches[1]), "\(batches)")
        // one ends: the next starts, with papers neither had
        runner.release("extract-batch", FakeRunner.json(["results": batches[0].map { ["id": $0, "status": "saved"] }]))
        let after = runner.calls("extract-batch").map { items($0.argv) }
        XCTAssertEqual(after.count, 3)
        XCTAssertTrue(after[2].isDisjoint(with: batches[1]))
    }

    func testTaggingRunsUpToTheLimit() {
        XCTAssertTrue(model.saveSetting("defaults.processesAtOnce", 2, ""))
        for k in pool.prefix(3) { model.classify([["key": k, "libraryID": 1]]) { _ in } }
        XCTAssertEqual(runner.calls("classify").count, 2)
        runner.release("classify", FakeRunner.json(["results": []]))
        XCTAssertEqual(runner.calls("classify").count, 3)
    }
}
