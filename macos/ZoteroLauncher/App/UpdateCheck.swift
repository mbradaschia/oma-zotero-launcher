import AppKit

// Updates without the Apple Developer Program (no notarized Sparkle feed): once a day, GitHub's releases are asked for
// the newest macos-v* (not a draft, not a prerelease); the menu bar offers it, and its install.sh replaces the app
// (it quits this one, installs the new one and opens it).
@MainActor
final class UpdateCheck: ObservableObject {
    static let repo = "mbradaschia/zotero-companion-launcher"
    static let releasesURL = URL(string: "https://api.github.com/repos/\(repo)/releases?per_page=30")!
    private static let checkedKey = "ZLUpdateChecked"
    private static let day: TimeInterval = 86_400

    @Published private(set) var available: (version: String, tag: String)?
    @Published private(set) var problem: String? // the last check's failure (not shown: tried again a day later)

    let current: String
    private let fetcher: Fetcher
    private let defaults: UserDefaults
    private let now: () -> Date

    init(fetcher: Fetcher, defaults: UserDefaults = .standard,
         current: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0",
         now: @escaping () -> Date = Date.init) {
        self.fetcher = fetcher
        self.defaults = defaults
        self.current = current
        self.now = now
    }

    // "0.3.10" after "0.3.9": by number, a missing part is 0.
    static func newer(_ a: String, than b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }, y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0
            if p != q { return p > q }
        }
        return false
    }

    // The newest Mac release: a macos-v<numbers> tag, published, not a prerelease (macos-nightly is one).
    static func latest(fromReleases json: [[String: Any]]) -> (version: String, tag: String)? {
        let found: [(version: String, tag: String)] = json.compactMap { r in
            guard let tag = r["tag_name"] as? String, r["draft"] as? Bool != true, r["prerelease"] as? Bool != true,
                  tag.range(of: #"^macos-v\d+(\.\d+)*$"#, options: .regularExpression) != nil else { return nil }
            return (String(tag.dropFirst("macos-v".count)), tag)
        }
        return found.reduce(nil) { best, r in best.map { newer(r.version, than: $0.version) ? r : $0 } ?? r }
    }

    static let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/ZoteroLauncher-update.log")

    // The release's installer (its tag in $ZL_TAG, where the app is in $DEST): downloaded to a file first, so a failed
    // download fails instead of running an empty script; its output kept in the log.
    static func installCommand(log: String) -> String {
        "set -o pipefail; d=$(mktemp -d) && curl -fsSL --retry 2 -o \"$d/install.sh\" \"https://github.com/\(repo)/releases/download/$ZL_TAG/install.sh\" && bash \"$d/install.sh\" >>'\(log)' 2>&1"
    }

    // What the installer needs to replace this copy where it is; nil when it can't be updated in place (run from where
    // macOS translocated it, or renamed).
    static func installEnvironment(tag: String, app: URL) -> [String: String]? {
        guard app.lastPathComponent == "ZoteroLauncher.app", !app.path.contains("/AppTranslocation/") else { return nil }
        return ["ZL_TAG": tag, "DEST": app.deletingLastPathComponent().path]
    }

    #if DEBUG
    static let isDebug = true
    #else
    static let isDebug = false
    #endif

    // The daily check runs by itself, except under the tests, in fixture mode and in a Debug build (Xcode's: it would
    // replace the installed app).
    static func automatic(_ env: [String: String], debug: Bool = isDebug) -> Bool {
        !debug && env["XCTestConfigurationFilePath"] == nil && env["ZL_FIXTURES"] == nil
    }

    // Asks GitHub, at most once a day unless `now` (the menu's Check for Updates…). → done(the check answered)
    func check(now asked: Bool, done: ((Bool) -> Void)? = nil) {
        if !asked, let last = defaults.object(forKey: Self.checkedKey) as? Date, now().timeIntervalSince(last) < Self.day { return }
        fetcher.fetch(Self.releasesURL) { [weak self] result in
            guard let self else { return }
            guard case .success(let data) = result, let json = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else {
                self.problem = (try? result.get()) == nil ? "couldn't reach GitHub" : "GitHub's answer wasn't a list of releases"
                done?(false)
                return
            }
            self.problem = nil
            self.defaults.set(self.now(), forKey: Self.checkedKey) // (only an answer counts: a failure is tried again at the next tick)
            self.available = Self.latest(fromReleases: json).flatMap { Self.newer($0.version, than: self.current) ? $0 : nil }
            done?(true)
        }
    }

    // Check for Updates…: asked now, then said in a small alert.
    func checkFromMenu() {
        check(now: true) { [weak self] answered in
            guard let self else { return }
            if available != nil { return confirmUpdate() }
            let alert = NSAlert()
            alert.messageText = answered ? "You have the latest version (\(current))" : "Couldn't reach GitHub"
            alert.informativeText = answered ? "" : "Try again later."
            NSApp.activate(ignoringOtherApps: true)
            alert.runModal()
        }
    }

    // Update to X…: the release already known, asked about (GitHub isn't asked again).
    func confirmUpdate() {
        guard let a = available else { return }
        let alert = NSAlert()
        alert.messageText = "\(a.version) is out"
        alert.informativeText = "You have \(current). Updating quits Zotero Launcher, installs \(a.version) and opens it."
        alert.addButton(withTitle: "Update")
        alert.addButton(withTitle: "Later")
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertFirstButtonReturn { install() }
    }

    // The release's own install.sh, where this copy is. It quits the app when it replaces it: if the app is still here
    // when the script ends, it failed, and says so.
    func install() {
        guard let a = available else { return }
        guard let env = Self.installEnvironment(tag: a.tag, app: Bundle.main.bundleURL) else {
            return failed(a.version, "this copy isn't in a folder it can be updated in (move ZoteroLauncher.app to Applications first)")
        }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = ["-c", Self.installCommand(log: Self.logURL.path)]
        p.environment = ProcessInfo.processInfo.environment.merging(env) { _, b in b }
        p.terminationHandler = { [weak self] proc in
            guard proc.terminationStatus != 0 else { return }
            let last = ((try? String(contentsOf: Self.logURL, encoding: .utf8)) ?? "").split(separator: "\n").last.map(String.init) ?? "the download failed"
            DispatchQueue.main.async { self?.failed(a.version, last.replacingOccurrences(of: "install: ", with: "")) }
        }
        do { try p.run() } catch { failed(a.version, error.localizedDescription) }
    }

    private func failed(_ version: String, _ why: String) {
        let alert = NSAlert()
        alert.messageText = "Couldn't update to \(version)"
        alert.informativeText = why + "\n\nThe log: ~/Library/Logs/ZoteroLauncher-update.log"
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Copy the Terminal Command")
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertSecondButtonReturn, let a = available {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString("curl -fsSL https://github.com/\(Self.repo)/releases/download/\(a.tag)/install.sh | bash", forType: .string)
        }
    }
}
