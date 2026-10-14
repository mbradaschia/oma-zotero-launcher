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
        s.tabTodo = !tabTodoId.isEmpty
        s.pinnedSearches = !pinnedSearches.isEmpty
        s.searchEditQuery = store.view == "search-edit" && searchState.editMode == "query"
        s.statusTarget = statusTarget() != nil
        s.taskTarget = taskTarget() != nil
        return s
    }

    // A key from the panel. → whether the launcher took it (else the search box, or nobody, has it).
    func handle(_ event: KeyEvent, at now: Date = Date()) -> Bool {
        // Single keys with the search box holding them: Option types (⌥u u is ü, ⌥⌫ a word,
        // ⌥←/→ jump words), as in any Mac text field (decision 9). Esc still leaves the box.
        if singleKeys && store.searchFocus && event.option && event.key != .escape { return false }
        let commands = store.keys.handle(event, keyState, at: now)
        scheduleKeyTick()
        // a waiting key that acts first doesn't decide what happens to this one
        var taken = true // queued: waiting to be told from typing
        for command in commands { taken = execute(command) }
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
        case .openKeys: openKeys()
        case .alternate:
            let row = selectedListRow
            if store.view == "tags", let row, row.rowId == "tag" { openTagMenu(row.tag) }
            else if let row, row.rowId == "search" { openSearchMenu(row) }
            else if let row, row.rowId == "extract", !row.noteKey.isEmpty { openExtractMenu() }
            else if let row, ["chat-session", "chat-open"].contains(row.rowId) { openChatMenu(row) }
            else if let row, row.rowId == "artifact" { openArtifactMenu(row) }
            else if store.view == "todo-new" { saveNewTodo(store.filterText.trimmingCharacters(in: .whitespaces), open: false) }
            else if let row, row.rowId == "todo-quick" { addQuickHere(row.value, open: false) }
            else { openInZotero() }
        case .clearSearchBox:
            if !store.filterText.isEmpty { setFilter("") }
            if !store.textEntry { store.searchFocus = true }
        case .pick(let n): pickNumber(n)
        case .keyAction(let c): return keyAction(c) // Alt+letter: only what it does, else the key goes on
        case .keyActionOrTyping(let c):
            // (pages whose rows are fixed: a letter that does nothing there types nothing either)
            if !keyAction(c) && !["prompt-edit", "todo-edit", "settings-taxonomy", "settings-tax-label", "settings-tax-ai"].contains(store.view) { startTyping(String(c)) }
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
            store.queryLive = true
        case .focusSearch: store.searchFocus = true
        case .moveSection(let d): moveSectionOf(d)
        case .moveRow(let d):
            if store.inSearch { movePinned(d) }
            else if ViewKind.menuPin.contains(store.view) { moveMenuRow(d) }
            else if store.view == "notes" { moveNote(d) }
            else if store.view == "todos" { moveTodoRow(d) }
            else if store.view == "settings-tasks" { moveStatusRow(d) }
            else if store.view == "settings-paper-status" { movePaperStatusRow(d) }
            else if store.view == "searches" { moveSearchRow(d) }
            else if store.view == "settings-taxonomy" && selectedListRow?.rowId == "tax-label" { moveTaxonomyLabel(d) }
            else { select(d) }
        case .move(let d): select(d)
        case .page(let d): select(d * pageSize)
        case .enterActions: enterActions(store.selectedIndex)
        case .activate:
            if store.inSearch { activate(store.selectedIndex) } else { activateAction(store.selectedIndex) }
        case .ignore: break
        case .pass: return false
        case .note(let e): noteKey(e)
        case .cycleStatus(let d): cyclePaperStatus(d)
        case .cycleDefaultTask(let d): cycleDefaultTask(d)
        case .paste: pasteIntoFilter()
        case .createTag: toggleTag(store.filterText, create: true)
        case .hideNotes: _ = toggleNotes()
        case .deleteTask: todoKey("delete")
        case .deleteNote:
            if let row = selectedListRow, row.rowId == "extract" { if !row.noteKey.isEmpty { askDeleteExtracted(["key": row.noteKey, "libraryID": row.noteLibraryID]) } }
            else if let row = selectedListRow, ["chat-session", "chat-open"].contains(row.rowId) { askDeleteChat(row) }
            else if let row = selectedListRow, row.rowId == "artifact" { askDeleteArtifact(row) }
            else { askDeleteNote(selectedNoteTarget()) }
        case .cycleTaskStatus(let d): cycleTodo(tasks.todoId, d)
        case .cycleTaskPriority(let d): cycleTodoPriority(d)
        case .cycleTask(let d): cycleTodo(tabTodoId, d)
        case .calendarDays, .calendarMonths, .calendarToday, .clearDue, .pickDue: calendar(command)
        case .openTaskTags:
            store.push("todo-tags")
            rebuildList()
        case .saveSearch: saveSearchPrompt()
        case .openPicker: openPicker()
        case .cycleSearch(let d): cycleSearch(d)
        case .rejectSuggestion: // Delete on a suggestion (Settings › Taxonomies › Review): dismissed
            if let row = selectedListRow, row.rowId == "tax-suggestion" { decideSuggestion(row, accept: false) }
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
        // (and when the badge the rows were for went away meanwhile: an unpinned search; QML keeps those rows)
        if ok && store.inSearch && (libraryChanged || response == nil || scopeKey(searchScope) != requestedScope) {
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
        store.queryLive = true
    }

    // A key as the current mode writes it: "t", or "⌥t" (a capital: "⌥⇧W"), the Mac's notation.
    func keyName(_ letter: String) -> String {
        if singleKeys { return letter }
        return letter.count == 1 && letter.uppercased() == letter && letter.lowercased() != letter ? "⌥⇧" + letter : "⌥" + letter
    }

    // keyAction (ZoteroSearch.qml:1971) for what exists on the Mac. → handled (else it is typing).
    func keyAction(_ c: Character) -> Bool {
        if let n = c.wholeNumberValue, c.isASCII, (1...9).contains(n) { pickNumber(n); return true }
        let accel = settings?.values.accelerators ?? true
        switch c {
        case "/": store.searchFocus = true; return true
        case "j", "k": select(c == "j" ? 1 : -1); return true
        case "W": toggleWindowed(); return true
        case "z": openInZotero(); return true
        case ";":
            if !store.inSettings { openSettings("") }
            return true
        case " " where store.inSearch:
            if toggleNotes() { return true }
        case "t":
            if store.view != "todos" { openTodos() }
            return true
        case "a":
            return addTodoKey()
        case "!" where !tabTodoId.isEmpty:
            todoKey("priority")
            return true
        case "d" where !tabTodoId.isEmpty:
            todoKey("done")
            return true
        case "u" where tasks.lastDeleted != nil && (store.view == "todos" || store.view == "actions"):
            todoKey("undo")
            return true
        case "f":
            if store.view != "searches" { openSearches() }
            return true
        case "S":
            syncZotero()
            return true
        case "p" where store.view == "searches":
            toggleSelectedSearchPin()
            return true
        case ".":
            if store.view != "tasks" { openTasks() }
            return true
        case "e" where store.view == "prompts":
            editSelectedPrompt()
            return true
        case "c":
            chatKey()
            return true
        case "?":
            openKeys()
            return true
        case "g" where store.inSearch && store.pickFor.isEmpty, "G" where store.inSearch && store.pickFor.isEmpty:
            cycleGrouping(c == "g" ? 1 : -1)
            return true
        case "x" where store.view == "actions" || (store.inSearch && selectedSearchRow?.kind == "item"):
            return extractKey()
        case "@" where store.inSearch:
            openPicker()
            return true
        case "i", "r":
            guard (!store.inSearch || accel), citeTarget() != nil else { break }
            copyCite(c == "i" ? "citation" : "bibliography")
            return true
        default: break
        }
        let paper: [Character: String] = ["o": "external", "w": "window", "n": "notes", "#": "tags"]
        if store.inSearch {
            if c == "s" && store.pickFor.isEmpty { saveSearchPrompt(); return true }
            guard accel else { return false }
            if paper[c] != nil {
                enterActions(store.selectedIndex, quick: paper[c] ?? "")
                return true
            }
            if c == "l" { revealSelected(); return true }
            if c == "p" { togglePinSelected(); return true }
            return false
        }
        // a note's keys, wherever the highlighted row is a note (a paper's menu, Notes, Processes)
        if Self.noteViews.contains(store.view), selectedNoteTarget() != nil {
            if c == "w" { openNoteWindow(); return true }
            if c == "y" || c == "s" { exportNote(c == "y" ? "copy" : "save"); return true }
        }
        // the paper's letters, only in the paper's own views (never on one left behind)
        guard actionItem != nil, Self.paperViews[store.view] != nil else { return false }
        if c == "p" && ViewKind.menuPin.contains(store.view) { toggleMenuPin(); return true }
        if c == "P" && ViewKind.menuPin.contains(store.view) { toggleMenuOther(); return true }
        if c == "p" { togglePinOfMenu(); return true } // under the menu (its files): the paper
        if c == "l" { finish("reveal", attachment: nil); return true }
        if let kind = paper[c], details != nil {
            if kind == store.view { return true } // already there
            quickAction = kind
            runQuick()
            return true
        }
        return false
    }

    static let noteViews: Set<String> = ["actions", "notes", "tasks"]

    // What a key would open, not ported yet, said one way everywhere:
    // "Not on the Mac yet: chat (c) comes in a later version".
    func notYet(_ what: String, key: String? = nil) {
        flashMessage("Not on the Mac yet: " + what + (key.map { " (\($0))" } ?? "") + " comes in a later version")
    }

    // ? or F1 (ZoteroSearch.qml's openKeys): the keybindings, the ones for where you are first.
    func openKeys() {
        guard store.view != "keys", let core else { return }
        let ctx: [String: Any] = ["scope": store.scope != nil, "pickFor": store.pickFor, "inSettings": store.inSettings, "textEntry": store.textEntry]
        keysHere = (try? core.glueJSON("keysContext", [store.view, ctx, !singleKeys])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any]
        store.push("keys")
        rebuildList()
    }

    // g / G: the results' papers grouped or sorted (ZoteroSearch.qml:581), kept in view.json.
    func cycleGrouping(_ delta: Int) {
        guard let core, var prefs else { return }
        let current = prefs.values["grouping"] as? String ?? "relevance"
        let next = (try? core.glue("nextGrouping", [current, delta, tax.taxonomies], as: String.self)) ?? "relevance"
        saved {
            try prefs.set("grouping", next == "relevance" ? nil : next)
            self.prefs = prefs
        }
        store.followTop = false
        if store.inSearch { rebuildSearch() }
        let name = (try? core.glue("groupingName", [next, tax.taxonomies], as: String.self)) ?? ""
        let groupable = response.map { ($0["scope"] is [String: Any]) || !((($0["query"] as? String) ?? "").trimmingCharacters(in: .whitespaces).isEmpty) } ?? false
        flashMessage("Papers: " + (name.isEmpty ? "by relevance" : name) + (groupable || !store.inSearch ? "" : " (once you search)"))
    }

    // W: the launcher as a window, and back.
    func toggleWindowed() {
        windowed.toggle()
        flashMessage(windowed ? "A window now: \(keyName("W")) puts it back" : "")
    }
}
