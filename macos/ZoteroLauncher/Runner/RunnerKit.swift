import Foundation

// What the app carries to install the AI features (decision 7): Resources/RunnerKit, as a build
// phase lays it out for install-runner.sh: macos/runner (without node_modules), macos/scripts
// (install-runner.sh, safe-dest.sh, copy-shared-paths.sh), contracts/Paths.js, and the bridge's
// manifest (the plugin version the launcher expects).
enum RunnerKit {
    static var folder: URL? { Bundle.main.resourceURL?.appendingPathComponent("RunnerKit") }

    static func installScript(in folder: URL? = folder) -> URL? {
        guard let script = folder?.appendingPathComponent("macos/scripts/install-runner.sh"), FileManager.default.isExecutableFile(atPath: script.path) else { return nil }
        return script
    }

    static func bundledVersion(in folder: URL? = folder) -> String? {
        folder.flatMap { version(of: $0.appendingPathComponent("macos/runner/package.json")) }
    }

    static let bundledBridgeVersion: String? = folder.flatMap { version(of: $0.appendingPathComponent("bridge-manifest.json")) }

    // Where install-runner.sh puts it: $XDG_DATA_HOME (else ~/.local/share)/oma-zotero-launcher/runner.
    static func installed(home: String, dataHome: String? = nil) -> URL {
        URL(fileURLWithPath: (dataHome ?? home + "/.local/share") + "/oma-zotero-launcher/runner")
    }

    static func installedVersion(home: String, dataHome: String? = nil) -> String? {
        version(of: installed(home: home, dataHome: dataHome).appendingPathComponent("package.json"))
    }

    // The app brings a newer runner than the one installed: { installed, bundled }, else nil.
    static func update(home: String, dataHome: String? = nil, in folder: URL? = folder) -> [String: String]? {
        guard let installed = installedVersion(home: home, dataHome: dataHome), let bundled = bundledVersion(in: folder), older(installed, than: bundled) else { return nil }
        return ["installed": installed, "bundled": bundled]
    }

    static func version(of file: URL) -> String? {
        guard let data = try? Data(contentsOf: file), let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return json["version"] as? String
    }

    // "0.2.0" before "0.2.1" (Settings.versionLess).
    static func older(_ a: String, than b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }, y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<3 where (i < x.count ? x[i] : 0) != (i < y.count ? y[i] : 0) { return (i < x.count ? x[i] : 0) < (i < y.count ? y[i] : 0) }
        return false
    }
}
