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
        guard Self.paperViews[store.view] != nil, actionItem != nil, !store.inNote || notePaperInView,
              let paper = details?["paper"] as? [String: Any], let core else { return [] }
        return (try? core.glue("rankLabels", [paper["rank"] ?? NSNull()], as: [String].self)) ?? []
    }

    // The note being read: its title as its first block has it (Views.splitNoteTitle).
    var noteParts: (title: String, html: String) {
        let title = note.target?["title"] as? String ?? "Note"
        guard let html = note.data?["html"] as? String, let core,
              let parts = (try? core.glueJSON("noteParts", [html, note.data?["title"] as? String ?? title])).flatMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }) as? [String: Any]
        else { return (title, "") }
        return (parts["title"] as? String ?? title, parts["html"] as? String ?? "")
    }

    func placeholder() -> String {
        let tagName = tags.menuName
        switch store.view {
        case "actions": return "‹ " + paperLabel
        case "files": return "‹ Choose a file"
        case "notes": return "‹ Notes · " + paperLabel
        case "note": return "‹ " + noteParts.title
        case "tags": return tags.state?["editable"] as? Bool == false ? "‹ Tags · read-only library" : "‹ Tags · type to find or create one"
        case "tag-menu": return "‹ Tag · " + tagName
        case "tag-status": return "‹ “\(tagName)” into a \(tags.statusKind == "paper" ? "paper" : "task") status"
        case "tag-name": return "‹ Rename the tag “\(tagName)”"
        case "todos": return "‹ Tasks · type one to add it (#status !priority @due), or to find one"
        case "todo-edit": return "‹ Task · " + (currentTodo()?["description"] as? String ?? "")
        case "todo-new": return "‹ New task · type what to do"
        case "todo-text": return "‹ " + (["description": "Description", "due": "Due date", "notes": "Notes"][tasks.field] ?? "") + " · type it"
        case "todo-due": return "‹ Due · pick a day, or type one: fri, tomorrow, +3d, 2026-10-03"
        case "todo-tags": return "‹ Add to the task · type to find"
        case "todo-status": return "‹ Status"
        case "todo-priority": return "‹ Priority"
        case "settings-tasks": return "‹ Settings › Tasks · statuses and actions"
        case "status-menu":
            let e = tasks.statusEdit ?? [:]
            return (e["kind"] as? String == "action" ? "‹ Action · " : "‹ Status · ") + (e["name"] as? String ?? "")
        case "status-name":
            let e = tasks.statusEdit ?? [:]
            let adding = e["mode"] as? String == "add"
            if e["kind"] as? String == "action" { return adding ? "‹ New action" : "‹ Rename the action" }
            if adding, e["kind"] as? String != "paper" {
                return "‹ New status in " + ((try? core?.glue("groupName", [e["group"] ?? ""], as: String.self)) ?? "")
            }
            return adding ? "‹ New status" : "‹ Rename the status"
        case "settings": return "‹ Settings"
        case "settings-general": return "‹ Settings › General"
        case "settings-styles": return "‹ Settings › General › Citation style · type to find one"
        case "settings-paper-status": return "‹ Settings › Paper status"
        case "settings-providers": return "‹ Settings › Models & providers"
        case "settings-rules": return "‹ Settings › Rules"
        case "settings-auto-prompts": return "‹ Settings › Defaults › Prompts to run on new papers"
        case "prompts": return "‹ Prompts · " + paperLabel
        case "prompt-edit": return "‹ Edit prompt · " + (ai.promptEdit?["title"] as? String ?? "")
        case "prompt-title": return ai.titleMode == "create" ? "‹ New prompt · type its name, or what it should do" : "‹ Rename the prompt"
        case "prompt-output": return "‹ What “\(ai.promptEdit?["title"] as? String ?? "")” makes"
        case "prompt-model": return "‹ The prompt's model · type to find one"
        case "prompt-effort": return "‹ The prompt's effort"
        case "tasks": return "‹ Processes · prompt runs, extractions and syncs"
        case "chats": return "‹ Chats · with your papers"
        case "chat-menu": return "‹ " + (chat.menu?["title"] as? String ?? "Chat")
        case "chat-rename": return "‹ Rename the chat"
        case "artifact-menu": return "‹ " + (chat.artifact.map { ($0["title"] as? String ?? "") + " · " + ($0["formatLabel"] as? String ?? "") } ?? "Artifact")
        case "artifact-change": return "‹ Change “" + (chat.artifact?["title"] as? String ?? "") + "” · type what to change"
        case "artifact-rename": return "‹ Rename the artifact"
        case "extract-menu": return "‹ Extracted text · " + paperLabel
        case "settings-provider": return "‹ Settings › Models & providers › " + providerName
        case "settings-defaults": return "‹ Settings › Defaults"
        case "settings-models": return runnerState.modelsPath == "defaults.both" ? "‹ The default model for prompts and chat" : "‹ Choose a model · type to find one"
        case "settings-choice": return "‹ " + (settingsView.choice.isEmpty ? "Choose" : settingLabel(settingsView.choice))
        case "settings-edit": return "‹ " + (settingsView.edit?["label"] as? String ?? "") + " · type it (⌘V pastes)"
        case let view where view.hasPrefix("settings-"): return "‹ Settings"
        case "confirm": return "‹ " + (confirmAsk?.title ?? "Sure?")
        case "searches": return "‹ Saved searches"
        case "search-menu": return "‹ " + (searchState.menu?["name"] as? String ?? "Search")
        case "search-edit":
            switch searchState.editMode {
            case "save": return "‹ Name it (↵ names it after the search)"
            case "rename": return "‹ Rename the search"
            default: return "‹ Edit the search"
            }
        case "picker": return "‹ Add to the search · a filter or an operator"
        case "picker-values": return "‹ " + ((try? core?.glue("pickerFieldLabel", [searchState.pickerField], as: String.self)) ?? "") + " · type to find one"
        default:
            let search = singleKeys && !store.searchFocus ? " · / to search" : ""
            if store.scope != nil { return "‹ type to search in it" + search }
            if let badge = searchScope { return "Search in “\(badge.title)”…" + search }
            return "Search Zotero… · @ adds a filter"
        }
    }

    // The bar above the search box: null at the top level (ZoteroSearch.qml's contextInfo).
    var context: (text: String, ranks: [String], count: String)? {
        if store.atRoot { return nil }
        // a chat's or an artifact's pages: its paper (from Chats there's no paper's menu below), then its title
        if let s = Self.chatPaperViews[store.view] {
            let thing = store.view.hasPrefix("chat") ? chat.menu : chat.artifact
            let paper = (thing?["paper"] as? String).flatMap { $0.isEmpty ? nil : $0.replacingOccurrences(of: #"^\((.*)\)$"#, with: "$1", options: .regularExpression) } ?? paperLabel
            let sub = ["chat-menu", "artifact-menu"].contains(store.view) ? (thing?["title"] as? String ?? s) : s
            return (paper + "  ›  " + sub, actionItem != nil ? menuRanks : [], "")
        }
        if let s = Self.paperViews[store.view], actionItem != nil, !store.inNote || notePaperInView {
            var sub = s
            if store.view.hasPrefix("tag-") && !tags.menuName.isEmpty { sub += " · " + tags.menuName }
            return (paperLabel + (sub.isEmpty ? "" : "  ›  " + sub), menuRanks, "")
        }
        if store.inNote { return ("A note on no paper", [], "") }
        if store.view == "todo-edit" {
            let t = currentTodo()
            let item = t?["item"] as? [String: Any]
            let about = item.map { "  ›  " + (($0["cite"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? $0["title"] as? String ?? "") } ?? ""
            return ("Task · " + (t?["description"] as? String ?? "") + about, [], "")
        }
        if store.inSearch && store.pickFor == "todo" { return ("Pick the paper this task is about", [], "") }
        if store.inSearch && store.pickFor == "chat" { return ("New chat · pick a paper" + (store.scope.map { " in " + $0.title } ?? ""), [], "") }
        if store.inSearch, let scope = store.scope {
            let kind = ["tag": "Tag  ", "search": "Saved search  "][scope.type] ?? "Collection  "
            return (kind + scope.title, [], store.filterText.isEmpty ? "" : scopeTotal)
        }
        let label = (try? core?.glue("contextLabel", [placeholder()], as: String.self)) ?? ""
        return (label, [], "")
    }

    // A paper's menu and its views: the bar names the paper, then the view (ZoteroSearch.qml's paperViews).
    static let paperViews: [String: String] = ["actions": "", "notes": "Notes", "files": "Choose a file", "tags": "Tags", "tag-menu": "Tag", "prompts": "Prompts", "extract-menu": "Extracted text",
                                               "tag-name": "Rename the tag", "tag-status": "Tag into a status", "note": ""]
    static let chatPaperViews: [String: String] = ["chat-menu": "Chat", "chat-rename": "Rename the chat", "artifact-menu": "Artifact", "artifact-change": "Change the artifact",
                                                   "artifact-rename": "Rename the artifact"]

    private func settingLabel(_ path: String) -> String {
        (try? core?.glueJSON("settingEdit", [path, settingsJSON])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) }
            .flatMap { ($0 as? [String: Any])?["label"] as? String } ?? "Choose"
    }

    // The search box's placeholder under the bar: only what to type.
    func headerPlaceholder() -> String {
        if store.inNote && context != nil && notePaperInView { return noteParts.title } // the bar names its paper
        guard context != nil, !store.inNote else { return placeholder() }
        if store.view == "confirm" { return "↵ chooses · esc leaves things as they are" }
        if store.view == "todo-edit" || store.view == "prompt-edit" { return "↵ on a row changes it" } // its rows are fixed: typing doesn't filter them
        if store.inSearch { return (store.pickFor.isEmpty ? "Type to search in it" : "Type to find the paper") + (singleKeys && !store.searchFocus ? " · / to search" : "") }
        return (try? core?.glue("typeHint", [placeholder(), store.textEntry], as: String.self)) ?? ""
    }

    // The footer's note: a flash, else the last error (with rows to show), else a settings problem.
    var footerNote: String {
        if !flash.isEmpty { return flash }
        // not twice: an empty list says it (the results' always do, in their own words)
        if !lastError.isEmpty && !(content.count == 0 && (store.inSearch || emptyState.detail == lastError)) { return lastError }
        if let problem = settings?.problems.first {
            if problem.hasPrefix("Sync folder not found") { return "Synced files aren't changed: " + syncFolderAway } // as a save refused says it
            return shown(paths?.settings ?? "oma-zotero-launcher.json") + ": " + problem
        }
        return ""
    }

    // What the list says when it has no rows (ZoteroSearch.qml's emptyState). → (title, detail)
    var emptyState: (title: String, detail: String) {
        if store.inSearch {
            switch status {
            case "zotero-down" where !desktop.zoteroInstalled: return ("Zotero isn't installed", "Settings (\(keyName(";"))) › Setup opens zotero.org: Enter goes there")
            case "zotero-down": return ("Zotero isn't running", "Press Enter to start it")
            case "bridge-missing": return ("The Zotero Omarchy Bridge isn't installed", "Settings (\(keyName(";"))) › Setup downloads it: Enter goes there")
            case "unauthorized": return ("Zotero rejected the bridge token", "Restart Zotero to refresh it")
            default: break
            }
            if !lastError.isEmpty { return ("Search failed", lastError) }
            if loading || status == "unknown" { return ("Searching…", "") }
            if !store.filterText.isEmpty { return ("No matches for “\(store.filterText)”", "Tip: @ adds a filter · a:author  #tag  c:collection  y:2019..2021  \"exact\"  AND OR NOT ( )") }
            if let scope = searchScope { return ("No papers match this search", scope.type == "search" ? scope.query : "") }
            return ("Nothing open in Zotero", "Type to search your library")
        }
        if store.inNote {
            if !note.error.isEmpty { return ("Couldn't load the note", note.error) }
            if note.data == nil { return ("Loading the note…", "") }
            return ("This note is empty", "Press Enter to open it in Zotero")
        }
        if store.view == "tasks" { return ("No processes yet", "Prompt runs, extractions and syncs show here") }
        if store.view == "picker-values" {
            if searchState.facetLoading { return ("Loading…", "") }
            if !lastError.isEmpty { return ("Couldn't list them", lastError) }
            if store.filterText.isEmpty { return ("None in your library", "") }
        }
        if store.view == "tags" {
            if tags.state?["loading"] as? Bool == true { return ("Loading tags…", "") }
            if !lastError.isEmpty { return ("Couldn't load the tags", lastError) }
            return ("No tags in this library yet", "Type a name and press Enter to add it")
        }
        if details == nil && !lastError.isEmpty { return ("Couldn't load the paper", lastError) }
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
        if store.view == "settings-models" {
            guard runnerState.models != nil else { return "…" }
            let n = listRows.filter { $0.rowId == "set-model" && !$0.tag.isEmpty }.count
            return "\(n) " + (n == 1 ? "model" : "models")
        }
        if store.view == "settings-styles" {
            guard let styles = settingsView.styles else { return "…" }
            return "\(styles.count) " + (styles.count == 1 ? "style" : "styles")
        }
        if store.inSettings { return runnerState.installing ? "installing…" : "" }
        switch store.view {
        case "prompts":
            let n = ai.prompts?.count ?? 0
            return ai.prompts == nil ? "…" : "\(n) " + (n == 1 ? "prompt" : "prompts")
        case "prompt-edit":
            if runnerState.models != nil { return "" }
            return runnerState.modelsProblem.isEmpty ? "loading models…" : "models: " + runnerState.modelsProblem
        case "prompt-title": return ""
        case "tasks":
            let summary = (try? core?.glueJSON("taskSummary", [processes, pendingCount])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any]
            return (summary?["text"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "no processes"
        case "todos": return (try? core?.glue("todoCount", [todoList, settingsJSON], as: String.self)) ?? ""
        case "tags":
            guard let state = tags.state, state["loading"] as? Bool != true else { return "…" }
            return (try? core?.glue("tagCountText", [state], as: String.self)) ?? ""
        case "notes":
            let n = (details?["notes"] as? [Any])?.count ?? 0
            return "\(n) " + (n == 1 ? "note" : "notes")
        case "note":
            guard let data = note.data else { return "…" }
            if data["truncated"] as? Bool == true { return "long note: first part shown" }
            return (try? core?.glue("shortDate", [data["dateModified"] ?? ""], as: String.self)) ?? ""
        case "actions", "files": return details == nil ? "…" : ""
        case "chats":
            guard runnerInstalled else { return "" }
            guard let n = chat.chats?.count else { return "…" }
            return "\(n) " + (n == 1 ? "chat" : "chats")
        default: break
        }
        guard store.inSearch else { return searchViewCount }
        if loading { return "…" }
        guard let response, let core else { return "" }
        let count = (try? core.glue("countText", [response, 0], as: String.self)) ?? ""
        // grouped or sorted: how, after the count (only where it groups: typed, or in a scope)
        let mode = prefs?.values["grouping"] as? String ?? "relevance"
        let groupable = response["scope"] is [String: Any] || !((response["query"] as? String) ?? "").trimmingCharacters(in: .whitespaces).isEmpty
        guard mode != "relevance", groupable, let name = try? core.glue("groupingName", [mode, [Any]()], as: String.self), !name.isEmpty else { return count }
        return count + " · " + name
    }
}
