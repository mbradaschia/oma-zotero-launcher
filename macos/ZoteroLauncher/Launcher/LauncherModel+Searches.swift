import Foundation

// Saved searches and their badges, and the @ pickers (ZoteroSearch.qml:2392-2555, the search-* and
// pick-* cases 1497-1609).
extension LauncherModel {
    var savedSearches: [[String: Any]] { searchesFile?.searches ?? [] }
    var searchesJSON: RawJSON { searchesFile?.json ?? RawJSON(text: "[]") }
    var pinnedSearches: [[String: Any]] { savedSearches.filter { $0["pinned"] as? Bool == true } }

    func savedSearch(_ id: String) -> [String: Any]? { savedSearches.first { $0["id"] as? String == id } }

    // A change to the saved searches: `function` (a Glue wrapper) gets the list first, then `args`,
    // and gives back the new list. → saved.
    @discardableResult
    func saveSearches(_ function: String, _ args: [Any]) -> Bool {
        guard let core, var file = searchesFile else { return false }
        var ok = false
        saved {
            try file.update(core) { list in try core.glueJSON(function, [list] + args) }
            searchesFile = file
            ok = true
        }
        if ok { searchesChanged() }
        return ok
    }

    // The saved searches changed (here, or the other machine's merged in): a badge whose search is
    // gone or unpinned goes back to All; an edited one is searched again (ZoteroSearch.qml:764).
    func searchesChanged() {
        if !searchState.active.isEmpty && !pinnedSearches.contains(where: { $0["id"] as? String == searchState.active }) { searchState.active = "" }
        if ["searches", "search-menu", "picker"].contains(store.view) {
            store.followTop = false
            rebuildList()
        } else if store.inSearch && store.atRoot && scopeKey(searchScope) != requestedScope {
            requestSearch()
        }
    }

    // A scope as the request remembers it: a saved search's query too, so an edited one is asked again.
    func scopeKey(_ scope: Scope?) -> String {
        guard let scope else { return "" }
        return scope.id + (scope.type == "search" ? "|" + scope.query : "")
    }

