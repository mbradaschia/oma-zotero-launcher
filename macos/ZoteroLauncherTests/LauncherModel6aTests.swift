import CryptoKit
import XCTest
@testable import ZoteroLauncher

// Phase 6a with a fake runner and a fake GitHub: Models & providers, keys, endpoints, the default
// models, the Mac's setup checklist, installing the AI features, the bridge's download, settings
// found from the search. No key in here is real.
@MainActor
final class LauncherModel6aTests: XCTestCase {
    private var home: URL!
    private var bridge: FakeBridge!
    private var desktop: FakeDesktop!
    private var runner: FakeRunner!
    private var fetcher: FakeFetcher!
    private var model: LauncherModel!

    override func setUp() async throws {
        home = FileManager.default.temporaryDirectory.appendingPathComponent("6a-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        bridge = FakeBridge()
        let typed = Fixture.bridge("search-typed")
        bridge.answers["/search"] = { body in var a = typed; a["query"] = body["query"] ?? ""; return .ok(a) }
        bridge.answers["/item"] = { _ in .ok(Fixture.bridge("item")) }
        bridge.answers["/sync/status"] = { _ in .ok(["ok": true, "configured": true, "running": false]) }
        desktop = FakeDesktop()
        runner = FakeRunner()
        runner.answers["providers"] = { _, _ in FakeRunner.json(Fixture.synthetic("providers")) }
        runner.answers["models"] = { _, _ in FakeRunner.json(Fixture.synthetic("models")) }
        runner.answers["provider-test"] = { argv, _ in
            FakeRunner.json(["id": argv[2], "ok": true, "detail": "1 model", "models": [["value": argv[2] + ":first-model", "displayName": "First"]], "at": "2026-10-13T12:00:00.000Z"])
        }
        runner.answers["secret"] = { argv, _ in FakeRunner.json(["ok": true, "provider": argv[3], "action": argv[2]]) }
        fetcher = FakeFetcher()
        model = LauncherModel(bridge: bridge, desktop: desktop, env: ["HOME": home.path, "hostname": "mac"], runner: runner, fetcher: fetcher)
        model.willShow()
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: home) }

