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

    static func installCommand(tag: String) -> String {
        "curl -fsSL https://github.com/\(repo)/releases/download/\(tag)/install.sh | bash"
    }

    // The daily check runs by itself, except under the tests and in fixture mode (neither reaches GitHub).
    static func automatic(_ env: [String: String]) -> Bool {
        env["XCTestConfigurationFilePath"] == nil && env["ZL_FIXTURES"] == nil
    }

    // Asks GitHub, at most once a day unless `now` (the menu's Check for Updates…). → done(the check answered)
    func check(now asked: Bool, done: ((Bool) -> Void)? = nil) {
        if !asked, let last = defaults.object(forKey: Self.checkedKey) as? Date, now().timeIntervalSince(last) < Self.day { return }
        defaults.set(now(), forKey: Self.checkedKey)
        fetcher.fetch(Self.releasesURL) { [weak self] result in
            guard let self else { return }
            guard case .success(let data) = result, let json = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else {
                self.problem = (try? result.get()) == nil ? "couldn't reach GitHub" : "GitHub's answer wasn't a list of releases"
                done?(false)
                return
            }
            self.problem = nil
            self.available = Self.latest(fromReleases: json).flatMap { Self.newer($0.version, than: self.current) ? $0 : nil }
            done?(true)
        }
    }

    // Check for Updates…: asked now, then said in a small alert.
    func checkFromMenu() {
        check(now: true) { [weak self] answered in
            guard let self else { return }
            let alert = NSAlert()
            if let a = available {
                alert.messageText = "\(a.version) is out"
                alert.informativeText = "You have \(current). Updating quits Zotero Launcher, installs \(a.version) and opens it."
                alert.addButton(withTitle: "Update")
                alert.addButton(withTitle: "Later")
                NSApp.activate(ignoringOtherApps: true)
                if alert.runModal() == .alertFirstButtonReturn { install() }
                return
            }
            alert.messageText = answered ? "You have the latest version (\(current))" : "Couldn't check for updates"
            alert.informativeText = answered ? "" : "GitHub didn't answer (\(problem ?? "offline?")). Try again later."
            NSApp.activate(ignoringOtherApps: true)
            alert.runModal()
        }
    }

    // The release's own install.sh (it names its tag), as the README installs it.
    func install() {
        guard let a = available else { return }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = ["-c", Self.installCommand(tag: a.tag)]
        try? p.run()
    }
}
