import Foundation

// The paper whose menu is open (ZoteroSearch.qml's actionItem).
struct PaperRef: Equatable {
    var key: String
    var libraryID: Int
    var title: String
    var itemType: String

    var json: [String: Any] { ["key": key, "libraryID": libraryID, "title": title, "itemType": itemType] }
    var id: String { "\(libraryID):\(key)" }
}
