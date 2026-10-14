import Foundation

// Chats and artifacts in the launcher (macos/PLAN.md phase 8; ZoteroSearch.qml's chat and artifact cases,
// Service.qml's lists and jobs): the Chats view, a chat's menu and its rename page, a paper's artifacts and an
// artifact's menu, its change and rename pages; deleting one asks first (the conventions). The chat itself is
// its window's (ChatWindowModel).
extension LauncherModel {
    static let chatViews: Set<String> = ["chats", "chat-menu", "chat-rename", "artifact-menu", "artifact-change", "artifact-rename"]

    // ---- the lists

    func refreshChats() {
        guard runnerInstalled else { return }
        _ = once("chats") {
            runRunner(["chats", "--all"], timeout: 30) { [weak self] r in
                guard let self else { return }
                self.finished("chats") { self.refreshChats() }
                if let list = (r.json as? [String: Any])?["chats"] as? [[String: Any]] { self.chat.chats = list } else if r.missing { self.chat.chats = nil }
                self.chatListsChanged()
            }
        }
    }

    func refreshArtifacts() {
        guard runnerInstalled else { return }
        _ = once("artifacts") {
            runRunner(["artifacts", "--all"], timeout: 30) { [weak self] r in
                guard let self else { return }
                self.finished("artifacts") { self.refreshArtifacts() }
                if let list = (r.json as? [String: Any])?["artifacts"] as? [[String: Any]] {
                    self.chat.artifacts = list
                    // the artifact a menu is open on, as it is now (its version, its title): its id is its paper's own
                    if let a = self.chat.artifact { self.chat.artifact = list.first { Self.sameArtifact($0, a) } ?? a }
                }
                self.chatListsChanged()
            }
        }
    }

    private func chatListsChanged() {
        guard opened else { return }
        if store.inSearch { rebuildSearch() } else if store.view == "actions" || Self.chatViews.contains(store.view) { store.followTop = false; rebuildList() }
    }

    // An artifact's id is unique within its paper only (artifacts/<paper>_<lib>-<KEY>/<id>/).
    static func sameArtifact(_ x: [String: Any], _ y: [String: Any]) -> Bool {
        let lib = { (a: [String: Any]) in (a["libraryID"] as? Int).flatMap { $0 == 0 ? nil : $0 } ?? 1 }
        return x["id"] as? String == y["id"] as? String && x["key"] as? String == y["key"] as? String && lib(x) == lib(y)
    }

    private func samePaper(_ x: [String: Any], _ item: PaperRef) -> Bool {
        x["key"] as? String == item.key && ((x["libraryID"] as? Int).flatMap { $0 == 0 ? nil : $0 } ?? 1) == (item.libraryID == 0 ? 1 : item.libraryID)
    }

    // A paper's own, for its menu (newest first, as the runner lists them).
    func chats(of item: PaperRef) -> [[String: Any]] { (chat.chats ?? []).filter { samePaper($0, item) } }
    func artifacts(of item: PaperRef) -> [[String: Any]] { (chat.artifacts ?? []).filter { samePaper($0, item) } }

    // ---- views

    func chatViewRows(_ core: JSCore) throws -> [ListRow] {
        switch store.view {
        case "chats":
            guard runnerInstalled else { // (nothing to list, nothing to start: the way there)
                return [try core.call("Views", "listRow", [["rowId": "setup", "icon": "\u{f071}", "label": "Chat needs the AI features", "detail": "Settings › Setup installs them: Enter goes there", "available": true]], as: ListRow.self)]
            }
            return try core.glue("chatRows", [chat.chats ?? [], store.filterText, Self.accentHex], as: [ListRow].self)
        case "chat-menu": return try core.glue("chatMenuRows", [chat.menu ?? [:]], as: [ListRow].self)
        case "chat-rename": return try core.glue("renameRows", ["chat-rename-save", store.filterText], as: [ListRow].self)
        case "artifact-menu": return try core.glue("artifactMenu", [chat.artifact ?? NSNull(), NSHomeDirectory()], as: [ListRow].self)
        case "artifact-change": return try core.glue("artifactChangeRows", [chat.artifact ?? NSNull(), store.filterText, !needsSetup], as: [ListRow].self)
        default: return try core.glue("renameRows", ["art-rename-save", store.filterText], as: [ListRow].self)
        }
    }

    // ---- opening

    // Chats (Go to › Chats, c away from a paper).
    func openChats() {
        store.push("chats")
        rebuildList()
        refreshChats()
    }

    // New chat…: the paper to chat about, picked in the results.
    func pickPaperForChat() {
        guard runnerInstalled else { return flashMessage("Chat needs the AI features: Settings › Setup installs them") }
        store.push("search")
        store.pickFor = "chat"
        response = nil
        rebuildSearch()
        requestSearch()
    }

    // A paper's chat window (on a past chat, or its latest state); the launcher closes.
    func openChatWindow(_ item: PaperRef, session: String = "") {
        guard !item.key.isEmpty else { return }
        guard runnerInstalled else { return flashMessage("Chat needs the AI features: Settings › Setup installs them") }
        dismiss()
        openChat(item, session)
    }

