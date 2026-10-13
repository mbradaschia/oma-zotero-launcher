import XCTest
@testable import ZoteroLauncher

// Phase 4b on the fake bridge: tasks (the Tasks view, a task's page, new tasks, keys, the due
// date), their tags, Settings › Tasks and Paper status, and the sync folder's conflict copies.
@MainActor
final class LauncherModel4bTests: XCTestCase {
    private var home: URL!
    private var bridge: FakeBridge!
    private var model: LauncherModel!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("4b-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed"), item = Fixture.bridge("item")
        bridge.answers["/search"] = { _ in .ok(typed) }
        bridge.answers["/item"] = { _ in .ok(item) }
        bridge.answers["/cite"] = { _ in .ok(["ok": true, "entries": [["text": "(A, 2020)"]]]) }
        bridge.answers["/tags/update"] = { _ in .ok(["ok": true, "tags": []]) }
        bridge.answers["/tags/rename"] = { _ in .ok(["ok": true, "count": 1, "left": 0]) }
        bridge.answers["/tags/count"] = { _ in .ok(["ok": true, "count": 2]) }
        bridge.answers["/tags/delete"] = { _ in .ok(["ok": true, "count": 2, "left": 0]) }
        bridge.answers["/tags/prefixed"] = { _ in .ok(["ok": true, "tags": []]) }
        bridge.answers["/tags/changes"] = { _ in .ok(["ok": true, "seq": 1, "changes": []]) }
        model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"])
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private var todosFile: URL { home.appendingPathComponent(".config/omarchy/oma-zotero-launcher/todos.json") }

