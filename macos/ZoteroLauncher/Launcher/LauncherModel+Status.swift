import Foundation

// A paper's status (⌥→/←, ZoteroSearch.qml:2689-2810) and its default task (⇧⌥→/←, 2812-2860):
// shown at once, saved to Zotero (and todos.json) a second after the last press, so a few presses
// make one change.
extension LauncherModel {
    var paperStatuses: [String] { settings?.values.paperStatuses ?? [] }
    var paperStatusTags: [String] { paperStatuses.map { "s/" + $0 } }
    var todoStatuses: [[String: Any]] { (core.flatMap { try? $0.glueJSON("todoStatuses", [settingsJSON]) }).flatMap(Self.jsonArray) ?? [] }

    var paperInMenu: Bool {
        let type = (details?["item"] as? [String: Any])?["itemType"] as? String
        return type != nil && type != "note" && type != "attachment"
    }

    // The paper whose menu (or note) this is, as the runner and todos want it.
    var actionItemRef: [String: Any]? {
        guard let item = actionItem else { return nil }
        let paper = details?["paper"] as? [String: Any]
        let cite = paper.flatMap { (try? core?.glue("paperCite", [$0], as: String.self)) ?? "" } ?? ""
        return ["key": item.key, "libraryID": item.libraryID, "title": (paper?["title"] as? String) ?? item.title, "cite": cite]
    }

    // The paper's status as shown: changed here, else its tags'.
    func menuPaperStatus() -> String {
        guard let item = actionItem else { return "" }
        if let shown = marks.statusShown[item.id] { return shown }
        return (try? core?.glue("paperStatusOf", [details?["tags"] ?? [Any](), paperStatusTags], as: String.self)) ?? ""
    }

    // The paper ⌥→/← changes: the highlighted result, or the paper whose menu (or note) this is.
    func statusTarget() -> (item: [String: Any], current: String, index: Int)? {
        if store.inSearch {
            guard store.pickFor.isEmpty, let r = selectedSearchRow, r.kind == "item", !["note", "attachment"].contains(r.itemType) else { return nil }
            return (["key": r.key, "libraryID": r.libraryID], marks.statusShown["\(r.libraryID):\(r.key)"] ?? r.status, store.selectedIndex)
        }
        guard store.view == "actions" || (store.inNote && notePaperInView), let item = actionItem, paperInMenu else { return nil }
        return (["key": item.key, "libraryID": item.libraryID], menuPaperStatus(), -1)
    }

