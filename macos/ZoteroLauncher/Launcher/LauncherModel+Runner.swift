import Foundation

// The prompt runner from the launcher (Service.qml:1679-1745, 2045-2150): its providers, the models,
// a provider's test, API keys; Settings' state for Settings.js (ZoteroSearch.qml's settingsState).
extension LauncherModel {
    // The runner's argv for `args` (Client.promptArgv: settings.promptCommand, else oma-zotero-prompt).
    func runnerArgv(_ args: [String]) -> [String] {
        (try? core?.glue("promptArgv", [settingsJSON, args], as: [String].self)) ?? (["oma-zotero-prompt"] + args)
    }

    // A waited run. --quiet: the launcher says what failed itself (the runner's "Prompt failed"
    // notification would only repeat it).
    func runRunner(_ args: [String], stdin: String? = nil, timeout: TimeInterval, _ done: @escaping @MainActor (RunnerResult) -> Void) {
        runner.run(runnerArgv(args + ["--quiet"]), stdin: stdin, timeout: timeout) { [weak self] r in
            if r.missing || r.status == 127 { self?.runnerState.missing = true } else if r.ok { self?.runnerState.missing = false }
            done(r)
        }
    }

    // One run of `name` at a time: asked again meanwhile, it runs once more when this one ends.
    private func once(_ name: String, _ start: () -> Void) -> Bool {
        if runnerState.busy.contains(name) {
            runnerState.again.insert(name)
            return false
        }
        runnerState.busy.insert(name)
        start()
        return true
    }

    private func finished(_ name: String, again: () -> Void) {
        runnerState.busy.remove(name)
        if runnerState.again.remove(name) != nil { again() }
    }

    // Settings' pages show what the runner said: rebuilt where they are, the row kept.
    // (a paper's menu too: its Set up row follows whether the AI features are there)
    func settingsShowChange() {
        guard opened, store.inSettings || store.view == "actions" else { return }
        store.followTop = false
        rebuildList()
    }

    func refreshProviders() {
        _ = once("providers") {
            runRunner(["providers"], timeout: 20) { [weak self] r in
                guard let self else { return }
                if let info = r.json as? [String: Any] { self.runnerState.info = info } else if !r.ok { self.runnerState.info = nil }
                self.finished("providers") { self.refreshProviders() }
                self.autoTestKeys()
                self.settingsShowChange()
            }
        }
    }

    func refreshModels() {
        _ = once("models") {
            runRunner(["models", "--json"], timeout: 60) { [weak self] r in
                guard let self else { return }
                let answer = r.json as? [String: Any]
                self.runnerState.models = answer?["models"] is [Any] ? answer : nil
                self.runnerState.modelsProblem = self.runnerState.models == nil ? r.problem : ""
                self.finished("models") { self.refreshModels() }
                self.settingsShowChange()
            }
        }
    }

    // Tested: it lists its models, or says what's wrong; the result kept by the runner.
    func testProvider(_ id: String) {
        guard runnerState.tests[id]?["running"] as? Bool != true else { return }
        runnerState.tests[id] = ["running": true]
        settingsShowChange()
        runRunner(["provider-test", id], timeout: 60) { [weak self] r in
            guard let self else { return }
            var test = r.json as? [String: Any] ?? ["ok": false, "detail": r.problem]
            test["running"] = false
            self.runnerState.tests[id] = test
            self.afterTest()
            self.refreshProviders()
            self.settingsShowChange()
        }
    }

    // The key copied to the clipboard, handed to `secret set <id>` on stdin (never in an argv), then
    // the clipboard emptied if it still holds it.
    func setKeyFromClipboard(_ id: String) {
        let key = desktop.pasteboardText()?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if key.isEmpty { return flashMessage("Key not saved: the clipboard is empty: copy the key first") }
        flashMessage("Reading the key from the clipboard…")
        runnerState.tests[id] = nil
        runRunner(["secret", "set", id], stdin: key, timeout: 20) { [weak self] r in
            guard let self else { return }
            self.desktop.clearPasteboard(ifStill: key)
            self.refreshProviders()
            guard r.ok else { return self.flashMessage("Key not saved: " + r.problem) }
            self.flashMessage("The key is in the keyring, and the clipboard is cleared")
            self.testProvider(id)
        }
    }

