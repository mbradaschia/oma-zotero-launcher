import Foundation

// The keys: what the router reads, and what each of its commands does here
// (ZoteroSearch.qml:1955-2094, 4510-4707). A command for a view that comes in a later phase says
// so in the footer.
extension LauncherModel {
    var keyState: KeyState {
        var s = KeyState()
        s.singleKeys = singleKeys
        s.searchFocus = store.searchFocus
        s.view = store.view
        s.scoped = store.scope != nil || !store.pickFor.isEmpty
        s.filterText = store.filterText
        s.caretBack = store.caretBack
        s.rowCount = content.count
        s.selectedRowId = selectedListRow?.rowId ?? ""
        s.selectedKind = selectedSearchRow?.kind ?? ""
        return s
    }

    // A key from the panel. → whether the launcher took it (else the search box, or nobody, has it).
    func handle(_ event: KeyEvent, at now: Date = Date()) -> Bool {
        let commands = store.keys.handle(event, keyState, at: now)
        scheduleKeyTick()
        var taken = commands.isEmpty // queued: waiting to be told from typing
        for command in commands { taken = execute(command) || taken }
        return taken
    }

    // → whether it was taken.
    @discardableResult
    func execute(_ command: KeyCommand) -> Bool {
        switch command {
        case .home:
            goHome()
            if store.atRoot {
                if !store.filterText.isEmpty { setFilter("") }
                if singleKeys && !store.textEntry { store.searchFocus = false }
            }
        case .leaveSearch: store.searchFocus = false
        case .clearFilter: setFilter("")
        case .back: back()
        case .close: dismiss()
        case .openKeys: flashMessage("The keys panel comes in a later version")
        case .alternate: openInZotero()
        case .clearSearchBox:
            if !store.filterText.isEmpty { setFilter("") }
            if !store.textEntry { store.searchFocus = true }
        case .pick(let n): pickNumber(n)
        case .keyAction(let c): _ = keyAction(c)
        case .keyActionOrTyping(let c):
            if !keyAction(c) { startTyping(String(c)) }
        case .typing(let text): startTyping(text)
        case .queue: break // KeyBuffer's
        case .editSearch(let edit):
            // The search box edits itself while it has the keys (composed text, the caret); this is for
            // when it doesn't.
            guard !store.searchFocus else { return false }
            editFilter(edit)
        case .editFilter(let edit):
            switch edit {
            case .backspace: setFilter(String(store.filterText.dropLast()))
            case .word: setFilter(Self.droppingWord(store.filterText))
            case .clear: setFilter("")
            }
        case .append(let text):
            guard !store.searchFocus else { return false }
            setFilter(store.filterText + text)
        case .focusSearch: store.searchFocus = true
        case .moveSection(let d): moveSectionOf(d)
        case .moveRow(let d):
            if store.inSearch { movePinned(d) } else if ViewKind.menuPin.contains(store.view) { moveMenuRow(d) } else { select(d) }
        case .move(let d): select(d)
        case .page(let d): select(d * pageSize)
        case .enterActions: enterActions(store.selectedIndex)
        case .activate:
            if store.inSearch { activate(store.selectedIndex) } else { activateAction(store.selectedIndex) }
        case .ignore: break
        case .pass: return false
        case .note, .paste, .createTag, .saveSearch, .openPicker, .openTaskTags, .deleteTask, .rejectSuggestion,
             .cycleTaskStatus, .cycleTaskPriority, .calendarDays, .calendarMonths, .calendarToday, .clearDue, .pickDue,
             .cycleTask, .cycleSearch, .cycleDefaultTask, .cycleStatus, .hideNotes:
            flashMessage("Not on the Mac yet: that key's view comes in a later version")
        }
        return true
    }

    private func editFilter(_ edit: KeyCommand.SearchEdit) {
        switch edit {
        case .insert(let text): setFilter(store.filterText + text)
        case .backspace: setFilter(String(store.filterText.dropLast()))
        case .word: setFilter(Self.droppingWord(store.filterText))
        case .clear: setFilter("")
        case .delete, .left, .right, .home, .end: break // the caret is the search box's
        }
    }

    static func droppingWord(_ text: String) -> String {
        var t = Substring(text)
        while t.last?.isWhitespace == true { t = t.dropLast() }
        while let c = t.last, !c.isWhitespace { t = t.dropLast() }
        return String(t)
    }

