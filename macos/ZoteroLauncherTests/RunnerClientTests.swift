import XCTest
@testable import ZoteroLauncher

// ProcessRunner against small shell scripts: what it passes in, what it reads back, and when it
// gives up.
@MainActor
final class RunnerClientTests: XCTestCase {
    private var home: URL!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("runner-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private func run(_ runner: ProcessRunner, _ argv: [String], stdin: String? = nil, timeout: TimeInterval = 10) -> RunnerResult {
        let done = expectation(description: "ran")
        var out = RunnerResult()
        runner.run(argv, stdin: stdin, timeout: timeout) { result in
            out = result
            done.fulfill()
        }
        wait(for: [done], timeout: timeout + 10)
        return out
    }

    private func script(_ name: String, _ body: String) throws -> String {
        let url = home.appendingPathComponent(name)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(("#!/bin/sh\n" + body + "\n").utf8).write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        return url.path
    }

    func testStdinInStdoutAndStderrBackTheLastLineIsTheProblem() {
        let runner = ProcessRunner(environment: ["HOME": home.path])
        let r = run(runner, ["/bin/sh", "-c", "cat; echo first >&2; echo 'oma-zotero-prompt: the real reason' >&2; exit 3"], stdin: "hello")
        XCTAssertEqual(r.stdout, "hello")
        XCTAssertEqual(r.status, 3)
        XCTAssertFalse(r.ok)
        XCTAssertEqual(r.problem, "the real reason")
    }

    func testOnlyTheKeptVariablesAndAnExplicitPath() throws {
        let runner = ProcessRunner(environment: ["HOME": home.path, "SECRET_TOKEN": "leak", "OPENAI_API_KEY": "from-env", "PATH": "/evil"])
        let r = run(runner, ["/bin/sh", "-c", "env"])
        XCTAssertTrue(r.stdout.contains("OPENAI_API_KEY=from-env")) // a provider's own variable: the runner reads it
        XCTAssertFalse(r.stdout.contains("SECRET_TOKEN"))
        XCTAssertFalse(r.stdout.contains("/evil"))
        XCTAssertTrue(r.stdout.contains("PATH=") && r.stdout.contains(home.path + "/.local/bin") && r.stdout.contains("/opt/homebrew/bin"))
    }

    func testATimeoutKillsItAndSaysSo() {
        let runner = ProcessRunner(environment: ["HOME": home.path])
        let started = Date()
        let r = run(runner, ["/bin/sh", "-c", "sleep 20"], timeout: 0.5)
        XCTAssertTrue(r.timedOut)
        XCTAssertEqual(r.problem, "it didn't answer in time")
        XCTAssertLessThan(Date().timeIntervalSince(started), 10)
    }

    func testAFullStderrNeverBlocksTheRun() {
        let runner = ProcessRunner(environment: ["HOME": home.path])
        let r = run(runner, ["/bin/sh", "-c", "head -c 300000 /dev/zero | tr '\\000' a >&2; echo done"])
        XCTAssertEqual(r.stdout, "done\n")
        XCTAssertEqual(r.stderr.count, 300000)
    }

    func testAMissingCommandIsNotInstalled() {
        let runner = ProcessRunner(environment: ["HOME": home.path])
        let r = run(runner, ["oma-zotero-prompt-not-here"])
        XCTAssertTrue(r.missing)
        XCTAssertEqual(r.problem, "the AI features aren't installed (Settings › Setup)")
    }

    func testTheCommandIsFoundInLocalBinAndJSONIsRead() throws {
        _ = try script(".local/bin/oma-zotero-prompt", #"echo '{"ok": true, "args": "'"$*"'"}'"#)
        let runner = ProcessRunner(environment: ["HOME": home.path])
        XCTAssertEqual(runner.resolve("oma-zotero-prompt"), home.path + "/.local/bin/oma-zotero-prompt")
        let r = run(runner, ["oma-zotero-prompt", "providers", "--quiet"])
        XCTAssertEqual((r.json as? [String: Any])?["args"] as? String, "providers --quiet")
    }

    func testNodeTwentyTwoOrNewerIsFoundNewestFirst() throws {
        _ = try script(".nvm/versions/node/v20.11.0/bin/node", "echo v20.11.0")
        _ = try script(".nvm/versions/node/v22.4.1/bin/node", "echo v22.4.1")
        let nvm = ProcessRunner.candidates(home: home.path).filter { $0.contains(".nvm") }
        XCTAssertEqual(nvm.first, home.path + "/.nvm/versions/node/v22.4.1/bin/node")
        XCTAssertEqual(ProcessRunner.probe(nvm[0])?.major, 22)
        XCTAssertEqual(ProcessRunner.probe(nvm[1])?.major, 20)
        XCTAssertNil(ProcessRunner.probe(try script("broken-node", "echo nonsense")))
    }

    func testLaunchLeavesItRunning() throws {
        let marker = home.appendingPathComponent("ran")
        let runner = ProcessRunner(environment: ["HOME": home.path])
        XCTAssertTrue(runner.launch(["/bin/sh", "-c", "touch '\(marker.path)'"]))
        let deadline = Date().addingTimeInterval(5)
        while !FileManager.default.fileExists(atPath: marker.path) && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
        XCTAssertTrue(FileManager.default.fileExists(atPath: marker.path))
        XCTAssertFalse(runner.launch(["not-a-command-here"]))
    }
}
