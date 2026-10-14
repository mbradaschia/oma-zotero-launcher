# Finishing the Mac app: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** close what stands between `macos-v0.3.0` and a finished app: every flow tested on screen, the AI
features (setup, providers, prompts, Processes, extraction, chat, artifacts, taxonomies, rules, automation)
included, first on fixtures in CI and then on the real runner; the gaps the conventions still list; updates
without the Apple Developer Program; files back under the size rule; and the `macos-v0.3.1` release.

**Architecture:** the app stays as it is (SwiftUI/AppKit over `lib/` in JavaScriptCore, the runner, the bridge).
The new pieces are small and behind seams that exist: `Bridge` and `Runner` get fixture implementations the real
app can be started with (Debug only), `Bridge` gains `get`, and an `UpdateCheck` reads GitHub's releases.

**Tech Stack:** Swift 5 / SwiftUI / AppKit (macOS 14+), XCTest and XCUITest, XcodeGen, GitHub Actions
(`macos-15`), node 22 for `js/` and the runner.

**Spec:** `macos/PLAN.md` ("What done means": its AI and Automation rows above all; "Testing": "a few XCUITest
smoke flows"), the phase 6 to 9 specs in `macos/docs/superpowers/specs/`, the "Known gaps" of
`macos/docs/ux-conventions.md`, and the user's requests of 2026-10-14 (test it yourself; Mac only now).

## Global Constraints

- Mac only: the Omarchy machine is broken; shared `lib/` changes keep the root suites green (`make test`,
  `make lint`) and `macos/js/lib` equal to `lib/` (`cmp`).
- No library content in fixtures, tests, logs or replies; fixtures are the scrubbed ones in
  `macos/ZoteroLauncherTests/Fixtures` (bridge) and `Fixtures/synthetic` (made up).
- Tests never run the user's installed `oma-zotero-prompt`, never use real API keys, never reach GitHub or the
  network (the update check is tested with a fake fetcher).
- Fixture mode exists in Debug builds only (`#if DEBUG`); a Release build ignores `ZL_FIXTURES`.
- No em dashes anywhere (code comments, docs, commit messages, UI text).
- Files 200 to 400 lines (800 at most); conventions in `macos/docs/ux-conventions.md`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PRs end with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Outward steps need the user's OK at the time: merging, tagging a release, anything published.
- Before each PR: the full Swift suite, `make test`, `make lint`, `node --test js/tests/*.test.js`,
  `scripts/parity.sh`, goldens `--check`, and the repo's `ux-consistency-reviewer` agent over the change.

## Review Focus

- The real app started with `ZL_FIXTURES` and a Release build: it must ignore the variable and talk to Zotero.
- A fixture route the app asks for that the fixture bridge doesn't know: an empty `ok` answer, never a crash or a
  hang (a hang stalls every UI test).
- Update check offline, rate-limited (HTTP 403) or with a malformed answer: no notice, no error shown, retried a
  day later; never offering an older or equal version (`0.3.10` is newer than `0.3.9`).
- `/ping` on an older bridge without `index.count`: no "· N items", never "· 0 items".
- Splitting a file must not change behaviour: the full suite passes before and after, with no test edits.
- A chat answer cut off mid-stream (the runner dies, esc): the chat keeps what came, says it stopped, and the
  next question works; a stopped turn is never saved as a done one.
- The AI features missing or no model set up: every AI row says so in one shape ("… needs the AI features:
  Settings › Setup installs them", "Set up an AI model first") and nothing hangs waiting for a runner.
- The sync folder away while an AI write is asked for (a prompt saved, a taxonomy accepted, a chat renamed):
  refused up front with the sync folder's sentence, before any work starts.
- A process that fails (the runner exits non-zero, a model error): Processes shows it failed with its reason, and
  Enter on it does nothing rather than opening a missing note.

---

### Task 1: Fixture mode for the real app

The UI tests need Zotero today and skip without it, so CI never runs them. This task lets the real app run on the
scrubbed fixtures.

**Files:**
- Create: `macos/ZoteroLauncher/Testing/FixtureBridge.swift`
- Create: `macos/ZoteroLauncher/Testing/FixtureRunner.swift`
- Modify: `macos/ZoteroLauncher/Launcher/LauncherPanel.swift:34-35` (`LauncherController.model`)
- Test: `macos/ZoteroLauncherTests/FixtureModeTests.swift`

**Interfaces:**
- Produces: `FixtureBridge(dir: URL)` (conforms to `Bridge`), `FixtureRunner(dir: URL)` (conforms to `Runner`),
  `FixtureMode.directory(_ env: [String: String]) -> URL?` (Debug: `ZL_FIXTURES` if it's a directory; Release:
  always nil).

- [ ] **Step 1: Write the failing tests**

```swift
import XCTest
@testable import ZoteroLauncher

// Fixture mode (Debug only): the real app on the scrubbed fixtures, for the UI tests in CI.
@MainActor
final class FixtureModeTests: XCTestCase {
    private var dir: URL { Bundle(for: FakeBridge.self).resourceURL!.appendingPathComponent("Fixtures") }

    func testTheDirectoryComesFromTheEnvironment() {
        XCTAssertEqual(FixtureMode.directory(["ZL_FIXTURES": dir.path])?.path, dir.path)
        XCTAssertNil(FixtureMode.directory(["ZL_FIXTURES": "/nonexistent"]))
        XCTAssertNil(FixtureMode.directory([:]))
    }

    func testTheBridgeAnswersSearchesAndItemsFromTheFixtures() {
        let bridge = FixtureBridge(dir: dir)
        var typed: BridgeResult?, item: BridgeResult?, unknown: BridgeResult?
        bridge.post("/search", ["query": "work"], timeout: 1) { typed = $0 }
        bridge.post("/item", ["key": "K"], timeout: 1) { item = $0 }
        bridge.post("/nowhere", [:], timeout: 1) { unknown = $0 }
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        guard case .ok(let t) = typed, case .ok = item, case .ok(let u) = unknown else { return XCTFail("not ok") }
        XCTAssertFalse((t["results"] as? [Any] ?? []).isEmpty)
        XCTAssertEqual(u.count, 0, "an unknown route answers an empty ok")
    }

    func testTheRunnerAnswersPromptsAndChats() {
        let runner = FixtureRunner(dir: dir)
        var prompts: RunnerResult?
        runner.run(["list", "--json"], stdin: nil, timeout: 1) { prompts = $0 }
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        XCTAssertNotNil((prompts?.json as? [String: Any])?["prompts"])
    }
}
```

- [ ] **Step 2: Run them and see them fail**

Run: `xcodebuild test -project macos/ZoteroLauncher.xcodeproj -scheme ZoteroLauncher -destination 'platform=macOS' -only-testing:ZoteroLauncherTests/FixtureModeTests`
Expected: FAIL, "cannot find 'FixtureMode' in scope".

- [ ] **Step 3: Implement**

`FixtureBridge.swift`:

```swift
#if DEBUG
import Foundation

// Fixture mode: ZL_FIXTURES names a folder like ZoteroLauncherTests/Fixtures; the app answers from it instead of
// Zotero and the runner (the UI tests in CI). Debug builds only: a Release build never reads ZL_FIXTURES.
enum FixtureMode {
    static func directory(_ env: [String: String]) -> URL? {
        guard let path = env["ZL_FIXTURES"] else { return nil }
        var isDir: ObjCBool = false
        return FileManager.default.fileExists(atPath: path, isDirectory: &isDir) && isDir.boolValue ? URL(fileURLWithPath: path) : nil
    }

    static func json(_ dir: URL, _ name: String) -> [String: Any]? {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent(name + ".json")) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}

final class FixtureBridge: Bridge {
    private let dir: URL
    init(dir: URL) { self.dir = dir.appendingPathComponent("bridge") }

    // route → fixture; the search's query is kept so the box and the results agree
    private func answer(_ route: String, _ body: [String: Any]) -> [String: Any] {
        switch route {
        case "/search":
            let typed = (body["query"] as? String ?? "").isEmpty == false
            var a = FixtureMode.json(dir, typed ? "search-typed" : "search-empty") ?? FixtureMode.json(dir, "search-typed") ?? [:]
            a["query"] = body["query"] ?? ""
            return a
        case "/item": return FixtureMode.json(dir, "item") ?? [:]
        case "/tags/list": return FixtureMode.json(dir, "tags-list") ?? [:]
        default: return [:] // (an empty ok: the view shows its empty state, never a hang)
        }
    }

    func reload() {}

    func post(_ route: String, _ body: [String: Any], timeout: TimeInterval, completion: @escaping (BridgeResult) -> Void) {
        let a = answer(route, body)
        DispatchQueue.main.async { completion(.ok(a)) }
    }
}
#endif
```

`FixtureRunner.swift` answers the runner's subcommands from `Fixtures/synthetic/<subcommand>.json` (`list` →
`prompts.json`, `providers` → `providers.json`, `models` → `models.json`), `chats` and `artifacts` with one
made-up chat and artifact (the ones in `NavConsistencyTests`), `tasks` with an empty list, anything else with
`{}`; `launch` returns `true` and runs nothing; `requirements` reports node 22 found and the runner installed;
`stream` returns nil (no chat answers in fixture mode). Copy the `RunnerResult` construction from
`ZoteroLauncherTests/Fakes.swift` (`FakeRunner.json`).

In `LauncherController` (`LauncherPanel.swift:34`), choose the pair:

```swift
let model: LauncherModel = {
    let env = ProcessInfo.processInfo.environment
    #if DEBUG
    if let dir = FixtureMode.directory(env) {
        return LauncherModel(bridge: FixtureBridge(dir: dir), runner: FixtureRunner(dir: dir), fetcher: URLSessionFetcher())
    }
    #endif
    return LauncherModel(runner: ProcessRunner(environment: env.merging(AppPaths.environment()) { _, b in b }), fetcher: URLSessionFetcher())
}()
```

- [ ] **Step 4: Run the tests and the full suite**

Run the command of step 2 (PASS), then the whole `ZoteroLauncher` scheme (all pass).

- [ ] **Step 5: Commit**

```bash
git add macos/ZoteroLauncher/Testing macos/ZoteroLauncher/Launcher/LauncherPanel.swift macos/ZoteroLauncherTests/FixtureModeTests.swift
git commit -m "test(macos): fixture mode, the real app on the scrubbed fixtures (Debug only)"
```

### Task 2: The on-screen flows in CI

**Files:**
- Modify: `macos/ZoteroLauncherUITests/FlowTests.swift` (setUp: launch with fixtures unless `ZL_UI_REAL=1`)
- Create: `macos/ZoteroLauncherUITests/AIFlowTests.swift` (prompts and chats on the fixture runner)
- Modify: `.github/workflows/macos.yml` (a step after "Unit tests")
- Modify: `macos/README.md` ("Development": how to run them on fixtures and on Zotero)

**Interfaces:**
- Consumes: `ZL_FIXTURES` (Task 1).

- [ ] **Step 1: Point the flows at the fixtures**

```swift
// FlowTests.setUpWithError, before app.launch():
let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("ZoteroLauncherTests/Fixtures").path
if ProcessInfo.processInfo.environment["ZL_UI_REAL"] != "1" { app.launchEnvironment["ZL_FIXTURES"] = fixtures }
```

The `XCTSkip("no results")` stays for the real mode only.

- [ ] **Step 2: Write the AI flows (they fail until the fixture runner answers them)**

```swift
// AIFlowTests: a paper's menu lists its prompts and its chat; Chats lists the made-up chat; Prompts opens.
func testAPapersMenuListsItsPromptsAndChat() {
    app.typeText("work")
    RunLoop.current.run(until: Date().addingTimeInterval(1))
    // the first paper: Enter opens its menu
    app.typeKey(.downArrow, modifierFlags: []); app.typeKey(.return, modifierFlags: [])
    RunLoop.current.run(until: Date().addingTimeInterval(1.5))
    let labels = rows().map { $0.label }
    XCTAssertTrue(labels.contains { $0.hasPrefix("Its argument") }, "the paper's chat isn't in its menu: \(labels)")
    XCTAssertTrue(labels.contains { $0.hasPrefix("Chat with the paper") })
}
```

(`rows()` as in `FlowTests`: copy the snapshot walk, a row is a button 30+ points tall and 300+ wide.)

- [ ] **Step 3: Run them locally on fixtures**

Run: `xcodebuild test -project macos/ZoteroLauncher.xcodeproj -scheme ZoteroLauncherUITests -destination 'platform=macOS'`
Expected: every FlowTests and AIFlowTests test passes with Zotero quit.

- [ ] **Step 4: Add them to CI (not gating at first)**

```yaml
      - name: The app on screen (fixtures)
        continue-on-error: true # (best effort, PLAN.md › Testing: never gating on a flaky test)
        run: |
          xcodebuild test -project ZoteroLauncher.xcodeproj -scheme ZoteroLauncherUITests \
            -destination 'platform=macOS,arch=arm64' -derivedDataPath build | xcbeautify
```

- [ ] **Step 5: Commit**

```bash
git add macos/ZoteroLauncherUITests .github/workflows/macos.yml macos/README.md
git commit -m "test(macos): the on-screen flows on fixtures, in CI too"
```

After five green runs on `master`, drop `continue-on-error` in a one-line PR.

### Task 3: The fixture runner speaks the AI features

Task 1's runner answers the lists; the AI flows need it to answer every subcommand the app sends (the app's
`runRunner`, `taxJob`, `launch` and `stream` calls: `list`, `run`, `new-ai`, `providers`, `provider-test`,
`models`, `secret`, `tasks`, `extract`, `extract-batch`, `chats`, `chat-show`, `chat-rename`, `chat-delete`,
`artifacts`, `taxonomies`, `taxonomy-show`, `taxonomy-new`, `taxonomy-save`, `taxonomy-draft`,
`taxonomy-remove`, `classify`, `classify-show`, `classify-status`, `classify-review`, `classify-decide`,
`note`), with a little state so a run shows up in Processes and a chat answer streams.

