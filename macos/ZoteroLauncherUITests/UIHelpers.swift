import XCTest

// The launcher's UI tests: the real app opened on launch, on the fixtures (fixture mode: no Zotero, no runner, a
// home of its own) or, with ZL_UI_REAL=1, on your Zotero (skipped when it isn't running); what's on screen read
// from the accessibility tree.
class LauncherUITestCase: XCTestCase {
    var app: XCUIApplication!
    var real: Bool { ProcessInfo.processInfo.environment["ZL_UI_REAL"] == "1" }

    // what a launch adds (a test's own fixture switches)
    var launchEnvironment: [String: String] { [:] }

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-ZLOpenOnLaunch", "YES"]
        if !real { app.launchEnvironment["ZL_FIXTURES"] = Self.fixtures }
        launchEnvironment.forEach { app.launchEnvironment[$0.key] = $0.value }
        app.launch()
        XCTAssertTrue(app.dialogs.firstMatch.waitForExistence(timeout: 20), "the launcher didn't open") // (a first start after a build is slow)
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        // the results' rows: papers (the badges are buttons too, above them)
        if real && rows().count <= 2 { throw XCTSkip("no results: is Zotero running?") }
    }

    override func tearDownWithError() throws { app.terminate() }

    // ZoteroLauncherTests/Fixtures, beside this file's folder
    static var fixtures: String {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("ZoteroLauncherTests/Fixtures").path
    }

    // The list's rows, top to bottom (the ones drawn: a lazy list).
    struct Row: Hashable { let label: String; let selected: Bool; let value: String }

    // (a row is 45 points tall; the badges above the results are buttons too, 19 tall; one snapshot for all)
    func rows() -> [Row] {
        let snapshot = try? app.dialogs.firstMatch.snapshot()
        var out: [Row] = []
        func walk(_ e: XCUIElementSnapshot) {
            if e.elementType == .button && e.frame.height >= 30 && e.frame.width > 300 { out.append(Row(label: e.label, selected: e.isSelected, value: e.value as? String ?? "")) }
            e.children.forEach(walk)
        }
        if let snapshot { walk(snapshot) }
        return out
    }

    func selectedLabel() -> String? { rows().first { $0.selected }?.label }

    // the breadcrumb ("Path: Results, …"), "" at the top level
    func path() -> String {
        let p = app.dialogs.firstMatch.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Path: '")).firstMatch
        return p.exists ? p.label : ""
    }

    func press(_ key: XCUIKeyboardKey, _ flags: XCUIElement.KeyModifierFlags = [], wait: Double = 0.5) {
        app.typeKey(key, modifierFlags: flags)
        RunLoop.current.run(until: Date().addingTimeInterval(wait))
    }

    func type(_ text: String, wait: Double = 1) {
        app.typeText(text)
        RunLoop.current.run(until: Date().addingTimeInterval(wait))
    }

    // ↓ until the highlighted row is the one wanted (at most 40 rows)
    func select(_ wanted: (Row) -> Bool, file: StaticString = #filePath, line: UInt = #line) {
        for _ in 0..<40 {
            if let row = rows().first(where: { $0.selected }), wanted(row) { return }
            press(.downArrow, wait: 0.15)
        }
        XCTFail("no such row: \(rows().map(\.label))", file: file, line: line)
    }

    // what's typed in the search box (clicked first: in one-key mode the list may have the keys)
    func search(_ text: String) {
        app.dialogs.firstMatch.textFields.firstMatch.click()
        type(text)
    }

    // a place from the menu bar menu (Chats…, Processes…, Settings…)
    func menuBar(_ title: String) {
        let item = app.statusItems.firstMatch
        item.click()
        item.menuItems[title].click()
        RunLoop.current.run(until: Date().addingTimeInterval(1))
    }

    // the results for a word, then the first paper's menu
    func openFirstPapersMenu() {
        search("work")
        // (a paper: not a collection's or a tag's row, whose second line says "Collection ·" / "Tag ·")
        select { $0.value.contains("opens a list") && !$0.label.contains(", Collection") && !$0.label.contains(", Tag") }
        press(.return, wait: 1.5)
    }
}
