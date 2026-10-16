import Foundation

// Settings › Setup and installing the AI features (ZoteroSearch.qml:1867-1870, 3604-3650;
// Service.qml:2155-2240), and settings found from the search (526-560, 1046, 1770).
extension LauncherModel {
    // set-setup, set-install, setting-go. → handled.
    func setupAction(_ row: ListRow) -> Bool {
        switch row.rowId {
        case "setup": openSettings("providers") // a paper's menu: Set up an AI model
        case "set-setup": runSetupAction(row.value)
        case "set-install": runSetupAction("install")
        case "setting-go": openSettingAt(row.value)
        default: return false
        }
        return true
    }

    func runSetupAction(_ action: String) {
        switch action {
        case "zotero-start":
            desktop.launchZotero()
            flashMessage("Starting Zotero…")
            pollSetup()
        case "zotero-get":
            _ = desktop.open(url: URL(string: "https://www.zotero.org/download/")!)
            flashMessage("Opened zotero.org in your browser: download Zotero 10 there, then come back")
        case "bridge-install":
            flashMessage("Downloading the Zotero Omarchy Bridge…")
            bridgeDownloader.download { [weak self] result in
                guard let self else { return }
                switch result {
                case .failure(let why): self.flashMessage("Couldn't get the Zotero Omarchy Bridge: \(why)")
                case .success(let file):
                    _ = self.desktop.copy(file.path)
                    if !self.desktop.zoteroRunning { self.desktop.launchZotero() }
                    self.flashMessage("Saved \(self.shown(file.path)) (path copied): in Zotero, Tools → Plugins → ⚙ → Install Plugin From File…")
                    self.pollSetup()
                }
            }
        case "install": installRunner()
        case let a where a.hasPrefix("copy:"):
            let command = String(a.dropFirst("copy:".count))
            _ = desktop.copy(command)
            flashMessage("Copied “\(command)”: paste it in Terminal, then come back here when it's done")
        case "settings-setup": openSettings("")
        case let a where a.hasPrefix("settings-"): openSettings(String(a.dropFirst("settings-".count)))
        default: break
        }
    }

    // Zotero started or its plugin installed: asked every 3 s (60 times at most) until it answers.
    func pollSetup() {
        runnerState.setupPolls = 0
        setupTimer?.invalidate()
        setupTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.setupTick() }
        }
    }

    func setupTick() {
        runnerState.setupPolls += 1
        if runnerState.setupPolls > 60 { setupTimer?.invalidate(); return }
        bridge.reload()
        bridge.post("/sync/status", [:], timeout: 2) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.noteBridge(result)
                if self.status == "ready" { self.setupTimer?.invalidate() }
                self.settingsShowChange()
            }
        }
    }

    // Install AI features: the bundled install-runner.sh (RunnerKit), with the explicit PATH; the
    // row says "Installing…" until it ends.
    func installRunner() {
        guard !runnerState.installing else { return flashMessage("Installing the AI features already") }
        guard let script = RunnerKit.installScript() else { return flashMessage("This build of the app doesn't carry the AI features' installer") }
        let node = runnerState.reqs.node
        guard (Int(node.split(separator: ".").first ?? "") ?? 0) >= 22 else { return flashMessage("Install Node.js 22 or newer first: brew install node") }
        runnerState.installing = true
        runnerState.installProblem = ""
        flashMessage("Installing the AI features: it's in Processes (\(keyName(".")))") // install-runner.sh shows itself there
        tasksSoon()
        settingsShowChange()
        runner.run(["/bin/bash", script.path], stdin: nil, timeout: 900) { [weak self] r in
            guard let self else { return }
            self.runnerState.installing = false
            if r.ok {
                self.runnerState.missing = false
                self.extractTick() // a catch-up that waited for the runner
                self.flashMessage("AI features installed")
            } else {
                self.runnerState.installProblem = r.problem
                self.flashMessage("Couldn't install the AI features: " + r.problem)
            }
            self.refreshProviders()
            self.refreshModels()
            self.refreshRequirements() // the version installed now
        }
    }

    // ---- settings found from the search

    // Every row of the pages the Mac has, for Go to and a menu's Settings rows.
    var settingsIndex: RawJSON {
        if let index = runnerState.index { return index }
        let index = (try? core?.glueJSON("settingsIndex", [settingsJSON, settingsContext, todoList])).map { RawJSON(text: $0) } ?? RawJSON(text: "[]")
        runnerState.index = index
        return index
    }

    // A setting found in the results: its page, on its row (page, rowId, value, label: \u{1}-joined).
    func openSettingAt(_ key: String) {
        let k = key.components(separatedBy: "\u{1}")
        openSettings(k[0])
        guard k.count > 3, !k[1].isEmpty else { return }
        store.followTop = false
        let found = selectRow({ $0.rowId == k[1] && $0.value == k[2] && $0.label == k[3] }) || selectRow { $0.rowId == k[1] && $0.value == k[2] }
        // then what the row does, there, so you see it change (R7); the ones that clear or remove: only shown
        if found, Self.doneFromTheSearch(k[1]) { activateAction(store.selectedIndex) }
    }

    // A setting found from the search: Enter does what its row does when that's a change you see on its page (a switch,
    // a choice, an edit, a model, a page of its own); anything that runs, installs, stops, clears, removes or reads the
    // clipboard is only shown there, its row highlighted (a stray Enter in a search starts nothing).
    static let actsFromTheSearch: Set<String> = ["set-toggle", "set-choice", "set-edit", "set-opt", "set-model", "set-models", "set-styles",
                                                 "set-auto-prompt", "set-rule", "set-nav", "set-provider", "tax-open", "tax-review", "tags-status"]
    static func doneFromTheSearch(_ rowId: String) -> Bool { actsFromTheSearch.contains(rowId) }

    // What Enter does on a Settings row (its page, the search, a menu's search: one word for all three).
    static let taxVerbs = ["tax-on": "turn it on", "tax-off": "turn it off", "tax-delete": "delete it", "tax-reset": "back to the bundled one", "tax-editor": "edit it in your editor",
                           "tax-label-add": "add a label", "tax-new": "make one", "tax-ai-new": "describe it", "tax-ai-edit": "say what to change", "tax-ai-discard": "discard it",
                           "tax-review": "review them", "tax-label-delete": "delete it (asks first)"]
    static func settingVerb(_ rowId: String, showCheck: Bool = false) -> String {
        if let verb = taxVerbs[rowId] { return verb }
        switch rowId {
        case "set-rule", "set-toggle", "set-auto-prompt": return "change"
        case "set-opt", "set-model": return "choose"
        case "set-test": return "test"
        case "set-system-reset": return "clear"
        case "set-rules-reset": return "reset"
        case "set-catchup": return "run it"
        case "set-catchup-stop": return "stop it"
        case "set-extract-all": return "start or stop it"
        case "set-extract-retry": return "try them again"
        case "set-extract-scans": return "read them by OCR"
        case "set-install": return "install"
        default: return showCheck ? "choose" : "open"
        }
    }

    // ... on a setting found from a search (its key: page, rowId, value, label); "show it": only its page, on it.
    static func settingKeyVerb(_ key: String) -> String {
        let k = key.components(separatedBy: "\u{1}")
        guard k.count > 1, !k[1].isEmpty else { return "open" }
        return doneFromTheSearch(k[1]) ? settingVerb(k[1]) : "show it"
    }
    var settingHitVerb: String { Self.settingKeyVerb(selectedSearchRow?.key ?? "") }
}