**Files:**
- Modify: `macos/ZoteroLauncher/Testing/FixtureRunner.swift`
- Create: `macos/ZoteroLauncherTests/Fixtures/synthetic/runner/` (one made-up answer per subcommand, named
  `<subcommand>.json`; `chat-stream.jsonl`, the events of one answer)
- Test: `macos/ZoteroLauncherTests/FixtureRunnerTests.swift`

**Interfaces:**
- Consumes: the `Runner` protocol (`RunnerClient.swift:36`), `RunnerStream` (`RunnerStream.swift:5`).
- Produces: `FixtureRunner(dir: URL, streamDelay: TimeInterval = 0.05)`; `FixtureRunner.calls: [[String]]` (every
  argv, for the UI tests' log); after `launch(["run", ...])` the next `tasks` answer holds that run as `done`
  with a `noteKey`; `stream(["chat", ...])` emits `chat-stream.jsonl`'s lines one by one, `stop()` ends it without
  the `done` event.

- [ ] **Step 1: Write the failing tests**

```swift
import XCTest
@testable import ZoteroLauncher

@MainActor
final class FixtureRunnerTests: XCTestCase {
    private var dir: URL { Bundle(for: FakeBridge.self).resourceURL!.appendingPathComponent("Fixtures") }
    private func settle(_ s: Double = 0.3) { RunLoop.main.run(until: Date().addingTimeInterval(s)) }

    func testARunShowsUpInTasksAsDoneWithItsNote() {
        let runner = FixtureRunner(dir: dir)
        XCTAssertTrue(runner.launch(["run", "--prompt", "summary", "--item", "1:P3NM4G92"]))
        var tasks: [[String: Any]] = []
        runner.run(["tasks"], stdin: nil, timeout: 1) { tasks = ($0.json as? [String: Any])?["tasks"] as? [[String: Any]] ?? [] }
        settle()
        XCTAssertEqual(tasks.last?["status"] as? String, "done")
        XCTAssertNotNil(tasks.last?["noteKey"])
    }

    func testAChatAnswerStreamsItsEventsThenDone() {
        let runner = FixtureRunner(dir: dir, streamDelay: 0.01)
        var types: [String] = []
        var ended = false
        _ = runner.stream(["chat", "--item", "1:P3NM4G92"], stdin: "Q", onLine: { line in
            types.append(((try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any])?["type"] as? String ?? "")
        }, completion: { _ in ended = true })
        settle(1)
        XCTAssertTrue(ended)
        XCTAssertEqual(types.first, "session")
        XCTAssertTrue(types.contains("delta"))
        XCTAssertEqual(types.last, "done")
    }

    func testStoppingAChatEndsItWithoutDone() {
        let runner = FixtureRunner(dir: dir, streamDelay: 0.2)
        var types: [String] = []
        let turn = runner.stream(["chat"], stdin: "Q", onLine: { line in
            types.append(((try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any])?["type"] as? String ?? "")
        }, completion: { _ in })
        settle(0.3)
        turn?.stop()
        settle(1)
        XCTAssertFalse(types.contains("done"))
    }

    func testAnUnknownSubcommandAnswersAnEmptyObject() {
        var r: RunnerResult?
        FixtureRunner(dir: dir).run(["nowhere"], stdin: nil, timeout: 1) { r = $0 }
        settle()
        XCTAssertTrue(r?.ok == true)
        XCTAssertEqual((r?.json as? [String: Any])?.count, 0)
    }
}
```

- [ ] **Step 2: Run them and see them fail** (`stream` returns nil, `tasks` is empty).

- [ ] **Step 3: Implement**
  - The answers: `Fixtures/synthetic/runner/<subcommand>.json`, made up and scrubbed of nothing because nothing
    in them is the user's (the chat, the artifact and the taxonomy of `NavConsistencyTests` and
    `LauncherModel9Tests`: "Its argument", "Concept map", "Methods" with labels "survey" and "case study").
  - `chat-stream.jsonl`, one event a line, in the runner's shape (`GlueChat.js:48` reads them):
    `{"type":"session","id":"2026-10-14T09-00-00-000Z-fix001","title":"Its argument"}`,
    `{"type":"context","used":1200,"window":200000}`, `{"type":"status","text":"Reading the paper"}`,
    four `{"type":"delta","text":"…"}` (the answer: "The paper argues that resources matter. " in four parts),
    `{"type":"done"}`.
  - State: `launch(["run", ...])` appends `{"id":"fix-<n>","status":"done","title":"Summary","paper":"Doe (2016)",
    "key":<--item's key>,"libraryID":1,"finished":<now ISO>,"noteKey":"FIXN0TE<n>"}` to the tasks `tasks`
    answers; `taxonomy-save` and `classify` record what they got, and `taxonomies` / `classify-show` answer it
    back (the accepted draft listed, the paper's labels tagged).
  - `stream`: a `DispatchSourceTimer` on the main queue emits a line every `streamDelay`; `stop()` cancels it and
    calls `completion` with `ok: false`, stderr `"stopped"`. The `RunnerStream` it returns is a small class
    holding the timer.
  - `calls`: every argv appended; in fixture mode the app also writes them to `$TMPDIR/zl-fixture-calls.log`
    (one line each) so a UI test can check what was sent.

- [ ] **Step 4: Run the tests and the full suite** (PASS).

- [ ] **Step 5: Commit** `test(macos): the fixture runner answers the AI features, with a streamed chat`.

### Task 4: The AI features on screen (fixtures, CI)

Each flow the phase 6 to 9 specs list, driven in the real app with real key presses, checked through the
accessibility tree (rows' labels, the path, flashes, windows) and the fixture runner's calls log.

**Files:**
- Modify: `macos/ZoteroLauncherUITests/AIFlowTests.swift` (Task 2's file)
- Create: `macos/ZoteroLauncherUITests/UIHelpers.swift` (`rows()`, `path()`, `flash()`, `press()`, `calls()`,
  moved out of `FlowTests` and shared)

**Interfaces:**
- Consumes: fixture mode (Task 1), the fixture runner (Task 3), `$TMPDIR/zl-fixture-calls.log`.
- Produces: `UIHelpers` used by `FlowTests` and `AIFlowTests`: `rows() -> [Row]` (label, selected, value),
  `path() -> String` (the breadcrumb's "Path: …" label, "" at the top level), `flash() -> String` (the footer's
  note), `press(_ key: XCUIKeyboardKey, _ flags:, wait:)`, `calls() -> [String]`.

- [ ] **Step 1: Write the chat flow (the longest), then the others from the table below**

```swift
// A paper's chat: the window opens, a question streams its answer, esc stops a second one, Chats lists the chat.
func testChatWithAPaper() throws {
    openFirstPapersMenu() // types "work", ↓, ↵ (UIHelpers)
    selectRow { $0.label.hasPrefix("Chat with the paper") }
    press(.return, wait: 1.5)
    let chat = app.windows.matching(NSPredicate(format: "title CONTAINS 'Doe'")).firstMatch
    XCTAssertTrue(chat.waitForExistence(timeout: 3), "no chat window")
    app.typeText("What does it argue?")
    press(.return, wait: 1.5)
    XCTAssertTrue(chat.staticTexts.containing(NSPredicate(format: "value CONTAINS 'resources matter'")).firstMatch.waitForExistence(timeout: 3))
    XCTAssertTrue(calls().contains { $0.hasPrefix("chat ") })
    app.typeText("And its method?")
    press(.return, wait: 0.1)
    press(.escape, wait: 1) // (the fixture streams slowly enough to stop)
    XCTAssertTrue(chat.staticTexts.containing(NSPredicate(format: "value CONTAINS 'Stopped'")).firstMatch.exists)
    app.typeKey("w", modifierFlags: .command)
    app.typeText("c") // (one key: Chats from the results)
    XCTAssertTrue(rows().contains { $0.label.hasPrefix("Its argument") })
}
```

The others, one test each, every step a key press and every check an assertion:

| Test | Keys | Checks |
|---|---|---|
| `testSetupAndProviders` | `;` ↵ on Setup; esc; ↓ to Models & providers, ↵; ↵ on the first provider; ↵ on Test | Setup's AI row says installed; the providers listed; `calls()` has `provider-test`; the flash says it works |
| `testRunAPromptAndReadItsNote` | open a paper's menu; ↵ on Prompts; ↵ on the first prompt; `.` | `calls()` has `run --prompt`; Processes lists it done; ↵ on it opens the reader (the path ends with its note) |
| `testExtractAPapersText` | open a paper's menu; `x` | `calls()` has `extract`; the flash says it's extracting; Processes lists it |
| `testAnArtifactsMenu` | open a paper's menu; ↓ to "Concept map"; ⇧↵ | the rows are Open, Change it with AI…, Rename…, Delete; Open's right word says `browser` |
| `testTaxonomiesInSettings` | `;`, ↵ on Taxonomies; ↵ on Methods; esc; ↵ on New with AI; type "a map of methods" ↵ on Ask; ↵ on Accept | Methods' form lists survey and case study; the draft's proposal shows; `calls()` has `taxonomy-draft` then `taxonomy-save`; the list shows the new one |
| `testTagAPaperByTaxonomies` | open a paper's menu; ↵ on Tag by taxonomies; ↵ on Taxonomies | `calls()` has `classify`; the strip above the box shows its labels; the audit's rows cycle on ↵ |
| `testReviewDismissesASuggestion` | `;`, Taxonomies, ↵ on Review; `del` on the first | `calls()` has `classify-decide`; the row goes |
| `testRulesToggle` | `;`, ↵ on Rules; ↵ twice on the first rule | its value flips to "not checked" and back |
| `testAutomationDefaults` | `;`, ↵ on Defaults; ↵ on Extract new papers; ↵ on Catch up | the toggle flips; Processes shows the catch-up pending; ↵ on Stop clears it |
| `testNoAIFeatures` | relaunch with `ZL_FIXTURES_NO_RUNNER=1`; open a paper's menu; ↵ on Chat with the paper | the flash is "Chat needs the AI features: Settings › Setup installs them"; no window |
| `testSyncFolderAwayRefusesAWrite` | relaunch with `ZL_FIXTURES_SYNC_AWAY=1`; `;`, Taxonomies, New with AI | the flash starts "Not saved:"; `calls()` has no `taxonomy-draft` |

`ZL_FIXTURES_NO_RUNNER` makes the fixture runner report the runner missing; `ZL_FIXTURES_SYNC_AWAY` points the
sync folder at a path that doesn't exist (`paths.json`'s `syncDir`). Both are read by fixture mode only.

- [ ] **Step 2: Run them and see which fail**

Run: `xcodebuild test -project macos/ZoteroLauncher.xcodeproj -scheme ZoteroLauncherUITests -destination 'platform=macOS' -only-testing:ZoteroLauncherUITests/AIFlowTests`
Expected: each failure is either the fixture runner lacking an answer (fix in Task 3's files) or an app bug.

- [ ] **Step 3: Fix what they find**: an app bug gets a unit test on the fakes first (the `FlowFixTests`
  pattern), then the fix; record each in the CHANGELOG's Fixed.

- [ ] **Step 4: Run every UI test and the full unit suite** (all pass; Zotero quit, no network).

- [ ] **Step 5: Commit** `test(macos): every AI flow on screen, on fixtures`.

### Task 5: The AI features on the real runner

The fixtures prove the app; this proves the runner it ships and the user's setup. It writes to the user's
library and downloads packages, so **each step marked (ask) waits for the user's yes**.

- [ ] **Step 1 (ask):** install the AI features from the app (*Settings › Setup › Install the AI features*:
  `install-runner.sh`, which runs `npm ci` from the network). Check: Setup says installed, `runner/` under
  `~/.config/omarchy/oma-zotero-launcher/`.
- [ ] **Step 2 (the user):** set up a model in *Settings › Models & providers*: the user types any key or picks a
  subscription; this plan never handles a key.
- [ ] **Step 3:** run the read-only flows in real mode:
  `ZL_UI_REAL=1 xcodebuild test … -only-testing:ZoteroLauncherUITests/AIFlowTests/testSetupAndProviders`, then
  the provider Test, the taxonomies list, the audit of an already classified paper, Processes.
- [ ] **Step 4 (ask, with the paper the user names):** the writing flows on that one paper: run a prompt (a note
  is saved), chat and save an answer as a note, make an artifact, tag it by taxonomies. Then remove what they
  made: the notes to Zotero's trash (the app's Delete), the artifact (its Delete), the taxonomy tags (the
  audit, off by you). Report what each step did, without quoting the paper or its notes.
- [ ] **Step 5:** anything that failed gets a fixture test reproducing it (Task 4's table) and a fix, then Step 3
  and 4 again.

### Task 6: "· N items" at the top level

**Files:**
- Modify: `macos/ZoteroLauncher/Bridge/Bridge.swift` (protocol: `get`)
- Modify: `macos/ZoteroLauncher/Bridge/BridgeClient.swift:45-75` (`send` takes the method)
- Modify: `macos/ZoteroLauncherTests/Fakes.swift` (`FakeBridge.get` answers from `answers` like `post`)
- Modify: `macos/ZoteroLauncher/Testing/FixtureBridge.swift` (`get`: `/ping` → `{ "index": { "count": 2648 } }`)
- Modify: `macos/ZoteroLauncher/Launcher/LauncherModel.swift` (`itemCount`), `LauncherModel+Chrome.swift:279`
- Test: `macos/ZoteroLauncherTests/FlowFixTests.swift`
- Modify: `macos/docs/ux-conventions.md` (remove the gap)

**Interfaces:**
- Produces: `Bridge.get(_ route: String, timeout: TimeInterval, completion: @escaping (BridgeResult) -> Void)`;
  `LauncherModel.itemCount: Int` (0 until a ping with `index.count` answers).

- [ ] **Step 1: Write the failing tests**

```swift
func testTheTopLevelCountsTheLibraryFromPing() {
    bridgeAnswers["/ping"] = { _ in .ok(["index": ["count": 2648]]) }
    model.willShow()
    settle()
    XCTAssertEqual(model.itemCount, 2648)
    XCTAssertTrue(model.countText.contains("2,648"), model.countText)
}

func testAnOlderBridgeWithoutACountShowsNone() {
    bridgeAnswers["/ping"] = { _ in .ok(["bridgeVersion": "0.2.0"]) }
    model.willShow()
    settle()
    XCTAssertEqual(model.itemCount, 0)
    XCTAssertFalse(model.countText.contains("items"))
}
```

(`bridgeAnswers` is the test's `FakeBridge.answers`; keep the FlowFixTests setUp's bridge in a property.)

- [ ] **Step 2: Run them and see them fail** (`value of type 'LauncherModel' has no member 'itemCount'`).

- [ ] **Step 3: Implement**

`BridgeClient`: `send` gains `method: String` (`"GET"` sends no body); `get` calls it. In `willShow()` after
`refreshSync()`:

```swift
bridge.get("/ping", timeout: 2) { [weak self] result in
    MainActor.assumeIsolated {
        guard let self, case .ok(let data) = result, let n = (data["index"] as? [String: Any])?["count"] as? Int, n > 0 else { return }
        self.itemCount = n
        if self.store.inSearch { self.rebuildSearch() }
    }
}
```

`countText` passes it: `core.glue("countText", [response, itemCount])` (`Views.countText` already prints
"· N items" when it's above 0, as the QML does: `ZoteroSearch.qml:4979`).

- [ ] **Step 4: Run the tests and the full suite** (PASS).

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(macos): the top level counts the library (GET /ping), as on Omarchy"
```

### Task 7: Empty states with icons

The QML's are Nerd Font glyphs; the Mac draws SF Symbols everywhere else, so the empty states get SF Symbols too
and the Nerd Font download stops being needed for anything.

**Files:**
- Modify: `macos/ZoteroLauncher/Launcher/LauncherModel+Chrome.swift:191` (`emptyState` gains `symbol`)
- Modify: `macos/ZoteroLauncher/Launcher/LauncherView.swift` (the empty state draws it, 28 pt, secondary)
- Test: `macos/ZoteroLauncherTests/FlowFixTests.swift`
- Modify: `macos/docs/ux-conventions.md` (Known gaps: remove the line)

**Interfaces:**
- Produces: `LauncherModel.emptyState: (title: String, detail: String, symbol: String)`.

- [ ] **Step 1: Write the failing test**

```swift
func testEveryEmptyStateHasASymbol() {
    for place in ["todos", "tasks", "searches", "chats"] {
        model.goHome()
        model.openPlace(place)
        settle()
        if model.content.count == 0 {
            XCTAssertFalse(model.emptyState.symbol.isEmpty, place)
            XCTAssertNotNil(NSImage(systemSymbolName: model.emptyState.symbol, accessibilityDescription: nil), place)
        }
    }
}
```

- [ ] **Step 2: Run it and see it fail** (no member `symbol`).

- [ ] **Step 3: Implement**: each `return (title, detail)` in `emptyState` names its symbol: Zotero down
  `"exclamationmark.triangle"`, no matches `"magnifyingglass"`, no tasks `"checklist"`, no processes `"gearshape.2"`,
  no saved searches `"bookmark"`, no chats `"bubble.left.and.bubble.right"`, no notes `"note.text"`, the default
  `"tray"`. Update every caller (`grep -n emptyState`).

- [ ] **Step 4: Run the test, the full suite, and look at the snapshots** (`SNAPSHOT_DIR`): the symbol above
  the title, centred.

- [ ] **Step 5: Commit** `feat(macos): empty states with SF Symbols (no Nerd Font needed)`.

### Task 8: Updates without the Apple Developer Program

`install.sh` updates the app, but nothing says an update exists. A daily check of GitHub's releases offers the
newest `macos-v*` from the menu bar.

**Files:**
- Create: `macos/ZoteroLauncher/App/UpdateCheck.swift`
- Modify: `macos/ZoteroLauncher/App/MenuBarMenu.swift` ("Check for Updates…", and "Update to X…" when one exists)
- Test: `macos/ZoteroLauncherTests/UpdateCheckTests.swift`

**Interfaces:**
- Consumes: `Fetcher` (the app's, `URLSessionFetcher`; `FakeFetcher` in tests).
- Produces: `UpdateCheck.newer(_ a: String, than b: String) -> Bool`;
  `UpdateCheck.latest(fromReleases json: [[String: Any]]) -> (version: String, tag: String)?`;
  `@MainActor final class UpdateCheck: ObservableObject` with `@Published var available: (version: String, tag: String)?`,
  `check(now: Bool)`, `install()`.

- [ ] **Step 1: Write the failing tests**

```swift
final class UpdateCheckTests: XCTestCase {
    func testVersionsCompareByNumber() {
        XCTAssertTrue(UpdateCheck.newer("0.3.10", than: "0.3.9"))
        XCTAssertFalse(UpdateCheck.newer("0.3.0", than: "0.3.0"))
        XCTAssertFalse(UpdateCheck.newer("0.2.9", than: "0.3.0"))
    }

    func testTheNewestMacReleaseIsPicked() {
        let releases: [[String: Any]] = [["tag_name": "v0.4.0", "draft": false, "prerelease": false],
                                         ["tag_name": "macos-v0.3.2", "draft": false, "prerelease": false],
                                         ["tag_name": "macos-nightly", "draft": false, "prerelease": true],
                                         ["tag_name": "macos-v0.3.3", "draft": true, "prerelease": false]]
        XCTAssertEqual(UpdateCheck.latest(fromReleases: releases)?.version, "0.3.2")
    }

    func testAMalformedAnswerOffersNothing() {
        XCTAssertNil(UpdateCheck.latest(fromReleases: [["name": "x"]]))
    }
}
```

- [ ] **Step 2: Run them and see them fail** (no `UpdateCheck`).

- [ ] **Step 3: Implement**
  - `newer`: split on ".", compare as integers, missing parts are 0.
  - `latest`: tags matching `^macos-v(\d+(\.\d+)*)$`, not draft, not prerelease; the highest version.
  - `check(now:)`: at most once a day unless `now` (the last check's date in `UserDefaults`, key
    `ZLUpdateChecked`). GET `https://api.github.com/repos/mbradaschia/zotero-companion-launcher/releases`
    through the `Fetcher`. On any failure (offline, 403, not JSON): nothing shown, try again a day later.
  - `install()`: runs `/bin/bash -c "curl -fsSL https://github.com/mbradaschia/zotero-companion-launcher/releases/download/<tag>/install.sh | bash"`.
    install.sh quits the app, replaces it and opens the new one.
  - Menu bar: "Check for Updates…" (`check(now: true)`, then a small `NSAlert`: "You have the latest version
    (0.3.1)" or "0.3.2 is out: Update" / "Later"); when `available`, an "Update to 0.3.2…" item above Quit.

- [ ] **Step 4: Run the tests and the full suite** (PASS); no test reaches the network (`FakeFetcher`).

- [ ] **Step 5: Commit** `feat(macos): updates from GitHub's releases, from the menu bar`.

### Task 9: Files back under the size rule

`ChatWindowModel.swift` (453 lines) and `LauncherModel+Taxonomies.swift` (429) are over 400.

**Files:**
- Split: `ChatWindowModel.swift` into `ChatWindowModel.swift` (state, sending, the stream) and
  `ChatWindowModel+Actions.swift` (sessions, artifacts, save as a note, keys).
- Split: `LauncherModel+Taxonomies.swift` into `+Taxonomies.swift` (the list, a taxonomy's form) and
  `+TaxonomyDrafts.swift` (AI drafts, the review).

- [ ] **Step 1:** Run the full suite and record the count (334 at the time of writing).
- [ ] **Step 2:** Move whole functions (with their comments) into the new files as `extension`s; `private`
  members used across the two files become `fileprivate` → internal. No logic changes.
- [ ] **Step 3:** `xcodegen generate`, run the full suite: the same count, all pass, no test edited.
- [ ] **Step 4:** `wc -l` on the four files: each under 400.
- [ ] **Step 5: Commit** `refactor(macos): split the chat window's model and taxonomies under 400 lines`.

### Task 10: Release `macos-v0.3.1`

**Files:**
- Modify: `macos/project.yml` (`MARKETING_VERSION: 0.3.1`)
- Create: `macos/docs/releases/macos-v0.3.1.md`
- Modify: `CHANGELOG.md` (the Unreleased Mac entries become `### The Mac app (macos-v0.3.1)`)

- [ ] **Step 1:** Bump the version; write the notes from the CHANGELOG's Mac entries (the flow fixes, arrows,
  breadcrumb, slides, rankings, the back arrow, what tasks 4 and 5 fixed, and tasks 6 to 8). The install line names `macos-v0.3.1`.
- [ ] **Step 2:** All suites; build Release universal; `install.sh` the zip locally; the app says 0.3.1.
- [ ] **Step 3:** PR, CI green, then **ask the user** to merge and to push the tag:
  `git tag -a macos-v0.3.1 origin/master -m "macOS app 0.3.1" && git push origin macos-v0.3.1`.
- [ ] **Step 4:** After CI publishes it, download the release's `install.sh` and check that its `TAG=` names
  `macos-v0.3.1`.

---

## What only you can do (no code)

A short checklist, each about 10 minutes, in this order:

1. **For Task 5:** say yes to installing the AI features, set up a model yourself (a key or a subscription in
   *Settings › Models & providers*; I never type a key), and name one paper I may write notes, an artifact and
   taxonomy tags to (and then remove them).
2. **The Zotero plugin:** install `~/Downloads/oma-zotero-launcher-dev.xpi` (deleting notes needs it). The next
   bridge release (`v0.3.0`, `make release VERSION=0.3.0`) ships it to everyone; that's an outward step too.
3. **VoiceOver** (⌘F5) through the results, a paper's menu and Settings: each row one element, the breadcrumb's
   "Back to" actions.
4. **Two machines** (when you have a second Mac, or when Omarchy is back): the two-machine checklist of phase 4b in
   `macos/PLAN.md` (Syncthing between the two; a pin, a saved search, a task and a chat made offline on each, then
   merged without losing a deletion).
5. **Decisions:**
   - **Apple Developer Program** (99 USD a year): a signed, notarized build, no quarantine, Sparkle updates.
     Without it, Task 8's update check and `install.sh` do the job; my recommendation is to skip it unless macOS
     starts refusing ad-hoc apps.
   - **The Nerd Font download:** after Task 7 nothing needs it (SF Symbols everywhere); my recommendation is to
     drop it.
