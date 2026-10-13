import Foundation

// The settings in effect (Service.qml's applySettings): the machine file and, with a sync folder,
// the shared one (its copy on this machine while the folder is missing), combined by
// contracts/Paths.js and normalized by lib/Client.js. Read whole on each open.
struct AppSettings {
    var values: SettingsAnswer.Values
    var raw: [String: Any] // the normalized settings, for Swift to read
    var json = RawJSON(text: "{}") // the same, in order: what the builders and the writer get
    var problems: [String]

    var singleKeys: Bool { values.keys != "alt" }
    var searchFirst: Bool { values.keysStart == "search" }
    var keyDelay: TimeInterval { TimeInterval(min(max(values.keyDelay, 100), 1000)) / 1000 }

    static func load(_ core: JSCore, paths: AppPaths, machine: Any?) -> AppSettings {
        var problems: [String] = []
        if machine == nil, FileManager.default.fileExists(atPath: paths.settings) { problems.append("not valid JSON") }
        var shared: RawJSON?
        if paths.readOnly {
            shared = RawJSON.file(paths.sharedSettingsCache)
        } else if let path = paths.sharedSettings {
            shared = RawJSON.file(path)
            if shared == nil, FileManager.default.fileExists(atPath: path) { problems.append("the shared settings: not valid JSON") }
            keepCache(of: path, in: paths.sharedSettingsCache)
        }
        let machineText: Any = machine == nil ? NSNull() : (RawJSON.file(paths.settings) ?? RawJSON(text: "null"))
        do {
            let json = try core.glueJSON("settings", [machineText, shared ?? NSNull()])
            let text = try core.glue("settingsText", [machineText, shared ?? NSNull()], as: String.self)
            let answer = try JSONDecoder().decode(SettingsAnswer.self, from: Data(json.utf8))
            let object = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
            return AppSettings(values: answer.settings, raw: object?["settings"] as? [String: Any] ?? [:], json: RawJSON(text: text), problems: problems + answer.problems)
        } catch {
            return AppSettings(values: .init(keys: "single", keysStart: "list", keyDelay: 300, maxResults: 60, accelerators: true, citationStyle: nil, paperStatuses: []),
                               raw: [:], problems: problems + [String(describing: error)])
        }
    }

    // This machine's copy of the shared settings, kept up to date while the folder is there.
    private static func keepCache(of shared: String, in cache: String?) {
        guard let cache, let data = FileManager.default.contents(atPath: shared),
              (try? JSONSerialization.jsonObject(with: data)) != nil,
              FileManager.default.contents(atPath: cache) != data
        else { return }
        let url = URL(fileURLWithPath: cache)
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }
}
