import XCTest

// The launcher's UI tests: the real app opened on launch, on the fixtures (fixture mode: no Zotero, no runner, a
// home of its own) or, with ZL_UI_REAL=1, on your Zotero (skipped when it isn't running); what's on screen read
// from the accessibility tree.
class LauncherUITestCase: XCTestCase {
    var app: XCUIApplication!
    var real: Bool { ProcessInfo.processInfo.environment["ZL_UI_REAL"] == "1" }

    // what a launch adds (a test's own fixture switches)
    var launchEnvironment: [String: String] { [:] }

    // the fixture runner's calls, one a line (the runner is sandboxed: its own temporary folder, which the app can write)
    var callsPath = ""

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-ZLOpenOnLaunch", "YES"]
        if !real {
            app.launchEnvironment["ZL_FIXTURES"] = Self.fixtures
            callsPath = NSTemporaryDirectory() + "zl-fixture-calls-\(UUID().uuidString).log"
            app.launchEnvironment["ZL_FIXTURE_CALLS"] = callsPath
        }
        launchEnvironment.forEach { app.launchEnvironment[$0.key] = $0.value }
        app.launch()
        XCTAssertTrue(app.dialogs.firstMatch.waitForExistence(timeout: 20), "the launcher didn't open") // (a first start after a build is slow)
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        // the results' rows: papers (the badges are buttons too, above them)
        if real && rows().count <= 2 { throw XCTSkip("no results: is Zotero running?") }
    }

    override func tearDownWithError() throws {
        app.terminate()
        if !callsPath.isEmpty { try? FileManager.default.removeItem(atPath: callsPath) }
    }

    // what the fixture runner was asked, "subcommand args…" each
    func calls() -> [String] {
        ((try? String(contentsOfFile: callsPath, encoding: .utf8)) ?? "").split(separator: "\n").map(String.init)
    }

    // the footer's note (a flash, or what the row says)
    func flash() -> String {
        let note = app.dialogs.firstMatch.staticTexts["footer-note"]
        return note.exists ? (note.value as? String).flatMap { $0.isEmpty ? nil : $0 } ?? note.label : ""
    }

    // every text in an element (a window's, a web view's), joined
    func texts(_ e: XCUIElement) -> String {
        guard let snapshot = try? e.snapshot() else { return "" }
        var out: [String] = []
        func walk(_ s: XCUIElementSnapshot) {
            if s.elementType == .staticText || s.elementType == .textView { out.append(s.label); out.append(s.value as? String ?? "") }
            s.children.forEach(walk)
        }
        walk(snapshot)
        return out.filter { !$0.isEmpty }.joined(separator: " ")
    }

    // waits until the condition holds (at most `timeout` seconds)
    @discardableResult
    func eventually(_ timeout: Double = 3, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        return condition()
    }

    // Settings (from the menu bar), then the page whose row starts with `page`
    func settingsPage(_ page: String) {
        menuBar("Settings…")
        select { $0.label.hasPrefix(page) }
        press(.return, wait: 1)
    }

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
        let field = app.dialogs.firstMatch.textFields.firstMatch
        _ = field.waitForExistence(timeout: 5)
        eventually(5) { field.isHittable } // (after an interruption, a notification say, the panel comes back first)
        field.click()
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