    // c (ZoteroSearch.qml's chatKey): the highlighted paper's chat in the results, the paper's in its menu
    // and its pages; elsewhere Chats.
    func chatKey() {
        if store.inSearch, store.pickFor.isEmpty, let r = selectedSearchRow, r.kind == "item", !["note", "attachment"].contains(r.itemType) {
            return openChatWindow(PaperRef(key: r.key, libraryID: r.libraryID, title: r.title, itemType: r.itemType))
        }
        if ["actions", "notes", "files", "tags", "prompts", "note"].contains(store.view), let item = actionItem, !["note", "attachment"].contains(item.itemType),
           (details?["item"] as? [String: Any]).map({ !["note", "attachment"].contains($0["itemType"] as? String ?? "") }) ?? true {
            return openChatWindow(item)
        }
        if store.view != "chats" { openChats() }
    }

    // ⇧↵ on a chat (a paper's menu, Chats): its menu.
    func openChatMenu(_ row: ListRow) {
        setChatMenu(row)
        store.push("chat-menu")
        rebuildList()
    }

    private func setChatMenu(_ row: ListRow) {
        let item = actionItem
        chat.menu = ["id": row.value, "title": row.label, "key": row.itemKey.isEmpty ? item?.key ?? "" : row.itemKey,
                     "libraryID": row.itemKey.isEmpty ? item?.libraryID ?? 1 : row.itemLibraryID, "paper": row.itemTitle.isEmpty ? item?.title ?? "" : row.itemTitle]
    }

    // Delete on a chat's row: asked, as from its menu.
    func askDeleteChat(_ row: ListRow) {
        setChatMenu(row)
        askDeleteChat()
    }

    // Delete on an artifact's row: asked, as from its menu.
    func askDeleteArtifact(_ row: ListRow) {
        let want: [String: Any] = ["id": row.value, "key": row.itemKey.isEmpty ? actionItem?.key ?? "" : row.itemKey, "libraryID": row.itemKey.isEmpty ? actionItem?.libraryID ?? 1 : row.itemLibraryID]
        guard let a = (chat.artifacts ?? []).first(where: { Self.sameArtifact($0, want) }) else { return flashMessage("That artifact isn't there any more") }
        chat.artifact = a
        askDeleteArtifact()
    }

    // ⇧↵ (or Enter's submenu) on an artifact: its menu.
    func openArtifactMenu(_ row: ListRow) {
        let want: [String: Any] = ["id": row.value, "key": row.itemKey.isEmpty ? actionItem?.key ?? "" : row.itemKey, "libraryID": row.itemKey.isEmpty ? actionItem?.libraryID ?? 1 : row.itemLibraryID]
        guard let a = (chat.artifacts ?? []).first(where: { Self.sameArtifact($0, want) }) else { return flashMessage("That artifact isn't there any more") }
        chat.artifact = a
        store.push("artifact-menu")
        rebuildList()
    }

    private var menuChatItem: PaperRef? {
        guard let m = chat.menu, let key = m["key"] as? String, !key.isEmpty else { return nil }
        return PaperRef(key: key, libraryID: (m["libraryID"] as? Int).flatMap { $0 == 0 ? nil : $0 } ?? 1, title: m["paper"] as? String ?? "", itemType: "")
    }

    // ---- the rows' actions

    // The 19 ids of phase 8. → handled.
    func chatAction(_ row: ListRow) -> Bool {
        switch row.rowId {
        case "chat": if let item = actionItem { openChatWindow(item) }
        case "chat-new": pickPaperForChat()
        case "chat-session": if let item = actionItem { openChatWindow(item, session: row.value) }
        case "chat-open": openChatWindow(PaperRef(key: row.itemKey, libraryID: row.itemLibraryID, title: row.itemTitle, itemType: ""), session: row.value)
        case "chat-menu-open": if let item = menuChatItem { openChatWindow(item, session: chat.menu?["id"] as? String ?? "") }
        case "chat-menu-rename":
            store.push("chat-rename")
            setFilter(chat.menu?["title"] as? String ?? "")
        case "chat-rename-save": renameChat(row.value)
        case "chat-menu-delete": askDeleteChat()
        case "artifact", "art-open":
            let path = row.path.isEmpty && row.rowId == "art-open" ? chat.artifact?["view"] as? String ?? "" : row.path
            dismiss()
            if !desktop.open(path: path) { notify("Couldn't open “\(row.label)”", shown(path) + " isn't there any more") }
        case "art-change":
            store.push("artifact-change")
            rebuildList()
        case "art-change-go": changeArtifact(row.value)
        case "art-source", "art-brief":
            dismiss()
            if !desktop.openInEditor(path: row.path) { notify("Couldn't open “\(chat.artifact?["title"] as? String ?? "")”", shown(row.path) + " isn't there any more") }
        case "art-folder":
            dismiss()
            if !desktop.open(path: row.path) { notify("Couldn't open “\(chat.artifact?["title"] as? String ?? "")”'s folder", shown(row.path) + " isn't there any more") }
        case "art-undo":
            artifactJob("undo") { [weak self] ok, data, error in
                guard let self else { return }
                self.flashMessage(ok ? "Back to version \(data?["current"] as? Int ?? 0) (the later ones are kept)" : "Couldn't undo “\(self.chat.artifact?["title"] as? String ?? "")”: " + error)
            }
        case "art-rename":
            store.push("artifact-rename")
            setFilter(chat.artifact?["title"] as? String ?? "")
        case "art-rename-save":
            let old = chat.artifact?["title"] as? String ?? ""
            artifactJob("rename", title: row.value) { [weak self] ok, _, error in
                guard let self else { return }
                if ok, self.store.view == "artifact-rename" { _ = self.back(); _ = self.back() }
                self.flashMessage(ok ? "Renamed" : "Couldn't rename “\(old)”: " + error)
            }
        case "art-delete": askDeleteArtifact()
        default: return false
        }
        return true
    }

