import XCTest
@testable import ZoteroLauncher

// Phase 6b with a fake runner: prompts (the list, a run, a new one, one written with AI, the
// editor), Processes (the runner's tasks file), a paper's extracted text, the catch-up, Rules.
@MainActor
final class LauncherModel6bTests: XCTestCase {
    private var home: URL!
    private var bridge: FakeBridge!
    private var runner: FakeRunner!
    private var model: LauncherModel!
    private var item: [String: Any]!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("6b-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed")
        item = Fixture.bridge("item")
        bridge.answers["/search"] = { body in var a = typed; a["query"] = body["query"] ?? ""; return .ok(a) }
        bridge.answers["/item"] = { [unowned self] _ in .ok(self.item) }
        bridge.answers["/sync/status"] = { _ in .ok(["ok": true, "configured": true, "running": false]) }
        runner = FakeRunner()
        runner.answers["providers"] = { _, _ in FakeRunner.json(Fixture.synthetic("providers")) }
        runner.answers["models"] = { _, _ in FakeRunner.json(Fixture.synthetic("models")) }
        runner.answers["list"] = { _, _ in FakeRunner.json(Fixture.synthetic("prompts")) }
        runner.answers["tasks"] = { _, _ in FakeRunner.json(Fixture.synthetic("tasks")) }
        runner.answers["set"] = { argv, _ in FakeRunner.json(["id": argv[2]]) }
        model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: runner, fetcher: FakeFetcher())
        model.willShow()
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private func select(_ test: (ListRow) -> Bool) throws {
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex(where: test), "no such row")
    }

    private func openPaper() throws {
        model.setFilter("capabilities")
        model.enterActions(try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "item" }))
    }

    private var paperKey: String { model.actionItem?.key ?? "" }

    // ---- prompts

    func testAPapersPromptsAreListedAndOneRunsInTheBackground() throws {
        try openPaper()
        XCTAssertFalse(runner.calls("list").isEmpty)
        try select { $0.rowId == "prompts" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "prompts")
        XCTAssertEqual(model.countText, "2 prompts")
        try select { $0.rowId == "prompt" && $0.promptId == "summary" }
        model.execute(.activate)
        XCTAssertEqual(runner.launched.last, ["oma-zotero-prompt", "run", "summary", "--key", paperKey, "--library", "1"]) // no --quiet: its notification tells
        XCTAssertEqual(model.flash, "Running “Summary”: it's in Processes (.)")
        XCTAssertEqual(model.store.view, "prompts") // the launcher stays
    }

    func testTheEditorShowsAChangeAtOnceAndSaysWhenItWasntSaved() throws {
        try openPaper()
        try select { $0.rowId == "prompts" }
        model.execute(.activate)
        try select { $0.rowId == "prompt" && $0.promptId == "summary" }
        XCTAssertTrue(model.keyAction("e"))
        XCTAssertEqual(model.store.view, "prompt-edit")
        runner.hold = ["set"]
        try select { $0.rowId == "pe-output" }
        model.execute(.activate)
        try select { $0.rowId == "pe-output-opt" && $0.value == "markdown" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "prompt-edit")
        XCTAssertEqual(model.ai.promptEdit?["output"] as? String, "markdown") // at once
        XCTAssertEqual(model.selectedListRow?.rowId, "pe-output")
        XCTAssertEqual(runner.calls("set").last?.argv, ["oma-zotero-prompt", "set", "summary", "--output", "markdown", "--quiet"])
        try select { $0.rowId == "pe-brief" }
        model.execute(.activate) // queued behind the first
        XCTAssertEqual(runner.calls("set").count, 1)
        runner.release("set", RunnerResult(status: 1, stderr: "oma-zotero-prompt: bad output"))
        XCTAssertEqual(model.flash, "Couldn't save the prompt: bad output")
        XCTAssertEqual(runner.calls("set").count, 2) // the next one, now
    }

    func testANewPromptIsCreatedThenOpened() throws {
        runner.answers["new"] = { argv, _ in FakeRunner.json(["id": "key-claims", "path": "/h/p/key-claims.md"]) }
        try openPaper()
        try select { $0.rowId == "prompts" }
        model.execute(.activate)
        try select { $0.rowId == "prompt-new" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "prompt-title")
        model.setFilter("Key claims")
        try select { $0.rowId == "pe-title-save" }
        model.execute(.activate)
        XCTAssertEqual(runner.calls("new").last?.argv, ["oma-zotero-prompt", "new", "Key claims", "--json", "--no-edit", "--quiet"])
        XCTAssertEqual(model.store.view, "prompt-edit")
        XCTAssertEqual(model.flash, "Created “Key claims”: pick its model and effort, then write it")
    }

    func testAPromptWrittenWithAIOneAtATime() throws {
        runner.hold = ["new-ai"]
        try openPaper()
        try select { $0.rowId == "prompts" }
        model.execute(.activate)
        try select { $0.rowId == "prompt-new" }
        model.execute(.activate)
        model.setFilter("the paper's key claims, with pages")
        try select { $0.rowId == "pe-title-ai" }
        model.execute(.activate)
        XCTAssertEqual(model.flash, "Writing the prompt with AI…")
        XCTAssertFalse(try XCTUnwrap(model.listRows.first { $0.rowId == "pe-title-ai" }).available) // one at a time
        runner.release("new-ai", FakeRunner.json(["id": "claims", "title": "Key claims", "output": "note", "excerpt": "", "model": "claude:opus"]))
        XCTAssertEqual(model.store.view, "prompt-edit")
        XCTAssertEqual(model.flash, "Wrote “Key claims” with claude:opus: review its text (Prompt text) before you run it")
    }

    func testThePromptsTextOpensInTheEditor() throws {
        try openPaper()
        try select { $0.rowId == "prompts" }
        model.execute(.activate)
        try select { $0.rowId == "prompt" && $0.promptId == "summary" }
        _ = model.keyAction("e")
        try select { $0.rowId == "pe-text" }
        model.execute(.activate)
        XCTAssertEqual(runner.launched.last, ["oma-zotero-prompt", "edit", "summary"])
    }

    // ---- Processes

    func testProcessesReadTheRunnersTasksFile() throws {
        let file = home.appendingPathComponent(".local/state/oma-zotero/tasks/tasks.json")
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: Fixture.synthetic("tasks")).write(to: file)
        runner.answers["tasks"] = { _, _ in RunnerResult(status: 1) } // only the file answers
        model.readTasks()
        XCTAssertTrue(model.keyAction("."))
        XCTAssertEqual(model.store.view, "tasks")
        XCTAssertEqual(model.countText, "1 running · 1 finished · 1 failed")
        XCTAssertTrue(model.listRows.contains { $0.label == "Summary · Teece et al. (1997)" }) // the Mac's join, no dash
        try select { $0.rowId == "task" && !$0.noteKey.isEmpty }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "note")
        model.back()
        try select { $0.rowId == "tasks-clear" }
        model.execute(.activate)
        XCTAssertEqual(runner.calls("tasks").last?.argv, ["oma-zotero-prompt", "tasks", "--clear", "--quiet"])
    }

    // ---- a paper's extracted text

    func testExtractingAPapersTextAndItsMenu() throws {
        let extracted = item!
        item["notes"] = (item["notes"] as? [[String: Any]] ?? []).map { var n = $0; n["fulltext"] = false; return n }
        try openPaper()
        try select { $0.rowId == "extract" }
        model.execute(.activate)
        XCTAssertEqual(runner.launched.last, ["oma-zotero-prompt", "extract", "--key", paperKey, "--library", "1"])
        XCTAssertEqual(model.flash, "Extracting the text: it's in Processes (.)")
        item = extracted
        model.refreshDetails()
        XCTAssertTrue(model.keyAction("x")) // extracted now: its menu
        XCTAssertEqual(model.store.view, "extract-menu")
        try select { $0.rowId == "ext-again" }
        model.execute(.activate)
        XCTAssertEqual(runner.launched.last?.last, "--force")
        XCTAssertEqual(model.store.view, "actions")
        _ = model.keyAction("x")
        bridge.answers["/notes/trash"] = { _ in .ok(["trashed": true]) }
        try select { $0.rowId == "ext-delete" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "confirm")
        model.answerConfirm(true)
        XCTAssertEqual(model.flash, "The extracted text is in Zotero's trash")
        XCTAssertNotNil(bridge.bodies("/notes/trash").last?["key"])
    }

    func testTheCatchUpExtractsThreeAtATimeUntilNoneAreLeft() throws {
        var rounds = 0
        bridge.answers["/extract/pending"] = { body in
            if body["limit"] as? Int == 0 { return .ok(["total": 0, "items": []]) }
            rounds += 1
            return .ok(rounds == 1 ? ["total": 2, "items": [["key": "AAAA0001", "libraryID": 1], ["key": "AAAA0002", "libraryID": 1]]] : ["total": 0, "items": []])
        }
        runner.answers["extract-batch"] = { argv, _ in
            XCTAssertEqual(argv[2...5], ["--items", "1:AAAA0001,1:AAAA0002", "--max-mb", "40"])
            return FakeRunner.json(["results": [["id": "1:AAAA0001", "status": "saved"], ["id": "1:AAAA0002", "status": "skipped", "reason": "a scan"]]])
        }
        model.openSettings("defaults")
        try select { $0.rowId == "set-extract-all" }
        model.execute(.activate)
        XCTAssertEqual(rounds, 2)
        XCTAssertEqual(model.flash, "Extracted every paper's text: 1 extracted, 1 skipped (scans, large PDFs: Settings › Defaults)")
        let state = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: home.appendingPathComponent(".config/omarchy/oma-zotero-launcher/extract.json"))) as? [String: Any])
        XCTAssertTrue(state["catchup"] is NSNull)
        XCTAssertEqual((state["skipped"] as? [String: Any])?["1:AAAA0002"] as? String, "a scan")
        try select { $0.rowId == "set-extract-retry" }
        model.execute(.activate)
        XCTAssertEqual(model.flash, "The skipped papers will be tried again")
    }

    // ---- Rules

    func testRulesOnAndOffYourInstructionsClearedOrEdited() throws {
        runner.answers["system"] = { _, _ in FakeRunner.json(["path": "/h/i.md", "cleared": true]) }
        model.openSettings("rules")
        XCTAssertEqual(model.placeholder(), "‹ Settings › Rules")
        let rule = try XCTUnwrap(model.listRows.first { $0.rowId == "set-rule" })
        try select { $0.rowId == "set-rule" && $0.value == rule.value }
        model.execute(.activate)
        let file = { (try? JSONSerialization.jsonObject(with: Data(contentsOf: self.home.appendingPathComponent(".config/omarchy/oma-zotero-launcher.json")))) as? [String: Any] }
        XCTAssertNotNil((file()?["rules"] as? [String: Any])?[rule.value])
        try select { $0.rowId == "set-rules-reset" }
        model.execute(.activate)
        XCTAssertEqual(model.flash, "The rules are back to their defaults")
        XCTAssertNil((file()?["rules"] as? [String: Any])?[rule.value])
        try select { $0.rowId == "set-system-edit" }
        model.execute(.activate)
        XCTAssertEqual(runner.launched.last, ["oma-zotero-prompt", "system", "edit"])
    }
}
