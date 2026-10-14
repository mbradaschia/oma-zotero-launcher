import XCTest
@testable import ZoteroLauncher

// The launcher on a fake bridge and desktop, its files in a temporary home: the search, a paper's
// menu and its rows, the arrangement, the keys and the chrome, as ZoteroSearch.qml has them.
@MainActor
final class LauncherModelTests: XCTestCase {
    private var home: URL!
    private var bridge: FakeBridge!
    private var desktop: FakeDesktop!
    private var model: LauncherModel!
    private var closed = 0

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("model-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        bridge = FakeBridge()
        desktop = FakeDesktop()
        let typed = Fixture.bridge("search-typed")
        let item = Fixture.bridge("item")
        bridge.answers["/search"] = { _ in .ok(typed) }
        bridge.answers["/item"] = { _ in .ok(item) }
        bridge.answers["/cite"] = { body in .ok(["ok": true, "entries": [["text": body["mode"] as? String == "citation" ? "(Teece et al., 1997)" : "Teece, D. J. (1997). Dynamic capabilities."]]]) }
        bridge.answers["/open"] = { _ in .ok(["ok": true, "windowKind": "main"]) }
        bridge.answers["/reveal"] = { _ in .ok(["ok": true]) }
        bridge.answers["/attachment"] = { body in .ok(["ok": true, "path": "/tmp/paper.pdf", "target": body["target"] ?? ""]) }
        model = LauncherModel(bridge: bridge, desktop: desktop, env: ["HOME": home.path, "hostname": "mac"])
        model.close = { [unowned self] in self.closed += 1 }
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: home)
    }

    private var firstPaper: Int { model.searchRows.firstIndex { $0.kind == "item" }! }

    // A fresh start at the results (a query asked for: no resume), then the first paper's menu.
    private func openMenu() {
        model.willShow(query: "")
        model.enterActions(firstPaper)
    }

    private func key(_ k: KeyEvent.Key, _ text: String = "", shift: Bool = false, control: Bool = false) -> KeyEvent {
        KeyEvent(key: k, text: text, shift: shift, control: control)
    }

    private func char(_ c: Character) -> KeyEvent { KeyEvent(key: .character(Character(c.lowercased())), text: String(c)) }

    // ---- the search

    func testOpeningSearchesAndShowsTheResults() throws {
        model.willShow()
        let body = try XCTUnwrap(bridge.bodies("/search").first)
        XCTAssertEqual(body["query"] as? String, "")
        XCTAssertEqual(body["limit"] as? Int, 60)
        XCTAssertEqual(body["statusPrefix"] as? String, "s/")
        XCTAssertFalse(model.searchRows.isEmpty)
        XCTAssertEqual(model.store.selectedIndex, 0) // the first row, whatever it is (Views.selectionAfter)
        XCTAssertFalse(model.store.searchFocus) // single keys: the list has them
    }

    func testOneSearchInFlightTheNewestWins() {
        model.willShow()
        bridge.hold = ["/search"]
        model.setFilter("a")
        model.setFilter("ab")
        model.setFilter("abc")
        XCTAssertEqual(bridge.bodies("/search").map { $0["query"] as? String }, ["", "a"])
        bridge.release(.ok(Fixture.bridge("search-empty"))) // "a"'s answer: already old
        XCTAssertEqual(bridge.bodies("/search").last?["query"] as? String, "abc")
        let typed = Fixture.bridge("search-typed")
        bridge.release(.ok(typed))
        XCTAssertFalse(model.loading)
        XCTAssertEqual(bridge.bodies("/search").count, 3)
        XCTAssertEqual(model.response?["query"] as? String, typed["query"] as? String) // the newest answer's rows, not the old one's
    }

    func testPinsGoWithTheEmptySearch() throws {
        try write(#"{"pins": [{"key": "ABCD1234", "libraryID": 1, "type": "item"}]}"#, to: ".config/omarchy/oma-zotero-launcher/pins.json")
        model.willShow()
        let pinned = try XCTUnwrap(bridge.bodies("/search").first?["pinned"] as? [[String: Any]])
        XCTAssertEqual(pinned.first?["key"] as? String, "ABCD1234")
    }

    func testZoteroDownIsSaidAndEnterStartsIt() {
        bridge.answers["/search"] = { _ in .zoteroDown }
        model.willShow()
        XCTAssertEqual(model.lastError, BridgeResult.zoteroDown.message)
        XCTAssertEqual(model.emptyState.title, "Zotero isn't running")
        model.execute(.activate)
        XCTAssertEqual(desktop.launched, 1)
        XCTAssertEqual(closed, 1)
    }

    // ---- a paper's menu

    func testEnterOpensThePapersMenuWithItsDetailsAndCitations() throws {
        openMenu()
        XCTAssertEqual(model.store.view, "actions")
        let item = try XCTUnwrap(bridge.bodies("/item").first)
        XCTAssertEqual(item["key"] as? String, model.actionItem?.key)
        XCTAssertEqual(bridge.bodies("/cite").count, 2)
        let ids = model.listRows.map(\.rowId)
        for id in ["open", "reveal", "pin", "cite-copy"] { XCTAssertTrue(ids.contains(id), id) }
        XCTAssertTrue(model.listRows.contains { $0.rowId == "cite-copy" && $0.detail.contains("Teece") })
        XCTAssertEqual(model.context?.text, model.paperLabel)
        XCTAssertTrue(model.placeholder().hasPrefix("‹ "))
    }

    func testAFailedItemSaysWhy() {
        bridge.answers["/item"] = { _ in .timeout }
        openMenu()
        XCTAssertEqual(model.lastError, "Zotero didn't answer in time")
        XCTAssertEqual(model.store.view, "actions")
    }

    func testAnAnswerForAPaperYouLeftIsIgnored() {
        bridge.hold = ["/item"]
        openMenu()
        model.back()
        bridge.release(.ok(Fixture.bridge("item")))
        XCTAssertEqual(model.store.view, "search")
        XCTAssertNil(model.details)
    }

    func testOpenAndRevealCloseThenAct() throws {
        openMenu()
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "open" })
        model.execute(.activate)
        XCTAssertEqual(closed, 1)
        XCTAssertEqual(bridge.routes().last, "/open")
        XCTAssertEqual(desktop.activated, 1)
        openMenu()
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "reveal" })
        model.execute(.activate)
        XCTAssertEqual(bridge.routes().last, "/reveal")
    }

    // The item with `n` copies of its first file.
    private func itemWithFiles(_ n: Int) -> [String: Any] {
        var item = Fixture.bridge("item")
        var file = ((item["attachments"] as? [[String: Any]]) ?? []).first ?? [:]
        file["exists"] = true
        file["contentType"] = "application/pdf"
        file["readerType"] = "pdf"
        item["attachments"] = (0..<n).map { i -> [String: Any] in
            var f = file
            f["key"] = "ATT0000\(i)"
            return f
        }
        return item
    }

    func testExternalWithOneFileOpensItInItsApp() throws {
        let one = itemWithFiles(1)
        bridge.answers["/item"] = { _ in .ok(one) }
        openMenu()
        let row = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "external" })
        XCTAssertFalse(model.listRows[row].submenu)
        model.store.selectedIndex = row
        model.execute(.activate)
        XCTAssertEqual(bridge.bodies("/attachment").last?["target"] as? String, "path")
        XCTAssertEqual(bridge.bodies("/attachment").last?["key"] as? String, "ATT00000")
        XCTAssertEqual(desktop.opened, ["/tmp/paper.pdf"])
    }

    func testWindowWithSeveralFilesPicksOneFirst() throws {
        let two = itemWithFiles(2)
        bridge.answers["/item"] = { _ in .ok(two) }
        openMenu()
        let row = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "window" })
        XCTAssertTrue(model.listRows[row].submenu)
        model.store.selectedIndex = row
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "files")
        XCTAssertEqual(model.listRows.map(\.rowId), ["pick", "pick"])
        model.execute(.move(1))
        model.execute(.activate)
        XCTAssertEqual(bridge.bodies("/attachment").last?["target"] as? String, "window")
        XCTAssertEqual(bridge.bodies("/attachment").last?["key"] as? String, "ATT00001")
        XCTAssertEqual(desktop.activated, 1)
    }

    func testOWithSeveralFilesOpensThePicker() {
        let two = itemWithFiles(2)
        bridge.answers["/item"] = { _ in .ok(two) }
        model.willShow()
        model.store.selectedIndex = firstPaper
        XCTAssertTrue(model.keyAction("o"))
        XCTAssertEqual(model.store.view, "files")
        XCTAssertEqual(model.placeholder(), "‹ Choose a file")
    }

    func testOQuickActsOnTheOneFile() throws {
        let one = itemWithFiles(1)
        bridge.answers["/item"] = { _ in .ok(one) }
        model.willShow()
        model.store.selectedIndex = firstPaper
        XCTAssertTrue(model.keyAction("o"))
        XCTAssertEqual(bridge.routes().suffix(1), ["/attachment"])
        XCTAssertEqual(desktop.opened, ["/tmp/paper.pdf"])
    }

    func testPinWritesPinsAndTheRowSaysUnpin() throws {
        openMenu()
        let i = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "pin" })
        XCTAssertEqual(model.listRows[i].label, "Pin to the top")
        model.store.selectedIndex = i
        model.execute(.activate)
        let pins = try String(contentsOf: home.appendingPathComponent(".config/omarchy/oma-zotero-launcher/pins.json"), encoding: .utf8)
        XCTAssertTrue(pins.contains(model.actionItem!.key))
        XCTAssertEqual(model.listRows.first { $0.rowId == "pin" }?.label, "Unpin")
        XCTAssertEqual(model.flash, "Pinned to the top")
    }

    func testCiteCopyPutsTheTextOnTheClipboard() throws {
        openMenu()
        let i = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "cite-copy" })
        model.store.selectedIndex = i
        model.execute(.activate)
        XCTAssertEqual(desktop.copied.count, 1)
        XCTAssertTrue(model.flash.hasPrefix("Copied: "))
        XCTAssertEqual(bridge.bodies("/cite").count, 2) // from the preview, not asked again
    }

    func testTheQuestionRunsOrCancelsAfterGoingBack() throws {
        openMenu()
        var ran = 0, cancelled = 0
        model.askConfirm(ConfirmAsk(title: "Delete it?", yes: "Delete", no: "Keep", run: { ran += 1 }, cancel: { cancelled += 1 }))
        XCTAssertEqual(model.listRows.map(\.rowId), ["confirm-yes", "confirm-no"])
        XCTAssertEqual(model.placeholder(), "‹ Delete it?")
        model.execute(.activate)
        XCTAssertEqual(ran, 1)
        XCTAssertEqual(model.store.view, "actions")
        model.askConfirm(ConfirmAsk(title: "Sure?", yes: "Yes", no: "No", run: { ran += 1 }, cancel: { cancelled += 1 }))
        model.execute(.move(1))
        model.execute(.activate)
        XCTAssertEqual(cancelled, 1)
        XCTAssertEqual(ran, 1)
    }

    // ---- arrangement

    func testPPinsTheRowInThisMenuAndPPutsItInOther() throws {
        openMenu()
        let reveal = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "reveal" })
        model.store.selectedIndex = reveal
        XCTAssertTrue(model.keyAction("p"))
        XCTAssertEqual(model.listRows.first?.section, "Pinned")
        XCTAssertEqual(model.listRows.first?.rowId, "reveal")
        XCTAssertEqual(model.selectedListRow?.section, "Pinned")
        XCTAssertTrue(model.keyAction("P"))
        XCTAssertEqual(model.listRows.last?.rowId, "reveal")
        XCTAssertEqual(model.listRows.last?.section, "Other")
        let prefs = ViewPrefs.load(home.appendingPathComponent(".config/omarchy/oma-zotero-launcher/view.json"), readOnly: false)
        XCTAssertEqual(prefs.menuOther("actions"), ["reveal"])
        XCTAssertEqual(prefs.menuPins("actions"), []) // it left the pins
    }

    func testShiftArrowMovesARowWithinItsSection() throws {
        openMenu()
        let rows = model.listRows
        let i = try XCTUnwrap(rows.indices.first { rows.indices.contains($0 + 1) && rows[$0].section == rows[$0 + 1].section && rows[$0].section != "Notes" })
        let moving = rows[i].identity
        model.store.selectedIndex = i
        model.execute(.moveRow(1))
        XCTAssertEqual(model.listRows[i + 1].identity, moving)
        XCTAssertEqual(model.store.selectedIndex, i + 1)
        model.store.selectedIndex = model.listRows.count - 1
        model.execute(.moveRow(1))
        XCTAssertTrue(model.flash.contains("bottom"))
    }

    func testCtrlShiftArrowMovesTheSection() throws {
        openMenu()
        let before = model.listRows.map(\.section).reduce(into: [String]()) { if $0.last != $1 { $0.append($1) } }
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex { $0.section == before[1] })
        model.execute(.moveSection(-1))
        let after = model.listRows.map(\.section).reduce(into: [String]()) { if $0.last != $1 { $0.append($1) } }
        XCTAssertEqual(after.first, before[1])
        XCTAssertEqual(model.selectedListRow?.section, before[1])
    }

    // ---- keys

    func testTheEscLadder() {
        openMenu()
        XCTAssertTrue(model.handle(key(.escape)))
        XCTAssertEqual(model.store.view, "search")
        XCTAssertTrue(model.handle(key(.escape)))
        XCTAssertEqual(closed, 1)
    }

    func testEnterInTheResultsOpensTheMenuAndBackspaceComesBack() {
        model.willShow()
        model.store.selectedIndex = firstPaper
        XCTAssertTrue(model.handle(key(.enter)))
        XCTAssertEqual(model.store.view, "actions")
        XCTAssertTrue(model.handle(key(.backspace)))
        XCTAssertEqual(model.store.view, "search")
    }

    func testTwoQuickKeysAreTypingOneWaitsThenActs() {
        model.willShow()
        let t0 = Date()
        XCTAssertTrue(model.handle(char("t"), at: t0))
        XCTAssertTrue(model.handle(char("e"), at: t0.addingTimeInterval(0.05)))
        XCTAssertEqual(model.store.filterText, "te")
        XCTAssertTrue(model.store.searchFocus)
        XCTAssertTrue(model.handle(key(.escape)))
        XCTAssertFalse(model.store.searchFocus) // leave the box
        let i = model.store.selectedIndex
        XCTAssertTrue(model.handle(char("j"), at: t0.addingTimeInterval(1)))
        XCTAssertEqual(model.store.selectedIndex, i) // waiting
        for command in model.store.keys.tick(at: t0.addingTimeInterval(2)) { model.execute(command) }
        XCTAssertEqual(model.store.selectedIndex, (i + 1) % model.searchRows.count)
    }

    func testTheSearchBoxKeepsItsOwnEditingKeys() {
        model.willShow()
        model.store.searchFocus = true
        model.store.filterText = "teece"
        XCTAssertFalse(model.handle(key(.left))) // the caret: the box's
        XCTAssertFalse(model.handle(KeyEvent(key: .character("a"), text: "a")))
        XCTAssertFalse(model.handle(KeyEvent(key: .right, text: "", command: true)))
        XCTAssertTrue(model.handle(key(.down)))
    }

    func testWTogglesTheWindow() {
        model.willShow()
        XCTAssertTrue(model.keyAction("W"))
        XCTAssertTrue(model.windowed)
        XCTAssertTrue(model.keyAction("W"))
        XCTAssertFalse(model.windowed)
    }

    func testAKeyForALaterViewSaysSoAndTypesNothing() {
        model.willShow()
        XCTAssertTrue(model.keyAction("t"))
        XCTAssertTrue(model.flash.hasPrefix("Not on the Mac yet"))
        XCTAssertEqual(model.store.filterText, "")
    }

    // ---- chrome

    func testHintsPerViewAndFitting() {
        model.willShow()
        XCTAssertEqual(model.hints().first, "/ search")
        XCTAssertTrue(model.hints().contains("esc close"))
        openMenu()
        XCTAssertTrue(model.hints().contains("⌫ esc back"))
        model.store.selectedIndex = model.listRows.firstIndex { $0.rowId == "open" }!
        XCTAssertTrue(model.hints().contains("↵ run"))
        XCTAssertTrue(model.hints().contains("p pin"))
        let fitted = FitHints.fit(model.hints(), width: 200, gap: 10) { CGFloat($0.count * 6) }
        XCTAssertTrue(fitted.contains("⌫ esc back"))
        XCTAssertLessThan(fitted.count, model.hints().count)
        XCTAssertEqual(FitHints.parts("⇧↵ z zotero").keys, "⇧↵ z")
        XCTAssertEqual(FitHints.parts("⇧↵ z zotero").desc, "zotero")
        XCTAssertEqual(FitHints.parts("esc one-key actions").keys, "esc")
    }

    func testResumeKeepsTheMenuItsRowAndAsksItsDetailsAgain() {
        openMenu()
        model.execute(.move(1))
        model.execute(.move(1))
        let row = model.selectedListRow
        let asked = bridge.bodies("/item").count
        model.didHide()
        model.willShow()
        XCTAssertEqual(model.store.view, "actions")
        XCTAssertEqual(bridge.bodies("/item").count, asked + 1)
        XCTAssertEqual(model.selectedListRow, row)
    }

    // ---- review fixes

    func testOptionTypesWhileTheSearchBoxHasTheSingleKeys() {
        model.willShow()
        model.store.searchFocus = true
        XCTAssertFalse(model.handle(KeyEvent(key: .character("u"), text: "", option: true))) // ⌥u u is ü
        XCTAssertFalse(model.handle(KeyEvent(key: .character("2"), text: "", option: true)))
        XCTAssertFalse(model.handle(KeyEvent(key: .backspace, text: "", option: true)))
        XCTAssertTrue(model.handle(KeyEvent(key: .escape, text: "", option: true)))
    }

    func testAnOptionLetterThatDoesNothingGoesOn() throws {
        try write(#"{"general": {"keys": "alt"}}"#, to: ".config/omarchy/oma-zotero-launcher.json")
        model.willShow()
        XCTAssertFalse(model.singleKeys)
        XCTAssertFalse(model.handle(KeyEvent(key: .character("q"), text: "", option: true)))
        XCTAssertTrue(model.handle(KeyEvent(key: .character("j"), text: "", option: true)))
    }

    func testAWaitingKeyDoesntDecideTheNextOne() {
        model.willShow()
        let t0 = Date()
        XCTAssertTrue(model.handle(char("j"), at: t0))
        let i = model.store.selectedIndex
        XCTAssertFalse(model.handle(KeyEvent(key: .character("a"), text: "", command: true), at: t0.addingTimeInterval(0.1)))
        XCTAssertEqual(model.store.selectedIndex, (i + 1) % model.searchRows.count) // j acted first
    }

    func testNothingActsOnceTheLauncherIsHidden() {
        bridge.hold = ["/item"]
        openMenu()
        model.didHide()
        bridge.release(.ok(Fixture.bridge("item")))
        XCTAssertNil(model.details)
        model.willShow(query: "")
        _ = model.handle(char("l"), at: Date())
        XCTAssertTrue(model.store.keys.pending)
        model.didHide()
        XCTAssertFalse(model.store.keys.pending)
    }

    func testADamagedPinsFileIsNotOverwritten() throws {
        try write(#"{"pins": [{"key": "ABCD1234", "libraryID": 1, "ty"#, to: ".config/omarchy/oma-zotero-launcher/pins.json")
        openMenu()
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "pin" })
        model.execute(.activate)
        let text = try String(contentsOf: home.appendingPathComponent(".config/omarchy/oma-zotero-launcher/pins.json"), encoding: .utf8)
        XCTAssertTrue(text.hasSuffix(#""ty"#)) // as it was
        XCTAssertTrue(model.lastError.hasPrefix("pins.json isn't valid"))
    }

    func testADamagedViewFileIsNotOverwritten() throws {
        try write("{ nope", to: ".config/omarchy/oma-zotero-launcher/view.json")
        openMenu()
        XCTAssertTrue(model.keyAction("p"))
        XCTAssertTrue(model.lastError.hasPrefix("view.json isn't valid"))
    }

    func testEAndGTypeOutsideTheirViewsPInTheFilesPinsThePaper() {
        model.willShow()
        XCTAssertFalse(model.keyAction("e"))
        openMenu()
        XCTAssertFalse(model.keyAction("g")) // grouping is the results'
        model.openFiles("external")
        XCTAssertTrue(model.keyAction("p"))
        XCTAssertEqual(model.flash, "Pinned to the top")
    }

    func testAnUnavailableRowDoesNothing() throws {
        bridge.answers["/item"] = { _ in .timeout }
        openMenu()
        let routes = bridge.routes().count
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex { !$0.available })
        model.execute(.activate)
        XCTAssertEqual(bridge.routes().count, routes)
        XCTAssertEqual(closed, 0)
    }

    func testAMenuAnswerForAnotherPaperIsIgnored() throws {
        bridge.hold = ["/item"]
        model.willShow(query: "")
        let papers = model.searchRows.indices.filter { model.searchRows[$0].kind == "item" }
        model.enterActions(papers[0])
        model.back()
        model.enterActions(papers[1])
        bridge.release(.ok(Fixture.bridge("item"))) // the first paper's
        XCTAssertNil(model.details)
        bridge.release(.ok(Fixture.bridge("item")))
        XCTAssertNotNil(model.details)
    }

    func testPinnedResultsMoveWithShiftArrows() throws {
        try write(#"{"pins": [{"key": "ABCD1234", "libraryID": 1, "type": "item"}, {"key": "WXYZ9876", "libraryID": 1, "type": "item"}]}"#, to: ".config/omarchy/oma-zotero-launcher/pins.json")
        var typed = Fixture.bridge("search-empty")
        typed["pinned"] = [["key": "ABCD1234", "libraryID": 1, "itemType": "book", "title": "a"], ["key": "WXYZ9876", "libraryID": 1, "itemType": "book", "title": "b"]]
        bridge.answers["/search"] = { _ in .ok(typed) }
        model.willShow()
        let first = try XCTUnwrap(model.searchRows.firstIndex { $0.section == "Pinned" })
        model.store.selectedIndex = first
        model.execute(.moveRow(1))
        let pins = PinsFile.load(home.appendingPathComponent(".config/omarchy/oma-zotero-launcher/pins.json"), readOnly: false, core: try JSCore())
        XCTAssertEqual(pins.pins.map(\.key), ["WXYZ9876", "ABCD1234"])
        XCTAssertEqual(model.selectedSearchRow?.key, "ABCD1234") // the moved paper keeps the cursor
    }

    private func write(_ text: String, to path: String) throws {
        let url = home.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: url)
    }
}
