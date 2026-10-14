import XCTest
@testable import ZoteroLauncher

// The conventions the UX consistency review settled (macos/PLAN.md, before each phase's PR): one
// key notation (the Mac's), one shape for what isn't on the Mac yet, failures said even after the
// launcher closed, empty states that say what to do, no Linux-only settings or words.
@MainActor
final class ConsistencyTests: XCTestCase {
    private var home: URL!
    private var bridge: FakeBridge!
    private var desktop: FakeDesktop!
    private var model: LauncherModel!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("ux-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed")
        bridge.answers["/search"] = { body in var a = typed; a["query"] = body["query"] ?? ""; return .ok(a) }
        bridge.answers["/item"] = { _ in .ok(Fixture.bridge("item")) }
        desktop = FakeDesktop()
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private func open(keys: String = "single") throws {
        let file = home.appendingPathComponent(".config/omarchy/oma-zotero-launcher.json")
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(#"{"general": {"keys": "\#(keys)"}}"#.utf8).write(to: file)
        let runner = FakeRunner()
        runner.answers["list"] = { _, _ in FakeRunner.json(Fixture.synthetic("prompts")) }
        runner.answers["providers"] = { _, _ in FakeRunner.json(Fixture.synthetic("providers")) }
        runner.answers["models"] = { _, _ in FakeRunner.json(Fixture.synthetic("models")) }
        runner.answers["tasks"] = { _, _ in FakeRunner.json(Fixture.synthetic("tasks")) }
        model = LauncherModel(bridge: bridge, desktop: desktop, env: ["HOME": home.path, "hostname": "mac"], runner: runner, fetcher: FakeFetcher())
        model.willShow()
    }

    // Every hint in every view the Mac has, in both key modes: modifiers as ⌥ ⇧ ⌃ ⌘, never spelled out.
    func testEveryHintUsesTheMacsKeyNotation() throws {
        for keys in ["single", "alt"] {
            try open(keys: keys)
            var seen: [String] = []
            // the hints, the box, and every row's own words (a paper's own text excepted: notes, tasks)
            let look = {
                seen += self.model.hints() + [self.model.placeholder(), self.model.headerPlaceholder()]
                seen += self.model.listRows.filter { !["note", "read", "todo", "task"].contains($0.rowId) }.flatMap { [$0.label, $0.detail] }
            }
            look()
            model.setFilter("capabilities")
            look()
            model.enterActions(try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "item" }))
            look()
            if let i = model.listRows.firstIndex(where: { $0.rowId == "extract" && !$0.noteKey.isEmpty }) {
                model.store.selectedIndex = i
                model.openExtractMenu()
                look()
                model.back()
            }
            model.store.selectedIndex = model.listRows.firstIndex { $0.rowId == "prompts" } ?? 0
            model.execute(.activate)
            look()
            model.store.selectedIndex = model.listRows.firstIndex { $0.rowId == "prompt" } ?? 0
            model.editSelectedPrompt()
            look()
            for page in ["", "general", "providers", "tasks", "paper-status"] {
                model.goHome()
                model.openSettings(page)
                look()
            }
            model.goHome()
            model.openTodos()
            look()
            model.goHome()
            model.execute(.openPicker)
            look()
            model.goHome()
            model.openTasks()
            look()
            for page in ["defaults", "rules"] {
                model.goHome()
                model.openSettings(page)
                look()
            }
            for text in seen {
                for spelled in ["alt+", "Alt+", "ctrl+", "Ctrl+", "Shift+", "cmd+"] { XCTAssertFalse(text.contains(spelled), "“\(text)” spells \(spelled) (\(keys))") }
            }
            XCTAssertEqual(model.keyName("t"), keys == "alt" ? "⌥t" : "t")
            XCTAssertEqual(model.keyName("W"), keys == "alt" ? "⌥⇧W" : "W")
        }
    }

    func testWhatIsntOnTheMacYetSaysSoOneWay() throws {
        try open()
        XCTAssertTrue(model.keyAction("c"))
        XCTAssertEqual(model.flash, "Not on the Mac yet: chat (c) comes in a later version")
        XCTAssertTrue(model.keyAction("."))
        XCTAssertEqual(model.store.view, "tasks") // Processes: on the Mac since 6b
        model.back()
        model.execute(.openKeys)
        XCTAssertTrue(model.flash.hasPrefix("Not on the Mac yet: the keys panel ("), model.flash)
    }

    func testAFailureAfterTheLauncherClosedIsSaidWhenItOpens() throws {
        try open()
        model.didHide()
        model.notify("Couldn't open the file", "no PDF on disk")
        XCTAssertEqual(model.flash, "")
        model.willShow()
        XCTAssertEqual(model.flash, "Couldn't open the file: no PDF on disk")
        model.willShow()
        XCTAssertEqual(model.flash, "") // said once
    }

    func testTheEmptyListSaysWhatToDoAndEnterDoesIt() throws {
        bridge.answers["/search"] = { _ in .zoteroDown }
        desktop.zoteroInstalled = false
        try open()
        XCTAssertEqual(model.emptyState.title, "Zotero isn't installed")
        XCTAssertEqual(model.emptyState.detail, "Settings (;) › Setup opens zotero.org: Enter goes there")
        XCTAssertEqual(model.footerNote, "") // the list says it: not twice
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "settings")
        bridge.answers["/search"] = { _ in .bridgeMissing }
        model.goHome()
        model.requestSearch()
        XCTAssertEqual(model.emptyState.title, "The Zotero Omarchy Bridge isn't installed")
    }

    func testTheMacOffersOnlyWhatItReads() throws {
        try open()
        model.openSettings("general")
        XCTAssertFalse(model.listRows.contains { ["general.externalPdfCommand", "general.zoteroCommand"].contains($0.value) })
        XCTAssertTrue(model.listRows.contains { $0.value == "general.promptCommand" }) // the runner honours it
        model.goHome()
        model.openSettings("")
        for r in model.listRows {
            for word in ["Hyprland", "omarchy", "keyring", "wl-copy", "General › Advanced"] { XCTAssertFalse((r.label + r.detail).contains(word), "“\(r.label)”: \(word)") }
        }
    }

    func testPickingATasksPaperSaysSo() throws {
        try open()
        XCTAssertTrue(model.keyAction("t"))
        model.setFilter("About it")
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "todo-quick" })
        model.execute(.activate)
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "todo-pick" })
        model.execute(.activate)
        XCTAssertEqual(model.context?.text, "Pick the paper this task is about")
        XCTAssertTrue(model.headerPlaceholder().hasPrefix("Type to find the paper"))
        XCTAssertEqual(model.hints().contains("↵ pick it"), true)
    }
}
