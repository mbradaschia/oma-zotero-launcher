#if DEBUG
import Foundation

// Fixture mode's runner: every subcommand the app sends answered with made-up data (Fixtures/synthetic), never the
// user's runner, never a model. A little state, so flows can be followed: a run shows up in tasks, done, with its
// note; an accepted taxonomy draft is listed; a classified paper is tagged; a chat streams chat-stream.jsonl.
// Installed as far as the app can tell (no run reports it missing). ZL_FIXTURES_NO_RUNNER: as if it weren't.
@MainActor
final class FixtureRunner: Runner {
    private let dir: URL
    private let streamDelay: TimeInterval
    private let missing: Bool
    private let callsLog: URL?
    // what was asked, each the subcommand and its arguments (also a line of callsLog, for the UI tests)
    private(set) var calls: [[String]] = [] {
        didSet {
            guard let callsLog, let argv = calls.last else { return }
            let words = argv.drop { $0 == "node" || $0.contains("/") || $0 == "oma-zotero-prompt" }
            let line = Data((words.joined(separator: " ") + "\n").utf8)
            if let h = try? FileHandle(forWritingTo: callsLog) { h.seekToEndOfFile(); h.write(line); try? h.close() } else { try? line.write(to: callsLog) }
        }
    }
    private var tasks: [[String: Any]] = []
    private var taxonomies: [[String: Any]] = [FixtureRunner.methods]
    private var classified: Set<String> = []

    init(dir: URL, streamDelay: TimeInterval = 0.05, missing: Bool = false, callsLog: URL? = nil) {
        self.dir = dir.appendingPathComponent("synthetic")
        self.streamDelay = streamDelay
        self.missing = missing
        self.callsLog = callsLog
    }

    // fixture mode's switches: ZL_FIXTURES_NO_RUNNER, ZL_FIXTURES_STREAM_DELAY (seconds a line), ZL_FIXTURE_CALLS (the log)
    convenience init(dir: URL, env: [String: String]) {
        self.init(dir: dir, streamDelay: env["ZL_FIXTURES_STREAM_DELAY"].flatMap(TimeInterval.init) ?? 0.05,
                  missing: env["ZL_FIXTURES_NO_RUNNER"] == "1", callsLog: env["ZL_FIXTURE_CALLS"].map { URL(fileURLWithPath: $0) })
    }

    static func json(_ object: Any) -> RunnerResult {
        RunnerResult(status: 0, stdout: String(decoding: (try? JSONSerialization.data(withJSONObject: object)) ?? Data(), as: UTF8.self))
    }

    // The subcommand: the first word after the program ("oma-zotero-prompt", or node and the runner's path).
    static func subcommand(_ argv: [String]) -> String {
        argv.first { !$0.contains("/") && !$0.hasPrefix("-") && $0 != "node" && $0 != "oma-zotero-prompt" } ?? ""
    }

    static func value(_ argv: [String], _ flag: String) -> String? {
        guard let i = argv.firstIndex(of: flag), i + 1 < argv.count else { return nil }
        return argv[i + 1]
    }

    // the item fixture's paper: its chat, its artifact; the made-up taxonomy
    static let chat: [String: Any] = ["id": "2026-10-12T08-00-00-000Z-abc123", "title": "Its argument", "created": "2026-10-12", "updated": "2026-10-12T08:05:00Z",
                                      "turns": 2, "model": "", "key": "P3NM4G92", "libraryID": 1, "paper": "Doe (2016)"]
    static let artifact: [String: Any] = ["id": "concept-map-1a2b", "title": "Concept map", "format": "mermaid", "formatLabel": "Mind map", "current": 1, "versions": 1,
                                          "created": "2026-10-12", "updated": "2026-10-13", "by": "chat", "key": "P3NM4G92", "libraryID": 1, "paper": "Doe (2016)",
                                          "view": "/tmp/zl-fixture/m.html", "file": "/tmp/zl-fixture/m.mmd", "dir": "/tmp/zl-fixture/m", "brief": "/tmp/zl-fixture/brief.md", "promptMade": false]
    static let methods: [String: Any] = ["id": "methods", "name": "Methods", "prefix": "method/", "kind": "several", "question": "Which methods does it use?", "threshold": 0.6, "low": 0.3,
                                         "labels": [["name": "survey", "definition": "Questionnaires"], ["name": "case study", "definition": "One case in depth"]],
                                         "show": true, "own": false, "bundled": true, "path": "/tmp/zl-fixture/methods.json"]

