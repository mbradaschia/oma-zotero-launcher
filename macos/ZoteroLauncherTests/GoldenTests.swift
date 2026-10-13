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

    func testEveryWrapperGivesWhatNodeGives() throws {
        let core = try JSCore()
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "cases", withExtension: "json", subdirectory: "Fixtures/goldens"))
        let raw = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
        XCTAssertGreaterThanOrEqual(raw.count, 10)
        var wrappers = Set<String>()
        for c in raw {
            let name = try XCTUnwrap(c["name"] as? String)
            let wrapper = try XCTUnwrap(c["wrapper"] as? String)
            let args = try XCTUnwrap(c["args"] as? [Any])
            let json = try core.glueJSON(wrapper, args)
            let got = try JSONSerialization.jsonObject(with: Data(json.utf8), options: [.fragmentsAllowed])
            XCTAssertEqual(try canonical(got), try canonical(c["expect"] as Any), name)
            try decode(wrapper, json, name)
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
        case "searchRows": XCTAssertNoThrow(try decoder.decode([SearchRow].self, from: data), name)
        case "selectionAfter": XCTAssertNoThrow(try decoder.decode(Int.self, from: data), name)
        case "menu": XCTAssertNoThrow(try decoder.decode(MenuRows.self, from: data), name)
        case "parsePins", "togglePin", "movePin": XCTAssertNoThrow(try decoder.decode([Pin].self, from: data), name)
        case "isPinned": XCTAssertNoThrow(try decoder.decode(Bool.self, from: data), name)
        case "toggleIdentity", "moveIdentity", "moveSection": XCTAssertNoThrow(try decoder.decode([String]?.self, from: data), name)
        case "rowIdentity", "contextLabel", "typeHint", "statusName", "citationStyle": XCTAssertNoThrow(try decoder.decode(String.self, from: data), name)
        case "rankLabels": XCTAssertNoThrow(try decoder.decode([String].self, from: data), name)
        case "paperFooter": XCTAssertNoThrow(try decoder.decode([Pill].self, from: data), name)
        case "settings": XCTAssertNoThrow(try decoder.decode(SettingsAnswer.self, from: data), name)
        case "searchBody", "usableFiles": break // JSON for the bridge, not decoded
        default: XCTAssertNoThrow(try decoder.decode([ListRow].self, from: data), name)
        }
    }
}
