import SwiftUI

// A search result: its icon, title with the matches, subtitle, and whether it is open in Zotero.
struct SearchRowView: View {
    let row: SearchRow
    let selected: Bool
    var hint = ""
    var opens = false // Enter opens another list: the same › as a menu's rows

    var body: some View {
        HStack(spacing: 12) {
            RowIcon(glyph: row.icon, symbol: row.symbol)
                .frame(width: 20)
                .foregroundStyle(selected ? Color.white : Color.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(StyledText.attributed(row.titleHtml, colored: !selected))
                    .lineLimit(1)
                if !row.subtitle.isEmpty {
                    Text(row.subtitle)
                        .font(.caption)
                        .lineLimit(1)
                        .foregroundStyle(selected ? Color.white.opacity(0.85) : Color.secondary)
                }
            }
            Spacer(minLength: 8)
            ForEach(row.ranks.split(separator: "|").map(String.init), id: \.self) { rank in
                PillView(text: rank, selected: selected, kind: "rank")
            }
            if row.openState == "current" || row.openState == "open" {
                Image(systemName: row.openState == "current" ? "circle.fill" : "circle")
                    .font(.system(size: 7))
                    .foregroundStyle(selected ? Color.white : Color.accentColor)
                    .help(row.openState == "current" ? "Showing in Zotero" : "Open in Zotero")
            }
            if opens { SubmenuArrow(selected: selected) }
        }
        .rowChrome(selected: selected)
        .rowAccess(label: Access.label(row), value: Access.value(row, opens: opens), selected: selected, hint: hint)
    }
}

// A list row (a paper's menu, its files, a question): its icon, label, detail, badge, and a
// chevron when Enter opens another list. Unavailable rows are dimmed.
struct ListRowView: View {
    let row: ListRow
    let selected: Bool
    var hint = ""

    var body: some View {
        HStack(spacing: 12) {
            if row.showCheck {
                Image(systemName: row.checked ? "checkmark.square.fill" : "square")
                    .frame(width: 20)
                    .foregroundStyle(selected ? Color.white : row.checked ? Color.accentColor : Color.secondary)
            } else {
                RowIcon(glyph: row.icon, symbol: Icons.symbol(rowId: row.rowId, badge: row.badge))
                    .frame(width: 20)
                    .foregroundStyle(selected ? Color.white : Color.secondary)
            }
            if let swatch = StyledText.fontColor(in: row.swatch.lowercased()) {
                Circle().fill(swatch).frame(width: 9, height: 9)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(StyledText.attributed(row.labelHtml, colored: !selected))
                    .lineLimit(1)
                if !row.detail.isEmpty {
                    Text(row.detail)
                        .font(.caption)
                        .lineLimit(2)
                        .foregroundStyle(selected ? Color.white.opacity(0.85) : Color.secondary)
                }
            }
            if !row.pill.isEmpty { PillView(text: row.pill, selected: selected, mode: "tag", kind: row.pillKind) }
            Spacer(minLength: 8)
            if row.field == "pills" {
                ForEach(row.pills.split(separator: "|").map(String.init), id: \.self) { p in
                    PillView(text: p, selected: selected, mode: p == row.pillOn ? "on" : "off", kind: row.pillKind)
                }
            }
            if (row.field == "text" || row.field == "multiline") && !row.editText.isEmpty {
                Text(row.editText).lineLimit(2).foregroundStyle(selected ? Color.white.opacity(0.9) : Color.secondary)
            }
            if !row.badge.isEmpty { PillView(text: row.badge, selected: selected) }
            if !row.trailing.isEmpty {
                Text(row.trailing).font(.caption).foregroundStyle(selected ? Color.white.opacity(0.85) : Color.secondary)
            }
            if row.submenu { SubmenuArrow(selected: selected) }
        }
        .opacity(row.available ? 1 : 0.5)
        .rowChrome(selected: selected)
        .rowAccess(label: Access.label(row), value: Access.value(row), selected: selected, hint: hint)
    }
}

// The one submenu arrow (›): every row whose Enter opens another list, results and menus alike.
struct SubmenuArrow: View {
    let selected: Bool

    var body: some View {
        Image(systemName: "chevron.right")
            .font(.caption.weight(.semibold))
            .foregroundStyle(selected ? Color.white : Color.secondary)
            .frame(width: 10)
            .accessibilityHidden(true) // (the row's value says it: "opens a list")
    }
}

// A pill, drawn as the QML draws its three: "on" (filled: the one chosen), "tag" (a tinted outline:
// something a paper has, as its status or its extracted text) and "off" (faint: one of the
// choices, a rank), each in its kind's colour; on a selected row, in white.
struct PillView: View {
    let text: String
    let selected: Bool
    var mode = "off"
    var kind = ""

    static func color(_ kind: String) -> Color {
        switch kind {
        case "status": return .orange
        case "priority": return .red
        case "rank": return .purple
        case "taxonomy": return .teal
        case "task": return .green
        case "neutral": return .secondary
        default: return .accentColor
        }
    }

    var body: some View {
        let tint = selected ? Color.white : Self.color(kind)
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(mode == "on" ? tint.opacity(selected ? 0.9 : 0.85) : mode == "tag" ? tint.opacity(0.14) : Color.secondary.opacity(selected ? 0.3 : 0.16)))
            .overlay(Capsule().strokeBorder(mode == "tag" ? tint.opacity(0.7) : .clear))
            .foregroundStyle(mode == "on" ? (selected ? Color.accentColor : Color.white) : mode == "tag" ? tint : selected ? Color.white : Color.primary)
            .accessibilityLabel(Access.pill(text, kind: kind))
            .accessibilityValue(mode == "on" ? "chosen" : "")
    }
}

extension View {
    func rowChrome(selected: Bool) -> some View {
        padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(selected ? Color.accentColor : Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .foregroundStyle(selected ? Color.white : Color.primary)
            .padding(.horizontal, 6)
    }
}
