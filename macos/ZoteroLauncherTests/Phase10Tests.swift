import ServiceManagement
import XCTest
@testable import ZoteroLauncher

// Phase 10: the keys view (? and F1, the Mac's notation), Open at login with a fake service.
@MainActor
final class Phase10Tests: XCTestCase {
    private var home: URL!
    private var model: LauncherModel!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("10-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        let bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed")
        bridge.answers["/search"] = { body in var a = typed; a["query"] = body["query"] ?? ""; return .ok(a) }
        let runner = FakeRunner()
        runner.answers["tasks"] = { _, _ in FakeRunner.json(["tasks": []]) }
        model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: runner, fetcher: FakeFetcher())
        model.willShow()
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    // what the search box types (the box, not the key handler, owns the text)
    private func type(_ text: String) {
        model.store.searchFocus = true
        model.setFilter(text)
    }

    private var keyLines: [String] { model.listRows.map { "\($0.trailing) \($0.label)" } }

    func testF1OpensTheKeysWithWhereYouAreFirst() throws {
        _ = model.handle(KeyEvent(key: .f1, text: ""))
        XCTAssertEqual(model.store.view, "keys")
        let first = try XCTUnwrap(model.listRows.first)
        XCTAssertTrue(first.section.hasPrefix("Here"), first.section)
        XCTAssertGreaterThan(model.listRows.count, 50)
        XCTAssertTrue(model.hints().contains("type to find a key"))
        XCTAssertFalse(model.hints().contains { $0.hasSuffix(" keys") }, "the keys view hints itself")
    }

    func testF1WhileTypingOpensTheKeys() {
        type("graph")
        XCTAssertEqual(model.store.filterText, "graph")
        _ = model.handle(KeyEvent(key: .f1, text: ""))
        XCTAssertEqual(model.store.view, "keys")
    }

    func testQuestionMarkInAMenuOpensTheKeys() throws {
        model.openPlace("settings")
        XCTAssertNotEqual(model.store.view, "keys")
        _ = model.handle(KeyEvent(key: .f1, text: ""))
        XCTAssertEqual(model.store.view, "keys")
        // again: nothing new pushed, and Esc goes back where it was
        _ = model.handle(KeyEvent(key: .f1, text: ""))
        if model.singleKeys { _ = model.handle(KeyEvent(key: .escape, text: "")) } // (one-key mode: the list gets the keys first)
        _ = model.handle(KeyEvent(key: .escape, text: ""))
        XCTAssertNotEqual(model.store.view, "keys")
    }

    func testTheKeysAreInTheMacsNotation() {
        _ = model.handle(KeyEvent(key: .f1, text: ""))
        let lines = keyLines.joined(separator: "\n")
        XCTAssertFalse(lines.contains("Ctrl+"), "a Linux key left")
        XCTAssertFalse(lines.contains("Super"), "a Hyprland key left")
        XCTAssertTrue(lines.contains("⌘"))
        XCTAssertTrue(lines.contains("↵"))
    }

    func testTypingFindsAKeyAndEscClearsThenGoesBack() {
        _ = model.handle(KeyEvent(key: .f1, text: ""))
        let all = model.listRows.count
        type("sync")
        XCTAssertLessThan(model.listRows.count, all)
        XCTAssertTrue(keyLines.contains { $0.lowercased().contains("sync") })
        if model.singleKeys { _ = model.handle(KeyEvent(key: .escape, text: "")) } // (one-key mode: the list gets the keys first)
        _ = model.handle(KeyEvent(key: .escape, text: ""))
        XCTAssertEqual(model.store.view, "keys")
        XCTAssertEqual(model.store.filterText, "")
        _ = model.handle(KeyEvent(key: .escape, text: ""))
        XCTAssertNotEqual(model.store.view, "keys")
    }

    func testGoToHasKeybindings() {
        XCTAssertTrue(LauncherModel.goToPlaces.contains("keys"))
        model.openPlace("keys")
        XCTAssertEqual(model.store.view, "keys")
    }

    func testTheKeysViewIsForTyping() {
        _ = model.handle(KeyEvent(key: .f1, text: ""))
        XCTAssertTrue(model.store.searchFocus, "letters type there, in one-key mode too")
        XCTAssertEqual(model.hints().first, "type to find a key")
    }

    func testGoToExtractsEveryPapersText() {
        model.openPlace("extract-all")
        XCTAssertTrue(model.flash.hasPrefix("Extracting the text of every paper with a PDF"), model.flash)
        XCTAssertNotNil(model.extractFile?.catchup)
    }

    func testKeyInfoRowsDoNothing() throws {
        _ = model.handle(KeyEvent(key: .f1, text: ""))
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "key-info" })
        _ = model.handle(KeyEvent(key: .enter, text: "\r"))
        XCTAssertEqual(model.store.view, "keys")
    }
}

// Open at login: the toggle with a fake SMAppService.
@MainActor
final class LoginItemTests: XCTestCase {
    private final class FakeService: LoginService {
        var status: SMAppService.Status = .notRegistered
        var onRegister: SMAppService.Status = .enabled
        var fail: Error?
        func register() throws { if let fail { throw fail }; status = onRegister }
        func unregister() throws { if let fail { throw fail }; status = .notRegistered }
    }

    func testOnAndOffReadTheService() {
        let service = FakeService()
        let item = LoginItem(service: service, openSettings: { XCTFail("no approval asked") })
        XCTAssertFalse(item.enabled)
        item.set(true)
        XCTAssertTrue(item.enabled)
        XCTAssertTrue(item.detail.contains("starts when you log in"))
        item.set(false)
        XCTAssertFalse(item.enabled)
    }

