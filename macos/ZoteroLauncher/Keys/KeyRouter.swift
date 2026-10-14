import Foundation

// handleKey (reference/ZoteroSearch.qml:4545-4707) as a pure function: a key and where you are
// give one command, by the first rule that takes it, in the QML's order. A rule the QML takes only
// when its action works (⌥→ on a paper) is decided from the state. The single-key wait is
// KeyBuffer's.
enum KeyRouter {
    static func route(_ e: KeyEvent, _ s: KeyState) -> KeyCommand {
        let k = e.key
        let plain = !e.control && !e.option
        let tabs = k == .tab || k == .backtab
        let dir = k == .backtab || e.shift ? -1 : 1
        let vertical = k == .up ? -1 : k == .down ? 1 : 0
        let horizontal = k == .left ? -1 : k == .right ? 1 : 0

        if k == .escape && e.shift { return .home }
        if k == .escape {
            if s.singleKeys && s.searchFocus && !s.textEntry && !s.inNote { return .leaveSearch }
            if !s.filterText.isEmpty && !s.inNote { return .clearFilter }
            return s.atRoot ? .close : .back
        }
        if k == .f1 { return .openKeys }
        let paste = (e.control || e.command) && !e.option && k == .character("v")
        // ⌘ shortcuts are the Mac's (⌘← / ⌘→ move the caret, ⌘A selects): only ⌘V is ours, in a page for typing.
        // (the note reader's text size: ⌘-/+/0 as Ctrl's)
        let sizeKey = s.inNote && [KeyEvent.Key.character("-"), .character("+"), .character("="), .character("0")].contains(k)
        let save = s.inSearch && (e.control || e.command) && !e.option && !e.shift && k == .character("s") // ⌘S as Ctrl+S
        if e.command && !sizeKey && !save && !(paste && (s.view == "settings-edit" || s.textEntry)) { return .pass }
        if s.inNote { return .note(e) }
        if k == .delete && plain && s.tabTodo { return .deleteTask }
        if k == .delete && plain && !e.shift && s.filterText.isEmpty && ["actions", "notes"].contains(s.view)
            && ["note", "read", "note-delete", "extract"].contains(s.selectedRowId) { return .deleteNote } // (the extracted text: when it's there)
        if k == .delete && plain && s.view == "settings-tax-review" && s.filterText.isEmpty {
            return s.selectedRowId == "tax-suggestion" ? .rejectSuggestion : .ignore
        }
        if tabs && plain && s.view == "todo-edit" {
            if s.selectedRowId == "todo-status" { return .cycleTaskStatus(dir) }
            if s.selectedRowId == "todo-priority" { return .cycleTaskPriority(dir) }
            return .ignore
        }
        if tabs && plain && s.view == "settings-taxonomy" {
            return s.selectedRowId == "tax-kind" || s.selectedRowId == "tax-show" ? .activate : .ignore
        }
        if s.view == "todo-due" && plain, let command = calendar(k) { return command }
        if tabs && plain && s.tabTodo { return .cycleTask(dir) }
        if tabs && plain && s.atRoot && s.pinnedSearches { return .cycleSearch(dir) }
        if horizontal != 0 && e.option && e.shift && !e.control && s.taskTarget { return .cycleDefaultTask(horizontal) }
        if horizontal != 0 && e.option && !e.shift && !e.control && s.statusTarget { return .cycleStatus(horizontal) }
        if k == .enter && e.shift { return .alternate }
        // ⌥⌫ deletes a word, as everywhere on a Mac (the QML's Alt+Backspace cleared the box: Ctrl+U does)
        if e.option && !e.control && k == .backspace { return s.filterText.isEmpty ? .ignore : .editFilter(.word) }
        if e.option && !e.control, case .character(let c) = k {
            if c.isASCII, let n = c.wholeNumberValue, (1...9).contains(n) { return .pick(n) }
            // ⌥⇧ and a letter: its capital's action (⌥⇧W the window, ⌥⇧P to Other), as ⌥ and the letter is its own
            let key: Character = e.shift && c.isLetter ? Character(c.uppercased()) : c
            if key.isASCII { return keyAction(key) ?? .keyAction(key) }
        }
        if (s.view == "settings-edit" || s.textEntry) && paste { return .paste }
        if s.view == "tags" && e.control && k == .enter { return .createTag }
        if save { return .saveSearch }
        if s.inSearch && e.text == "@" && plain { return .openPicker }
        if s.view == "todo-new" && e.text == "@" && plain { return .openTaskTags }
        if s.listKeys && e.printable { return .queue(e.text) }
        if s.queryTyped && s.typingNow, let edit = searchEdit(e, s) { return .editSearch(edit) }
        if s.singleKeys && k == .tab && !e.shift { return s.textEntry ? .ignore : .focusSearch }
        if ["prompt-edit", "todo-edit"].contains(s.view) && !e.text.isEmpty && plain && ![.enter, .backspace, .tab, .backtab].contains(k) { return .ignore }
        if let edit = filterEdit(e, s) { return .editFilter(edit) }
        if k == .left && plain && s.inSearch && !s.typingNow && s.selectedKind == "note-child" { return .hideNotes }
        if !s.atRoot && (((k == .backspace || k == .left) && s.filterText.isEmpty) || k == .backtab || (k == .tab && e.shift)) { return .back }
        if vertical != 0 && e.shift && e.control && !e.option { return .moveSection(vertical) }
        if vertical != 0 && e.shift && plain && ViewKind.moveRow.contains(s.view) { return .moveRow(vertical) }
        if k == .up || (e.control && (k == .character("k") || k == .character("p"))) { return .move(-1) }
        if k == .down || (e.control && (k == .character("j") || k == .character("n"))) { return .move(1) }
        if k == .pageUp { return .page(-1) }
        if k == .pageDown { return .page(1) }
        if s.inSearch {
            if (k == .tab && !s.singleKeys) || k == .right { return .enterActions }
            if k == .backtab { return .ignore } // never let focus move
            if k == .enter { return s.rowCount == 0 ? .activate : .enterActions }
        } else if k == .enter || k == .tab || k == .right {
            return .activate
        }
        if e.printable { return .append(e.text) }
        return .pass
    }

