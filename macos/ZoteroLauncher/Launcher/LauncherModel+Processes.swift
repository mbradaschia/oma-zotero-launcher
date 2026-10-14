import Foundation

// Processes (the runner's tasks), a paper's extracted text, and the catch-up that extracts every
// paper's (ZoteroSearch.qml:1218-1316, 3383-3400, 4201; Service.qml:966-1000, 1073, 1085-1225).
extension LauncherModel {
    var tasksFileURL: URL? { paths.map { URL(fileURLWithPath: $0.runnerTasks).appendingPathComponent("tasks.json") } }

    // The runner's tasks.json (its index of tasks), read again on any change in its folder.
    func watchTasks() {
        guard let dir = paths?.runnerTasks else { return }
        let folder = URL(fileURLWithPath: dir)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        if ai.tasksWatched != dir { // (the folder moved: XDG_STATE_HOME changed)
            ai.tasksWatched = dir
            tasksWatcher = FolderWatcher(folder, latency: 0.5) { [weak self] in MainActor.assumeIsolated { self?.readTasks() } }
        }
        readTasks()
    }

    func readTasks() {
        guard let url = tasksFileURL else { return }
        let list = (try? Data(contentsOf: url)).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
        setTasks(list?["tasks"] as? [[String: Any]] ?? [])
    }

    // A first write the watcher may miss (right after a launch): read again in a moment.
    func tasksSoon() {
        tasksTimer?.invalidate()
        tasksTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { [weak self] _ in MainActor.assumeIsolated { self?.readTasks() } }
    }

    // `tasks` (`--clear`: the finished ones go): the runner marks those whose process died.
    func refreshTasks(clear: Bool = false) {
        guard !ai.tasksAsking || clear else { return } // one at a time (a --clear goes all the same)
        ai.tasksAsking = true
        runRunner(clear ? ["tasks", "--clear"] : ["tasks"], timeout: 20) { [weak self] r in
            guard let self else { return }
            self.ai.tasksAsking = false
            if clear, self.searchState.syncTask?["status"] as? String != "running" { self.searchState.syncTask = nil }
            if let list = (r.json as? [String: Any])?["tasks"] as? [[String: Any]] { self.setTasks(list) } else { self.processesChanged() }
        }
    }

    private func setTasks(_ list: [[String: Any]]) {
        ai.tasks = list
        // a task about the paper whose menu is open, finished since its details were read: read again
        if let item = actionItem, ["actions", "notes", "extract-menu"].contains(store.view) {
            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let ended = list.contains { t in
                guard t["key"] as? String == item.key, (t["libraryID"] as? Int ?? 1) == item.libraryID, t["status"] as? String != "running",
                      let at = (t["finished"] as? String).flatMap({ iso.date(from: $0) ?? ISO8601DateFormatter().date(from: $0) }) else { return false }
                return at > ai.tasksRead
            }
            if ended {
                ai.tasksRead = Date()
                refreshDetails()
            }
        }
        processesChanged()
    }

    // Zotero's sync (phase 5) as a process, before the runner's.
    var processes: [[String: Any]] { (searchState.syncTask.map { [$0] } ?? []) + ai.tasks }
    var processesAndPending: [[String: Any]] { processes + pendingTasks }

    func processesChanged() {
        guard opened, ["tasks", "actions"].contains(store.view) else { return }
        store.followTop = false
        rebuildList()
    }

    func openTasks() {
        store.push("tasks")
        rebuildList()
        refreshTasks()
    }

    // Whether the runner is extracting this paper's text now (its menu's row says so).
    func extracting(_ item: PaperRef) -> Bool {
        ai.tasks.contains { $0["kind"] as? String == "extract" && $0["status"] as? String == "running" && $0["key"] as? String == item.key }
    }

