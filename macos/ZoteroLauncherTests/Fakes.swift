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
    func pasteboardText() -> String? { clipboard }
}

enum Fixture {
    static func bridge(_ name: String) -> [String: Any] {
        let url = Bundle(for: FakeBridge.self).url(forResource: name, withExtension: "json", subdirectory: "Fixtures/bridge")!
        return try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    }
}
