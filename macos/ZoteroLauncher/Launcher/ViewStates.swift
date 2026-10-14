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
    var removedStatusTags: Set<String> = [] // "t/reading", removed here this session: never brought back
    var statusSyncRunning = false
}

// Search power (phase 5): the badge the results are in, the saved search a menu is about, what
// search-edit saves, the @ picker's field and its values, Zotero's sync as last asked.
struct SearchState {
    var active = "" // the badge: "" (All) or a pinned search's id
    var menu: [String: Any]? // the search whose menu is open
    var toSave = "" // the query search-edit saves (or edits)
    var editMode = "save" // "save", "rename" or "query"
    var pickerField = ""
    var facets: [String: Any]? // the bridge's last /facets answer for the field
    var facetCache: [String: [String: Any]] = [:] // the untyped page, by field, for this opening
    var facetSerial = 0
    var facetLoading = false
    var sync: [String: Any]? // the bridge's /sync/status
    var syncRunning = false // a sync started here, followed until it ends
    var syncTask: [String: Any]? // that sync as a process (Processes lists it first)
}

// The prompt runner as last asked (phase 6a): its providers, the models, each provider's test,
// installing; and Settings' provider page, the models picker, the provider whose first test fills
// the empty defaults, the keys tested this opening of Settings.
struct RunnerState {
    var info: [String: Any]? // `providers`
    var missing = false // not installed (no command, exit 127)
    var models: [String: Any]? // `models --json`: models, groups, defaults
    var modelsProblem = ""
    var tests: [String: [String: Any]] = [:] // `provider-test <id>`, or { running: true }
    var installing = false
    var installProblem = ""
    var busy: Set<String> = [] // providers, models: one run each at a time
    var again: Set<String> = [] // asked again while running: run once more after
    var provider = "" // settings-provider's
    var modelsPath = "" // settings-models': the setting it picks for (defaults.both: prompts and chat)
    var modelsOnly = "" // one provider's models only (set-use)
    var autoDefault = ""
    var autoTested: Set<String> = []
    var setupPolls = 0
    var testGen: [String: Int] = [:] // each provider's latest test: an older one's answer is ignored
    var reqs = Requirements()
    var zotero = (installed: true, running: false)
    var update: [String: String]? // the runner the app brings, newer than the installed one
    var index: RawJSON? // the settings found from the search, until something changes
}

// Phase 6b: the prompts and their editor, the runner's tasks (Processes), a paper's text and the
// catch-up, Settings › Rules.
struct AIState {
    var prompts: [[String: Any]]? // `list --json`, parsed; nil until listed
    var promptsJSON = RawJSON(text: "null")
    var promptsProblem = ""
    var jobs: [(args: [String], done: @MainActor (Bool, [String: Any]?, String) -> Void)] = [] // `set`, `new`, `system clear`: one at a time
    var jobRunning = false
    var drafting = false // `new-ai`
    var promptEdit: [String: Any]? // the prompt the editor is on
    var titleMode = "create" // prompt-title's: "create" or "rename"
    var tasks: [[String: Any]] = [] // the runner's tasks (tasks.json)
    var tasksAsking = false // a `tasks` run out
    var tasksWatched = "" // the folders the watchers are on
    var instructionsWatched = ""
    var tasksRead = Date.distantPast // when the menu last read its paper (a task on it that ended since: read again)
    var extractPending: Int? // papers left with a PDF and no text (the catch-up's scope, else the library)
    var scanQueue: [String] = [] // "lib:key": the skipped scans Read the N skipped scans by OCR reads, a few at a time
    var extractRunning = false
    var rules: [Any] = [] // rules.json's
    var rulesJSON = RawJSON(text: "[]")
    var rulesMissing = "" // the rules.json that isn't there (shown with ~)
    var instructions = "" // your own, comments left out
}

// The background automation (phase 7): the classify queue, a prompt run on a new paper, the
// catch-up's plan and its running job.
struct SchedulerState {
    var classifyQueue: [(items: [[String: Any]], only: [String], done: @MainActor ([[String: Any]]) -> Void)] = []
    var classifyRunning = false
    var classifying: Set<String> = [] // "lib:key": the menu says Tagging…
    var promptRunning = false
    var plan: [String: Any]? // `catchup-plan`'s; nil while counted
    var planProblem = ""
    var catchUpRunning = false
}
