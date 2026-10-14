import Foundation

// The background automation (Service.qml:1078-1530; macos/PLAN.md phase 7): new papers' text,
// their taxonomies and the prompts you run on them, a paper's text when you open it; one timer,
// two minutes, while any of it is on; and automationHost (decision 13): only the machine it names
// runs the automatic part. It runs while the app runs: nothing is scheduled when it's quit.
extension LauncherModel {
    var defaultsRaw: [String: Any] { settings?.raw["defaults"] as? [String: Any] ?? [:] }
    func defaultOn(_ key: String) -> Bool { defaultsRaw[key] as? Bool == true }
    var autoPromptIds: [String] {
        let ids = defaultsRaw["autoPrompts"] as? [String] ?? []
        guard let prompts = ai.prompts else { return ids } // all of them while the list is read
        return ids.filter { id in prompts.contains { $0["id"] as? String == id } }
    }

    // automationHost: empty, every machine; a name, only the machine of that name (case aside).
    var automationHost: String { settings?.raw["automationHost"] as? String ?? "" } // (General's settings sit at the top)
    var automationHere: Bool {
        let host = automationHost.trimmingCharacters(in: .whitespaces).lowercased()
        return host.isEmpty || host == (paths?.machine ?? "").trimmingCharacters(in: .whitespaces).lowercased()
    }