    private static var now: String { ISO8601DateFormatter().string(from: Date()) }

    func answer(_ sub: String, _ argv: [String], _ stdin: String?) -> Any {
        switch sub {
        case "list": return FixtureMode.json(dir, "prompts") ?? ["prompts": []]
        case "providers": return FixtureMode.json(dir, "providers") ?? [:]
        case "models": return FixtureMode.json(dir, "models") ?? [:]
        case "provider-test":
            let id = argv.last { !$0.hasPrefix("-") && $0 != sub } ?? "provider"
            return ["id": id, "ok": true, "detail": "1 model", "models": [["value": id + ":fixture", "displayName": "Fixture"]], "at": Self.now]
        case "secret": return ["ok": true]
        case "tasks": return ["tasks": tasks]
        case "chats": return ["chats": [Self.chat]]
        case "chat-show": return ["id": Self.chat["id"] ?? "", "messages": [["role": "user", "text": "What does it argue?"], ["role": "assistant", "text": "That resources matter."]]]
        case "chat-rename", "chat-delete", "note": return ["ok": true]
        case "artifacts": return ["root": "/tmp/zl-fixture", "artifacts": [Self.artifact]]
        case "taxonomies":
            let lists = taxonomies.map { t -> [String: Any] in
                var x = t
                x["labels"] = (t["labels"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }
                return x
            }
            return ["taxonomies": lists, "off": [], "problems": [], "jev": ["key": ["set": false]], "review": 1, "classified": classified.count]
        case "taxonomy-show": return taxonomies.first { $0["id"] as? String == Self.value(argv, "--id") ?? argv.last } ?? Self.methods
        case "taxonomy-new": return ["id": "fixture-new"]
        case "taxonomy-save":
            var t = ((try? JSONSerialization.jsonObject(with: Data((stdin ?? "{}").utf8))) as? [String: Any]) ?? [:]
            t["id"] = t["id"] ?? "fixture-\(taxonomies.count)"
            if let i = taxonomies.firstIndex(where: { $0["id"] as? String == t["id"] as? String }) { taxonomies[i] = taxonomies[i].merging(t) { _, b in b } } else { taxonomies.append(t) }
            return t
        case "taxonomy-draft":
            return ["taxonomy": ["name": "Fixture methods", "prefix": "fixmethod/", "kind": "several", "question": "Which methods?", "threshold": 0.6, "low": 0.3, "show": true,
                                 "labels": [["name": "survey", "definition": "Questionnaires"], ["name": "experiment", "definition": "A designed test"]]], "notes": "a made-up proposal"]
        case "taxonomy-remove": return ["ok": true]
        case "classify":
            let ids = (Self.value(argv, "--items") ?? "").split(separator: ",").map(String.init)
            classified.formUnion(ids)
            return ["results": ids.map { ["id": $0, "status": "tagged", "add": ["method/survey"], "suggested": 1] }]
        case "classify-status":
            return ["items": classified.map { ["id": $0, "classified": true, "stale": []] }]
        case "classify-show":
            return ["id": "1:P3NM4G92", "classified": true, "taxonomies": [["id": "methods", "name": "Methods", "prefix": "method/", "kind": "several", "threshold": 0.6, "low": 0.3,
                                                                          "labels": [["name": "survey", "p": 0.8, "state": "tagged"], ["name": "case study", "p": 0.42, "state": ""]]]]]
        case "classify-review":
            return ["items": [["id": "1:P3NM4G92", "paper": "Doe (2016)", "taxonomy": "methods", "name": "Methods", "prefix": "method/", "label": "case study", "p": 0.42]]]
        case "classify-decide": return ["ok": true]
        case "extract":
            return ["ok": true, "noteKey": "FIXTEXT1"]
        case "catchup-plan": // one paper tagged by an older Methods, none from an older prompt, one recent paper to tag
            let job: [String: Any] = ["id": "1:P3NM4G92", "op": "classify", "title": "Doe (2016)"]
            return ["taxonomies": ["jobs": [job.merging(["only": ["methods"]]) { a, _ in a }], "papers": 1], "prompts": ["jobs": [], "papers": 0, "unknown": 0],
                    "recent": ["jobs": [job], "papers": 1, "added": 1]]
        case "extract-batch":
            let ids = (Self.value(argv, "--items") ?? "").split(separator: ",").map(String.init)
            return ["results": ids.map { ["id": $0, "status": "saved"] }]
        default: return [String: Any]()
        }
    }

    func run(_ argv: [String], stdin: String?, timeout: TimeInterval, completion: @escaping @MainActor (RunnerResult) -> Void) {
        calls.append(argv)
        let result = missing ? RunnerResult(status: 127, missing: true) : Self.json(answer(Self.subcommand(argv), argv, stdin))
        DispatchQueue.main.async { completion(result) }
    }

    // A prompt or an extraction started: in tasks at once, done, with the note it made.
    func launch(_ argv: [String]) -> Bool {
        calls.append(argv)
        guard !missing else { return false }
        let sub = Self.subcommand(argv)
        guard sub == "run" || sub == "extract" else { return true }
        let n = tasks.count + 1
        tasks.append(["id": "fix-\(n)", "status": "done", "kind": sub == "run" ? "prompt" : "extract", "title": sub == "run" ? "Summary" : "Extract the text",
                      "paper": "Doe (2016)", "key": Self.value(argv, "--key") ?? "P3NM4G92", "libraryID": Int(Self.value(argv, "--library") ?? "1") ?? 1,
                      "promptId": sub == "run" ? (argv.drop { $0 != "run" }.dropFirst().first ?? "") : "", "started": Self.now, "finished": Self.now, "noteKey": "FIXN0TE\(n)"])
        return true
    }

    func requirements(completion: @escaping @MainActor (Requirements) -> Void) {
        completion(Requirements(node: "22.4.1", pdftotext: true, tesseract: false))
    }

    // A chat's turn: chat-stream.jsonl's lines one by one; stop() ends it without its done, as the runner would.
    final class Turn: RunnerStream {
        private var timer: Timer?
        private let completion: @MainActor (RunnerResult) -> Void
        private var over = false
        init(lines: [String], delay: TimeInterval, onLine: @escaping @MainActor (String) -> Void, completion: @escaping @MainActor (RunnerResult) -> Void) {
            self.completion = completion
            var left = lines
            // (held by its timer until it ends, as a process is held by its pipe: the caller may drop it)
            timer = Timer.scheduledTimer(withTimeInterval: delay, repeats: true) { _ in
                MainActor.assumeIsolated {
                    guard !self.over else { return }
                    if left.isEmpty { return self.end(RunnerResult()) }
                    onLine(left.removeFirst())
                }
            }
        }
        @MainActor private func end(_ r: RunnerResult) {
            guard !over else { return }
            over = true
            timer?.invalidate()
            completion(r)
        }
        func stop() { MainActor.assumeIsolated { end(RunnerResult(status: 143, stderr: "stopped")) } }
    }

    func stream(_ argv: [String], stdin: String?, onLine: @escaping @MainActor (String) -> Void, completion: @escaping @MainActor (RunnerResult) -> Void) -> RunnerStream? {
        calls.append(argv)
        if missing { completion(RunnerResult(status: 127, missing: true)); return nil }
        let text = (try? String(contentsOf: dir.appendingPathComponent("chat-stream.jsonl"), encoding: .utf8)) ?? #"{"type":"done"}"#
        return Turn(lines: text.split(separator: "\n").map(String.init), delay: streamDelay, onLine: onLine, completion: completion)
    }
}
#endif
