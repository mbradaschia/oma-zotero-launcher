import XCTest
@testable import ZoteroLauncher

// The files the app shares with the Omarchy launcher: where they are (contracts/Paths.js), the
// settings in effect, pins.json.
final class FilesTests: XCTestCase {
    private var home: URL!
    private var core: JSCore!

    override func setUpWithError() throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("files-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        core = try JSCore()
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: home)
    }

    private var env: [String: String] { ["HOME": home.path, "hostname": "mac"] }
    private var machineFile: URL { home.appendingPathComponent(".config/omarchy/oma-zotero-launcher.json") }

    private func write(_ text: String, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: url)
    }

    func testWithoutASyncFolderEverythingIsInTheConfigFolder() throws {
        let (paths, machine) = try AppPaths.resolve(core, env: env)
        XCTAssertNil(machine)
        XCTAssertEqual(paths.settings, machineFile.path)
        XCTAssertEqual(paths.pins, home.appendingPathComponent(".config/omarchy/oma-zotero-launcher/pins.json").path)
        XCTAssertFalse(paths.readOnly)
        XCTAssertNil(paths.syncDir)
        XCTAssertEqual(paths.machine, "mac")
    }

    func testASyncFolderWithoutItsMarkerIsReadOnly() throws {
        let sync = home.appendingPathComponent("Sync")
        try write(#"{"general": {"syncDir": "\#(sync.path)", "machineName": "laptop"}}"#, to: machineFile)
        let (paths, machine) = try AppPaths.resolve(core, env: env)
        XCTAssertNotNil(machine)
        XCTAssertEqual(paths.pins, sync.appendingPathComponent("shared/pins.json").path)
        XCTAssertTrue(paths.readOnly)
        XCTAssertEqual(paths.problems, ["sync-unavailable"])
        XCTAssertEqual(paths.machine, "laptop")
        try write("{}", to: sync.appendingPathComponent("shared/oma-zotero-sync.json"))
        XCTAssertFalse(try AppPaths.resolve(core, env: env).paths.readOnly)
    }

    func testSettingsDefaultsThenTheMachineAndSharedFilesCombined() throws {
        var (paths, machine) = try AppPaths.resolve(core, env: env)
        var settings = AppSettings.load(core, paths: paths, machine: machine)
        XCTAssertTrue(settings.singleKeys)
        XCTAssertFalse(settings.searchFirst)
        XCTAssertEqual(settings.keyDelay, 0.3, accuracy: 0.0001)
        XCTAssertEqual(settings.values.paperStatuses, ["to read", "reading", "read"])

        let sync = home.appendingPathComponent("Sync")
        try write(#"{"general": {"syncDir": "\#(sync.path)", "keys": "alt", "keyDelay": 5000}}"#, to: machineFile)
        try write("{}", to: sync.appendingPathComponent("shared/oma-zotero-sync.json"))
        try write(#"{"general": {"citationStyle": "apa", "keysStart": "search"}}"#, to: sync.appendingPathComponent("shared/settings.json"))
        (paths, machine) = try AppPaths.resolve(core, env: env)
        settings = AppSettings.load(core, paths: paths, machine: machine)
        XCTAssertFalse(settings.singleKeys)
        XCTAssertTrue(settings.searchFirst)
        XCTAssertEqual(settings.values.citationStyle, "apa")
        XCTAssertEqual(settings.keyDelay, 0.3, accuracy: 0.0001) // outside 100 to 1000 ms: the default, and said
        XCTAssertTrue(settings.problems.contains { $0.contains("keyDelay") })
        // its copy on this machine, in effect while the folder is gone
        let cache = try XCTUnwrap(paths.sharedSettingsCache)
        XCTAssertTrue(FileManager.default.fileExists(atPath: cache))
        try FileManager.default.removeItem(at: sync)
        (paths, machine) = try AppPaths.resolve(core, env: env)
        XCTAssertTrue(paths.readOnly)
        XCTAssertEqual(AppSettings.load(core, paths: paths, machine: machine).values.citationStyle, "apa")
    }

    func testABrokenSettingsFileIsReported() throws {
        try write("{ nope", to: machineFile)
        let (paths, machine) = try AppPaths.resolve(core, env: env)
        let settings = AppSettings.load(core, paths: paths, machine: machine)
        XCTAssertEqual(settings.problems.first, "not valid JSON")
        XCTAssertTrue(settings.singleKeys)
    }

    func testPinsReadToggledAndWrittenFromTheFileAsItIsNow() throws {
        let url = home.appendingPathComponent("cfg/pins.json")
        var pins = PinsFile.load(url, readOnly: false, core: core)
        XCTAssertEqual(pins.pins, [])
        try pins.update(core) { try core.glue("togglePin", [$0.map(\.json), ["key": "ABCD1234", "libraryID": 1, "title": "P"]], as: [Pin].self) }
        XCTAssertEqual(pins.pins.map(\.key), ["ABCD1234"])
        // the other machine pins a collection meanwhile
        try write(#"{"pins": [{"key": "ABCD1234", "libraryID": 1, "type": "item"}, {"key": "WXYZ9876", "libraryID": 1, "type": "collection"}]}"#, to: url)
        try pins.update(core) { try core.glue("togglePin", [$0.map(\.json), ["key": "QQQQ1111", "libraryID": 1]], as: [Pin].self) }
        XCTAssertEqual(PinsFile.load(url, readOnly: false, core: core).pins.map(\.key), ["ABCD1234", "WXYZ9876", "QQQQ1111"])
    }

    func testPinsAreRefusedWhileReadOnly() throws {
        let url = home.appendingPathComponent("cfg/pins.json")
        var pins = PinsFile.load(url, readOnly: true, core: core)
        XCTAssertThrowsError(try pins.save([])) { XCTAssertEqual($0 as? PinsFile.WriteError, .readOnly) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
    }
}
