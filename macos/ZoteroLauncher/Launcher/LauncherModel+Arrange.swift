import Foundation

// A menu's own pins and order, the sections' order, and the pins in the results
// (ZoteroSearch.qml:3436-3550), kept in view.json and pins.json.
extension LauncherModel {
    static let menuPinned = "Pinned"
    static let menuOther = "Other"

    // p in a paper's menu: the highlighted row into Pinned on top, or out again.
    func toggleMenuPin() {
        guard let row = selectedListRow, let core, var prefs else { return }
        prefs.reload()
        let view = store.view, id = row.identity
        let pins = (try? core.glue("toggleIdentity", [prefs.menuPins(view), id], as: [String].self)) ?? []
        let pinned = pins.contains(id)
        saved {
            let others = prefs.menuOther(view)
            if pinned && others.contains(id) { try prefs.saveMenuOther(view, others.filter { $0 != id }) } // out of Other, into Pinned
            try prefs.saveMenuPins(view, pins)
            self.prefs = prefs
        }
        store.followTop = false
        rebuildList()
        selectRow { $0.identity == id && ($0.section == Self.menuPinned) == pinned }
        flashMessage(pinned ? "Pinned to the top of this menu (\(keyName("p")) again unpins it)" : "Unpinned")
    }

    // P: the highlighted row out of the way, into Other at the bottom of every paper's menu; P again
    // puts it back. A pinned row leaves the pins. The highlight stays where you were: on the row that
    // was below it (above it, at the end), not on the row that moved.
    func toggleMenuOther() {
        guard let row = selectedListRow, let core, var prefs else { return }
        prefs.reload()
        let view = store.view, id = row.identity
        let rows = listRows, i = store.selectedIndex
        let neighbour = rows.indices.contains(i + 1) ? rows[i + 1] : rows.indices.contains(i - 1) ? rows[i - 1] : nil
        let others = (try? core.glue("toggleIdentity", [prefs.menuOther(view), id], as: [String].self)) ?? []
        let away = others.contains(id)
        saved {
            if away && row.section == Self.menuPinned { try prefs.saveMenuPins(view, prefs.menuPins(view).filter { $0 != id }) }
            try prefs.saveMenuOther(view, others)
            self.prefs = prefs
        }
        store.followTop = false
        rebuildList()
        if let n = neighbour, n.identity != id, selectRow({ $0.identity == n.identity && $0.section == n.section }) {} else { selectRow { $0.identity == id } }
        flashMessage(away ? "Moved to Other, at the bottom (\(keyName("P")) again puts it back)" : "Back in its section")
    }

    // Shift+↑/↓ in a paper's menu: the row moves within its section (among the pins, in Other, or
    // in your order for every paper's menu).
    func moveMenuRow(_ delta: Int) {
        let rows = listRows, i = store.selectedIndex
        guard rows.indices.contains(i), let core, var prefs else { return }
        prefs.reload()
        let row = rows[i]
        guard rows.indices.contains(i + delta), rows[i + delta].section == row.section else {
            return flashMessage("It's at the \(delta < 0 ? "top" : "bottom") of \(row.section.isEmpty ? "the menu" : row.section) (⌃⇧↑↓ moves the section)")
        }
        if row.rowId == "note" && rows[i + delta].rowId == "note" && row.section != Self.menuPinned { return moveNote(delta) }
        let id = row.identity, to = rows[i + delta].identity, section = row.section, view = store.view
        let move = { (list: [String]) in (try? core.glue("moveIdentity", [list, id, to], as: [String]?.self)) ?? nil }
        saved {
            if section == Self.menuPinned {
                if let pins = move(prefs.menuPins(view)) { try prefs.saveMenuPins(view, pins) }
            } else if section == Self.menuOther {
                if let others = move(prefs.menuOther(view)) { try prefs.saveMenuOther(view, others) }
            } else if let next = move(menuRows.filter { $0.section == section }.map(\.identity)) {
                try prefs.saveMenuOrder(view, section, next)
            }
            self.prefs = prefs
        }
        store.followTop = false
        rebuildList()
        selectRow { $0.identity == id && $0.section == section }
    }

    // Ctrl+Shift+↑/↓: the highlighted row's section moves (in every menu and the results; kept per menu).
    func moveSectionOf(_ delta: Int) {
        guard let core, var prefs else { return }
        prefs.reload()
        let sections: [String] = store.inSearch ? searchRows.map(\.section) : listRows.map(\.section)
        guard sections.indices.contains(store.selectedIndex) else { return }
        let current = sections[store.selectedIndex]
        guard let names = (try? core.glue("moveSection", [sections.map { ["section": $0] }, current, delta], as: [String]?.self)) ?? nil else { return }
        let keep = store.inSearch ? selectedSearchRow.map { ($0.key, $0.kind) } : nil
        let keepRow = selectedListRow
        saved {
            try prefs.saveSectionOrder(sectionKey, names)
            self.prefs = prefs
        }
        store.followTop = false
        if store.inSearch {
            rebuildSearch()
            if let keep, let n = searchRows.firstIndex(where: { $0.key == keep.0 && $0.kind == keep.1 }) { store.selectedIndex = n }
        } else {
            rebuildList()
            if let keepRow { selectRow { $0.rowId == keepRow.rowId && $0.value == keepRow.value && $0.noteKey == keepRow.noteKey && $0.label == keepRow.label } }
        }
    }

