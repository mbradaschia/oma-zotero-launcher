import XCTest
@testable import ZoteroLauncher

// Updates from GitHub's releases (no Apple Developer Program: no Sparkle feed), on a fake fetcher: no test reaches
// the network.
@MainActor
final class UpdateCheckTests: XCTestCase {
    private var defaults: UserDefaults!
    private var fetcher: FakeFetcher!
    private var now = Date(timeIntervalSince1970: 2_000_000_000)

    override func setUp() async throws {
        defaults = UserDefaults(suiteName: "zl-update-\(UUID().uuidString)")
        fetcher = FakeFetcher()
    }

    private func check(current: String = "0.3.1") -> UpdateCheck {
        UpdateCheck(fetcher: fetcher, defaults: defaults, current: current, now: { [unowned self] in self.now })
    }

    private func answer(_ releases: [[String: Any]]) throws {
        fetcher.answers[UpdateCheck.releasesURL.absoluteString] = .success(try JSONSerialization.data(withJSONObject: releases))
    }

    func testVersionsCompareByNumber() {
        XCTAssertTrue(UpdateCheck.newer("0.3.10", than: "0.3.9"))
        XCTAssertTrue(UpdateCheck.newer("0.4", than: "0.3.9"))
        XCTAssertFalse(UpdateCheck.newer("0.3.0", than: "0.3.0"))
        XCTAssertFalse(UpdateCheck.newer("0.3", than: "0.3.0"))
        XCTAssertFalse(UpdateCheck.newer("0.2.9", than: "0.3.0"))
    }

    func testTheNewestMacReleaseIsPicked() {
        let releases: [[String: Any]] = [["tag_name": "v0.4.0", "draft": false, "prerelease": false],
                                         ["tag_name": "macos-v0.3.2", "draft": false, "prerelease": false],
                                         ["tag_name": "macos-v0.3.10", "draft": false, "prerelease": false],
                                         ["tag_name": "macos-nightly", "draft": false, "prerelease": true],
                                         ["tag_name": "macos-v0.3.11", "draft": true, "prerelease": false],
                                         ["tag_name": "macos-v0.3.12", "draft": false, "prerelease": true]]
        XCTAssertEqual(UpdateCheck.latest(fromReleases: releases)?.version, "0.3.10")
        XCTAssertEqual(UpdateCheck.latest(fromReleases: releases)?.tag, "macos-v0.3.10")
    }

    func testAMalformedAnswerOffersNothing() {
        XCTAssertNil(UpdateCheck.latest(fromReleases: [["name": "x"]]))
        XCTAssertNil(UpdateCheck.latest(fromReleases: [["tag_name": "macos-v1.x"]]))
    }

    func testANewerReleaseIsOfferedAndAnOlderOneIsNot() throws {
        try answer([["tag_name": "macos-v0.3.2", "draft": false, "prerelease": false]])
        let u = check()
        u.check(now: false)
        XCTAssertEqual(u.available?.version, "0.3.2")
        let same = check(current: "0.3.2")
        same.check(now: true)
        XCTAssertNil(same.available, "the version you have isn't an update")
    }

    func testAtMostOnceADayUnlessAsked() throws {
        try answer([["tag_name": "macos-v0.3.2", "draft": false, "prerelease": false]])
        check().check(now: false)
        check().check(now: false) // (the same day: not asked again)
        XCTAssertEqual(fetcher.fetched.count, 1)
        check().check(now: true) // (asked from the menu)
        XCTAssertEqual(fetcher.fetched.count, 2)
        now = now.addingTimeInterval(86_400 + 1)
        check().check(now: false)
        XCTAssertEqual(fetcher.fetched.count, 3)
    }

    func testAFailureShowsNothing() {
        let u = check() // (no answer: the fake fails, as offline would)
        u.check(now: false)
        XCTAssertNil(u.available)
        XCTAssertNotNil(u.problem)
        fetcher.answers[UpdateCheck.releasesURL.absoluteString] = .success(Data("{\"message\": \"rate limited\"}".utf8))
        u.check(now: true)
        XCTAssertNil(u.available)
    }

    // the release's installer downloaded to a file (a failed download fails, not an empty script), logged; the tag and
    // where the app is passed as variables, never inside the command
    func testTheInstallCommandDownloadsThenRunsTheTagsInstaller() {
        let cmd = UpdateCheck.installCommand(log: "/tmp/u.log")
        XCTAssertTrue(cmd.hasPrefix("set -o pipefail;"), cmd)
        XCTAssertTrue(cmd.contains("https://github.com/mbradaschia/zotero-companion-launcher/releases/download/$ZL_TAG/install.sh"), cmd)
        XCTAssertTrue(cmd.contains("&& bash"), cmd)
        XCTAssertTrue(cmd.contains(">>'/tmp/u.log' 2>&1"), cmd)
        XCTAssertFalse(cmd.contains("| bash"), cmd)
    }

    func testItInstallsWhereTheAppIs() {
        let env = UpdateCheck.installEnvironment(tag: "macos-v0.3.2", app: URL(fileURLWithPath: "/Users/me/Applications/ZoteroLauncher.app"))
        XCTAssertEqual(env?["ZL_TAG"], "macos-v0.3.2")
        XCTAssertEqual(env?["DEST"], "/Users/me/Applications")
        // a copy macOS runs from a randomized place (not moved out of Downloads), or renamed: not updated in place
        XCTAssertNil(UpdateCheck.installEnvironment(tag: "macos-v0.3.2", app: URL(fileURLWithPath: "/private/var/folders/x/AppTranslocation/Y/d/ZoteroLauncher.app")))
        XCTAssertNil(UpdateCheck.installEnvironment(tag: "macos-v0.3.2", app: URL(fileURLWithPath: "/Applications/Zotero Launcher 2.app")))
    }

    func testNoAutomaticCheckUnderTestsFixturesOrDebug() {
        XCTAssertFalse(UpdateCheck.automatic(["XCTestConfigurationFilePath": "/x"], debug: false))
        XCTAssertFalse(UpdateCheck.automatic(["ZL_FIXTURES": "/x"], debug: false))
        XCTAssertFalse(UpdateCheck.automatic([:], debug: true), "a Debug build (Xcode's) never replaces the installed app")
        XCTAssertTrue(UpdateCheck.automatic([:], debug: false))
    }

    // a check that failed (offline at login) is tried again at the next hourly tick, not a day later
    func testAFailedCheckIsTriedAgainSoon() throws {
        check().check(now: false) // (no answer: fails)
        try answer([["tag_name": "macos-v0.3.2", "draft": false, "prerelease": false]])
        let u = check()
        u.check(now: false)
        XCTAssertEqual(fetcher.fetched.count, 2)
        XCTAssertEqual(u.available?.version, "0.3.2")
    }
}
