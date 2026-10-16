import XCTest
@testable import ZoteroLauncher

// Settings' layout (the user's of 2026-10-16): the classifier (Jev) in Models & providers, tagging new and opened
// papers in Defaults, and on/off rows drawn as a switch.
@MainActor
final class SettingsLayoutTests: XCTestCase {
    private var home: URL!
    private var model: LauncherModel!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("layout-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        let runner = FakeRunner()
        runner.answers["tasks"] = { _, _ in FakeRunner.json(["tasks": []]) }
        runner.answers["providers"] = { _, _ in FakeRunner.json(Fixture.synthetic("providers")) }
        runner.answers["models"] = { _, _ in FakeRunner.json(Fixture.synthetic("models")) }
        runner.answers["taxonomies"] = { _, _ in FakeRunner.json(["taxonomies": [], "off": [], "problems": [], "jev": ["key": ["set": false]], "review": 0, "classified": 0]) }
        model = LauncherModel(bridge: FakeBridge(), desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: runner, fetcher: FakeFetcher())
        model.willShow()
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private func settle() { RunLoop.main.run(until: Date().addingTimeInterval(0.2)) }

    func testModelsAndProvidersHasTheClassifier() {
        model.openSettings("providers")
        settle()
        XCTAssertTrue(model.listRows.contains { $0.section == "Classifier" && $0.rowId == "set-key" && $0.value == "jev" }, "\(model.listRows.map(\.label))")
    }

    func testTaxonomiesPointToWhereTheyWent() {
        model.openSettings("taxonomies")
        settle()
        XCTAssertFalse(model.listRows.contains { $0.section == "Classifier" })
        let nav = model.listRows.filter { $0.rowId == "set-nav" }.map(\.value)
        XCTAssertEqual(nav, ["defaults", "providers"])
    }

    func testAnOnOffRowIsASwitch() throws {
        model.openSettings("defaults")
        settle()
        let row = try XCTUnwrap(model.listRows.first { $0.value == "defaults.tagOnOpen" })
        XCTAssertTrue(row.isSwitch)
        XCTAssertFalse(row.checked)
        XCTAssertEqual(Access.value(row), "off")
        XCTAssertFalse(try XCTUnwrap(model.listRows.first { $0.rowId == "set-models" }).isSwitch)
    }
}
