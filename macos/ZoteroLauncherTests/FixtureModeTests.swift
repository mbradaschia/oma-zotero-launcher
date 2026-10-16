import XCTest
@testable import ZoteroLauncher

// Fixture mode (Debug only): the real app on the scrubbed fixtures, for the UI tests in CI.
@MainActor
final class FixtureModeTests: XCTestCase {
    private var dir: URL { Bundle(for: FakeBridge.self).resourceURL!.appendingPathComponent("Fixtures") }

    func testTheDirectoryComesFromTheEnvironment() {
        XCTAssertEqual(FixtureMode.directory(["ZL_FIXTURES": dir.path])?.path, dir.path)
        XCTAssertNil(FixtureMode.directory(["ZL_FIXTURES": "/nonexistent"]))
        XCTAssertNil(FixtureMode.directory([:]))
    }

    // Never the user's own files: settings, pins, tasks live in a fresh home of its own.
    func testItsHomeIsAFreshFolderOfItsOwn() throws {
        let env = FixtureMode.environment(base: ["HOME": NSHomeDirectory()])
        let home = try XCTUnwrap(env["HOME"])
        XCTAssertNotEqual(home, NSHomeDirectory())
        XCTAssertTrue(FileManager.default.fileExists(atPath: home))
        XCTAssertTrue((try FileManager.default.contentsOfDirectory(atPath: home)).isEmpty)
        XCTAssertNotEqual(FixtureMode.environment(base: [:])["HOME"], home, "a new one each launch")
    }

    func testTheBridgeAnswersSearchesAndItemsFromTheFixtures() {
        let bridge = FixtureBridge(dir: dir)
        var typed: BridgeResult?, item: BridgeResult?, unknown: BridgeResult?
        bridge.post("/search", ["query": "work"], timeout: 1) { typed = $0 }
        bridge.post("/item", ["key": "K"], timeout: 1) { item = $0 }
        bridge.post("/nowhere", [:], timeout: 1) { unknown = $0 }
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        guard case .ok(let t) = typed, case .ok = item, case .ok(let u) = unknown else { return XCTFail("not ok") }
        XCTAssertFalse((t["results"] as? [Any] ?? []).isEmpty)
        XCTAssertEqual(u.count, 0, "an unknown route answers an empty ok")
    }

    func testTheRunnerAnswersPromptsAndChats() {
        let runner = FixtureRunner(dir: dir)
        var prompts: RunnerResult?, chats: RunnerResult?
        runner.run(["list", "--json"], stdin: nil, timeout: 1) { prompts = $0 }
        runner.run(["chats", "--all"], stdin: nil, timeout: 1) { chats = $0 }
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        XCTAssertNotNil((prompts?.json as? [String: Any])?["prompts"])
        XCTAssertEqual(((chats?.json as? [String: Any])?["chats"] as? [Any])?.count, 1)
    }
}
