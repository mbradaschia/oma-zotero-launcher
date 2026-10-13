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

    func answerConfirm(_ yes: Bool) {
        let ask = confirmAsk
        confirmAsk = nil
        back()
        if yes { ask?.run() } else { ask?.cancel() }
    }
}