    private func todos() throws -> [[String: Any]] {
        let j = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: todosFile)) as? [String: Any])
        return j["todos"] as? [[String: Any]] ?? []
    }

    private func select(_ test: (ListRow) -> Bool) throws {
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex(where: test))
    }

    private func addTask(_ line: String) throws {
        model.willShow(query: "")
        XCTAssertTrue(model.keyAction("t"))
        model.setFilter(line)
        try select { $0.rowId == "todo-quick" }
        model.execute(.activate) // added, its page opened
    }

    // ---- the Tasks view and a task's page

    func testAQuickLineAddsATaskAndOpensIt() throws {
        try addTask("Read the intro #next !! @2026-12-01")
        let list = try todos()
        XCTAssertEqual(list.count, 1)
        XCTAssertEqual(list[0]["description"] as? String, "Read the intro")
        XCTAssertEqual(list[0]["priority"] as? String, "medium")
        XCTAssertEqual(list[0]["due"] as? String, "2026-12-01")
        XCTAssertEqual(model.store.view, "todo-edit")
        XCTAssertTrue(model.placeholder().hasPrefix("‹ Task · Read the intro"))
        XCTAssertTrue(model.listRows.contains { $0.rowId == "todo-status" && $0.field == "pills" })
    }

    func testTabCyclesTheStatusDTogglesDoneBangThePriority() throws {
        try addTask("Write it")
        let status = try todos()[0]["status"] as? String
        try select { $0.rowId == "todo-status" }
        XCTAssertTrue(model.handle(KeyEvent(key: .tab, text: "")))
        XCTAssertNotEqual(try todos()[0]["status"] as? String, status)
        XCTAssertTrue(model.keyAction("d"))
        XCTAssertTrue(model.flash.hasPrefix("Now: "))
        XCTAssertTrue(model.keyAction("!"))
        XCTAssertEqual(try todos()[0]["priority"] as? String, "low")
    }

    func testDeleteLeavesATombstoneAndUBringsItBack() throws {
        try addTask("Gone soon")
        model.back()
        XCTAssertEqual(model.store.view, "todos")
        try select { $0.rowId == "todo" }
        XCTAssertTrue(model.handle(KeyEvent(key: .delete, text: "")))
        XCTAssertEqual(try todos().count, 0)
        let file = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: todosFile)) as? [String: Any])
        XCTAssertEqual((file["deleted"] as? [[String: Any]])?.count, 1) // for the other machine's copy
        XCTAssertTrue(model.keyAction("u"))
        XCTAssertEqual(try todos().count, 1)
        let back = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: todosFile)) as? [String: Any])
        XCTAssertNil(back["deleted"])
    }

    func testTheDueDatesCalendar() throws {
        try addTask("Due one @2026-10-20")
        try select { $0.rowId == "todo-due" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "todo-due")
        XCTAssertEqual(model.tasks.calDate, "2026-10-20")
        XCTAssertTrue(model.handle(KeyEvent(key: .right, text: "")))
        XCTAssertTrue(model.handle(KeyEvent(key: .down, text: "")))
        XCTAssertEqual(model.tasks.calDate, "2026-10-28")
        XCTAssertTrue(model.handle(KeyEvent(key: .enter, text: "")))
        XCTAssertEqual(model.store.view, "todo-edit")
        XCTAssertEqual(try todos()[0]["due"] as? String, "2026-10-28")
        try select { $0.rowId == "todo-due" }
        model.execute(.activate)
        XCTAssertTrue(model.handle(KeyEvent(key: .delete, text: "")))
        XCTAssertEqual(try todos()[0]["due"] as? String, "")
    }

    func testTheDescriptionIsEditedInTheHeader() throws {
        try addTask("Old words")
        try select { $0.rowId == "todo-desc" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "todo-text")
        XCTAssertEqual(model.store.filterText, "Old words")
        model.setFilter("New words")
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "todo-edit")
        XCTAssertEqual(try todos()[0]["description"] as? String, "New words")
    }

    func testATaskAboutAPaperFromItsMenuAndItsTagFollows() throws {
        model.willShow(query: "")
        model.status = "ready"
        model.enterActions(model.searchRows.firstIndex { $0.kind == "item" }!)
        XCTAssertTrue(model.keyAction("a"))
        XCTAssertEqual(model.store.view, "todo-new")
        XCTAssertTrue(model.listRows.contains { $0.section == "About" && $0.rowId == "info" && $0.label != "No paper" })
        model.setFilter("Summarise it")
        model.execute(.activate)
        let task = try XCTUnwrap(try todos().first)
        XCTAssertEqual((task["item"] as? [String: Any])?["key"] as? String, model.actionItem?.key)
        XCTAssertEqual((bridge.bodies("/tags/update").last?["add"] as? [String])?.first?.hasPrefix("t/"), true)
        model.goHome()
        model.enterActions(model.searchRows.firstIndex { $0.kind == "item" }!)
        XCTAssertTrue(model.listRows.contains { $0.section == "Tasks" && $0.rowId == "todo" && $0.label == "Summarise it" })
    }

    func testPickAPaperForATask() throws {
        try addTask("About something")
        try select { $0.rowId == "todo-pick" }
        model.execute(.activate)
        XCTAssertEqual(model.store.pickFor, "todo")
        model.enterActions(model.searchRows.firstIndex { $0.kind == "item" }!)
        XCTAssertEqual(model.store.view, "todo-edit")
        XCTAssertNotNil(try todos()[0]["item"] as? [String: Any])
        try select { $0.rowId == "todo-unlink" }
        model.execute(.activate)
        XCTAssertNil(try todos()[0]["item"] as? [String: Any])
    }

    // ---- Settings › Tasks and Paper status

    func testAStatusAddedRenamedAndRemovedMovingItsTasks() throws {
        try addTask("Mine #next")
        model.goHome()
        model.openSettings("tasks")
        try select { $0.rowId == "status-add" && $0.value == "waiting" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "status-name")
        model.setFilter("On hold")
        model.execute(.activate)
        XCTAssertTrue(model.todoStatuses.contains { $0["name"] as? String == "On hold" })
        try select { $0.rowId == "status" && $0.label == "Next" }
        model.execute(.activate)
        try select { $0.rowId == "status-remove" }
        model.execute(.activate)
        XCTAssertFalse(model.todoStatuses.contains { $0["name"] as? String == "Next" })
        XCTAssertNotEqual(try todos()[0]["status"] as? String, "next") // moved
    }

    func testARemovedStatusIsNotBroughtBackByItsTagStillOnPapers() throws {
        model.willShow()
        model.status = "ready"
        model.openSettings("tasks")
        try select { $0.rowId == "status" && $0.label == "Next" }
        model.execute(.activate)
        try select { $0.rowId == "status-remove" }
        model.execute(.activate)
        bridge.answers["/tags/prefixed"] = { _ in .ok(["ok": true, "tags": ["t/next", "t/Next"]]) } // being taken off the papers
        model.syncStatusLists()
        XCTAssertFalse(model.todoStatuses.contains { ($0["name"] as? String)?.lowercased() == "next" })
    }

    func testAPaperStatusAdded() throws {
        model.willShow()
        model.openSettings("paper-status")
        try select { $0.rowId == "pstatus-add" }
        model.execute(.activate)
        model.setFilter("skimmed")
        model.execute(.activate)
        XCTAssertEqual(model.paperStatuses.last, "skimmed")
    }

    // ---- conflict copies

    private func write(_ text: String, _ path: String, at time: TimeInterval? = nil) throws {
        let url = home.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: url)
        if let time { try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: time)], ofItemAtPath: url.path) }
    }

    func testConflictCopiesAreMergedAndRemoved() throws {
        let core = try JSCore()
        let shared = home.appendingPathComponent("S/shared")
        try write(#"{"todos": [{"id": "a", "description": "Mine", "updated": "2026-10-05T00:00:00Z"}]}"#, "S/shared/todos.json", at: 1000)
        try write(#"{"todos": [{"id": "b", "description": "Theirs", "updated": "2026-10-06T00:00:00Z"}]}"#, "S/shared/todos.sync-conflict-20261013-101500-ABCDEFG.json", at: 2000)
        try write("old words", "S/shared/prompts/sum.md", at: 1000)
        try write("new words", "S/shared/prompts/sum.sync-conflict-20261013-101500-ABC1234.md", at: 2000)
        let out = ConflictMerger.run(core, in: shared, machine: "mac")
        XCTAssertEqual(out.merged.count, 2)
        let merged = try String(contentsOf: shared.appendingPathComponent("todos.json"), encoding: .utf8)
        XCTAssertTrue(merged.contains("Mine") && merged.contains("Theirs"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: shared.appendingPathComponent("todos.sync-conflict-20261013-101500-ABCDEFG.json").path))
        XCTAssertEqual(try String(contentsOf: shared.appendingPathComponent("prompts/sum.md"), encoding: .utf8), "new words")
        // the copy was newer: the file kept beside it is this machine's
        XCTAssertEqual(try String(contentsOf: shared.appendingPathComponent("prompts/sum.conflict-mac.md"), encoding: .utf8), "old words")
    }

    func testTheKeptFileIsNamedForWhoseItWas() throws {
        let core = try JSCore()
        let shared = home.appendingPathComponent("S/shared")
        try write("mine, newer", "S/shared/prompts/a.md", at: 3000)
        try write("theirs, older", "S/shared/prompts/a.sync-conflict-20261013-101500-ARCHBOX.md", at: 2000)
        XCTAssertEqual(ConflictMerger.run(core, in: shared, machine: "mac").merged.count, 1)
        XCTAssertEqual(try String(contentsOf: shared.appendingPathComponent("prompts/a.md"), encoding: .utf8), "mine, newer")
        XCTAssertEqual(try String(contentsOf: shared.appendingPathComponent("prompts/a.conflict-ARCHBOX.md"), encoding: .utf8), "theirs, older")
    }

    func testTwoCopiesOfOneFileAreBothMergedIn() throws {
        let core = try JSCore()
        let shared = home.appendingPathComponent("S/shared")
        try write(#"{"todos": [{"id": "a", "description": "Mine", "updated": "2026-10-05T00:00:00Z"}]}"#, "S/shared/todos.json", at: 1000)
        try write(#"{"todos": [{"id": "b", "description": "Second", "updated": "2026-10-06T00:00:00Z"}]}"#, "S/shared/todos.sync-conflict-20261013-101500-AAAAAAA.json", at: 2000)
        try write(#"{"todos": [{"id": "c", "description": "Third", "updated": "2026-10-07T00:00:00Z"}]}"#, "S/shared/todos.sync-conflict-20261013-101600-BBBBBBB.json", at: 3000)
        XCTAssertEqual(ConflictMerger.run(core, in: shared).merged.count, 2)
        let merged = try String(contentsOf: shared.appendingPathComponent("todos.json"), encoding: .utf8)
        XCTAssertTrue(["Mine", "Second", "Third"].allSatisfy(merged.contains))
        let left = try FileManager.default.contentsOfDirectory(atPath: shared.path)
        XCTAssertEqual(left, ["todos.json"])
    }

    func testAMalformedCopyIsMergedAsEmptyAndAnUnreadableOneStays() throws {
        let core = try JSCore()
        let shared = home.appendingPathComponent("S/shared")
        try write(#"{"todos": [{"id": "a", "description": "Mine", "updated": "2026-10-05T00:00:00Z"}]}"#, "S/shared/todos.json", at: 1000)
        try write("{not json", "S/shared/todos.sync-conflict-20261013-101500-AAAAAAA.json", at: 2000)
        _ = ConflictMerger.run(core, in: shared)
        XCTAssertTrue(try String(contentsOf: shared.appendingPathComponent("todos.json"), encoding: .utf8).contains("Mine")) // nothing of mine lost
        // both sides unreadable: nothing to merge, the copy left for a person to look at
        try write("{broken", "S/shared/pins.json", at: 1000)
        try write("{also broken", "S/shared/pins.sync-conflict-20261013-101500-AAAAAAA.json", at: 2000)
        let out = ConflictMerger.run(core, in: shared)
        XCTAssertFalse(out.merged.contains { $0.hasSuffix("pins.json") })
        XCTAssertTrue(out.problems.isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: shared.appendingPathComponent("pins.sync-conflict-20261013-101500-AAAAAAA.json").path))
        XCTAssertEqual(try String(contentsOf: shared.appendingPathComponent("pins.json"), encoding: .utf8), "{broken")
    }

    func testACopyBesideAMissingFileWaitsUntilItIsAMomentOld() throws {
        let core = try JSCore()
        let shared = home.appendingPathComponent("S/shared")
        let now = Date(timeIntervalSince1970: 100_000)
        try write("theirs", "S/shared/prompts/b.sync-conflict-20261013-101500-AAAAAAA.md", at: 100_000 - 5) // the sync tool mid-rename
        XCTAssertTrue(ConflictMerger.run(core, in: shared, now: now).merged.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: shared.appendingPathComponent("prompts/b.md").path))
        let later = Date(timeIntervalSince1970: 100_000 + 60)
        XCTAssertEqual(ConflictMerger.run(core, in: shared, now: later).merged.count, 1)
        XCTAssertEqual(try String(contentsOf: shared.appendingPathComponent("prompts/b.md"), encoding: .utf8), "theirs")
    }

    func testTheFolderWatcherSeesAFileReplacedByRename() throws {
        let folder = home.appendingPathComponent("W")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let seen = expectation(description: "a change reported")
        seen.assertForOverFulfill = false
        let watcher = FolderWatcher(folder, latency: 0.2) { seen.fulfill() }
        XCTAssertNotNil(watcher)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            try? Data("x".utf8).write(to: folder.appendingPathComponent("todos.json"), options: .atomic)
        }
        wait(for: [seen], timeout: 10)
        withExtendedLifetime(watcher) {}
    }

    func testLinksAreNeverMerged() throws {
        let core = try JSCore()
        let shared = home.appendingPathComponent("S/shared")
        try write("secret key", "secret")
        try write(#"{"todos": []}"#, "S/shared/todos.json")
        try FileManager.default.createSymbolicLink(at: shared.appendingPathComponent("todos.sync-conflict-20261013-101500-ABCDEFG.json"),
                                                   withDestinationURL: home.appendingPathComponent("secret"))
        try write("{}", "S/shared/pins.sync-conflict-20261013-101500-ABCDEFG.json")
        try FileManager.default.createSymbolicLink(at: shared.appendingPathComponent("pins.json"), withDestinationURL: home.appendingPathComponent("secret"))
        let out = ConflictMerger.run(core, in: shared)
        XCTAssertTrue(out.merged.isEmpty)
        XCTAssertEqual(try String(contentsOf: shared.appendingPathComponent("todos.json"), encoding: .utf8), #"{"todos": []}"#)
        XCTAssertEqual(try String(contentsOf: home.appendingPathComponent("secret"), encoding: .utf8), "secret key")
        XCTAssertEqual(out.problems.count, 2)
    }

    func testALinkSwappedInIsNeitherReadNorWrittenThrough() throws {
        try write("secret key", "secret")
        let link = home.appendingPathComponent("S/shared/todos.json")
        try FileManager.default.createDirectory(at: link.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: home.appendingPathComponent("secret"))
        XCTAssertNil(ConflictMerger.readPlain(link))
        try ConflictMerger.writePlain("merged", to: link)
        XCTAssertEqual(try String(contentsOf: home.appendingPathComponent("secret"), encoding: .utf8), "secret key")
        XCTAssertNotEqual(try link.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink, true)
        XCTAssertEqual(ConflictMerger.readPlain(link), "merged")
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: link.deletingLastPathComponent().path), ["todos.json"]) // no temp left
    }

    func testOpeningMergesTheSyncFoldersCopies() throws {
        let sync = home.appendingPathComponent("Sync")
        try write(#"{"general": {"syncDir": "\#(sync.path)"}}"#, ".config/omarchy/oma-zotero-launcher.json")
        try write("{}", "Sync/shared/oma-zotero-sync.json")
        try write(#"{"pins": [{"key": "ABCD1234", "libraryID": 1, "type": "item", "updated": "2026-10-01T00:00:00Z"}]}"#, "Sync/shared/pins.json")
        try write(#"{"pins": [{"key": "WXYZ9876", "libraryID": 1, "type": "collection", "updated": "2026-10-02T00:00:00Z"}]}"#, "Sync/shared/pins (arch's conflicted copy 2026-10-13).json")
        model.willShow()
        XCTAssertEqual(Set(model.pins?.pins.map(\.key) ?? []), ["ABCD1234", "WXYZ9876"])
        XCTAssertEqual(bridge.bodies("/search").first.flatMap { ($0["pinned"] as? [Any])?.count }, 2)
    }
}
