import XCTest
@testable import ZoteroLauncher

// Phase 7 with a fake runner and bridge: new papers' text, taxonomies and prompts, a paper's text
// when opened, Bring papers up to date, a tick waiting for Zotero, automationHost.
@MainActor
final class LauncherModel7Tests: XCTestCase {
    private var home: URL!
    private var bridge: FakeBridge!
    private var runner: FakeRunner!
    private var model: LauncherModel!
    private var item: [String: Any]!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("7-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed")
        item = Fixture.bridge("item")
        bridge.answers["/search"] = { body in var a = typed; a["query"] = body["query"] ?? ""; return .ok(a) }
        bridge.answers["/item"] = { [unowned self] _ in .ok(self.item) }
        bridge.answers["/sync/status"] = { _ in .ok(["ok": true, "configured": true, "running": false]) }
        bridge.answers["/extract/pending"] = { _ in .ok(["total": 0, "items": []]) }
        bridge.answers["/papers/select"] = { _ in .ok(["total": 0, "items": []]) }
        runner = FakeRunner()
        runner.answers["list"] = { _, _ in FakeRunner.json(Fixture.synthetic("prompts")) }
        runner.answers["tasks"] = { _, _ in FakeRunner.json(["tasks": []]) }
        runner.answers["providers"] = { _, _ in FakeRunner.json(Fixture.synthetic("providers")) }
        runner.answers["models"] = { _, _ in FakeRunner.json(Fixture.synthetic("models")) }
        runner.answers["catchup-plan"] = { _, _ in FakeRunner.json([String: Any]()) }
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private func open(_ settings: String, extract: [String: Any] = [:]) throws {
        let file = home.appendingPathComponent(".config/omarchy/oma-zotero-launcher.json")
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(settings.utf8).write(to: file)
        if !extract.isEmpty {
            let dir = file.deletingLastPathComponent().appendingPathComponent("oma-zotero-launcher")
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try JSONSerialization.data(withJSONObject: extract).write(to: dir.appendingPathComponent("extract.json"))
        }
        model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: runner, fetcher: FakeFetcher())
        model.willShow()
    }

    private var extractState: [String: Any] {
        (try? JSONSerialization.jsonObject(with: Data(contentsOf: home.appendingPathComponent(".config/omarchy/oma-zotero-launcher/extract.json")))) as? [String: Any] ?? [:]
    }

    private func select(_ test: (ListRow) -> Bool) throws {
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex(where: test), "no such row")
    }

    func testNewPapersTextThreeATickWithTheRunnersOwnNotifications() throws {
        bridge.answers["/extract/pending"] = { body in body["since"] != nil ? .ok(["total": 1, "items": [["key": "NEW00001", "libraryID": 1]]]) : .ok(["total": 0, "items": []]) }
        runner.answers["extract-batch"] = { _, _ in FakeRunner.json(["results": [["id": "1:NEW00001", "status": "saved"]]]) }
        try open(#"{"defaults": {"autoExtractNew": true}}"#, extract: ["since": "2026-10-13 10:00:00"])
        model.scheduleTick()
        let body = try XCTUnwrap(bridge.bodies("/extract/pending").last { $0["since"] != nil })
        XCTAssertEqual(body["since"] as? String, "2026-10-13 10:00:00")
        XCTAssertEqual(body["limit"] as? Int, 3)
        XCTAssertEqual(runner.calls("extract-batch").last?.argv, ["oma-zotero-prompt", "extract-batch", "--items", "1:NEW00001", "--max-mb", "40"]) // no --quiet
        XCTAssertNotNil(model.extractTimer)
    }

    func testTurnedOnFromNowWithTheQMLsWords() throws {
        try open("{}")
        model.openSettings("defaults")
        try select { $0.value == "defaults.autoExtractNew" }
        model.execute(.activate)
        XCTAssertEqual(model.flash, "On: a paper's text is extracted when its PDF arrives (the ones from before: Extract every paper's text)")
        XCTAssertFalse((extractState["since"] as? String ?? "").isEmpty)
        try select { $0.value == "defaults.autoTagNew" }
        model.execute(.activate)
        XCTAssertEqual(model.flash, "On: each new paper is tagged by the taxonomies once (the ones from before: type tag in a collection)")
        XCTAssertFalse((extractState["tagSince"] as? String ?? "").isEmpty)
        XCTAssertNotNil(model.extractTimer)
    }

    func testAnotherMachineHandlesNewPapersAndDefaultsSaysSo() throws {
        try open(#"{"defaults": {"autoExtractNew": true, "autoTagNew": true, "autoPrompts": ["summary"]}, "general": {"automationHost": "lab-mac"}}"#,
                 extract: ["since": "2026-10-13 10:00:00", "tagSince": "2026-10-13 10:00:00", "autoPrompts": ["summary": ["since": "2026-10-13 10:00:00", "done": [:]]]])
        XCTAssertFalse(model.automationHere)
        model.scheduleTick()
        XCTAssertTrue(bridge.bodies("/extract/pending").filter { $0["since"] != nil }.isEmpty)
        XCTAssertTrue(bridge.bodies("/papers/select").isEmpty)
        model.openSettings("defaults")
        XCTAssertTrue(model.listRows.contains { $0.label == "New papers are handled on “lab-mac”" })
        try open(#"{"general": {"automationHost": "MAC"}}"#) // this machine, written differently
        XCTAssertTrue(model.automationHere)
    }

    func testNewPapersAreTaggedOnceEach() throws {
        bridge.answers["/papers/select"] = { _ in .ok(["total": 2, "items": [["key": "NEW00001", "libraryID": 1], ["key": "NEW00002", "libraryID": 1]]]) }
        runner.answers["classify"] = { _, _ in FakeRunner.json(["results": [["id": "1:NEW00001", "status": "tagged"], ["id": "1:NEW00002", "status": "skipped"]]]) }
        try open(#"{"defaults": {"autoTagNew": true, "autoExtractNew": true}}"#, extract: ["tagSince": "2026-10-13 10:00:00", "since": "2026-10-13 10:00:00", "skipped": ["1:SCAN0001": "a scan"]])
        model.tagTick()
        let body = try XCTUnwrap(bridge.bodies("/papers/select").last)
        XCTAssertEqual(body["textFirst"] as? Bool, true)
        XCTAssertEqual(body["textless"] as? [String], ["1:SCAN0001"])
        XCTAssertEqual(runner.calls("classify").last?.argv, ["oma-zotero-prompt", "classify", "--items", "1:NEW00001,1:NEW00002"])
        XCTAssertEqual((extractState["tagged"] as? [String: String]) ?? [:], ["1:NEW00001": "tagged", "1:NEW00002": "skipped"])
    }

    func testAPromptRunsOnceOnEachNewPaper() throws {
        try open(#"{"defaults": {"autoPrompts": ["summary"]}}"#)
        model.promptTick() // on in the file, nothing kept yet: from now
        XCTAssertNotNil((extractState["autoPrompts"] as? [String: Any])?["summary"])
        var given = 0
        bridge.answers["/papers/select"] = { _ in given += 1; return given == 1 ? .ok(["total": 1, "items": [["key": "NEW00001", "libraryID": 1]]]) : .ok(["total": 0, "items": []]) }
        runner.answers["run"] = { _, _ in RunnerResult(status: 0) }
        model.promptTick()
        XCTAssertNotNil(bridge.bodies("/papers/select").last?["before"]) // three minutes old at least
        XCTAssertEqual(runner.calls("run").last?.argv, ["oma-zotero-prompt", "run", "summary", "--key", "NEW00001", "--library", "1", "--extract-first"])
        let done = ((extractState["autoPrompts"] as? [String: Any])?["summary"] as? [String: Any])?["done"] as? [String: String]
        XCTAssertEqual(done, ["1:NEW00001": "done"])
    }

    func testPromptsToRunOnNewPapersAndTheEditorsRow() throws {
        try open("{}")
        model.openSettings("defaults")
        try select { $0.value == "auto-prompts" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "settings-auto-prompts")
        try select { $0.rowId == "set-auto-prompt" && $0.value == "summary" }
        model.execute(.activate)
        XCTAssertEqual(model.flash, "On: it runs on each paper added from now on (in Processes)")
        XCTAssertTrue(try XCTUnwrap(model.listRows.first { $0.value == "summary" }).checked)
        model.ai.promptEdit = model.ai.prompts?.first { $0["id"] as? String == "summary" }
        _ = model.scheduleAction(try JSCore().call("Views", "listRow", [["rowId": "pe-auto", "available": true]], as: ListRow.self))
        XCTAssertEqual(model.flash, "Off: new papers no longer get it")
    }

    func testBringingPapersUpToDateOneJobAtATime() throws {
        runner.answers["catchup-plan"] = { _, _ in
            FakeRunner.json(["recent": ["papers": 2, "jobs": [["id": "1:OLD00001", "op": "extract", "title": "A"], ["id": "1:OLD00002", "op": "prompt", "prompt": "summary", "title": "B"]]]])
        }
        runner.answers["extract-batch"] = { _, _ in FakeRunner.json(["results": [["id": "1:OLD00001", "status": "saved"]]]) }
        runner.answers["run"] = { _, _ in RunnerResult(status: 0) }
        runner.hold = ["run"]
        try open(#"{"defaults": {"autoExtractNew": true, "autoPrompts": ["summary"]}}"#)
        model.openSettings("defaults")
        XCTAssertTrue(runner.calls("catchup-plan").last?.argv.contains("--extract") == true)
        try select { $0.rowId == "set-catchup" && $0.value == "recent" }
        model.execute(.activate)
        XCTAssertEqual(model.flash, "Started: one at a time, in the background (in Processes)")
        XCTAssertEqual(runner.calls("extract-batch").last?.argv.prefix(4), ["oma-zotero-prompt", "extract-batch", "--items", "1:OLD00001"])
        XCTAssertEqual(runner.calls("run").last?.argv, ["oma-zotero-prompt", "run", "summary", "--key", "OLD00002", "--library", "1", "--extract-first"])
        XCTAssertTrue(model.listRows.contains { $0.rowId == "set-catchup-stop" }) // running
        runner.release("run", RunnerResult(status: 0))
        XCTAssertEqual(model.flash, "Catching up the last 30 days: done: 2 done")
        XCTAssertTrue(extractState["update"] is NSNull)
    }

    func testATickWaitsForZotero() throws {
        bridge.answers["/search"] = { _ in .zoteroDown }
        try open(#"{"defaults": {"autoExtractNew": true}}"#, extract: ["since": "2026-10-13 10:00:00"])
        XCTAssertEqual(model.status, "zotero-down")
        bridge.hold = ["/sync/status"]
        model.scheduleTick()
        XCTAssertTrue(bridge.bodies("/extract/pending").filter { $0["since"] != nil }.isEmpty) // not while it's away: it asks first
        bridge.release(.ok(["ok": true, "configured": true, "running": false]))
        XCTAssertEqual(model.status, "ready")
        XCTAssertFalse(bridge.bodies("/extract/pending").filter { $0["since"] != nil }.isEmpty) // and the ticks go on
    }

    func testAPapersTextWhenItsOpened() throws {
        item["notes"] = (item["notes"] as? [[String: Any]] ?? []).map { var n = $0; n["fulltext"] = false; return n }
        try open(#"{"defaults": {"extractOnOpen": true}}"#)
        model.setFilter("capabilities")
        model.enterActions(try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "item" }))
        XCTAssertEqual(runner.launched.last?.prefix(2), ["oma-zotero-prompt", "extract"])
        XCTAssertEqual(model.flash, "Extracting its text")
    }
}
