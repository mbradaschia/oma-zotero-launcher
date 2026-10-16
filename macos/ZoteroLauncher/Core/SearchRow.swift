import Foundation

// A row of the search results as lib/Views.js builds it (buildRows: papers, collections, tags,
// each with every field). Every field is required: a missing one is a shape change in the JS.
struct SearchRow: Decodable, Equatable {
    var section: String
    var kind: String
    var key: String
    var libraryID: Int
    var itemType: String
    var icon: String
    var title: String
    var titleHtml: String
    var subtitle: String
    var openState: String
    var pdfCount: Int
    var noteCount: Int
    var tagsText: String
    var ranks: String // "ABS 4*|FT50"
    var status: String // "\u{0}": unknown (an older Zotero plugin)

    var isPaper: Bool { kind == "item" }

    // An SF Symbol for the row (lib/Views.js's icons are Nerd Font glyphs, not installed on macOS).
    var symbol: String {
        switch kind {
        case "collection": return "folder"
        case "tag": return "tag"
        case "saved-search": return "magnifyingglass"
        case "item": break
        default: return "arrow.right.circle"
        }
        switch itemType {
        case "book": return "book.closed"
        case "bookSection": return "book"
        case "thesis": return "graduationcap"
        case "conferencePaper": return "person.3"
        case "report": return "doc.plaintext"
        case "webpage", "blogPost": return "globe"
        case "preprint", "manuscript": return "doc.badge.clock"
        default: return "doc.text"
        }
    }
}