    // keyAction's letters (ZoteroSearch.qml:1971) that exist in phase 3a; the others are the
    // store's, as it gains their actions.
    static func keyAction(_ c: Character) -> KeyCommand? {
        if let n = c.wholeNumberValue, (1...9).contains(n), c.isASCII { return .pick(n) }
        switch c {
        case "/": return .focusSearch
        case "j": return .move(1)
        case "k": return .move(-1)
        case "?": return .openKeys
        default: return nil
        }
    }

    // The due date's calendar (calendarKey): arrows the day, PgUp / PgDn the month, Home today,
    // Delete no date, Enter the date.
    private static func calendar(_ k: KeyEvent.Key) -> KeyCommand? {
        switch k {
        case .left: return .calendarDays(-1)
        case .right: return .calendarDays(1)
        case .up: return .calendarDays(-7)
        case .down: return .calendarDays(7)
        case .pageUp: return .calendarMonths(-1)
        case .pageDown: return .calendarMonths(1)
        case .home: return .calendarToday
        case .delete: return .clearDue
        case .enter: return .pickDue
        default: return nil
        }
    }

    // The search box's own keys, at its caret (editSearchKey).
    private static func searchEdit(_ e: KeyEvent, _ s: KeyState) -> KeyCommand.SearchEdit? {
        let has = !s.filterText.isEmpty
        if e.option || e.command { return nil }
        if e.key == .backspace && has { return e.control ? .word : .backspace }
        if e.key == .delete && has { return .delete }
        if e.control && e.key == .character("u") && !e.shift && has { return .clear }
        if e.control { return nil }
        if e.key == .left && has { return .left }
        if e.key == .right && s.caretBack > 0 { return .right }
        if e.key == .home && has { return .home }
        if e.key == .end && has { return .end }
        if e.printable { return .insert(e.text) }
        return nil
    }

    // A list's filter, edited from its end (the Omarchy shell's Util.editsFilter: Backspace,
    // Ctrl+Backspace a word, Ctrl+U all).
    private static func filterEdit(_ e: KeyEvent, _ s: KeyState) -> KeyCommand.FilterEdit? {
        guard !s.filterText.isEmpty, !e.option, !e.command else { return nil }
        if e.key == .backspace { return e.control ? .word : .backspace }
        if e.control && e.key == .character("u") { return .clear }
        return nil
    }
}
