import XCTest
@testable import ZoteroLauncher

// Phase 4a on the fake bridge: collections as places, a paper's status and default task, notes,
// the tag editor and a tag's menu, the settings pages, grouping.
@MainActor
final class LauncherModel4aTests: XCTestCase {
    private var home: URL!
    private var bridge: FakeBridge!
    private var desktop: FakeDesktop!
    private var model: LauncherModel!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("4a-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        bridge = FakeBridge()
        desktop = FakeDesktop()
        let typed = Fixture.bridge("search-typed"), item = Fixture.bridge("item"), tags = Fixture.bridge("tags-list")
        let note = Self.synthetic("note-html")
        bridge.answers["/search"] = { _ in .ok(typed) }
        bridge.answers["/item"] = { _ in .ok(item) }
        bridge.answers["/cite"] = { _ in .ok(["ok": true, "entries": [["text": "(A, 2020)"]]]) }
        bridge.answers["/note"] = { body in body["format"] as? String == "export" ? .ok(["ok": true, "markdown": "# Notes\n\ntext", "title": "Notes"]) : .ok(note) }
        bridge.answers["/tags/list"] = { _ in .ok(tags) }
        bridge.answers["/tags/update"] = { body in .ok(["ok": true, "tags": ((body["add"] as? [String]) ?? []).map { ["tag": $0, "type": 0] }]) }
        bridge.answers["/tags/rename"] = { _ in .ok(["ok": true, "count": 4, "left": 0]) }
        bridge.answers["/tags/delete"] = { _ in .ok(["ok": true, "count": 2, "left": 0]) }
        bridge.answers["/tags/count"] = { _ in .ok(["ok": true, "count": 3]) }
        bridge.answers["/styles"] = { _ in .ok(["ok": true, "styles": [["id": "apa", "title": "APA 7th"], ["id": "chicago-author-date", "title": "Chicago"]]]) }
        model = LauncherModel(bridge: bridge, desktop: desktop, env: ["HOME": home.path, "hostname": "mac"])
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: home)
    }

    static func synthetic(_ name: String) -> [String: Any] {
        let url = Bundle(for: FakeBridge.self).url(forResource: name, withExtension: "json", subdirectory: "Fixtures/synthetic")!
        return try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    }

    private var config: URL { home.appendingPathComponent(".config/omarchy/oma-zotero-launcher") }
    private var machineFile: URL { home.appendingPathComponent(".config/omarchy/oma-zotero-launcher.json") }

    private func openMenu() {
        model.willShow(query: "")
        model.enterActions(model.searchRows.firstIndex { $0.kind == "item" }!)
    }

    private func select(_ test: (ListRow) -> Bool) throws {
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex(where: test))
    }

    private func machine() throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: machineFile)) as? [String: Any])
    }

    // ---- collections and tags as places

    func testEnterOnACollectionSearchesItsPapers() throws {
        model.willShow(query: "")
        let i = try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "collection" })
        let row = model.searchRows[i]
        model.store.selectedIndex = i
        model.execute(.enterActions)
        XCTAssertEqual(model.store.scope?.key, row.key)
        let body = try XCTUnwrap(bridge.bodies("/search").last)
        XCTAssertEqual((body["collection"] as? [String: Any])?["key"] as? String, row.key)
        XCTAssertEqual(model.context?.text, "Collection  " + row.title)
        XCTAssertTrue(model.back())
        XCTAssertNil(model.store.scope)
        XCTAssertNil(bridge.bodies("/search").last?["collection"])
    }

    func testATagOpensItsPapers() throws {
        model.willShow(query: "")
        let i = try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "tag" })
        model.store.selectedIndex = i
        model.execute(.enterActions)
        XCTAssertEqual(model.store.scope?.type, "tag")
        XCTAssertNotNil(bridge.bodies("/search").last?["tag"])
    }

    func testAnAnswerForTheLevelYouLeftIsIgnored() throws {
        model.willShow(query: "")
        let i = try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "collection" })
        bridge.hold = ["/search"]
        model.store.selectedIndex = i
        model.execute(.enterActions)
        model.back()
        bridge.release(.ok(["ok": true, "query": "", "scope": ["kind": "collection", "key": model.searchRows.isEmpty ? "X" : "OTHER123", "libraryID": 1], "results": []]))
        XCTAssertNil(model.response?["scope"])
    }

    // ---- status and default task

    func testOptionArrowCyclesTheStatusAndSavesItASecondLater() throws {
        openMenu()
        XCTAssertTrue(model.keyState.statusTarget)
        model.execute(.cycleStatus(1))
        XCTAssertEqual(model.flash, "Status: to read")
        XCTAssertEqual(model.listRows.first { $0.rowId == "paper-status" }?.label, "Status: to read")
        XCTAssertTrue(bridge.bodies("/tags/update").isEmpty)
        model.flushStatuses()
        let body = try XCTUnwrap(bridge.bodies("/tags/update").last)
        XCTAssertEqual(body["add"] as? [String], ["s/to read"])
        XCTAssertEqual(body["remove"] as? [String], [])
    }

    func testAFailedStatusSaveIsUndone() throws {
        bridge.answers["/tags/update"] = { _ in .error("read-only") }
        openMenu()
        model.execute(.cycleStatus(1))
        model.flushStatuses()
        XCTAssertTrue(model.flash.hasPrefix("Couldn't save the status"))
        XCTAssertNil(model.marks.statusShown[model.actionItem!.id])
    }

    func testTheDefaultTaskIsMadeThenMovedAndItsTagFollows() throws {
        openMenu()
        model.status = "ready"
        model.execute(.cycleDefaultTask(1))
        XCTAssertTrue(model.flash.hasPrefix("New task, "))
        model.flushDefaultTasks(now: Date(timeIntervalSince1970: 1_800_000_000))
        let todos = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: config.appendingPathComponent("todos.json"))) as? [String: Any])
        let list = try XCTUnwrap(todos["todos"] as? [[String: Any]])
        XCTAssertEqual(list.count, 1)
        XCTAssertEqual(list[0]["isDefault"] as? Bool, true)
        XCTAssertEqual((list[0]["item"] as? [String: Any])?["key"] as? String, model.actionItem?.key)
        XCTAssertEqual((bridge.bodies("/tags/update").last?["add"] as? [String])?.first?.hasPrefix("t/"), true)
        model.execute(.cycleDefaultTask(1))
        XCTAssertTrue(model.flash.hasPrefix("Task: "))
        model.flushDefaultTasks()
        let again = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: config.appendingPathComponent("todos.json"))) as? [String: Any])
        XCTAssertEqual((again["todos"] as? [Any])?.count, 1) // moved, not another
    }

    // ---- notes

    func testNotesListTheReaderAndItsKeys() throws {
        openMenu()
        let notes = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "note" })
        model.store.selectedIndex = notes
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "note")
        XCTAssertEqual(bridge.bodies("/note").last?["format"] as? String, "html")
        XCTAssertTrue(model.noteBodyHTML.contains("<p"))
        XCTAssertFalse(model.noteBodyHTML.contains("<h1")) // the title block is shown above it
        XCTAssertEqual(model.noteParts.title, "Reading notes: Études")
        XCTAssertTrue(model.handle(KeyEvent(key: .character("y"), text: "y")))
        XCTAssertEqual(desktop.copied, ["# Notes\n\ntext"])
        let notesAsked = bridge.bodies("/note").count
        _ = model.handle(KeyEvent(key: .down, text: "", shift: true))
        XCTAssertEqual(bridge.bodies("/note").count, notesAsked + 1) // the paper's next note
        _ = model.handle(KeyEvent(key: .backspace, text: ""))
        XCTAssertEqual(model.store.view, "actions")
    }

    func testTheNotesRowWithSeveralNotesListsThem() throws {
        openMenu()
        model.enterNotes()
        XCTAssertEqual(model.store.view, "notes")
        XCTAssertTrue(model.listRows.allSatisfy { $0.rowId == "note" })
        XCTAssertEqual(model.placeholder(), "‹ Notes · " + model.paperLabel)
    }

    func testNoteOrderIsKeptPerPaper() throws {
        openMenu()
        model.enterNotes()
        let first = model.listRows[0].noteKey
        model.store.selectedIndex = 0
        model.execute(.moveRow(1))
        XCTAssertEqual(model.listRows[1].noteKey, first)
        let view = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: config.appendingPathComponent("view.json"))) as? [String: Any])
        XCTAssertEqual(((view["noteOrder"] as? [String: Any])?[model.actionItem!.id] as? [String])?[1], first)
    }

    func testSpaceShowsAPapersNotesUnderIt() throws {
        model.willShow(query: "")
        let i = try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "item" && $0.noteCount > 0 })
        model.store.selectedIndex = i
        XCTAssertTrue(model.keyAction(" "))
        XCTAssertEqual(model.searchRows[i + 1].kind, "note-child")
        XCTAssertTrue(model.keyAction(" "))
        XCTAssertNotEqual(model.searchRows.indices.contains(i + 1) ? model.searchRows[i + 1].kind : "", "note-child")
    }

    func testTheNotesTextSize() throws {
        model.willShow()
        let size = model.noteTextSize
        model.stepNoteFont(1)
        XCTAssertEqual(model.noteTextSize, size + 1)
        model.stepNoteFont(0)
        XCTAssertEqual(model.noteTextSize, LauncherModel.themeNoteSize)
    }

    func testMarkdownSavedUnderAFreeName() throws {
        let dir = home.appendingPathComponent("Downloads")
        let a = try LauncherModel.saveMarkdown("one", named: "Notes", in: dir)
        let b = try LauncherModel.saveMarkdown("two", named: "Notes", in: dir)
        XCTAssertEqual(a.lastPathComponent, "Notes.md")
        XCTAssertEqual(b.lastPathComponent, "Notes (2).md")
        XCTAssertEqual(try String(contentsOf: a, encoding: .utf8), "one")
    }

    // ---- tags

    func testTheTagEditorAddsAndRemovesAtOnce() throws {
        openMenu()
        model.enterTags()
        XCTAssertEqual(model.store.view, "tags")
        XCTAssertEqual(bridge.routes().last, "/tags/list")
        try select { $0.rowId == "tag" && !$0.checked && $0.tag == $0.tag.trimmingCharacters(in: .whitespaces) }
        let name = model.selectedListRow!.tag
        model.execute(.activate)
        XCTAssertEqual(bridge.bodies("/tags/update").last?["add"] as? [String], [name])
        XCTAssertEqual(model.listRows.first { $0.tag == name }?.checked, true)
        XCTAssertEqual(model.selectedListRow?.tag, name)
    }

    func testARefusedTagIsUndone() throws {
        bridge.answers["/tags/update"] = { _ in .error("no") }
        openMenu()
        model.enterTags()
        try select { $0.rowId == "tag" && !$0.checked && $0.tag == $0.tag.trimmingCharacters(in: .whitespaces) }
        let name = model.selectedListRow!.tag
        model.execute(.activate)
        XCTAssertEqual(model.listRows.first { $0.tag == name }?.checked, false)
        XCTAssertTrue(model.lastError.hasPrefix("Couldn't add"))
    }

    func testCreateANewTag() throws {
        openMenu()
        model.enterTags()
        model.setFilter("brand new tag")
        XCTAssertEqual(model.listRows.last?.rowId, "create")
        model.execute(.createTag)
        XCTAssertEqual(bridge.bodies("/tags/update").last?["add"] as? [String], ["brand new tag"])
        XCTAssertEqual(model.store.filterText, "")
    }

    func testRenameAndDeleteATagEverywhere() throws {
        openMenu()
        model.enterTags()
        try select { $0.rowId == "tag" }
        let name = model.selectedListRow!.tag
        model.execute(.alternate)
        XCTAssertEqual(model.store.view, "tag-menu")
        try select { $0.rowId == "tag-rename" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "tag-name")
        XCTAssertEqual(model.store.filterText, name)
        model.setFilter("renamed tag")
        model.execute(.activate)
        XCTAssertEqual(bridge.bodies("/tags/rename").last?["to"] as? String, "renamed tag")
        XCTAssertEqual(model.store.view, "tags")
        XCTAssertTrue(model.flash.hasPrefix("Renamed on 4 papers"))
        try select { $0.rowId == "tag" }
        model.execute(.alternate)
        try select { $0.rowId == "tag-delete" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "confirm")
        XCTAssertTrue(model.listRows[0].detail.hasPrefix("On 3 papers"))
        model.execute(.activate)
        XCTAssertNotNil(bridge.bodies("/tags/delete").last)
    }

    func testATagBecomesAPaperStatus() throws {
        openMenu()
        model.enterTags()
        try select { $0.rowId == "tag" }
        let name = model.selectedListRow!.tag
        model.execute(.alternate)
        try select { $0.rowId == "tag-to-paper" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "tag-status")
        try select { $0.rowId == "tag-status-opt" && $0.value.isEmpty }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "confirm")
        model.execute(.activate)
        XCTAssertEqual(bridge.bodies("/tags/rename").last?["to"] as? String, "s/" + name)
        XCTAssertEqual((try machine()["status"] as? [String: Any])?["tags"] as? [String], ["to read", "reading", "read", name])
    }

    // ---- settings

    func testSemicolonOpensSettingsAndAToggleIsSaved() throws {
        model.willShow()
        XCTAssertTrue(model.keyAction(";"))
        XCTAssertEqual(model.store.view, "settings")
        try select { $0.rowId == "set-nav" && $0.value == "general" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "settings-general")
        try select { $0.rowId == "set-toggle" && $0.value == "general.accelerators" }
        model.execute(.activate)
        XCTAssertEqual((try machine()["general"] as? [String: Any])?["accelerators"] as? Bool, false)
        XCTAssertEqual(model.settings?.values.accelerators, false)
    }

    func testAChoiceAndAnEdit() throws {
        model.willShow()
        model.openSettings("general")
        try select { $0.rowId == "set-choice" && $0.value == "general.keys" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "settings-choice")
        try select { $0.rowId == "set-opt" && $0.tag == "alt" }
        model.execute(.activate)
        XCTAssertFalse(model.singleKeys)
        XCTAssertEqual(model.store.view, "settings-general")
        XCTAssertEqual(model.selectedListRow?.value, "general.keys")
        try select { $0.rowId == "set-edit" && $0.value == "general.keyDelay" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "settings-edit")
        model.setFilter("450")
        model.execute(.activate)
        XCTAssertEqual(model.settings?.values.keyDelay, 450)
        XCTAssertEqual(model.store.view, "settings-general")
        try select { $0.rowId == "set-edit" && $0.value == "general.keyDelay" }
        model.execute(.activate)
        model.setFilter("5000")
        model.execute(.activate)
        XCTAssertTrue(model.flash.contains("100 to 1000"))
        XCTAssertEqual(model.store.view, "settings-edit")
    }

    func testTheCitationStyle() throws {
        model.willShow()
        model.openSettings("general")
        try select { $0.rowId == "set-styles" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "settings-styles")
        try select { $0.rowId == "set-style-opt" && $0.value == "chicago-author-date" }
        model.execute(.activate)
        XCTAssertEqual(model.settings?.values.citationStyle, "chicago-author-date")
        XCTAssertEqual(model.flash, "Citations in Chicago")
    }

    func testPasteInTheEditView() throws {
        model.willShow()
        model.openSettings("general")
        try select { $0.rowId == "set-edit" && $0.value == "general.keyDelay" }
        model.execute(.activate)
        model.setFilter("")
        desktop.clipboard = "333\n"
        XCTAssertTrue(model.handle(KeyEvent(key: .character("v"), text: "", command: true)))
        XCTAssertEqual(model.store.filterText, "333")
    }

    // ---- grouping

    func testGGroupsThePapers() throws {
        model.willShow(query: "")
        XCTAssertTrue(model.keyAction("g"))
        let view = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: config.appendingPathComponent("view.json"))) as? [String: Any])
        XCTAssertNotNil(view["grouping"] as? String)
        XCTAssertTrue(model.flash.hasPrefix("Papers: "))
    }
}
