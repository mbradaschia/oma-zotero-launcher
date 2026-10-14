import Foundation

// What surrounds the list: the context bar, the search box's placeholder, the count, the footer's
// note and hints (ZoteroSearch.qml:2596-2640, 4779-4870, 4916-5038), for the views that exist.
extension LauncherModel {
    // "Authors, Year · Title" of the paper whose menu is open.
    var paperLabel: String {
        guard let item = actionItem else { return "" }
        let p = details?["paper"] as? [String: Any]
        let cite = [p?["authors"], p?["year"]].compactMap { v -> String? in
            guard let v else { return nil }
            let s = "\(v)"
            return s.isEmpty || s == "<null>" ? nil : s
        }.joined(separator: ", ")
        let title = (p?["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? item.title
        return cite.isEmpty ? title : cite + " · " + title
    }

    // The journal rankings on the right of the context bar (ABS 4*, ABDC A*, FT50, UTD24).
    var menuRanks: [String] {
        guard ["actions", "files"].contains(store.view), actionItem != nil, let paper = details?["paper"] as? [String: Any], let core else { return [] }
        return (try? core.glue("rankLabels", [paper["rank"] ?? NSNull()], as: [String].self)) ?? []
    }

    func placeholder() -> String {
        switch store.view {
        case "actions": return "‹ " + paperLabel
        case "files": return "‹ Choose a file"
        case "confirm": return "‹ " + (confirmAsk?.title ?? "Sure?")
        default:
            let search = singleKeys && !store.searchFocus ? " · / to search" : ""
            if store.scope != nil { return "‹ type to search in it" + search }
            return "Search Zotero… · @ adds a filter"
        }
    }

    // The bar above the search box: null at the top level (ZoteroSearch.qml's contextInfo).
    var context: (text: String, ranks: [String])? {
        if store.atRoot { return nil }
        let sub = ["actions": "", "files": "Choose a file"]
        if let s = sub[store.view], actionItem != nil {
            return (paperLabel + (s.isEmpty ? "" : "  ›  " + s), menuRanks)
        }
        if store.inSearch, let scope = store.scope { return ((scope.type == "tag" ? "Tag  " : "Collection  ") + scope.title, []) }
        let label = (try? core?.glue("contextLabel", [placeholder()], as: String.self)) ?? ""
        return (label, [])
    }

    // The search box's placeholder under the bar: only what to type.
    func headerPlaceholder() -> String {
        guard context != nil else { return placeholder() }
        if store.view == "confirm" { return "↵ chooses · esc leaves things as they are" }
        if store.inSearch { return "Type to search in it" + (singleKeys && !store.searchFocus ? " · / to search" : "") }
        return (try? core?.glue("typeHint", [placeholder(), store.textEntry], as: String.self)) ?? ""
    }

    // The footer's note: a flash, else the last error (with rows to show), else a settings problem.
    var footerNote: String {
        if !flash.isEmpty { return flash }
        if !lastError.isEmpty { return lastError }
        if let problem = settings?.problems.first { return "oma-zotero-launcher.json: " + problem }
        return ""
    }

    // The footer's hints, in order (ZoteroSearch.qml's hints and hintsFor), before fitting.
    func hints() -> [String] {
        let h = hintsFor()
        let help = singleKeys && !keyState.typingNow ? "? keys" : "F1 keys"
        if singleKeys && !store.searchFocus && !store.textEntry { return ["/ search", help] + h.filter { $0 != "/ search" } }
        return [help] + h
    }

    func hintsFor() -> [String] {
        let K = { (l: String) in self.keyName(l) }
        let back: [String] = store.atRoot ? ["esc close"] : ["⌫ esc back", "⇧esc home"]
        let places: [String] = [K("t") + " tasks", K("c") + " chat", K(".") + " processes", K("f") + " searches", K(";") + " settings", K("W") + (windowed ? " overlay" : " window")]
        let slash: [String] = singleKeys ? ["/ search"] : []
        let row = (singleKeys ? "1…9" : "alt+1…9") + " row"
        if singleKeys && store.searchFocus && !store.textEntry {
            let filters: [String] = store.inSearch && store.pickFor.isEmpty ? ["@ filters", "ctrl+s save"] : []
            return ["type to search"] + filters + ["↑↓ move", "↵ " + (store.inSearch ? "menu" : "choose"), "esc one-key actions"]
        }
        if store.view == "confirm" { return ["↵ choose", "↑↓ move", "esc back (nothing changes)"] }
        if store.view == "files" { return ["↵ open", row] + back }
        if store.view == "actions" { return menuHints(K, back: back, slash: slash, row: row) }
        let cur = selectedSearchRow
        if cur?.kind == "collection" { return ["↵ open", "⇧↵ zotero", K("p") + " pin"] + slash + back }
        if cur?.kind == "tag" { return ["↵ its papers", K("p") + " pin"] + slash + back }
        let searchKeys: [String] = ["@ filters", K("s") + " save search"]
        if !(settings?.values.accelerators ?? true) { return ["↵ menu", "⇧↵ zotero"] + searchKeys + slash + places + back }
        var menu: [String] = ["↵ menu"]
        if cur?.kind == "item" {
            menu += ["alt+→← status", "⇧alt+→← task"]
            if (cur?.noteCount ?? 0) > 0 { menu.append("space notes") }
        }
        if cur?.section == "Pinned" { menu.append("⇧↑↓ reorder") }
        let letters: [String] = [row, "⇧↵ " + K("z") + " zotero", K("o") + "/" + K("w") + " pdf", K("n") + " notes", K("#") + " tags", K("p") + " pin",
                                 K("l") + " library", K("i") + "/" + K("r") + " cite", K("g") + " group"]
        return menu + letters + searchKeys + places + slash + back
    }

    // A paper's menu: p pins the highlighted row (Pinned, on top), ⇧↑↓ moves it in its section.
    private func menuHints(_ K: (String) -> String, back: [String], slash: [String], row: String) -> [String] {
        let listRow = selectedListRow
        var pinRow: [String] = []
        if let r = listRow {
            pinRow = [K("p") + (r.section == Self.menuPinned ? " unpin" : " pin"), K("P") + (r.section == Self.menuOther ? " back" : " to other"), "⇧↑↓ move"]
        }
        let noteKeys: [String] = ["↵ read", "⇧↵ " + K("z") + " zotero", K("w") + " window", K("y") + " copy .md", K("s") + " save .md"] + slash + back
        switch listRow?.rowId {
        case "note": return ["↵ read"] + pinRow + [K("w") + " window", K("y") + " copy .md", K("s") + " save .md", "⇧↵ " + K("z") + " zotero"] + slash + back
        case "chat-session": return ["↵ continue it", "⇧↵ rename or delete"] + pinRow + slash + back
        case "artifact": return ["↵ open it", "⇧↵ change it with AI, rename, undo, delete"] + pinRow + slash + back
        case "extract" where !(listRow?.noteKey ?? "").isEmpty:
            return ["↵ read it", "⇧↵ " + K("x") + " extract again, zotero, delete"] + pinRow + [K("w") + " window", K("y") + " copy .md"] + slash + back
        case "read": return noteKeys
        default:
            let keys: [String] = ["alt+→← status", "⇧alt+→← task", row, "⇧↵ " + K("z") + " zotero", K("o") + "/" + K("w") + " pdf", K("n") + " notes", K("#") + " tags",
                                  K("x") + " extract", K("i") + "/" + K("r") + " cite", K("c") + " chat", K("a") + " task", K("l") + " library"]
            return ["↵ run"] + pinRow + keys + slash + back
        }
    }

    // What the list says when it has no rows (ZoteroSearch.qml's emptyState). → (title, detail)
    var emptyState: (title: String, detail: String) {
        if store.inSearch {
            switch status {
            case "zotero-down": return ("Zotero isn't running", "Press Enter to start it")
            case "bridge-missing": return ("The Zotero bridge isn't installed", "Install the Zotero Omarchy Bridge in Zotero (see its README)")
            case "unauthorized": return ("Zotero rejected the bridge token", "Restart Zotero to refresh it")
            default: break
            }
            if !lastError.isEmpty { return ("Search failed", lastError) }
            if loading || status == "unknown" { return ("Searching…", "") }
            if !store.filterText.isEmpty { return ("No matches for “\(store.filterText)”", "Tip: @ adds a filter · a:author  #tag  c:collection  y:2019..2021  \"exact\"  AND OR NOT ( )") }
            return ("Nothing open in Zotero", "Type to search your library")
        }
        if details == nil && !lastError.isEmpty { return ("Couldn't load the item", lastError) }
        if !store.filterText.isEmpty { return ("No matches for “\(store.filterText)”", "") }
        return ("Loading…", "")
    }

    // The paper's text and taxonomies as pills, in its menu (Views.paperFooter).
    var paperPills: [Pill] {
        guard ["actions", "files"].contains(store.view), let details, let core else { return [] }
        return (try? core.glue("paperFooter", [["details": details]], as: [Pill].self)) ?? []
    }

    // The header's count: "12 matches", "3 of 1,204"… (Views.countText).
    var countText: String {
        guard store.inSearch else { return "" }
        if loading { return "…" }
        guard let response, let core else { return "" }
        return (try? core.glue("countText", [response, 0], as: String.self)) ?? ""
    }
}
