import AppKit
import SwiftUI
import XCTest
@testable import ZoteroLauncher

// Phase 5 on the fake bridge: saved searches (saving, the Searches view, a search's menu, the
// badges), the @ pickers, Go to, Zotero's sync, the search box's runs.
@MainActor
final class LauncherModel5Tests: XCTestCase {
    private var home: URL!
    private var bridge: FakeBridge!
    private var model: LauncherModel!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("5-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed")
        // as the bridge does: a saved search's answer names its scope, and the query comes back
        bridge.answers["/search"] = { body in
            var answer = typed
            answer["query"] = body["query"] ?? ""
            if let within = body["within"] as? [String: Any] {
                answer["scope"] = ["kind": "search", "key": within["id"] ?? "", "libraryID": 0, "title": within["title"] ?? "", "query": within["query"] ?? ""]
            }
            return .ok(answer)
        }
        bridge.answers["/facets"] = { body in
            var answer = Fixture.bridge(body["field"] as? String == "year" ? "facets-year" : "facets-tag")
            answer["query"] = body["query"] ?? ""
            return .ok(answer)
        }
        bridge.answers["/sync/status"] = { _ in .ok(["ok": true, "configured": true, "running": false, "lastSync": "2026-10-13T11:55:00.000Z"]) }
        bridge.answers["/sync/start"] = { _ in .ok(["ok": true, "configured": true, "running": true, "started": true]) }
        model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: FakeRunner(), fetcher: FakeFetcher())
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private var searchesFile: URL { home.appendingPathComponent(".config/omarchy/oma-zotero-launcher/searches.json") }

    private func searches() throws -> [[String: Any]] {
        let j = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: searchesFile)) as? [String: Any])
        return j["searches"] as? [[String: Any]] ?? []
    }

    private func writeSearches(_ list: [[String: Any]]) throws {
        try FileManager.default.createDirectory(at: searchesFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: ["searches": list]).write(to: searchesFile)
    }

    private func select(_ test: (ListRow) -> Bool) throws {
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex(where: test))
    }

    private var lastWithin: [String: Any]? { bridge.bodies("/search").last?["within"] as? [String: Any] }

    // ---- saving, and the Searches view

    func testSaveWhatTheResultsShowThenOpenIt() throws {
        model.willShow(query: "a:teece")
        model.execute(.saveSearch)
        XCTAssertEqual(model.store.view, "search-edit")
        try select { $0.rowId == "search-save" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "search")
        XCTAssertEqual(try searches().map { $0["query"] as? String }, ["a:teece"])
        XCTAssertNotNil(try searches()[0]["updated"]) // stamped, for the other machine's copy
        XCTAssertTrue(model.flash.hasPrefix("Saved:"))

        XCTAssertTrue(model.keyAction("f"))
        XCTAssertEqual(model.store.view, "searches")
        try select { $0.rowId == "search" }
        model.execute(.activate)
        XCTAssertEqual(model.store.scope?.type, "search")
        XCTAssertEqual(lastWithin?["query"] as? String, "a:teece")
        XCTAssertFalse(model.searchRows.isEmpty) // the answer is this scope's: kept
        XCTAssertEqual(model.context?.text, "Saved search  a:teece")
    }

    func testNothingTypedNothingToSave() {
        model.willShow()
        model.execute(.saveSearch)
        XCTAssertEqual(model.store.view, "search")
        XCTAssertEqual(model.flash, "Type a search first; then Esc s or Ctrl+S saves it")
    }

    func testSaveAndPinMakesItsBadgeTheResultsTabGoesBack() throws {
        model.willShow(query: "dynamic capabilities")
        model.execute(.saveSearch)
        model.setFilter("Capabilities")
        try select { $0.rowId == "search-save-pin" }
        model.execute(.activate)
        let id = try XCTUnwrap(try searches().first?["id"] as? String)
        XCTAssertEqual(try searches().first?["name"] as? String, "Capabilities")
        XCTAssertTrue(model.store.atRoot)
        XCTAssertEqual(model.store.filterText, "") // the badge holds it now
        XCTAssertEqual(model.searchState.active, id)
        XCTAssertEqual(lastWithin?["query"] as? String, "dynamic capabilities")
        XCTAssertEqual(model.badges.map(\.name).prefix(2), ["All", "Capabilities"])
        XCTAssertTrue(model.placeholder().hasPrefix("Search in “Capabilities”"))
        XCTAssertTrue(model.keyState.pinnedSearches)
        model.execute(.cycleSearch(1)) // Tab: one pinned search, so back to All
        XCTAssertEqual(model.searchState.active, "")
        XCTAssertNil(lastWithin)
    }

    func testAnUnpinnedBadgeGoesBackToAllAndAFreshOpenStartsThere() throws {
        try writeSearches([["id": "s1", "name": "Mine", "query": "a:smith", "pinned": true]])
        model.willShow()
        model.selectSearch("s1")
        _ = model.keyAction("f")
        try select { $0.rowId == "search" && $0.value == "s1" }
        XCTAssertTrue(model.keyAction("p")) // unpinned
        XCTAssertEqual(model.searchState.active, "")
        model.back()
        XCTAssertNil(lastWithin)
        try writeSearches([["id": "s1", "name": "Mine", "query": "a:smith", "pinned": true]])
        model.willShow()
        model.selectSearch("s1")
        model.didHide()
        model.willShow(query: "teece") // asked for a query: a fresh start, in All
        XCTAssertEqual(model.searchState.active, "")
        XCTAssertNil(lastWithin)
    }

    func testAnEditedBadgeIsSearchedAgainWhenTheOtherMachinesCopyComesIn() throws {
        try writeSearches([["id": "s1", "name": "Mine", "query": "a:smith", "pinned": true]])
        model.willShow()
        model.selectSearch("s1")
        try writeSearches([["id": "s1", "name": "Mine", "query": "a:jones", "pinned": true]])
        model.reloadSyncedFiles()
        XCTAssertEqual(lastWithin?["query"] as? String, "a:jones")
    }

    func testALateAnswerForTheOtherBadgeIsDropped() throws {
        try writeSearches([["id": "s1", "name": "Mine", "query": "a:smith", "pinned": true]])
        model.willShow()
        let rows = model.searchRows
        bridge.hold = ["/search"]
        model.selectSearch("s1")
        model.searchState.active = "" // back on All (its search unpinned elsewhere) before the badge's answer came
        bridge.release(.ok(["query": "", "scope": ["kind": "search", "key": "s1", "libraryID": 0], "results": []]))
        XCTAssertNil(model.response?["scope"])
        XCTAssertEqual(model.searchRows.map(\.key), rows.map(\.key))
    }

    func testAMenuRenamesEditsPinsAndDeletes() throws {
        try writeSearches([["id": "s1", "name": "First", "query": "a:one"], ["id": "s2", "name": "Second", "query": "a:two"]])
        model.willShow()
        _ = model.keyAction("f")
        try select { $0.rowId == "search" && $0.value == "s2" }
        model.execute(.alternate) // Shift+Enter: its menu
        XCTAssertEqual(model.store.view, "search-menu")
        try select { $0.rowId == "search-rename" }
        model.execute(.activate)
        XCTAssertEqual(model.store.filterText, "Second")
        model.setFilter("Two")
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "search-menu")
        XCTAssertEqual(try searches()[1]["name"] as? String, "Two")
        try select { $0.rowId == "search-query" }
        model.execute(.activate)
        XCTAssertTrue(model.keyState.searchEditQuery) // the query is typed: it gets the search box's runs
        model.setFilter("a:two y:2020")
        model.execute(.activate)
        XCTAssertEqual(try searches()[1]["query"] as? String, "a:two y:2020")
        try select { $0.rowId == "search-pin" }
        model.execute(.activate)
        XCTAssertEqual(try searches()[1]["pinned"] as? Bool, true)
        try select { $0.rowId == "search-delete" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "searches")
        XCTAssertEqual(try searches().map { $0["id"] as? String }, ["s1"])
    }

    func testPinAndReorderInTheSearchesView() throws {
        try writeSearches([["id": "s1", "name": "First", "query": "a:one"], ["id": "s2", "name": "Second", "query": "a:two"]])
        model.willShow()
        _ = model.keyAction("f")
        try select { $0.rowId == "search" && $0.value == "s2" }
        model.execute(.moveRow(-1))
        XCTAssertEqual(try searches().map { $0["id"] as? String }, ["s2", "s1"])
        XCTAssertEqual(model.selectedListRow?.value, "s2")
        XCTAssertTrue(model.keyAction("p"))
        XCTAssertEqual(try searches()[0]["pinned"] as? Bool, true)
        XCTAssertEqual(model.searchViewCount, "2 searches")
    }

    func testADamagedFileIsNotWrittenOver() throws {
        try FileManager.default.createDirectory(at: searchesFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("{oops".utf8).write(to: searchesFile)
        model.willShow(query: "a:teece")
        model.execute(.saveSearch)
        try select { $0.rowId == "search-save" }
        model.execute(.activate)
        XCTAssertTrue(model.lastError.hasPrefix("searches.json isn't valid"))
        XCTAssertEqual(try String(contentsOf: searchesFile, encoding: .utf8), "{oops")
        XCTAssertEqual(model.store.view, "search-edit") // nothing saved: still there
    }

    // ---- the @ pickers

    func testAPickedTagGoesInWhereTheCaretWas() throws {
        model.willShow(query: "🚀 teece")
        model.store.caretBack = 5 // the caret after the rocket (two UTF-16 units) and its space
        model.execute(.openPicker)
        XCTAssertEqual(model.store.view, "picker")
        try select { $0.rowId == "pick-field" && $0.value == "tag" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "picker-values")
        XCTAssertEqual(bridge.bodies("/facets").last?["field"] as? String, "tag")
        let value = try XCTUnwrap(model.listRows.first { $0.rowId == "pick-value" })
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "pick-value" })
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "search")
        let term = value.value.trimmingCharacters(in: .whitespaces)
        XCTAssertTrue(model.store.filterText.hasPrefix("🚀 "), model.store.filterText)
        XCTAssertTrue(model.store.filterText.contains(term))
        XCTAssertTrue(model.store.filterText.hasSuffix("teece"))
        XCTAssertEqual(model.store.caretBack, 5) // after the term, before what was there
        XCTAssertFalse(model.store.queryLive)
        XCTAssertTrue(model.store.searchFocus)
    }

    func testFacetsTheNewestAnswerWinsAndTheUntypedPageIsKept() throws {
        model.willShow()
        model.execute(.openPicker)
        try select { $0.rowId == "pick-field" && $0.value == "tag" }
        model.execute(.activate)
        let untyped = bridge.bodies("/facets").count
        bridge.hold = ["/facets"]
        model.setFilter("str")
        model.setFilter("stra")
        bridge.release(.ok(["field": "tag", "query": "str", "values": [["value": "OLD", "label": "OLD", "token": "#OLD", "count": 1]], "total": 1, "count": 9]))
        XCTAssertFalse(model.listRows.contains { $0.value.contains("OLD") }) // an older text's answer
        bridge.release(.ok(["field": "tag", "query": "stra", "values": [["value": "strategy", "label": "strategy", "token": "#strategy", "count": 3]], "total": 1, "count": 9]))
        XCTAssertTrue(model.listRows.contains { $0.rowId == "pick-value" && $0.value.contains("strategy") })
        XCTAssertEqual(model.searchViewCount, "1 of 9")
        bridge.hold = []
        model.setFilter("")
        XCTAssertEqual(bridge.bodies("/facets").count, untyped + 2) // the untyped page: from this opening's
        XCTAssertEqual(model.listRows.count, Fixture.bridge("facets-tag")["values"].map { ($0 as? [Any])?.count ?? 0 })
        XCTAssertFalse(model.listRows.contains { $0.value.contains("strategy") })
    }

    func testDatesAndSavedSearchesNeedNoBridge() throws {
        try writeSearches([["id": "s1", "name": "Reviews", "query": "#review"]])
        model.willShow()
        model.execute(.openPicker)
        try select { $0.rowId == "pick-field" && $0.value == "added" }
        model.execute(.activate)
        XCTAssertTrue(model.listRows.contains { $0.rowId == "pick-op" }) // After, Before, Between
        XCTAssertEqual(model.searchViewCount, "")
        model.back()
        try select { $0.rowId == "pick-field" && $0.value == "search" }
        model.execute(.activate)
        XCTAssertTrue(model.listRows.contains { $0.rowId == "pick-value" })
        XCTAssertTrue(bridge.bodies("/facets").isEmpty)
    }

    // ---- Go to and Zotero's sync

    func testGoToFindsTheMacsPlacesOnly() throws {
        model.willShow(query: "searches")
        let row = try XCTUnwrap(model.searchRows.first { $0.section == "Go to" })
        XCTAssertEqual(row.kind, "searches")
        model.setFilter("chats")
        XCTAssertFalse(model.searchRows.contains { $0.section == "Go to" }) // a later phase's place
        model.setFilter("searches")
        model.enterActions(try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "searches" }))
        XCTAssertEqual(model.store.view, "searches")
    }

    func testSyncStartedFollowedAndFinished() throws {
        model.willShow()
        XCTAssertEqual(model.syncFooter.hasPrefix("synced "), true)
        XCTAssertTrue(model.keyAction("S"))
        XCTAssertEqual(model.flash, "Syncing Zotero")
        XCTAssertTrue(model.searchState.syncRunning)
        let searched = bridge.bodies("/search").count
        bridge.answers["/sync/status"] = { _ in .ok(["ok": true, "configured": true, "running": false, "run": ["ok": true]]) }
        model.refreshSync() // the timer's next look
        XCTAssertFalse(model.searchState.syncRunning)
        XCTAssertEqual(model.flash, "Zotero synced")
        XCTAssertEqual(bridge.bodies("/search").count, searched + 1) // what it brought
    }

    func testGoTosSyncLineFollowsTheSync() throws {
        model.willShow(query: "sync")
        let before = try XCTUnwrap(model.searchRows.first { $0.kind == "sync" }).subtitle
        bridge.answers["/sync/status"] = { _ in .ok(["ok": true, "configured": true, "running": true, "status": "Uploading"]) }
        model.refreshSync()
        XCTAssertNotEqual(model.searchRows.first { $0.kind == "sync" }?.subtitle, before)
    }

    func testAnErrorStaysOnItsLevelOnly() throws {
        model.willShow()
        model.execute(.openPicker)
        try select { $0.rowId == "pick-field" && $0.value == "author" }
        bridge.answers["/facets"] = { _ in .timeout }
        model.execute(.activate)
        XCTAssertTrue(model.lastError.hasPrefix("Couldn't list them"))
        model.back()
        XCTAssertEqual(model.lastError, "")
    }

    func testSyncNotSetUpSaysWhere() {
        bridge.answers["/sync/status"] = { _ in .ok(["ok": true, "configured": false]) }
        model.willShow()
        _ = model.keyAction("S")
        XCTAssertTrue(model.flash.contains("Zotero › Settings › Sync"))
        XCTAssertFalse(bridge.routes().contains("/sync/start"))
    }

    // ---- the search box

    func testTheBoxsRunsAndItsCaretInUTF16() throws {
        model.willShow()
        let runs = model.segments("a:smith 🚀 OR x", caret: 4)
        XCTAssertEqual(runs.first { $0.role == "field" }?.start, 0)
        XCTAssertEqual(runs.first { $0.role == "op" }.map { [$0.start, $0.end] }, [11, 13]) // 🚀 counts two
        let editor = NSTextView()
        editor.string = "a 🚀 b"
        editor.setSelectedRange(NSRange(location: 2, length: 0))
        XCTAssertEqual(StyledTextField.Coordinator.caretBack(editor), 4) // 🚀 is two units
        let text = NSMutableAttributedString(string: "a:smith")
        StyledTextField.Coordinator.apply(TextSegment(start: 0, end: 7, role: "field", block: true), to: text)
        XCTAssertNotNil(text.attribute(.backgroundColor, at: 3, effectiveRange: nil))
        model.typed("teece", caretBack: 2)
        XCTAssertEqual(model.store.caretBack, 2)
        XCTAssertTrue(model.store.queryLive)
        model.setFilter("other")
        XCTAssertFalse(model.store.queryLive)
    }

    func testAClickIntoTheBoxGivesItTheKeys() {
        var focused = false
        let view = StyledTextField(text: "", caretBack: 0, focused: Binding(get: { focused }, set: { focused = $0 }), placeholder: "",
                                   segments: { _, _ in [] }, onEdit: { _, _ in }, onCaret: { _ in })
        let field = StyledTextField.Field()
        let c = view.makeCoordinator()
        field.onFocus = { c.tookKeys($0) } // as makeNSView wires it
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 200, height: 40), styleMask: [.titled], backing: .buffered, defer: true)
        window.contentView?.addSubview(field)
        XCTAssertTrue(window.makeFirstResponder(field))
        XCTAssertTrue(focused)
    }
}
