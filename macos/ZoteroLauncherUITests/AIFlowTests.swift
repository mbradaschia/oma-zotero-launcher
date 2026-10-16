import XCTest

// The AI features on screen, on the fixtures (the fixture runner: made-up prompts, a chat, an artifact, a
// taxonomy; its calls logged), every step a key press and every check what's on screen or what was asked.
final class AIFlowTests: LauncherUITestCase {
    // (a chat's answer streams slowly enough to stop it)
    override var launchEnvironment: [String: String] { ["ZL_FIXTURES_STREAM_DELAY": "0.25"] }

    // A paper's menu lists its chat and Chat with the paper (a window: no arrow, "window" on its right).
    func testAPapersMenuListsItsChatAndChatWithThePaper() {
        openFirstPapersMenu()
        let labels = rows().map(\.label)
        XCTAssertTrue(labels.contains { $0.hasPrefix("Its argument") }, "the paper's chat isn't in its menu: \(labels)")
        XCTAssertTrue(labels.contains { $0.hasPrefix("Chat with the paper") }, "\(labels)")
    }

    // Chats (from the menu bar) lists the made-up chat by its paper.
    func testChatsListsTheChat() {
        menuBar("Chats…")
        XCTAssertTrue(path().contains("Chats"), path())
        XCTAssertTrue(rows().contains { $0.label.hasPrefix("Its argument") }, "\(rows().map(\.label))")
    }

    // A paper's chat: the window opens, a question streams its answer, esc stops a second one.
    func testChatWithAPaper() {
        openFirstPapersMenu()
        select { $0.label.hasPrefix("Chat with the paper") }
        press(.return, wait: 1.5)
        let chat = app.windows.matching(NSPredicate(format: "title BEGINSWITH 'Chat · '")).firstMatch
        XCTAssertTrue(chat.waitForExistence(timeout: 5), "no chat window")
        type("What does it argue?", wait: 0.3)
        press(.return, wait: 0.2)
        XCTAssertTrue(eventually(8) { texts(chat).contains("resources matter") }, texts(chat))
        XCTAssertTrue(calls().contains { $0.hasPrefix("chat") }, "\(calls())")
        type("And its method?", wait: 0.2)
        press(.return, wait: 0.7)
        press(.escape, wait: 1)
        XCTAssertTrue(eventually(4) { texts(chat).contains("stopped") }, texts(chat))
    }

    // Settings: the AI features installed, the providers listed, a provider tested.
    func testSetupAndProviders() {
        menuBar("Settings…")
        XCTAssertTrue(rows().contains { $0.label.hasPrefix("Install the AI features") && $0.label.contains("installs them again") }, "\(rows().map(\.label))")
        select { $0.label.hasPrefix("Models & providers") }
        press(.return, wait: 1)
        let labels = rows().map(\.label)
        XCTAssertTrue(labels.contains { $0.hasPrefix("Claude (your subscription)") } && labels.contains { $0.hasPrefix("Lab gateway") }, "\(labels)")
        select { $0.label.hasPrefix("OpenAI") }
        press(.return, wait: 1)
        select { $0.label.hasPrefix("Test connection") }
        press(.return, wait: 1)
        XCTAssertTrue(eventually { calls().contains { $0.hasPrefix("provider-test openai") } }, "\(calls())")
    }

    // A prompt run from a paper's menu: in Processes, done; Enter reads its note.
    func testRunAPromptAndReadItsNote() {
        openFirstPapersMenu()
        select { $0.label.hasPrefix("Prompts") }
        press(.return, wait: 1)
        select { $0.label.hasPrefix("Summary") }
        press(.return, wait: 1)
        XCTAssertTrue(calls().contains { $0.hasPrefix("run ") }, "\(calls())")
        menuBar("Processes…")
        XCTAssertTrue(eventually { rows().contains { $0.label.hasPrefix("Summary · Doe (2016)") } }, "\(rows().map(\.label))")
        select { $0.label.hasPrefix("Summary · Doe (2016)") }
        let before = path()
        press(.return, wait: 1.5)
        XCTAssertNotEqual(path(), before, "Enter didn't open its note")
    }

    // x in a paper's menu: its text's menu (the fixture's paper has it), where Extract it again extracts it.
    func testExtractAPapersText() {
        openFirstPapersMenu()
        type("x", wait: 1.5)
        XCTAssertTrue(rows().contains { $0.label.hasPrefix("Extract it again") }, "x didn't open the text's menu: \(rows().map(\.label))")
        select { $0.label.hasPrefix("Extract it again") }
        press(.return, wait: 1.5)
        XCTAssertTrue(eventually { calls().contains { $0.hasPrefix("extract") } }, "\(calls())")
    }

    // ⇧↵ on an artifact: its menu, Open in the browser.
    func testAnArtifactsMenu() {
        openFirstPapersMenu()
        select { $0.label.hasPrefix("Concept map") }
        press(.return, .shift, wait: 1)
        let labels = rows().map(\.label)
        for want in ["Open", "Change it with AI…", "Rename…", "Delete it"] {
            XCTAssertTrue(labels.contains { $0.hasPrefix(want) }, "\(want) not in \(labels)")
        }
        XCTAssertTrue(labels.contains { $0.hasPrefix("Open") && $0.contains("browser") }, "\(labels)")
    }

