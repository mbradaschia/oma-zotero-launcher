#if DEBUG
import Foundation

// Fixture mode: ZL_FIXTURES names a folder like ZoteroLauncherTests/Fixtures; the app answers from it instead of
// Zotero and the runner (the UI tests, in CI too), in a home of its own. Debug builds only: a Release build never
// reads ZL_FIXTURES.
enum FixtureMode {
    static func directory(_ env: [String: String]) -> URL? {
        guard let path = env["ZL_FIXTURES"] else { return nil }
        var isDir: ObjCBool = false
        return FileManager.default.fileExists(atPath: path, isDirectory: &isDir) && isDir.boolValue ? URL(fileURLWithPath: path) : nil
    }

    // The app's environment with HOME a fresh, empty folder: settings, pins, tasks and the sync folder are its own,
    // never the user's.
    // syncAway (ZL_FIXTURES_SYNC_AWAY): a sync folder that isn't there, so what's synced is refused
    static func environment(base: [String: String], syncAway: Bool = false) -> [String: String] {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent("zl-fixture-home-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        if syncAway {
            let config = home.appendingPathComponent(".config/omarchy")
            try? FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
            try? Data(#"{"syncDir": "/nonexistent/zl-fixture-sync"}"#.utf8).write(to: config.appendingPathComponent("oma-zotero-launcher.json"))
        }
        var env = base
        env["HOME"] = home.path
        env.removeValue(forKey: "XDG_CONFIG_HOME")
        env.removeValue(forKey: "XDG_DATA_HOME")
        return env
    }

    static func json(_ dir: URL, _ name: String) -> [String: Any]? {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent(name + ".json")) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}

final class FixtureBridge: Bridge {
    private let dir: URL
    init(dir: URL) { self.dir = dir.appendingPathComponent("bridge") }

    // route → fixture; the search's query is kept so the box and the results agree
    private func answer(_ route: String, _ body: [String: Any]) -> [String: Any] {
        switch route {
        case "/search":
            let typed = (body["query"] as? String ?? "").isEmpty == false
            var a = FixtureMode.json(dir, typed ? "search-typed" : "search-empty") ?? FixtureMode.json(dir, "search-typed") ?? [:]
            a["query"] = body["query"] ?? ""
            return a
        case "/item": return FixtureMode.json(dir, "item") ?? [:]
        case "/tags/list": return FixtureMode.json(dir, "tags-list") ?? [:]
        case "/note": return FixtureMode.json(dir, "note") ?? [:]
        default: return [:] // (an empty ok: the view shows its empty state, never a hang)
        }
    }

    func reload() {}

    // GET /ping: a made-up library's size
    func get(_ route: String, timeout: TimeInterval, completion: @escaping (BridgeResult) -> Void) {
        let a: [String: Any] = route == "/ping" ? ["index": ["count": 2648]] : [:]
        DispatchQueue.main.async { completion(.ok(a)) }
    }

    func post(_ route: String, _ body: [String: Any], timeout: TimeInterval, completion: @escaping (BridgeResult) -> Void) {
        let a = answer(route, body)
        DispatchQueue.main.async { completion(.ok(a)) }
    }
}
#endif
