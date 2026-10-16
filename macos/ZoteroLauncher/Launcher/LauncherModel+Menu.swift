import AppKit
import Foundation
import UniformTypeIdentifiers

// A paper's menu and the views under it (ZoteroSearch.qml:899-1162, 2706-2775, 3928-3945,
// 4266-4279): entering it, its rows, its files, a question, and what its rows do.
extension LauncherModel {
    // Tab, Enter or → on a result (ZoteroSearch.qml:1001).
    func enterActions(_ index: Int, quick: String = "") {
        guard searchRows.indices.contains(index) else { return }
        let row = searchRows[index]
        if row.kind == "collection" || row.kind == "tag" {
            if quick.isEmpty { openCollection(row) } // the paper letters are for papers
            return
        }
        if store.pickFor == "todo" {
            if quick.isEmpty && row.kind == "item" { pickTodoItem(row) }
            return
        }
        if store.pickFor == "chat" { // New chat…: the paper picked
            if quick.isEmpty && row.kind == "item" && !["note", "attachment"].contains(row.itemType) {
                openChatWindow(PaperRef(key: row.key, libraryID: row.libraryID, title: row.title, itemType: row.itemType))
            }
            return
        }
        if row.kind == "note-child" {
            if quick.isEmpty { openNoteView(["key": row.key, "libraryID": row.libraryID, "title": row.title]) }
            return
        }
        if row.kind == "setting" {
            if quick.isEmpty { openSettingAt(row.key) }
            return
        }
        if row.kind == "saved-search" { // its papers, as from the saved searches list
            if quick.isEmpty { openSavedSearch(savedSearch(String(row.key.dropFirst("saved-search:".count)))) }
            return
        }
        if Self.goToPlaces.contains(row.kind) {
            if quick.isEmpty { openPlace(row.kind) } // the paper letters are for papers
            return
        }
        guard row.kind == "item" else { return }
        enterActionsFor(PaperRef(key: row.key, libraryID: row.libraryID, title: row.title, itemType: row.itemType), quick: quick)
    }

