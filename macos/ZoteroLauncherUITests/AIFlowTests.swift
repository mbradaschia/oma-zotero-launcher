import XCTest

// The AI features on screen, on the fixtures (the fixture runner: made-up prompts, a chat and an artifact).
final class AIFlowTests: LauncherUITestCase {
    // A paper's menu lists its chat and Chat with the paper (a window: no arrow, "window" on its right).
    func testAPapersMenuListsItsChatAndChatWithThePaper() {
        openFirstPapersMenu()
        let labels = rows().map(\.label)
        if labels.isEmpty { XCTFail("path: \(path()) · field: \(app.dialogs.firstMatch.textFields.firstMatch.value ?? "") · texts: \(app.dialogs.firstMatch.staticTexts.allElementsBoundByIndex.prefix(6).map { $0.label + "/" + ($0.value as? String ?? "") })") }
        XCTAssertTrue(labels.contains { $0.hasPrefix("Its argument") }, "the paper's chat isn't in its menu: \(labels)")
        XCTAssertTrue(labels.contains { $0.hasPrefix("Chat with the paper") }, "\(labels)")
    }

    // Chats (from the menu bar) lists the made-up chat by its paper.
    func testChatsListsTheChat() {
        menuBar("Chats…")
        XCTAssertTrue(path().contains("Chats"), path())
        XCTAssertTrue(rows().contains { $0.label.hasPrefix("Its argument") }, "\(rows().map(\.label))")
    }
}
