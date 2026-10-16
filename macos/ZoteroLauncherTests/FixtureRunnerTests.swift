import XCTest
@testable import ZoteroLauncher

// The fixture runner (Task 3): every AI subcommand the app sends answered, with a little state (a run shows up in
// tasks, done, with its note), and a chat that streams.
@MainActor
final class FixtureRunnerTests: XCTestCase {
    private var dir: URL { Bundle(for: FakeBridge.self).resourceURL!.appendingPathComponent("Fixtures") }
    private func settle(_ s: Double = 0.3) { RunLoop.main.run(until: Date().addingTimeInterval(s)) }
    private func type(_ line: String) -> String {
        ((try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any])?["type"] as? String ?? ""
    }

    func testARunShowsUpInTasksAsDoneWithItsNote() {
        let runner = FixtureRunner(dir: dir)
        XCTAssertTrue(runner.launch(["oma-zotero-prompt", "run", "summary", "--key", "P3NM4G92", "--library", "1"]))
        var tasks: [[String: Any]] = []
        runner.run(["oma-zotero-prompt", "tasks"], stdin: nil, timeout: 1) { tasks = ($0.json as? [String: Any])?["tasks"] as? [[String: Any]] ?? [] }
        settle()
        XCTAssertEqual(tasks.last?["status"] as? String, "done")
        XCTAssertNotNil(tasks.last?["noteKey"])
        XCTAssertEqual(tasks.last?["key"] as? String, "P3NM4G92")
    }

    func testAChatAnswerStreamsItsEventsThenDone() {
        let runner = FixtureRunner(dir: dir, streamDelay: 0.01)
        var types: [String] = []
        var ended = false
        _ = runner.stream(["oma-zotero-prompt", "chat", "--key", "P3NM4G92"], stdin: "Q", onLine: { types.append(self.type($0)) }, completion: { _ in ended = true })
        settle(1)
        XCTAssertTrue(ended)
        XCTAssertEqual(types.first, "session")
        XCTAssertTrue(types.contains("delta"))
        XCTAssertEqual(types.last, "done")
    }

    func testStoppingAChatEndsItWithoutDone() {
        let runner = FixtureRunner(dir: dir, streamDelay: 0.2)
        var types: [String] = []
        var result: RunnerResult?
        let turn = runner.stream(["oma-zotero-prompt", "chat"], stdin: "Q", onLine: { types.append(self.type($0)) }, completion: { result = $0 })
        settle(0.3)
        turn?.stop()
        settle(1.5)
        XCTAssertFalse(types.contains("done"))
        XCTAssertEqual(result?.ok, false)
    }

    func testAnUnknownSubcommandAnswersAnEmptyObject() {
        var r: RunnerResult?
        FixtureRunner(dir: dir).run(["oma-zotero-prompt", "nowhere"], stdin: nil, timeout: 1) { r = $0 }
        settle()
        XCTAssertEqual(r?.ok, true)
        XCTAssertEqual((r?.json as? [String: Any])?.count, 0)
    }

    func testTheTaxonomiesAndADraftAnswer() {
        let runner = FixtureRunner(dir: dir)
        var report: [String: Any]?, draft: [String: Any]?
        runner.run(["oma-zotero-prompt", "taxonomies", "--json"], stdin: nil, timeout: 1) { report = $0.json as? [String: Any] }
        runner.run(["oma-zotero-prompt", "taxonomy-draft", "--json"], stdin: "{}", timeout: 1) { draft = $0.json as? [String: Any] }
        settle()
        XCTAssertEqual((report?["taxonomies"] as? [[String: Any]])?.first?["name"] as? String, "Methods")
        XCTAssertNotNil(draft?["taxonomy"])
    }

    func testTheSwitchesAndTheCallsLog() throws {
        let log = FileManager.default.temporaryDirectory.appendingPathComponent("calls-\(UUID().uuidString).log")
        defer { try? FileManager.default.removeItem(at: log) }
        let runner = FixtureRunner(dir: dir, env: ["ZL_FIXTURE_CALLS": log.path])
        runner.run(["node", "/x/oma-zotero-prompt.js", "taxonomies", "--json"], stdin: nil, timeout: 1) { _ in }
        _ = runner.launch(["oma-zotero-prompt", "run", "summary"])
        XCTAssertEqual(try String(contentsOf: log, encoding: .utf8), "taxonomies --json\nrun summary\n")
        var r: RunnerResult?
        FixtureRunner(dir: dir, env: ["ZL_FIXTURES_NO_RUNNER": "1"]).run(["oma-zotero-prompt", "list"], stdin: nil, timeout: 1) { r = $0 }
        settle()
        XCTAssertEqual(r?.missing, true)
        let home = try XCTUnwrap(FixtureMode.environment(base: [:], syncAway: true)["HOME"])
        let machine = try String(contentsOfFile: home + "/.config/omarchy/oma-zotero-launcher.json", encoding: .utf8)
        XCTAssertTrue(machine.contains("/nonexistent/"))
    }
}
