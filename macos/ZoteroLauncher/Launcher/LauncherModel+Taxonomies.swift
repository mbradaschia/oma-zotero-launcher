import Foundation

// Settings › Taxonomies (macos/PLAN.md phase 9; ZoteroSearch.qml's taxonomy cases, Service.qml's taxonomy jobs): the
// list, a taxonomy's page (a form) and a label's, an AI draft, the review of unsure labels. The form's fields are
// typed on Settings' typing page (settings-edit: the Mac has no fields in place), checked by Settings.taxonomyValue,
// saved by the runner. Taxonomies are synced: no write while the sync folder is away.
extension LauncherModel {
    static let taxonomyViews: Set<String> = ["settings-taxonomies", "settings-taxonomy", "settings-tax-label", "settings-tax-ai", "settings-tax-review"]

    // ---- the runner

    func refreshTaxonomies() {
        guard runnerInstalled else { return }
        _ = once("taxonomies") {
            runRunner(["taxonomies", "--json"], timeout: 30) { [weak self] r in
                guard let self else { return }
                self.finished("taxonomies") { self.refreshTaxonomies() }
                if let report = r.json as? [String: Any] { self.tax.report = report; self.tax.problem = "" } else if self.tax.report == nil { self.tax.problem = r.problem }
                self.taxonomiesChanged()
            }
        }
    }

    func refreshTaxonomyReview() {
        _ = once("classify-review") {
            runRunner(["classify-review", "--json"], timeout: 30) { [weak self] r in
                guard let self else { return }
                self.finished("classify-review") { self.refreshTaxonomyReview() }
                self.tax.review = (r.json as? [String: Any])?["items"] as? [[String: Any]] ?? []
                self.taxonomiesChanged()
            }
        }
    }

    func taxonomiesChanged() {
        runnerState.index = nil
        guard opened else { return }
        if store.inSettings || ["actions", "tax-paper", "tax-audit"].contains(store.view) { store.followTop = false; rebuildList() }
        if store.inSearch, (prefs?.values["grouping"] as? String ?? "").hasPrefix("tax:") { rebuildSearch() }
    }

    // One job at a time (taxonomy-save, -remove, -new, -show; classify-show, -decide), stdin when it's a save.
    func taxJob(_ args: [String], stdin: String? = nil, writes: Bool = true, refresh: Bool = true, _ done: @escaping @MainActor (Bool, [String: Any]?, String) -> Void) {
        if writes && syncedWriteRefused() { return }
        tax.jobs.append((args, stdin, { [weak self] ok, data, error in
            done(ok, data, error)
            if refresh { self?.refreshTaxonomies() }
        }))
        nextTaxJob()
    }

    private func nextTaxJob() {
        guard !tax.jobRunning, !tax.jobs.isEmpty else { return }
        let job = tax.jobs.removeFirst()
        tax.jobRunning = true
        runRunner(job.args, stdin: job.stdin, timeout: 120) { [weak self] r in
            guard let self else { return }
            self.tax.jobRunning = false
            job.done(r.ok, r.json as? [String: Any], r.problem)
            self.nextTaxJob()
        }
    }

    func taxJSON(_ object: Any) -> String {
        String(decoding: (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8), as: UTF8.self)
    }

    // ---- a taxonomy's page

    func openTaxonomy(_ id: String) {
        tax.editId = id
        tax.edit = nil
        store.push("settings-taxonomy")
        rebuildList()
        reloadTaxonomy()
    }

    func reloadTaxonomy() {
        let id = tax.editId
        taxJob(["taxonomy-show", id], writes: false, refresh: false) { [weak self] ok, data, error in
            guard let self, self.tax.editId == id else { return }
            guard ok, let data else {
                self.tax.problem = error
                if self.store.view == "settings-taxonomy" { self.store.followTop = false; self.rebuildList() }
                return self.flashMessage("Couldn't read “\(id)”: " + error)
            }
            self.tax.problem = ""
            self.tax.edit = data
            if ["settings-taxonomy", "settings-tax-label"].contains(self.store.view) { self.store.followTop = false; self.rebuildList() }
            // New taxonomy: its name typed at once (the page ignores typing: the typing page, its name in the box)
            if self.tax.pendingField == "name", self.store.view == "settings-taxonomy" { self.tax.pendingField = ""; self.typeField("name") }
        }
    }