    // ↑↓ (wrapping by one, clamped by a page) (ZoteroSearch.qml:4510).
    func select(_ delta: Int) {
        let count = content.count
        guard count > 0 else { return }
        store.followTop = false
        var i = store.selectedIndex + delta
        if abs(delta) == 1 { i = (i + count) % count } else { i = max(0, min(count - 1, i)) }
        store.selectedIndex = i
    }

    // 1…9: the row numbered N from the top of what's shown, as Enter would (ZoteroSearch.qml:882).
    func pickNumber(_ n: Int) {
        let i = visibleTop + n - 1
        guard i >= 0, i < content.count else { return }
        store.selectedIndex = i
        if store.inSearch { enterActions(i) } else { activateAction(i) }
    }

    // Back one level, its rows rebuilt with the row you were on (ZoteroSearch.qml:775).
    @discardableResult
    func back() -> Bool {
        let scopeBefore = store.scope?.id
        let ok = store.back { [self] in
            if store.inSearch {
                if store.scope?.id != scopeBefore { response = nil }
                rebuildSearch()
            } else {
                rebuildList()
            }
            return content.count
        }
        if ok && store.inSearch && (libraryChanged || response == nil) {
            libraryChanged = false
            requestSearch() // rows show pins and tags: get them fresh
        }
        return ok
    }

    func goHome() {
        while !store.atRoot && back() {}
    }

    // A key typed into the search box, which takes the keys (ZoteroSearch.qml:2089).
    func startTyping(_ text: String) {
        store.searchFocus = true
        setFilter(store.filterText + text)
    }

    // A key as the current mode writes it: "t", or "alt+t".
    func keyName(_ letter: String) -> String { singleKeys ? letter : "alt+" + letter }

    // keyAction (ZoteroSearch.qml:1971) for what exists on the Mac. → handled (else it is typing).
    func keyAction(_ c: Character) -> Bool {
        if let n = c.wholeNumberValue, c.isASCII, (1...9).contains(n) { pickNumber(n); return true }
        let accel = settings?.values.accelerators ?? true
        switch c {
        case "/": store.searchFocus = true; return true
        case "j", "k": select(c == "j" ? 1 : -1); return true
        case "W": toggleWindowed(); return true
        case "z": openInZotero(); return true
        case "c", "?", ".", "t", "a", ";", "f", "S", "g", "G", "x", "e":
            flashMessage("Not on the Mac yet: \(keyName(String(c))) opens a view that comes in a later version")
            return true
        case "@" where store.inSearch:
            flashMessage("Not on the Mac yet: @ filters come in a later version")
            return true
        case "i", "r":
            guard (!store.inSearch || accel), citeTarget() != nil else { break }
            copyCite(c == "i" ? "citation" : "bibliography")
            return true
        default: break
        }
        let paper: [Character: String] = ["o": "external", "w": "window", "n": "notes", "#": "tags"]
        if store.inSearch {
            if c == "s" && store.pickFor.isEmpty { flashMessage("Not on the Mac yet: saved searches come in a later version"); return true }
            guard accel else { return false }
            if let kind = paper[c] {
                if kind == "external" || kind == "window" { enterActions(store.selectedIndex, quick: kind) }
                else { flashMessage("Not on the Mac yet: \(kind) come in a later version") }
                return true
            }
            if c == "l" { revealSelected(); return true }
            if c == "p" { togglePinSelected(); return true }
            return false
        }
        guard actionItem != nil else { return false }
        if c == "p" && ViewKind.menuPin.contains(store.view) { toggleMenuPin(); return true }
        if c == "P" && ViewKind.menuPin.contains(store.view) { toggleMenuOther(); return true }
        if c == "l" { finish("reveal", attachment: nil); return true }
        if let kind = paper[c], details != nil {
            if kind == store.view { return true }
            if kind == "external" || kind == "window" {
                quickAction = kind
                runQuick()
            } else {
                flashMessage("Not on the Mac yet: \(kind) come in a later version")
            }
            return true
        }
        return false
    }

    // W: the launcher as a window, and back.
    func toggleWindowed() {
        windowed.toggle()
        flashMessage(windowed ? "A window now: \(keyName("W")) puts it back" : "")
    }
}