    func removeKey(_ id: String) {
        runnerState.tests[id] = nil
        runRunner(["secret", "remove", id], timeout: 20) { [weak self] r in
            guard let self else { return }
            self.flashMessage(r.ok ? "Key removed from the keyring" : "Couldn't remove the key: " + r.problem)
            self.refreshProviders()
        }
    }

    // Keys never tested (or not since they changed): each tested once per opening of Settings, so
    // its row says whether it works (ZoteroSearch.qml:3659).
    func autoTestKeys() {
        guard opened, store.inSettings, let providers = runnerState.info?["providers"] as? [[String: Any]] else { return }
        for p in providers {
            guard let id = p["id"] as? String, p["takesKey"] as? Bool == true, (p["key"] as? [String: Any])?["set"] as? Bool == true else { continue }
            let test = p["test"] as? [String: Any]
            guard test == nil || test?["stale"] as? Bool == true, !runnerState.autoTested.contains(id), runnerState.tests[id] == nil else { continue }
            runnerState.autoTested.insert(id)
            testProvider(id)
        }
    }

    // A provider just turned on: without a default model yet, its first model becomes the default
    // once its test lists them (Claude needs none: it is the built-in default).
    func afterEnable(_ id: String) {
        let d = settings?.raw["defaults"] as? [String: Any]
        let model = { (k: String) in ((d?[k] as? [String: Any])?["model"] as? String) ?? "" }
        if id == "claude" || (!model("prompts").isEmpty && !model("chat").isEmpty) { return }
        runnerState.autoDefault = id
        testProvider(id)
    }

    func afterTest() {
        let id = runnerState.autoDefault
        guard !id.isEmpty, let t = runnerState.tests[id], t["running"] as? Bool != true else { return }
        runnerState.autoDefault = ""
        let models = t["models"] as? [[String: Any]] ?? []
        guard t["ok"] as? Bool == true, let first = models.first?["value"] as? String else {
            return flashMessage("On, but not working yet: " + (t["detail"] as? String ?? ""))
        }
        if changeSettings("fillDefaults", [first]) {
            refreshModels()
            flashMessage("Default model: \(first) (Settings › Defaults to change it)")
        }
    }

    // ---- what Settings.js's pages need (ZoteroSearch.qml's settingsState)

    var runnerInstalled: Bool { !runnerState.missing }

    var settingsContext: [String: Any] {
        let bridgeInfo: [String: Any] = ["status": status, "version": handshakeVersion, "zoteroVersion": "", "expected": RunnerKit.bundledBridgeVersion ?? ""]
        let node = runner.nodeVersion, pdf = runner.hasPdftotext
        var ctx: [String: Any] = ["bridge": bridgeInfo, "styles": settingsView.styles ?? NSNull(), "stylesProblem": settingsView.stylesProblem,
                                  "tests": runnerState.tests, "reqs": ["node": node, "pdftotext": pdf],
                                  "setup": ["zotero": desktop.zoteroInstalled, "running": desktop.zoteroRunning, "node": node, "pdftotext": pdf],
                                  "runner": ["installed": runnerInstalled, "installing": runnerState.installing, "update": RunnerKit.update(home: env["HOME"] ?? NSHomeDirectory()).map { $0 as Any } ?? NSNull()]]
        if let info = runnerState.info { ctx["info"] = info }
        if let models = runnerState.models {
            ctx["models"] = models
            ctx["defaults"] = models["defaults"] ?? ["prompts": "", "chat": ""]
        }
        return ctx
    }

    // Whether the AI features still need setting up (the menu's Setup row, Settings.needsSetup).
    var needsSetup: Bool { (try? core?.glue("needsSetup", [settingsJSON, settingsContext], as: Bool.self)) ?? true }
}
