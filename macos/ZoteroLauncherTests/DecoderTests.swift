import XCTest
@testable import ZoteroLauncher

// The four shapes of rows the view logic builds, each decoded by the type for it (never by
// sniffing fields): what a builder always sets is required, a missing one fails.
final class DecoderTests: XCTestCase {
    private func fixture(_ name: String) throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json", subdirectory: "Fixtures/bridge"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    func testAListRowWithNothingSetHasEveryFieldAtItsDefault() throws {
        let row = try JSCore().call("Views", "listRow", [[String: Any]()], as: ListRow.self)
        XCTAssertEqual(row.rowId, "")
        XCTAssertFalse(row.available)
        XCTAssertEqual(row.attLibraryID, 1)
        XCTAssertEqual(row.pillKind, "task")
    }

    func testSearchRowsFromARealAnswer() throws {
        let rows = try JSCore().glue("searchRows", [try fixture("search-typed"), "#0a84ff", ["noCommands": true]], as: [SearchRow].self)
        XCTAssertFalse(rows.isEmpty)
        XCTAssertTrue(rows.contains { $0.kind == "item" && $0.titleHtml.contains("<b>") })
        XCTAssertTrue(rows.contains { $0.kind == "collection" })
    }

    func testPillsOfAPapersFooter() throws {
        let pills = try JSCore().call("Views", "paperFooter", [["details": try fixture("item")]], as: [Pill].self)
        XCTAssertFalse(pills.isEmpty)
        XCTAssertFalse(pills[0].text.isEmpty)
    }

    func testSetupItemsWithTheirOptionalFields() throws {
        let items = try JSCore().call("Settings", "setupItems", [[String: Any]()], as: [SetupItem].self)
        XCTAssertFalse(items.isEmpty)
        XCTAssertTrue(items.allSatisfy { !$0.id.isEmpty })
    }

    func testAMissingRequiredFieldFails() {
        XCTAssertThrowsError(try JSONDecoder().decode(ListRow.self, from: Data(#"{"label": "x"}"#.utf8)))
        XCTAssertThrowsError(try JSONDecoder().decode(SearchRow.self, from: Data(#"{"title": "x"}"#.utf8)))
    }
}
