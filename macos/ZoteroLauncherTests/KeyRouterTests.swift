import XCTest
@testable import ZoteroLauncher

// handleKey (reference/ZoteroSearch.qml:4545-4707), rule by rule in its order, the single-key
// buffer (queueKey / flushKeys, 2062-2087) and keyAction's letters, plus the Mac's keys.
final class KeyRouterTests: XCTestCase {
    private func key(_ key: KeyEvent.Key, _ text: String = "", shift: Bool = false, control: Bool = false, option: Bool = false, command: Bool = false) -> KeyEvent {
        KeyEvent(key: key, text: text, shift: shift, control: control, option: option, command: command)
    }
    private func char(_ c: Character, shift: Bool = false, control: Bool = false, option: Bool = false, command: Bool = false) -> KeyEvent {
        let typed = !(control || option || command)
        return key(.character(Character(c.lowercased())), typed ? String(c) : "", shift: shift, control: control, option: option, command: command)
    }
    private func route(_ event: KeyEvent, _ state: KeyState = KeyState()) -> KeyCommand {
        KeyRouter.route(event, state)
    }
    private func state(_ edit: (inout KeyState) -> Void) -> KeyState {
        var s = KeyState()
        edit(&s)
        return s
    }
    private let notRoot = { (s: inout KeyState) in s.view = "actions" }

    // ---- Esc, Shift+Esc, F1, the note reader

    func testShiftEscGoesHomeFromAnywhere() {
        XCTAssertEqual(route(key(.escape, shift: true), state(notRoot)), .home)
        XCTAssertEqual(route(key(.escape, shift: true), state { $0.view = "note" }), .home)
    }

    func testEscInOrder() {
        XCTAssertEqual(route(key(.escape), state { $0.searchFocus = true; $0.filterText = "x" }), .leaveSearch) // single keys: the box first
        XCTAssertEqual(route(key(.escape), state { $0.searchFocus = true; $0.filterText = "x"; $0.singleKeys = false }), .clearFilter)
        XCTAssertEqual(route(key(.escape), state { $0.view = "chat-rename"; $0.searchFocus = true; $0.filterText = "x" }), .clearFilter)
        XCTAssertEqual(route(key(.escape), state(notRoot)), .back)
        XCTAssertEqual(route(key(.escape), state { $0.view = "note"; $0.filterText = "x" }), .back)
        XCTAssertEqual(route(key(.escape)), .close)
    }

    func testF1AndTheNoteReader() {
        XCTAssertEqual(route(key(.f1), state { $0.view = "note" }), .openKeys)
        XCTAssertEqual(route(char("j"), state { $0.view = "note" }), .note(char("j")))
    }

    // ---- Delete, Tab and the arrows with Alt, on what is highlighted

    func testDeleteOnATaskAndOnASuggestion() {
        XCTAssertEqual(route(key(.delete), state { notRoot(&$0); $0.tabTodo = true }), .deleteTask)
        let review = state { notRoot(&$0); $0.view = "settings-tax-review" }
        XCTAssertEqual(route(key(.delete), review), .ignore)
        XCTAssertEqual(route(key(.delete), state { notRoot(&$0); $0.view = "settings-tax-review"; $0.selectedRowId = "tax-suggestion" }), .rejectSuggestion)
    }

    func testTabOnATasksPageChangesItsStatusOrPriority() {
        let page = { (row: String) in self.state { self.notRoot(&$0); $0.view = "todo-edit"; $0.selectedRowId = row; $0.tabTodo = true } }
        XCTAssertEqual(route(key(.tab), page("todo-status")), .cycleTaskStatus(1))
        XCTAssertEqual(route(key(.backtab, shift: true), page("todo-priority")), .cycleTaskPriority(-1))
        XCTAssertEqual(route(key(.tab), page("todo-text")), .ignore) // before the task's own Tab
    }

    func testTabOnATaxonomysPage() {
        XCTAssertEqual(route(key(.tab), state { notRoot(&$0); $0.view = "settings-taxonomy"; $0.selectedRowId = "tax-kind" }), .activate)
        XCTAssertEqual(route(key(.tab), state { notRoot(&$0); $0.view = "settings-taxonomy" }), .ignore)
    }

