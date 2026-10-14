import Foundation

// One level of the view stack: what push saves and back restores (ZoteroSearch.qml's viewStack).
struct ViewLevel: Equatable {
    var view: String
    var filterText: String
    var caretBack: Int // the caret's distance from the end of filterText
    var selectedIndex: Int
    var followTop: Bool
    var scope: Scope?
    var pickFor: String
    var searchFocus: Bool
}
