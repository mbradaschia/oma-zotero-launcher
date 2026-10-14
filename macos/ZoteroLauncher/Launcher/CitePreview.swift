import Foundation

// A paper's citation and bibliography entry in your style, asked once when its menu opens and
// shown on its Copy rows (ZoteroSearch.qml's citePreview).
struct CitePreview: Equatable {
    var id: String // "<libraryID>:<key>"
    var style: String
    var citation = ""
    var bibliography = ""
    var error = ""

    func text(_ mode: String) -> String { mode == "citation" ? citation : bibliography }
}
