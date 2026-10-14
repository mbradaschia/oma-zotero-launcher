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

    func answerConfirm(_ yes: Bool) {
        let ask = confirmAsk
        confirmAsk = nil
        back()
        if yes { ask?.run() } else { ask?.cancel() }
    }
}
