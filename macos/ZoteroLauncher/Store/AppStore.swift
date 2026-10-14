import Foundation

// Where you are in the launcher: the view, what is typed, the selected row, and the levels you
// came through, as ZoteroSearch.qml keeps them. Its functions are the QML's, in its order: push
// (pushView), back, goHome, open and resume. Building the rows and asking the bridge stay with the
// callers: the store says what to show, not how.
@MainActor
final class AppStore: ObservableObject {
    @Published var view = "search"
    @Published var filterText = ""
    @Published var caretBack = 0
    @Published var queryLive = false // the word at the caret is being typed: not a finished block yet
    @Published var selectedIndex = 0
    @Published var followTop = true // the selection stays on the top row as rows arrive
    @Published var scope: Scope?
    @Published var pickFor = ""
    @Published var searchFocus = true // the search box has the keys (else the list)
    @Published private(set) var stack: [ViewLevel] = []
    var keys = KeyBuffer() // a single key waiting to be told from typing; cleared with each view
    var levelChanged: () -> Void = {} // a level pushed or popped (the model clears its last error, as pushView and back do)

    // The keys start in the search box (the keysStart setting), not the list.
    var searchFirst: Bool
    private var hasState = false // opened before: reopening resumes

    init(searchFirst: Bool = false) {
        self.searchFirst = searchFirst
    }

    var inSearch: Bool { view == "search" }
    var inNote: Bool { view == "note" }
    var inSettings: Bool { view.hasPrefix("settings") }
    var atRoot: Bool { inSearch && scope == nil && pickFor.isEmpty }
    var textEntry: Bool { ViewKind.textEntry.contains(view) }
    var typingView: Bool { ViewKind.typing.contains(view) }

    // Into `next`, keeping this level to come back to (ZoteroSearch.qml:759-772).
    func push(_ next: String) {
        stack.append(ViewLevel(view: view, filterText: filterText, caretBack: caretBack, selectedIndex: selectedIndex,
                               followTop: followTop, scope: scope, pickFor: pickFor, searchFocus: searchFocus))
        caretBack = 0
        queryLive = false
        keys.clear()
        levelChanged()
        view = next
        searchFocus = searchFirst || typingView
        filterText = ""
        selectedIndex = 0
        followTop = true
    }

    // Back one level, restoring its query, caret, scope and row; false at the root
    // (ZoteroSearch.qml:775-827). `rebuild` builds that level's rows (followTop is off meanwhile,
    // so the row you were on stays) and says how many; the row is kept within them.
    @discardableResult
    func back(rebuild: () -> Int = { .max }) -> Bool {
        guard let saved = stack.popLast() else { return false }
        keys.clear()
        queryLive = false
        levelChanged()
        scope = saved.scope
        pickFor = saved.pickFor
        view = saved.view
        // Back with something typed: the keys where they were. With nothing typed: the list has
        // them, but on a page for typing; keys starting in the box keep it, except in the results.
        if !saved.filterText.isEmpty { searchFocus = saved.searchFocus }
        else if searchFirst { searchFocus = atRoot ? false : saved.searchFocus }
        else { searchFocus = typingView }
        filterText = saved.filterText
        caretBack = saved.caretBack
        followTop = false
        selectedIndex = saved.selectedIndex
        let count = rebuild()
        selectedIndex = max(0, min(count - 1, saved.selectedIndex))
        followTop = saved.followTop
        return true
    }

    // Back out to the results (ZoteroSearch.qml:855).
    func goHome() {
        while !atRoot && back() {}
    }

    // The launcher shown (ZoteroSearch.qml:262-325). With nothing asked (the hotkey), after the
    // first time: back where you left it. A query asked for starts over at the results.
    // → whether it resumed.
    @discardableResult
    func open(query: String? = nil) -> Bool {
        keys.clear()
        if query == nil && hasState {
            resume()
            return true
        }
        hasState = true
        view = "search"
        stack = []
        scope = nil
        pickFor = ""
        filterText = query ?? ""
        caretBack = 0
        queryLive = false
        selectedIndex = 0
        followTop = true
        searchFocus = true
        // Nothing typed: the list has the keys; a query asked for keeps the search box.
        if filterText.isEmpty { searchFocus = searchFirst || typingView }
        return false
    }

    // Reopened (ZoteroSearch.qml:371-408): the same view, levels, query, scope and row.
    private func resume() {
        if filterText.isEmpty && (!searchFirst || atRoot) { searchFocus = searchFirst ? false : typingView }
        followTop = false // the row you were on stays selected as the list refreshes
    }
}
