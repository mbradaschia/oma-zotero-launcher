import Foundation

// The launcher as the target of a row's action (Actions/ActionMap.swift).
extension LauncherModel: ActionTarget {
    func openFiles(_ purpose: String) {
        filePurpose = purpose
        store.push("files")
        rebuildList()
    }

    func togglePinOfMenu() {
        guard let item = actionItem else { return }
        togglePin(item.json.merging(["type": "item"]) { a, _ in a })
        store.followTop = false
        rebuildList()
    }

    func openNote(_ row: ListRow) {
        openNoteView(["key": row.noteKey, "libraryID": row.noteLibraryID, "title": row.label])
    }

    func chooseTagStatus(_ kind: String) {
        tags.statusKind = kind
        store.push("tag-status")
        rebuildList()
        selectRow { $0.available } // a status by that name already: its merge row
    }

    func convertMenuTag(into target: String) {
        convertTag(tags.statusKind, tags.menuName, target)
    }

    func renameMenuTag() {
        store.push("tag-name")
        store.filterText = tags.menuName
        rebuildList()
    }

    func saveMenuTagName(_ name: String) {
        let from = tags.menuName
        back()
        back()
        renameTagEverywhere(from, name) { [weak self] in self?.reloadTagEditor(from, name) }
    }

    func deleteMenuTag() {
        let name = tags.menuName
        back()
        askConfirm(ConfirmAsk(title: "Delete the tag “\(name)”?", yes: "Delete it from every paper", no: "Keep it", detail: "Counting the papers…",
                              run: { [weak self] in self?.deleteTagEverywhere(name) { self?.reloadTagEditor(name, "") } }))
        countIntoConfirm([name]) { n in "On \(n) \(n == 1 ? "paper" : "papers"); Zotero's Undo doesn't bring it back" }
    }

    func taskAction(_ row: ListRow) {
        switch row.rowId {
        case "todo": openTodo(row.value)
        case "todo-new": startNewTodo(store.view == "actions" ? ["item": actionItemRef ?? NSNull()] : [:])
        case "todo-new-save": saveNewTodo(row.value, open: true)
        case "todo-quick": addQuickHere(row.value, open: true)
        case "todo-save", "todo-status", "todo-priority": back() // a task's page: every change is saved already
        case "todo-desc": openTodoText("description") // typed in the header, as todo-text does
        case "todo-notes": openTodoText("notes")
        case "todo-edit": openTodoText(row.value)
        case "todo-text-save": saveTodoText(row.value)
        case "todo-due": openDuePicker()
        case "todo-status-opt":
            setTodo(["status": row.value])
            back()
            selectRow { $0.rowId == "todo-status" }
        case "todo-priority-opt":
            setTodo(["priority": row.tag])
            back()
            selectRow { $0.rowId == "todo-priority" }
        case "todo-item":
            if let item = currentTodo()?["item"] as? [String: Any] {
                enterActionsFor(PaperRef(key: item["key"] as? String ?? "", libraryID: item["libraryID"] as? Int ?? 1, title: item["title"] as? String ?? "", itemType: ""))
            }
        case "todo-context":
            guard let t = currentTodo(), let c = t["context"] as? [String: Any] else { return }
            if c["kind"] as? String == "chat" { return flashMessage("Not on the Mac yet: chats come in a later version") }
            openNoteView(["key": c["key"] ?? "", "libraryID": c["libraryID"] ?? 1, "title": c["title"] ?? ""])
        case "todo-pick":
            store.push("search")
            store.pickFor = "todo"
            response = nil
            rebuildSearch()
            requestSearch()
        case "todo-unlink":
            setTodo(["item": NSNull(), "context": NSNull()])
            flashMessage("The task isn't about a paper any more")
        case "todo-delete":
            let id = tasks.todoId
            saveTodos { list in try glueChange("removeTodo", [list, id]) }
            back()
            flashMessage("Task deleted")
        case "task-tag": addToSearch(row.value, levels: 1)
        default: statusAction(row) // task-default, pstatus*, status*, task-action*
        }
    }

    // A term, operator or block picked with @ (the search, a new task's line): put in where the
    // caret was, `levels` menus back, the search box keeping the keys (ZoteroSearch.qml:2547). The
    // caret counts UTF-16 units, as the JS does.
    func addToSearch(_ token: String, levels: Int) {
        for _ in 0..<levels { back() }
        store.searchFocus = true
        let caret = max(0, store.filterText.utf16.count - store.caretBack)
        guard let r = (try? core?.glueJSON("insertAt", [store.filterText, caret, token]))
            .flatMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }) as? [String: Any] else { return }
        let text = r["text"] as? String ?? store.filterText
        setFilter(text)
        store.caretBack = max(0, text.utf16.count - (r["caret"] as? Int ?? text.utf16.count))
    }

    func answerConfirm(_ yes: Bool) {
        let ask = confirmAsk
        confirmAsk = nil
        back()
        if yes { ask?.run() } else { ask?.cancel() }
    }
}
