import SwiftUI

// What VoiceOver reads (macos/PLAN.md phase 10, docs/ux-conventions.md): a row is one element, its label then its
// detail and its keys' column; its state as the value ("dimmed", "checked"); the highlighted one is selected, with
// the row's own keys (the footer's first) as its hint. A pill reads as its kind and text: "status: reading".
enum Access {
    static func label(_ row: ListRow) -> String {
        var parts = [row.label, row.detail]
        if !row.pill.isEmpty { parts.append(pill(row.pill, kind: row.pillKind)) }
        if (row.field == "text" || row.field == "multiline") && !row.editText.isEmpty { parts.append(row.editText) }
        if !row.badge.isEmpty { parts.append(row.badge) }
        if !row.trailing.isEmpty { parts.append(row.trailing) }
        return joined(parts)
    }

    static func value(_ row: ListRow) -> String {
        var parts: [String] = []
        if row.showCheck { parts.append(row.checked ? "checked" : "not checked") }
        if row.field == "pills" && !row.pillOn.isEmpty { parts.append(row.pillOn) }
        if row.submenu { parts.append("opens a list") }
        if !row.available { parts.append("dimmed") }
        return joined(parts)
    }

    static func label(_ row: SearchRow) -> String {
        var parts = [row.title, row.subtitle]
        parts += row.ranks.split(separator: "|").map { pill(String($0), kind: "rank") }
        if row.openState == "current" { parts.append("showing in Zotero") } else if row.openState == "open" { parts.append("open in Zotero") }
        return joined(parts)
    }

    static func value(_ row: SearchRow, opens: Bool) -> String { opens ? "opens a list" : "" }

    static func pill(_ text: String, kind: String) -> String {
        guard ["status", "priority", "rank", "taxonomy", "task"].contains(kind), !text.lowercased().hasPrefix(kind + ":") else { return text }
        return "\(kind): \(text)"
    }

    // The row's own keys: the footer's hints that act on it, not the box's or the help's.
    static func hint(_ hints: [String]) -> String {
        hints.filter { !$0.hasPrefix("type ") && $0 != "/ search" && !$0.hasSuffix(" keys") }.prefix(2).joined(separator: ", ")
    }

    private static func joined(_ parts: [String]) -> String {
        parts.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

// Motion when the system allows it: none with Reduce Motion (System Settings › Accessibility › Display).
enum Motion {
    static func animation(reduce: Bool) -> Animation? { reduce ? nil : .default }
    // From one list to the next: short, so moving never waits on it.
    static func slide(reduce: Bool) -> Animation? { reduce ? nil : .easeOut(duration: 0.18) }
}

extension View {
    // One element for a row: its label, its state, selected when highlighted, and its keys then.
    func rowAccess(label: String, value: String, selected: Bool, hint: String) -> some View {
        accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
            .accessibilityValue(value)
            .accessibilityHint(selected ? hint : "")
            .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
    }
}