    func testTheDueDatesCalendar() {
        let cal = state { $0.view = "todo-due"; $0.searchFocus = true }
        XCTAssertEqual(route(key(.left), cal), .calendarDays(-1))
        XCTAssertEqual(route(key(.down), cal), .calendarDays(7))
        XCTAssertEqual(route(key(.pageUp), cal), .calendarMonths(-1))
        XCTAssertEqual(route(key(.home), cal), .calendarToday)
        XCTAssertEqual(route(key(.delete), cal), .clearDue)
        XCTAssertEqual(route(key(.enter), cal), .pickDue)
        XCTAssertEqual(route(char("t"), cal), .append("t")) // not the calendar's: typed
    }

    func testTabOnATaskAndOnPinnedSearches() {
        XCTAssertEqual(route(key(.tab), state { notRoot(&$0); $0.view = "todos"; $0.tabTodo = true }), .cycleTask(1))
        XCTAssertEqual(route(key(.tab, shift: true), state { notRoot(&$0); $0.view = "todos"; $0.tabTodo = true }), .cycleTask(-1))
        XCTAssertEqual(route(key(.backtab, shift: true), state { $0.pinnedSearches = true }), .cycleSearch(-1))
    }

    func testOptionArrowsOnAPaper() {
        XCTAssertEqual(route(key(.right, shift: true, option: true), state { $0.taskTarget = true; $0.statusTarget = true }), .cycleDefaultTask(1))
        XCTAssertEqual(route(key(.left, option: true), state { $0.statusTarget = true }), .cycleStatus(-1))
        XCTAssertEqual(route(key(.right, option: true), state { $0.rowCount = 3 }), .enterActions) // no paper there: → as usual
    }

    // ---- the same keys in every view

    func testShiftEnterIsTheRowsOtherAction() {
        XCTAssertEqual(route(key(.enter, shift: true)), .alternate)
        XCTAssertEqual(route(key(.enter, shift: true), state(notRoot)), .alternate)
    }

    func testOptionBackspaceDigitsAndLetters() {
        XCTAssertEqual(route(key(.backspace, option: true), state { $0.filterText = "two words" }), .editFilter(.word)) // the Mac's word delete
        XCTAssertEqual(route(key(.backspace, option: true)), .ignore)
        XCTAssertEqual(route(char("3", option: true)), .pick(3))
        XCTAssertEqual(route(char("j", option: true)), .move(1))
        XCTAssertEqual(route(char("/", option: true)), .focusSearch)
        XCTAssertEqual(route(char("l", option: true)), .keyAction("l"))
        XCTAssertEqual(route(char("P", shift: true, option: true)), .keyAction("P")) // ⌥⇧P: P's action (the QML lost the Shift)
        XCTAssertEqual(route(char("s", command: true)), .saveSearch) // ⌘S as Ctrl+S
    }

    func testPasteInAPageForTyping() {
        let typing = state { $0.view = "todo-new"; $0.searchFocus = true }
        XCTAssertEqual(route(char("v", control: true), typing), .paste)
        XCTAssertEqual(route(char("v", command: true), typing), .paste) // ⌘V as Ctrl+V
        XCTAssertEqual(route(char("v", command: true), state { $0.view = "settings-edit" }), .paste)
    }

    func testCtrlEnterInTagsCtrlSAndAt() {
        XCTAssertEqual(route(key(.enter, control: true), state { notRoot(&$0); $0.view = "tags"; $0.filterText = "new" }), .createTag)
        XCTAssertEqual(route(char("s", control: true)), .saveSearch)
        XCTAssertEqual(route(char("@", shift: true)), .openPicker)
        XCTAssertEqual(route(char("@", shift: true), state { $0.view = "todo-new" }), .openTaskTags)
    }

    func testTheListHasTheKeysASingleKeyIsQueued() {
        XCTAssertEqual(route(char("t")), .queue("t"))
        XCTAssertEqual(route(char("T", shift: true)), .queue("T"))
        XCTAssertEqual(route(char("t"), state { $0.searchFocus = true }), .editSearch(.insert("t"))) // the box has them
        XCTAssertEqual(route(char("t"), state { $0.singleKeys = false }), .editSearch(.insert("t"))) // Alt mode: typing
    }

