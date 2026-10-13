import Foundation

// A question before a change to many papers (ZoteroSearch.qml's askConfirm): Enter on the first
// row does it, the second (or Esc) leaves things be.
struct ConfirmAsk {
    var title: String
    var yes: String
    var no: String
    var detail = ""
    var noDetail = ""
    var run: () -> Void
    var cancel: () -> Void = {}

    var json: [String: Any] { ["title": title, "yes": yes, "no": no, "detail": detail, "noDetail": noDetail] }
}
