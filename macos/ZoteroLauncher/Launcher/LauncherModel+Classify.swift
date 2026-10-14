import Foundation

// Taxonomies on a paper (phase 9; ZoteroSearch.qml's classify, audit and tax-paper cases, Service.qml's paperOpened):
// Tag by taxonomies, Audit the taxonomies, the paper's Taxonomies page, a label's papers, the strip under the context
// bar and the footer's pills, Tag a paper when you open it, and Go to › Tag “…”'s papers by taxonomies in a scope.
extension LauncherModel {
    var paperId: String? { actionItem.map { "\($0.libraryID == 0 ? 1 : $0.libraryID):\($0.key)" } }
    var classifyingPaper: Bool { paperId.map { sched.classifying.contains($0) || tax.afterText[$0] != nil } ?? false }
    var jevKeySet: Bool { ((tax.report?["jev"] as? [String: Any])?["key"] as? [String: Any])?["set"] as? Bool == true }

    private var isPaper: Bool {
        (details?["item"] as? [String: Any]).map { !["note", "attachment"].contains($0["itemType"] as? String ?? "") } ?? false
    }

    // The menu's extras for its taxonomy rows (ZoteroSearch.qml's actionExtras).
    var taxonomyExtras: [String: Any] {
        guard isPaper, !tax.taxonomies.isEmpty else { return [:] }
        return ["taxonomies": tax.taxonomies, "taxStatus": tax.status ?? NSNull(), "jev": jevKeySet, "classifying": classifyingPaper]
    }

    // classify-status of the paper open (its menu's Tag again: out of date, the audit's row). then: its stale ids.
    // (a later read for the same paper answers a waiting `then` too: a classify run ending meanwhile doesn't drop it)
    func refreshTaxStatus(_ then: (([String]?) -> Void)? = nil) {
        tax.statusSerial += 1
        let serial = tax.statusSerial
        if let then { tax.statusThen = then }
        guard let item = actionItem, runnerInstalled, !tax.taxonomies.isEmpty else {
            tax.status = nil
            let t = tax.statusThen
            tax.statusThen = nil
            t?(nil)
            return
        }
        runRunner(["classify-status", "--json", "--items", "\(item.libraryID == 0 ? 1 : item.libraryID):\(item.key)"], timeout: 30) { [weak self] r in
            guard let self, serial == self.tax.statusSerial, self.actionItem?.key == item.key else { return }
            self.tax.status = ((r.json as? [String: Any])?["items"] as? [[String: Any]])?.first
            if ["actions", "tax-paper"].contains(self.store.view) { self.store.followTop = false; self.rebuildList() }
            let t = self.tax.statusThen
            self.tax.statusThen = nil
            t?(self.tax.status?["stale"] as? [String])
        }
    }

    // ---- the views

    func classifyViewRows(_ core: JSCore) throws -> [ListRow] {
        if store.view == "tax-audit" {
            if tax.audit == nil && !tax.problem.isEmpty { // (not "Reading the result…" for ever)
                return [try core.call("Views", "listRow", [["rowId": "tax-audit-info", "icon": "\u{f071}", "label": "Couldn't read the result: " + tax.problem, "detail": "Back, then Audit the taxonomies tries again", "available": false]], as: ListRow.self)]
            }
            return try core.glue("taxonomyAudit", [tax.audit ?? NSNull(), details?["tags"] ?? []], as: [ListRow].self)
        }
        let rows = try core.glue("paperTaxonomies", [details ?? NSNull(), tax.taxonomies, tax.status?["classified"] as? Bool == true], as: [ListRow].self)
        // the paper being tagged: its Tag rows wait (the QML let it be queued twice)
        return rows.map { var r = $0; if r.rowId == "classify" && classifyingPaper { r.available = false }; return r }
    }

    // Where a paper's pills show (its taxonomy strip, the footer's): its menu and the views of it that the QML's status
    // line is on, the reader only on the paper's own note (ZoteroSearch.qml:2590).
    static let pillViews: Set<String> = ["actions", "notes", "files", "tags", "prompts", "note"]
    var paperPillsHere: Bool { Self.pillViews.contains(store.view) && (!store.inNote || notePaperInView) }

