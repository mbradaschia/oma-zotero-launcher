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
        let model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: FakeRunner(), fetcher: FakeFetcher())
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

    func testBadgesAndAStyledQueryDraw() throws {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent("snap-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: home) }
        let file = home.appendingPathComponent(".config/omarchy/oma-zotero-launcher/searches.json")
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: ["searches": [["id": "s1", "name": "Capabilities", "query": "dynamic capabilities", "pinned": true],
                                                                 ["id": "s2", "name": "Reviews", "query": "#review", "pinned": true]]]).write(to: file)
        let bridge = FakeBridge()
        bridge.answers["/search"] = { _ in .ok(Fixture.bridge("search-typed")) }
        bridge.answers["/sync/status"] = { _ in .ok(["ok": true, "configured": true, "running": false, "lastSync": ISO8601DateFormatter().string(from: Date().addingTimeInterval(-300))]) }
        let model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: FakeRunner(), fetcher: FakeFetcher())
        model.willShow(query: "a:teece !#draft \"resource based\" OR y:2020")
        model.selectSearch("s1")
        try render(model, "6-badges-query")
        model.goHome()
        model.execute(.openPicker)
        try render(model, "7-picker")
    }

    func testModelsAndProvidersDraw() throws {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent("snap-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: home) }
        let bridge = FakeBridge()
        bridge.answers["/search"] = { _ in .ok(Fixture.bridge("search-typed")) }
        let runner = FakeRunner()
        runner.answers["providers"] = { _, _ in FakeRunner.json(Fixture.synthetic("providers")) }
        runner.answers["models"] = { _, _ in FakeRunner.json(Fixture.synthetic("models")) }
        runner.answers["provider-test"] = { argv, _ in FakeRunner.json(["id": argv[2], "ok": true, "detail": "2 models", "models": [["value": "openai:gpt", "displayName": "GPT"]]]) }
        let model = LauncherModel(bridge: bridge, desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: runner, fetcher: FakeFetcher())
        model.willShow()
        model.openSettings("")
        try render(model, "8-settings-setup")
        model.openSettings("providers")
        try render(model, "9-providers")
        model.openProviderPage("openai")
        try render(model, "10-provider")
        model.goHome()
        runner.answers["list"] = { _, _ in FakeRunner.json(Fixture.synthetic("prompts")) }
        runner.answers["tasks"] = { _, _ in FakeRunner.json(Fixture.synthetic("tasks")) }
        model.openTasks()
        try render(model, "11-processes")
        model.goHome()
        model.setFilter("capabilities")
        bridge.answers["/item"] = { _ in .ok(Fixture.bridge("item")) }
        model.enterActions(model.searchRows.firstIndex { $0.kind == "item" } ?? 0)
        model.store.selectedIndex = model.listRows.firstIndex { $0.rowId == "prompts" } ?? 0
        model.execute(.activate)
        try render(model, "12-prompts")
        model.openSettings("rules")
        try render(model, "13-rules")
    }
}
