import Foundation

// Settings › Tasks (statuses by group, the actions @ offers, the default task's description) and
// Settings › Paper status: add, rename, remove, reorder (ZoteroSearch.qml:1321-1470, 1594-1602,
// 3188-3330; Service.qml:395-417).
extension LauncherModel {
    // settings.tasks with `change` merged in, saved (its keys kept in order). → saved?
    @discardableResult
    func saveTasksSetting(_ change: [String: Any]) -> Bool {
        guard let text = try? core?.glue("tasksWith", [settingsJSON, change], as: String.self) else { return false }
        return saveSetting("tasks", RawJSON(text: text), "")
    }

    // Your statuses changed: saved; a renamed one's tag renamed on the papers, a removed one's tasks
    // moved (Service.qml's saveStatuses).
    @discardableResult
    func saveStatuses(_ statuses: [Any], moveFrom: String = "", moveTo: String = "") -> Bool {
        let old = todoStatuses, oldSettings = settingsJSON
        guard saveTasksSetting(["statuses": statuses]) else { return false }
        for case let s as [String: Any] in statuses {
            if let o = old.first(where: { $0["id"] as? String == s["id"] as? String }), let was = o["name"] as? String, let now = s["name"] as? String,
               was != now, status == "ready" {
                bridge.post("/tags/rename", ["from": "t/" + was, "to": "t/" + now], timeout: 30) { _ in }
            }
        }
        if !moveFrom.isEmpty {
            let now = nowMs
            saveTodos(settingsBefore: oldSettings) { list in try glueChange("moveTasks", [list, moveFrom, moveTo, now]) }
        }
        return true
    }

    @discardableResult
    func savePaperStatuses(_ list: [String]) -> Bool {
        guard saveSetting("paperStatuses", list, "") else { return false }
        store.followTop = false
        requestSearch()
        return true
    }

    var taskActions: [String] { (try? core?.glue("taskActions", [settingsJSON], as: [String].self)) ?? [] }

    func openStatusMenu(_ edit: [String: Any]) {
        tasks.statusEdit = edit
        store.push("status-menu")
        rebuildList()
    }

    func openStatusName(_ edit: [String: Any], filter: String = "") {
        tasks.statusEdit = edit
        store.push("status-name")
        store.filterText = filter
        rebuildList()
    }

    // The status-* and pstatus-* rows, task-action(s) and task-default (ActionMap's).
    func statusAction(_ row: ListRow) {
        switch row.rowId {
        case "pstatus": openStatusMenu(["kind": "paper", "id": row.value, "name": row.label])
        case "pstatus-add": openStatusName(["kind": "paper", "mode": "add"])
        case "status": openStatusMenu(["id": row.value, "name": row.label])
        case "task-action": openStatusMenu(["kind": "action", "id": row.value, "name": row.label])
        case "task-action-add": openStatusName(["kind": "action", "mode": "add"])
        case "status-add": openStatusName(["mode": "add", "group": row.value])
        case "status-rename":
            var edit = tasks.statusEdit ?? [:]
            edit["mode"] = "rename"
            openStatusName(edit, filter: edit["name"] as? String ?? "")
        case "status-name-save": saveStatusName(row.value)
        case "status-remove": removeEditedStatus()
        case "pstatus-migrate": migratePaperStatusTags()
        case "task-default":
            let template = (try? core?.glue("defaultTemplate", [], as: String.self)) ?? ""
            settingsView.edit = ["path": "tasks.defaultTask", "label": "Default task's description", "type": "text", "current": row.value,
                                 "help": "{cite}: the paper's citation, {title}: its title; empty: " + template,
                                 "item": ["label": "Default task's description", "type": "template"], "empty": "back to " + template]
            store.push("settings-edit")
            store.filterText = row.value
            rebuildList()
        default: break
        }
    }