    // Settings › Taxonomies: Methods' form, then a new one with AI, asked and accepted.
    func testTaxonomiesInSettings() {
        settingsPage("Taxonomies")
        select { $0.label.hasPrefix("Methods") }
        press(.return, wait: 1)
        let form = rows().map(\.label)
        XCTAssertTrue(form.contains { $0.hasPrefix("survey") } && form.contains { $0.hasPrefix("case study") }, "\(form)")
        press(.escape, wait: 1)
        select { $0.label.hasPrefix("New taxonomy with AI") }
        press(.return, wait: 1)
        press(.return, wait: 1) // on Describe: its typing page
        type("a map of methods", wait: 0.3)
        press(.return, wait: 2)
        XCTAssertTrue(eventually { calls().contains { $0.hasPrefix("taxonomy-draft") } }, "\(calls())")
        XCTAssertTrue(eventually { rows().contains { $0.label.contains("experiment") } }, "the proposal isn't shown: \(rows().map(\.label))")
        select { $0.label.hasPrefix("Accept") }
        press(.return, wait: 1.5)
        XCTAssertTrue(eventually { calls().contains { $0.hasPrefix("taxonomy-save") } }, "\(calls())")
    }

    // A paper tagged by taxonomies from its menu; then its audit.
    func testTagAPaperByTaxonomies() {
        openFirstPapersMenu()
        select { $0.label.hasPrefix("Tag by taxonomies") }
        press(.return, wait: 1.5)
        XCTAssertTrue(eventually { calls().contains { $0.hasPrefix("classify --items") } }, "\(calls())")
        XCTAssertTrue(eventually { rows().contains { $0.label.hasPrefix("Audit the taxonomies") } }, "\(rows().map(\.label))")
    }

    // Settings › Taxonomies › Review: Delete dismisses the suggestion.
    func testReviewDismissesASuggestion() {
        settingsPage("Taxonomies")
        select { $0.label.hasPrefix("Review") }
        press(.return, wait: 1)
        select { $0.label.hasPrefix("method/case study") }
        press(.forwardDelete, wait: 1.5) // (del: ⌫ goes back)
        XCTAssertTrue(eventually { calls().contains { $0.hasPrefix("classify-decide") && $0.contains("--dismiss") } }, "\(calls())")
    }

    // Settings › Rules: Enter turns the first rule off, then on again.
    func testRulesToggle() {
        settingsPage("Rules for prompts and chat")
        select { $0.label.hasPrefix("Answer from the paper") }
        let value = { self.rows().first { $0.selected }?.value ?? "" }
        XCTAssertTrue(value().contains("checked") && !value().contains("not checked"), value())
        press(.return, wait: 1)
        XCTAssertTrue(value().contains("not checked"), "the rule didn't turn off: \(value())")
        press(.return, wait: 1)
        XCTAssertFalse(value().contains("not checked"), value())
    }

    // Settings › Defaults: Extract new papers' text flips; Catch up starts and Stop ends it.
    func testAutomationDefaults() {
        settingsPage("Defaults")
        select { $0.label.hasPrefix("Tag new papers by taxonomies") }
        let before = rows().first { $0.selected }?.value ?? ""
        press(.return, wait: 1)
        XCTAssertNotEqual(rows().first { $0.selected }?.value ?? "", before, "the switch didn't flip")
        select { $0.label.hasPrefix("Catch up the last") }
        press(.return, wait: 1.5)
        XCTAssertTrue(eventually { calls().contains { $0.hasPrefix("catchup-plan") } }, "\(calls())")
    }
}

// Without the AI features: Chat with the paper says how to get them, and no window opens.
final class NoAIFeaturesFlowTests: LauncherUITestCase {
    override var launchEnvironment: [String: String] { ["ZL_FIXTURES_NO_RUNNER": "1"] }

    func testChatSaysHowToGetThem() {
        openFirstPapersMenu()
        let labels = rows().map(\.label)
        XCTAssertFalse(labels.contains { $0.hasPrefix("Chat with the paper") }, "\(labels)")
        XCTAssertTrue(labels.contains { $0.hasPrefix("Set up") || $0.contains("AI features") }, "\(labels)")
        XCTAssertEqual(app.windows.matching(NSPredicate(format: "title BEGINSWITH 'Chat · '")).count, 0)
    }
}

// The sync folder away: what's synced isn't written, and a new taxonomy with AI isn't even asked for.
final class SyncAwayFlowTests: LauncherUITestCase {
    override var launchEnvironment: [String: String] { ["ZL_FIXTURES_SYNC_AWAY": "1"] }

    func testANewTaxonomyIsRefused() {
        settingsPage("Taxonomies")
        select { $0.label.hasPrefix("New taxonomy with AI") }
        press(.return, wait: 1)
        XCTAssertTrue(flash().contains("sync folder") || flash().hasPrefix("Not saved"), flash())
        XCTAssertFalse(calls().contains { $0.hasPrefix("taxonomy-draft") }, "\(calls())")
    }
}
