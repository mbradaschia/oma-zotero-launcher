import XCTest
@testable import ZoteroLauncher

// Phase 8 with the fake runner and bridge: the launcher's chats and artifacts (the Chats view, a chat's
// menu, an artifact's menu, c), and the chat window's turns (streamed events, stop, a past chat, the
// source, the outputs). The chats and artifacts here are made up.
@MainActor
final class LauncherModel8Tests: XCTestCase {
    private var home: URL!
    private var bridge: FakeBridge!
    private var runner: FakeRunner!
    private var desktop: FakeDesktop!
    private var model: LauncherModel!
    private var opened: [(PaperRef, String)] = []
    private let paperKey = "P3NM4G92" // the item fixture's

    private var chats: [[String: Any]] {
        [["id": "2026-10-13T10-00-00-000Z-abc123", "title": "What is the main claim?", "created": "2026-10-13", "updated": "2026-10-13T10:05:00Z", "turns": 2, "model": "claude:opus",
          "key": paperKey, "libraryID": 1, "paper": "Doe (2016)"],
         ["id": "2026-10-12T09-00-00-000Z-def456", "title": "Methods", "created": "2026-10-12", "updated": "2026-10-12T09:01:00Z", "turns": 1, "model": "",
          "key": "OTHER001", "libraryID": 1, "paper": "Roe (2020)"]]
    }
    private var artifact: [String: Any] {
        ["id": "concept-map-1a2b", "title": "Concept map", "format": "mermaid", "formatLabel": "Mind map", "current": 2, "versions": 2, "created": "2026-10-12", "updated": "2026-10-13",
         "by": "chat", "key": paperKey, "libraryID": 1, "paper": "Doe (2016)", "view": "/tmp/art/concept-map-1a2b.html", "file": "/tmp/art/concept-map-1a2b.mmd",
         "dir": "/tmp/art/concept-map-1a2b", "brief": "/tmp/art/brief.md", "promptMade": false]
    }

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("8-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed"), item = Fixture.bridge("item")
        bridge.answers["/search"] = { body in var a = typed; a["query"] = body["query"] ?? ""; return .ok(a) }
        bridge.answers["/item"] = { _ in .ok(item) }
        runner = FakeRunner()
        runner.answers["list"] = { _, _ in FakeRunner.json(Fixture.synthetic("prompts")) }
        runner.answers["tasks"] = { _, _ in FakeRunner.json(["tasks": []]) }
        runner.answers["providers"] = { _, _ in FakeRunner.json(Fixture.synthetic("providers")) }
        runner.answers["models"] = { _, _ in FakeRunner.json(Fixture.synthetic("models")) }
        runner.answers["catchup-plan"] = { _, _ in FakeRunner.json([String: Any]()) }
        let chats = self.chats, artifact = self.artifact
        runner.answers["chats"] = { argv, _ in FakeRunner.json(["chats": argv.contains("--all") ? chats : chats.filter { $0["key"] as? String == "P3NM4G92" }]) }
        runner.answers["artifacts"] = { _, _ in FakeRunner.json(["root": "/tmp/art", "artifacts": [artifact]]) }
        desktop = FakeDesktop()
        model = LauncherModel(bridge: bridge, desktop: desktop, env: ["HOME": home.path, "hostname": "mac"], runner: runner, fetcher: FakeFetcher())
        model.openChat = { [unowned self] item, session in self.opened.append((item, session)) }
        model.willShow()
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private func select(_ test: (ListRow) -> Bool) throws {
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex(where: test), "no such row")
    }

    private func openMenu() throws {
        model.setFilter("capabilities")
        model.enterActions(try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "item" }))
    }

    // ---- the launcher

    func testTheChatsViewNewChatAndOpeningOne() throws {
        model.keyAction("c") // nothing highlighted at the root: Chats
        XCTAssertEqual(model.store.view, "chats")
        XCTAssertEqual(model.listRows.first?.rowId, "chat-new")
        XCTAssertEqual(model.listRows.filter { $0.rowId == "chat-open" }.map(\.label), ["What is the main claim?", "Methods"])
        XCTAssertEqual(model.countText, "2 chats")
        XCTAssertEqual(model.placeholder(), "‹ Chats · with your papers")
        try select { $0.rowId == "chat-open" && $0.label == "Methods" }
        model.execute(.activate)
        XCTAssertEqual(opened.last?.0.key, "OTHER001")
        XCTAssertEqual(opened.last?.1, "2026-10-12T09-00-00-000Z-def456")
    }

    func testNewChatPicksThePaper() throws {
        model.keyAction("c")
        try select { $0.rowId == "chat-new" }
        model.execute(.activate)
        XCTAssertEqual(model.store.pickFor, "chat")
        XCTAssertTrue(model.hints().contains("↵ chat about it"))
        model.setFilter("capabilities")
        model.enterActions(try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "item" }))
        XCTAssertEqual(opened.last?.0.key, paperKey)
    }

    func testAPapersMenuHasItsChatsAndArtifactsAndCOpensItsChat() throws {
        try openMenu()
        XCTAssertTrue(model.listRows.contains { $0.rowId == "chat-session" && $0.label == "What is the main claim?" })
        XCTAssertFalse(model.listRows.contains { $0.rowId == "chat-session" && $0.label == "Methods" }) // another paper's
        XCTAssertTrue(model.listRows.contains { $0.rowId == "artifact" && $0.value == "concept-map-1a2b" })
        XCTAssertTrue(model.keyAction("c"))
        XCTAssertEqual(opened.last?.0.key, paperKey)
        XCTAssertEqual(opened.last?.1, "")
    }

    func testAChatsMenuRenamesAndDeletesAskingFirst() throws {
        runner.answers["chat-rename"] = { _, _ in FakeRunner.json(["id": "x", "title": "Claims"]) }
        runner.answers["chat-delete"] = { _, _ in FakeRunner.json(["id": "x", "deleted": true]) }
        try openMenu()
        try select { $0.rowId == "chat-session" }
        model.execute(.alternate)
        XCTAssertEqual(model.store.view, "chat-menu")
        XCTAssertEqual(model.listRows.map(\.rowId), ["chat-menu-open", "chat-menu-rename", "chat-menu-delete"])
        try select { $0.rowId == "chat-menu-rename" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "chat-rename")
        XCTAssertEqual(model.store.filterText, "What is the main claim?")
        model.setFilter("Claims")
        XCTAssertEqual(model.listRows.first?.label, "Rename to “Claims”")
        model.execute(.activate)
        XCTAssertEqual(runner.calls("chat-rename").last.map { Array($0.argv.drop { $0 != "--key" }.prefix(8)) }, ["--key", paperKey, "--library", "1", "--session", "2026-10-13T10-00-00-000Z-abc123", "--title", "Claims"])
        XCTAssertEqual(model.flash, "Renamed")
        XCTAssertEqual(model.store.view, "actions")
        // delete: asked first
        try select { $0.rowId == "chat-session" }
        model.execute(.alternate)
        try select { $0.rowId == "chat-menu-delete" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "confirm")
        XCTAssertTrue(runner.calls("chat-delete").isEmpty)
        model.answerConfirm(true)
        XCTAssertEqual(runner.calls("chat-delete").count, 1)
        XCTAssertEqual(model.flash, "Deleted the chat “What is the main claim?”")
        XCTAssertEqual(model.store.view, "actions")
    }

    func testAnArtifactsMenuOpenChangeUndoRenameAndDelete() throws {
        runner.answers["artifact-undo"] = { _, _ in FakeRunner.json(["id": "concept-map-1a2b", "current": 1, "versions": 2, "title": "Concept map"]) }
        runner.answers["artifact-delete"] = { _, _ in FakeRunner.json(["id": "concept-map-1a2b", "deleted": true]) }
        try openMenu()
        try select { $0.rowId == "artifact" }
        model.execute(.alternate)
        XCTAssertEqual(model.store.view, "artifact-menu")
        XCTAssertEqual(model.placeholder(), "‹ Concept map · Mind map")
        XCTAssertEqual(Set(model.listRows.map(\.rowId)), ["art-open", "art-change", "art-source", "art-brief", "art-undo", "art-rename", "art-folder", "art-delete"])
        try select { $0.rowId == "art-undo" }
        model.execute(.activate)
        XCTAssertEqual(runner.calls("artifact-undo").last?.argv.contains("concept-map-1a2b"), true)
        XCTAssertEqual(model.flash, "Back to version 1 (the later ones are kept)")
        // change it with AI: started, in Processes
        try select { $0.rowId == "art-change" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "artifact-change")
        model.setFilter("add the methods")
        try select { $0.rowId == "art-change-go" }
        model.execute(.activate)
        let edit = try XCTUnwrap(runner.launched.last)
        XCTAssertEqual(Array(edit.prefix(2)), ["oma-zotero-prompt", "artifact-edit"])
        XCTAssertEqual(edit.suffix(2), ["--instruction", "add the methods"])
        XCTAssertTrue(model.flash.hasPrefix("Changing “Concept map”: it's in Processes"))
        // delete: asked first (back on the paper's menu)
        XCTAssertEqual(model.store.view, "actions")
        try select { $0.rowId == "artifact" }
        model.execute(.alternate)
        try select { $0.rowId == "art-delete" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "confirm")
        model.answerConfirm(true)
        XCTAssertEqual(runner.calls("artifact-delete").count, 1)
        XCTAssertEqual(model.flash, "Deleted the artifact “Concept map”")
    }

    func testArtifactSourceOpensInTheEditor() throws {
        try openMenu()
        try select { $0.rowId == "artifact" }
        model.execute(.alternate)
        try select { $0.rowId == "art-source" }
        model.execute(.activate)
        XCTAssertEqual(desktop.edited.last, "/tmp/art/concept-map-1a2b.mmd")
    }

    // ---- the chat window

    private func window(session: String = "") -> ChatWindowModel {
        ChatWindowModel(item: PaperRef(key: paperKey, libraryID: 1, title: "A paper", itemType: "journalArticle"), launcher: model, session: session)
    }

    func testATurnStreamsInAndEnds() throws {
        let w = window()
        runner.streamAnswers["chat"] = { _, _ in
            (lines: [FakeRunner.line(["type": "session", "id": "2026-10-14T08-00-00-000Z-aaa111", "title": "Q", "grounding": ["source": "pdf", "label": "the PDF"], "model": "claude:opus"]),
                     FakeRunner.line(["type": "status", "text": "Reading…"]),
                     FakeRunner.line(["type": "delta", "text": "The claim "]),
                     FakeRunner.line(["type": "delta", "text": "is **X**."]),
                     FakeRunner.line(["type": "quotes", "checked": 2, "missing": []]),
                     FakeRunner.line(["type": "context", "used": 12000, "window": 200000]),
                     FakeRunner.line(["type": "done", "id": "2026-10-14T08-00-00-000Z-aaa111", "text": "The claim is **X**.", "model": "claude:opus", "costUsd": 0])],
             result: RunnerResult(status: 0))
        }
        w.draft = "What is the claim?"
        w.send()
        let call = try XCTUnwrap(runner.calls("chat").last)
        XCTAssertEqual(call.stdin, "What is the claim?")
        XCTAssertTrue(call.argv.contains("--source") && call.argv.contains("--model"))
        XCTAssertFalse(w.busy)
        XCTAssertEqual(w.sessionId, "2026-10-14T08-00-00-000Z-aaa111")
        XCTAssertEqual(w.messages.count, 2)
        XCTAssertEqual(w.messages[1]["text"] as? String, "The claim is **X**.")
        XCTAssertTrue((w.messages[1]["info"] as? String ?? "").contains("all 2 quotes were found in the paper"))
        XCTAssertTrue(w.page.contains("<strong>X</strong>")) // marked, in JavaScriptCore
        XCTAssertTrue(w.page.contains("oma-answer:copy/1"))
        XCTAssertTrue(w.infoLine.text.contains("context 12k / 200k (6%)"))
        // the next question resumes the chat
        w.draft = "And then?"
        w.send()
        XCTAssertTrue(runner.calls("chat").last?.argv.contains("2026-10-14T08-00-00-000Z-aaa111") == true)
    }

    func testStopEndsATurnAndSaysSo() throws {
        let w = window()
        runner.holdStreams = ["chat"]
        w.draft = "Long question"
        w.send()
        XCTAssertTrue(w.busy)
        let s = try XCTUnwrap(runner.streams.last)
        s.emit(["type": "delta", "text": "Partly"])
        w.stop()
        XCTAssertTrue(s.stopped)
        XCTAssertFalse(w.busy)
        XCTAssertEqual(w.messages.last?["text"] as? String, "Partly\n\n*(stopped)*")
        XCTAssertEqual(w.sessionId, "") // nothing saved to resume
    }

    func testAStoppedLaterTurnKeepsTheChatItStartedFrom() throws {
        let w = window()
        runner.streamAnswers["chat"] = { _, _ in
            (lines: [FakeRunner.line(["type": "session", "id": "S1"]), FakeRunner.line(["type": "done", "id": "S1", "text": "A1", "model": "claude:opus"])], result: RunnerResult(status: 0))
        }
        w.draft = "Q1"
        w.send()
        XCTAssertEqual(w.sessionId, "S1")
        // the second turn: the runner announces a session (it would make a new one were S1 gone), then it's stopped
        runner.holdStreams = ["chat"]
        w.draft = "Q2"
        w.send()
        let s = try XCTUnwrap(runner.streams.last)
        s.emit(["type": "session", "id": "S2-never-saved"])
        w.stop()
        XCTAssertEqual(w.sessionId, "S1") // the chat it started from: the runner saved nothing for this turn
        // a new chat whose first turn fails: none to resume
        let w2 = window()
        runner.holdStreams = []
        runner.streamAnswers["chat"] = { _, _ in (lines: [FakeRunner.line(["type": "session", "id": "S3"]), FakeRunner.line(["type": "error", "message": "no key"])], result: RunnerResult(status: 1)) }
        w2.draft = "Q"
        w2.send()
        XCTAssertEqual(w2.sessionId, "")
    }

    func testAPastChatLoadingHoldsATurnAndATurnDropsALateLoad() throws {
        runner.answers["chat-show"] = { _, _ in FakeRunner.json(["id": "old", "messages": [["role": "user", "text": "Old Q"], ["role": "assistant", "text": "Old A"]]]) }
        runner.hold = ["chat-show"]
        let w = window(session: "old")
        w.draft = "New Q"
        w.send()
        XCTAssertEqual(w.flash, "Opening the chat: a moment") // not sent over a chat about to be replaced
        XCTAssertTrue(runner.calls("chat").isEmpty)
        runner.release("chat-show", FakeRunner.json(["id": "old", "messages": [["role": "user", "text": "Old Q"], ["role": "assistant", "text": "Old A"]]]))
        XCTAssertEqual(w.sessionId, "old")
        // a turn running, a past chat clicked: its answer, coming late, is dropped
        runner.holdStreams = ["chat"]
        w.draft = "Q2"
        w.send()
        XCTAssertTrue(w.busy)
        w.openSession("other") // refused while busy
        XCTAssertEqual(runner.calls("chat-show").count, 1)
        XCTAssertEqual(w.messages.last?["pending"] as? Bool, true)
    }

    func testArtifactsOfTwoPapersWithOneIdAreKeptApart() throws {
        var other = artifact
        other["key"] = "OTHER001"
        other["title"] = "Someone else's map"
        let mine = artifact
        runner.answers["artifacts"] = { _, _ in FakeRunner.json(["root": "/tmp/art", "artifacts": [other, mine]]) }
        model.refreshArtifacts()
        try openMenu()
        try select { $0.rowId == "artifact" }
        model.execute(.alternate)
        XCTAssertEqual(model.placeholder(), "‹ Concept map · Mind map") // this paper's, not the other with the same id
    }

    func testAnErrorIsSaidInTheAnswer() throws {
        let w = window()
        runner.streamAnswers["chat"] = { _, _ in (lines: [FakeRunner.line(["type": "error", "message": "no model is set up"])], result: RunnerResult(status: 1)) }
        w.draft = "Q"
        w.send()
        XCTAssertEqual(w.messages.last?["text"] as? String, "Couldn't answer: no model is set up")
        XCTAssertEqual(w.messages.last?["failed"] as? Bool, true)
    }

    func testAPastChatOpensAndTheSourceSwitchStartsANewOne() throws {
        runner.answers["chat-show"] = { _, _ in
            FakeRunner.json(["id": "2026-10-13T10-00-00-000Z-abc123", "model": "claude:opus", "effort": "medium", "grounding": ["source": "pdf", "label": "the PDF"],
                             "context": ["used": 5000, "window": 100000],
                             "messages": [["role": "user", "text": "Q1"], ["role": "assistant", "text": "A1", "model": "claude:opus"]]])
        }
        let w = window(session: "2026-10-13T10-00-00-000Z-abc123")
        XCTAssertEqual(w.sessionId, "2026-10-13T10-00-00-000Z-abc123")
        XCTAssertEqual(w.messages.map { $0["text"] as? String }, ["Q1", "A1"])
        XCTAssertEqual(w.effort, "medium")
        w.savedText = ["key": "NOTE0001"]
        w.setSource("note")
        XCTAssertEqual(w.sessionId, "")
        XCTAssertTrue(w.messages.isEmpty)
        XCTAssertEqual(w.flash, "A new chat, grounded in the extracted text")
    }

    func testAnAnswersLinksAndTheChatsOutputs() throws {
        runner.answers["chat-show"] = { _, _ in
            FakeRunner.json(["id": "s1", "messages": [["role": "user", "text": "What?"], ["role": "assistant", "text": "This.", "model": "claude:opus"]]])
        }
        runner.answers["note"] = { _, _ in FakeRunner.json(["status": "saved", "note": "NOTE0009"]) }
        let w = window(session: "s1")
        w.link(URL(string: "oma-answer:copy/1")!)
        XCTAssertEqual(desktop.copied.last, "This.")
        w.link(URL(string: "oma-answer:save/1")!)
        let save = try XCTUnwrap(runner.calls("note").last)
        XCTAssertEqual(save.stdin, "This.")
        XCTAssertEqual(Array(save.argv.drop { $0 != "--title" }.prefix(2)), ["--title", "Chat: What?"])
        XCTAssertFalse(save.argv.contains("--tag")) // the runner's default tag, oma-chat (--tag takes no value there)
        XCTAssertEqual(w.flash, "Saved to Zotero as a note on the paper")
        XCTAssertTrue(w.transcript.contains("**You:** What?"))
        XCTAssertFalse(w.transcript.contains("**Claude:**")) // the answer's model, named as the runner lists it
        w.link(URL(string: "oma-artifact:concept-map-1a2b")!)
        XCTAssertEqual(desktop.opened.last, "/tmp/art/concept-map-1a2b.html")
    }
}