    // Processes' rows and a paper's extracted text. → handled.
    func processAction(_ row: ListRow) -> Bool {
        switch row.rowId {
        case "task":
            if !row.noteKey.isEmpty { openNoteView(["key": row.noteKey, "libraryID": row.noteLibraryID, "title": row.label]) }
            else if !row.path.isEmpty { dismiss(); if !desktop.open(path: row.path) { notify("Couldn't open " + shown(row.path), "it isn't there any more, or no app opens it") } }
            else if !row.session.isEmpty { notYet("chat", key: keyName("c")) }
            else if !row.promptId.isEmpty {
                if let p = ai.prompts?.first(where: { $0["id"] as? String == row.promptId }) { openPromptEditor(p) } else { flashMessage("That prompt isn't there any more") }
            }
        case "tasks-clear": refreshTasks(clear: true)
        case "extract":
            if row.value == "read" { readExtracted(); return true }
            guard let item = actionItem, extractText(item, again: false) else { return true }
            flashMessage("Extracting the text: it's in Processes (\(keyName(".")))")
        case "ext-read": readExtracted()
        case "ext-again":
            guard let item = actionItem, extractText(item, again: true) else { return true }
            back()
            flashMessage("Extracting the text again (it replaces this one): it's in Processes (\(keyName(".")))")
        case "ext-zotero": openNoteInZotero(["key": row.noteKey, "libraryID": row.noteLibraryID, "title": "Extracted text"])
        case "ext-delete":
            back()
            askDeleteExtracted(["key": row.noteKey, "libraryID": row.noteLibraryID])
        default: return false
        }
        return true
    }

    // → launched (else said why).
    @discardableResult
    func extractText(_ item: PaperRef, again: Bool) -> Bool {
        let args = ["extract", "--key", item.key, "--library", String(item.libraryID == 0 ? 1 : item.libraryID)] + (again ? ["--force"] : [])
        guard runner.launch(runnerArgv(args)) else {
            flashMessage("Couldn't extract the text: " + RunnerResult(missing: true).problem)
            return false
        }
        tasksSoon()
        return true
    }

    var fulltextNote: [String: Any]? {
        (try? core?.glueJSON("fulltextNote", [details ?? NSNull()])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any]
    }

