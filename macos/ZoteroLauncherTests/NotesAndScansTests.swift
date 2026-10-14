import XCTest
@testable import ZoteroLauncher

// Deleting a note (Delete on a note row, while reading it, the menu's Delete this note), and the
// scans left alone read by OCR once Tesseract is there; on the fake bridge and runner.
@MainActor
final class NotesAndScansTests: XCTestCase {
    private var home: URL!
    private var bridge: FakeBridge!
    private var runner: FakeRunner!
    private var model: LauncherModel!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("ns-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed"), item = Fixture.bridge("item")
        let note = LauncherModel4aTests.synthetic("note-html")
        bridge.answers["/search"] = { _ in .ok(typed) }
        bridge.answers["/item"] = { _ in .ok(item) }
        bridge.answers["/note"] = { _ in .ok(note) }
        bridge.answers["/notes/delete"] = { body in .ok(["trashed": true, "key": body["key"] ?? "", "libraryID": 1]) }
        bridge.answers["/sync/status"] = { _ in .ok(["ok": true]) }
        bridge.answers["/extract/pending"] = { _ in .ok(["total": 0, "items": []]) }
        runner = FakeRunner()
        runner.answers["list"] = { _, _ in FakeRunner.json(Fixture.synthetic("prompts")) }
        runner.answers["tasks"] = { _, _ in FakeRunner.json(["tasks": []]) }
        runner.answers["providers"] = { _, _ in FakeRunner.json(Fixture.synthetic("providers")) }
        runner.answers["models"] = { _, _ in FakeRunner.json(Fixture.synthetic("models")) }
        runner.answers["catchup-plan"] = { _, _ in FakeRunner.json([String: Any]()) }
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private func open(extract: [String: Any] = [:]) throws {
        let file = home.appendingPathComponent(".config/omarchy/oma-zotero-launcher.json")
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("{}".utf8).write(to: file)
        if !extract.isEmpty {
            let dir = file.deletingLastPathComponent().appendingPathComponent("oma-zotero-launcher")
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try JSONSerialization.data(withJSONObject: extract).write(to: dir.appendingPathComponent("extract.json"))
        }
        model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: runner, fetcher: FakeFetcher())
        model.willShow(query: "")
    }

    private var extractState: [String: Any] {
        (try? JSONSerialization.jsonObject(with: Data(contentsOf: home.appendingPathComponent(".config/omarchy/oma-zotero-launcher/extract.json")))) as? [String: Any] ?? [:]
    }

    private func openMenu() {
        model.enterActions(model.searchRows.firstIndex { $0.kind == "item" }!)
    }

    func testDeleteOnANoteRowAsksFirstThenTrashesIt() throws {
        try open()
        openMenu()
        let i = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "note" })
        model.store.selectedIndex = i
        let key = model.listRows[i].noteKey
        XCTAssertTrue(model.hints().contains("del delete"))
        XCTAssertTrue(model.handle(KeyEvent(key: .delete, text: "")))
        XCTAssertEqual(model.store.view, "confirm")
        XCTAssertTrue(bridge.bodies("/notes/delete").isEmpty) // asked first
        XCTAssertTrue(model.listRows.first?.label.hasPrefix("Delete it (to Zotero's trash)") == true)
        model.answerConfirm(true)
        XCTAssertEqual(bridge.bodies("/notes/delete").last?["key"] as? String, key)
        XCTAssertEqual(model.flash, "The note is in Zotero's trash")
    }

    func testKeepItLeavesTheNote() throws {
        try open()
        openMenu()
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "note" })
        _ = model.handle(KeyEvent(key: .delete, text: ""))
        model.answerConfirm(false)
        XCTAssertTrue(bridge.bodies("/notes/delete").isEmpty)
    }

    func testDeleteWhileReadingLeavesTheReaderAndAnOlderPluginSaysSo() throws {
        try open()
        openMenu()
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "note" })
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "note")
        _ = model.handle(KeyEvent(key: .delete, text: ""))
        XCTAssertEqual(model.store.view, "confirm")
        model.answerConfirm(true)
        XCTAssertNotEqual(model.store.view, "note") // it left the trashed note
        bridge.answers["/notes/delete"] = { _ in .bridgeMissing }
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "note" })
        _ = model.handle(KeyEvent(key: .delete, text: ""))
        model.answerConfirm(true)
        XCTAssertEqual(model.flash, "Couldn't delete the note: the Zotero plugin is older than the app (update it: Settings › Setup)")
    }

    func testDeleteIgnoredWhileTyping() throws {
        try open()
        openMenu()
        model.setFilter("note")
        if let i = model.listRows.firstIndex(where: { $0.rowId == "note" }) { model.store.selectedIndex = i }
        _ = model.handle(KeyEvent(key: .delete, text: ""))
        XCTAssertNotEqual(model.store.view, "confirm") // Delete edits the box
    }

    func testTheSkippedScansAreReadByOCROnceTesseractIsThere() throws {
        runner.hasTesseract = true
        try open(extract: ["skipped": ["1:SCAN0001": "a scan, with no text layer: OCR it first", "1:SCAN0002": "a scan, with no text layer: reading it needs Tesseract (Settings › Setup)",
                                       "1:BIG00001": "large PDF (61 MB, over 40 MB)"]])
        model.openSettings("defaults")
        let row = try XCTUnwrap(model.listRows.first { $0.rowId == "set-extract-scans" })
        XCTAssertEqual(row.label, "Read the 2 skipped scans by OCR")
        XCTAssertTrue(try XCTUnwrap(model.listRows.first { $0.value == "defaults.extractMaxMB" }).detail.hasSuffix("scans (no text layer) are read by OCR, Tesseract"))
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "set-extract-scans" })
        bridge.hold = ["/extract/pending"] // the catch-up, still going
        model.execute(.activate)
        XCTAssertEqual((extractState["skipped"] as? [String: Any]).map { Array($0.keys) }, ["1:BIG00001"]) // the large PDF stays left alone
        XCTAssertNotNil(extractState["catchup"] as? [String: Any]) // through the catch-up of every paper's text
        XCTAssertTrue(model.flash.hasPrefix("Reading the skipped scans by OCR"))
    }

    func testWithoutTesseractScansSayWhatReadsThem() throws {
        try open(extract: ["skipped": ["1:SCAN0001": "a scan, with no text layer"]])
        model.openSettings("defaults")
        XCTAssertNil(model.listRows.first { $0.rowId == "set-extract-scans" })
        XCTAssertTrue(try XCTUnwrap(model.listRows.first { $0.value == "defaults.extractMaxMB" }).detail.contains("need Tesseract to be read (Settings › Setup)"))
    }
}
