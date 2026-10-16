import Foundation

// Processes' controls (R14, R15): Stop all heads the list while anything runs or waits (the queues emptied, the
// running ones stopped), and pills show one state at a time.
extension LauncherModel {
    struct ProcessFilter: Equatable { let id: String; let label: String; let count: Int }

    static let processStates: [(id: String, label: String)] = [("", "All"), ("running", "Running"), ("pending", "Pending"), ("done", "Finished"), ("error", "Failed")]

    var processFilters: [ProcessFilter] {
        let all = processesAndPending
        return Self.processStates.map { s in ProcessFilter(id: s.id, label: s.label, count: s.id.isEmpty ? all.count : all.filter { $0["status"] as? String == s.id }.count) }
    }

    func setProcessFilter(_ id: String) {
        ai.taskFilter = id
        store.followTop = true
        rebuildList()
    }

    // Processes' rows: the pill's state only; Stop all first while something runs or waits.
    func processRows(_ core: JSCore) throws -> [ListRow] {
        let all = processesAndPending
        let shown = ai.taskFilter.isEmpty ? all : all.filter { $0["status"] as? String == ai.taskFilter }
        var rows = try core.glue("taskRows", [shown, store.filterText, Self.accentHex, nowMs], as: [ListRow].self)
        let running = all.filter { $0["status"] as? String == "running" }.count, pending = all.filter { $0["status"] as? String == "pending" }.count
        if running + pending > 0 {
            let detail = [running > 0 ? "\(running) running" : "", pending > 0 ? "\(pending) waiting" : ""].filter { !$0.isEmpty }.joined(separator: ", ")
            let stop = try core.call("Views", "listRow", [["rowId": "tasks-stop-all", "icon": "\u{f04d}", "label": "Stop all processes", "detail": detail + " · what's done stays", "available": true]], as: ListRow.self)
            rows.insert(stop, at: 0)
        }
        return rows
    }

    // Everything waiting dropped (a catch-up, Extract every paper's text, the scans, the papers queued to tag), then
    // every running process stopped (its runner: what it saved stays; a note being written isn't).
    func stopAllProcesses() {
        let running = processes.filter { $0["status"] as? String == "running" }
        var changes: [String: Any?] = [:]
        if extractFile?.upToDate != nil { changes["update"] = nil as Any? }
        if extractFile?.catchup != nil { changes["catchup"] = nil as Any? }
        if !changes.isEmpty { saveExtractState(changes) }
        ai.scanQueue = []
        // the papers queued to tag: no longer "Tagging…"
        let queued = sched.classifyQueue.flatMap { $0.items }.map { "\($0["libraryID"] as? Int ?? 1):\($0["key"] as? String ?? "")" }
        sched.classifyQueue = []
        sched.classifying.subtract(queued)
        var stopped = 0
        for t in running {
            if let pid = (t["pid"] as? NSNumber)?.int32Value, pid > 0 { killProcess(pid); stopped += 1 }
        }
        flashMessage("Stopped: " + (stopped == 1 ? "1 running process" : "\(stopped) running processes") + ", and what was waiting")
        refreshCatchUp()
        tasksSoon()
        store.followTop = true
        rebuildList()
    }
}
