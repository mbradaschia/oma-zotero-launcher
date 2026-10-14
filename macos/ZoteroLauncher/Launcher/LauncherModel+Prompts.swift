import Foundation

// Prompts: the list, running one on a paper, a new one (named, or written with AI), the editor
// (ZoteroSearch.qml:1612, 1874-1925, 3856-3930; Service.qml:930-960, 1666, 1700-1840).
extension LauncherModel {
    var runnerModels: Any { runnerState.models?["models"] ?? NSNull() }
    var resolvedPromptsModel: String { (runnerState.models?["defaults"] as? [String: Any])?["prompts"] as? String ?? "" }

    // `list --json`: the prompts, or why there are none.
    // (asked again while a list is out: once more after it, so a change saved meanwhile shows)
    func refreshPrompts() {
        _ = once("list") {
            runRunner(["list", "--json"], timeout: 20) { [weak self] r in
                guard let self else { return }
                self.finished("list") { self.refreshPrompts() }
                self.promptsListed(r)
            }
        }
    }

    private func promptsListed(_ r: RunnerResult) {
        guard let core else { return }
        if r.missing || r.status == 127 {
            ai.prompts = nil
            ai.promptsJSON = RawJSON(text: "null")
            ai.promptsProblem = "The AI features aren't installed: Settings › Setup installs them"
        } else if let json = try? core.glueJSON("parsePromptList", [r.stdout]), json != "null" {
            ai.promptsJSON = RawJSON(text: json)
            ai.prompts = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [[String: Any]]
            ai.promptsProblem = ""
        } else {
            ai.prompts = nil
            ai.promptsJSON = RawJSON(text: "null")
            ai.promptsProblem = r.ok ? "the runner's list isn't readable" : r.problem
        }
        promptsChanged()
    }

    // ZoteroSearch.qml's onPromptsChanged: the editor on the fresh copy, its views rebuilt.
    private func promptsChanged() {
        if let id = ai.promptEdit?["id"] as? String, let fresh = ai.prompts?.first(where: { $0["id"] as? String == id }) { ai.promptEdit = fresh }
        runnerState.index = nil
        guard opened, ["actions", "prompts", "prompt-edit", "settings-defaults"].contains(store.view) else { return }
        store.followTop = false
        rebuildList()
    }

    // `set`, `new`, `system clear`: one at a time, the list read again after each.
    func promptJob(_ args: [String], _ done: @escaping @MainActor (Bool, [String: Any]?, String) -> Void) {
        if syncedWriteRefused() { return } // prompts and your instructions live in the sync folder
        ai.jobs.append((args, done))
        nextJob()
    }

    private func nextJob() {
        guard !ai.jobRunning, !ai.jobs.isEmpty else { return }
        let job = ai.jobs.removeFirst()
        ai.jobRunning = true
        runRunner(job.args, timeout: 60) { [weak self] r in
            guard let self else { return }
            self.ai.jobRunning = false
            job.done(r.ok, r.json as? [String: Any], r.problem)
            self.refreshPrompts()
            self.nextJob()
        }
    }

    func setPrompt(_ id: String, _ change: [String: Any], _ failure: String) {
        guard let args = try? core?.glue("setPromptArgs", [id, change], as: [String].self) else { return }
        promptJob(args) { [weak self] ok, _, error in if !ok { self?.flashMessage(failure + error) } }
    }

    // A prompt's row (a paper's menu, Prompts, the editor and its pages). → handled.
    func promptAction(_ row: ListRow) -> Bool {
        switch row.rowId {
        case "prompts":
            store.push("prompts")
            rebuildList()
        case "prompt": runPrompt(row)
        case "prompt-new":
            ai.titleMode = "create"
            store.push("prompt-title")
            rebuildList()
        case "pe-title":
            ai.titleMode = "rename"
            store.push("prompt-title")
            store.filterText = ai.promptEdit?["title"] as? String ?? ""
            rebuildList()
        case "pe-title-save": saveTitle(row.value)
        case "pe-title-ai": draftPrompt(row.value)
        case "pe-model", "pe-effort", "pe-output":
            store.push(["pe-model": "prompt-model", "pe-effort": "prompt-effort", "pe-output": "prompt-output"][row.rowId] ?? "")
            rebuildList()
            selectRow { $0.checked }
        case "pe-brief":
            guard let id = ai.promptEdit?["id"] as? String else { return true }
            let on = ai.promptEdit?["brief"] as? Bool == false
            ai.promptEdit?["brief"] = on
            store.followTop = false
            rebuildList()
            setPrompt(id, ["brief": on ? "on" : "off"], "Couldn't save the prompt: ")
            flashMessage(on ? "Plans it first: a brief, then the final version" : "Draws it in one go")
        case "pe-output-opt": choosePrompt(["output": row.value], parent: "pe-output")
        case "pe-model-opt":
            let effort = (try? core?.glue("effortFor", [runnerModels, row.value, ai.promptEdit?["effort"] ?? ""], as: String.self)) ?? ""
            choosePrompt(["model": row.value, "effort": effort], parent: "pe-model")
        case "pe-effort-opt": choosePrompt(["effort": row.value], parent: "pe-effort")
        case "pe-text":
            guard let id = ai.promptEdit?["id"] as? String, !syncedWriteRefused() else { return true }
            dismiss()
            // the runner opens it in the Mac's text editor
            if !runner.launch(runnerArgv(["edit", id])) { notify("Couldn't open it in the editor", RunnerResult(missing: true).problem) }
        default: return false
        }
        return true
    }

