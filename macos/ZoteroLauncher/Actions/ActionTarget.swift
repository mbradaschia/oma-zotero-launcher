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
}

extension ListRow {
    // The row's file, as the bridge's /attachment wants it.
    var attachment: [String: Any]? {
        attKey.isEmpty ? nil : ["key": attKey, "libraryID": attLibraryID, "contentType": attContentType]
    }
}
