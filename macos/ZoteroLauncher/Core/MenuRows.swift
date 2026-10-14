import Foundation

// A paper's menu as Glue.menu builds it: the rows shown, and the menu's rows in your order before
// the pins and the filter (what Shift+↑↓ moves a row among).
struct MenuRows: Decodable, Equatable {
    var ordered: [ListRow]
    var rows: [ListRow]
}
