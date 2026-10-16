import AppKit
import XCTest
@testable import ZoteroLauncher

// R8-R10: a chat's window fits the screen and esc goes back from it; the launcher can be moved; a pin keeps it open
// (it doesn't hide when another app is used, and esc doesn't close it).
@MainActor
final class WindowsAndPinTests: XCTestCase {
    private var home: URL!
    private var model: LauncherModel!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("r8-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        let bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed")
        bridge.answers["/search"] = { body in var a = typed; a["query"] = body["query"] ?? ""; return .ok(a) }
        model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: FakeRunner(), fetcher: FakeFetcher())
        model.willShow()
        model.pinnedOpen = false
    }
    override func tearDown() async throws {
        model.pinnedOpen = false
        try? FileManager.default.removeItem(at: home)
    }

    func testAChatWindowFitsTheScreen() {
        let laptop = ChatWindows.initialSize(visible: NSRect(x: 0, y: 0, width: 1440, height: 875))
        XCTAssertLessThanOrEqual(laptop.width, 1440 * 0.7)
        XCTAssertLessThanOrEqual(laptop.height, 875 * 0.85)
        XCTAssertEqual(ChatWindows.initialSize(visible: NSRect(x: 0, y: 0, width: 2560, height: 1400)), NSSize(width: 960, height: 760))
        let small = ChatWindows.initialSize(visible: NSRect(x: 0, y: 0, width: 900, height: 560))
        XCTAssertGreaterThanOrEqual(small.width, 520, "never below the window's minimum")
    }

    func testEscGoesBackFromAChatWithNothingTyped() {
        let chat = ChatWindowModel(item: PaperRef(key: "K", libraryID: 1, title: "A paper", itemType: "journalArticle"), launcher: model, session: "")
        var closed = false, menu = false
        chat.close = { closed = true }
        model.showMenuFor = { _, _ in menu = true }
        chat.draft = "half a question"
        chat.escape()
        XCTAssertFalse(closed, "a question being typed isn't thrown away")
        chat.draft = ""
        chat.escape()
        XCTAssertTrue(closed)
        XCTAssertTrue(menu, "back on the paper's menu in the launcher")
    }

    func testTheLauncherCanBeMoved() {
        XCTAssertTrue(LauncherPanel(content: NSView()).isMovableByWindowBackground)
    }

    func testAPinnedLauncherStaysOpen() {
        var closes = 0
        model.close = { closes += 1 }
        model.pinnedOpen = true
        model.execute(.close)
        XCTAssertEqual(closes, 0, "esc doesn't close a pinned launcher")
        XCTAssertTrue(model.hintsFor().contains("⌘W close"), "\(model.hintsFor())")
        XCTAssertFalse(model.hintsFor().contains("esc close"))
        model.pinnedOpen = false
        model.execute(.close)
        XCTAssertEqual(closes, 1)
    }
}
