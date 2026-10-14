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
                if let report = r.json as? [String: Any] { self.tax.report = report }
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

    private func taxJSON(_ object: Any) -> String {
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
            guard ok, let data else { return self.flashMessage("Couldn't read it: " + error) }
            self.tax.edit = data
            if ["settings-taxonomy", "settings-tax-label"].contains(self.store.view) { self.store.followTop = false; self.rebuildList() }
        }
    }

    // One change saved (Settings.editTaxonomy; the runner checks it): the page shows it, then done(before, saved).
    func saveTaxonomyChange(_ change: [String: Any], _ message: String, _ done: ((_ before: [String: Any], _ saved: [String: Any]) -> Void)? = nil) {
        guard let before = tax.edit, let core,
              let next = (try? core.glueJSON("editTaxonomy", [before, change])).flatMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }) as? [String: Any]
        else { return }
        taxJob(["taxonomy-save", tax.editId], stdin: taxJSON(next)) { [weak self] ok, data, error in
            guard let self else { return }
            guard ok, let data else {
                self.flashMessage("Not saved: " + error)
                self.store.followTop = false
                return self.rebuildList() // the field as it was
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
        let label = row.rowId == "tax-ai-ask" ? "Ask the AI" : parts.first ?? row.label
        let help = row.rowId == "tax-ai-ask" ? row.label : parts.dropFirst().joined(separator: " · ")
        let id = row.rowId == "tax-label-field" ? "\(tax.editId):\(tax.label)" : tax.editId
        settingsView.edit = ["path": "tax:" + row.value, "label": label, "type": "text", "help": help, "current": row.editText, "empty": "", "taxId": id]
        store.push("settings-edit")
        store.filterText = row.editText
        rebuildList()
    }

    // The typing page's Enter on a taxonomy's field (ZoteroSearch.qml's commitTaxonomyField). → it was one
    func saveTaxonomyEdit(_ edit: [String: Any], _ text: String) -> Bool {
        guard let path = edit["path"] as? String, path.hasPrefix("tax:"), let core else { return false }
        let field = String(path.dropFirst(4))
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
            guard ok, let id = data?["id"] as? String else { return self.flashMessage("Not made: " + error) }
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
            self.tax.label = (after["labels"] as? [Any])?.count.advanced(by: -1) ?? 0
            self.store.push("settings-tax-label")
            self.rebuildList()
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
        saveTaxonomyChange(["label": true, "remove": true, "i": tax.label], "Label deleted") { [weak self] _, _ in
            guard let self else { return }
            if self.store.view == "settings-tax-label" { _ = self.back() }
            then?()
        }
    }

    // Off (bundled), deleted (yours) or back to the bundled one (reset): then the list of taxonomies.
    private func removeTaxonomyHere(reset: Bool, _ message: String) {
        taxJob(["taxonomy-remove", tax.editId] + (reset ? ["--reset"] : [])) { [weak self] ok, _, error in
            guard let self else { return }
            guard ok else { return self.flashMessage("Not done: " + error) }
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

    // ---- AI drafts

    private func openTaxonomyDraft(_ id: String) {
        if needsSetup { return flashMessage("Set up an AI model first: Settings › Models & providers") }
        tax.draft = ["id": id, "base": id.isEmpty ? NSNull() : (tax.edit ?? NSNull()), "input": "", "turns": [Any](), "busy": false, "error": "", "proposal": NSNull(), "notes": ""]
        store.push("settings-tax-ai")
        rebuildList()
    }

    // Ask the AI: the request (with the conversation so far) to your prompts model; its proposal shown.
    func sendTaxonomyRequest() {
        guard var d = tax.draft, d["busy"] as? Bool != true else { return }
        let request = (d["input"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !request.isEmpty else { return flashMessage("Type what you want first") }
        guard !tax.drafting else { return flashMessage("One request at a time: wait for the one running") }
        let turns = d["turns"] as? [[String: Any]] ?? []
        let input: [String: Any] = ["id": d["id"] ?? "", "request": request, "turns": turns.map { ["request": $0["request"] ?? "", "taxonomy": $0["taxonomy"] ?? NSNull(), "notes": $0["notes"] ?? ""] }]
        d["busy"] = true
        d["error"] = ""
        d["input"] = request
        tax.draft = d
        tax.drafting = true
        let serial = UUID().uuidString
        tax.draft?["serial"] = serial
        store.followTop = false
        rebuildList()
        runRunner(["taxonomy-draft"], stdin: taxJSON(input), timeout: 600) { [weak self] r in
            guard let self else { return }
            self.tax.drafting = false
            guard var next = self.tax.draft, next["serial"] as? String == serial else { return } // left, or another one since
            let out = r.json as? [String: Any] ?? ["error": r.problem.isEmpty ? "the model didn't answer" : r.problem]
            next["busy"] = false
            if let e = out["error"] as? String {
                next["error"] = e + ((out["notes"] as? String).flatMap { $0.isEmpty ? nil : " (" + $0 + ")" } ?? "")
            } else {
                next["turns"] = turns + [["request": request, "taxonomy": out["taxonomy"] ?? NSNull(), "notes": out["notes"] ?? ""]]
                next["proposal"] = out["taxonomy"] ?? NSNull()
                next["notes"] = out["notes"] ?? ""
                next["input"] = ""
            }
            self.tax.draft = next
            if self.store.view == "settings-tax-ai" {
                self.store.followTop = false
                self.rebuildList()
                _ = self.selectRow { $0.rowId == (out["error"] != nil ? "tax-ai-ask" : "tax-ai-accept") }
            }
            self.flashMessage(out["error"] != nil ? "The AI couldn't: " + (out["error"] as? String ?? "") : "A proposal: accept it, or ask for changes")
        }
    }

    private func acceptTaxonomyDraft() {
        guard let d = tax.draft, let p = d["proposal"] as? [String: Any], d["busy"] as? Bool != true, let core else { return }
        let id = d["id"] as? String ?? ""
        let saved = (try? core.glueJSON("acceptedDraft", [p, d["base"] ?? NSNull()])) ?? "{}"
        taxJob(id.isEmpty ? ["taxonomy-save", "--new"] : ["taxonomy-save", id], stdin: saved) { [weak self] ok, data, error in
            guard let self else { return }
            guard ok, let data else { return self.flashMessage("Not saved: " + error) }
            self.tax.draft = nil
            if self.store.view == "settings-tax-ai" { _ = self.back() }
            if !id.isEmpty {
                self.tax.edit = data
                self.store.followTop = false
                self.rebuildList()
                self.flashMessage("Accepted: saved as yours")
            } else {
                self.openTaxonomy(data["id"] as? String ?? "")
                self.flashMessage("Made “\(data["name"] as? String ?? "")”: tag papers by it from a paper's menu, or a collection's Go to")
            }
        }
    }

    // ---- the review

    // Enter (tag it) or Delete (dismiss it) on a suggestion: by its id, not its place (the list may change meanwhile).
    func decideSuggestion(_ row: ListRow, accept: Bool) {
        guard let i = Int(row.value), let s = tax.review?[safe: i] else { return }
        let args = ["classify-decide", "--item", s["id"] as? String ?? "", "--taxonomy", s["taxonomy"] as? String ?? "", "--label", s["label"] as? String ?? "", accept ? "--accept" : "--dismiss"]
        taxJob(args) { [weak self] ok, _, error in
            guard let self else { return }
            self.flashMessage(!ok ? "Not saved: " + error : accept ? "Tagged " + (s["prefix"] as? String ?? "") + (s["label"] as? String ?? "") : "Dismissed")
            self.refreshTaxonomyReview()
        }
    }

    // ---- the Settings ids (18 of phase 9's 23). → handled

    func taxonomySettingsAction(_ row: ListRow) -> Bool {
        switch row.rowId {
        case "tax-open": openTaxonomy(row.value)
        case "tax-on":
            taxJob(["taxonomy-remove", row.value, "--reset"]) { [weak self] ok, _, error in self?.flashMessage(ok ? row.label + " is back on" : "Not turned on: " + error) }
        case "tax-new": newTaxonomy()
        case "tax-show":
            guard let t = tax.edit else { return true }
            let hidden = t["show"] as? Bool == false
            saveTaxonomyChange(["field": "show", "value": hidden], hidden ? "Shown under a paper's status line" : "Hidden on papers (still tagged)")
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
            guard runner.launch(runnerArgv(["taxonomy-edit", row.value])) else { flashMessage("Couldn't open it: " + RunnerResult(missing: true).problem); return true }
            flashMessage("Opened in your editor: Settings › Taxonomies shows the changes once you save the file")
        case "tax-reset":
            askConfirm(ConfirmAsk(title: "Back to the bundled “\(tax.edit?["name"] as? String ?? "")”?", yes: "Drop my changes", no: "Keep them",
                                  detail: "Papers tagged with your version are then out of date with it", run: { [weak self] in self?.removeTaxonomyHere(reset: true, "Back to the bundled one") }))
        case "tax-off":
            // a bundled one you changed: turning it off drops your changes (the runner overwrites your copy), so asked
            if tax.edit?["own"] as? Bool == true {
                askConfirm(ConfirmAsk(title: "Turn off “\(tax.edit?["name"] as? String ?? "")”?", yes: "Turn it off (my changes to it go)", no: "Keep it on",
                                      detail: "Its tags stay on papers; turned back on, it's the bundled one", run: { [weak self] in
                    self?.removeTaxonomyHere(reset: false, "Turned off: Settings › Taxonomies turns it back on")
                }))
            } else { removeTaxonomyHere(reset: false, "Turned off: Settings › Taxonomies turns it back on") }
        case "tax-delete":
            askConfirm(ConfirmAsk(title: "Delete the taxonomy “\(tax.edit?["name"] as? String ?? "")”?", yes: "Delete it", no: "Keep it", detail: "Its file goes; the tags it put on papers stay",
                                  run: { [weak self] in self?.removeTaxonomyHere(reset: false, "Deleted") }))
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

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