    func testApprovalOpensLoginItems() {
        let service = FakeService()
        service.onRegister = .requiresApproval
        var opened = 0
        let item = LoginItem(service: service, openSettings: { opened += 1 })
        item.set(true)
        XCTAssertFalse(item.enabled)
        XCTAssertTrue(item.needsApproval)
        XCTAssertEqual(opened, 1)
        XCTAssertTrue(item.detail.contains("Login Items"))
    }

    func testAFailureIsSaid() {
        let service = FakeService()
        service.fail = NSError(domain: "t", code: 1, userInfo: [NSLocalizedDescriptionKey: "not allowed"])
        let item = LoginItem(service: service, openSettings: {})
        item.set(true)
        XCTAssertFalse(item.enabled)
        XCTAssertEqual(item.detail, "Couldn't turn on Open at login: not allowed")
    }
}

// What VoiceOver reads: rows, pills, the row's keys; no motion with Reduce Motion.
final class AccessTests: XCTestCase {
    private func row(_ fields: [String: Any]) throws -> ListRow {
        var base: [String: Any] = ["rowId": "x", "icon": "", "label": "Open the PDF", "labelHtml": "", "detail": "In Zotero's reader", "available": true, "submenu": false,
                                   "showCheck": false, "checked": false, "swatch": "", "badge": "", "trailing": "", "attKey": "", "attLibraryID": 0, "attContentType": "",
                                   "noteKey": "", "noteLibraryID": 0, "tag": "", "section": "", "promptId": "", "value": "", "itemKey": "", "itemLibraryID": 0, "itemTitle": "",
                                   "path": "", "session": "", "field": "", "editText": "", "pills": "", "pillOn": "", "pill": "", "pillKind": "", "chips": "", "chipKind": "", "decision": ""]
        base.merge(fields) { _, b in b }
        return try JSONDecoder().decode(ListRow.self, from: JSONSerialization.data(withJSONObject: base))
    }

    func testARowReadsItsLabelDetailAndKeys() throws {
        XCTAssertEqual(Access.label(try row(["trailing": "⌘S"])), "Open the PDF, In Zotero's reader, ⌘S")
        XCTAssertEqual(Access.value(try row([:])), "")
        XCTAssertEqual(Access.value(try row(["available": false, "submenu": true])), "opens a list, dimmed")
        XCTAssertEqual(Access.value(try row(["showCheck": true, "checked": true])), "checked")
        XCTAssertEqual(Access.label(try row(["pill": "reading", "pillKind": "status", "detail": ""])), "Open the PDF, status: reading")
    }

    func testAResultThatOpensAListSaysSo() throws {
        let fields: [String: Any] = ["section": "", "kind": "item", "key": "K", "libraryID": 1, "itemType": "journalArticle", "icon": "", "title": "A paper", "titleHtml": "",
                                     "subtitle": "Doe · 2020", "openState": "", "pdfCount": 0, "noteCount": 0, "tagsText": "", "ranks": "", "status": ""]
        let row = try JSONDecoder().decode(SearchRow.self, from: JSONSerialization.data(withJSONObject: fields))
        XCTAssertEqual(Access.value(row, opens: true), "opens a list")
        XCTAssertEqual(Access.value(row, opens: false), "")
    }

    func testPillsReadAsTheirKind() {
        XCTAssertEqual(Access.pill("reading", kind: "status"), "status: reading")
        XCTAssertEqual(Access.pill("task: Read it", kind: "task"), "task: Read it")
        XCTAssertEqual(Access.pill("✓ Text extracted", kind: "neutral"), "✓ Text extracted")
    }

    func testTheHintIsTheRowsOwnKeys() {
        XCTAssertEqual(Access.hint(["/ search", "? keys", "↵ open", "⇧↵ rename or delete", "del delete"]), "↵ open, ⇧↵ rename or delete")
        XCTAssertEqual(Access.hint(["F1 keys", "type to search", "↑↓ move"]), "↑↓ move")
    }

    func testReduceMotionMeansNoAnimation() {
        XCTAssertNil(Motion.animation(reduce: true))
        XCTAssertNotNil(Motion.animation(reduce: false))
    }

    func testTheSlideBetweenListsIsShortAndOffWithReduceMotion() {
        XCTAssertNil(Motion.slide(reduce: true))
        XCTAssertNotNil(Motion.slide(reduce: false))
    }

    @MainActor
    func testTheStoreKnowsWhichWayYouMoved() {
        let store = AppStore()
        store.push("actions")
        XCTAssertTrue(store.movedIn)
        _ = store.back { 0 }
        XCTAssertFalse(store.movedIn)
    }
}

// JSCore's fast path (one JSONSerialization call when no RawJSON is inside) gives what the value-by-value path gives.
final class JSONTextTests: XCTestCase {
    private func parsed(_ text: String) throws -> NSObject {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8), options: [.fragmentsAllowed]) as? NSObject)
    }

    func testTheFastPathAndTheSplicedOneAgree() throws {
        let plain: [String: Any] = ["a": [1, 2.5, true, NSNull(), "x"], "b": ["c": false, "d": [[String: Any]()]]]
        let fast = try JSCore.jsonText(plain)
        // the same value, a RawJSON nested in an array in a dictionary: the spliced path
        var spliced = plain
        spliced["b"] = ["c": false, "d": [RawJSON(text: "{}")]]
        XCTAssertEqual(try parsed(fast), try parsed(try JSCore.jsonText(spliced)))
        XCTAssertEqual(try parsed(fast), plain as NSDictionary)
        XCTAssertEqual(try JSCore.jsonText(RawJSON(text: "{\"z\":1,\"a\":2}")), "{\"z\":1,\"a\":2}") // (its order kept)
    }
}
