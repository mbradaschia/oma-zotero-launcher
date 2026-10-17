import XCTest
@testable import ZoteroLauncher

// What Zotero misses while it's away is sent when it's back (renames and deletes after a restart too), a paper with two
// statuses keeps one, and the paper in view follows a rename or delete everywhere.
@MainActor
final class TagQueueTests: XCTestCase {
    private var home: URL!
    private var bridge: FakeBridge!
    private var model: LauncherModel!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("tagq-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed"), item = Fixture.bridge("item")
        bridge.answers["/search"] = { _ in .ok(typed) }
        bridge.answers["/item"] = { _ in .ok(item) }
        bridge.answers["/cite"] = { _ in .ok(["ok": true, "entries": [["text": "(A, 2020)"]]]) }
        bridge.answers["/tags/update"] = { body in .ok(["ok": true, "tags": ((body["add"] as? [String]) ?? []).map { ["tag": $0, "type": 0] }]) }
        bridge.answers["/tags/rename"] = { _ in .ok(["ok": true, "count": 2, "left": 0]) }
        bridge.answers["/tags/delete"] = { _ in .ok(["ok": true, "count": 2, "left": 0]) }
        model = makeModel()
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private func makeModel() -> LauncherModel {
        LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: FakeRunner(), fetcher: FakeFetcher())
    }

    private func openMenu() {
        model.willShow(query: "")
        model.enterActions(model.searchRows.firstIndex { $0.kind == "item" }!)
    }

    func testARenameWhileZoteroIsAwayIsKeptAndSentWhenItsBack() throws {
        model.willShow(query: "")
        bridge.answers["/tags/rename"] = { _ in .zoteroDown }
        model.renameTagEverywhere("s/reading", "s/in progress")
        XCTAssertEqual(model.pendingTagOps, [PendingTagOp(op: "rename", from: "s/reading", to: "s/in progress")])
        XCTAssertTrue(model.tagIsGoing("S/Reading")) // not read back as a status meanwhile
        model.renameTagEverywhere("s/in progress", "s/doing") // a rename of the rename: one, from the first name
        XCTAssertEqual(model.pendingTagOps, [PendingTagOp(op: "rename", from: "s/reading", to: "s/doing")])

        let again = makeModel() // the app started again: still there
        again.willShow(query: "")
        XCTAssertEqual(again.pendingTagOps.count, 1)

        bridge.answers["/tags/rename"] = { _ in .ok(["ok": true, "count": 2, "left": 0]) }
        again.status = "zotero-down"
        again.status = "ready" // Zotero is back
        XCTAssertEqual(bridge.bodies("/tags/rename").last?["from"] as? String, "s/reading")
        XCTAssertEqual(bridge.bodies("/tags/rename").last?["to"] as? String, "s/doing")
        XCTAssertTrue(again.pendingTagOps.isEmpty)
    }

    func testARefusedRenameIsNotKept() {
        model.willShow(query: "")
        bridge.answers["/tags/rename"] = { _ in .error("read-only") }
        model.renameTagEverywhere("s/a", "s/b")
        XCTAssertTrue(model.pendingTagOps.isEmpty)
        XCTAssertTrue(model.flash.hasPrefix("Couldn't rename"))
    }

    func testTaskTagsMadeWhileZoteroIsAwayAreSentWhenItsBack() throws {
        openMenu()
        model.status = "zotero-down"
        model.execute(.cycleDefaultTask(1))
        model.flushDefaultTasks(now: Date(timeIntervalSince1970: 1_800_000_000))
        XCTAssertTrue(bridge.bodies("/tags/update").isEmpty)
        XCTAssertFalse(model.tasks.missedTaskTags.isEmpty)
        model.status = "ready"
        let added = bridge.bodies("/tags/update").flatMap { $0["add"] as? [String] ?? [] }
        XCTAssertTrue(added.contains { $0.hasPrefix("t/") })
        XCTAssertTrue(model.tasks.missedTaskTags.isEmpty)
        XCTAssertTrue(model.tasks.tagsSynced) // and every paper's t/ tags set again
    }

    func testAPaperWithTwoStatusesKeepsOne() throws {
        openMenu()
        model.details?["tags"] = [["tag": "s/reading", "type": 0], ["tag": "s/later", "type": 0], ["tag": "plain", "type": 0]]
        model.execute(.cycleStatus(1))
        model.flushStatuses()
        let body = try XCTUnwrap(bridge.bodies("/tags/update").last)
        let add = body["add"] as? [String] ?? [], remove = body["remove"] as? [String] ?? []
        XCTAssertEqual(add.count, 1)
        XCTAssertTrue(remove.contains("s/reading") && remove.contains("s/later"), "\(remove)")
        XCTAssertFalse(remove.contains("plain"))
        XCTAssertFalse(remove.contains { add.contains($0) })
    }

    func testThePaperInViewFollowsARenameEverywhere() throws {
        openMenu()
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        let before = bridge.bodies("/item").count
        model.renameTagEverywhere("old", "new")
        XCTAssertEqual(bridge.bodies("/item").count, before + 1) // its tags read again
    }
}
