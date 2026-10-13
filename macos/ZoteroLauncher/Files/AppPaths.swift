import Foundation

// Where every file lives (contracts/Paths.js, through JSCore): the same answer the Omarchy
// launcher and the runner get. Resolved as the contract says: with the machine settings file
// (it holds the sync folder), then again knowing whether the sync folder's marker is there.
struct AppPaths: Decodable, Equatable {
    var settings: String // the machine settings file
    var sharedSettings: String?
    var sharedSettingsCache: String?
    var pins: String
    var view: String
    var machine: String
    var syncDir: String?
    var marker: String?
    var readOnly: Bool // a sync folder is set but not there: nothing synced is written
    var problems: [String]

    // The process's environment, as Paths.resolve reads it.
    static func environment(_ process: ProcessInfo = .processInfo) -> [String: String] {
        var env = process.environment.filter { key, _ in
            ["HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "OMA_ZOTERO_PROMPTS_DIR", "OMA_ZOTERO_INSTRUCTIONS"].contains(key)
        }
        if env["HOME"] == nil { env["HOME"] = NSHomeDirectory() }
        env["hostname"] = process.hostName.replacingOccurrences(of: ".local", with: "")
        return env
    }

    // → the paths, and the machine settings file as read (nil: missing or not JSON).
    static func resolve(_ core: JSCore, env: [String: String] = environment()) throws -> (paths: AppPaths, machine: Any?) {
        let first = try core.glue("resolvePaths", [env, NSNull(), NSNull()], as: AppPaths.self)
        let machine = readJSON(first.settings)
        let withSettings = try core.glue("resolvePaths", [env, machine ?? NSNull(), NSNull()], as: AppPaths.self)
        let markerThere = withSettings.marker.map { FileManager.default.fileExists(atPath: $0) } ?? false
        let paths = try core.glue("resolvePaths", [env, machine ?? NSNull(), ["syncMarker": markerThere]], as: AppPaths.self)
        return (paths, machine)
    }

    // A JSON file's value; nil when it is missing, unreadable or not JSON.
    static func readJSON(_ path: String?) -> Any? {
        guard let path, let data = FileManager.default.contents(atPath: path) else { return nil }
        return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }
}
