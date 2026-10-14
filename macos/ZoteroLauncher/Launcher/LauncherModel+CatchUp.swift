import Foundation

// Settings › Defaults › Bring papers up to date (Service.qml:1536-1663): the runner counts what's
// out of date (`catchup-plan`), Enter runs one part's jobs one at a time (extract, classify, a
// prompt), kept in extract.json's `update` so it resumes; the waiting ones are in Processes.
extension LauncherModel {
    // The plan's argv: stale taxonomies and prompts, and what New papers runs on the papers added lately.
    var catchUpArgs: [String] {
        let prompts = autoPromptIds
        return ["catchup-plan", "--stale-taxonomies", "--stale-prompts", "--since", Self.zoteroDate(daysAgo: Double(catchUpDays))]
            + (defaultOn("autoTagNew") ? ["--tag"] : []) + (defaultOn("autoExtractNew") ? ["--extract"] : []) + (prompts.isEmpty ? [] : ["--prompts", prompts.joined(separator: ",")])
    }

    func refreshCatchUp() {
        guard runnerInstalled else { return }
        _ = once("catchup-plan") {
            sched.plan = nil // "Counting…"
            settingsShowChange()
            runRunner(catchUpArgs, timeout: 300, quiet: false) { [weak self] r in // (as the QML: it notifies nothing)
                guard let self else { return }
                let plan = r.json as? [String: Any]
                self.sched.planProblem = plan == nil ? (r.ok ? "the runner didn't answer" : r.problem) : ""
                self.sched.plan = plan ?? [:]
                self.finished("catchup-plan") { self.refreshCatchUp() }
                self.settingsShowChange()
            }
        }
    }

    // One part's jobs (taxonomies, prompts, recent). → "" when started, else why not.
    func startCatchUp(_ kind: String, title: String) -> String {
        if extractFile?.upToDate != nil { return "One is running: stop it first" }
        guard let part = sched.plan?[kind] as? [String: Any] else { return "Still counting" }
        let skipped = extractFile?.skipped ?? [:]
        let jobs = (part["jobs"] as? [[String: Any]] ?? []).filter { $0["op"] as? String != "extract" || skipped[$0["id"] as? String ?? ""] == nil }
        if jobs.isEmpty { return "Nothing to do" }
        saveExtractState(["update": ["kind": kind, "title": title, "jobs": jobs, "done": 0, "failed": 0, "started": Self.isoNow()]])
        if status == "ready" { catchUpTick() } else { pingZotero() } // on when Zotero answers (status becoming ready)
        return ""
    }

    func stopCatchUp() {
        saveExtractState(["update": nil])
        refreshCatchUp()
    }

