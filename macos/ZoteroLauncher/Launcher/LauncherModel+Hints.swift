import Foundation

// The footer's hints: the keys for where you are, in the current mode (ZoteroSearch.qml's hints and
// hintsFor, 4916-5038), in the Mac's notation (macos/docs/ux-conventions.md).
extension LauncherModel {
    // The footer's hints, in order (ZoteroSearch.qml's hints and hintsFor), before fitting.
    func hints() -> [String] {
        let h = hintsFor()
        // (none in the keys view itself)
        let help: [String] = store.view == "keys" ? [] : [store.inNote || (singleKeys && !keyState.typingNow) ? "? keys" : "F1 keys"]
        // "/ search" first only where / gives the box the keys (not in the reader)
        if singleKeys && !store.searchFocus && !store.textEntry && !store.inNote { return ["/ search"] + help + h.filter { $0 != "/ search" } }
        return help + h
    }

    func hintsFor() -> [String] {
        let K = { (l: String) in self.keyName(l) }
        let back: [String] = store.atRoot ? ["esc close"] : ["⌫ esc back", "⇧esc home"]
        // (the places the Mac has by now)
        let places: [String] = [K("t") + " tasks", K("c") + " chat", K(".") + " processes", K("f") + " searches", K(";") + " settings", K("W") + (windowed ? " overlay" : " window")]
        let slash: [String] = singleKeys ? ["/ search"] : []
        let row = (singleKeys ? "1…9" : "⌥1…9") + " row"
        if store.view == "keys" { return ["type to find a key", "↑↓ move", "esc clear, then back"] } // (letters type there)
        if singleKeys && store.searchFocus && !store.textEntry {
            let badges: [String] = store.atRoot && !pinnedSearches.isEmpty ? ["tab next search"] : []
            let filters: [String] = store.inSearch && store.pickFor.isEmpty ? ["@ filters"] + badges + ["⌘S save"] : []
            let what = store.view == "todos" ? "type to add or find" : !store.pickFor.isEmpty ? "type to find the paper" : "type to search"
            let enter = !store.inSearch ? (selectedListRow?.rowId == "setting-go" ? Self.settingKeyVerb(selectedListRow?.value ?? "") : "choose") : !store.pickFor.isEmpty ? (store.pickFor == "chat" ? "chat about it" : "pick it")
                : selectedSearchRow?.kind == "setting" ? settingHitVerb : selectedSearchRow?.kind == "saved-search" ? "its papers" : "menu"
            return [what] + filters + ["↑↓ move", "↵ " + enter, "esc one-key actions"]
        }
        if store.view == "confirm" { return ["↵ choose", "↑↓ move", "esc back (nothing changes)"] }
        if !store.inSearch, let r = selectedListRow, r.rowId == "setting-go" { return ["↵ " + Self.settingKeyVerb(r.value), row] + slash + back } // (a setting found from a menu's search)
        let listRow = store.inSearch ? nil : selectedListRow
        switch store.view {
        case "searches":
            guard let r = listRow, r.rowId == "search" else { return back }
            return ["↵ open", "⇧↵ rename, edit, delete", K("p") + (r.badge.isEmpty ? " pin" : " unpin"), "⇧↑↓ reorder"] + slash + back
        case "search-menu": return ["↵ choose", row] + back
        case "search-edit": return ["↵ save", "esc clear, then back"]
        case "picker": return ["↵ " + (listRow?.rowId == "pick-op" ? "add it" : "its values"), row] + slash + back
        case "picker-values": return ["↵ add it to the search", row] + slash + back
        case "prompts":
            if listRow?.rowId == "prompt" { return ["↵ run it, save as a note", K("e") + " edit"] + slash + back }
            return ["↵ create"] + back
        case "prompt-title":
            return [ai.titleMode != "create" ? "↵ rename" : listRow?.rowId == "pe-title-ai" ? "↵ write it with AI" : "↵ create", "esc clear, then back"]
        case "tasks":
            if listRow?.rowId == "task", !(listRow?.noteKey ?? "").isEmpty {
                return ["↵ read", "⇧↵ " + K("z") + " zotero", K("w") + " window", K("y") + " copy .md", K("s") + " save .md"] + slash + back
            }
            if let r = listRow, !r.available { return [row] + back } // running or failed: nothing to open
            return ["↵ " + (listRow?.rowId == "tasks-clear" ? "clear them" : "open"), row] + back
        case "extract-menu": return ["↵ choose", row] + back
        case "prompt-edit", "prompt-model", "prompt-effort", "prompt-output":
            if let r = listRow, !r.available { return [row] + back }
            return ["↵ " + (["pe-auto", "pe-brief"].contains(listRow?.rowId ?? "") ? "change" : listRow?.showCheck == true ? "choose" : "open"), row] + slash + back
        default: break
        }
        if store.view == "todo-new" { return ["↵ add and open", "⇧↵ just add", "@ add a block", "#status !priority @due", "esc clear, then back"] }
        if store.view == "todo-text" || store.view == "status-name" { return ["↵ save", "⌘V paste", "esc clear, then back"] }
        if store.view == "todos" {
            if listRow?.rowId == "todo" { return ["↵ open", "tab ⇧tab status", K("d") + " done", K("!") + " priority", "⌘⌫ delete", "⇧↑↓ reorder"] + slash + back }
            if listRow?.rowId == "todo-quick" { return ["↵ add and open it", "⇧↵ just add it", "#status !priority @due"] + back }
            return ["↵ new task, or just type it"] + slash + back
        }
        if store.view == "todo-edit" {
            switch listRow?.rowId {
            case "todo-desc": return ["↵ edit it", "↑↓ move", "esc back"]
            case "todo-notes": return ["↵ edit them", "↑↓ move", "esc back"]
            case "todo-status", "todo-priority": return ["tab ⇧tab change", "↵ back", K("d") + " done", "⌘⌫ delete"] + back
            case "todo-due": return ["↵ pick a date", K("d") + " done", "⌘⌫ delete"] + back
            default: return ["↵ open", K("d") + " done", K("!") + " priority", "⌘⌫ delete"] + back
            }
        }
        if store.view == "todo-tags" { return ["↵ add it", "↑↓ move", "esc back"] }
        if store.view == "todo-due" { return ["←→↑↓ day", "pgup pgdn month", "home today", "⌘⌫ no date", "↵ pick (or what you typed)", "esc back"] }
        if store.view == "settings-tasks" {
            return ["↵ " + (listRow?.rowId == "status" || listRow?.rowId == "task-action" ? "rename or remove" : "add"), "⇧↑↓ move"] + back
        }
        if store.view == "settings-paper-status" { return ["↵ " + (listRow?.rowId == "pstatus" ? "rename or remove" : "add"), "⇧↑↓ move"] + back }
        if store.view == "status-menu" || store.view == "todo-status" || store.view == "todo-priority" { return ["↵ choose"] + back }
        if store.view == "actions", listRow?.rowId == "todo" {
            return ["↵ open", "tab ⇧tab status", K("d") + " done", K("!") + " priority", K("a") + " new task", K("p") + " pin", "⇧↑↓ move"] + slash + back
        }
        let noteKeys: [String] = ["↵ read", "⇧↵ " + K("z") + " zotero", K("w") + " window", K("y") + " copy .md", K("s") + " save .md", "⌘⌫ delete"] + slash + back
        if store.inNote {
            return (note.siblings.count > 1 ? ["⇧↑↓ other notes"] : []) + (statusTarget() != nil ? ["⌥→← status", "⇧⌥→← task"] : [])
                + ["t task", "z zotero", "w window", "y copy .md", "s save .md", "⌘⌫ delete", "i/r cite", "c chat", "j k scroll", "⌘-/+ size", "⌫ esc back"]
        }
        if store.view == "notes" {
            if listRow?.rowId == "note" { return ["↵ read", "⇧↑↓ reorder", K("w") + " window", K("y") + " copy .md", K("s") + " save .md", "⇧↵ " + K("z") + " zotero", "⌘⌫ delete"] + slash + back }
            return noteKeys
        }
        if store.view == "tags" {
            if tags.state?["editable"] as? Bool == false { return ["read-only"] + back }
            return ["↵ add/remove", "⇧↵ rename or delete everywhere", "⌃↵ new tag"] + slash + back
        }
        if store.view == "tag-menu" || store.view == "tag-status" { return ["↵ choose"] + back }
        if store.view == "tag-name" { return ["↵ rename everywhere", "esc clear, then back"] }
        if store.view == "settings-edit" {
            if settingsView.edit?["path"] as? String == "tax:ai-request" { return ["↵ send it", "⌘V paste", "esc back (nothing saved)"] }
            return ["↵ save", "⌘V paste", "esc clear, then back"]
        }
        if store.view == "settings-tax-ai" {
            if listRow?.rowId == "tax-ai-ask" {
                if listRow?.available == false { return ["↑↓ move"] + back } // (busy)
                return ["↵ type what you want"] + (tax.draft?["proposal"] is [String: Any] ? ["↓ the proposal"] : []) + ["esc back (nothing saved)"]
            }
            if listRow?.rowId == "tax-ai-accept" { return ["↵ accept it", "↑ ask for changes"] + back }
            return ["↑↓ move", "↵ on Accept or Discard"] + back
        }
        if store.view == "settings-taxonomy" || store.view == "settings-tax-label" {
            if ["tax-field", "tax-label-field"].contains(listRow?.rowId ?? "") { return ["↵ edit it", "↑↓ move"] + back }
            if listRow?.field == "pills" { return ["tab ⇧tab ↵ change", "↑↓ move"] + back }
            if listRow?.rowId == "tax-label" { return ["↵ edit it", "⇧↑↓ move", row] + back }
        }
        if store.view == "settings-tax-review", listRow?.rowId == "tax-suggestion" { return ["↵ tag it", "⌘⌫ dismiss it"] + slash + back }
        // a taxonomy's rows: what Enter does (not "open"); the form pages ignore typing (no / search)
        if let r = listRow, r.available, let verb = Self.taxVerbs[r.rowId] {
            let formPage = ["settings-taxonomy", "settings-tax-label", "settings-tax-ai"].contains(store.view)
            return ["↵ " + verb] + (formPage ? [] : [row] + slash) + back
        }
        if store.inSettings {
            if let r = listRow, r.rowId == "set-info" || !r.available { return [row] + back }
            if listRow?.rowId == "set-key" { return ["↵ read the key from the clipboard", row] + back }
            let verb = listRow.map { Self.settingVerb($0.rowId, showCheck: $0.showCheck) } ?? "open"
            return ["↵ " + verb, row] + slash + back
        }
        if store.view == "files" { return ["↵ open", row] + back }
        if store.view == "tax-paper" {
            if let r = listRow, !r.available || r.rowId == "tax-none" { return [row] + back }
            let verb = listRow?.rowId == "tax-label-papers" ? "the papers with it" : listRow?.rowId == "classify" ? (tax.status?["classified"] as? Bool == true ? "tag again" : "tag")
                : listRow?.rowId == "classify-audit" ? "audit" : "choose"
            return ["↵ " + verb, row] + slash + back
        }
        if store.view == "tax-audit" {
            let first: [String] = listRow?.rowId == "tax-audit" ? ["↵ " + (listRow?.decision == "confirmed" ? "→ off, by you" : listRow?.decision == "dismissed" ? "→ auto" : "→ on, by you")]
                : listRow?.rowId == "classify" ? ["↵ tag again"] : []
            return first + ["↑↓ move"] + slash + back
        }
        if store.view == "chats" { return listRow?.rowId == "chat-open" ? ["↵ open", "⇧↵ rename or delete", "⌘⌫ delete", row] + slash + back : ["↵ open", row] + slash + back }
        if store.view == "chat-rename" || store.view == "artifact-rename" { return ["↵ rename", "esc clear, then back"] }
        if store.view == "artifact-change" { return ["↵ change it", "⌘V paste", "esc clear, then back"] }
        if store.view == "chat-menu" || store.view == "artifact-menu" { return ["↵ choose", row] + back }
        if store.view == "actions" { return menuHints(K, back: back, slash: slash, row: row) }
        let cur = selectedSearchRow
        if store.pickFor == "chat" { return ["↵ chat about it"] + slash + back }
        if !store.pickFor.isEmpty { return ["↵ pick it"] + slash + back } // a task's paper: only picking it
        if cur?.kind == "collection" { return ["↵ open", "⇧↵ zotero", K("p") + " pin"] + slash + back }
        if cur?.kind == "tag" { return ["↵ its papers", K("p") + " pin"] + slash + back }
        if cur?.kind == "saved-search" { return ["↵ its papers", "⇧↵ rename, edit, delete", row] + places + slash + back }
        if cur?.kind == "note-child" { return ["↵ read", "space ← hide the notes", "⇧↵ " + K("z") + " zotero"] + slash + back }
        if cur?.kind == "setting" { return ["↵ " + settingHitVerb, row] + places + slash + back }
        if let k = cur?.kind, Self.goToPlaces.contains(k) { return ["↵ open", row] + places + slash + back }
        let badges: [String] = store.atRoot && !pinnedSearches.isEmpty ? ["tab next search"] : []
        let searchKeys: [String] = ["@ filters"] + badges + [K("s") + " save search"]
        if !(settings?.values.accelerators ?? true) { return ["↵ menu", "⇧↵ zotero"] + searchKeys + slash + places + back }
        var menu: [String] = ["↵ menu"]
        if cur?.kind == "item" {
            menu += ["⌥→← status", "⇧⌥→← task"]
            if (cur?.noteCount ?? 0) > 0 { menu.append("space notes") }
        }
        if cur?.section == "Pinned" { menu.append("⇧↑↓ reorder") }
        let letters: [String] = [row, "⇧↵ " + K("z") + " zotero", K("o") + "/" + K("w") + " pdf", K("n") + " notes", K("#") + " tags", K("p") + " pin",
                                 K("l") + " library", K("i") + "/" + K("r") + " cite", K("g") + " sort"]
        return menu + letters + searchKeys + places + slash + back
    }