    // A saved search as a scope (Views.searchScope).
    func scopeOf(_ search: [String: Any]?) -> Scope? {
        guard let search, let s = (try? core?.glueJSON("searchScope", [search])).flatMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }) as? [String: Any],
              let key = s["key"] as? String else { return nil }
        return Scope(type: "search", key: key, libraryID: s["libraryID"] as? Int ?? 0, title: s["title"] as? String ?? "", query: s["query"] as? String ?? "")
    }

    // Enter on a saved search's rows (the Searches view, a search's menu, search-edit, the pickers).
    func searchAction(_ row: ListRow) {
        let menuId = searchState.menu?["id"] as? String ?? ""
        switch row.rowId {
        case "search": openSavedSearch(savedSearch(row.value))
        case "search-open": openSavedSearch(savedSearch(menuId))
        case "search-pin":
            toggleSearchPin(menuId)
            searchState.menu = savedSearch(menuId)
            store.followTop = false
            rebuildList()
        case "search-rename", "search-query":
            let rename = row.rowId == "search-rename"
            searchState.editMode = rename ? "rename" : "query"
            searchState.toSave = searchState.menu?["query"] as? String ?? ""
            store.push("search-edit")
            store.filterText = (rename ? searchState.menu?["name"] : searchState.menu?["query"]) as? String ?? ""
            rebuildList()
        case "search-delete":
            let name = searchState.menu?["name"] as? String ?? ""
            guard saveSearches("removeSearch", [menuId]) else { return }
            libraryChanged = true // its papers, if they were showing: asked again on the way back
            flashMessage("Deleted “\(name)”")
            back()
        case "search-save", "search-save-pin":
            let pin = row.rowId == "search-save-pin"
            guard saveSearches("addSearch", [row.value, searchState.toSave, pin, nowMs]) else { return }
            let id = savedSearches.last?["id"] as? String ?? ""
            back()
            if pin && store.atRoot {
                store.filterText = "" // its badge now holds what was typed
                selectSearch(id)
            }
            flashMessage(pin ? "Saved and pinned: Tab switches to it" : "Saved: " + keyName("f") + " lists your searches")
        case "search-rename-save", "search-query-save":
            let rename = row.rowId == "search-rename-save"
            guard saveSearches("updateSearch", [menuId, rename ? ["name": row.value] : ["query": row.value]]) else { return }
            if !rename && searchState.active == menuId { libraryChanged = true } // its badge's results: asked again on the way back
            flashMessage(rename ? "Renamed" : "Search saved")
            back()
            searchState.menu = savedSearch(menuId)
            rebuildList()
        case "pick-field": openPickerValues(row.value)
        case "pick-op": addToSearch(row.value, levels: store.view == "picker-values" ? 2 : 1) // a date field's After/Before/Between: from its values
        case "pick-value": addToSearch(row.value, levels: 2)
        default: break
        }
    }

    // ---- the Searches view (f), a search's menu, saving

    func openSearches() {
        store.push("searches")
        rebuildList()
    }

    // Enter on a saved search: its papers, searchable within, like a collection; Esc goes back.
    func openSavedSearch(_ s: [String: Any]?) {
        guard let scope = scopeOf(s) else { return }
        store.push("search")
        store.scope = scope
        scopeTotal = ""
        response = nil
        rebuildSearch()
        requestSearch()
    }

    func openSearchMenu(_ row: ListRow) { openSearchMenu(id: row.value) }

    func openSearchMenu(id: String) {
        guard let s = savedSearch(id) else { return }
        searchState.menu = s
        store.push("search-menu")
        rebuildList()
    }

    func toggleSearchPin(_ id: String) {
        guard let s = savedSearch(id) else { return }
        let pinned = s["pinned"] as? Bool == true
        guard saveSearches("updateSearch", [id, ["pinned": !pinned]]) else { return }
        flashMessage(pinned ? "Unpinned" : "Pinned: its badge is above the results; Tab switches to it")
    }

    // p in Searches.
    func toggleSelectedSearchPin() {
        guard let row = selectedListRow, row.rowId == "search" else { return }
        toggleSearchPin(row.value)
        store.followTop = false
        rebuildList()
        selectRow { $0.rowId == "search" && $0.value == row.value }
    }

    // Shift+↑/↓ in Searches: a search trades places with its neighbour in the same section (the
    // pinned ones: their badges too).
    func moveSearchRow(_ delta: Int) {
        let rows = listRows, i = store.selectedIndex
        guard rows.indices.contains(i), rows.indices.contains(i + delta), rows[i].rowId == "search", rows[i + delta].rowId == "search",
              rows[i].section == rows[i + delta].section else { return }
        let id = rows[i].value
        guard saveSearches("moveSearch", [id, rows[i + delta].value]) else { return }
        store.followTop = false
        rebuildList()
        selectRow { $0.rowId == "search" && $0.value == id }
    }

    // s in the results (Ctrl+S while typing): save what they show, the typed search within the
    // collection, tag or saved search it's in; the header takes its name.
    func saveSearchPrompt() {
        guard store.pickFor.isEmpty, let core else { return }
        let query = (try? core.glue("combinedQuery", [scopeJSON, store.filterText], as: String.self)) ?? store.filterText
        if query.isEmpty { return flashMessage("Type a search first; then " + (singleKeys ? "esc s" : keyName("s")) + " or ⌘S saves it") }
        searchState.toSave = query
        searchState.editMode = "save"
        store.push("search-edit")
        rebuildList()
    }

    // The badges above the results: "" (All) or a pinned search's id.
    func selectSearch(_ id: String) {
        searchState.active = id
        store.followTop = true
        requestSearch() // the rows stay until its answer
    }

    func cycleSearch(_ delta: Int) {
        selectSearch((try? core?.glue("nextSearch", [pinnedSearches, searchState.active, delta], as: String.self)) ?? "")
    }

    // ---- the @ pickers

    // @ in the search box: what to add to the search, a tag, an author, a year, … or an operator.
    func openPicker() {
        store.push("picker")
        rebuildList()
    }

    func openPickerValues(_ field: String) {
        searchState.pickerField = field
        searchState.facets = nil
        store.push("picker-values")
        refreshFacets()
    }

    // The values for what is typed. The bridge matches them (a library has thousands of authors: too
    // many to filter here on every key) and sends the best 100; the newest answer wins, and the rows
    // shown stay until it comes. Nothing typed: the field's first page, kept for this opening.
    func refreshFacets() {
        guard let core else { return }
        let field = searchState.pickerField
        let query = store.filterText
        let kept = query.trimmingCharacters(in: .whitespaces).isEmpty ? searchState.facetCache[field] : nil
        if field.hasPrefix("tax:") && tax.tagCounts == nil { // its labels' counts, once an opening (asked once at a time)
            if searchState.facetLoading { return rebuildList() }
            return refreshTagCounts()
        }
        if (try? core.glue("dateField", [field], as: Bool.self)) == true || field == "search" || field.hasPrefix("tax:") || kept != nil {
            if let kept { searchState.facets = kept }
            searchState.facetSerial += 1 // an answer still on its way is for other text
            searchState.facetLoading = false
            return rebuildList()
        }
        searchState.facetSerial += 1
        let serial = searchState.facetSerial
        searchState.facetLoading = true
        rebuildList()
        let body = (try? core.glueJSON("facetsBody", [field, query, 100, settingsJSON, todos?.json ?? RawJSON(text: "[]"), chat.chats ?? []])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any] ?? [:]
        bridge.post("/facets", body, timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self, serial == self.searchState.facetSerial else { return }
                self.searchState.facetLoading = false
                if case .ok(let answer) = result {
                    self.searchState.facets = answer
                    self.lastError = ""
                    if ((answer["query"] as? String) ?? "").trimmingCharacters(in: .whitespaces).isEmpty { self.searchState.facetCache[field] = answer }
                } else {
                    self.lastError = "Couldn't list them: \(result.message)"
                }
                if self.opened && self.store.view == "picker-values" && self.searchState.pickerField == field { self.rebuildList() }
            }
        }
    }

    // Every tag's paper count (the bridge's tag facets), for a taxonomy's labels in the @ picker (ZoteroSearch.qml's refreshTagCounts).
    private func refreshTagCounts() {
        guard let core else { return }
        searchState.facetLoading = true
        rebuildList()
        // (no limit: every tag, as the QML)
        let body = (try? core.glueJSON("facetsBody", ["tag", "", NSNull(), settingsJSON, todos?.json ?? RawJSON(text: "[]"), chat.chats ?? []])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any] ?? [:]
        bridge.post("/facets", body, timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.searchState.facetLoading = false
                if case .ok(let answer) = result {
                    var counts: [String: Int] = [:]
                    for v in answer["values"] as? [[String: Any]] ?? [] { counts[String(describing: v["value"] ?? "").lowercased()] = v["count"] as? Int ?? 0 }
                    self.tax.tagCounts = counts
                } else {
                    self.lastError = "Couldn't count them: " + result.message
                    self.tax.tagCounts = [:] // (not asked again at every keystroke: the next opening does)
                }
                if self.opened && self.store.view == "picker-values" { self.rebuildList() }
            }
        }
    }

    // The rows of Searches, a search's menu, search-edit and the pickers.
    func searchViewRows(_ core: JSCore) throws -> [ListRow] {
        switch store.view {
        case "searches": return try core.glue("savedSearchRows", [searchesJSON, store.filterText, Self.accentHex], as: [ListRow].self)
        case "search-menu": return try core.glue("searchMenuRows", [searchState.menu ?? NSNull()], as: [ListRow].self)
        case "search-edit": return try core.glue("searchEditRows", [searchState.editMode, store.filterText, searchState.toSave], as: [ListRow].self)
        case "picker": return try core.glue("pickerRows", [store.filterText, !savedSearches.isEmpty, tax.taxonomies], as: [ListRow].self)
        default: break
        }
        let field = searchState.pickerField
        if (try? core.glue("dateField", [field], as: Bool.self)) == true {
            return try core.glue("dateValueRows", [field, nowMs, store.filterText], as: [ListRow].self)
        }
        if field.hasPrefix("tax:") {
            return try core.glue("taxonomyValueRows", [field, tax.taxonomies, tax.tagCounts ?? [:], store.filterText, Self.accentHex], as: [ListRow].self)
        }
        if field == "search" {
            let values = (try? core.glueJSON("savedSearchValues", [searchesJSON])).map { RawJSON(text: $0) } ?? RawJSON(text: "[]")
            return try core.glue("pickerValueRows", [values, store.filterText, Self.accentHex, true], as: [ListRow].self)
        }
        let facets = searchState.facets
        let values: Any = facets?["field"] as? String == field ? facets?["values"] ?? [Any]() : [Any]()
        return try core.glue("pickerValueRows", [values, "", Self.accentHex, false], as: [ListRow].self) // ranked by the bridge
    }

    // The count beside the search box in these views.
    var searchViewCount: String {
        switch store.view {
        case "searches":
            let n = savedSearches.count
            return "\(n) " + (n == 1 ? "search" : "searches")
        case "picker-values":
            let n = content.count, field = searchState.pickerField
            if field == "search" { return "\(n) " + (n == 1 ? "search" : "searches") }
            if field.hasPrefix("tax:") { return "\(n) " + (n == 1 ? "label" : "labels") }
            if (try? core?.glue("dateField", [field], as: Bool.self)) == true { return "" }
            guard let r = searchState.facets, r["field"] as? String == field else { return "…" }
            let total = (try? core?.glue("thousands", [r["total"] ?? 0], as: String.self)) ?? ""
            let count = (try? core?.glue("thousands", [r["count"] ?? 0], as: String.self)) ?? ""
            // "651 of 11,033" while typing; "11,033" before
            return ((r["query"] as? String) ?? "").trimmingCharacters(in: .whitespaces).isEmpty ? count : total + " of " + count
        default: return ""
        }
    }
}