    // The next job, or (none left) done.
    func catchUpTick() {
        guard let u = extractFile?.upToDate, !sched.catchUpRunning, status == "ready", runnerInstalled else { return }
        let jobs = u["jobs"] as? [[String: Any]] ?? []
        guard let job = jobs.first else {
            saveExtractState(["update": nil])
            let failed = u["failed"] as? Int ?? 0
            notify((u["title"] as? String ?? "Catch up") + " is done", "\(u["done"] as? Int ?? 0) done" + (failed > 0 ? ", \(failed) failed (in Processes)" : ""))
            return refreshCatchUp()
        }
        let id = job["id"] as? String ?? "", parts = id.split(separator: ":").map(String.init)
        let op = job["op"] as? String ?? ""
        let mb = (defaultsRaw["extractMaxMB"] as? NSNumber)?.intValue ?? 40
        let only = job["only"] as? [String] ?? []
        let args = op == "extract" ? ["extract-batch", "--items", id, "--max-mb", String(mb)]
            : op == "classify" ? ["classify", "--items", id] + (only.isEmpty ? [] : ["--taxonomies", only.joined(separator: ",")])
            : ["run", job["prompt"] as? String ?? "", "--key", parts.count > 1 ? parts[1] : "", "--library", parts.first ?? "1", "--extract-first"]
        sched.catchUpRunning = true
        tasksSoon()
        runRunner(args, timeout: 3600, quiet: false) { [weak self] r in
            guard let self else { return }
            let results = (r.json as? [String: Any])?["results"] as? [[String: Any]] ?? []
            let ok = op == "extract" ? results.first?["status"] as? String == "saved"
                : op == "classify" ? !results.isEmpty && results.allSatisfy { $0["status"] as? String == "tagged" } : r.ok
            if ok { return self.catchUpJobDone(job, ok: true, results) }
            // failed: Zotero gone? Then the job waits for it (not counted failed, nor the rest after it)
            self.bridge.post("/sync/status", [:], timeout: 4) { [weak self] status in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    self.noteBridge(status)
                    guard case .ok = status else { self.sched.catchUpRunning = false; return self.refreshTasks() }
                    self.catchUpJobDone(job, ok: false, results)
                }
            }
        }
    }

    // A job's end: counted, taken off the list (still the first one: not stopped meanwhile), the next.
    private func catchUpJobDone(_ job: [String: Any], ok: Bool, _ results: [[String: Any]]) {
        sched.catchUpRunning = false
        let id = job["id"] as? String ?? "", op = job["op"] as? String ?? ""
        var changes: [String: Any?] = [:]
        if op == "extract", !ok, let first = results.first {
            var sk = extractFile?.skipped ?? [:]
            sk[id] = first["reason"] ?? first["status"] ?? "failed" // left alone, like the others
            changes["skipped"] = sk
        }
        if var cur = extractFile?.upToDate, var left = cur["jobs"] as? [[String: Any]], let first = left.first,
           first["id"] as? String == id, first["op"] as? String == op, first["prompt"] as? String == job["prompt"] as? String {
            left.removeFirst()
            cur["jobs"] = left
            cur[ok ? "done" : "failed"] = (cur[ok ? "done" : "failed"] as? Int ?? 0) + 1
            changes["update"] = cur
        }
        if !changes.isEmpty { saveExtractState(changes) }
        refreshTasks()
        catchUpTick()
    }

    // set-catchup, set-catchup-stop, set-auto-prompt, pe-auto. → handled.
    func scheduleAction(_ row: ListRow) -> Bool {
        switch row.rowId {
        case "set-catchup":
            let days = catchUpDays
            let title = row.value == "taxonomies" ? "Tagging again where a taxonomy changed" : row.value == "prompts" ? "Running prompts again where they changed"
                : "Catching up the last \(days) \(days == 1 ? "day" : "days")"
            let why = startCatchUp(row.value, title: title)
            flashMessage(why.isEmpty ? "Started: one at a time, in the background (in Processes)" : why)
        case "set-catchup-stop":
            stopCatchUp()
            flashMessage("Stopped: the one running finishes (in Processes)")
        case "set-auto-prompt": toggleAutoPrompt(row.value); return true
        case "pe-auto":
            guard let id = ai.promptEdit?["id"] as? String else { return true }
            toggleAutoPrompt(id)
            return true
        default: return false
        }
        store.followTop = false
        rebuildList()
        return true
    }

    // What waits its turn, for Processes: a catch-up's jobs after the running one, the papers left
    // in Extract every paper's text, the papers queued to tag (Service.qml's pendingTasks).
    var pendingTasks: [[String: Any]] {
        var out: [[String: Any]] = []
        let title = { (id: String) in (self.ai.prompts?.first { $0["id"] as? String == id }?["title"] as? String).map { "“\($0)”" } ?? id }
        if let u = extractFile?.upToDate {
            let jobs = (u["jobs"] as? [[String: Any]] ?? []).dropFirst(sched.catchUpRunning ? 1 : 0)
            for (i, j) in jobs.enumerated() {
                let op = j["op"] as? String
                out.append(["id": "pending:update:\(i)", "status": "pending", "title": op == "extract" ? "Extract the text" : op == "classify" ? "Tag by taxonomies" : "Run " + title(j["prompt"] as? String ?? ""),
                            "paper": j["title"] ?? "", "detail": u["title"] ?? ""])
            }
        }
        if let c = extractFile?.catchup, let n = ai.extractPending, n > 0 {
            out.append(["id": "pending:extract-all", "status": "pending", "title": "Extract every paper's text", "paper": "",
                        "detail": "\(n) \(n == 1 ? "paper" : "papers") left" + ((c["title"] as? String).flatMap { $0.isEmpty ? nil : " in " + $0 } ?? "")])
        }
        for (i, q) in sched.classifyQueue.enumerated() {
            for (k, it) in q.items.enumerated() { out.append(["id": "pending:classify:\(i):\(k)", "status": "pending", "title": "Tag by taxonomies", "paper": it["title"] ?? "", "detail": "Queued"]) }
        }
        return out
    }

    var pendingCount: Int { pendingTasks.count }

    // Settings.js's catchUp: { plan, running: { title, left, done, failed } | null, problem }.
    var catchUpContext: [String: Any] {
        let running: Any = extractFile?.upToDate.map { u -> Any in
            ["title": u["title"] ?? "", "left": (u["jobs"] as? [Any])?.count ?? 0, "done": u["done"] ?? 0, "failed": u["failed"] ?? 0]
        } ?? NSNull()
        return ["plan": sched.plan ?? NSNull(), "running": running, "problem": sched.planProblem]
    }
}
