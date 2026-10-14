import XCTest
@testable import ZoteroLauncher

// The view stack as ZoteroSearch.qml keeps it (pushView, back, goHome, open, resume), and
// view.json as Service.qml reads and writes it.
@MainActor
final class AppStoreTests: XCTestCase {
    private let paper = Scope(type: "collection", key: "ABCD1234", libraryID: 1, title: "Reading")

    func testPushSavesTheLevelAndStartsTheNextView() {
        let store = AppStore()
        store.filterText = "teece"
        store.caretBack = 2
        store.selectedIndex = 4
        store.followTop = false
        store.searchFocus = false
        store.push("actions")
        XCTAssertEqual(store.stack, [ViewLevel(view: "search", filterText: "teece", caretBack: 2, selectedIndex: 4, followTop: false, scope: nil, pickFor: "", searchFocus: false)])
        XCTAssertEqual(store.view, "actions")
        XCTAssertEqual(store.filterText, "")
        XCTAssertEqual(store.caretBack, 0)
        XCTAssertEqual(store.selectedIndex, 0)
        XCTAssertTrue(store.followTop)
        XCTAssertFalse(store.searchFocus) // the list has the keys
    }

    func testPushToAPageForTypingGivesTheSearchBoxTheKeys() {
        let store = AppStore()
        store.push("todo-new")
        XCTAssertTrue(store.searchFocus)
        let first = AppStore(searchFirst: true)
        first.push("actions")
        XCTAssertTrue(first.searchFocus)
    }

    func testBackRestoresTheSavedLevel() {
        let store = AppStore()
        store.scope = paper
        store.filterText = "dyn"
        store.caretBack = 1
        store.selectedIndex = 3
        store.followTop = false
        store.searchFocus = true
        store.push("actions")
        store.filterText = "op"
        XCTAssertTrue(store.back())
        XCTAssertEqual(store.view, "search")
        XCTAssertEqual(store.filterText, "dyn")
        XCTAssertEqual(store.caretBack, 1)
        XCTAssertEqual(store.selectedIndex, 3)
        XCTAssertFalse(store.followTop)
        XCTAssertEqual(store.scope, paper)
        XCTAssertTrue(store.searchFocus) // something typed: the keys where they were
        XCTAssertTrue(store.stack.isEmpty)
    }

    func testBackWithNothingTypedGivesTheListTheKeys() {
        let store = AppStore()
        store.searchFocus = true
        store.push("actions")
        XCTAssertTrue(store.back())
        XCTAssertFalse(store.searchFocus)
        let first = AppStore(searchFirst: true)
        first.push("actions")
        first.push("files")
        XCTAssertTrue(first.back())
        XCTAssertTrue(first.searchFocus) // not at the root: where the keys were
        XCTAssertTrue(first.back())
        XCTAssertFalse(first.searchFocus) // back in the results with nothing typed
    }

    func testBackAtTheRootIsFalseAndChangesNothing() {
        let store = AppStore()
        store.filterText = "x"
        XCTAssertFalse(store.back())
        XCTAssertEqual(store.view, "search")
        XCTAssertEqual(store.filterText, "x")
    }

    func testBackTwiceInARowLeavesTwoLevels() {
        let store = AppStore()
        store.push("actions")
        store.push("files")
        store.push("picker")
        XCTAssertTrue(store.back())
        XCTAssertTrue(store.back())
        XCTAssertEqual(store.view, "actions")
        XCTAssertEqual(store.stack.map(\.view), ["search"])
    }

    func testGoHomeBacksOutToTheRoot() {
        let store = AppStore()
        store.filterText = "kept"
        store.push("actions")
        store.push("files")
        store.goHome()
        XCTAssertTrue(store.atRoot)
        XCTAssertEqual(store.filterText, "kept")
        XCTAssertTrue(store.stack.isEmpty)
    }

    func testGoHomeLeavesACollectionsResultsToo() {
        let store = AppStore()
        store.push("search")
        store.scope = paper
        store.push("actions")
        store.goHome()
        XCTAssertEqual(store.view, "search")
        XCTAssertEqual(store.scope, nil)
    }

    func testReopeningResumesWhereYouLeftIt() {
        let store = AppStore()
        store.open()
        store.filterText = "dyn"
        store.push("actions")
        store.selectedIndex = 5
        store.followTop = true
        store.open()
        XCTAssertEqual(store.view, "actions")
        XCTAssertEqual(store.stack.map(\.filterText), ["dyn"])
        XCTAssertEqual(store.selectedIndex, 5)
        XCTAssertFalse(store.followTop) // the row you were on stays selected as the list refreshes
    }

    func testOpeningWithAQueryStartsOverAtTheResults() {
        let store = AppStore()
        store.open()
        store.push("actions")
        store.open(query: "teece")
        XCTAssertEqual(store.view, "search")
        XCTAssertTrue(store.stack.isEmpty)
        XCTAssertEqual(store.filterText, "teece")
        XCTAssertTrue(store.searchFocus)
        XCTAssertTrue(store.followTop)
    }

    func testTheFirstOpenStartsAtTheResultsWithTheListHavingTheKeys() {
        let store = AppStore()
        store.view = "actions"
        store.open()
        XCTAssertEqual(store.view, "search")
        XCTAssertFalse(store.searchFocus)
    }