// Go to (Views.commandRows): the launcher's places the Mac has by now; the others come with their phases.
extension LauncherModel {
    static let goToPlaces = ["todos", "todo-new", "tasks", "searches", "sync", "settings", "settings-general", "settings-providers", "settings-defaults", "settings-rules", "chats", "chat-new", "classify-all", "extract-all", "keys"]

    func openPlace(_ kind: String) {
        switch kind {
        case "todos": openTodos()
        case "todo-new": _ = startNewTodo([:])
        case "searches": openSearches()
        case "sync": syncZotero()
        case "settings": openSettings("")
        case "tasks": openTasks()
        case "chats": openChats()
        case "chat-new": pickPaperForChat()
        case "classify-all": classifyAllHere()
        case "keys": openKeys()
        case "extract-all": extractAllHere()
        case let k where k.hasPrefix("settings-"): openSettings(String(k.dropFirst("settings-".count)))
        default: break
        }
    }
}

// The search box (StyledTextField): its runs, and what it reports.
extension LauncherModel {
    // The runs to tint: a query (the results, search-edit's query) or a new task's line.
    func segments(_ text: String, caret: Int) -> [TextSegment] {
        guard let core, !text.isEmpty else { return [] }
        if store.view == "todo-new" { return (try? core.glue("taskSegments", [text, caret, settingsJSON, nowMs], as: [TextSegment].self)) ?? [] }
        guard store.inSearch || (store.view == "search-edit" && searchState.editMode == "query") else { return [] }
        // the word being typed isn't a finished block yet
        return (try? core.glue("querySegments", [text, caret, store.queryLive], as: [TextSegment].self)) ?? []
    }

    // Typed in the box: the text, and where the caret is (UTF-16 units from the end).
    func typed(_ text: String, caretBack: Int) {
        setFilter(text)
        store.caretBack = caretBack
        store.queryLive = true
    }

    // The badges above the results, at the top level: All, each pinned search, and the save hint.
    var badges: [(id: String, name: String)] {
        guard store.inSearch && store.atRoot else { return [] }
        let typed = store.filterText.trimmingCharacters(in: .whitespaces)
        let save = typed.isEmpty ? "+ Type, then ⌘S saves it as a search" : "+ Save “\(typed)” as a search · ⌘S"
        return [("", "All")] + pinnedSearches.map { ($0["id"] as? String ?? "", $0["name"] as? String ?? "") } + [("+save", save)]
    }
}
