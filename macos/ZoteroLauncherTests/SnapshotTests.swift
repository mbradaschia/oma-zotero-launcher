import SwiftUI
import XCTest
@testable import ZoteroLauncher

// The launcher drawn off-screen on the fixtures, written as PNGs when SNAPSHOT_DIR is set (to look
// at a change by eye); otherwise only checks that each state draws.
@MainActor
final class SnapshotTests: XCTestCase {
    private func render(_ model: LauncherModel, _ name: String) throws {
        let view = NSHostingView(rootView: LauncherView(model: model))
        view.frame = NSRect(origin: .zero, size: LauncherPanel.size)
        view.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        let rep = try XCTUnwrap(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: rep)
        let png = try XCTUnwrap(rep.representation(using: .png, properties: [:]))
        XCTAssertGreaterThan(png.count, 1000)
        if let dir = ProcessInfo.processInfo.environment["SNAPSHOT_DIR"] {
            try png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }

    func testTheResultsAndAPapersMenuDraw() throws {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent("snap-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: home) }
        let bridge = FakeBridge()
        bridge.answers["/search"] = { _ in .ok(Fixture.bridge("search-typed")) }
        bridge.answers["/item"] = { _ in .ok(Fixture.bridge("item")) }
        bridge.answers["/cite"] = { _ in .ok(["ok": true, "entries": [["text": "(Author, 2020)"]]]) }
        let model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"])
        model.willShow()
        try render(model, "1-results")
        model.enterActions(model.searchRows.firstIndex { $0.kind == "item" } ?? 0)
        try render(model, "2-menu")
        model.askConfirm(ConfirmAsk(title: "Delete the extracted text?", yes: "Delete it", no: "Keep it", run: {}))
        try render(model, "3-confirm")
        model.back()
        bridge.answers["/tags/list"] = { _ in .ok(Fixture.bridge("tags-list")) }
        model.enterTags()
        try render(model, "4-tags")
        model.goHome()
        model.openSettings("general")
        try render(model, "5-settings-general")
    }
}
