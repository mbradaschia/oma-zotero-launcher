import Foundation

// What the router needs to know about where you are; the store fills it in.
struct KeyState: Equatable {
    var singleKeys = true // keys "single" (a key acts once the list has the keys), not "alt"
    var searchFocus = false
    var view = "search"
    var scoped = false // the results narrowed to a collection or a tag, or picking for something
    var searchEditQuery = false // search-edit is editing the query (not the name)
    var filterText = ""
    var caretBack = 0
    var rowCount = 0
    var selectedRowId = "" // the highlighted row's (a list's)
    var selectedKind = "" // the highlighted result's
    var tabTodo = false // the highlighted row is a task (or this is a task's page)
    var pinnedSearches = false
    var taskTarget = false // a paper whose default task ⌥⇧→ changes
    var statusTarget = false // a paper whose status ⌥→ changes

    var inSearch: Bool { view == "search" }
    var inNote: Bool { view == "note" }
    var atRoot: Bool { inSearch && !scoped }
    var textEntry: Bool { ViewKind.textEntry.contains(view) }
    var queryTyped: Bool { inSearch || (view == "search-edit" && searchEditQuery) || view == "todo-new" }
    var typingNow: Bool { !singleKeys || searchFocus || textEntry }
    var listKeys: Bool { singleKeys && !typingNow }
}