    private var settingsFile: [String: Any] {
        let url = home.appendingPathComponent(".config/omarchy/oma-zotero-launcher.json")
        return ((try? Data(contentsOf: url)).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
    }

    private func select(_ test: (ListRow) -> Bool) throws {
        model.store.selectedIndex = try XCTUnwrap(model.listRows.firstIndex(where: test), "no such row")
    }

    // ---- Models & providers

    func testAPapersSetUpRowOpensModelsAndProviders() throws {
        runner.answers["providers"] = { _, _ in RunnerResult(status: 127, missing: true) }
        model.setFilter("capabilities")
        model.enterActions(try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "item" }))
        model.refreshProviders() // not installed: the menu's AI rows become one Set up row
        try select { $0.rowId == "setup" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "settings-providers")
    }

    func testOpeningSettingsAsksTheRunnerQuietly() throws {
        model.openSettings("providers")
        XCTAssertEqual(runner.calls("providers").count, 1)
        XCTAssertEqual(runner.calls("models").first?.argv, ["oma-zotero-prompt", "models", "--json", "--quiet"])
        XCTAssertTrue(model.listRows.contains { $0.rowId == "set-provider" && $0.value == "openai" })
        XCTAssertEqual(model.placeholder(), "‹ Settings › Models & providers")
        // openai's key is set and tested already (not stale): no test of its own on the way in
        XCTAssertTrue(runner.calls("provider-test").isEmpty)
    }

    func testAProviderPageTestsItAndOffersItsModels() throws {
        model.openSettings("providers")
        try select { $0.rowId == "set-provider" && $0.value == "openai" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "settings-provider")
        XCTAssertEqual(runner.calls("provider-test").last?.argv.prefix(3), ["oma-zotero-prompt", "provider-test", "openai"])
        XCTAssertEqual(model.placeholder(), "‹ Models & providers › OpenAI")
        try select { $0.rowId == "set-use" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "settings-models")
        try select { $0.rowId == "set-model" && $0.tag == "openai:first-model" }
        model.execute(.activate)
        XCTAssertEqual(model.flash, "Prompts and chat use openai:first-model")
        let defaults = settingsFile["defaults"] as? [String: Any]
        XCTAssertEqual((defaults?["prompts"] as? [String: Any])?["model"] as? String, "openai:first-model")
        XCTAssertEqual((defaults?["chat"] as? [String: Any])?["model"] as? String, "openai:first-model")
    }

    func testAKeyGoesOnStdinOnlyAndTheClipboardIsCleared() throws {
        let key = "sk-test-0000-not-a-real-key"
        desktop.clipboard = "sk-test-0000-\nnot-a-real-key\n" // a line break inside: gone, as the QML's tr -d does
        model.openSettings("providers")
        try select { $0.rowId == "set-provider" && $0.value == "openai" }
        model.execute(.activate)
        try select { $0.rowId == "set-key" }
        model.execute(.activate)
        let call = try XCTUnwrap(runner.calls("secret").last)
        XCTAssertEqual(call.argv, ["oma-zotero-prompt", "secret", "set", "openai", "--quiet"])
        XCTAssertEqual(call.stdin, key)
        XCTAssertFalse(runner.calls.contains { $0.argv.joined(separator: " ").contains(key) }) // never on a command line
        XCTAssertNil(desktop.clipboard)
        XCTAssertEqual(model.flash, "The key is in the keyring, and the clipboard is cleared")
        XCTAssertGreaterThanOrEqual(runner.calls("provider-test").count, 2) // tested again with it
    }

    func testAKeyRefusedOrMissingSaysWhy() throws {
        desktop.clipboard = "  "
        XCTAssertTrue(model.providerAction(try row("set-key", "openai")))
        XCTAssertEqual(model.flash, "Key not saved: the clipboard is empty: copy the key first")
        XCTAssertTrue(runner.calls("secret").isEmpty)
        desktop.clipboard = "hunter2" // not an OpenAI key: neither stored nor sent off to be tested
        _ = model.providerAction(try row("set-key", "openai"))
        XCTAssertEqual(model.flash, "Key not saved: that doesn't look like an OpenAI key (they start with sk-); the clipboard is left as it was")
        XCTAssertTrue(runner.calls("secret").isEmpty)
        desktop.clipboard = "sk-bad\"key"
        runner.answers["secret"] = { _, _ in RunnerResult(status: 1, stderr: "oma-zotero-prompt: the key has characters the Keychain command can't take") }
        _ = model.providerAction(try row("set-key", "openai"))
        XCTAssertEqual(model.flash, "Key not saved: the key has characters the Keychain command can't take")
        XCTAssertEqual(desktop.clipboard, "sk-bad\"key") // kept, to try again (the QML clears it only once saved)
        _ = model.providerAction(try row("set-key-remove", "openai"))
        XCTAssertEqual(model.flash, "Couldn't remove the key: the key has characters the Keychain command can't take")
    }

    func testTurningOneOnFillsTheEmptyDefaultsFromItsTest() throws {
        model.openSettings("providers")
        let before = (runner.calls("providers").count, runner.calls("models").count)
        try select { $0.rowId == "set-quick" && $0.value == "ollama" }
        model.execute(.activate)
        XCTAssertEqual(runner.calls("providers").count - before.0, 2) // as the QML: on saving, and after the test
        XCTAssertEqual(runner.calls("models").count - before.1, 2) // on saving, and once the defaults are filled
        XCTAssertEqual((settingsFile["providers"] as? [String: Any]).flatMap { ($0["ollama"] as? [String: Any])?["enabled"] as? Bool }, true)
        XCTAssertEqual(model.flash, "Default model: ollama:first-model (Settings › Defaults to change it)")
        XCTAssertEqual(((settingsFile["defaults"] as? [String: Any])?["prompts"] as? [String: Any])?["model"] as? String, "ollama:first-model")
    }

    func testATestThatFailsSaysSo() throws {
        runner.answers["provider-test"] = { _, _ in RunnerResult(status: 1, stderr: "oma-zotero-prompt: the server said 401") }
        model.openSettings("providers")
        try select { $0.rowId == "set-quick" && $0.value == "ollama" }
        model.execute(.activate)
        XCTAssertEqual(model.flash, "On, but not working yet: the server said 401")
        XCTAssertEqual(model.runnerState.tests["ollama"]?["ok"] as? Bool, false)
    }

    func testAnOlderTestsAnswerIsIgnored() throws {
        runner.hold = ["provider-test"]
        model.openSettings("providers")
        model.openProviderPage("openai") // a test on the way in
        desktop.clipboard = "sk-new-0000-not-a-real-key"
        _ = model.providerAction(try row("set-key", "openai")) // a new key: a new test
        runner.release("provider-test", RunnerResult(status: 1, stderr: "oma-zotero-prompt: 401 for the old key"))
        XCTAssertEqual(model.runnerState.tests["openai"]?["running"] as? Bool, true) // the new one still runs
        runner.release("provider-test", FakeRunner.json(["id": "openai", "ok": true, "detail": "works", "models": []]))
        XCTAssertEqual(model.runnerState.tests["openai"]?["detail"] as? String, "works")
    }

    func testAnEndpointsContextClearedGoesBackToTheDefault() throws {
        model.openSettings("providers")
        try select { $0.rowId == "set-endpoint-new" }
        model.execute(.activate)
        model.setFilter("Lab")
        try select { $0.rowId == "set-save" }
        model.execute(.activate)
        model.setFilter("https://gateway.example.edu/v1")
        try select { $0.rowId == "set-save" }
        model.execute(.activate)
        model.openSettingsEdit("endpoint.lab.context")
        model.setFilter("32k")
        try select { $0.rowId == "set-save" }
        model.execute(.activate)
        XCTAssertEqual(((settingsFile["providers"] as? [String: Any])?["compatible"] as? [[String: Any]])?.first?["context"] as? Int, 32768)
        model.openSettingsEdit("endpoint.lab.context")
        model.setFilter("")
        try select { $0.rowId == "set-save" }
        model.execute(.activate)
        XCTAssertEqual(model.flash, "Saved")
        XCTAssertNil(((settingsFile["providers"] as? [String: Any])?["compatible"] as? [[String: Any]])?.first?["context"])
    }

    func testAnEndpointAddedInTwoStepsThenRemoved() throws {
        model.openSettings("providers")
        try select { $0.rowId == "set-endpoint-new" }
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "settings-edit")
        model.setFilter("LM Studio")
        try select { $0.rowId == "set-save" }
        model.execute(.activate)
        XCTAssertEqual(model.settingsView.edit?["type"] as? String, "endpoint-url")
        model.setFilter("http://localhost:1234/v1")
        try select { $0.rowId == "set-save" }
        model.execute(.activate)
        let compatible = (settingsFile["providers"] as? [String: Any])?["compatible"] as? [[String: Any]]
        XCTAssertEqual(compatible?.first?["baseURL"] as? String, "http://localhost:1234/v1")
        XCTAssertEqual(model.store.view, "settings-provider")
        XCTAssertEqual(model.runnerState.provider, "lm-studio")
        XCTAssertEqual(model.flash, "Added “LM Studio”: set its key if it needs one, then test it")
        _ = model.providerAction(try row("set-endpoint-remove", "lm-studio"))
        XCTAssertEqual(model.flash, "Endpoint removed")
        XCTAssertEqual(((settingsFile["providers"] as? [String: Any])?["compatible"] as? [Any])?.count ?? 0, 0)
    }

    // ---- setup and installing

    func testTheSetupChecklistIsAMacs() throws {
        runner.nodeVersion = ""
        runner.hasPdftotext = false
        model.openSettings("")
        let setup = model.listRows.filter { $0.section == "Setup" }
        XCTAssertFalse(setup.contains { ["bind-add", "rule-add"].contains($0.value) })
        try select { $0.value == "copy:brew install node" }
        model.execute(.activate)
        XCTAssertEqual(desktop.copied.last, "brew install node")
        XCTAssertEqual(model.flash, "Copied “brew install node”: paste it in Terminal, then come back here when it's done")
        XCTAssertTrue(setup.contains { $0.value == "copy:brew install poppler" })
    }

    func testInstallingRunsTheBundledScriptAndSaysWhenDone() throws {
        let script = try XCTUnwrap(RunnerKit.installScript(), "the app carries RunnerKit")
        XCTAssertTrue(FileManager.default.fileExists(atPath: script.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("runner/package.json").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: script.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("runner/node_modules").path))
        runner.hold = [script.path]
        model.openSettings("")
        model.runSetupAction("install")
        XCTAssertTrue(model.runnerState.installing)
        XCTAssertEqual(model.countText, "installing…")
        runner.release(script.path, RunnerResult(status: 0, stdout: "installed"))
        XCTAssertFalse(model.runnerState.installing)
        XCTAssertEqual(model.flash, "AI features installed")
        runner.nodeVersion = "20.1.0"
        model.refreshRequirements() // as Settings does when it opens
        model.runSetupAction("install")
        XCTAssertEqual(model.flash, "Install Node.js 22 or newer first: brew install node")
    }

    func testTheReinstallOfferComparesVersions() throws {
        let kit = home.appendingPathComponent("Kit")
        try FileManager.default.createDirectory(at: kit.appendingPathComponent("macos/runner"), withIntermediateDirectories: true)
        try Data(#"{"version": "0.2.1"}"#.utf8).write(to: kit.appendingPathComponent("macos/runner/package.json"))
        let installed = home.appendingPathComponent(".local/share/oma-zotero-launcher/runner")
        try FileManager.default.createDirectory(at: installed, withIntermediateDirectories: true)
        try Data(#"{"version": "0.2.0"}"#.utf8).write(to: installed.appendingPathComponent("package.json"))
        XCTAssertEqual(RunnerKit.update(home: home.path, in: kit), ["installed": "0.2.0", "bundled": "0.2.1"])
        try Data(#"{"version": "0.10.0"}"#.utf8).write(to: installed.appendingPathComponent("package.json"))
        XCTAssertNil(RunnerKit.update(home: home.path, in: kit)) // newer installed: nothing offered
    }

    func testTheBridgeIsTheNewestPluginReleaseCheckedAgainstItsSum() throws {
        let xpi = Data("plugin bytes".utf8)
        let sum = SHA256.hash(data: xpi).map { String(format: "%02x", $0) }.joined()
        let releases: [[String: Any]] = [
            ["tag_name": "macos-v0.3.0", "draft": false, "prerelease": false, "assets": [["name": "ZoteroLauncher.zip", "browser_download_url": "https://github.com/x/macos.zip"]]],
            ["tag_name": "v0.2.1", "draft": false, "prerelease": false, "assets": [["name": "zotero-bridge-0.2.1.xpi", "browser_download_url": "https://github.com/x/zotero-bridge-0.2.1.xpi"],
                                                                                    ["name": "zotero-bridge-0.2.1.xpi.sha256", "browser_download_url": "https://github.com/x/sum"]]]
        ]
        fetcher.answers["https://api.github.com/repos/\(BridgeDownloader.repo)/releases?per_page=30"] = .success(try JSONSerialization.data(withJSONObject: releases))
        fetcher.answers["https://github.com/x/zotero-bridge-0.2.1.xpi"] = .success(xpi)
        fetcher.answers["https://github.com/x/sum"] = .success(Data((sum + "  zotero-bridge-0.2.1.xpi\n").utf8))
        let downloads = home.appendingPathComponent("Downloads")
        let d = BridgeDownloader(fetcher: fetcher, downloads: downloads)
        var saved: Result<URL, BridgeDownloader.Failure>?
        d.download { saved = $0 }
        XCTAssertEqual(try saved?.get().lastPathComponent, "zotero-bridge-0.2.1.xpi")
        XCTAssertEqual(try Data(contentsOf: downloads.appendingPathComponent("zotero-bridge-0.2.1.xpi")), xpi)
        // the version this app expects, before a newer one; only github.com; never without its sum
        let picked = BridgeDownloader.pick([["tag_name": "v0.3.0", "assets": [["name": "b.xpi", "browser_download_url": "https://github.com/x/b-0.3.0.xpi"], ["name": "b.xpi.sha256", "browser_download_url": "https://github.com/x/s3"]]],
                                            ["tag_name": "v0.2.1", "assets": [["name": "b.xpi", "browser_download_url": "https://github.com/x/b-0.2.1.xpi"], ["name": "b.xpi.sha256", "browser_download_url": "https://github.com/x/s2"]]]], expected: "0.2.1")
        XCTAssertEqual(picked?.xpi.lastPathComponent, "b-0.2.1.xpi")
        XCTAssertNil(BridgeDownloader.pick([["tag_name": "v0.2.1", "assets": [["name": "b.xpi", "browser_download_url": "https://github.com/x/b.xpi"]]]], expected: nil))
        XCTAssertNil(BridgeDownloader.pick([["tag_name": "v0.2.1", "assets": [["name": "b.xpi", "browser_download_url": "https://evil.example/b.xpi"], ["name": "b.xpi.sha256", "browser_download_url": "https://evil.example/s"]]]], expected: nil))
        fetcher.answers["https://github.com/x/sum"] = .success(Data(String(repeating: "0", count: 64).utf8))
        d.download { saved = $0 }
        guard case .failure(let why) = saved else { return XCTFail("a bad sum must refuse it") }
        XCTAssertEqual(why.description, "the download doesn't match its SHA-256: not installing it")
        model.runSetupAction("bridge-install") // no answers for the model's own downloader: it says so
        XCTAssertTrue(model.flash.hasPrefix("Couldn't get the Zotero Omarchy Bridge: "))
    }

    // ---- settings found from the search

    func testASettingFoundFromTheSearchOpensOnItsRow() throws {
        model.setFilter("results per search")
        let found = try XCTUnwrap(model.searchRows.first { $0.kind == "setting" })
        model.enterActions(try XCTUnwrap(model.searchRows.firstIndex { $0.key == found.key }))
        XCTAssertEqual(model.store.view, "settings-general")
        XCTAssertEqual(model.selectedListRow?.label, found.title)
        model.goHome()
        model.enterActions(try XCTUnwrap(model.searchRows.firstIndex { $0.kind == "item" }))
        model.setFilter("results per search")
        let go = try XCTUnwrap(model.listRows.firstIndex { $0.rowId == "setting-go" }) // below the menu's own rows
        model.store.selectedIndex = go
        model.execute(.activate)
        XCTAssertEqual(model.store.view, "settings-general")
    }

    private func row(_ id: String, _ value: String) throws -> ListRow {
        try JSCore().call("Views", "listRow", [["rowId": id, "value": value, "available": true]], as: ListRow.self)
    }
}
