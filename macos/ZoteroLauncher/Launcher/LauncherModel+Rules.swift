import Foundation

// Settings › Rules: the runner's rules (its lib/rules.json) on or off, your own instructions
// (Paths' instructions file), written in the text editor (ZoteroSearch.qml:1650-1672;
// Service.qml:1787-1840).
extension LauncherModel {
    // The installed runner's rules.json, else the one the app brings (RunnerKit).
    var rulesFile: URL? {
        let home = env["HOME"] ?? NSHomeDirectory()
        let installed = URL(fileURLWithPath: (env["XDG_DATA_HOME"] ?? home + "/.local/share") + "/oma-zotero-launcher/runner/lib/rules.json")
        if FileManager.default.fileExists(atPath: installed.path) { return installed }
        return RunnerKit.folder?.appendingPathComponent("macos/runner/lib/rules.json")
    }

    func refreshRules() {
        let rules = rulesFile.flatMap { try? Data(contentsOf: $0) }.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["rules"] as? [Any] ?? []
        ai.rules = rules
        ai.rulesJSON = RawJSON(text: (try? JSCore.jsonText(rules)) ?? "[]")
        readInstructions()
        if instructionsWatcher == nil, let path = paths?.instructions {
            let folder = URL(fileURLWithPath: path).deletingLastPathComponent()
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            instructionsWatcher = FolderWatcher(folder, latency: 0.5) { [weak self] in MainActor.assumeIsolated { self?.readInstructions() } }
        }
        settingsShowChange()
    }

    // Your own instructions as the runner reads them: their <!-- --> comments left out.
    func readInstructions() {
        let text = paths.flatMap { try? String(contentsOfFile: $0.instructions, encoding: .utf8) } ?? ""
        let next = (try? core?.glue("instructionsText", [text], as: String.self)) ?? ""
        guard next != ai.instructions else { return }
        ai.instructions = next
        settingsShowChange()
    }

    // set-rule, set-rules-reset, set-system-edit, set-system-reset. → handled.
    func ruleAction(_ row: ListRow) -> Bool {
        switch row.rowId {
        case "set-rule":
            guard let rule = ai.rules.first(where: { ($0 as? [String: Any])?["id"] as? String == row.value }) else { return true }
            guard changeSettings("rule", [rule], refresh: false).ok else { return true }
            store.followTop = false
            rebuildList()
        case "set-rules-reset":
            guard changeSettings("value", ["rules", [String: Any]()], refresh: false).ok else { return true }
            flashMessage("The rules are back to their defaults")
            store.followTop = false
            rebuildList()
        case "set-system-edit":
            dismiss()
            runner.launch(runnerArgv(["system", "edit"])) // written from its template if missing, opened in the text editor
        case "set-system-reset":
            promptJob(["system", "clear"]) { [weak self] ok, _, error in
                guard let self else { return }
                self.flashMessage(ok ? "Your own instructions are cleared: the rules stay" : "Couldn't clear them: " + error)
                self.readInstructions()
            }
        default: return false
        }
        return true
    }
}
