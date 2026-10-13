import Foundation

// What the results are narrowed to: a collection or a tag (Enter on its row), or a saved search
// (opened, or its badge). ZoteroSearch.qml's collectionScope and searchScope.
struct Scope: Equatable {
    var type: String // "collection", "tag" or "search"
    var key: String // a tag's: its name; a saved search's: its id
    var libraryID: Int // a saved search's: 0
    var title: String // a tag's with its "#"
    var query = "" // a saved search's

    // Two scopes are the same results when this is (ZoteroSearch.qml's scopeId).
    var id: String { "\(type):\(key):\(libraryID)" }
}