    // The strip under the context bar on a paper's views: each shown taxonomy's labels (a click: its papers).
    var computeTaxonomyStrip: [String: Any]? {
        guard paperPillsHere, isPaper, !tax.taxonomies.isEmpty, let details, let core else { return nil }
        return (try? core.glueJSON("taxonomyStrip", [details["tags"] ?? [], tax.taxonomies, tax.status ?? NSNull(), classifyingPaper]))
            .flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any]
    }

    // ---- the ids (5 of phase 9's 23). → handled

    func classifyAction(_ row: ListRow) -> Bool {
        switch row.rowId {
        case "classify": classifyPaper()
        case "classify-audit": openTaxonomyAudit()
        case "tax-paper":
            store.push("tax-paper")
            rebuildList()
        case "tax-label-papers": openTaggedPapers(row.tag)
        case "tax-audit":
            // auto → on, by you → off, by you → auto
            decideAudit(row, row.decision == "confirmed" ? "--dismiss" : row.decision == "dismissed" ? "--auto" : "--accept")
        default: return taxonomySettingsAction(row)
        }
        return true
    }

    private func classifyPaper() {
        guard let item = actionItem, !classifyingPaper else { return }
        guard runnerInstalled else { return flashMessage("Tagging needs the AI features: Settings › Setup installs them") }
        if syncedWriteRefused() { return } // (the papers' taxonomy state is synced)
        flashMessage("Tagging it by taxonomies: it's in Processes (\(keyName(".")))") // (before: its answer may come at once)
        classify([["key": item.key, "libraryID": item.libraryID == 0 ? 1 : item.libraryID]]) { [weak self] results in
            guard let self else { return }
            let r = results.first ?? [:]
            let add = r["add"] as? [String] ?? []
            let suggested = r["suggested"] as? Int ?? 0
            self.flashMessage(r["status"] as? String != "tagged" ? "Not tagged: " + ((r["reason"] as? String) ?? (r["status"] as? String) ?? "failed")
                : "Tagged by taxonomies" + (add.isEmpty ? " (nothing new)" : ": " + add.joined(separator: ", ")) + (suggested > 0 ? " · \(suggested) to review in Settings › Taxonomies › Review" : ""))
            if self.actionItem?.key == item.key { self.refreshDetails() }
            if self.store.view == "tax-audit" { self.loadTaxonomyAudit() }
        }
        rebuildList()
    }

    // After any classify run (the menu's, a scope's, new papers', a catch-up's): what the papers have now.
    func classified() {
        refreshTaxonomies()
        refreshTaxStatus()
        if opened, ["actions", "tax-paper"].contains(store.view) { store.followTop = false; rebuildList() }
    }

    private func openTaxonomyAudit() {
        tax.audit = nil
        store.push("tax-audit")
        rebuildList()
        loadTaxonomyAudit()
    }

    func loadTaxonomyAudit() {
        guard let item = actionItem else { return }
        taxJob(["classify-show", "--item", "\(item.libraryID == 0 ? 1 : item.libraryID):\(item.key)"], writes: false, refresh: false) { [weak self] ok, data, error in
            guard let self else { return }
            guard ok else {
                self.tax.problem = error
                if self.store.view == "tax-audit" { self.store.followTop = false; self.rebuildList() }
                return self.flashMessage("Couldn't read the result: " + error)
            }
            self.tax.problem = ""
            self.tax.audit = data
            if self.store.view == "tax-audit" { self.store.followTop = false; self.rebuildList() }
        }
    }

    private func decideAudit(_ row: ListRow, _ how: String) {
        guard let id = tax.audit?["id"] as? String else { return }
        taxJob(["classify-decide", "--item", id, "--taxonomy", row.value, "--label", row.tag, how]) { [weak self] ok, _, error in
            guard let self else { return }
            guard ok else { return self.flashMessage("Couldn't change \(row.tag): " + error) }
            self.flashMessage(how == "--auto" ? "Auto: \(row.tag) (the classifier decides)" : (how == "--accept" ? "On, by you: " : "Off, by you: ") + row.tag + " (kept on later passes)")
            self.refreshTaxonomyReview()
            self.loadTaxonomyAudit()
            self.refreshDetails()
        }
    }

    // A tag's papers (a label of the paper's, a pill in the strip).
    func openTaggedPapers(_ tag: String) {
        guard !tag.isEmpty else { return }
        let lib = actionItem.map { $0.libraryID == 0 ? 1 : $0.libraryID } ?? 1
        store.push("search")
        store.scope = Scope(type: "tag", key: tag, libraryID: lib, title: "#" + tag)
        scopeTotal = ""
        response = nil
        rebuildSearch()
        requestSearch()
    }

    // ---- Tag a paper when you open it (Service.qml's paperOpened, _tagWaiting)

    // The paper's status read; with tagOnOpen, its out-of-date taxonomies tagged (after its text, when that's being extracted).
    func tagOnOpen(extracting: Bool) {
        refreshTaxStatus { [weak self] stale in
            // (not while the sync folder is away: the runner couldn't write the papers' taxonomy state)
            guard let self, self.defaultOn("tagOnOpen"), self.runnerInstalled, self.paths?.readOnly != true, let stale, !stale.isEmpty, let item = self.actionItem, let id = self.paperId,
                  !self.sched.classifying.contains(id), self.tax.afterText[id] == nil else { return }
            let only: [String]? = stale.count < self.tax.taxonomies.count ? stale : nil
            if extracting || self.extracting(item) {
                self.tax.afterText[id] = (item, only, Date())
                self.startAfterTextTimer()
                self.flashMessage("Extracting its text, then tagging it by taxonomies")
            } else {
                self.classify([["key": item.key, "libraryID": item.libraryID == 0 ? 1 : item.libraryID]], only: only ?? []) { _ in }
                self.flashMessage("Tagging it by taxonomies")
            }
            if ["actions", "tax-paper"].contains(self.store.view) { self.store.followTop = false; self.rebuildList() } // Tagging… (not over the results)
        }
    }

    private func startAfterTextTimer() {
        guard tax.afterTextTimer == nil else { return }
        tax.afterTextTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.tagWaiting() } }
    }

    // Each 15 s: a paper waiting for its text is tagged once its extraction ended (or a minute passed without one).
    func tagWaiting() {
        for (id, w) in tax.afterText {
            let runs = ai.tasks.filter { $0["kind"] as? String == "extract" && $0["key"] as? String == w.item.key }
            let running = runs.contains { $0["status"] as? String == "running" }
            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds] // (the runner's toISOString)
            let over = runs.contains { t in
                guard t["status"] as? String != "running", let s = t["finished"] as? String, let d = iso.date(from: s) ?? ISO8601DateFormatter().date(from: s) else { return false }
                return d >= w.at
            }
            if running && !over { continue }
            if !over && Date().timeIntervalSince(w.at) < 60 { continue }
            tax.afterText[id] = nil
            classify([["key": w.item.key, "libraryID": w.item.libraryID == 0 ? 1 : w.item.libraryID]], only: w.only ?? []) { _ in }
        }
        if tax.afterText.isEmpty { tax.afterTextTimer?.invalidate(); tax.afterTextTimer = nil }
    }

    // ---- Go to › Tag “…”'s papers by taxonomies (a collection, a tag, a saved search)

    func classifyAllHere() {
        guard runnerInstalled else { return flashMessage("Tagging needs the AI features: Settings › Setup installs them") }
        if syncedWriteRefused() { return }
        guard let sc = searchScope else { return }
        let scope: [String: Any] = sc.type == "search" ? ["within": ["query": sc.query]] : sc.type == "tag" ? ["tag": ["name": sc.key, "libraryID": sc.libraryID]]
            : ["collection": ["key": sc.key, "libraryID": sc.libraryID]]
        flashMessage("Counting “\(sc.title)”'s papers…")
        bridge.post("/papers/select", scope.merging(["limit": 200]) { a, _ in a }, timeout: 15) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self else { return }
                guard case .ok(let data) = result else { return self.flashMessage("Couldn't list the papers: " + result.message) }
                let items = data["items"] as? [[String: Any]] ?? []
                guard !items.isEmpty else { return self.flashMessage("No papers in “\(sc.title)”") }
                let total = data["total"] as? Int ?? items.count
                self.flash = ""
                self.askConfirm(ConfirmAsk(title: "Tag \(items.count) " + (items.count == 1 ? "paper" : "papers") + " by taxonomies?", yes: "Tag them", no: "Not now",
                                           detail: (total > items.count ? "The first \(items.count) of “\(sc.title)”'s · " : "") + (self.jevKeySet ? "Jev: a few cents for thousands of papers" : "Your prompts model: one request per paper, at its price")
                                            + " · the unsure labels wait in Settings › Taxonomies › Review", run: { [weak self] in
                    guard let self else { return }
                    self.classify(items) { [weak self] results in
                        guard let self else { return }
                        let tagged = results.filter { $0["status"] as? String == "tagged" }.count, failed = results.filter { $0["status"] as? String == "failed" }.count
                        self.notify("Tagging by taxonomies is done", "\(tagged) tagged" + (failed > 0 ? ", \(failed) failed (in Processes)" : "") + " of \(results.count)")
                    }
                    self.flashMessage("Tagging \(items.count) " + (items.count == 1 ? "paper" : "papers") + " by taxonomies: it's in Processes (\(self.keyName(".")))")
                }))
            }
        }
    }
}