    func testTextEntryAndTypingViews() {
        let store = AppStore()
        store.view = "todo-new"
        XCTAssertTrue(store.textEntry)
        XCTAssertTrue(store.typingView)
        store.view = "picker"
        XCTAssertFalse(store.textEntry)
        XCTAssertTrue(store.typingView)
        store.view = "actions"
        XCTAssertFalse(store.typingView)
    }

    // ---- view.json

    private func temp() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        return dir.appendingPathComponent("sub/view.json")
    }

    func testViewPrefsReadAPrefSetAndWrittenWhole() throws {
        let url = try temp()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(#"{"noteFontSize": 14, "grouping": "year", "future": {"a": 1}}"#.utf8).write(to: url)
        var prefs = ViewPrefs.load(url, readOnly: false)
        XCTAssertEqual(prefs.noteFontSize, 14)
        try prefs.set("menuPins", ["actions": ["reveal", "note:ABCD1234"]])
        let back = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        XCTAssertEqual(back["grouping"] as? String, "year")
        XCTAssertEqual((back["future"] as? [String: Int])?["a"], 1) // another version's keys kept
        XCTAssertEqual((back["menuPins"] as? [String: [String]])?["actions"], ["reveal", "note:ABCD1234"])
        XCTAssertEqual(ViewPrefs.load(url, readOnly: false).values.count, 4)
        try prefs.set("grouping", nil)
        XCTAssertNil(ViewPrefs.load(url, readOnly: false).values["grouping"])
    }

    func testViewPrefsMissingOrDamagedReadAsEmptyAndTheFolderIsMade() throws {
        let url = try temp()
        var prefs = ViewPrefs.load(url, readOnly: false)
        XCTAssertTrue(prefs.values.isEmpty)
        XCTAssertEqual(prefs.noteFontSize, 0)
        try prefs.set("noteFontSize", 16)
        XCTAssertEqual(ViewPrefs.load(url, readOnly: false).noteFontSize, 16)
        try Data("[1, 2".utf8).write(to: url)
        XCTAssertTrue(ViewPrefs.load(url, readOnly: false).values.isEmpty)
        try Data("[1, 2]".utf8).write(to: url)
        XCTAssertTrue(ViewPrefs.load(url, readOnly: false).values.isEmpty)
    }

    func testANoteFontSizeOutsideItsRangeIsTheThemes() throws {
        let url = try temp()
        var prefs = ViewPrefs.load(url, readOnly: false)
        try prefs.set("noteFontSize", 90)
        XCTAssertEqual(prefs.noteFontSize, 0)
        try prefs.set("noteFontSize", 12.6)
        XCTAssertEqual(prefs.noteFontSize, 13)
    }

    func testViewPrefsAreRefusedWhileReadOnly() throws {
        let url = try temp()
        var prefs = ViewPrefs.load(url, readOnly: true)
        XCTAssertThrowsError(try prefs.set("grouping", "year")) { error in
            XCTAssertEqual(error as? ViewPrefs.WriteError, .readOnly)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
        XCTAssertNil(prefs.values["grouping"])
    }

    // ---- review fixes

    func testBackRebuildsWithFollowTopOffThenKeepsTheRowWithinTheRows() {
        let store = AppStore()
        store.selectedIndex = 7
        store.followTop = true
        store.push("actions")
        var seen: Bool?
        XCTAssertTrue(store.back { seen = store.followTop; return 3 })
        XCTAssertEqual(seen, false)
        XCTAssertEqual(store.selectedIndex, 2)
        XCTAssertTrue(store.followTop)
        store.push("actions")
        XCTAssertTrue(store.back { 0 })
        XCTAssertEqual(store.selectedIndex, 0)
    }

    func testAViewChangeDropsAWaitingKey() {
        let store = AppStore()
        let t0 = Date(timeIntervalSince1970: 1000)
        _ = store.keys.queue("j", at: t0)
        store.push("actions")
        XCTAssertFalse(store.keys.pending)
        _ = store.keys.queue("j", at: t0)
        store.back()
        XCTAssertFalse(store.keys.pending)
        _ = store.keys.queue("j", at: t0)
        store.open()
        XCTAssertFalse(store.keys.pending)
    }

    func testAWriteStartsFromTheFileAsItIsNow() throws {
        let url = try temp()
        var prefs = ViewPrefs.load(url, readOnly: false)
        try prefs.set("grouping", "year")
        // the other machine's change, through the sync folder
        try Data(#"{"grouping": "year", "noteFontSize": 18}"#.utf8).write(to: url)
        try prefs.set("menuPins", ["actions": ["reveal"]])
        let now = ViewPrefs.load(url, readOnly: false)
        XCTAssertEqual(now.noteFontSize, 18)
        XCTAssertEqual(now.values["grouping"] as? String, "year")
        XCTAssertEqual(prefs.noteFontSize, 18)
    }

    func testAValueJSONCantHoldIsAnErrorNotACrash() throws {
        let url = try temp()
        var prefs = ViewPrefs.load(url, readOnly: false)
        XCTAssertThrowsError(try prefs.set("when", Date())) { error in
            XCTAssertEqual(error as? ViewPrefs.WriteError, .notJSON("when"))
        }
        prefs.readOnly = true
        XCTAssertThrowsError(try prefs.set("grouping", "year"))
    }
}
