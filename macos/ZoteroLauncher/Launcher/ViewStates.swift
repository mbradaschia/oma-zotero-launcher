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

// Tasks (phase 4b): the task whose page is open, a new task's draft, the field being typed, the
// last one deleted (u), the due date's calendar, the status or action being edited in Settings.
struct TaskState {
    var todoId = ""
    var draft: [String: Any] = [:] // a new task's { item, context }
    var field = "" // todo-text's: description, due, notes
    var lastDeleted: (todo: Any, index: Int)?
    var calDate = "" // the calendar's highlighted day (YYYY-MM-DD)
    var fieldDraft: (id: String, field: String, text: String)? // the description or notes typed in place
    var statusEdit: [String: Any]? // { kind ("paper", "action", or a task status), mode, group, id, name }
    var tagsSynced = false // every paper's t/ tags set from scratch, once a session
    var tagChangesSeq = 0
}