    // One change saved (Settings.editTaxonomy; the runner checks it): the page shows it, then done(before, saved).
    func saveTaxonomyChange(_ change: [String: Any], _ message: String, _ done: ((_ before: [String: Any], _ saved: [String: Any]) -> Void)? = nil) {
        // one change at a time: the next is made from the taxonomy as the last one saved it (queued, it undid it)
        if tax.jobRunning || !tax.jobs.isEmpty { return flashMessage("Saving the last change: a moment") }
        guard let before = tax.edit, let core,
              let next = (try? core.glueJSON("editTaxonomy", [before, change])).flatMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }) as? [String: Any]
        else { return }
        taxJob(["taxonomy-save", tax.editId], stdin: taxJSON(next)) { [weak self] ok, data, error in
            guard let self else { return }
            guard ok, let data else {
                self.flashMessage("Not saved: " + error)
                if self.store.inSettings { self.store.followTop = false; self.rebuildList() } // the field as it was
                return
            }
            self.tax.edit = data
            if self.store.inSettings { self.store.followTop = false; self.rebuildList() }
            if !message.isEmpty { self.flashMessage(message) }
            done?(before, data)
        }
    }

    // Enter on a field (a taxonomy's, a label's, Ask the AI): typed on Settings' typing page, its value in the box.
    func openTaxonomyField(_ row: ListRow) {
        let parts = row.label.components(separatedBy: " · ")
        let first = parts.first ?? row.label
        let label = row.rowId == "tax-ai-ask" ? "Ask the AI" : row.rowId == "tax-label-field" ? "Label " + first.lowercased() : first // (Label name, not just Name)
        let help = row.rowId == "tax-ai-ask" ? row.label : parts.dropFirst().joined(separator: " · ")
        let id = row.rowId == "tax-label-field" ? "\(tax.editId):\(tax.label)" : tax.editId
        settingsView.edit = ["path": "tax:" + row.value, "label": label, "type": "text", "help": help, "current": row.editText, "empty": "", "taxId": id]
        store.push("settings-edit")
        store.filterText = row.editText
        rebuildList()
    }

    // The page's field of that name, typed (its row's Enter).
    func typeField(_ field: String) {
        guard let row = listRows.first(where: { ["tax-field", "tax-label-field"].contains($0.rowId) && $0.value == field }) else { return }
        openTaxonomyField(row)
    }

    // The typing page's Enter on a taxonomy's field (ZoteroSearch.qml's commitTaxonomyField). → it was one
    func saveTaxonomyEdit(_ edit: [String: Any], _ text: String) -> Bool {
        guard let path = edit["path"] as? String, path.hasPrefix("tax:"), let core else { return false }
        let field = String(path.dropFirst(4))
        // the taxonomy it was typed for (another may be open since)
        if field != "ai-request", let id = edit["taxId"] as? String, id.split(separator: ":").first.map(String.init) != tax.editId {
            back()
            flashMessage("That taxonomy isn't open any more: nothing saved")
            return true
        }
        if field == "ai-request" {
            back()
            if var d = tax.draft { d["input"] = text; tax.draft = d }
            sendTaxonomyRequest()
            return true
        }
        guard let t = tax.edit else { return true }
        let check = { (f: String) in (try? core.glueJSON("taxonomyValue", [f, text, t])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any] ?? [:] }
        if field == "label-name" || field == "label-definition" {
            let i = tax.label
            guard let labels = t["labels"] as? [[String: Any]], labels.indices.contains(i) else { return true }
            let l = labels[i]
            let name = l["name"] as? String ?? ""
            if field == "label-definition" {
                let def = text.replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression)
                back()
                if def != (l["definition"] as? String ?? "") {
                    saveTaxonomyChange(["label": true, "i": i, "field": "definition", "value": def], "Saved: papers tagged before are out of date with it")
                }
                return true
            }
            let r = check("label")
            if let e = r["error"] as? String { flashMessage(e + ": kept “" + name + "”"); return true }
            let value = r["value"] as? String ?? ""
            back()
            if value == name { return true }
            if labels.enumerated().contains(where: { $0.offset != i && ($0.element["name"] as? String ?? "").lowercased() == value.lowercased() }) {
                flashMessage("It has “\(value)” already")
                return true
            }
            let fresh = name.range(of: #"^new label( \d+)?$"#, options: .regularExpression) != nil // just added: no paper has its tag yet
            let prefix = t["prefix"] as? String ?? ""
            saveTaxonomyChange(["label": true, "i": i, "field": "name", "value": value], fresh ? "Named “\(value)”" : "") { [weak self] _, _ in
                if !fresh { self?.offerTagRename([(prefix + name, prefix + value)], "Renamed the label") }
            }
            return true
        }
        let r = check(field)
        if let e = r["error"] as? String { flashMessage(e); return true }
        let value = r["value"]
        back()
        if let v = value, "\(v)" == "\(t[field] ?? "")" { return true }
        if field == "prefix", let p = value as? String {
            saveTaxonomyChange(["field": "prefix", "value": p], "") { [weak self] before, _ in
                let old = before["prefix"] as? String ?? ""
                let pairs = (before["labels"] as? [[String: Any]] ?? []).map { (old + ($0["name"] as? String ?? ""), p + ($0["name"] as? String ?? "")) }
                self?.offerTagRename(pairs, "Changed the prefix")
            }
            return true
        }
        saveTaxonomyChange(["field": field, "value": value ?? NSNull()], field == "name" ? "Renamed" : "Saved: papers tagged before are out of date with it")
        return true
    }

    // A label (or the prefix) renamed: the tags already on papers renamed too, if you say so.
    private func offerTagRename(_ pairs: [(String, String)], _ did: String) {
        guard let first = pairs.first else { return }
        let many = pairs.count > 1
        askConfirm(ConfirmAsk(title: did + ": rename the tag" + (many ? "s" : "") + " on papers too?",
                              yes: "Rename " + (many ? "\(pairs.count) tags" : first.0 + " → " + first.1) + " on every paper", no: "Leave the papers' tags as they are",
                              detail: "Counting the papers…", noDetail: "Papers tagged before keep " + first.0 + (many ? "…" : ""), run: { [weak self] in
            var next: ((Int) -> Void)?
            next = { i in
                guard i < pairs.count else { return }
                self?.renameTagEverywhere(pairs[i].0, pairs[i].1) { next?(i + 1) }
            }
            next?(0)
        }))
        countIntoConfirm(pairs.map(\.0)) { n in n > 0 ? "On \(n) " + (n == 1 ? "paper" : "papers") : "No paper has " + (many ? "them" : "it") + " yet" }
    }

    private func newTaxonomy() {
        taxJob(["taxonomy-new", "--name", "New taxonomy", "--no-edit", "--json"]) { [weak self] ok, data, error in
            guard let self else { return }
            guard ok, let id = data?["id"] as? String else { return self.flashMessage("Couldn't make it: " + error) }
            self.tax.pendingField = "name"
            self.openTaxonomy(id)
            self.flashMessage("Type its name; then its labels (Enter on one), Add a label for more")
        }
    }

    private func addTaxonomyLabel() {
        guard let t = tax.edit else { return }
        let names = Set((t["labels"] as? [[String: Any]] ?? []).map { ($0["name"] as? String ?? "").lowercased() })
        var name = "new label"
        var n = 2
        while names.contains(name) { name = "new label \(n)"; n += 1 }
        saveTaxonomyChange(["label": true, "i": -1, "value": name], "Type its name, then its definition") { [weak self] _, after in
            guard let self else { return }
            guard self.store.view == "settings-taxonomy" else { return } // left meanwhile
            self.tax.label = (after["labels"] as? [Any])?.count.advanced(by: -1) ?? 0
            self.store.push("settings-tax-label")
            self.rebuildList()
            self.typeField("label-name") // its name typed at once
        }
    }

    private func deleteTaxonomyLabel() {
        guard let t = tax.edit, let labels = t["labels"] as? [[String: Any]], labels.indices.contains(tax.label) else { return }
        let l = labels[tax.label]
        let tag = (t["prefix"] as? String ?? "") + (l["name"] as? String ?? "")
        askConfirm(ConfirmAsk(title: "Delete the label “\(l["name"] as? String ?? "")”?", yes: "Delete the label, and \(tag) from every paper", no: "Delete the label only (papers keep \(tag))",
                              detail: "Counting the papers…", noDetail: "esc: keep it",
                              run: { [weak self] in self?.removeLabel { self?.deleteTagEverywhere(tag) } },
                              cancel: { [weak self] in self?.removeLabel(nil) }))
        countIntoConfirm([tag]) { n in n > 0 ? "\(tag) is on \(n) " + (n == 1 ? "paper" : "papers") : "No paper has \(tag)" }
    }

    private func removeLabel(_ then: (() -> Void)?) {
        let name = (tax.edit?["labels"] as? [[String: Any]])?[safe: tax.label]?["name"] as? String ?? ""
        saveTaxonomyChange(["label": true, "remove": true, "i": tax.label], "Deleted the label “\(name)”") { [weak self] _, _ in
            guard let self else { return }
            if self.store.view == "settings-tax-label" { _ = self.back() }
            then?()
        }
    }

    // Off (bundled), deleted (yours) or back to the bundled one (reset): then the list of taxonomies.
    private func removeTaxonomyHere(reset: Bool, _ verb: String, _ message: String) {
        let name = tax.edit?["name"] as? String ?? tax.editId
        taxJob(["taxonomy-remove", tax.editId] + (reset ? ["--reset"] : [])) { [weak self] ok, _, error in
            guard let self else { return }
            guard ok else { return self.flashMessage("Couldn't \(verb) “\(name)”: " + error) }
            if reset { self.reloadTaxonomy(); return self.flashMessage(message) }
            if self.store.view == "settings-taxonomy" { _ = self.back() }
            self.flashMessage(message)
        }
    }

    // ⇧↑↓ on a label (a taxonomy's page): moved, saved.
    func moveTaxonomyLabel(_ delta: Int) {
        guard let row = selectedListRow, row.rowId == "tax-label", let i = Int(row.value) else { return }
        saveTaxonomyChange(["move": delta, "i": i], "") { [weak self] _, _ in
            _ = self?.selectRow { $0.rowId == "tax-label" && Int($0.value) == i + delta }
        }
    }

    // ---- the Settings ids (18 of phase 9's 23). → handled

    func taxonomySettingsAction(_ row: ListRow) -> Bool {
        switch row.rowId {
        case "tax-open": openTaxonomy(row.value)
        case "tax-on":
            taxJob(["taxonomy-remove", row.value, "--reset"]) { [weak self] ok, _, error in self?.flashMessage(ok ? row.label + " is back on" : "Couldn't turn on “\(row.label)”: " + error) }
        case "tax-new": newTaxonomy()
        case "tax-show":
            guard let t = tax.edit else { return true }
            let hidden = t["show"] as? Bool == false
            saveTaxonomyChange(["field": "show", "value": hidden], hidden ? "Shown under a paper's name" : "Hidden on papers (still tagged)")
        case "tax-kind":
            guard let t = tax.edit else { return true }
            let one = t["kind"] as? String == "one"
            saveTaxonomyChange(["field": "kind", "value": one ? "several" : "one"], one ? "Several labels per paper now" : "Unique now: one label per paper (a paper with several keeps them until it's tagged again)")
        case "tax-label":
            tax.label = Int(row.value) ?? -1
            store.push("settings-tax-label")
            rebuildList()
        case "tax-label-add": addTaxonomyLabel()
        case "tax-ai-new": openTaxonomyDraft("")
        case "tax-ai-edit": openTaxonomyDraft(tax.editId)
        case "tax-ai-accept": acceptTaxonomyDraft()
        case "tax-ai-discard":
            tax.draft = nil
            _ = back()
            flashMessage("Discarded: nothing saved")
        case "tax-label-delete": deleteTaxonomyLabel()
        case "tax-editor":
            if syncedWriteRefused() { return true }
            guard runner.launch(runnerArgv(["taxonomy-edit", row.value])) else { flashMessage("Couldn't open it: " + RunnerResult(missing: true).problem); return true }
            flashMessage("Opened in your editor: Settings › Taxonomies shows the changes once you save the file")
        case "tax-reset":
            askConfirm(ConfirmAsk(title: "Back to the bundled “\(tax.edit?["name"] as? String ?? "")”?", yes: "Drop my changes", no: "Keep them",
                                  detail: "Papers tagged with your version are then out of date with it", run: { [weak self] in self?.removeTaxonomyHere(reset: true, "reset", "Back to the bundled one") }))
        case "tax-off":
            // a bundled one you changed: turning it off drops your changes (the runner overwrites your copy), so asked
            if tax.edit?["own"] as? Bool == true {
                askConfirm(ConfirmAsk(title: "Turn off “\(tax.edit?["name"] as? String ?? "")”?", yes: "Turn it off (my changes to it go)", no: "Keep it on",
                                      detail: "Its tags stay on papers; turned back on, it's the bundled one", run: { [weak self] in
                    self?.removeTaxonomyHere(reset: false, "turn off", "Turned off: Settings › Taxonomies turns it back on")
                }))
            } else { removeTaxonomyHere(reset: false, "turn off", "Turned off: Settings › Taxonomies turns it back on") }
        case "tax-delete":
            let name = tax.edit?["name"] as? String ?? ""
            askConfirm(ConfirmAsk(title: "Delete the taxonomy “\(name)”?", yes: "Delete it (its file)", no: "Keep it", detail: "The tags it put on papers stay",
                                  run: { [weak self] in self?.removeTaxonomyHere(reset: false, "delete", "Deleted the taxonomy “\(name)”") }))
        case "tax-review":
            tax.review = nil
            store.push("settings-tax-review")
            rebuildList()
            refreshTaxonomyReview()
        case "tax-suggestion": decideSuggestion(row, accept: true)
        default: return false
        }
        return true
    }
}
