import Foundation

// What Enter does on a row, by its rowId: activateAction's cases (reference/ZoteroSearch.qml),
// ported phase by phase. scripts/parity.sh counts the keys of `handlers` against the QML and
// docs/parity-phases.tsv, so keep one "id": per line.
@MainActor
enum ActionMap {
    typealias ActionHandler = @MainActor (AppStore) -> Void

    static let handlers: [String: ActionHandler] = [:]

    // Rows the JS builds that no case handles (Enter does nothing on Omarchy either), and ids the
    // QML compares but never handles: listed so nobody ports them by mistake.
    static let inert: Set<String> = ["notes-empty", "set-info", "tax-none", "tax-audit-info", "tax-ai-ask", "tax-edit"]
}
