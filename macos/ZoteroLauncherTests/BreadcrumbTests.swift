import XCTest
@testable import ZoteroLauncher

// The breadcrumb above the search box: each level by name, where you came from first; hidden at the top level.
@MainActor
final class BreadcrumbTests: XCTestCase {
    private var home: URL!
    private var model: LauncherModel!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("crumb-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        let bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed"), item = Fixture.bridge("item")
        bridge.answers["/search"] = { body in var a = typed; a["query"] = body["query"] ?? ""; return .ok(a) }
        bridge.answers["/item"] = { _ in .ok(item) }
        bridge.answers["/tags/list"] = { _ in .ok(Fixture.bridge("tags-list")) }
        let runner = FakeRunner()
        runner.answers["tasks"] = { _, _ in FakeRunner.json(["tasks": []]) }
        let chats: [[String: Any]] = [["id": "2026-10-12T08-00-00-000Z-abc123", "title": "Its argument", "created": "2026-10-12", "updated": "2026-10-12T08:05:00Z",
                                       "turns": 2, "model": "", "key": "P3NM4G92", "libraryID": 1, "paper": "Doe (2016)"]]
        runner.answers["chats"] = { _, _ in FakeRunner.json(["chats": chats]) }
        model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: runner, fetcher: FakeFetcher())
        model.willShow()
        settle()
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private func settle() { RunLoop.main.run(until: Date().addingTimeInterval(0.15)) }

    func testHiddenAtTheTopLevel() {
        XCTAssertEqual(model.breadcrumb, [])
    }

    func testAPapersMenuAndItsTags() throws {
        model.setFilter("work")
        settle()
        model.enterActions(try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "item" }))
        settle()
        let crumbs = model.breadcrumb
        XCTAssertEqual(crumbs.count, 2)
        XCTAssertEqual(crumbs.first, "“work”")
        XCTAssertEqual(crumbs.last, model.paperLabel, "the paper you're on, in full")
        model.enterTags()
        settle()
        let cite = String(model.paperLabel.split(separator: "·").first ?? "").trimmingCharacters(in: .whitespaces)
        XCTAssertEqual(model.breadcrumb, ["“work”", cite, "Tags"], "a paper left behind: by its authors and year")
        model.back()
        XCTAssertEqual(model.breadcrumb, crumbs)
    }

    func testWhatWasTypedAndACollection() throws {
        model.setFilter("work")
        settle()
        let (index, row) = try XCTUnwrap(model.searchRows.enumerated().first { $0.element.kind == "collection" })
        model.enterActions(index)
        settle()
        XCTAssertEqual(model.breadcrumb, ["“work”", row.title])
    }

    func testSettingsPagesByTheirOwnName() {
        model.openSettings("general")
        XCTAssertEqual(model.breadcrumb, ["Results", "Settings", "General"])
        model.goHome()
        model.openPlace("tasks")
        XCTAssertEqual(model.breadcrumb, ["Results", "Processes"])
    }

    func testALongPathKeepsItsEnds() {
        XCTAssertEqual(Breadcrumb.fit(["a", "b", "c", "d", "e", "f"], max: 4), ["a", "…", "e", "f"])
        XCTAssertEqual(Breadcrumb.fit(["a", "b", "c"], max: 4), ["a", "b", "c"])
    }

    func testClickingACrumbGoesBackThere() {
        model.openSettings("general")
        XCTAssertEqual(model.store.stack.count, 2)
        model.jumpToCrumb(1) // "Settings"
        XCTAssertEqual(model.store.view, "settings")
        model.jumpToCrumb(0) // "Results"
        XCTAssertTrue(model.store.atRoot)
        XCTAssertEqual(model.breadcrumb, [])
    }

    func testATagsMenuIsNamedByTheTag() throws {
        model.setFilter("work")
        settle()
        model.enterActions(try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "item" }))
        settle()
        model.enterTags()
        settle()
        let tag = try XCTUnwrap(model.listRows.first { $0.rowId == "tag" }).tag
        model.openTagMenu(tag)
        XCTAssertEqual(model.breadcrumb.last, "#" + tag)
    }

    func testPickingAPaperSaysWhatFor() {
        model.store.push("search")
        model.store.pickFor = "chat"
        XCTAssertEqual(model.breadcrumb.last, "New chat: pick a paper")
        model.store.pickFor = "todo"
        XCTAssertEqual(model.breadcrumb.last, "Pick the task's paper")
    }

    // From Chats there's no paper's menu below: the chat's crumb names its paper first.
    func testAChatsMenuFromChatsNamesItsPaper() throws {
        model.openPlace("chats")
        settle()
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "chat-open" })
        model.execute(.alternate)
        XCTAssertEqual(model.store.view, "chat-menu")
        XCTAssertEqual(model.breadcrumb.last, "Doe (2016) · Its argument")
    }

    // The reader's crumb is the note's title: the line under it doesn't say it again.
    func testTheReadersPlaceholderDoesntRepeatTheCrumb() throws {
        model.setFilter("work")
        settle()
        model.enterActions(try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "item" }))
        settle()
        guard let i = model.listRows.firstIndex(where: { $0.rowId == "note" }) else { throw XCTSkip("the item fixture has no notes") }
        model.activateAction(i)
        settle()
        XCTAssertTrue(model.store.inNote)
        XCTAssertNotEqual(model.headerPlaceholder(), model.breadcrumb.last)
    }
}
