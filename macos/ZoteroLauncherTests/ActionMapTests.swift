import XCTest
@testable import ZoteroLauncher

// Each ported row id does what activateAction's case does, on a fake target.
@MainActor
final class ActionMapTests: XCTestCase {
    final class Target: ActionTarget {
        var filePurpose = "window"
        var log: [String] = []
        func finish(_ kind: String, attachment: [String: Any]?) { log.append("finish \(kind) \(attachment?["key"] as? String ?? "-")") }
        func openFiles(_ purpose: String) { log.append("files \(purpose)") }
        func togglePinOfMenu() { log.append("pin") }
        func copyCite(_ mode: String) { log.append("cite \(mode)") }
        func answerConfirm(_ yes: Bool) { log.append("confirm \(yes)") }
        func enterNotes() { log.append("notes") }
        func openNote(_ row: ListRow) { log.append("note \(row.noteKey)") }
        func cyclePaperStatus(_ delta: Int) -> Bool { log.append("status \(delta)"); return true }
        func cycleDefaultTask(_ delta: Int) -> Bool { log.append("task \(delta)"); return true }
        func enterTags() { log.append("tags") }
        func toggleTag(_ name: String, create: Bool) { log.append("tag \(name) \(create)") }
        func chooseTagStatus(_ kind: String) { log.append("tag-status \(kind)") }
        func convertMenuTag(into target: String) { log.append("convert \(target)") }
        func renameMenuTag() { log.append("rename") }
        func saveMenuTagName(_ name: String) { log.append("rename-to \(name)") }
        func deleteMenuTag() { log.append("delete") }
        func settingsAction(_ row: ListRow) { log.append("settings \(row.rowId) \(row.value)") }
        func taskAction(_ row: ListRow) { log.append("task \(row.rowId)") }
        func searchAction(_ row: ListRow) { log.append("search \(row.rowId)") }
        func runnerAction(_ row: ListRow) { log.append("runner \(row.rowId)") }
    }

    private func row(_ id: String, _ edit: (inout [String: Any]) -> Void = { _ in }) throws -> ListRow {
        var f: [String: Any] = ["rowId": id, "available": true]
        edit(&f)
        return try JSCore().call("Views", "listRow", [f], as: ListRow.self)
    }

    private func run(_ id: String, _ edit: (inout [String: Any]) -> Void = { _ in }) throws -> [String] {
        let target = Target()
        let handler = try XCTUnwrap(ActionMap.handlers[id], id)
        handler(target, try row(id, edit))
        return target.log
    }

    func testEveryIdOfTheDonePhasesIsHandled() {
        let phase3b: Set<String> = ["open", "reveal", "external", "window", "pick", "pin", "cite-copy", "confirm-yes", "confirm-no"]
        let phase4a: Set<String> = ["notes", "read", "note", "paper-status", "default-task", "tags-status", "tag-to-paper", "tag-to-task", "tag-status-opt",
                                    "tag-rename", "tag-name-save", "tag-delete", "tags", "tag", "create", "set-nav", "set-toggle", "set-choice", "set-opt",
                                    "set-edit", "set-save", "set-styles", "set-style-opt", "set-link"]
        let phase4b: Set<String> = ["task-default", "todo", "todo-new", "todo-new-save", "todo-quick", "todo-save", "todo-edit", "todo-text-save", "todo-status",
                                    "todo-priority", "todo-desc", "todo-notes", "todo-due", "todo-status-opt", "todo-priority-opt", "todo-item", "todo-context",
                                    "todo-pick", "todo-unlink", "todo-delete", "pstatus", "pstatus-add", "status", "task-action", "task-action-add", "status-add",
                                    "status-rename", "status-name-save", "status-remove", "pstatus-migrate", "task-tag"]
        let phase5: Set<String> = ["search", "search-open", "search-pin", "search-rename", "search-query", "search-delete", "search-save", "search-save-pin",
                                   "search-rename-save", "search-query-save", "pick-field", "pick-op", "pick-value"]
        let phase6a: Set<String> = ["setup", "set-models", "set-use", "set-model", "set-provider", "set-quick", "set-test", "set-key", "set-key-remove", "set-endpoint-new",
                                    "set-endpoint-remove", "set-setup", "set-install", "setting-go"]
        let phase6b: Set<String> = ["extract", "ext-read", "ext-again", "ext-zotero", "ext-delete", "task", "tasks-clear", "set-extract-all", "set-extract-retry",
                                    "set-rule", "set-rules-reset", "set-system-edit", "set-system-reset", "prompts", "prompt", "prompt-new", "pe-title", "pe-title-save",
                                    "pe-title-ai", "pe-model", "pe-effort", "pe-output", "pe-brief", "pe-output-opt", "pe-model-opt", "pe-effort-opt", "pe-text"]
        XCTAssertEqual(Set(ActionMap.handlers.keys), phase3b.union(phase4a).union(phase4b).union(phase5).union(phase6a).union(phase6b))
        for id in phase6b { XCTAssertEqual(try? run(id), ["runner \(id)"], id) }
        for id in phase6a { XCTAssertEqual(try? run(id) { $0["value"] = "x" }, ["settings \(id) x"], id) }
        for id in phase4b { XCTAssertEqual(try? run(id), ["task \(id)"], id) }
        for id in phase5 { XCTAssertEqual(try? run(id), ["search \(id)"], id) }
    }

