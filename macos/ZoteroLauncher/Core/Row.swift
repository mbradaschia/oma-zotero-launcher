import Foundation

// A list row as lib/Views.js builds it. Only what the Mac launcher shows so far is decoded; the
// rest of the row is ignored.
struct Row: Decodable, Equatable {
    var section: String?
    var kind: String?
    var key: String?
    var libraryID: Int?
    var itemType: String?
    var title: String?
    var titleHtml: String?
    var subtitle: String?
    var openState: String?
    var label: String?
    var detail: String?

    var displayTitle: String { title ?? label ?? "" }
    var isPaper: Bool { kind == "item" }

    // An SF Symbol for the row (lib/Views.js's icons are Nerd Font glyphs, not installed on macOS).
    var symbol: String {
        switch kind {
        case "collection": return "folder"
        case "tag": return "tag"
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
