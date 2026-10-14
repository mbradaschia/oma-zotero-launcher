import SwiftUI

// A search result: its icon, title with the matches, subtitle, and whether it is open in Zotero.
struct SearchRowView: View {
    let row: SearchRow
    let selected: Bool

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
                PillView(text: rank, selected: selected)
            }
            if row.openState == "current" || row.openState == "open" {
                Image(systemName: row.openState == "current" ? "circle.fill" : "circle")
                    .font(.system(size: 7))
                    .foregroundStyle(selected ? Color.white : Color.accentColor)
                    .help(row.openState == "current" ? "Showing in Zotero" : "Open in Zotero")
            }
        }
        .rowChrome(selected: selected)
    }
}

// A list row (a paper's menu, its files, a question): its icon, label, detail, badge, and a
// chevron when Enter opens another list. Unavailable rows are dimmed.
struct ListRowView: View {
    let row: ListRow
    let selected: Bool

    var body: some View {
        HStack(spacing: 12) {
            if row.showCheck {
                Image(systemName: row.checked ? "checkmark.square.fill" : "square")
                    .frame(width: 20)
                    .foregroundStyle(selected ? Color.white : row.checked ? Color.accentColor : Color.secondary)
            } else {
                RowIcon(glyph: row.icon, symbol: Icons.symbol(rowId: row.rowId))
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
            Spacer(minLength: 8)
            if !row.badge.isEmpty { PillView(text: row.badge, selected: selected) }
            if !row.trailing.isEmpty {
                Text(row.trailing).font(.caption).foregroundStyle(selected ? Color.white.opacity(0.85) : Color.secondary)
            }
            if row.submenu { Image(systemName: "chevron.right").font(.caption).foregroundStyle(selected ? Color.white : Color.secondary) }
        }
        .opacity(row.available ? 1 : 0.5)
        .rowChrome(selected: selected)
    }
}

struct PillView: View {
    let text: String
    let selected: Bool
    var filled = false

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(filled ? Color.accentColor.opacity(0.85) : Color.secondary.opacity(selected ? 0.35 : 0.18)))
            .foregroundStyle(selected || filled ? Color.white : Color.primary)
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
