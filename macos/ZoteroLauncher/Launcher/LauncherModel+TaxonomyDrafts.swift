import Foundation

// Settings › Taxonomies, continued (LauncherModel+Taxonomies.swift has the list and a taxonomy's form): a taxonomy
// drafted with AI (asked, discussed, accepted or not), and the review of labels below the threshold.
extension LauncherModel {
    // ---- AI drafts

    func openTaxonomyDraft(_ id: String) {
        if !runnerInstalled { return flashMessage("Taxonomies with AI need the AI features: Settings › Setup installs them") }
        if needsSetup { return flashMessage("Set up an AI model first: Settings › Models & providers") }
        if syncedWriteRefused() { return } // (refused before a minute of work, not at its save)
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

    func acceptTaxonomyDraft() {
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
                if self.store.inSettings { self.store.followTop = false; self.rebuildList() }
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
            self.flashMessage(!ok ? "Couldn't save it: " + error : accept ? "Tagged " + (s["prefix"] as? String ?? "") + (s["label"] as? String ?? "") : "Dismissed")
            self.refreshTaxonomyReview()
        }
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
