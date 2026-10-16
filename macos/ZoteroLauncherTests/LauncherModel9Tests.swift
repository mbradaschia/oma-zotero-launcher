import XCTest
@testable import ZoteroLauncher

// Phase 9 with the fake runner and bridge: Settings › Taxonomies (the list, a taxonomy's form and a label's, an AI
// draft, the review), and taxonomies on a paper (Tag by taxonomies, the audit, its Taxonomies page, Tag a paper when
// you open it, a scope's papers). The taxonomy here is made up.
@MainActor
final class LauncherModel9Tests: XCTestCase {
    private var home: URL!
    private var bridge: FakeBridge!
    private var runner: FakeRunner!
    private var model: LauncherModel!
    private var saved: [[String: Any]] = [] // what taxonomy-save got on stdin
    private var shown: [String: Any] = [:]
    private let paperKey = "P3NM4G92"

    private func report(own: Bool = false) -> [String: Any] {
        ["taxonomies": [["id": "methods", "name": "Methods", "prefix": "method/", "kind": "several", "labels": ["survey", "case study"], "threshold": 0.6,
                         "own": own, "bundled": true, "show": true, "path": "/tmp/t/methods.json"]],
         "off": [], "problems": [], "jev": ["key": ["set": false]], "review": 1, "classified": 3]
    }

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("9-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed"), item = Fixture.bridge("item")
        bridge.answers["/search"] = { body in var a = typed; a["query"] = body["query"] ?? ""; return .ok(a) }
        bridge.answers["/item"] = { _ in .ok(item) }
        bridge.answers["/tags/count"] = { _ in .ok(["ok": true, "count": 4]) }
        bridge.answers["/tags/rename"] = { _ in .ok(["ok": true, "count": 4, "left": 0]) }
        bridge.answers["/tags/delete"] = { _ in .ok(["ok": true, "count": 4, "left": 0]) }
        runner = FakeRunner()
        runner.answers["list"] = { _, _ in FakeRunner.json(Fixture.synthetic("prompts")) }
        runner.answers["tasks"] = { _, _ in FakeRunner.json(["tasks": []]) }
        runner.answers["providers"] = { _, _ in FakeRunner.json(Fixture.synthetic("providers")) }
        runner.answers["models"] = { _, _ in FakeRunner.json(Fixture.synthetic("models")) }
        runner.answers["catchup-plan"] = { _, _ in FakeRunner.json([String: Any]()) }
        let report = self.report()
        runner.answers["taxonomies"] = { _, _ in FakeRunner.json(report) }
        shown = ["id": "methods", "name": "Methods", "prefix": "method/", "kind": "several", "question": "Which methods does it use?", "threshold": 0.6, "low": 0.3,
                 "labels": [["name": "survey", "definition": "Questionnaires"], ["name": "case study", "definition": "One case in depth"]], "bundled": true, "own": false, "path": "/tmp/t/methods.json"]
        runner.answers["taxonomy-show"] = { [unowned self] _, _ in FakeRunner.json(self.shown) }
        runner.answers["taxonomy-save"] = { [unowned self] _, stdin in
            let t = (try? JSONSerialization.jsonObject(with: Data((stdin ?? "{}").utf8))) as? [String: Any] ?? [:]
            self.saved.append(t)
            var out = self.shown.merging(t) { _, b in b }
            out["id"] = out["id"] ?? "methods"
            self.shown = out
            return FakeRunner.json(out)
        }
        model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: runner, fetcher: FakeFetcher())
        model.willShow()
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private func select(_ test: (ListRow) -> Bool) throws {
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex(where: test), "no such row")
    }

    private func type(_ text: String) {
        model.setFilter(text)
        model.execute(.activate) // the typing page's Save
    }

    private func openMethods() throws {
        model.openSettings("taxonomies")
        try select { $0.rowId == "tax-open" && $0.value == "methods" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "settings-taxonomy")
        XCTAssertEqual(runner.calls("taxonomy-show").last?.argv.dropFirst().first, "taxonomy-show")
    }

    // ---- Settings › Taxonomies

    func testTheListAndATaxonomysFormFieldTypedAndSaved() throws {
        try openMethods()
        XCTAssertEqual(model.placeholder(), "‹ Settings › Taxonomies › Methods")
        try select { $0.rowId == "tax-field" && $0.value == "name" }
        XCTAssertTrue(model.hints().contains("↵ edit it"))
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "settings-edit")
        XCTAssertEqual(model.store.filterText, "Methods")
        type("Research methods")
        XCTAssertEqual(saved.last?["name"] as? String, "Research methods")
        XCTAssertEqual(model.flash, "Renamed")
        XCTAssertEqual(model.store.view, "settings-taxonomy")
        // a bad threshold is refused, nothing saved
        try select { $0.rowId == "tax-field" && $0.value == "threshold" }
        model.execute(.activate)
        type("150")
        XCTAssertEqual(model.flash, "A percent from 1 to 99")
        XCTAssertEqual(saved.count, 1)
    }

    func testThePillsAndAPrefixChangedOffersToRenameTheTags() throws {
        try openMethods()
        try select { $0.rowId == "tax-kind" }
        model.execute(.activate)
        XCTAssertEqual(saved.last?["kind"] as? String, "one")
        XCTAssertTrue(model.flash.hasPrefix("Unique now"))
        try select { $0.rowId == "tax-field" && $0.value == "prefix" }
        model.execute(.activate)
        type("approach/")
        XCTAssertEqual(saved.last?["prefix"] as? String, "approach/")
        XCTAssertEqual(model.store.view, "confirm")
        XCTAssertEqual(model.listRows.first?.label, "Rename 2 tags on every paper")
        model.answerConfirm(true)
        XCTAssertEqual(bridge.bodies("/tags/rename").count, 2)
    }

    func testALabelRenamedAndDeleted() throws {
        try openMethods()
        try select { $0.rowId == "tax-label" && $0.value == "0" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "settings-tax-label")
        try select { $0.rowId == "tax-label-field" && $0.value == "label-name" }
        model.execute(.activate)
        type("surveys")
        XCTAssertEqual((saved.last?["labels"] as? [[String: Any]])?.first?["name"] as? String, "surveys")
        XCTAssertEqual(model.store.view, "confirm") // its tag on papers: renamed too?
        model.answerConfirm(false)
        // delete: the label and its tag, the label only, or esc
        try select { $0.rowId == "tax-label-delete" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "confirm")
        XCTAssertTrue(model.listRows.first?.label.contains("from every paper") == true)
        model.answerConfirm(true)
        XCTAssertEqual((saved.last?["labels"] as? [Any])?.count, 1)
        XCTAssertEqual(bridge.bodies("/tags/delete").count, 1)
    }

    func testTurningOffABundledOneYouChangedAsksAndDeletingYoursAsks() throws {
        shown["own"] = true
        runner.answers["taxonomy-remove"] = { _, _ in FakeRunner.json(["id": "methods", "removed": false, "off": true]) }
        try openMethods()
        try select { $0.rowId == "tax-off" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "confirm") // your changes to it would go
        XCTAssertTrue(runner.calls("taxonomy-remove").isEmpty)
        model.answerConfirm(true)
        XCTAssertEqual(runner.calls("taxonomy-remove").last?.argv.contains("--reset"), false)
        XCTAssertEqual(model.flash, "Turned off: Settings › Taxonomies turns it back on")
    }

    func testAnAIDraftSentAcceptedAndKeepsWhatItDidntSay() throws {
        runner.answers["taxonomy-draft"] = { _, _ in
            // (as the runner's validate returns it: low and show always filled in, 30% and shown)
            FakeRunner.json(["taxonomy": ["name": "Methods", "prefix": "method/", "kind": "several", "question": "Q", "threshold": 0.6, "low": 0.3, "show": true,
                                          "labels": [["name": "survey", "definition": "D"], ["name": "experiment", "definition": "E"]]], "notes": "added one"])
        }
        shown["show"] = false
        shown["low"] = 0.2
        try openMethods()
        try select { $0.rowId == "tax-ai-edit" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "settings-tax-ai")
        try select { $0.rowId == "tax-ai-ask" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "settings-edit")
        type("add experiments")
        let sent = try XCTUnwrap(runner.calls("taxonomy-draft").last?.stdin)
        XCTAssertTrue(sent.contains("add experiments"))
        XCTAssertEqual(model.flash, "A proposal: accept it, or ask for changes")
        try select { $0.rowId == "tax-ai-accept" }
        model.execute(.activate)
        XCTAssertEqual(saved.last?["show"] as? Bool, false) // the base's, the proposal said nothing of it
        XCTAssertEqual(saved.last?["low"] as? Double, 0.2)
        XCTAssertEqual(model.flash, "Accepted: saved as yours")
    }

    func testANewTaxonomyTypesItsNameAtOnceAndAProposalsRowsAreInert() throws {
        runner.answers["taxonomy-new"] = { _, _ in FakeRunner.json(["id": "methods", "path": "/tmp/t/methods.json"]) }
        model.openSettings("taxonomies")
        try select { $0.rowId == "tax-new" }
        XCTAssertTrue(model.hints().contains("↵ make one"))
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "settings-edit") // its name, typed at once (the form ignores typing)
        XCTAssertEqual(model.store.filterText, "Methods")
        _ = model.back()
        XCTAssertEqual(model.store.view, "settings-taxonomy")
        // a label's definition can be emptied
        try select { $0.rowId == "tax-label" && $0.value == "1" }
        model.execute(.activate)
        try select { $0.rowId == "tax-label-field" && $0.value == "label-definition" }
        model.execute(.activate)
        XCTAssertEqual(model.listRows.first?.label, "Save “One case in depth”")
        model.setFilter("")
        XCTAssertEqual(model.listRows.first?.label, "Save: no definition")
        model.execute(.activate)
        XCTAssertEqual(((saved.last?["labels"] as? [[String: Any]])?[1])?["definition"] as? String, "")
    }

    func testTabNeverDeletesALabelAndTurningOffAnUnchangedOneDoesntAsk() throws {
        runner.answers["taxonomy-remove"] = { _, _ in FakeRunner.json(["id": "methods", "removed": false, "off": true]) }
        try openMethods()
        try select { $0.rowId == "tax-label" && $0.value == "0" }
        model.execute(.activate)
        try select { $0.rowId == "tax-label-delete" }
        _ = model.handle(KeyEvent(key: .tab, text: "\t"))
        XCTAssertEqual(model.store.view, "settings-tax-label") // not asked to delete
        _ = model.back()
        try select { $0.rowId == "tax-off" }
        model.execute(.activate)
        XCTAssertEqual(runner.calls("taxonomy-remove").count, 1) // nothing of yours to lose: no question
        XCTAssertEqual(model.flash, "Turned off: Settings › Taxonomies turns it back on")
    }

    func testTheReviewTagsWithEnterAndDismissesWithDelete() throws {
        runner.answers["classify-review"] = { _, _ in
            FakeRunner.json(["items": [["id": "1:\(self.paperKey)", "paper": "Doe (2016)", "taxonomy": "methods", "name": "Methods", "prefix": "method/", "label": "survey", "p": 0.42]]])
        }
        runner.answers["classify-decide"] = { _, _ in FakeRunner.json(["ok": true]) }
        model.openSettings("taxonomies")
        try select { $0.rowId == "tax-review" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "settings-tax-review")
        try select { $0.rowId == "tax-suggestion" }
        XCTAssertTrue(model.hints().contains("⌘⌫ dismiss it"))
        model.execute(.activate)
        XCTAssertTrue(runner.calls("classify-decide").last?.argv.contains("--accept") == true)
        XCTAssertEqual(model.flash, "Tagged method/survey")
        try select { $0.rowId == "tax-suggestion" }
        _ = model.handle(KeyEvent(key: .delete, text: ""))
        XCTAssertTrue(runner.calls("classify-decide").last?.argv.contains("--dismiss") == true)
    }

    // ---- on a paper

    private func openMenu() throws {
        model.setFilter("capabilities")
        model.enterActions(try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "item" }))
    }

    func testTagByTaxonomiesTheAuditAndThePapersTaxonomiesPage() throws {
        runner.answers["classify-status"] = { _, _ in FakeRunner.json(["items": [["id": "1:\(self.paperKey)", "classified": true, "stale": []]]]) }
        runner.answers["classify"] = { _, _ in FakeRunner.json(["results": [["id": "1:\(self.paperKey)", "status": "tagged", "add": ["method/survey"], "suggested": 1]]]) }
        runner.answers["classify-show"] = { _, _ in
            FakeRunner.json(["id": "1:\(self.paperKey)", "classified": true, "taxonomies": [["id": "methods", "name": "Methods", "prefix": "method/", "kind": "several", "threshold": 0.6, "low": 0.3,
                                                                                        "labels": [["name": "survey", "p": 0.8, "state": "tagged"]]]]])
        }
        runner.answers["classify-decide"] = { _, _ in FakeRunner.json(["ok": true]) }
        try openMenu()
        try select { $0.rowId == "classify" }
        model.execute(.activate)
        XCTAssertEqual(runner.calls("classify").last?.argv.prefix(4), ["oma-zotero-prompt", "classify", "--items", "1:\(paperKey)"])
        XCTAssertEqual(model.flash, "Tagged by taxonomies: method/survey · 1 to review in Settings › Taxonomies › Review")
        try select { $0.rowId == "classify-audit" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "tax-audit")
        try select { $0.rowId == "tax-audit" }
        model.execute(.activate)
        XCTAssertTrue(runner.calls("classify-decide").last?.argv.contains("--accept") == true)
        _ = model.back()
        try select { $0.rowId == "tax-paper" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "tax-paper")
        XCTAssertEqual(model.placeholder(), "‹ Taxonomies · " + model.paperLabel)
    }

    func testTagAPaperWhenYouOpenIt() throws {
        let file = home.appendingPathComponent(".config/omarchy/oma-zotero-launcher.json")
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(#"{"defaults": {"tagOnOpen": true}}"#.utf8).write(to: file)
        model.reloadSettings()
        runner.answers["classify-status"] = { _, _ in FakeRunner.json(["items": [["id": "1:\(self.paperKey)", "classified": false, "stale": ["methods"]]]]) }
        runner.answers["classify"] = { _, _ in FakeRunner.json(["results": [["id": "1:\(self.paperKey)", "status": "tagged", "add": []]]]) }
        try openMenu()
        XCTAssertEqual(runner.calls("classify").last?.argv.prefix(4), ["oma-zotero-prompt", "classify", "--items", "1:\(paperKey)"])
        XCTAssertFalse(runner.calls("classify").last?.argv.contains("--taxonomies") ?? true) // all of them out of date: every one
    }
}
