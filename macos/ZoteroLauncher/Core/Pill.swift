import Foundation

// A pill of a paper's footer (lib/Views.js's paperFooter): its text, the colour it takes (kind:
// "status", "taxonomy", "priority", "neutral"…) and how it is drawn (mode: "tag", "on", "off").
struct Pill: Decodable, Equatable {
    var text: String
    var kind: String
    var mode: String
}
