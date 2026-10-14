import XCTest

// The real app on screen, with Zotero running (skipped without it): the flows found broken by hand, checked through
// the accessibility tree (each row one element, "Selected" on the highlighted one). Nothing here writes to Zotero.
final class FlowTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-ZLOpenOnLaunch", "YES"]
        app.launch()
        let panel = app.dialogs.firstMatch
        XCTAssertTrue(panel.waitForExistence(timeout: 10), "the launcher didn't open")
        // the results' rows: papers (the badges are buttons too, above them)
        guard rows().count > 2 else { throw XCTSkip("no results: is Zotero running?") }
    }

    override func tearDownWithError() throws { app.terminate() }

    // The list's rows, top to bottom (the ones drawn: a lazy list).
    private struct Row: Hashable { let label: String; let selected: Bool; let value: String }

    // (a row is 45 points tall; the badges above the results are buttons too, 19 tall; one snapshot for all)
    private func rows() -> [Row] {
        let snapshot = try? app.dialogs.firstMatch.snapshot()
        var out: [Row] = []
        func walk(_ e: XCUIElementSnapshot) {
            if e.elementType == .button && e.frame.height >= 30 && e.frame.width > 300 { out.append(Row(label: e.label, selected: e.isSelected, value: e.value as? String ?? "")) }
            e.children.forEach(walk)
        }
        if let snapshot { walk(snapshot) }
        return out
    }

    private func selectedLabel() -> String? { rows().first { $0.selected }?.label }

    private func press(_ key: XCUIKeyboardKey, _ flags: XCUIElement.KeyModifierFlags = [], wait: Double = 0.5) {
        app.typeKey(key, modifierFlags: flags)
        RunLoop.current.run(until: Date().addingTimeInterval(wait))
    }

    func testArrowsMoveTheHighlightInTheResults() {
        let first = selectedLabel()
        press(.downArrow)
        XCTAssertNotEqual(selectedLabel(), first)
        press(.upArrow)
        XCTAssertEqual(selectedLabel(), first)
    }

    // The bug: a paper's menu drew the results' rows under its own headings, and the arrows moved nothing.
    func testAPapersMenuDrawsItsOwnRowsAndTheArrowsMoveInIt() {
        let results = Set(rows().map { $0.label })
        press(.return, wait: 2)
        let menu = rows().map { $0.label }
        XCTAssertFalse(menu.isEmpty)
        XCTAssertTrue(Set(menu).isDisjoint(with: results), "the menu shows the results' rows")
        let before = selectedLabel()
        press(.downArrow)
        press(.downArrow)
        XCTAssertNotEqual(selectedLabel(), before, "↓ didn't move in the menu")
        press(.escape, wait: 1)
        XCTAssertFalse(Set(rows().map { $0.label }).isDisjoint(with: results), "esc didn't bring the results back")
    }

    // A paper says it opens a list (its ›); in its menu the path above the box starts at the results.
    func testResultsHaveArrowsAndAMenuHasAPath() {
        XCTAssertTrue(rows().contains { $0.value.contains("opens a list") }, "no result says it opens a list")
        let path = app.dialogs.firstMatch.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Path: '")).firstMatch
        XCTAssertFalse(path.exists, "a path at the top level")
        press(.return, wait: 2)
        XCTAssertTrue(path.waitForExistence(timeout: 2), "no path in a paper's menu")
        XCTAssertTrue(path.label.hasPrefix("Path: Results, "), path.label)
        press(.escape, wait: 1)
        XCTAssertFalse(path.exists)
    }

    func testTheKeysViewDrawsItsRows() {
        let results = Set(rows().map { $0.label })
        app.typeText("?")
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        let keys = rows().map { $0.label }
        XCTAssertTrue(Set(keys).isDisjoint(with: results), "the keys view shows the results' rows")
        let before = selectedLabel()
        press(.downArrow)
        XCTAssertNotEqual(selectedLabel(), before)
        press(.end)
        XCTAssertNotEqual(selectedLabel(), before, "End didn't move")
    }

    // The menu bar menu's places open in the launcher, each in its own view (the path above the box says which).
    func testTheMenuBarPlacesOpenTheirViews() {
        let item = app.statusItems.firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5), "no menu bar item")
        for (title, placeholder) in [("Processes…", "Processes"), ("Settings…", "Settings"), ("Chats…", "Chats")] {
            item.click()
            let menuItem = item.menuItems[title]
            XCTAssertTrue(menuItem.waitForExistence(timeout: 3), "no \(title) in the menu")
            menuItem.click()
            RunLoop.current.run(until: Date().addingTimeInterval(1))
            let field = app.dialogs.firstMatch.textFields.firstMatch
            let path = app.dialogs.firstMatch.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Path: '")).firstMatch
            let shown = (field.placeholderValue ?? "") + " " + (path.exists ? path.label : "")
            XCTAssertTrue(shown.contains(placeholder), "\(title) opened: \(shown)")
        }
    }
}
