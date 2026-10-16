#if DEBUG
import Foundation

// Fixture mode's runner: the runner's answers from Fixtures/synthetic (made up), never the user's runner, never a
// model. Installed as far as the app can tell (no run reports it missing).
@MainActor
final class FixtureRunner: Runner {
    private let dir: URL

    init(dir: URL) { self.dir = dir.appendingPathComponent("synthetic") }

    static func json(_ object: Any) -> RunnerResult {
        RunnerResult(status: 0, stdout: String(decoding: (try? JSONSerialization.data(withJSONObject: object)) ?? Data(), as: UTF8.self))
    }

    // The subcommand: the first word after the program ("oma-zotero-prompt", or node and the runner's path).
    static func subcommand(_ argv: [String]) -> String {
        argv.first { !$0.contains("/") && !$0.hasPrefix("-") && $0 != "node" && $0 != "oma-zotero-prompt" } ?? ""
    }

    // the chat and the artifact of the item fixture's paper (made up)
    static let chat: [String: Any] = ["id": "2026-10-12T08-00-00-000Z-abc123", "title": "Its argument", "created": "2026-10-12", "updated": "2026-10-12T08:05:00Z",
                                      "turns": 2, "model": "", "key": "P3NM4G92", "libraryID": 1, "paper": "Doe (2016)"]
    static let artifact: [String: Any] = ["id": "concept-map-1a2b", "title": "Concept map", "format": "mermaid", "formatLabel": "Mind map", "current": 1, "versions": 1,
                                          "created": "2026-10-12", "updated": "2026-10-13", "by": "chat", "key": "P3NM4G92", "libraryID": 1, "paper": "Doe (2016)",
                                          "view": "/tmp/zl-fixture/m.html", "file": "/tmp/zl-fixture/m.mmd", "dir": "/tmp/zl-fixture/m", "brief": "/tmp/zl-fixture/brief.md", "promptMade": false]

    func answer(_ sub: String, _ argv: [String]) -> Any {
        switch sub {
        case "list": return FixtureMode.json(dir, "prompts") ?? ["prompts": []]
        case "providers": return FixtureMode.json(dir, "providers") ?? [:]
        case "models": return FixtureMode.json(dir, "models") ?? [:]
        case "tasks": return ["tasks": []]
        case "chats": return ["chats": [Self.chat]]
        case "artifacts": return ["root": "/tmp/zl-fixture", "artifacts": [Self.artifact]]
        default: return [String: Any]()
        }
    }

    func run(_ argv: [String], stdin: String?, timeout: TimeInterval, completion: @escaping @MainActor (RunnerResult) -> Void) {
        let result = Self.json(answer(Self.subcommand(argv), argv))
        DispatchQueue.main.async { completion(result) }
    }

    func launch(_ argv: [String]) -> Bool { true }

    func requirements(completion: @escaping @MainActor (Requirements) -> Void) {
        completion(Requirements(node: "22.4.1", pdftotext: true, tesseract: false))
    }

    func stream(_ argv: [String], stdin: String?, onLine: @escaping @MainActor (String) -> Void, completion: @escaping @MainActor (RunnerResult) -> Void) -> RunnerStream? {
        nil
    }
}
#endif
