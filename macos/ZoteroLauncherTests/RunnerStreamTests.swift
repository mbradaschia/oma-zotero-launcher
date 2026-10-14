import XCTest
@testable import ZoteroLauncher

// ProcessRunner's streamed runs (a chat's turn) against small shell scripts: lines as they come,
// stdin in, stop.
@MainActor
final class RunnerStreamTests: XCTestCase {
    private var home: URL!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("stream-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    func testLinesComeAsTheyAreWrittenThenTheEnd() {
        let runner = ProcessRunner(environment: ["HOME": home.path])
        var lines: [String] = []
        var firstAt: Date?
        let done = expectation(description: "ended")
        var result = RunnerResult()
        let start = Date()
        runner.stream(["/bin/sh", "-c", "read q; echo \"got $q\"; sleep 0.6; printf 'é – two\\n'; printf 'last'; echo oops >&2; exit 2"], stdin: "hello\n", onLine: { line in
            if firstAt == nil { firstAt = Date() }
            lines.append(line)
        }, completion: { r in
            result = r
            done.fulfill()
        })
        wait(for: [done], timeout: 10)
        XCTAssertEqual(lines, ["got hello", "é – two", "last"])
        XCTAssertLessThan(firstAt!.timeIntervalSince(start), 0.55) // the first line before the pause ended
        XCTAssertEqual(result.status, 2)
        XCTAssertEqual(result.problem, "oops")
    }

    func testStopEndsIt() {
        let runner = ProcessRunner(environment: ["HOME": home.path])
        let done = expectation(description: "ended")
        var lines: [String] = []
        var result = RunnerResult()
        let run = runner.stream(["/bin/sh", "-c", "echo started; sleep 30"], stdin: nil, onLine: { lines.append($0) }, completion: { r in
            result = r
            done.fulfill()
        })
        let started = Date()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { run?.stop() }
        wait(for: [done], timeout: 10)
        XCTAssertLessThan(Date().timeIntervalSince(started), 5)
        XCTAssertEqual(lines, ["started"])
        XCTAssertFalse(result.ok)
    }

    func testAMissingCommandSaysSo() {
        let runner = ProcessRunner(environment: ["HOME": home.path])
        let done = expectation(description: "ended")
        var result = RunnerResult()
        runner.stream(["no-such-command-here"], stdin: nil, onLine: { _ in }, completion: { r in
            result = r
            done.fulfill()
        })
        wait(for: [done], timeout: 10)
        XCTAssertTrue(result.missing)
    }
}
