import Foundation

// What the results are narrowed to: a collection or a tag (Enter on its row). ZoteroSearch.qml's
// collectionScope.
struct Scope: Equatable {
    var type: String // "collection" or "tag"
    var key: String // a tag's: its name
    var libraryID: Int
    var title: String // a tag's with its "#"

    // Two scopes are the same results when this is (ZoteroSearch.qml's scopeId).
    var id: String { "\(type):\(key):\(libraryID)" }
}
