import SwiftUI
import XCTest
@testable import ZoteroLauncher

// lib/*.js from the Omarchy launcher, run in JavaScriptCore inside the app.
final class JSCoreTests: XCTestCase {
    func testLoadsEveryLibrary() throws {
        XCTAssertNoThrow(try JSCore())
    }

    func testBuildsSearchRowsFromABridgeAnswer() throws {
        let core = try JSCore()
        let response: [String: Any] = [
            "ok": true, "query": "dyn",
            "results": [[
                "key": "ABCD1234", "libraryID": 1, "itemType": "journalArticle",
                "title": "Dynamic capabilities and strategic management", "titleRanges": [[0, 3]],
                "creator": "Teece et al.", "year": 1997, "publication": "Strategic Management Journal",
            ]],
        ]
        let rows = try core.searchRows(response, color: "#0a84ff")
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].key, "ABCD1234")
        XCTAssertTrue(rows[0].isPaper)
        XCTAssertEqual(rows[0].subtitle, "Teece et al. · 1997 · Strategic Management Journal")
        XCTAssertEqual(rows[0].titleHtml, ##"<font color="#0a84ff"><b>Dyn</b></font>amic capabilities and strategic management"##)
    }

    func testBeforeTypingPinnedThenOpenThenRecent() throws {
        let core = try JSCore()
        let paper = { (key: String) -> [String: Any] in ["key": key, "libraryID": 1, "itemType": "book", "title": key] }
        let rows = try core.searchRows(["ok": true, "query": "", "pinned": [paper("P")], "open": [paper("O")], "recent": [paper("R")]], color: "#000000")
        XCTAssertEqual(rows.map(\.key), ["P", "O", "R"])
        XCTAssertEqual(Set(rows.map(\.section)).count, 3)
    }

    func testEveryModuleIsAGlobalAndGlueIsLoaded() throws {
        let core = try JSCore()
        for name in ["Fuzzy", "Client", "Views", "Settings", "Todos", "Paths", "Merge", "Glue"] {
            XCTAssertTrue(try core.evaluate("typeof \(name)") == "object", name)
        }
    }

    // contracts/fixtures/paths.json, the table both launchers must reproduce, through JavaScriptCore.
    func testPathsResolveMatchesTheContractFixtures() throws {
        let core = try JSCore()
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "paths", withExtension: "json"))
        let cases = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
        XCTAssertGreaterThan(cases.count, 5)
        for c in cases {
            let name = c["name"] as? String ?? "?"
            let json = try core.glueJSON("resolvePaths", [c["env"] ?? NSNull(), c["machine"] ?? NSNull(), c["probe"] ?? NSNull()])
            let got = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
            for (key, want) in try XCTUnwrap(c["expect"] as? [String: Any]) {
                XCTAssertEqual(got[key] as? NSObject, want as? NSObject, "\(name): \(key)")
            }
        }
    }

    func testAnUnknownGlueFunctionIsAnError() throws {
        let core = try JSCore()
        XCTAssertThrowsError(try core.glueJSON("noSuchWrapper", []))
    }

    func testAJavaScriptErrorIsReportedNotSwallowed() throws {
        let core = try JSCore()
        XCTAssertThrowsError(try core.call("Views", "noSuchFunction", [], as: [SearchRow].self))
    }
}

final class StyledTextTests: XCTestCase {
    func testMatchesBoldAndColoredTheRestPlain() {
        let text = StyledText.attributed(##"<font color="#ff0000"><b>Dyn</b></font>amic &amp; co"##)
        XCTAssertEqual(String(text.characters), "Dynamic & co")
        let runs = Array(text.runs)
        XCTAssertEqual(runs.count, 2)
        XCTAssertNotNil(runs[0].foregroundColor)
        XCTAssertNil(runs[1].foregroundColor)
        // bold in the row's own font (a fixed body font kept matches at 13 pt in the 12 pt rows)
        XCTAssertEqual(runs[0].inlinePresentationIntent, .stronglyEmphasized)
        XCTAssertNil(runs[0].font)
        XCTAssertNil(runs[1].inlinePresentationIntent)
    }

    func testPlainTitlesSurviveEscaping() {
        XCTAssertEqual(String(StyledText.attributed(StyledText.escape("R&D <in> firms")).characters), "R&D <in> firms")
    }

    func testAnArgumentJSONCantHoldIsAnErrorNotACrash() throws {
        let core = try JSCore()
        XCTAssertThrowsError(try core.glueJSON("filterRows", [[Date()], "x"]))
    }
}
