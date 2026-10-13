import Foundation

// Tasks (to-dos): the Tasks view, a task's page, new tasks, their keys, the due date, and their
// papers' t/ tags kept in step (ZoteroSearch.qml:2862-3340; Service.qml:285-392).
extension LauncherModel {
    var nowMs: Double { Date().timeIntervalSince1970 * 1000 }
    var todoList: [Any] { todos?.todos ?? [] }

    func currentTodo() -> [String: Any]? {
        todoList.compactMap { $0 as? [String: Any] }.first { $0["id"] as? String == tasks.todoId }
    }

    // A change to the tasks (a Glue wrapper answering { todos, text, … }), saved; their papers' t/
    // tags follow. → the wrapper's answer, nil when it wasn't saved.
    @discardableResult
    func saveTodos(_ change: (RawJSON) throws -> [String: Any]) -> [String: Any]? {
        guard let core, var file = todos else { return nil }
        var answer: [String: Any]?
        var before = RawJSON(text: "[]")
        saved {
            answer = try file.update(core) { list in
                before = list
                let a = try change(list)
                return (a["text"] as? String ?? "", a["todos"] as? [Any] ?? [], a)
            }
            todos = file
        }
        guard let answer else { return nil }
        let changes = (try? core.glueJSON("taskTagChanges", [before, settingsJSON, file.json, settingsJSON])).flatMap(Self.jsonArray) ?? []
        applyTaskTags(changes)
        return answer
    }

    func glueChange(_ function: String, _ args: [Any]) throws -> [String: Any] {
        guard let core else { throw JSCoreError.noContext }
        return try JSONSerialization.jsonObject(with: Data(core.glueJSON(function, args).utf8)) as? [String: Any] ?? [:]
    }

    // Each paper's t/ tags as its tasks now say (Zotero gets them when it answers).
    func applyTaskTags(_ changes: [[String: Any]]) {
        guard status == "ready" else { return } // the session's first answer sets them all (syncTaskTags)
        for c in changes {
            let add = c["add"] as? [String] ?? []
            let remove = (c["remove"] as? [String] ?? []).filter { !add.contains($0) }
            guard let item = c["item"] as? [String: Any], !add.isEmpty || !remove.isEmpty else { continue }
            updateTags(item, add: add, remove: remove) { result in
                if case .ok = result { return }
                NSLog("ZoteroLauncher: task tags for %@: %@", item["key"] as? String ?? "", result.message)
            }
        }
    }

    // Once Zotero answers: every paper with tasks gets its t/ tags from scratch, then the status lists
    // follow Zotero's (a status tag made or renamed there).
    func syncTaskTags() {
        guard !tasks.tagsSynced, status == "ready", let core else { return }
        tasks.tagsSynced = true
        applyTaskTags((try? core.glueJSON("taskTagSync", [todoList, settingsJSON])).flatMap(Self.jsonArray) ?? [])
        syncStatusLists()
    }

    // A status removed here a moment ago: its tag may still be on papers (being taken off), and is
    // never brought back as a status.
    func forgetStatusTag(_ tag: String) {
        tasks.removedStatusTags.insert(tag.lowercased())
    }

