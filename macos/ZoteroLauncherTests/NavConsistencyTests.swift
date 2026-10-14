import XCTest
@testable import ZoteroLauncher

// The submenu arrow, everywhere (macos/docs/ux-conventions.md): a row shows › exactly when Enter on it opens another
// list. Walks the views on the fakes, presses Enter on every row, and compares what happened with the row's arrow.
// (A question, the confirm view, isn't another list.)
@MainActor
final class NavConsistencyTests: XCTestCase {
    private var home: URL!
    private var model: LauncherModel!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("nav-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        let bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed"), item = Fixture.bridge("item")
        bridge.answers["/search"] = { body in var a = typed; a["query"] = body["query"] ?? ""; return .ok(a) }
        bridge.answers["/item"] = { _ in .ok(item) }
        bridge.answers["/tags/list"] = { _ in .ok(Fixture.bridge("tags-list")) }
        let runner = FakeRunner()
        runner.answers["list"] = { _, _ in FakeRunner.json(Fixture.synthetic("prompts")) }
        // finished processes of every kind: a note (read in the launcher), a prompt draft (its editor), a chat and an
        // artifact (a window, a browser)
        let done: [[String: Any]] = [
            ["id": "t1", "status": "done", "title": "Summary", "paper": "Doe (2016)", "key": "P3NM4G92", "libraryID": 1, "finished": "2026-10-13T10:00:00Z", "noteKey": "N0TE0001"],
            ["id": "t2", "status": "done", "title": "Draft", "paper": "", "key": "", "libraryID": 1, "finished": "2026-10-13T10:00:00Z", "kind": "draft", "promptId": "summary"],
            ["id": "t3", "status": "done", "title": "Chat", "paper": "Doe (2016)", "key": "P3NM4G92", "libraryID": 1, "finished": "2026-10-13T10:00:00Z", "chatSession": "2026-10-12T08-00-00-000Z-abc123"],
            ["id": "t4", "status": "done", "title": "Map", "paper": "Doe (2016)", "key": "P3NM4G92", "libraryID": 1, "finished": "2026-10-13T10:00:00Z", "artifactView": "/tmp/art/m.html"]]
        runner.answers["tasks"] = { _, _ in FakeRunner.json(["tasks": done]) }
        let chats: [[String: Any]] = [
            ["id": "2026-10-12T08-00-00-000Z-abc123", "title": "Its argument", "created": "2026-10-12", "updated": "2026-10-12T08:05:00Z", "turns": 2, "model": "",
             "key": "P3NM4G92", "libraryID": 1, "paper": "Doe (2016)"]]
        let artifact: [String: Any] = ["id": "concept-map-1a2b", "title": "Concept map", "format": "mermaid", "formatLabel": "Mind map", "current": 1, "versions": 1,
                                       "created": "2026-10-12", "updated": "2026-10-13", "by": "chat", "key": "P3NM4G92", "libraryID": 1, "paper": "Doe (2016)",
                                       "view": "/tmp/art/m.html", "file": "/tmp/art/m.mmd", "dir": "/tmp/art/m", "brief": "/tmp/art/brief.md", "promptMade": false]
        runner.answers["chats"] = { _, _ in FakeRunner.json(["chats": chats]) }
        runner.answers["artifacts"] = { _, _ in FakeRunner.json(["root": "/tmp/art", "artifacts": [artifact]]) }
        runner.answers["providers"] = { _, _ in FakeRunner.json(Fixture.synthetic("providers")) }
        runner.answers["models"] = { _, _ in FakeRunner.json(Fixture.synthetic("models")) }
        runner.answers["catchup-plan"] = { _, _ in FakeRunner.json([String: Any]()) }
        runner.answers["taxonomy-new"] = { _, _ in FakeRunner.json(["id": "t1"]) } // (Settings › Taxonomies › New opens its form)
        runner.answers["taxonomy-show"] = { _, _ in FakeRunner.json(["id": "t1", "name": "New taxonomy", "prefix": "t1/", "kind": "several", "labels": [], "threshold": 0.6, "low": 0.3, "own": true, "path": "/tmp/t1.json"]) }
        model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: runner, fetcher: FakeFetcher())
        model.willShow()
        settle()
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private func settle() { RunLoop.main.run(until: Date().addingTimeInterval(0.15)) }

    // Back to where `depth` levels were, whatever the row opened (a question, a list, a page).
    private func unwind(to depth: Int, view: String) {
        var guardCount = 0
        while (model.store.stack.count > depth || model.store.view == "confirm") && guardCount < 10 { model.back(); guardCount += 1 }
        XCTAssertEqual(model.store.view, view, "couldn't get back to \(view)")
    }

    // Enter on each available row of the list view the model is in: "view/rowId" where the arrow and Enter disagree.
    private func crawlList(_ name: String) -> [String] {
        let view = model.store.view, depth = model.store.stack.count
        var wrong: [String] = []
        for i in model.listRows.indices {
            let row = model.listRows[i]
            // (key-info rows do nothing; New with AI opens its page once a model is set up, which the fakes have none of)
            guard row.available, !["key-info", "tax-ai-new"].contains(row.rowId) else { continue }
            model.store.selectedIndex = i
            model.activateAction(i)
            settle()
            if model.store.stack.count < depth { XCTFail("\(name)/\(row.rowId) went back a level"); return wrong }
            let opened = model.store.stack.count > depth && model.store.view != "confirm"
            if opened != row.submenu { wrong.append("\(name)/\(row.rowId)\(row.value.isEmpty ? "" : ":" + row.value) arrow=\(row.submenu) opens=\(opened)") }
            unwind(to: depth, view: view)
            model.rebuildList()
        }
        return wrong
    }

    func testEveryListRowsArrowMatchesWhatEnterDoes() throws {
        var wrong: [String] = []
        // a paper's menu, and its tags
        model.setFilter("work")
        settle()
        model.enterActions(try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "item" }))
        settle()
        wrong += crawlList("menu")
        model.enterTags()
        settle()
        wrong += crawlList("tags")
        model.goHome()
        // Settings and its pages
        for page in ["", "general", "providers", "defaults", "rules", "tasks", "paper-status", "styles", "taxonomies", "auto-prompts"] {
            model.goHome()
            model.openSettings(page)
            settle()
            wrong += crawlList("settings" + (page.isEmpty ? "" : "-" + page))
        }
        // the places
        for place in ["todos", "tasks", "searches", "chats"] {
            model.goHome()
            model.openPlace(place)
            settle()
            wrong += crawlList(place)
        }
        XCTAssertEqual(wrong, [], "arrows that don't match Enter:\n" + wrong.joined(separator: "\n"))
    }

    // The results: a paper (its menu), a collection or a tag (its papers), a note under a paper, a place that opens a view.
    func testEveryResultsRowsArrowMatchesWhatEnterDoes() {
        var wrong: [String] = [], kinds: Set<String> = []
        for query in ["work", "settings", "chats", "tasks", "keys", "sync", "extract"] {
            model.setFilter(query)
            settle()
            for i in model.searchRows.indices {
                let row = model.searchRows[i]
                kinds.insert(row.kind)
                let depth = model.store.stack.count
                model.store.selectedIndex = i
                let arrow = model.searchRowOpens(row)
                model.enterActions(i)
                settle()
                let opened = model.store.stack.count > depth && model.store.view != "confirm"
                if opened != arrow { wrong.append("results/\(row.kind) arrow=\(arrow) opens=\(opened)") }
                unwind(to: depth, view: "search")
                model.setFilter(query)
                settle()
            }
        }
        XCTAssertTrue(kinds.isSuperset(of: ["item", "collection", "tag", "sync", "settings", "chats", "keys"]), "kinds met: \(kinds.sorted())")
        XCTAssertEqual(Array(Set(wrong)).sorted(), [], "arrows that don't match Enter:\n" + wrong.joined(separator: "\n"))
    }

    // Picking a paper (for a new chat): a paper is picked by Enter (no arrow), a collection or a tag still opens.
    func testPickingAPaperKeepsTheArrowOnCollections() throws {
        model.store.push("search")
        model.store.pickFor = "chat"
        model.setFilter("work")
        settle()
        let collection = try XCTUnwrap(model.searchRows.first { $0.kind == "collection" })
        let paper = try XCTUnwrap(model.searchRows.first { $0.kind == "item" })
        XCTAssertTrue(model.searchRowOpens(collection))
        XCTAssertFalse(model.searchRowOpens(paper))
    }
}
