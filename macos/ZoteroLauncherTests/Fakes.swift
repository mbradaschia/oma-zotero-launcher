import Foundation
@testable import ZoteroLauncher

// Zotero's bridge, scripted: each post is recorded; an answer comes from `answers` at once, or
// waits (held) until the test releases it.
final class FakeBridge: Bridge {
    struct Call {
        let route: String
        let body: [String: Any]
        let completion: (BridgeResult) -> Void
    }

    var answers: [String: (([String: Any]) -> BridgeResult)] = [:]
    var hold: Set<String> = []
    private(set) var calls: [Call] = []
    private(set) var held: [Call] = []

    func reload() {}

    func post(_ route: String, _ body: [String: Any], timeout: TimeInterval, completion: @escaping (BridgeResult) -> Void) {
        let call = Call(route: route, body: body, completion: completion)
        calls.append(call)
        if hold.contains(route) { held.append(call); return }
        completion(answers[route]?(body) ?? .error("no answer for \(route)"))
    }

    func routes() -> [String] { calls.map(\.route) }
    func bodies(_ route: String) -> [[String: Any]] { calls.filter { $0.route == route }.map(\.body) }

    // The oldest held call answered.
    func release(_ result: BridgeResult) {
        guard !held.isEmpty else { return }
        held.removeFirst().completion(result)
    }
}

final class FakeDesktop: Desktop {
    private(set) var opened: [String] = []
    private(set) var copied: [String] = []
    private(set) var activated = 0
    private(set) var launched = 0

    func open(path: String) -> Bool { opened.append(path); return true }
    func copy(_ text: String) -> Bool { copied.append(text); return true }
    func activateZotero() { activated += 1 }
    func launchZotero() { launched += 1 }
    private(set) var urls: [URL] = []
    var clipboard: String?
    func open(url: URL) -> Bool { urls.append(url); return true }
    private(set) var edited: [String] = []
    func openInEditor(path: String) -> Bool { edited.append(path); return true }
    func pasteboardText() -> String? { clipboard }
    func clearPasteboard(ifStill text: String) { if clipboard?.trimmingCharacters(in: .whitespacesAndNewlines) == text { clipboard = nil } }
    var zoteroInstalled = true
    var zoteroRunning = true
}

// The prompt runner, answered by subcommand (the argv's first word after the command), every
// run recorded with its stdin.
@MainActor
final class FakeRunner: Runner {
    struct Call {
        let argv: [String]
        let stdin: String?
    }

    var answers: [String: ([String], String?) -> RunnerResult] = [:]
    var hold: Set<String> = []
    private(set) var calls: [Call] = []
    private(set) var launched: [[String]] = []
    private var held: [(String, (RunnerResult) -> Void)] = []
    var nodeVersion = "22.4.1"
    var hasPdftotext = true
    var hasTesseract = false
    func requirements(completion: @escaping @MainActor (Requirements) -> Void) { completion(Requirements(node: nodeVersion, pdftotext: hasPdftotext, tesseract: hasTesseract)) }

    static func json(_ object: Any) -> RunnerResult {
        RunnerResult(status: 0, stdout: String(decoding: (try? JSONSerialization.data(withJSONObject: object)) ?? Data(), as: UTF8.self))
    }

    func run(_ argv: [String], stdin: String?, timeout: TimeInterval, completion: @escaping @MainActor (RunnerResult) -> Void) {
        calls.append(Call(argv: argv, stdin: stdin))
        let sub = argv.count > 1 ? argv[1] : ""
        if hold.contains(sub) { held.append((sub, completion)); return }
        // the lists the launcher reads as it opens (phase 8): empty unless a test says otherwise
        let empty: RunnerResult? = sub == "chats" ? Self.json(["chats": []]) : sub == "artifacts" ? Self.json(["root": "", "artifacts": []]) : nil
        completion(answers[sub]?(argv, stdin) ?? empty ?? RunnerResult(status: 127, missing: true))
    }

    var launches = true // false: the command isn't there
    func launch(_ argv: [String]) -> Bool {
        guard launches else { return false }
        launched.append(argv)
        return true
    }

    func calls(_ sub: String) -> [Call] { calls.filter { $0.argv.count > 1 && $0.argv[1] == sub } }

    // Streams (a chat's turn), answered by subcommand with their lines, then their end; a held one
    // (holdStreams) waits for emit / end, and stop() ends it as the runner would (SIGTERM: 143).
    final class Streamed: RunnerStream {
        let onLine: @MainActor (String) -> Void
        let completion: @MainActor (RunnerResult) -> Void
        var stopped = false
        var over = false
        init(onLine: @escaping @MainActor (String) -> Void, completion: @escaping @MainActor (RunnerResult) -> Void) {
            self.onLine = onLine
            self.completion = completion
        }
        func stop() {
            stopped = true
            MainActor.assumeIsolated { end(RunnerResult(status: 143)) }
        }
        @MainActor func emit(_ line: String) { if !over { onLine(line) } }
        @MainActor func emit(_ object: [String: Any]) { emit(String(decoding: (try? JSONSerialization.data(withJSONObject: object)) ?? Data(), as: UTF8.self)) }
        @MainActor func end(_ result: RunnerResult = RunnerResult()) {
            guard !over else { return }
            over = true
            completion(result)
        }
    }
    var streamAnswers: [String: ([String], String?) -> (lines: [String], result: RunnerResult)] = [:]
    var holdStreams: Set<String> = []
    private(set) var streams: [Streamed] = []

    func stream(_ argv: [String], stdin: String?, onLine: @escaping @MainActor (String) -> Void, completion: @escaping @MainActor (RunnerResult) -> Void) -> RunnerStream? {
        calls.append(Call(argv: argv, stdin: stdin))
        let sub = argv.count > 1 ? argv[1] : ""
        let s = Streamed(onLine: onLine, completion: completion)
        streams.append(s)
        if holdStreams.contains(sub) { return s }
        guard let answer = streamAnswers[sub]?(argv, stdin) else {
            s.end(RunnerResult(status: 127, missing: true))
            return s
        }
        answer.lines.forEach { s.emit($0) }
        s.end(answer.result)
        return s
    }

    static func line(_ object: [String: Any]) -> String {
        String(decoding: (try? JSONSerialization.data(withJSONObject: object)) ?? Data(), as: UTF8.self)
    }

    // The oldest held run of `sub` answered.
    func release(_ sub: String, _ result: RunnerResult) {
        guard let i = held.firstIndex(where: { $0.0 == sub }) else { return }
        held.remove(at: i).1(result)
    }
}

enum Fixture {
    static func bridge(_ name: String) -> [String: Any] {
        let url = Bundle(for: FakeBridge.self).url(forResource: name, withExtension: "json", subdirectory: "Fixtures/bridge")!
        return try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    }

    static func synthetic(_ name: String) -> [String: Any] {
        let url = Bundle(for: FakeBridge.self).url(forResource: name, withExtension: "json", subdirectory: "Fixtures/synthetic")!
        return try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    }
}

// GitHub, answered by URL (nothing fetched for real).
@MainActor
final class FakeFetcher: Fetcher {
    var answers: [String: Result<Data, Error>] = [:]
    private(set) var fetched: [URL] = []

    func fetch(_ url: URL, completion: @escaping @MainActor (Result<Data, Error>) -> Void) {
        fetched.append(url)
        completion(answers[url.absoluteString] ?? .failure(BridgeDownloader.Failure("no answer for \(url)")))
    }
}
