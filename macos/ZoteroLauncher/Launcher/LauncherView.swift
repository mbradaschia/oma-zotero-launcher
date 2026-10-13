import SwiftUI

struct LauncherView: View {
    @ObservedObject var model: LauncherModel
    let close: () -> Void
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                TextField("Search your library", text: $model.query)
                    .textFieldStyle(.plain)
                    .font(.title2)
                    .focused($searchFocused)
                    .onKeyPress(.downArrow) { model.move(1); return .handled }
                    .onKeyPress(.upArrow) { model.move(-1); return .handled }
                    .onKeyPress(.escape) { close(); return .handled }
                    .onKeyPress(keys: [.return]) { press in
                        model.activate(reveal: press.modifiers.contains(.shift), then: close)
                        return .handled
                    }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)

            Divider()

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(model.rows.enumerated()), id: \.offset) { index, row in
                            if let section = row.section, !section.isEmpty,
                               index == 0 || model.rows[index - 1].section != section {
                                Text(section)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                    .padding(.horizontal, 16)
                                    .padding(.top, 10)
                                    .padding(.bottom, 4)
                            }
                            RowView(row: row, number: index, selected: index == model.selection)
                                .id(index)
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    model.selection = index
                                    model.activate(reveal: false, then: close)
                                }
                        }
                    }
                    .padding(.vertical, 6)
                }
                .onChange(of: model.selection) { _, selection in
                    proxy.scrollTo(selection)
                }
            }

            if !model.status.isEmpty {
                Divider()
                Text(model.status)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
            }
        }
        .frame(width: LauncherPanel.size.width, height: LauncherPanel.size.height)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .onAppear { searchFocused = true }
        .onChange(of: model.shown) { _, _ in searchFocused = true }
    }
}

struct RowView: View {
    let row: Row
    let number: Int
    let selected: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: row.symbol)
                .frame(width: 20)
                .foregroundStyle(selected ? Color.white : Color.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(StyledText.attributed(row.titleHtml ?? StyledText.escape(row.displayTitle), colored: !selected))
                    .lineLimit(1)
                let detail = row.subtitle ?? row.detail ?? ""
                if !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .lineLimit(1)
                        .foregroundStyle(selected ? Color.white.opacity(0.85) : Color.secondary)
                }
            }
            Spacer(minLength: 8)
            if row.openState == "current" || row.openState == "open" {
                Image(systemName: row.openState == "current" ? "circle.fill" : "circle")
                    .font(.system(size: 7))
                    .foregroundStyle(selected ? Color.white : Color.accentColor)
                    .help(row.openState == "current" ? "Showing in Zotero" : "Open in Zotero")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(selected ? Color.accentColor : Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .foregroundStyle(selected ? Color.white : Color.primary)
        .padding(.horizontal, 6)
    }
}
