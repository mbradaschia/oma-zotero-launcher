import Foundation

// Which views are which, from ZoteroSearch.qml's view names.
enum ViewKind {
    // Pages for typing a value (a task's text, a name): the search box has the keys (textEntry).
    static let textEntry: Set<String> = ["prompt-title", "settings-edit", "chat-rename", "artifact-change", "artifact-rename",
                                         "todo-new", "todo-text", "todo-due", "status-name", "search-edit", "tag-name"]
    // Those, and lists you narrow by typing (typingView).
    static let typing: Set<String> = textEntry.union(["picker", "picker-values", "todo-tags", "tags"])
    // The menus where p pins a row and Shift+↑/↓ moves any row (menuPinViews).
    static let menuPin: Set<String> = ["actions"]
    // Where Shift+↑/↓ moves the highlighted row (the results move a pinned one).
    static let moveRow: Set<String> = menuPin.union(["search", "todos", "settings-tasks", "settings-paper-status", "settings-taxonomy", "notes", "searches"])
}
