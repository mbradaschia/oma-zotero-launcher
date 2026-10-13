import Foundation

// What a key means where you are: the router's answer, for the store to carry out (from phase 3b
// on). Each case is a branch of ZoteroSearch.qml's handleKey, named for what it does.
enum KeyCommand: Equatable {
    // An edit of the search at its caret (Views.editQuery's operations).
    enum SearchEdit: Equatable {
        case backspace, word, delete, clear, left, right, home, end
        case insert(String)
    }

    // An edit of a list's filter (no caret).
    enum FilterEdit: Equatable {
        case backspace, word, clear
    }

    case home // Shift+Esc: back to the results, the search cleared
    case leaveSearch // the list takes the keys
    case clearFilter
    case back
    case close
    case openKeys
    case note(KeyEvent) // the note reader's own keys (handleNoteKey)
    case deleteTask
    case rejectSuggestion
    case cycleTaskStatus(Int)
    case cycleTaskPriority(Int)
    case calendarDays(Int)
    case calendarMonths(Int)
    case calendarToday
    case clearDue
    case pickDue
    case cycleTask(Int)
    case cycleSearch(Int)
    case cycleDefaultTask(Int)
    case cycleStatus(Int)
    case alternate // Shift+Enter: the highlighted row's other action (its menu, or in Zotero)
    case clearSearchBox
    case pick(Int) // the row numbered N from the top of what's shown
    case keyAction(Character) // ⌥letter: its action, or nothing
    case keyActionOrTyping(Character) // a single key after the delay: its action, else typed
    case paste
    case createTag
    case saveSearch
    case openPicker
    case openTaskTags
    case queue(String) // a single key: it waits to be told from typing (KeyBuffer)
    case typing(String) // into the search box, which takes the keys
    case editSearch(SearchEdit)
    case editFilter(FilterEdit)
    case append(String) // typed into a list's filter
    case focusSearch
    case hideNotes
    case moveSection(Int)
    case moveRow(Int)
    case move(Int)
    case page(Int)
    case enterActions // the highlighted result's menu
    case activate // the highlighted row, as Enter does
    case ignore // taken, nothing to do
    case pass // not the launcher's
}