    func testNotesStatusesAndTags() throws {
        XCTAssertEqual(try run("notes"), ["notes"])
        XCTAssertEqual(try run("read") { $0["note"] = ["key": "NOTE0001", "libraryID": 1] }, ["note NOTE0001"])
        XCTAssertEqual(try run("note") { $0["note"] = ["key": "NOTE0002", "libraryID": 1] }, ["note NOTE0002"])
        XCTAssertEqual(try run("paper-status"), ["status 1"])
        XCTAssertEqual(try run("default-task"), ["task 1"])
        XCTAssertEqual(try run("tags"), ["tags"])
        XCTAssertEqual(try run("tag") { $0["tag"] = "resilience" }, ["tag resilience false"])
        XCTAssertEqual(try run("create") { $0["tag"] = "new one" }, ["tag new one true"])
        XCTAssertEqual(try run("tag-to-paper"), ["tag-status paper"])
        XCTAssertEqual(try run("tag-to-task"), ["tag-status task"])
        XCTAssertEqual(try run("tag-status-opt") { $0["value"] = "next" }, ["convert next"])
        XCTAssertEqual(try run("tag-rename"), ["rename"])
        XCTAssertEqual(try run("tag-name-save") { $0["value"] = "better" }, ["rename-to better"])
        XCTAssertEqual(try run("tag-delete"), ["delete"])
    }

    func testTheSettingsRowsGoToTheSettings() throws {
        for id in ["tags-status", "set-nav", "set-toggle", "set-choice", "set-opt", "set-edit", "set-save", "set-styles", "set-style-opt", "set-link"] {
            XCTAssertEqual(try run(id) { $0["value"] = "general.keys" }, ["settings \(id) general.keys"], id)
        }
    }

    func testOpenAndReveal() throws {
        XCTAssertEqual(try run("open"), ["finish open -"])
        XCTAssertEqual(try run("reveal"), ["finish reveal -"])
    }

    func testAFileActionWithOneFileActsWithSeveralPicks() throws {
        XCTAssertEqual(try run("external") { $0["att"] = ["key": "ATT00001", "libraryID": 1] }, ["finish external ATT00001"])
        XCTAssertEqual(try run("window") { $0["submenu"] = true }, ["files window"])
        XCTAssertEqual(try run("pick") { $0["att"] = ["key": "ATT00002", "libraryID": 1] }, ["finish window ATT00002"]) // the purpose the picker was opened for
    }

    func testPinCiteAndTheQuestion() throws {
        XCTAssertEqual(try run("pin"), ["pin"])
        XCTAssertEqual(try run("cite-copy") { $0["value"] = "bibliography" }, ["cite bibliography"])
        XCTAssertEqual(try run("confirm-yes"), ["confirm true"])
        XCTAssertEqual(try run("confirm-no"), ["confirm false"])
    }
}
