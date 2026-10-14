import Foundation

// What a row's action can ask of the launcher (the model; a fake in the tests).
@MainActor
protocol ActionTarget: AnyObject {
    var filePurpose: String { get }
    // Close the launcher, then open, reveal, or open a file externally or in a Zotero window.
    func finish(_ kind: String, attachment: [String: Any]?)
    // The files view, to pick one for `purpose` ("external" or "window").
    func openFiles(_ purpose: String)
    // Pin or unpin the paper whose menu this is; the menu rebuilt where it was.
    func togglePinOfMenu()
    func copyCite(_ mode: String)
    // The question's answer: back, then its run or cancel.
    func answerConfirm(_ yes: Bool)

    // Phase 4a.
    func enterNotes()
    func openNote(_ row: ListRow)
    func askDeleteNote(_ target: [String: Any]?)
    @discardableResult func cyclePaperStatus(_ delta: Int) -> Bool
    @discardableResult func cycleDefaultTask(_ delta: Int) -> Bool
    func enterTags()
    func toggleTag(_ name: String, create: Bool)
    func chooseTagStatus(_ kind: String) // the tag menu's Make it a paper / task status…
    func convertMenuTag(into target: String) // that choice made
    func renameMenuTag() // the tag menu's Rename…
    func saveMenuTagName(_ name: String)
    func deleteMenuTag()
    func settingsAction(_ row: ListRow)

    // Phase 4b: a task's, or a status's (Settings › Tasks, Paper status), by its rowId.
    func taskAction(_ row: ListRow)

    // Phase 5: a saved search's, or an @ picker's, by its rowId.
    func searchAction(_ row: ListRow)

    // Phase 6b: a prompt's, a process's, a paper's extracted text, Defaults' text, Rules'.
    func runnerAction(_ row: ListRow)
}

extension ListRow {
    // The row's file, as the bridge's /attachment wants it.
    var attachment: [String: Any]? {
        attKey.isEmpty ? nil : ["key": attKey, "libraryID": attLibraryID, "contentType": attContentType]
    }
}