    func syncStatusLists() {
        guard status == "ready", !tasks.statusSyncRunning else { return }
        tasks.statusSyncRunning = true
        bridge.post("/tags/prefixed", ["prefixes": ["s/", "t/"]], timeout: 8) { [weak self] listed in
            MainActor.assumeIsolated {
                guard let self else { return }
                guard case .ok(let listedTags) = listed else { self.tasks.statusSyncRunning = false; return }
                let tags = (listedTags["tags"] as? [String] ?? []).filter { !self.tasks.removedStatusTags.contains($0.lowercased()) }
                self.bridge.post("/tags/changes", ["since": self.tasks.tagChangesSeq], timeout: 8) { [weak self] log in
                    MainActor.assumeIsolated {
                        guard let self else { return }
                        self.tasks.statusSyncRunning = false
                        guard let core = self.core, case .ok(let changes) = log else { return }
                        let seq = changes["seq"] as? Int ?? 0
                        if seq < self.tasks.tagChangesSeq { self.tasks.tagChangesSeq = 0 } // Zotero restarted: its log too
                        self.tasks.tagChangesSeq = seq
                        guard let r = (try? core.glueJSON("statusListsFromZotero", [self.settingsJSON, tags, changes["changes"] ?? []]))
                            .flatMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }) as? [String: Any], r["changed"] as? Bool == true
                        else { return }
                        if let paper = r["paper"] { self.saveSetting("paperStatuses", paper, "") }
                        if let statuses = r["statuses"] { self.saveTasksSetting(["statuses": statuses]) }
                    }
                }
            }
        }
    }

    // ---- views

    func openTodos() {
        store.push("todos")
        rebuildList()
    }

    func openTodo(_ id: String) {
        tasks.todoId = id
        store.push("todo-edit")
        store.searchFocus = false // nothing to search on a task's page: its keys act at once
        rebuildList()
    }

    // a: a new task about what is highlighted (a paper, the note or chat in its menu, the note read).
    @discardableResult
    func addTodoKey() -> Bool {
        if store.inSearch, store.pickFor.isEmpty, let r = selectedSearchRow, r.kind == "item", !["note", "attachment"].contains(r.itemType) {
            let parts = r.subtitle.components(separatedBy: " · ")
            let cite = parts.count > 1 && parts[1].count == 4 && Int(parts[1]) != nil ? "\(parts[0]), \(parts[1])" : ""
            return startNewTodo(["item": ["key": r.key, "libraryID": r.libraryID, "title": r.title, "cite": cite]])
        }
        if store.inNote, let target = note.target {
            var item: Any = NSNull()
            if let p = note.data?["parent"] as? [String: Any] {
                let paper = note.data?["paper"] as? [String: Any]
                let cite = paper.flatMap { (try? core?.glue("paperCite", [$0], as: String.self)) ?? "" } ?? ""
                item = ["key": p["key"] ?? "", "libraryID": p["libraryID"] ?? 1, "title": (paper?["title"] as? String) ?? (p["title"] as? String ?? ""), "cite": cite]
            } else if let ref = actionItemRef {
                item = ref
            }
            return startNewTodo(["item": item, "context": ["kind": "note", "key": target["key"] ?? "", "libraryID": target["libraryID"] ?? 1, "title": noteParts.title]])
        }
        if actionItem != nil, ["actions", "notes"].contains(store.view), let item = actionItemRef {
            var context: Any = NSNull()
            if let sel = selectedListRow, sel.rowId == "note" { context = ["kind": "note", "key": sel.noteKey, "libraryID": sel.noteLibraryID, "title": sel.label] }
            if let sel = selectedListRow, sel.rowId == "chat-session" { context = ["kind": "chat", "key": item["key"] ?? "", "libraryID": item["libraryID"] ?? 1, "id": sel.value, "title": sel.label] }
            return startNewTodo(["item": item, "context": context])
        }
        return startNewTodo([:])
    }

    @discardableResult
    func startNewTodo(_ draft: [String: Any]) -> Bool {
        tasks.draft = draft
        store.push("todo-new")
        rebuildList()
        return true
    }

    // Enter: added, back where you were; Shift+Enter (open: false here is "just add"): opened.
    func saveNewTodo(_ text: String, open: Bool) {
        guard !text.isEmpty, let todo = addQuickTodo(text, item: tasks.draft["item"], context: tasks.draft["context"]) else { return }
        back()
        let id = todo["id"] as? String ?? ""
        if open { return openTodo(id) }
        store.followTop = false
        rebuildList()
        selectRow { $0.rowId == "todo" && $0.value == id }
    }

    // A quick line (#status !priority @due), saved. → the task, or nil.
    func addQuickTodo(_ text: String, item: Any?, context: Any?) -> [String: Any]? {
        guard let core else { return nil }
        let q = (try? core.glueJSON("parseQuick", [text, settingsJSON, nowMs])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any] ?? [:]
        guard let description = q["description"] as? String, !description.isEmpty else { flashMessage("Type what to do"); return nil }
        let fields: [String: Any] = ["description": description, "status": q["status"] ?? "", "priority": q["priority"] ?? "", "due": q["due"] ?? "",
                                     "item": item ?? NSNull(), "context": context ?? NSNull()]
        let now = nowMs
        guard let answer = saveTodos({ list in try glueChange("addTodo", [list, fields, settingsJSON, now]) }) else { return nil }
        let problems = q["problems"] as? [String] ?? []
        flashMessage("Added to " + (answer["statusName"] as? String ?? "") + (problems.first.map { " (\($0))" } ?? ""))
        return answer["todo"] as? [String: Any]
    }

    // Typed in the Tasks view: Enter adds it and opens its page (Shift+Enter: just adds it).
    func addQuickHere(_ text: String, open: Bool) {
        guard let todo = addQuickTodo(text, item: nil, context: nil) else { return }
        setFilter("")
        let id = todo["id"] as? String ?? ""
        if open { return openTodo(id) }
        store.followTop = false
        rebuildList()
        selectRow { $0.rowId == "todo" && $0.value == id }
    }

    // The task Tab, d, !, Delete act on: the page's, or the highlighted one.
    var tabTodoId: String {
        if store.view == "todo-edit" { return tasks.todoId }
        if store.inSearch || store.inNote { return "" }
        return selectedListRow.flatMap { $0.rowId == "todo" ? $0.value : nil } ?? ""
    }

    // !, d, Delete, u on a task.
    func todoKey(_ what: String) {
        let now = nowMs
        if what == "undo" {
            guard let u = tasks.lastDeleted else { return flashMessage("Nothing to bring back") }
            saveTodos { list in try glueChange("restoreTodo", [list, u.todo, u.index]) }
            tasks.lastDeleted = nil
            store.followTop = false
            rebuildList()
            return flashMessage("Brought back “\((u.todo as? [String: Any])?["description"] as? String ?? "")”")
        }
        let id = tabTodoId
        guard !id.isEmpty else { return }
        if what == "delete" {
            guard let i = todoList.firstIndex(where: { ($0 as? [String: Any])?["id"] as? String == id }) else { return }
            let todo = todoList[i]
            tasks.lastDeleted = (todo, i)
            saveTodos { list in try glueChange("removeTodo", [list, id]) }
            if store.view == "todo-edit" { back() }
            store.followTop = false
            rebuildList()
            return flashMessage("Deleted “\((todo as? [String: Any])?["description"] as? String ?? "")” · \(keyName("u")) brings it back")
        }
        let answer = saveTodos { list in
            what == "priority" ? try glueChange("cyclePriority", [list, id, 1, now]) : try glueChange("toggleDone", [list, id, settingsJSON, now])
        }
        store.followTop = false
        rebuildList()
        if store.view != "todo-edit" { selectRow { $0.rowId == "todo" && $0.value == id } }
        guard let t = (answer?["todos"] as? [[String: Any]])?.first(where: { $0["id"] as? String == id }), let core else { return }
        if what == "priority" {
            flashMessage("Priority: " + ((try? core.glue("priorityName", [t["priority"] ?? ""], as: String.self)) ?? ""))
        } else {
            let st = (try? core.glueJSON("statusOf", [t, settingsJSON])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any]
            flashMessage("Now: " + (st?["name"] as? String ?? ""))
        }
    }

    func setTodo(_ changes: [String: Any]) {
        guard !tasks.todoId.isEmpty else { return }
        let id = tasks.todoId, now = nowMs
        saveTodos { list in try glueChange("updateTodo", [list, id, changes, now]) }
        store.followTop = false
        rebuildList()
    }

    // Tab / Shift+Tab on a task: its next or previous status.
    func cycleTodo(_ id: String, _ delta: Int) {
        let now = nowMs
        let answer = saveTodos { list in try glueChange("cycleTodo", [list, id, settingsJSON, delta, now]) }
        store.followTop = false
        rebuildList()
        if store.view != "todo-edit" { selectRow { $0.rowId == "todo" && $0.value == id } }
        if let t = (answer?["todos"] as? [[String: Any]])?.first(where: { $0["id"] as? String == id }),
           let st = (try? core?.glueJSON("statusOf", [t, settingsJSON])).flatMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }) as? [String: Any] {
            flashMessage("Now: " + (st["name"] as? String ?? ""))
        }
    }

    func cycleTodoPriority(_ delta: Int) {
        let id = tasks.todoId, now = nowMs
        let answer = saveTodos { list in try glueChange("cyclePriority", [list, id, delta, now]) }
        store.followTop = false
        rebuildList()
        if let t = (answer?["todos"] as? [[String: Any]])?.first(where: { $0["id"] as? String == id }) {
            flashMessage("Priority: " + ((try? core?.glue("priorityName", [t["priority"] ?? ""], as: String.self)) ?? ""))
        }
    }

    // Shift+↑/↓ in the Tasks view: within its status; past the first or last, into the next status.
    func moveTodoRow(_ delta: Int) {
        guard let sel = selectedListRow, sel.rowId == "todo" else { return }
        let id = sel.value, now = nowMs
        saveTodos { list in try glueChange("moveTodo", [list, id, settingsJSON, delta, now]) }
        store.followTop = false
        rebuildList()
        selectRow { $0.rowId == "todo" && $0.value == id }
    }

    // ---- the due date

    func openDuePicker() {
        guard let t = currentTodo(), let core else { return }
        tasks.calDate = (t["due"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? ((try? core.glue("isoDate", [nowMs], as: String.self)) ?? "")
        store.push("todo-due")
        store.searchFocus = false
        store.filterText = ""
        rebuildList()
    }

    func calendar(_ command: KeyCommand) {
        guard let core else { return }
        switch command {
        case .calendarDays(let n): tasks.calDate = (try? core.glue("addDays", [tasks.calDate, n], as: String.self)) ?? tasks.calDate
        case .calendarMonths(let n): tasks.calDate = (try? core.glue("addMonths", [tasks.calDate, n], as: String.self)) ?? tasks.calDate
        case .calendarToday: tasks.calDate = (try? core.glue("isoDate", [nowMs], as: String.self)) ?? tasks.calDate
        case .clearDue: return pickDue("")
        case .pickDue:
            let typed = store.filterText.trimmingCharacters(in: .whitespaces)
            if typed.isEmpty { return pickDue(tasks.calDate) }
            let d = (try? core.glueJSON("parseDue", [typed, nowMs])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any] ?? [:]
            if let error = d["error"] as? String { return flashMessage(error) }
            return pickDue(d["value"] as? String ?? "")
        default: return
        }
        objectWillChange.send()
    }

    func pickDue(_ iso: String) {
        back()
        setTodo(["due": iso])
        selectRow { $0.rowId == "todo-due" }
        let when = iso.isEmpty ? "" : ((try? core?.glue("dueText", [iso, nowMs], as: String.self)) ?? "")
        flashMessage(iso.isEmpty ? "No due date" : when.prefix(1).uppercased() + when.dropFirst())
    }

    // ---- a field typed in its own view (todo-text), or in place on the task's page

    func openTodoText(_ field: String) {
        guard let t = currentTodo() else { return }
        tasks.field = field
        store.push("todo-text")
        store.filterText = "\(t[field] ?? "")"
        rebuildList()
    }

    func saveTodoText(_ text: String) {
        let field = tasks.field
        var value: Any = text.trimmingCharacters(in: .whitespaces)
        if field == "description" && (value as? String ?? "").isEmpty { return flashMessage("A task needs a description") }
        if field == "due", let core {
            let d = (try? core.glueJSON("parseDue", [value, nowMs])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any] ?? [:]
            if let error = d["error"] as? String { return flashMessage(error) }
            value = d["value"] ?? ""
        }
        back()
        setTodo([field: value])
        selectRow { $0.rowId == "todo-edit" && $0.value == field }
    }

    // What was typed in the description or notes on the task's page, kept (leaving the row, Enter,
    // going back, closing).
    func commitField() {
        guard let d = tasks.fieldDraft else { return }
        tasks.fieldDraft = nil
        guard let t = todoList.compactMap({ $0 as? [String: Any] }).first(where: { $0["id"] as? String == d.id }) else { return }
        let value = d.field == "description" ? d.text.split(whereSeparator: \.isWhitespace).joined(separator: " ") : d.text.replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression)
        if d.field == "description" && value.isEmpty { flashMessage("A task needs a description: kept the old one"); rebuildList(); return }
        if "\(t[d.field] ?? "")" == value { return }
        let now = nowMs
        saveTodos { list in try glueChange("updateTodo", [list, d.id, [d.field: value], now]) }
    }

    // Picking the paper a task is about (its page's Pick a paper…): back to the task.
    func pickTodoItem(_ row: SearchRow) {
        let parts = row.subtitle.components(separatedBy: " · ")
        let cite = parts.count > 1 && parts[1].count == 4 && Int(parts[1]) != nil ? "\(parts[0]), \(parts[1])" : ""
        back()
        setTodo(["item": ["key": row.key, "libraryID": row.libraryID, "title": row.title, "cite": cite], "context": NSNull()])
        flashMessage("About " + (cite.isEmpty ? row.title : cite))
    }

    // The rows of the task views (rebuildList's part).
    func todoViewRows(_ core: JSCore) throws -> [ListRow] {
        switch store.view {
        case "todos":
            return try core.glue("todoRows", [todoList, settingsJSON, store.filterText, Self.accentHex, nowMs], as: [ListRow].self)
        case "todo-edit":
            return try core.glue("todoEditor", [currentTodo() ?? NSNull(), settingsJSON, nowMs], as: [ListRow].self)
        case "todo-status":
            return try core.glue("statusChoice", [currentTodo() ?? NSNull(), settingsJSON], as: [ListRow].self)
        case "todo-priority":
            return try core.glue("priorityChoice", [currentTodo() ?? NSNull()], as: [ListRow].self)
        case "todo-new", "todo-text", "status-name":
            return try core.glue("entryRows", [store.view, store.filterText, settingsJSON, tasks.draft, tasks.field, tasks.statusEdit ?? NSNull(), nowMs], as: [ListRow].self)
        case "todo-tags":
            let line = store.stack.last?.filterText ?? ""
            return try core.glue("taskTagRows", [line, tasks.draft, settingsJSON, store.filterText, nowMs], as: [ListRow].self)
        case "status-menu":
            return try core.glue("statusMenuRows", [tasks.statusEdit ?? [:], todoList, settingsJSON], as: [ListRow].self)
        default:
            return [] // todo-due: the calendar is drawn on its own
        }
    }
}
