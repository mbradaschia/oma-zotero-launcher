import SwiftUI

// A search result: its icon, title with the matches, subtitle, and whether it is open in Zotero.
struct SearchRowView: View {
    let row: SearchRow
    let selected: Bool
    var hint = ""
    var opens = false // Enter opens another list: the same › as a menu's rows

    var body: some View {
        HStack(spacing: RowMetrics.iconGap) {
            RowIcon(glyph: row.icon, symbol: row.symbol)
                .frame(width: 20)
                .foregroundStyle(selected ? Color.white : Color.secondary)
            VStack(alignment: .leading, spacing: RowMetrics.lineGap) {
                Text(StyledText.attributed(row.titleHtml, colored: !selected))
                    .lineLimit(1)
                // the second line: who and where, then the rankings, small (the title keeps the whole width)
                if !row.subtitle.isEmpty || !row.ranks.isEmpty {
                    HStack(spacing: 6) {
                        Text(row.subtitle)
                            .font(.caption)
                            .lineLimit(1)
                            .foregroundStyle(selected ? Color.white.opacity(0.85) : Color.secondary)
                        RankChips(ranks: row.ranks, selected: selected)
                    }
                }
            }
            Spacer(minLength: 8)
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
        HStack(spacing: RowMetrics.iconGap) {
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
            VStack(alignment: .leading, spacing: RowMetrics.lineGap) {
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
            if row.isSwitch { SwitchMark(on: row.checked, selected: selected) }
            if row.submenu { SubmenuArrow(selected: selected) }
        }
        .opacity(row.available ? 1 : 0.5)
        .rowChrome(selected: selected)
        .rowAccess(label: Access.label(row), value: Access.value(row), selected: selected, hint: hint)
    }
}

// A result's rankings on its second line, every one, abbreviated as the Omarchy launcher writes them
// (Views.rankShort: ABS 4* → A 4*, ABDC A → D A, FT50 → F, UTD24 → U), each with its full name on hover; the top
// grades (rankIsTop) in colour, the others quiet. The row's VoiceOver label reads them in full.
struct RankChips: View {
    let ranks: String
    let selected: Bool

    static func labels(_ ranks: String) -> [String] { ranks.split(separator: "|").map(String.init).filter { !$0.isEmpty } }

    static func short(_ label: String) -> String {
        if label == "FT50" { return "F" }
        if label == "UTD24" { return "U" }
        if label.hasPrefix("ABS ") { return "A " + label.dropFirst(4) }
        if label.hasPrefix("ABDC ") { return "D " + label.dropFirst(5) }
        return label
    }

    static func tip(_ label: String) -> String {
        if label == "FT50" { return "FT50: one of the Financial Times' 50 journals" }
        if label == "UTD24" { return "UTD24: one of UT Dallas' 24 journals" }
        if label.hasPrefix("ABS ") { return label + ": the Chartered ABS Academic Journal Guide (AJG), grade " + label.dropFirst(4) }
        if label.hasPrefix("ABDC ") { return label + ": the Australian Business Deans Council journal list, grade " + label.dropFirst(5) }
        return label
    }

    static func isTop(_ label: String) -> Bool { ["FT50", "UTD24", "ABS 4*", "ABS 4", "ABDC A*", "ABDC A"].contains(label) }

    var body: some View {
        let all = Self.labels(ranks)
        if !all.isEmpty {
            HStack(spacing: 3) {
                ForEach(all, id: \.self) { label in
                    let top = Self.isTop(label)
                    let tint: Color = selected ? .white : top ? PillView.color("rank") : .secondary
                    Text(Self.short(label))
                        .font(.system(size: 9, weight: .semibold))
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(tint.opacity(selected ? 0.25 : 0.16)))
                        .foregroundStyle(tint)
                        .help(Self.tip(label))
                }
            }
            .fixedSize()
            .accessibilityHidden(true) // (the row's label reads them all)
        }
    }
}

// An on/off setting's switch, drawn as macOS draws one (Enter flips it; it isn't a control of its own).
struct SwitchMark: View {
    let on: Bool
    let selected: Bool

    var body: some View {
        let track: Color = on ? (selected ? Color.white.opacity(0.9) : Color.accentColor) : Color.secondary.opacity(selected ? 0.5 : 0.3)
        let knob: Color = on && selected ? Color.accentColor : Color.white
        ZStack(alignment: on ? .trailing : .leading) {
            Capsule().fill(track).frame(width: 26, height: 15)
            Circle().fill(knob).frame(width: 13, height: 13).padding(.horizontal, 1).shadow(radius: 0.5)
        }
        .accessibilityHidden(true) // (the row's value says it: "on" / "off")
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

// The lists' rows, compact: the title's font (12 pt; a second line is a caption), the room above and below, and
// between the two lines.
enum RowMetrics {
    static let title: Font = .callout
    static let vertical: CGFloat = 4
    static let lineGap: CGFloat = 1
    static let iconGap: CGFloat = 10
}

extension View {
    func rowChrome(selected: Bool) -> some View {
        font(RowMetrics.title)
            .padding(.horizontal, 12)
            .padding(.vertical, RowMetrics.vertical)
            .background(selected ? Color.accentColor : Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .foregroundStyle(selected ? Color.white : Color.primary)
            .padding(.horizontal, 6)
    }
}
