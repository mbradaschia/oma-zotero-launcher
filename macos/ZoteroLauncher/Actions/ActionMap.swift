import Foundation

// What Enter does on a row, by its rowId: activateAction's cases (reference/ZoteroSearch.qml:1164),
// ported phase by phase. scripts/parity.sh counts the keys of `handlers` against the QML and
// docs/parity-phases.tsv, so keep one "id": per line.
@MainActor
enum ActionMap {
    typealias ActionHandler = @MainActor (ActionTarget, ListRow) -> Void

    static let handlers: [String: ActionHandler] = [
        "open": { target, _ in target.finish("open", attachment: nil) },
        "reveal": { target, _ in target.finish("reveal", attachment: nil) },
        "external": { target, row in fileAction(target, row, "external") },
        "window": { target, row in fileAction(target, row, "window") },
        "pick": { target, row in target.finish(target.filePurpose, attachment: row.attachment) },
        "pin": { target, _ in target.togglePinOfMenu() },
        "cite-copy": { target, row in target.copyCite(row.value) },
        "confirm-yes": { target, _ in target.answerConfirm(true) },
        "confirm-no": { target, _ in target.answerConfirm(false) },
    ]

    // Rows the JS builds that no case handles (Enter does nothing on Omarchy either), and ids the
    // QML compares but never handles: listed so nobody ports them by mistake.
    static let inert: Set<String> = ["notes-empty", "set-info", "tax-none", "tax-audit-info", "tax-ai-ask", "tax-edit"]

    // Open a file: with several, the picker first (ZoteroSearch.qml:1175-1183).
    private static func fileAction(_ target: ActionTarget, _ row: ListRow, _ kind: String) {
        if row.submenu { target.openFiles(kind) } else { target.finish(kind, attachment: row.attachment) }
    }
}