    func readExtracted() {
        guard let n = fulltextNote else { return }
        let title = (n["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Extracted text"
        openNoteView(["key": n["key"] ?? "", "libraryID": n["libraryID"] ?? 1, "title": title])
    }

    // Shift+Enter on Text extracted (or x there): read it, extract it again, open it in Zotero, delete it.
    func openExtractMenu() {
        guard fulltextNote != nil else { return }
        store.push("extract-menu")
        rebuildList()
    }

    // x: in a paper's menu, extract its text (extracted: its menu); on a result, its menu on that row.
    func extractKey() -> Bool {
        if store.view == "actions" {
            guard let i = listRows.firstIndex(where: { $0.rowId == "extract" }) else { return true }
            store.selectedIndex = i
            if !listRows[i].noteKey.isEmpty { openExtractMenu() } else { activateAction(i) }
            return true
        }
        if store.inSearch, let r = selectedSearchRow, r.kind == "item" {
            enterActionsFor(PaperRef(key: r.key, libraryID: r.libraryID, title: r.title, itemType: r.itemType), select: { $0.rowId == "extract" })
            return true
        }
        return false
    }

    // ---- Settings › Defaults › the paper's text: the catch-up (Service.qml:1085-1225)

    func loadExtractState() {
        guard let path = paths?.extract else { return }
        extractFile = ExtractFile.load(URL(fileURLWithPath: path))
        followSchedule() // (tried again every 2 minutes: Zotero away, a failed batch)
        guard extractFile?.catchup != nil || extractFile?.upToDate != nil else { return }
        if status != "ready" { return pingZotero() } // resumed once it answers (status becoming ready)
        extractTick() // resumes where it left off
        catchUpTick()
    }

    private func extractBody(_ limit: Int) -> [String: Any] {
        var body: [String: Any] = ["limit": limit, "exclude": Array((extractFile?.skipped ?? [:]).keys)]
        if let scope = extractFile?.catchup?["scope"] as? [String: Any] { body.merge(scope) { _, b in b } }
        return body
    }

    // How many are left (Settings shows it): in the catch-up's scope, else the whole library.
    func refreshExtractCount() {
        bridge.post("/extract/pending", extractBody(0), timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self, case .ok(let answer) = result else { return }
                self.ai.extractPending = answer["total"] as? Int
                self.runnerState.index = nil
                if self.opened && self.store.view == "settings-defaults" { self.store.followTop = false; self.rebuildList() }
            }
        }
    }

    func extractAction(_ row: ListRow) -> Bool {
        switch row.rowId {
        case "set-extract-all":
            if extractFile?.catchup != nil {
                saveExtractState(["catchup": nil])
                refreshExtractCount()
                flashMessage("Stopped: the papers done keep their text; Enter here goes on")
            } else {
                saveExtractState(["catchup": ["scope": NSNull(), "title": "", "done": 0, "skipped": 0, "failed": 0, "started": Self.isoNow()]])
                ai.extractPending = nil
                flashMessage("Extracting every paper's text, a few at a time: it's in Processes (\(keyName(".")))")
                if status == "ready" { extractTick() } else { pingZotero() } // a menu-bar app may not have asked Zotero yet
            }
        case "set-extract-scans": // the scans left alone, read by OCR now Tesseract is here: just those, a few at a time
            let ids = scansSkipped
            var sk = extractFile?.skipped ?? [:]
            ids.forEach { sk[$0] = nil }
            saveExtractState(["skipped": sk])
            ai.scanQueue += ids.filter { !ai.scanQueue.contains($0) }
            if status == "ready" { extractTick() } else { pingZotero() }
            flashMessage("Reading the \(ids.count) skipped \(ids.count == 1 ? "scan" : "scans") by OCR, a few at a time: it's in Processes (\(keyName(".")))")
        case "set-extract-retry":
            saveExtractState(["skipped": [String: Any]()])
            refreshExtractCount()
            flashMessage("The skipped papers will be tried again")
        default: return false
        }
        store.followTop = false
        rebuildList()
        return true
    }

    // The next three: /extract/pending, then `extract-batch` (waited), the counts kept, and on.
    // The next few: the catch-up's, else (on, and this machine runs the automation) new papers'.
    func extractTick() {
        guard !ai.extractRunning, status == "ready", runnerInstalled, let file = extractFile else { return }
        if !ai.scanQueue.isEmpty { // Read the N skipped scans by OCR
            let next = Array(ai.scanQueue.prefix(3))
            ai.scanQueue.removeFirst(next.count)
            return runExtractBatch(next.map { id in
                let p = id.split(separator: ":").map(String.init)
                return ["libraryID": Int(p.first ?? "") ?? 1, "key": p.count > 1 ? p[1] : ""]
            }, forCatchUp: false)
        }
        let catchup = file.catchup
        let auto = defaultOn("autoExtractNew") && automationHere
        if catchup == nil && !auto { return }
        if catchup == nil && file.since.isEmpty { return extractNewTurnedOn() } // on in the file: new from now
        var body = extractBody(3)
        if catchup == nil { body["since"] = file.since }
        ai.extractRunning = true
        bridge.post("/extract/pending", body, timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.noteBridge(result)
                guard case .ok(let answer) = result else { self.ai.extractRunning = false; return }
                if catchup != nil { self.ai.extractPending = answer["total"] as? Int }
                let items = answer["items"] as? [[String: Any]] ?? []
                guard !items.isEmpty else {
                    self.ai.extractRunning = false
                    guard let catchup, self.extractFile?.catchup != nil else { return } // new papers: none; a catch-up stopped meanwhile: not "done"
                    self.saveExtractState(["catchup": nil])
                    let done = catchup["done"] as? Int ?? 0, skipped = catchup["skipped"] as? Int ?? 0
                    self.notify("Extracted every paper's text" + ((catchup["title"] as? String).flatMap { $0.isEmpty ? nil : " in " + $0 } ?? ""),
                                "\(done) extracted" + (skipped > 0 ? ", \(skipped) skipped (scans, large PDFs: Settings › Defaults › Try the skipped again)" : ""))
                    return self.refreshExtractCount()
                }
                self.runExtractBatch(items, forCatchUp: catchup != nil)
            }
        }
    }