    func testEditingTheSearchAtItsCaret() {
        let box = state { $0.searchFocus = true; $0.filterText = "teece" }
        XCTAssertEqual(route(key(.backspace), box), .editSearch(.backspace))
        XCTAssertEqual(route(key(.backspace, control: true), box), .editSearch(.word))
        XCTAssertEqual(route(key(.delete), box), .editSearch(.delete))
        XCTAssertEqual(route(char("u", control: true), box), .editSearch(.clear))
        XCTAssertEqual(route(key(.left), box), .editSearch(.left))
        XCTAssertEqual(route(key(.right), box), .enterActions) // the caret at the end: → is the menu
        XCTAssertEqual(route(key(.right), state { $0.searchFocus = true; $0.filterText = "teece"; $0.caretBack = 2 }), .editSearch(.right))
        XCTAssertEqual(route(key(.home), box), .editSearch(.home))
        XCTAssertEqual(route(key(.end), box), .editSearch(.end))
        XCTAssertEqual(route(key(.backspace), state { $0.searchFocus = true }), .pass) // nothing typed: Backspace at the root does nothing
    }

    func testTabGivesTheSearchBoxTheKeys() {
        XCTAssertEqual(route(key(.tab)), .focusSearch)
        XCTAssertEqual(route(key(.tab), state { $0.view = "chat-rename"; $0.searchFocus = true }), .ignore)
    }

    func testThePromptEditorsRowsDontFilter() {
        let editor = state { $0.view = "prompt-edit"; $0.singleKeys = false }
        XCTAssertEqual(route(char("x"), editor), .ignore)
        XCTAssertEqual(route(key(.enter), editor), .activate)
    }

    func testBackspaceEditsTheFilterOfAList() {
        let list = state { notRoot(&$0); $0.filterText = "op" }
        XCTAssertEqual(route(key(.backspace), list), .editFilter(.backspace))
        XCTAssertEqual(route(key(.backspace), state(notRoot)), .back) // nothing typed: back
    }

    func testLeftHidesAPapersNotes() {
        XCTAssertEqual(route(key(.left), state { $0.selectedKind = "note-child" }), .hideNotes)
        XCTAssertEqual(route(key(.left), state { $0.selectedKind = "note-child"; $0.searchFocus = true; $0.filterText = "x" }), .editSearch(.left))
    }

    func testBackFromAList() {
        XCTAssertEqual(route(key(.left), state(notRoot)), .back)
        XCTAssertEqual(route(key(.backtab, shift: true), state(notRoot)), .back)
        XCTAssertEqual(route(key(.tab, shift: true), state(notRoot)), .back)
        XCTAssertEqual(route(key(.left), state { notRoot(&$0); $0.filterText = "op" }), .pass) // something typed: ← stays
        XCTAssertEqual(route(key(.left)), .pass) // the root: nowhere to go
    }

    func testShiftArrowsMoveARowOrASection() {
        XCTAssertEqual(route(key(.up, shift: true, control: true), state(notRoot)), .moveSection(-1))
        XCTAssertEqual(route(key(.down, shift: true), state(notRoot)), .moveRow(1)) // actions: a menu with pins
        XCTAssertEqual(route(key(.down, shift: true)), .moveRow(1)) // the results: the pinned
        XCTAssertEqual(route(key(.down, shift: true), state { notRoot(&$0); $0.view = "files" }), .move(1)) // nothing to move: down
    }

    func testMovingAndPaging() {
        XCTAssertEqual(route(key(.up)), .move(-1))
        XCTAssertEqual(route(char("k", control: true)), .move(-1))
        XCTAssertEqual(route(char("p", control: true)), .move(-1))
        XCTAssertEqual(route(key(.down)), .move(1))
        XCTAssertEqual(route(char("n", control: true)), .move(1))
        XCTAssertEqual(route(key(.pageUp)), .page(-1))
        XCTAssertEqual(route(key(.pageDown)), .page(1))
    }