    @discardableResult
    func cyclePaperStatus(_ delta: Int) -> Bool {
        guard let t = statusTarget(), let core else { return false }
        if paperStatuses.isEmpty { flashMessage("No paper statuses: add some in Settings › Paper status"); return true }
        if t.current == "\u{0}" { flashMessage("Update the Zotero Omarchy Bridge to see and change statuses (Settings › Setup)"); return true }
        let id = "\(t.item["libraryID"] ?? 1):\(t.item["key"] ?? "")"
        let next = (try? core.glue("nextPaperStatus", [paperStatusTags, t.current, delta], as: String.self)) ?? ""
        marks.statusShown[id] = next
        marks.statusPending[id] = (t.item, marks.statusPending[id]?.from ?? t.current, next)
        if t.index >= 0, case .search(var rows) = content, rows.indices.contains(t.index) {
            rows[t.index].status = next
            content = .search(rows)
        } else if !store.inNote {
            store.followTop = false
            rebuildList()
        }
        statusTimer?.invalidate()
        statusTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: false) { [weak self] _ in MainActor.assumeIsolated { self?.flushStatuses() } }
        let name = (try? core.glue("statusName", [next], as: String.self)) ?? ""
        flashMessage("Status: " + (name.isEmpty ? "none" : name))
        return true
    }

    // Each paper loses its old status tag and gets the new one (Service.qml's changePaperStatus).
    func flushStatuses() {
        let pending = marks.statusPending
        marks.statusPending = [:]
        for (id, p) in pending {
            let add = !p.to.isEmpty && p.to.lowercased() != p.from.lowercased() ? [p.to] : []
            // its old status, and any other status tag it carries (two, from elsewhere: it keeps one)
            var remove = !p.from.isEmpty && p.from != "\u{0}" && p.from.lowercased() != p.to.lowercased() ? [p.from] : []
            if !add.isEmpty || !remove.isEmpty {
                let carried = otherStatusTags(of: p.item).filter { t in t.lowercased() != p.to.lowercased() && !remove.contains { $0.lowercased() == t.lowercased() } }
                remove += carried
            }
            if add.isEmpty && remove.isEmpty { continue }
            updateTags(p.item, add: add, remove: remove) { [weak self] result in
                guard let self else { return }
                if case .ok(let answer) = result { self.libraryChanged = true; self.paperTagsSaved(p.item, answer); return }
                self.marks.statusShown[id] = nil
                self.flashMessage("Couldn't save the status: \(result.message)")
                if self.store.inSearch { self.rebuildSearch() } else { self.rebuildList() }
            }
        }
    }

    // The status tags a paper may carry: the paper in view's own (any s/ tag), else every status's (from the results:
    // their tags aren't loaded; taking off one it doesn't have changes nothing).
    func otherStatusTags(of item: [String: Any]) -> [String] {
        guard let shown = actionItem, shown.key == item["key"] as? String, shown.libraryID == (item["libraryID"] as? Int ?? 1),
              let tags = details?["tags"] as? [[String: Any]] else { return paperStatusTags }
        return tags.compactMap { $0["tag"] as? String }.filter { $0.lowercased().hasPrefix("s/") }
    }

    func updateTags(_ item: [String: Any], add: [String], remove: [String], done: @escaping (BridgeResult) -> Void) {
        bridge.post("/tags/update", ["key": item["key"] ?? "", "libraryID": item["libraryID"] ?? 1, "add": add, "remove": remove], timeout: 8) { result in
            MainActor.assumeIsolated { done(result) }
        }
    }

    // ---- the default task

    // Every paper's default task status, the presses not yet saved included: "<lib>:<key>" → status.
    var defaultTasks: [String: [String: Any]] {
        guard let core else { return [:] }
        let statuses = todoStatuses
        var out = ((try? core.glueJSON("defaultTasks", [todos?.todos ?? [], statuses])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: [String: Any]]) ?? [:]
        for (id, status) in marks.taskShown { out[id] = statuses.first { $0["id"] as? String == status } }
        return out
    }

    func taskTarget() -> (item: [String: Any], id: String)? {
        if store.inSearch {
            guard store.pickFor.isEmpty, let r = selectedSearchRow, r.kind == "item", !["note", "attachment"].contains(r.itemType) else { return nil }
            let parts = r.subtitle.components(separatedBy: " · ")
            let cite = parts.count > 1 && parts[1].count == 4 && Int(parts[1]) != nil ? "\(parts[0]) (\(parts[1]))" : ""
            return (["key": r.key, "libraryID": r.libraryID, "title": r.title, "cite": cite], "\(r.libraryID):\(r.key)")
        }
        guard store.view == "actions" || (store.inNote && notePaperInView), paperInMenu, let it = actionItemRef, let item = actionItem else { return nil }
        return (it, item.id)
    }

    @discardableResult
    func cycleDefaultTask(_ delta: Int) -> Bool {
        guard let t = taskTarget(), let core else { return false }
        let statuses = todoStatuses
        let current = defaultTasks[t.id]
        let next = (try? core.glue("nextDefaultStatus", [statuses, current?["id"] as? String ?? "", delta], as: String.self)) ?? ""
        if next.isEmpty { return true }
        marks.taskShown[t.id] = next
        marks.taskPending[t.id] = (t.item, next)
        if !store.inSearch && !store.inNote {
            store.followTop = false
            rebuildList()
        }
        taskTimer?.invalidate()
        taskTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: false) { [weak self] _ in MainActor.assumeIsolated { self?.flushDefaultTasks() } }
        let name = statuses.first { $0["id"] as? String == next }?["name"] as? String ?? next
        if current != nil {
            flashMessage("Task: " + name)
        } else {
            let description = (try? core.glue("defaultTaskDescription", [settingsJSON, t.item], as: String.self)) ?? ""
            flashMessage("New task, “\(description)”: \(name)")
        }
        return true
    }

    // Each paper's default task made or moved, saved once; its t/ tags follow (Service.qml:305).
    func flushDefaultTasks(now: Date = Date()) {
        let pending = marks.taskPending
        marks.taskPending = [:]
        guard !pending.isEmpty, let core, var file = todos else { return }
        let changes = pending.values.map { ["item": $0.item, "status": $0.status] as [String: Any] }
        var tagChanges: [[String: Any]] = []
        saved {
            let answer = try file.update(core) { list in
                let json = try core.glueJSON("setDefaultTasks", [list, changes, settingsJSON, now.timeIntervalSince1970 * 1000])
                let object = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] ?? [:]
                return (object["text"] as? String ?? "", object["todos"] as? [Any] ?? [], object)
            }
            tagChanges = answer["tags"] as? [[String: Any]] ?? []
            todos = file
        }
        for id in pending.keys where marks.taskPending[id] == nil { marks.taskShown[id] = nil }
        guard status == "ready" else { tasks.missedTaskTags += tagChanges; return } // Zotero gets them when it's back (catchUpTags)
        for change in tagChanges {
            guard let item = change["item"] as? [String: Any] else { continue }
            updateTags(item, add: change["add"] as? [String] ?? [], remove: change["remove"] as? [String] ?? []) { [weak self] result in
                if case .ok(let answer) = result { self?.paperTagsSaved(item, answer) }
                else { NSLog("ZoteroLauncher: task tags for %@: %@", item["key"] as? String ?? "", result.message) }
            }
        }
    }

    // Zotero's answer to a tag change: the paper's tags as they are now, kept when it's the paper in view (its tags,
    // its status and taxonomy pills, the tag editor read them; they kept the tags from before the change).
    func paperTagsSaved(_ item: [String: Any], _ answer: [String: Any]) {
        guard let now = answer["tags"] as? [Any], details != nil, let shown = actionItem,
              shown.key == item["key"] as? String, shown.libraryID == (item["libraryID"] as? Int ?? 1) else { return }
        details?["tags"] = now
        details?["tagCount"] = now.count
        if opened, !store.inSearch { store.followTop = false; rebuildList() }
    }

    // The default task row's extras for the menu (ZoteroSearch.qml's defaultTaskExtra).
    func defaultTaskExtra() -> [String: Any]? {
        guard let it = actionItemRef, let item = actionItem, let core else { return nil }
        let status = defaultTasks[item.id]?["name"] as? String ?? ""
        let description = (try? core.glue("defaultTaskDescription", [settingsJSON, it], as: String.self)) ?? ""
        return ["status": status, "statuses": todoStatuses.compactMap { $0["name"] as? String }, "description": description]
    }
}