    func saveStatusName(_ text: String) {
        guard let core else { return }
        let e = tasks.statusEdit ?? [:]
        let adding = e["mode"] as? String == "add"
        let done = { (message: String, select: ((ListRow) -> Bool)?) in
            self.back()
            if !adding { self.back() }
            self.store.followTop = false
            self.rebuildList()
            if let select { self.selectRow(select) }
            if !message.isEmpty { self.flashMessage(message) }
        }
        switch e["kind"] as? String {
        case "action":
            let name = text.replacingOccurrences(of: "[{}]", with: "", options: .regularExpression).split(whereSeparator: \.isWhitespace).joined(separator: " ")
            if name.isEmpty { return flashMessage("Type the action") }
            var list = taskActions
            if list.contains(where: { $0.lowercased() == name.lowercased() && $0 != e["id"] as? String }) { return flashMessage("It's there already") }
            if adding { list.append(name) } else if let i = list.firstIndex(of: e["id"] as? String ?? "") { list[i] = name }
            guard saveTasksSetting(["actions": list]) else { return }
            done(adding ? "Added “\(name)”" : "Renamed") { $0.rowId == "task-action" && $0.value == name }
        case "paper":
            var list = paperStatuses
            if list.contains(where: { $0.lowercased() == text.lowercased() && $0 != e["id"] as? String }) { return flashMessage("It's there already") }
            if adding { list.append(text) } else if let i = list.firstIndex(of: e["id"] as? String ?? "") { list[i] = text }
            guard savePaperStatuses(list) else { return }
            done(adding ? "Added “\(text)”" : "", nil)
            if !adding, let was = e["id"] as? String { renameTagEverywhere("s/" + was, "s/" + text) { [weak self] in self?.requestSearch() } }
        default:
            let r = (try? core.glueJSON(adding ? "addStatusIn" : "renameStatus", adding ? [settingsJSON, text, e["group"] ?? ""] : [settingsJSON, e["id"] ?? "", text]))
                .flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any] ?? [:]
            if let error = r["error"] as? String { return flashMessage(error) }
            guard saveStatuses(r["statuses"] as? [Any] ?? []) else { return }
            done(adding ? "Added “\(text)”" : "Renamed", nil)
        }
    }

    private func removeEditedStatus() {
        guard let core else { return }
        let e = tasks.statusEdit ?? [:]
        switch e["kind"] as? String {
        case "action":
            let name = e["id"] as? String ?? ""
            let ok = saveTasksSetting(["actions": taskActions.filter { $0 != name }])
            back()
            flashMessage(ok ? "Removed the action “\(name)”" : "Not saved")
        case "paper":
            // removing it deletes its tag from every paper: asked first (Zotero's Undo can't bring it back)
            let name = e["id"] as? String ?? "", tag = "s/" + name
            back()
            askConfirm(ConfirmAsk(title: "Remove the status “\(name)”?", yes: "Remove it, and delete \(tag) from every paper", no: "Cancel (keep both)",
                                  detail: "Counting the papers…", run: { [weak self] in
                guard let self, self.savePaperStatuses(self.paperStatuses.filter { $0 != name }) else { return }
                self.forgetStatusTag(tag)
                self.deleteTagEverywhere(tag) { self.requestSearch() }
            }))
            countIntoConfirm([tag]) { n in "On \(n) \(n == 1 ? "paper" : "papers")" }
        default:
            let r = (try? core.glueJSON("removeStatus", [settingsJSON, e["id"] ?? ""])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any] ?? [:]
            if let error = r["error"] as? String { return flashMessage(error) }
            let moveTo = r["moveTo"] as? String ?? ""
            if let name = e["name"] as? String { forgetStatusTag("t/" + name) }
            let ok = saveStatuses(r["statuses"] as? [Any] ?? [], moveFrom: e["id"] as? String ?? "", moveTo: moveTo)
            back()
            let name = (r["statuses"] as? [[String: Any]])?.first { $0["id"] as? String == moveTo }?["name"] as? String ?? ""
            flashMessage(ok ? "Removed; its tasks are now \(name)" : "Not saved")
        }
    }

    private func migratePaperStatusTags() {
        let names = paperStatuses
        askConfirm(ConfirmAsk(title: "Move the status tags to s/…?", yes: "Rename them in Zotero", no: "Not now", detail: "Counting the papers…", run: { [weak self] in
            for n in names { self?.renameTagEverywhere(n, "s/" + n) { self?.requestSearch() } }
        }))
        countIntoConfirm(names) { n in names.map { "\($0) → s/\($0)" }.joined(separator: ", ") + " · \(n) \(n == 1 ? "paper" : "papers")" }
    }

    // Shift+↑/↓ in Settings › Tasks: a status within its group (past the ends, into the next), or an action.
    func moveStatusRow(_ delta: Int) {
        guard let sel = selectedListRow, let core else { return }
        if sel.rowId == "task-action" {
            var list = taskActions
            guard let i = list.firstIndex(of: sel.value), list.indices.contains(i + delta) else { return }
            list.swapAt(i, i + delta)
            guard saveTasksSetting(["actions": list]) else { return }
            store.followTop = false
            rebuildList()
            selectRow { $0.rowId == "task-action" && $0.value == sel.value }
            return
        }
        guard sel.rowId == "status", let moved = (try? core.glueJSON("moveStatus", [settingsJSON, sel.value, delta])).flatMap(Self.jsonArray) else { return }
        guard saveStatuses(moved) else { return }
        store.followTop = false
        rebuildList()
        selectRow { $0.rowId == "status" && $0.value == sel.value }
    }

    func movePaperStatusRow(_ delta: Int) {
        guard let sel = selectedListRow, sel.rowId == "pstatus" else { return }
        var list = paperStatuses
        guard let i = list.firstIndex(of: sel.value), list.indices.contains(i + delta) else { return }
        list.swapAt(i, i + delta)
        guard savePaperStatuses(list) else { return }
        store.followTop = false
        rebuildList()
        selectRow { $0.rowId == "pstatus" && $0.value == sel.value }
    }
}
