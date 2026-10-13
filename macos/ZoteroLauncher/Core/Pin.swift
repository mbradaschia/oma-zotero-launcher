import Foundation

// A pin in pins.json (lib/Views.js's parsePins): a paper, a collection (by key) or a tag (by name).
struct Pin: Codable, Equatable {
    var key: String
    var libraryID: Int
    var title: String
    var type: String // "item", "collection" or "tag"

    var json: [String: Any] { ["key": key, "libraryID": libraryID, "title": title, "type": type] }
}
