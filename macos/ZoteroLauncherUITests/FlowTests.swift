import XCTest

// The real app on screen, on the fixtures (fixture mode: no Zotero, no runner, a home of its own), or on your Zotero
// with ZL_UI_REAL=1 (skipped when it isn't running): the flows found broken by hand, checked through the
// accessibility tree (each row one element, "Selected" on the highlighted one). Nothing here writes to Zotero.
final class FlowTests: LauncherUITestCase {
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

    // The ‹ beside the box goes back, as esc does: from a paper's menu to the results.
    func testClickingTheBackArrowGoesBack() {
        let back = app.dialogs.firstMatch.buttons["Back"]
        XCTAssertFalse(back.exists, "a back arrow at the top level")
        press(.return, wait: 2)
        XCTAssertTrue(back.waitForExistence(timeout: 2), "no back arrow in a paper's menu")
        back.click()
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        let path = app.dialogs.firstMatch.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Path: '")).firstMatch
        XCTAssertFalse(path.exists, "still below the top level after clicking back")
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