    func testEnterTabAndRightInTheResultsAndInAList() {
        XCTAssertEqual(route(key(.enter), state { $0.rowCount = 3 }), .enterActions)
        XCTAssertEqual(route(key(.enter)), .activate) // no rows: start Zotero
        XCTAssertEqual(route(key(.tab), state { $0.singleKeys = false; $0.rowCount = 3 }), .enterActions)
        XCTAssertEqual(route(key(.backtab, shift: true)), .ignore)
        XCTAssertEqual(route(key(.enter), state(notRoot)), .activate)
        XCTAssertEqual(route(key(.right), state(notRoot)), .activate)
        XCTAssertEqual(route(key(.tab), state { notRoot(&$0); $0.singleKeys = false }), .activate)
    }

    func testTypingInAListAndWhatIsLeft() {
        let list = state { notRoot(&$0); $0.singleKeys = false }
        XCTAssertEqual(route(char("o"), list), .append("o"))
        XCTAssertEqual(route(char("o", command: true), list), .pass)
        XCTAssertEqual(route(key(.f1, control: true), list), .openKeys)
    }

    // ---- keyAction's letters that exist in 3a

    func testKeyActionLetters() {
        XCTAssertEqual(KeyRouter.keyAction("4"), .pick(4))
        XCTAssertEqual(KeyRouter.keyAction("/"), .focusSearch)
        XCTAssertEqual(KeyRouter.keyAction("j"), .move(1))
        XCTAssertEqual(KeyRouter.keyAction("k"), .move(-1))
        XCTAssertEqual(KeyRouter.keyAction("?"), .openKeys)
        XCTAssertNil(KeyRouter.keyAction("0"))
        XCTAssertNil(KeyRouter.keyAction("t")) // a later phase's
    }

    // ---- the single-key buffer, with an injected clock

    func testOneKeyActsAfterTheDelay() {
        var buffer = KeyBuffer(delay: 0.3)
        let t0 = Date(timeIntervalSince1970: 1000)
        XCTAssertEqual(buffer.queue("j", at: t0), [])
        XCTAssertEqual(buffer.tick(at: t0.addingTimeInterval(0.2)), [])
        XCTAssertEqual(buffer.tick(at: t0.addingTimeInterval(0.3)), [.move(1)])
        XCTAssertEqual(buffer.tick(at: t0.addingTimeInterval(0.4)), [])
        XCTAssertEqual(buffer.queue("t", at: t0.addingTimeInterval(1)), [])
        XCTAssertEqual(buffer.tick(at: t0.addingTimeInterval(1.5)), [.keyActionOrTyping("t")]) // not a 3a letter: the store decides
    }

    func testASecondKeyInsideTheDelayIsTyping() {
        var buffer = KeyBuffer(delay: 0.3)
        let t0 = Date(timeIntervalSince1970: 1000)
        XCTAssertEqual(buffer.queue("t", at: t0), [])
        XCTAssertEqual(buffer.queue("e", at: t0.addingTimeInterval(0.1)), [.typing("te")])
        XCTAssertFalse(buffer.pending)
    }

    func testASecondKeyAfterTheDelayActsOnTheFirstThenWaits() {
        var buffer = KeyBuffer(delay: 0.3)
        let t0 = Date(timeIntervalSince1970: 1000)
        XCTAssertEqual(buffer.queue("j", at: t0), [])
        XCTAssertEqual(buffer.queue("k", at: t0.addingTimeInterval(0.5)), [.move(1)]) // the timer was late
        XCTAssertEqual(buffer.tick(at: t0.addingTimeInterval(0.8)), [.move(-1)])
    }

    func testAnotherKeyFlushesThePendingOneFirst_EscDropsIt() {
        var buffer = KeyBuffer(delay: 0.3)
        let t0 = Date(timeIntervalSince1970: 1000)
        let s = KeyState()
        _ = buffer.handle(char("j"), s, at: t0)
        XCTAssertEqual(buffer.handle(key(.enter), s, at: t0.addingTimeInterval(0.1)), [.move(1), .activate])
        _ = buffer.handle(char("j"), s, at: t0.addingTimeInterval(1))
        XCTAssertEqual(buffer.handle(key(.escape), s, at: t0.addingTimeInterval(1.1)), [.close])
        XCTAssertFalse(buffer.pending)
        _ = buffer.handle(char("j"), s, at: t0.addingTimeInterval(2))
        XCTAssertEqual(buffer.handle(char("e"), s, at: t0.addingTimeInterval(2.1)), [.typing("je")])
    }

