import Foundation

// What the list shows: the search results, or a list view's rows (a paper's menu, its files, a
// question).
enum Content: Equatable {
    case search([SearchRow])
    case list([ListRow])

    var count: Int {
        switch self {
        case .search(let rows): return rows.count
        case .list(let rows): return rows.count
        }
    }
}