    // A paper's menu: p pins the highlighted row (Pinned, on top), ⇧↑↓ moves it in its section.
    private func menuHints(_ K: (String) -> String, back: [String], slash: [String], row: String) -> [String] {
        let listRow = selectedListRow
        var pinRow: [String] = []
        if let r = listRow {
            pinRow = [K("p") + (r.section == Self.menuPinned ? " unpin" : " pin"), K("P") + (r.section == Self.menuOther ? " back" : " to other"), "⇧↑↓ move"]
        }
        let noteKeys: [String] = ["↵ read", "⇧↵ " + K("z") + " zotero", K("w") + " window", K("y") + " copy .md", K("s") + " save .md", "⌘⌫ delete"] + slash + back
        switch listRow?.rowId {
        case "note": return ["↵ read"] + pinRow + [K("w") + " window", K("y") + " copy .md", K("s") + " save .md", "⇧↵ " + K("z") + " zotero", "⌘⌫ delete"] + slash + back
        case "chat-session": return ["↵ continue it", "⇧↵ rename or delete"] + pinRow + ["⌘⌫ delete"] + slash + back
        case "artifact": return ["↵ open it", "⇧↵ change it with AI, rename, undo, delete"] + pinRow + ["⌘⌫ delete"] + slash + back
        case "note-delete": return ["↵ delete it (asks first)"] + slash + back
        case "extract" where !(listRow?.noteKey ?? "").isEmpty:
            return ["↵ read it", "⇧↵ " + K("x") + " extract again, zotero, delete"] + pinRow + [K("w") + " window", K("y") + " copy .md", "⌘⌫ delete"] + slash + back
        case "read": return noteKeys
        default:
            let keys: [String] = ["⌥→← status", "⇧⌥→← task", row, "⇧↵ " + K("z") + " zotero", K("o") + "/" + K("w") + " pdf", K("n") + " notes", K("#") + " tags",
                                  K("x") + " extract", K("i") + "/" + K("r") + " cite", K("c") + " chat", K("a") + " task", K("l") + " library"]
            return ["↵ run"] + pinRow + keys + slash + back
        }
    }
}