    // Shift+↑/↓ on a pinned result: among the pins, at once; the search that follows agrees.
    func movePinned(_ delta: Int) {
        let rows = searchRows, i = store.selectedIndex
        guard rows.indices.contains(i), let core, var file = pins else { return }
        let row = rows[i]
        guard row.section == "Pinned" else { return flashMessage("⇧↑↓ reorders the pinned papers (before you type)") }
        guard rows.indices.contains(i + delta), rows[i + delta].section == "Pinned" else { return }
        let other = rows[i + delta]
        let ref = { (r: SearchRow) -> [String: Any] in ["key": r.key, "libraryID": r.libraryID, "type": ["collection", "tag"].contains(r.kind) ? r.kind : "item"] }
        saved {
            try file.update(core) { try core.glue("movePin", [$0.map(\.json), ref(row), ref(other)], as: [Pin].self) }
            pins = file
        }
        var moved = rows
        moved.swapAt(i, i + delta)
        content = .search(moved)
        store.selectedIndex = i + delta
        store.followTop = false
        requestSearch()
    }

    // p on a result (with the paper letters on): pin or unpin it.
    func togglePinSelected() {
        guard let row = selectedSearchRow else { return }
        togglePin(["key": row.key, "libraryID": row.libraryID, "title": row.title, "type": ["collection", "tag"].contains(row.kind) ? row.kind : "item"])
        libraryChanged = false
        requestSearch()
    }

    // l on a result: shown in Zotero's library.
    func revealSelected() {
        guard let row = selectedSearchRow else { return }
        if row.kind != "item" { return activate(store.selectedIndex) }
        actionItem = PaperRef(key: row.key, libraryID: row.libraryID, title: row.title, itemType: row.itemType)
        finish("reveal", attachment: nil)
    }

    // Enter on a result with no rows: Zotero started; Shift+Enter on a result: it, in Zotero
    // (ZoteroSearch.qml:4527).
    func activate(_ index: Int) {
        guard searchRows.indices.contains(index) else {
            // what the empty list says Enter does: Setup (Zotero or its plugin missing), else start Zotero
            if status == "bridge-missing" || (status == "zotero-down" && !desktop.zoteroInstalled) { return openSettings("") }
            if lastError == BridgeResult.zoteroDown.message || lastError == BridgeResult.noHandshake.message {
                dismiss()
                desktop.launchZotero()
            }
            return
        }
        let row = searchRows[index]
        if row.kind == "collection" {
            dismiss()
            bridge.post("/collection/reveal", ["key": row.key, "libraryID": row.libraryID], timeout: 8) { [weak self] result in
                MainActor.assumeIsolated { if case .ok = result { self?.desktop.activateZotero() } }
            }
            return
        }
        if row.kind == "tag" { return openCollection(row) } // a tag's papers are in the launcher
        guard row.kind == "item" else { return } // (a place, a setting, a saved search: not in Zotero)
        actionItem = PaperRef(key: row.key, libraryID: row.libraryID, title: row.title, itemType: row.itemType)
        finish("open", attachment: nil)
    }

    // Shift+Enter (z): whatever is highlighted, in Zotero; in a paper's menu, the paper unless a
    // note is highlighted (ZoteroSearch.qml:1958).
    func openInZotero() {
        if store.inSearch {
            if selectedSearchRow?.kind == "note-child" { return openNoteInZoteroFromResults() }
            if let r = selectedSearchRow, r.kind == "saved-search" { return openSearchMenu(id: String(r.key.dropFirst("saved-search:".count))) } // (its menu, as in the list)
            return activate(store.selectedIndex)
        }
        if Self.noteViews.contains(store.view), selectedNoteTarget() != nil { return openNoteInZotero() }
        if actionItem != nil, Self.paperViews[store.view] != nil { finish("open", attachment: nil) }
    }

    private func openNoteInZoteroFromResults() {
        guard let row = selectedSearchRow else { return }
        note.target = ["key": row.key, "libraryID": row.libraryID, "title": row.title]
        dismiss()
        bridge.post("/open", ["key": row.key, "libraryID": row.libraryID], timeout: 8) { [weak self] result in
            MainActor.assumeIsolated { if case .ok = result { self?.desktop.activateZotero() } }
        }
    }
}
