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

    func testEveryPhase3bIdIsHandledAndNothingElse() {
        XCTAssertEqual(Set(ActionMap.handlers.keys), ["open", "reveal", "external", "window", "pick", "pin", "cite-copy", "confirm-yes", "confirm-no"])
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
