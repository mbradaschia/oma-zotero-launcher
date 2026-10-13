import Foundation

// A row of a menu or a list (a paper's actions, its files, notes, tags, tasks) as lib/Views.js's
// listRow builds it: every row carries every field, so every field is required.
struct ListRow: Decodable, Equatable {
    var rowId: String
    var icon: String
    var label: String
    var labelHtml: String
    var detail: String
    var available: Bool
    var submenu: Bool
    var showCheck: Bool
    var checked: Bool
    var swatch: String
    var badge: String
    var trailing: String
    var attKey: String
    var attLibraryID: Int
    var attContentType: String
    var noteKey: String
    var noteLibraryID: Int
    var tag: String
    var section: String // the heading it sits under
    var promptId: String
    var value: String
    var itemKey: String // the paper a task or a chat is about
    var itemLibraryID: Int
    var itemTitle: String
    var path: String
    var session: String
    var field: String // a form row: "text", "multiline" or "pills"
    var editText: String
    var pills: String // "a|b|c"
    var pillOn: String
    var pill: String
    var pillKind: String
    var chips: String // "a|b"
    var chipKind: String
    var decision: String // a taxonomy label's in the audit: "confirmed", "dismissed" or ""

    // What lib/Views.js's rowIdentity names it by, for your order and pins in a menu.
    var identity: String {
        let which = [noteKey, value, promptId].first { !$0.isEmpty } ?? ""
        return which.isEmpty ? rowId : "\(rowId):\(which)"
    }
}