    // Enter on a prompt: the runner works in the background (a few minutes); Processes shows it and
    // a notification says when the note is saved. The launcher stays.
    func runPrompt(_ row: ListRow) {
        guard let item = actionItem else { return }
        var args = ["run", row.promptId, "--key", item.key]
        if item.libraryID != 0 { args += ["--library", String(item.libraryID)] }
        guard runner.launch(runnerArgv(args)) else { return flashMessage("Couldn't run it: " + RunnerResult(missing: true).problem) }
        tasksSoon()
        flashMessage("Running “\(row.label)”: it's in Processes (\(keyName(".")))")
    }

    // e on a prompt: its editor.
    func editSelectedPrompt() {
        guard let row = selectedListRow, row.rowId == "prompt", let p = ai.prompts?.first(where: { $0["id"] as? String == row.promptId }) else { return }
        openPromptEditor(p)
    }

    func openPromptEditor(_ prompt: [String: Any]) {
        ai.promptEdit = prompt
        store.push("prompt-edit")
        rebuildList()
        refreshModels()
    }

    // An option picked: shown at once, saved by the runner (the list read again confirms it).
    private func choosePrompt(_ changes: [String: Any], parent: String) {
        guard let id = ai.promptEdit?["id"] as? String else { return }
        for (k, v) in changes { ai.promptEdit?[k] = v }
        back()
        selectRow { $0.rowId == parent }
        setPrompt(id, changes, "Couldn't save the prompt: ")
    }

    // Enter in the name view: create it and open it in the editor, or rename it.
    private func saveTitle(_ title: String) {
        guard !title.isEmpty else { return }
        if ai.titleMode == "create" {
            flashMessage("Creating…")
            promptJob(["new", title, "--json", "--no-edit"]) { [weak self] ok, data, error in
                guard let self else { return }
                guard ok, let id = data?["id"] as? String else { return self.flashMessage("Couldn't create the prompt: " + error) }
                guard self.store.view == "prompt-title" else { return }
                self.back()
                self.openPromptEditor(["id": id, "title": title, "model": "", "effort": "", "output": "note", "excerpt": ""])
                self.flashMessage("Created “\(title)”: pick its model and effort, then write it")
            }
        } else {
            guard let id = ai.promptEdit?["id"] as? String else { return }
            ai.promptEdit?["title"] = title
            back()
            setPrompt(id, ["title": title], "Couldn't rename the prompt: ")
        }
    }

    // "Write it with AI": the default prompts model writes it from the description typed; it opens in
    // the editor when ready, if the view is still there.
    private func draftPrompt(_ description: String) {
        guard !description.isEmpty else { return }
        guard !ai.drafting else { return flashMessage("A prompt is already being written") }
        if syncedWriteRefused() { return }
        ai.drafting = true
        draftingChanged()
        flashMessage("Writing the prompt with AI…")
        runRunner(["new-ai", "--describe", description, "--json"], timeout: 300) { [weak self] r in
            guard let self else { return }
            self.ai.drafting = false
            self.draftingChanged()
            defer { self.refreshPrompts() }
            guard r.ok, let data = r.json as? [String: Any], let id = data["id"] as? String else {
                return self.flashMessage("Couldn't write the prompt: " + (r.ok ? "no answer from the runner" : r.problem))
            }
            let title = data["title"] as? String ?? id
            guard self.store.view == "prompt-title", self.ai.titleMode == "create" else { return self.flashMessage("Wrote “\(title)”: it's under Prompts") }
            self.back()
            self.openPromptEditor(["id": id, "title": title, "model": "", "effort": "", "output": data["output"] ?? "note", "excerpt": data["excerpt"] ?? ""])
            self.flashMessage("Wrote “\(title)” with \(data["model"] as? String ?? "the default model"): review its text (Prompt text) before you run it")
        }
    }

    // ZoteroSearch.qml's onDraftingPromptChanged: the name view's rows, the cursor kept.
    private func draftingChanged() {
        guard store.view == "prompt-title" else { return }
        store.followTop = false
        rebuildList()
    }

    // The sync folder away: nothing the runner writes there (prompts, your instructions) is
    // changed, said as the app's own refused saves say it. → refused.
    func syncedWriteRefused() -> Bool {
        guard paths?.syncDir != nil, paths?.readOnly == true || syncFolderGone else { return false }
        flashMessage("Not saved: " + syncFolderAway)
        return true
    }

    // The rows of Prompts, the editor and its pages.
    func promptViewRows(_ core: JSCore) throws -> [ListRow] {
        let edit: Any = ai.promptEdit ?? NSNull()
        switch store.view {
        case "prompts": return try core.glue("promptRows", [ai.promptsJSON, runnerModels, store.filterText, Self.accentHex, resolvedPromptsModel], as: [ListRow].self)
        case "prompt-title": return try core.glue("titleRows", [store.filterText.trimmingCharacters(in: .whitespaces), ai.titleMode, !needsSetup, ai.drafting], as: [ListRow].self)
        case "prompt-model": return try core.glue("promptModels", [edit, runnerModels, resolvedPromptsModel, store.filterText], as: [ListRow].self)
        case "prompt-effort": return try core.glue("promptEfforts", [edit, runnerModels, resolvedPromptsModel], as: [ListRow].self)
        case "prompt-output": return try core.glue("promptOutputs", [edit], as: [ListRow].self)
        default:
            let auto = ((settings?.raw["defaults"] as? [String: Any])?["autoPrompts"] as? [String] ?? []).contains(ai.promptEdit?["id"] as? String ?? "")
            return try core.glue("promptEditor", [edit, runnerModels, resolvedPromptsModel, auto], as: [ListRow].self)
        }
    }
}