    // Zotero's date (UTC, "YYYY-MM-DD HH:MM:SS"), now or `days` days ago.
    static func zoteroDate(daysAgo days: Double = 0) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f.string(from: Date().addingTimeInterval(-days * 86400))
    }

    // The timer, while something is on (the QML's extractTimer).
    func followSchedule() {
        let on = defaultOn("autoExtractNew") || defaultOn("autoTagNew") || !(defaultsRaw["autoPrompts"] as? [Any] ?? []).isEmpty
            || extractFile?.catchup != nil || extractFile?.upToDate != nil
        guard on else { extractTimer?.invalidate(); extractTimer = nil; return }
        guard extractTimer == nil else { return }
        extractTimer = Timer.scheduledTimer(withTimeInterval: 120, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.scheduleTick() } }
    }

    // Each tick; Zotero not known to answer yet (a menu-bar app may not have searched): asked first,
    // and the ticks follow when it does (`status` becoming ready).
    func scheduleTick() {
        guard status == "ready" else { return pingZotero() }
        extractTick()
        tagTick()
        promptTick()
        catchUpTick()
    }

    func pingZotero() {
        bridge.post("/sync/status", [:], timeout: 4) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self else { return }
                switch result {
                case .ok: self.status = "ready"
                case .zoteroDown, .noHandshake: self.status = "zotero-down"
                default: break
                }
            }
        }
    }

    // Zotero answers again (it started, came back): what waited for it goes on (onStatusChanged).
    func zoteroIsBack() {
        extractTick()
        tagTick()
        promptTick()
        catchUpTick()
    }

    func saveExtractState(_ changes: [String: Any?]) {
        do { try extractFile?.update(changes) } catch { lastError = "Couldn't save " + shown(paths?.extract ?? "extract.json") + ": " + error.localizedDescription }
        runnerState.index = nil
        followSchedule()
        if opened && ["settings-defaults", "settings-auto-prompts"].contains(store.view) { store.followTop = false; rebuildList() }
    }

    // ---- turned on: from now (the papers before are a catch-up's)

    func extractNewTurnedOn() { saveExtractState(["since": Self.zoteroDate()]) }
    func tagNewTurnedOn() { saveExtractState(["tagSince": Self.zoteroDate(), "tagged": extractFile?.tagged ?? [:]]) }
    func autoPromptTurnedOn(_ id: String) {
        var all = extractFile?.autoPrompts ?? [:]
        all[id] = ["since": Self.zoteroDate(), "done": [String: Any]()]
        saveExtractState(["autoPrompts": all])
        promptTick()
    }

    // set-auto-prompt (Defaults › Prompts to run on new papers) and pe-auto (the editor).
    func toggleAutoPrompt(_ id: String) {
        var ids = defaultsRaw["autoPrompts"] as? [String] ?? []
        let on = !ids.contains(id)
        if on { ids.append(id) } else { ids.removeAll { $0 == id } }
        guard changeSettings("value", ["defaults.autoPrompts", ids], refresh: false).ok else { return }
        if on { autoPromptTurnedOn(id) }
        flashMessage(on ? "On: it runs on each paper added from now on (in Processes)" : "Off: new papers no longer get it")
        followSchedule()
        store.followTop = false
        rebuildList()
    }

    // ---- new papers' taxonomies

    func tagTick() {
        guard defaultOn("autoTagNew"), automationHere, !sched.classifyRunning, status == "ready", runnerInstalled, let file = extractFile else { return }
        if file.tagSince.isEmpty { return tagNewTurnedOn() }
        let body: [String: Any] = ["since": file.tagSince, "exclude": Array(file.tagged.keys), "textFirst": defaultOn("autoExtractNew"),
                                   "textless": Array(file.skipped.keys), "limit": 3]
        bridge.post("/papers/select", body, timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self, case .ok(let answer) = result, let items = answer["items"] as? [[String: Any]], !items.isEmpty else { return }
                self.classify(items) { results in
                    var tagged = self.extractFile?.tagged ?? [:]
                    for r in results { tagged[r["id"] as? String ?? ""] = r["status"] ?? "failed" } // once each, tagged or not
                    self.saveExtractState(["tagged": tagged])
                }
            }
        }
    }

    // The classify queue: one `classify` at a time, the papers "Tagging…" meanwhile.
    func classify(_ items: [[String: Any]], only: [String] = [], _ done: @escaping @MainActor ([[String: Any]]) -> Void) {
        sched.classifyQueue.append((items, only, done))
        nextClassify()
    }

    private func nextClassify() {
        guard !sched.classifyRunning, !sched.classifyQueue.isEmpty else { return }
        let job = sched.classifyQueue.removeFirst()
        sched.classifyRunning = true
        let ids = job.items.map { "\(($0["libraryID"] as? Int).flatMap { $0 == 0 ? nil : $0 } ?? 1):\($0["key"] as? String ?? "")" }
        ids.forEach { sched.classifying.insert($0) }
        let args = ["classify", "--items", ids.joined(separator: ",")] + (job.only.isEmpty ? [] : ["--taxonomies", job.only.joined(separator: ",")])
        tasksSoon()
        runRunner(args, timeout: 1800, quiet: false) { [weak self] r in
            guard let self else { return }
            var results = (r.json as? [String: Any])?["results"] as? [[String: Any]] ?? []
            if !r.ok && results.isEmpty { results = ids.map { ["id": $0, "status": "failed", "reason": r.problem] } }
            ids.forEach { self.sched.classifying.remove($0) }
            self.sched.classifyRunning = false
            self.refreshTasks()
            job.done(results)
            self.nextClassify()
        }
    }

    // ---- prompts on new papers

    func promptTick() {
        let ids = autoPromptIds
        guard !ids.isEmpty, automationHere, !sched.promptRunning, status == "ready", runnerInstalled, let file = extractFile else { return }
        let missing = ids.filter { file.autoPrompts[$0] == nil }
        if !missing.isEmpty { return missing.forEach(autoPromptTurnedOn) } // on in the file: from now
        nextPrompt(ids, 0)
    }

    // The first prompt (in your order) with a new paper it hasn't run on: a paper three minutes old at
    // least (its PDF may still be on its way), after its text when new papers' text is extracted.
    private func nextPrompt(_ ids: [String], _ i: Int) {
        guard i < ids.count, !sched.promptRunning, let st = extractFile?.autoPrompts[ids[i]] as? [String: Any] else { return }
        let body: [String: Any] = ["since": st["since"] ?? "", "before": Self.zoteroDate(daysAgo: 3.0 / 1440), "exclude": Array((st["done"] as? [String: Any] ?? [:]).keys),
                                   "textFirst": defaultOn("autoExtractNew"), "textless": Array((extractFile?.skipped ?? [:]).keys), "limit": 1]
        bridge.post("/papers/select", body, timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self else { return }
                guard case .ok(let answer) = result, let it = (answer["items"] as? [[String: Any]])?.first else { return self.nextPrompt(ids, i + 1) }
                guard !self.sched.promptRunning else { return }
                self.sched.promptRunning = true
                let lib = (it["libraryID"] as? Int).flatMap { $0 == 0 ? nil : $0 } ?? 1
                let paper = "\(lib):\(it["key"] as? String ?? "")"
                self.tasksSoon()
                self.runRunner(["run", ids[i], "--key", it["key"] as? String ?? "", "--library", String(lib), "--extract-first"], timeout: 3600, quiet: false) { r in
                    self.sched.promptRunning = false
                    var all = self.extractFile?.autoPrompts ?? [:]
                    if var s = all[ids[i]] as? [String: Any] {
                        var done = s["done"] as? [String: Any] ?? [:]
                        done[paper] = r.ok ? "done" : "failed" // once each, either way
                        s["done"] = done
                        all[ids[i]] = s
                        self.saveExtractState(["autoPrompts": all])
                    }
                    self.refreshTasks()
                    self.promptTick() // the next one
                }
            }
        }
    }

    // ---- a paper opened

    // Its text extracted in the background (Defaults › Extract a paper's text when you open it).
    func paperOpened() {
        guard let item = actionItem, let d = details, let paper = d["item"] as? [String: Any],
              !["note", "attachment"].contains(paper["itemType"] as? String ?? ""), defaultOn("extractOnOpen"), runnerInstalled, !extracting(item) else { return }
        let id = "\(item.libraryID == 0 ? 1 : item.libraryID):\(item.key)"
        let hasPdf = (try? core?.glue("hasPdf", [d], as: Bool.self)) ?? false
        guard hasPdf, fulltextNote == nil, extractFile?.skipped[id] == nil, extractText(item, again: false) else { return }
        flashMessage("Extracting its text")
    }
}
