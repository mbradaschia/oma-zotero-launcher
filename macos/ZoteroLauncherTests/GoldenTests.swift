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
            XCTAssertEqual(got as? NSObject, c["expect"] as? NSObject, name)
            try decode(wrapper, json, name)
            wrappers.insert(wrapper)
        }
        XCTAssertEqual(wrappers, ["searchRows", "actions", "orderRows", "pinRows", "otherRows", "filterRows", "orderSections", "fileRows", "selectionAfter"])
    }

    private func decode(_ wrapper: String, _ json: String, _ name: String) throws {
        let data = Data(json.utf8)
        switch wrapper {
        case "searchRows": XCTAssertNoThrow(try JSONDecoder().decode([SearchRow].self, from: data), name)
        case "selectionAfter": XCTAssertNoThrow(try JSONDecoder().decode(Int.self, from: data), name)
        default: XCTAssertNoThrow(try JSONDecoder().decode([ListRow].self, from: data), name)
        }
    }
}
