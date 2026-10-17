import Foundation

// The tag editor and a tag's menu: add, remove, create, rename and delete everywhere, make it a
// status (ZoteroSearch.qml:4296-4500).
extension LauncherModel {
    func enterTags() {
        let d = details ?? [:]
        let library = d["library"] as? [String: Any]
        let libraryID = library?["libraryID"] as? Int ?? actionItem?.libraryID ?? 1
        let cached = tags.cache[libraryID]
        store.push("tags")
        let itemTags = (try? core?.glueJSON("tagMap", [d["tags"] ?? [Any]()])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } ?? [String: Any]()
        tags.state = ["libraryID": libraryID, "tags": cached ?? [], "itemTags": itemTags,
                      "initial": (d["tags"] as? [[String: Any]] ?? []).compactMap { $0["tag"] as? String },
                      "editable": library?["editable"] as? Bool != false, "loading": cached == nil]
        rebuildList()
        guard cached == nil else { return }
        tags.serial += 1
        let serial = tags.serial
        bridge.post("/tags/list", ["libraryID": libraryID], timeout: 4) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self, serial == self.tags.serial, self.opened, self.store.view == "tags" else { return }
                if case .ok(let answer) = result {
                    let list = answer["tags"] as? [Any] ?? []
                    self.tags.cache[libraryID] = list
                    self.tags.state?["tags"] = list
                    self.tags.state?["loading"] = false
                    if answer["editable"] as? Bool == false { self.tags.state?["editable"] = false }
                } else {
                    self.tags.state?["loading"] = false
                    self.lastError = "Couldn't load the tags: \(result.message)"
                }
                self.rebuildList()
            }
        }
    }

    // Enter on a tag: added or removed (shown at once, undone if Zotero refuses); `create`: the typed
    // name as a new tag. Either way the filter clears for the next tag (ZoteroSearch.qml:4430).
    func toggleTag(_ raw: String, create: Bool) {
        let name = raw.trimmingCharacters(in: .whitespaces)
        guard var st = tags.state, !name.isEmpty, let item = actionItem else { return }
        if st["editable"] as? Bool == false { lastError = "This library is read-only"; return }
        var itemTags = st["itemTags"] as? [String: Any] ?? [:]
        let on = itemTags[name] != nil
        if create && on {
            flashMessage("“\(name)” is already on this item")
            return clearFilterKeeping(name)
        }
        let adding = !on
        let before = itemTags
        if adding { itemTags[name] = 0 } else { itemTags[name] = nil }
        var list = st["tags"] as? [[String: Any]] ?? []
        if let k = list.firstIndex(where: { $0["tag"] as? String == name }) {
            list[k]["count"] = max(0, (list[k]["count"] as? Int ?? 0) + (adding ? 1 : -1))
        } else if adding {
            list.append(["tag": name, "types": [0], "count": 1, "color": NSNull(), "position": NSNull()])
        }
        st["itemTags"] = itemTags
        st["tags"] = list
        tags.state = st
        if let lib = st["libraryID"] as? Int { tags.cache[lib] = list }
        libraryChanged = true
        lastError = ""
        tags.pending += 1
        updateTags(item.json, add: adding ? [name] : [], remove: adding ? [] : [name]) { [weak self] result in
            guard let self else { return }
            self.tags.pending -= 1
            let here = self.opened && self.actionItem == item
            if case .ok(let answer) = result {
                if here, self.details != nil, let now = answer["tags"] as? [Any] {
                    self.details?["tags"] = now
                    self.details?["tagCount"] = now.count
                    if self.tags.pending == 0 && self.store.view == "tags",
                       let map = (try? self.core?.glueJSON("tagMap", [now])).flatMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }) {
                        self.tags.state?["itemTags"] = map
                        self.refreshTagRows()
                    }
                }
                if here { self.flashMessage((adding ? "Added “" : "Removed “") + name + "”") }
            } else if here {
                if self.store.view == "tags" {
                    var cur = self.tags.state?["itemTags"] as? [String: Any] ?? [:]
                    cur[name] = adding ? nil : before[name]
                    self.tags.state?["itemTags"] = cur
                    self.refreshTagRows()
                }
                self.lastError = "Couldn't \(adding ? "add" : "remove") “\(name)”: \(result.message)"
            }
        }
        clearFilterKeeping(name)
    }

    private func clearFilterKeeping(_ name: String) {
        store.filterText = ""
        store.followTop = false
        rebuildList()
        selectRow { $0.rowId == "tag" && $0.tag == name }
    }

    // The tag rows again, the same filter, the cursor on its tag.
    func refreshTagRows() {
        let current = selectedListRow?.tag ?? ""
        let follow = store.followTop
        store.followTop = false
        rebuildList()
        store.followTop = follow
        if !current.isEmpty { selectRow { $0.tag == current } }
    }

    // Shift+Enter on a tag: rename it, delete it, make it a status.
    func openTagMenu(_ name: String) {
        tags.menuName = name
        store.push("tag-menu")
        rebuildList()
    }

    // In every library (Zotero away: once it's back, LauncherModel+TagQueue). `done` runs whatever happened, so a chain
    // of renames goes on past one that failed.
    func renameTagEverywhere(_ from: String, _ to: String, then done: (() -> Void)? = nil) {
        sendTagOp(PendingTagOp(op: "rename", from: from, to: to)) { [weak self] answer in
            if let self, let answer {
                let n = answer["count"] as? Int ?? 0, left = answer["left"] as? Int ?? 0
                self.flashMessage("Renamed on \(n) \(n == 1 ? "paper" : "papers"): \(from) → \(to)" + (left > 0 ? " (\(left) still had it: try again)" : ""))
            }
            done?()
        }
    }

    func deleteTagEverywhere(_ name: String, then done: (() -> Void)? = nil) {
        sendTagOp(PendingTagOp(op: "delete", from: name)) { [weak self] answer in
            if let self, let answer {
                let n = answer["count"] as? Int ?? 0, left = answer["left"] as? Int ?? 0
                self.flashMessage("Deleted “\(name)” from \(n) \(n == 1 ? "paper" : "papers")" + (left > 0 ? " (\(left) still have it: try again)" : ""))
            }
            done?()
        }
    }

    // How many papers carry these tags, into the open question's detail.
    func countIntoConfirm(_ names: [String], _ say: @escaping (Int) -> String) {
        var total = 0, left = names.count
        for name in names {
            bridge.post("/tags/count", ["name": name], timeout: 8) { [weak self] result in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    if case .ok(let answer) = result { total += answer["count"] as? Int ?? 0 }
                    left -= 1
                    guard left == 0, self.confirmAsk != nil, self.store.view == "confirm" else { return }
                    self.confirmAsk?.detail = say(total)
                    self.rebuildList()
                }
            }
        }
    }

    // After a rename or delete: the library's tags again, and this paper's.
    func reloadTagEditor(_ from: String, _ to: String) {
        guard var st = tags.state else { return }
        var itemTags = st["itemTags"] as? [String: Any] ?? [:]
        if itemTags[from] != nil {
            itemTags[from] = nil
            if !to.isEmpty { itemTags[to] = 0 }
        }
        st["itemTags"] = itemTags
        st["loading"] = true
        tags.state = st
        let lib = st["libraryID"] as? Int ?? 1
        bridge.post("/tags/list", ["libraryID": lib], timeout: 4) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self else { return }
                if case .ok(let answer) = result, self.tags.state != nil {
                    let list = answer["tags"] as? [Any] ?? []
                    self.tags.cache[lib] = list
                    self.tags.state?["tags"] = list
                    self.tags.state?["loading"] = false
                }
                if self.store.view == "tags" { self.rebuildList() }
            }
        }
    }

    // A tag turned into a status: kind "paper" or "task"; target "" for a new status named after it,
    // else the paper status's name or the task status's id to merge into (ZoteroSearch.qml:4344).
    func convertTag(_ kind: String, _ tag: String, _ target: String) {
        guard let core else { return }
        let paper = kind == "paper"
        let statuses = todoStatuses
        let name = paper ? (target.isEmpty ? tag : target) : (target.isEmpty ? tag : statuses.first { $0["id"] as? String == target }?["name"] as? String ?? tag)
        let into = (paper ? "s/" : "t/") + name
        back()
        back()
        let ask = ConfirmAsk(title: "“\(tag)” → \(into)?", yes: target.isEmpty ? "Make it the \(paper ? "paper" : "task") status “\(name)”" : "Merge it into “\(name)”",
                             no: "Cancel", detail: "Counting the papers…", run: { [weak self] in
            guard let self else { return }
            let renamed = { self.renameTagEverywhere(tag, into) { self.reloadTagEditor(tag, into); self.requestSearch() } }
            if paper {
                if target.isEmpty, !self.saveSetting("paperStatuses", self.paperStatuses + [tag], "") { return }
                return renamed()
            }
            var statusId = target
            if target.isEmpty {
                let added = (try? core.glueJSON("tasksWithStatus", [self.settingsJSON, tag, "backlog"])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any] ?? [:]
                if let error = added["error"] as? String { return self.flashMessage(error) }
                if !self.saveSetting("tasks", RawJSON(text: added["tasksText"] as? String ?? "{}"), "") { return }
                statusId = (added["status"] as? [String: Any])?["id"] as? String ?? ""
            }
            // each paper with the tag: its default task in that status (its t/ tag follows), then the tag renamed
            self.bridge.post("/tags/items", ["name": tag], timeout: 15) { result in
                MainActor.assumeIsolated {
                    guard case .ok(let answer) = result else { return self.flashMessage("Couldn't list its papers: \(result.message)") }
                    for it in answer["items"] as? [[String: Any]] ?? [] {
                        let creator = it["creator"] as? String ?? "", year = it["year"].map { "\($0)" } ?? ""
                        let item: [String: Any] = ["key": it["key"] ?? "", "libraryID": it["libraryID"] ?? 1, "title": it["title"] ?? "",
                                                   "cite": !creator.isEmpty && !year.isEmpty ? "\(creator) (\(year))" : ""]
                        self.marks.taskPending["\(item["libraryID"] ?? 1):\(item["key"] ?? "")"] = (item, statusId)
                    }
                    self.flushDefaultTasks()
                    renamed()
                }
            }
        })
        askConfirm(ask)
        countIntoConfirm([tag]) { n in
            "On \(n) \(n == 1 ? "paper" : "papers")" + (paper ? "" : ": each gets its default task in \(name) (made where it has none)") + "; renamed in Zotero"
        }
    }

    // The tag rows for the views of this file (rebuildList's part).
    func tagViewRows(_ core: JSCore) throws -> [ListRow] {
        switch store.view {
        case "tags":
            guard let st = tags.state else { return [] }
            return try core.glue("tagRows", [st, store.filterText, Self.accentHex], as: [ListRow].self)
        case "tag-menu":
            return try core.glue("tagMenuRows", [tags.menuName], as: [ListRow].self)
        case "tag-name":
            return try core.glue("tagNameRows", [tags.menuName, store.filterText], as: [ListRow].self)
        case "tag-status":
            return try core.glue("tagStatusRows", [tags.statusKind, tags.menuName, paperStatuses, todoStatuses], as: [ListRow].self)
        default:
            return []
        }
    }
}
