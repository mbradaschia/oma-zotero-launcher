import XCTest
@testable import ZoteroLauncher

// Each Glue wrapper on each captured bridge answer (Fixtures/bridge, scrubbed), compared with what
// Node gave for the same call (Fixtures/goldens/cases.json, scripts/goldens.mjs), then decoded into
// the type the wrapper promises. A difference is JavaScriptCore against V8, or the JS changing; a
// decoding failure is a shape change.
final class GoldenTests: XCTestCase {
    struct Case: Decodable {
        let name: String
        let wrapper: String
    }

    // Each case parsed and run inside JavaScriptCore, compared as JSON text: what Node wrote, key
    // order included (Swift's dictionaries would lose it, and it decides how files come out).
    func testEveryWrapperGivesWhatNodeGives() throws {
        let core = try JSCore()
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "cases", withExtension: "json", subdirectory: "Fixtures/goldens"))
        _ = try core.evaluate("var CASES = " + String(contentsOf: url, encoding: .utf8) + "; 0")
        let n = try XCTUnwrap(Int(core.evaluate("CASES.length")))
        XCTAssertGreaterThanOrEqual(n, 10)
        var wrappers = Set<String>()
        for i in 0..<n {
            let name = try core.evaluate("CASES[\(i)].name")
            let wrapper = try core.evaluate("CASES[\(i)].wrapper")
            let got = try core.evaluate("JSON.stringify(Glue[CASES[\(i)].wrapper].apply(null, CASES[\(i)].args))")
            let want = try core.evaluate("JSON.stringify(CASES[\(i)].expect)")
            XCTAssertEqual(got, want, name)
            try decode(wrapper, got, name)
            wrappers.insert(wrapper)
        }
        XCTAssertTrue(wrappers.isSuperset(of: ["searchRows", "menu", "settings", "searchBody", "parsePins", "confirmRows"])) // js/tests/goldens.test.js: one per wrapper
    }

    // JSON text with sorted keys: true and 1 differ here (as NSObjects they are equal).
    private func canonical(_ value: Any) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .fragmentsAllowed, .withoutEscapingSlashes]), as: UTF8.self)
    }

    private func decode(_ wrapper: String, _ json: String, _ name: String) throws {
        let data = Data(json.utf8)
        let decoder = JSONDecoder()
        switch wrapper {
        case "searchRows", "results": XCTAssertNoThrow(try decoder.decode([SearchRow].self, from: data), name)
        case "selectionAfter": XCTAssertNoThrow(try decoder.decode(Int.self, from: data), name)
        case "menu": XCTAssertNoThrow(try decoder.decode(MenuRows.self, from: data), name)
        case "parsePins", "togglePin", "movePin": XCTAssertNoThrow(try decoder.decode([Pin].self, from: data), name)
        case "isPinned": XCTAssertNoThrow(try decoder.decode(Bool.self, from: data), name)
        case "toggleIdentity", "moveIdentity", "moveSection": XCTAssertNoThrow(try decoder.decode([String]?.self, from: data), name)
        case "orderRows", "pinRows", "otherRows", "filterRows", "orderSections", "fileRows", "confirmRows", "actions":
            XCTAssertNoThrow(try decoder.decode([ListRow].self, from: data), name)
        case "rowIdentity", "contextLabel", "typeHint", "statusName", "citationStyle", "countText": XCTAssertNoThrow(try decoder.decode(String.self, from: data), name)
        case "rankLabels": XCTAssertNoThrow(try decoder.decode([String].self, from: data), name)
        case "paperFooter": XCTAssertNoThrow(try decoder.decode([Pill].self, from: data), name)
        case "settings": XCTAssertNoThrow(try decoder.decode(SettingsAnswer.self, from: data), name)
        case "withNoteRows": XCTAssertNoThrow(try decoder.decode([SearchRow].self, from: data), name)
        case "noteRows", "tagRows", "tagStatusRows", "tagMenuRows", "tagNameRows", "settingsPage": XCTAssertNoThrow(try decoder.decode([ListRow].self, from: data), name)
        case "noteHtml", "paperCite", "fileName", "tagCountText", "paperStatusOf", "nextPaperStatus", "statusTag", "nextDefaultStatus",
             "defaultTaskDescription", "nextGrouping", "groupingName":
            XCTAssertNoThrow(try decoder.decode(String.self, from: data), name)
        case "styleName": XCTAssertNoThrow(try decoder.decode(String.self, from: data), name)
        case "statusTags": XCTAssertNoThrow(try decoder.decode([String].self, from: data), name)
        default: break // JSON the model reads as JSON (the bridge's bodies, settings, todos)
        }
    }
}
