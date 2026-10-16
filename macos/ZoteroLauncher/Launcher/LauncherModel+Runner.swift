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
    // (quiet: false for the background runs: the runner's notifications tell how they went)
    func runRunner(_ args: [String], stdin: String? = nil, timeout: TimeInterval, quiet: Bool = true, _ done: @escaping @MainActor (RunnerResult) -> Void) {
        runner.run(runnerArgv(args + (quiet ? ["--quiet"] : [])), stdin: stdin, timeout: timeout) { [weak self] r in
            if !r.timedOut { self?.runnerState.missing = r.missing || r.status == 127 } // as runnerMissing, on every answer
            done(r)
        }
    }

    // One run of `name` at a time: asked again meanwhile, it runs once more when this one ends.
    func once(_ name: String, _ start: () -> Void) -> Bool {
        if runnerState.busy.contains(name) {
            runnerState.again.insert(name)
            return false
        }
        runnerState.busy.insert(name)
        start()
        return true
    }

    func finished(_ name: String, again: () -> Void) {
        runnerState.busy.remove(name)
        if runnerState.again.remove(name) != nil { again() }
    }

    // Settings' pages show what the runner said: rebuilt where they are, the row kept.
    // (a paper's menu too: its Set up row follows whether the AI features are there)
    func settingsShowChange() {
        runnerState.index = nil // the settings found from the search: built again when next needed
        guard opened, store.inSettings || ["actions", "prompts", "prompt-edit", "prompt-model", "prompt-effort"].contains(store.view) else { return }
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
        let gen = (runnerState.testGen[id] ?? 0) + 1
        runnerState.testGen[id] = gen
        settingsShowChange()
        runRunner(["provider-test", id], timeout: 60) { [weak self] r in
            guard let self, self.runnerState.testGen[id] == gen else { return } // a newer test (another key) answers for it
            var test = r.json as? [String: Any] ?? ["ok": false, "detail": r.problem]
            test["running"] = false
            self.runnerState.tests[id] = test
            self.afterTest()
            self.refreshProviders(); if id == "jev" { self.refreshTaxonomies() } // (the Jev key: Settings › Models & providers, the menu, a scope's price)
            self.settingsShowChange()
        }
    }

    // The key copied to the clipboard, handed to `secret set <id>` on stdin (never in an argv), then
    // the clipboard emptied if it still holds it.
    func setKeyFromClipboard(_ id: String) {
        let copied = desktop.pasteboardText() ?? ""
        let key = copied.filter { !$0.isWhitespace } // as the QML's tr -d [:space:]
        if key.isEmpty { return flashMessage("Key not saved: the clipboard is empty: copy the key first") }
        // something else copied (a password, another vendor's token) isn't stored, nor sent off to be tested
        if let why = Self.notAKey(key, for: id) { return flashMessage("Key not saved: " + why) }
        flashMessage("Reading the key from the clipboard…")
        forgetTest(id)
        runRunner(["secret", "set", id], stdin: key, timeout: 20) { [weak self] r in
            guard let self else { return }
            self.refreshProviders(); if id == "jev" { self.refreshTaxonomies() } // (the Jev key: Settings › Models & providers, the menu, a scope's price)
            guard r.ok else { return self.flashMessage("Key not saved: " + r.problem) }
            self.desktop.clearPasteboard(ifStill: copied.trimmingCharacters(in: .whitespacesAndNewlines))
            self.flashMessage("The key is in the Keychain, and the clipboard is cleared")
            self.testProvider(id)
        }
    }

    // An API key's shape, for the providers whose keys have one: → why it isn't one, else nil.
    static func notAKey(_ key: String, for id: String) -> String? {
        if key.count > 512 { return "that's too long to be an API key" }
        let prefixes: [String: (prefix: String, name: String)] = ["openai": ("sk-", "OpenAI"), "anthropic": ("sk-ant-", "Anthropic"),
                                                                  "google": ("AIza", "Google AI Studio"), "openrouter": ("sk-or-", "OpenRouter")]
        guard let want = prefixes[id], !key.hasPrefix(want.prefix) else { return nil }
        return "that doesn't look like an \(want.name) key (they start with \(want.prefix)); the clipboard is left as it was"
    }

    // A test of a key about to change: forgotten, and its answer ignored if it still comes.
    func forgetTest(_ id: String) {
        runnerState.tests[id] = nil
        runnerState.testGen[id] = (runnerState.testGen[id] ?? 0) + 1
    }

    func removeKey(_ id: String) {
        forgetTest(id)
        runRunner(["secret", "remove", id], timeout: 20) { [weak self] r in
            guard let self else { return }
            self.flashMessage(r.ok ? "Key removed from the Keychain" : "Couldn't remove the key: " + r.problem)
            self.refreshProviders(); if id == "jev" { self.refreshTaxonomies() } // (the Jev key: Settings › Models & providers, the menu, a scope's price)
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
        if changeSettings("fillDefaults", [first], refresh: false).ok {
            refreshModels()
            flashMessage("Default model: \(first) (Settings › Defaults to change it)")
        }
    }

    // ---- what Settings.js's pages need (ZoteroSearch.qml's settingsState)

    var runnerInstalled: Bool { !runnerState.missing }

    // Node, pdftotext, Zotero and the runner's version as this Mac has them: asked off the main
    // thread when Settings opens (Node may have been installed since), kept meanwhile.
    func refreshRequirements() {
        runner.requirements { [weak self] reqs in
            guard let self else { return }
            self.runnerState.reqs = reqs
            self.runnerState.zotero = (self.desktop.zoteroInstalled, self.desktop.zoteroRunning)
            self.runnerState.update = RunnerKit.update(home: self.env["HOME"] ?? NSHomeDirectory(), dataHome: self.env["XDG_DATA_HOME"])
            self.settingsShowChange()
        }
    }

    var settingsContext: [String: Any] {
        let bridgeInfo: [String: Any] = ["status": status, "version": handshakeVersion, "zoteroVersion": "", "expected": RunnerKit.bundledBridgeVersion ?? ""]
        let reqs = runnerState.reqs
        var ctx: [String: Any] = ["bridge": bridgeInfo, "styles": settingsView.styles ?? NSNull(), "stylesProblem": settingsView.stylesProblem,
                                  "tests": runnerState.tests, "reqs": ["node": reqs.node, "pdftotext": reqs.pdftotext, "tesseract": reqs.tesseract],
                                  "setup": ["zotero": runnerState.zotero.installed, "running": runnerState.zotero.running || status == "ready", "node": reqs.node, "pdftotext": reqs.pdftotext, "tesseract": reqs.tesseract],
                                  "runner": ["installed": runnerInstalled, "installing": runnerState.installing, "update": runnerState.update.map { $0 as Any } ?? NSNull()]]
        ctx["rules"] = ai.rulesJSON
        if !ai.rulesMissing.isEmpty { ctx["rulesMissing"] = ai.rulesMissing }
        ctx["instructions"] = ai.instructions
        ctx["extract"] = extractContext
        ctx["catchUp"] = catchUpContext
        ctx["automation"] = ["host": automationHost, "here": automationHere, "machine": paths?.machine ?? "", "synced": paths?.syncDir != nil]
        if let report = tax.report { ctx["taxonomies"] = report }
        if ai.prompts != nil { ctx["prompts"] = ai.promptsJSON }
        if let info = runnerState.info { ctx["info"] = info }
        if let models = runnerState.models {
            ctx["models"] = models
            ctx["defaults"] = models["defaults"] ?? ["prompts": "", "chat": ""]
        }
        return ctx
    }

    // Whether the AI features still need setting up (Settings.needsSetup): not installed, or no
    // provider on yet.
    var needsSetup: Bool {
        guard runnerInstalled else { return true }
        guard let providers = runnerState.info?["providers"] as? [[String: Any]] else { return false }
        return !providers.contains { $0["enabled"] as? Bool == true }
    }
}
