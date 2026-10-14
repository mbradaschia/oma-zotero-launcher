import Foundation

// What the views of phase 4a keep while they are open (ZoteroSearch.qml's properties for them).

// The note reader: the note asked for, its answer, the paper's other notes (Shift+↑↓).
struct NoteState {
    var target: [String: Any]? // { key, libraryID, title }
    var data: [String: Any]? // the bridge's /note (html)
    var error = ""
    var cache: [String: [String: Any]] = [:] // by note key, for this opening
    var siblings: [[String: Any]] = []
    var siblingsOf = "" // "<libraryID>:<key>" of their paper
    var serial = 0
}

// The tag editor: the library's tags, the paper's, and the tag a menu is about.
struct TagState {
    var state: [String: Any]? // { libraryID, tags, itemTags, initial, editable, loading }
    var cache: [Int: [Any]] = [:] // the library's tags, by library
    var serial = 0
    var pending = 0 // edits Zotero hasn't answered yet
    var menuName = ""
    var statusKind = "" // "paper" or "task" (Make it a … status)
}

// A paper's status and default task changed here but not saved yet (a second after the last
// press), shown at once.
struct PaperMarks {
    var statusShown: [String: String] = [:] // "<lib>:<key>" → its status tag ("" none)
    var statusPending: [String: (item: [String: Any], from: String, to: String)] = [:]
    var taskShown: [String: String] = [:] // → a status id
    var taskPending: [String: (item: [String: Any], status: String)] = [:]
}

// The settings pages: the choice or the edit open, the citation styles Zotero listed.
struct SettingsState {
    var choice = ""
    var edit: [String: Any]?
    var styles: [Any]?
    var stylesProblem = ""
}