    // ---- the Mac's keys

    func testMacKeysFromAppKitsCodes() {
        XCTAssertEqual(KeyEvent(keyCode: 53, characters: "\u{1b}", ignoringModifiers: "\u{1b}", shift: false, control: false, option: false, command: false).key, .escape)
        XCTAssertEqual(KeyEvent(keyCode: 48, characters: "\t", ignoringModifiers: "\t", shift: true, control: false, option: false, command: false).key, .backtab)
        XCTAssertEqual(KeyEvent(keyCode: 76, characters: "\u{3}", ignoringModifiers: "\u{3}", shift: false, control: false, option: false, command: false).key, .enter)
        let a = KeyEvent(keyCode: 0, characters: "A", ignoringModifiers: "A", shift: true, control: false, option: false, command: false)
        XCTAssertEqual(a.key, .character("a"))
        XCTAssertEqual(a.text, "A")
    }

    func testOptionLettersAndDeadKeysResolveToTheirLetter() {
        let dagger = KeyEvent(keyCode: 17, characters: "†", ignoringModifiers: "t", shift: false, control: false, option: true, command: false)
        XCTAssertEqual(dagger.key, .character("t"))
        XCTAssertEqual(dagger.text, "")
        XCTAssertEqual(route(dagger), .keyAction("t"))
        for (code, letter) in [(14, "e"), (32, "u"), (45, "n"), (34, "i"), (50, "`")] as [(UInt16, String)] {
            let dead = KeyEvent(keyCode: code, characters: "", ignoringModifiers: letter, shift: false, control: false, option: true, command: false)
            XCTAssertEqual(dead.key, .character(Character(letter)), letter)
        }
        XCTAssertEqual(route(KeyEvent(keyCode: 18, characters: "¡", ignoringModifiers: "1", shift: false, control: false, option: true, command: false)), .pick(1))
    }

    func testADeadKeyWithoutOptionTypesItself() {
        let quote = KeyEvent(keyCode: 39, characters: "", ignoringModifiers: "'", shift: false, control: false, option: false, command: false)
        XCTAssertEqual(quote.text, "'")
        XCTAssertEqual(route(quote, state { $0.searchFocus = true }), .editSearch(.insert("'")))
    }

    // ---- review fixes

    func testFunctionKeysTypeNothing() {
        let f5 = KeyEvent(keyCode: 96, characters: "\u{F708}", ignoringModifiers: "\u{F708}", shift: false, control: false, option: false, command: false)
        XCTAssertEqual(f5.key, .other)
        XCTAssertEqual(f5.text, "")
        XCTAssertFalse(f5.printable)
        XCTAssertEqual(route(f5), .pass)
        XCTAssertEqual(route(f5, state { $0.searchFocus = true }), .pass)
    }

    func testCommandShortcutsAreTheMacs() {
        XCTAssertEqual(route(key(.right, command: true), state { $0.searchFocus = true; $0.filterText = "teece"; $0.rowCount = 3 }), .pass)
        XCTAssertEqual(route(key(.left, command: true), state(notRoot)), .pass)
        XCTAssertEqual(route(char("a", command: true), state { $0.searchFocus = true; $0.filterText = "x" }), .pass)
        XCTAssertEqual(route(char("v", command: true)), .pass) // the search box pastes for itself
    }

    func testOnlyASCIIDigitsPickARow() {
        XCTAssertNotEqual(route(key(.character("٣"), option: true)), .pick(3))
        XCTAssertNotEqual(route(key(.character("³"), option: true)), .pick(3))
    }

    func testTheNoteReaderTakesItsKeyBeforeAWaitingOne() {
        var buffer = KeyBuffer(delay: 0.3)
        let t0 = Date(timeIntervalSince1970: 1000)
        _ = buffer.handle(char("j"), KeyState(), at: t0)
        XCTAssertEqual(buffer.handle(char("y"), state { $0.view = "note" }, at: t0.addingTimeInterval(0.1)), [.note(char("y"))])
        XCTAssertTrue(buffer.pending)
    }
}