    // forCatchUp: its counts go to the catch-up (not when it was new papers' and a catch-up started meanwhile).
    func runExtractBatch(_ items: [[String: Any]], forCatchUp: Bool) {
        let ids = items.map { "\(($0["libraryID"] as? Int).flatMap { $0 == 0 ? nil : $0 } ?? 1):\($0["key"] as? String ?? "")" }.joined(separator: ",")
        let mb = ((settings?.raw["defaults"] as? [String: Any])?["extractMaxMB"] as? NSNumber)?.intValue ?? 40
        tasksSoon()
        ai.extractRunning = true
        runRunner(["extract-batch", "--items", ids, "--max-mb", String(mb)], timeout: 3600, quiet: false) { [weak self] r in // (OCR: minutes a scan)
            guard let self else { return }
            self.ai.extractRunning = false
            let results = (r.json as? [String: Any])?["results"] as? [[String: Any]] ?? []
            guard r.ok || !results.isEmpty else { return NSLog("ZoteroLauncher: extraction: %@", r.problem) } // tried again next time
            var skipped = self.extractFile?.skipped ?? [:]
            var done = 0, skip = 0, failed = 0
            for x in results {
                if x["status"] as? String == "saved" { done += 1; continue }
                skipped[x["id"] as? String ?? ""] = x["reason"] ?? x["status"] ?? "failed"
                if x["status"] as? String == "failed" { failed += 1 } else { skip += 1 }
            }
            self.refreshTasks()
            guard forCatchUp, var c = self.extractFile?.catchup else {
                self.saveExtractState(["skipped": skipped])
                if !self.ai.scanQueue.isEmpty { return self.extractTick() } // the next scans
                return self.refreshExtractCount()
            }
            c["done"] = (c["done"] as? Int ?? 0) + done
            c["skipped"] = (c["skipped"] as? Int ?? 0) + skip
            c["failed"] = (c["failed"] as? Int ?? 0) + failed
            self.saveExtractState(["skipped": skipped, "catchup": c]) // one write
            self.extractTick() // the next few
        }
    }

    var extractContext: [String: Any] {
        ["pending": ai.extractPending.map { $0 as Any } ?? NSNull(), "catchup": extractFile?.catchup ?? NSNull(), "skipped": extractFile?.skipped.count ?? 0,
         "scans": scansSkipped.count]
    }

    // The scans left alone that OCR can read now (Settings.js's isRetryableScan: not a scan OCR gave up on).
    var scansSkipped: [String] {
        (extractFile?.skipped ?? [:]).filter { _, why in
            let r = why as? String ?? ""
            return r.range(of: #"\bscan\b"#, options: [.regularExpression, .caseInsensitive]) != nil && r.range(of: #"read by OCR|OCR found"#, options: [.regularExpression, .caseInsensitive]) == nil
        }.map(\.key)
    }

    // The extracted text deleted (ext-delete, Delete on its row): asked first, to Zotero's trash.
    func askDeleteExtracted(_ note: [String: Any]) {
        askConfirm(ConfirmAsk(title: "Delete the extracted text?", yes: "Delete it (to Zotero's trash)", no: "Keep it",
                              detail: "A prompt or chat on this paper extracts it again when it needs it", run: { [weak self] in
            self?.bridge.post("/notes/trash", note, timeout: 8) { result in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    if case .ok = result { self.flashMessage("The extracted text is in Zotero's trash") } else { self.flashMessage("Couldn't delete it: " + result.message) }
                    self.refreshDetails()
                }
            }
        }))
    }
}

