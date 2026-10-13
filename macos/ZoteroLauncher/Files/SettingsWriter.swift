import Foundation

// One setting saved (Service.qml's saveSettings): validated as the file would be read, split by
// contracts/Paths.js into the machine file and the shared one (and this machine's copy of it),
// each written atomically. A sync folder change isn't a plain save: it moves files (phase 4a
// refuses it here; Settings › General › Sync folder runs it).
enum SettingsWriter {
    enum Outcome: Equatable {
        case saved
        case refused(String) // why it wasn't saved
    }

    // `pathsJSON`: Paths.resolve's whole answer (AppPaths.resolveAll).
    static func save(_ core: JSCore, settings: AppSettings, paths: AppPaths, pathsJSON: [String: Any], path: String, value: Any?) -> Outcome {
        change(core, settings: settings, paths: paths, pathsJSON: pathsJSON, op: "value", args: [path, value ?? NSNull()]).outcome
    }

    // A settings change (GlueSettings.js's settingsChange: "value", "both", "addEndpoint",
    // "removeEndpoint", "fillDefaults"), saved. → the outcome, and a new endpoint's id.
    static func change(_ core: JSCore, settings: AppSettings, paths: AppPaths, pathsJSON: [String: Any], op: String, args: [Any]) -> (outcome: Outcome, id: String) {
        let shared = paths.readOnly ? RawJSON.file(paths.sharedSettingsCache) : RawJSON.file(paths.sharedSettings)
        guard let answer = (try? core.glueJSON("settingsChange", [settings.json, op, args, pathsJSON, shared ?? NSNull()]))
            .flatMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }) as? [String: Any]
        else { return (.refused("the settings didn't save"), "") }
        return (write(answer, paths), answer["id"] as? String ?? "")
    }

    private static func write(_ answer: [String: Any], _ paths: AppPaths) -> Outcome {
        if let problem = answer["problem"] as? String { return .refused(problem) }
        if answer["syncDirChange"] != nil { return .refused("the sync folder is changed in Settings › General › Sync folder, which moves your files") }
        do {
            if let machine = answer["machine"] as? String { try write(machine, to: paths.settings) }
            if let text = answer["shared"] as? String {
                if let path = paths.sharedSettings { try write(text, to: path) }
                if let cache = paths.sharedSettingsCache { try write(text, to: cache) }
            }
        } catch {
            return .refused("couldn't write the settings: \(error.localizedDescription)")
        }
        if let refused = answer["refused"] as? String, !refused.isEmpty { return .refused(refused) }
        return .saved
    }

    private static func write(_ text: String, to path: String) throws {
        let url = URL(fileURLWithPath: path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: url, options: .atomic)
    }
}