    // The paper's menu, its details asked of Zotero (ZoteroSearch.qml:1107).
    func enterActionsFor(_ item: PaperRef, quick: String = "", select: ((ListRow) -> Bool)? = nil) {
        if actionItem?.key != item.key || actionItem?.libraryID != item.libraryID { // the last paper's taxonomy status isn't this one's
            tax.status = nil
            tax.statusSerial += 1
            tax.statusThen = nil
        }
        actionItem = item
        pendingSelect = select
        details = nil
        quickAction = quick
        lastError = ""
        store.push("actions")
        rebuildList()
        refreshPrompts() // its Prompts row (and the models it names) as they are now
        refreshModels()
        ai.tasksRead = Date()
        detailsSerial += 1
        let serial = detailsSerial
        bridge.post("/item", ["key": item.key, "libraryID": item.libraryID], timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self, serial == self.detailsSerial, self.opened, !self.store.inSearch else { return }
                if case .ok(let answer) = result {
                    self.details = answer
                    self.loadCitePreview()
                    self.paperOpened() // its text, when Defaults says so
                } else {
                    if case .timeout = result { self.lastError = "Zotero didn't answer in time" } else { self.lastError = result.message }
                    self.quickAction = ""
                }
                if self.store.view == "actions" { self.rebuildList() }
                if self.store.view == "actions", let select = self.pendingSelect {
                    self.store.followTop = false
                    self.selectRow(select)
                }
                self.pendingSelect = nil
                if !self.quickAction.isEmpty { self.runQuick() }
            }
        }
    }

    // The paper's details again, keeping the view and the row (ZoteroSearch.qml:413).
    func refreshDetails() {
        guard let item = actionItem else { return }
        detailsSerial += 1
        let serial = detailsSerial
        bridge.post("/item", ["key": item.key, "libraryID": item.libraryID], timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self, serial == self.detailsSerial, self.opened, case .ok(let answer) = result else { return }
                self.details = answer
                if ["actions", "files", "notes", "extract-menu", "tax-paper", "tax-audit"].contains(self.store.view) {
                    self.store.followTop = false
                    self.rebuildList()
                }
            }
        }
    }

    // o / w once the details are known: one file acts at once, several get the picker, none
    // stays on the row that says why (ZoteroSearch.qml:1146).
    func runQuick() {
        let kind = quickAction
        quickAction = ""
        if kind == "notes" { return enterNotes() }
        if kind == "tags" { return enterTags() }
        let usable = (try? core?.glueJSON("usableFiles", [details ?? NSNull(), kind])).flatMap { Self.jsonArray($0) } ?? []
        if usable.count == 1 {
            finish(kind, attachment: usable[0])
        } else if usable.count > 1 {
            filePurpose = kind
            store.push("files")
            rebuildList()
        } else {
            selectRow { $0.rowId == kind }
            store.followTop = false
        }
    }

    // A list view's rows (ZoteroSearch.qml:899): the menu, the files, the question.
    func rebuildList() {
        guard let core else { return }
        let keep = store.selectedIndex
        var rows: [ListRow] = []
        do {
            switch store.view {
            case "note":
                rows = []
            case "notes":
                rows = try core.glue("noteRows", [details ?? NSNull(), store.filterText, Self.accentHex, noteOrder], as: [ListRow].self)
            case "tags", "tag-menu", "tag-name", "tag-status":
                rows = try tagViewRows(core)
            case "settings-tasks":
                rows = try core.glue("statusSettings", [settingsJSON, todoList, store.filterText], as: [ListRow].self)
            case let view where view.hasPrefix("settings"):
                rows = try settingsRows(core)
            case "todos", "todo-edit", "todo-status", "todo-priority", "todo-new", "todo-text", "status-name", "todo-tags", "status-menu", "todo-due":
                rows = try todoViewRows(core)
            case "files":
                rows = try core.glue("fileRows", [details ?? NSNull(), filePurpose, store.filterText], as: [ListRow].self)
            case "searches", "search-menu", "search-edit", "picker", "picker-values":
                rows = try searchViewRows(core)
            case "prompts", "prompt-edit", "prompt-title", "prompt-model", "prompt-effort", "prompt-output":
                rows = try promptViewRows(core)
            case "tasks":
                rows = try core.glue("taskRows", [processesAndPending, store.filterText, Self.accentHex, nowMs], as: [ListRow].self)
            case "extract-menu":
                rows = try core.glue("extractMenu", [details ?? NSNull(), ai.prompts == nil], as: [ListRow].self)
            case "confirm":
                rows = try core.glue("confirmRows", [confirmAsk?.json ?? NSNull()], as: [ListRow].self)
            case let view where Self.chatViews.contains(view):
                rows = try chatViewRows(core)
            case "tax-paper", "tax-audit":
                rows = try classifyViewRows(core)
            case "keys":
                rows = try core.glue("keyRows", [store.filterText, keysHere ?? NSNull()], as: [ListRow].self)
            default:
                let menu = try core.glue("menu", [menuArguments()], as: MenuRows.self)
                menuRows = menu.ordered
                rows = menu.rows
            }
        } catch {
            lastError = String(describing: error)
        }
        // typing in a menu finds settings too, below its own rows (not on pages for typing, nor in Settings)
        if !store.filterText.trimmingCharacters(in: .whitespaces).isEmpty && !store.inSettings && !store.typingView && !["keys", "confirm", "todo-due"].contains(store.view),
           let more = try? core.glue("settingMenuRows", [store.filterText, settingsIndex], as: [ListRow].self) {
            rows += more
        }
        content = .list(rows)
        store.selectedIndex = store.followTop ? Self.firstRow(rows) : max(0, min(rows.count - 1, keep))
        refreshPaperPills()
    }

    // Where the cursor starts in a list (ZoteroSearch.qml's firstRowFor): the top, except in
    // Processes (Clear finished heads it: the first process) and in Tasks while searching them (the
    // quick add heads it: the first match).
    static func firstRow(_ rows: [ListRow]) -> Int {
        guard rows.count > 1 else { return 0 }
        if rows[0].rowId == "todo-quick" && rows[1].rowId == "todo" { return 1 }
        return rows[0].rowId == "tasks-clear" ? 1 : 0
    }

    private func menuArguments() -> [String: Any] {
        let view = store.view
        let paper = (details?["item"] as? [String: Any]).map { !["note", "attachment"].contains($0["itemType"] as? String ?? "") } ?? false
        var extras: [String: Any] = ["statusTags": paperStatuses, "noteOrder": noteOrder, "extracting": actionItem.map(extracting) ?? false]
        extras.merge(taxonomyExtras) { _, b in b } // its taxonomy rows
        if let item = actionItem { // its chats and artifacts (ZoteroSearch.qml's actionExtras)
            extras["chats"] = chats(of: item)
            extras["artifacts"] = artifacts(of: item)
        }
        if paper {
            if let it = actionItem { extras["leftAlone"] = extractFile?.skipped["\(it.libraryID == 0 ? 1 : it.libraryID):\(it.key)"] as? String ?? "" }
            extras["cite"] = citeExtra()
            extras["paperStatus"] = (try? core?.glue("statusName", [menuPaperStatus()], as: String.self)) ?? ""
            extras["defaultTask"] = defaultTaskExtra() ?? NSNull()
        }
        let pinned = actionItem.map { item in (try? core?.glue("isPinned", [(pins?.pins ?? []).map(\.json), item.json], as: Bool.self)) ?? false } ?? false
        let order = prefs?.menuOrder(view) ?? [:]
        let sections = prefs?.sectionOrder(view) ?? []
        var todoRows: [Any] = []
        if paper, let item = actionItem, let core {
            todoRows = (try? core.glueJSON("itemTodoRows", [todoList, ["key": item.key, "libraryID": item.libraryID], settingsJSON, nowMs])).flatMap(Self.jsonArray) ?? []
        }
        return ["details": details ?? NSNull(), "viewerName": Self.pdfViewerName, "todoRows": todoRows, "prompts": ai.promptsJSON, "promptsProblem": ai.promptsProblem,
                "pinned": pinned, "setup": needsSetup, "extras": extras,
                "order": order.isEmpty ? NSNull() : order, "pins": prefs?.menuPins(view) ?? [], "others": prefs?.menuOther(view) ?? [],
                "sections": sections.isEmpty ? NSNull() : sections, "filter": store.filterText]
    }

    // The highlighted row becomes the first that passes `test` (ZoteroSearch.qml:988).
    @discardableResult
    func selectRow(_ test: (ListRow) -> Bool) -> Bool {
        guard let i = listRows.firstIndex(where: test) else { return false }
        store.selectedIndex = i
        return true
    }

    // Enter on a list row (ZoteroSearch.qml:1164): its rowId's action, if the row is available.
    func activateAction(_ index: Int) {
        // no tasks yet: Enter starts one, as the hint says ("↵ new task, or just type it")
        if store.view == "todos" && listRows.isEmpty { _ = startNewTodo([:]); return }
        guard listRows.indices.contains(index) else { return }
        let row = listRows[index]
        guard row.available else { return }
        // a taxonomy form's field, Ask the AI: typed on Settings' typing page (not row ids of the QML's actions)
        if ["tax-field", "tax-label-field", "tax-ai-ask"].contains(row.rowId) { return openTaxonomyField(row) }
        if let handler = ActionMap.handlers[row.rowId] { handler(self, row) }
        else if !ActionMap.inert.contains(row.rowId) { notYet("what this row does") } // (an inert row does nothing, without a word)
    }

    // Close the launcher first (Zotero or the viewer takes focus), then act (ZoteroSearch.qml:3928).
    func finish(_ kind: String, attachment: [String: Any]?) {
        let item = actionItem
        dismiss()
        switch kind {
        case "open", "reveal":
            guard let item else { return }
            bridge.post(kind == "open" ? "/open" : "/reveal", ["key": item.key, "libraryID": item.libraryID], timeout: 8) { [weak self] result in
                MainActor.assumeIsolated { self?.afterZotero(result, "Couldn't \(kind == "open" ? "open" : "show") “\(item.title)”") }
            }
        case "external":
            guard let att = attachment else { return }
            bridge.post("/attachment", ["key": att["key"] ?? "", "libraryID": att["libraryID"] ?? 1, "target": "path"], timeout: 4) { [weak self] result in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    if case .ok(let answer) = result, let path = answer["path"] as? String {
                        if !self.desktop.open(path: path) { self.notify("Couldn't open the file", path) }
                    } else {
                        self.notify("Couldn't open the file", result.message)
                    }
                }
            }
        case "window":
            guard let att = attachment else { return }
            bridge.post("/attachment", ["key": att["key"] ?? "", "libraryID": att["libraryID"] ?? 1, "target": "window"], timeout: 8) { [weak self] result in
                MainActor.assumeIsolated { self?.afterZotero(result, "Couldn't open a Zotero window") }
            }
        default:
            break
        }
    }

    private func afterZotero(_ result: BridgeResult, _ failure: String) {
        switch result {
        case .ok: desktop.activateZotero()
        case .zoteroDown, .noHandshake: desktop.launchZotero()
        default: notify(failure, result.message)
        }
    }

    // Something failed after the launcher closed (a PDF, a note in Zotero, a sync): there is no
    // footer then, so it is said when the launcher opens next (the QML posts a notification).
    func notify(_ title: String, _ detail: String) {
        NSLog("ZoteroLauncher: %@: %@", title, detail)
        let text = detail.isEmpty ? title : "\(title): \(detail)"
        if opened { return flashMessage(text) }
        laterNote = text
    }

    // Pin or unpin a paper, collection or tag (ZoteroSearch.qml:2555).
    func togglePin(_ item: [String: Any]) {
        guard let core, var file = pins else { return }
        let was = (try? core.glue("isPinned", [file.pins.map(\.json), item], as: Bool.self)) ?? false
        saved {
            try file.update(core) { try core.glue("togglePin", [$0.map(\.json), item], as: [Pin].self) }
            pins = file
            libraryChanged = true
            flashMessage(was ? "Unpinned" : "Pinned to the top")
        }
    }

    // A question first (ZoteroSearch.qml:4266).
    func askConfirm(_ ask: ConfirmAsk) {
        confirmAsk = ask
        store.push("confirm")
        store.searchFocus = false
        rebuildList()
    }

    // ---- citations (ZoteroSearch.qml:2706-2775)

    // The paper i / r cites: the highlighted result, or the paper whose menu this is.
    func citeTarget() -> PaperRef? {
        if store.inSearch {
            guard store.pickFor.isEmpty, let r = selectedSearchRow, r.kind == "item", !["note", "attachment"].contains(r.itemType) else { return nil }
            return PaperRef(key: r.key, libraryID: r.libraryID, title: r.title, itemType: r.itemType)
        }
        guard ["actions", "files"].contains(store.view), let item = actionItem,
              let type = (details?["item"] as? [String: Any])?["itemType"] as? String, !["note", "attachment"].contains(type)
        else { return nil }
        return item
    }

    var citationStyle: String {
        (try? core?.glue("citationStyle", [settingsJSON], as: String.self)) ?? "apa"
    }

    func loadCitePreview() {
        guard let item = citeTarget(), !store.inSearch else { return }
        let style = citationStyle
        if let p = citePreview, p.id == item.id, p.style == style, p.error.isEmpty { return }
        citePreview = CitePreview(id: item.id, style: style)
        for mode in ["citation", "bibliography"] {
            cite(item, mode, style) { [weak self] text, error in
                guard let self, var next = self.citePreview, next.id == item.id, next.style == style else { return }
                if let text { if mode == "citation" { next.citation = text } else { next.bibliography = text } }
                else { next.error = error }
                self.citePreview = next
                if self.store.view == "actions" {
                    self.store.followTop = false
                    self.rebuildList()
                }
            }
        }
    }

    func citeExtra() -> [String: Any] {
        let mine = citePreview.flatMap { p in actionItem.map { p.id == $0.id && p.style == citationStyle } } ?? false
        return ["citation": mine ? citePreview?.citation ?? "" : "", "bibliography": mine ? citePreview?.bibliography ?? "" : "",
                "error": mine ? citePreview?.error ?? "" : "", "keys": singleKeys ? "single" : "alt"]
    }

    // i / r, or Enter on a Copy row: to the clipboard, said in the footer.
    func copyCite(_ mode: String) {
        guard let target = citeTarget() else { return flashMessage("Nothing to cite here: highlight a paper") }
        let style = citationStyle
        let copy = { [weak self] (text: String) in
            guard let self else { return }
            if text.isEmpty { return self.flashMessage("Zotero gave no text for it") }
            self.flashMessage(self.desktop.copy(text) ? "Copied: " + text.split(whereSeparator: \.isWhitespace).joined(separator: " ") : "Couldn't copy it")
        }
        if let p = citePreview, p.id == target.id, p.style == style, !p.text(mode).isEmpty { return copy(p.text(mode)) }
        cite(target, mode, style) { [weak self] text, error in
            if let text { copy(text) } else { self?.flashMessage("Couldn't format it: \(error)") }
        }
    }

    private func cite(_ item: PaperRef, _ mode: String, _ style: String, _ done: @escaping (String?, String) -> Void) {
        bridge.post("/cite", ["keys": [item.key], "libraryID": item.libraryID, "style": style, "mode": mode, "format": "text"], timeout: 8) { result in
            MainActor.assumeIsolated {
                if case .ok(let answer) = result, let first = (answer["entries"] as? [[String: Any]])?.first, let text = first["text"] as? String {
                    done(text, "")
                } else {
                    done(nil, result.message.isEmpty ? "no entry" : result.message)
                }
            }
        }
    }

    // ---- helpers

    // The default app for PDFs ("Preview"), shown next to "Open PDF externally".
    static var pdfViewerName: String {
        guard let url = NSWorkspace.shared.urlForApplication(toOpen: .pdf) else { return "" }
        return FileManager.default.displayName(atPath: url.path).replacingOccurrences(of: ".app", with: "")
    }

    static func jsonArray(_ text: String) -> [[String: Any]]? {
        (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [[String: Any]]
    }
}