    private func renameChat(_ title: String) {
        guard let m = chat.menu, let item = menuChatItem, !title.isEmpty else { return }
        runRunner(["chat-rename", "--key", item.key, "--library", String(item.libraryID), "--session", m["id"] as? String ?? "", "--title", title], timeout: 30) { [weak self] r in
            guard let self else { return }
            if r.ok, self.store.view == "chat-rename" { _ = self.back(); _ = self.back() }
            self.flashMessage(r.ok ? "Renamed" : "Couldn't rename “\(m["title"] as? String ?? "")”: " + r.problem)
            self.refreshChats()
        }
    }

    private func askDeleteChat() {
        guard let m = chat.menu, let item = menuChatItem else { return }
        let title = m["title"] as? String ?? ""
        askConfirm(ConfirmAsk(title: "Delete the chat “\(title)”?", yes: "Delete it", no: "Keep it", detail: "It can't be undone; its answers saved as notes stay in Zotero", run: { [weak self] in
            guard let self else { return }
            self.runRunner(["chat-delete", "--key", item.key, "--library", String(item.libraryID), "--session", m["id"] as? String ?? ""], timeout: 30) { [weak self] r in
                guard let self else { return }
                if r.ok, self.store.view == "chat-menu" { _ = self.back() }
                if r.ok { self.chatDeleted(item, m["id"] as? String ?? "") } // its window leaves it
                self.flashMessage(r.ok ? "Deleted the chat “\(title)”" : "Couldn't delete “\(title)”: " + r.problem)
                self.refreshChats()
            }
        }))
    }

    private func askDeleteArtifact() {
        guard let a = chat.artifact else { return }
        let title = a["title"] as? String ?? ""
        askConfirm(ConfirmAsk(title: "Delete the artifact “\(title)”?", yes: "Delete it (all its versions)", no: "Keep it", detail: "Its folder goes, with every version and its brief", run: { [weak self] in
            self?.artifactJob("delete") { [weak self] ok, _, error in
                guard let self else { return }
                if ok {
                    self.chat.artifact = nil
                    if self.store.view == "artifact-menu" { _ = self.back() }
                }
                self.flashMessage(ok ? "Deleted the artifact “\(title)”" : "Couldn't delete “\(title)”: " + error)
            }
        }))
    }

    // Change it with AI (art-change-go): `artifact-edit`, started and left to run (a new version, in Processes).
    private func changeArtifact(_ instruction: String) {
        guard let a = chat.artifact, !instruction.isEmpty else { return }
        let started = runner.launch(runnerArgv(["artifact-edit", "--key", a["key"] as? String ?? "", "--library", String(a["libraryID"] as? Int ?? 1),
                                                "--id", a["id"] as? String ?? "", "--instruction", instruction]))
        guard started else { return flashMessage("Couldn't change “\(a["title"] as? String ?? "")”: " + RunnerResult(missing: true).problem) }
        tasksSoon()
        _ = back()
        _ = back()
        flashMessage("Changing “\(a["title"] as? String ?? "")”: it's in Processes (\(keyName("."))); the new version shows here when it's done")
    }

    // undo, rename, delete (Service.qml's artifactJob): the artifact's runner command, then the list read again.
    func artifactJob(_ action: String, title: String? = nil, _ done: @escaping @MainActor (Bool, [String: Any]?, String) -> Void) {
        guard let a = chat.artifact else { return }
        var args = ["artifact-" + action, "--key", a["key"] as? String ?? "", "--library", String(a["libraryID"] as? Int ?? 1), "--id", a["id"] as? String ?? ""]
        if let title { args += ["--title", title] }
        runRunner(args, timeout: 60) { [weak self] r in
            guard let self else { return }
            let data = r.json as? [String: Any]
            if r.ok, action != "delete", let data { self.chat.artifact = (self.chat.artifact ?? [:]).merging(data) { _, b in b } }
            done(r.ok, data, r.problem)
            self.refreshArtifacts()
        }
    }
}
