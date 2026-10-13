import SwiftUI

// The launcher: the context bar, the search box, the rows with their sections, the footer
// (ZoteroSearch.qml's card). The keys come through LauncherController's monitor, not the view.
struct LauncherView: View {
    @ObservedObject var model: LauncherModel
    @ObservedObject var store: AppStore
    @FocusState private var searchFocused: Bool
    @State private var visible = Set<Int>() // the rows in view: 1…9 count from the first

    init(model: LauncherModel) {
        self.model = model
        self.store = model.store
    }

    var body: some View {
        VStack(spacing: 0) {
            if let context = model.context {
                HStack(spacing: 8) {
                    Text(context.text).font(.callout.weight(.semibold)).lineLimit(1)
                    Spacer(minLength: 8)
                    ForEach(context.ranks, id: \.self) { PillView(text: $0, selected: false) }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
            }
            HStack(spacing: 10) {
                Image(systemName: store.inSearch ? "magnifyingglass" : "chevron.left")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                TextField(model.headerPlaceholder(), text: Binding(get: { store.filterText }, set: { model.setFilter($0) }))
                    .textFieldStyle(.plain)
                    .font(.title2)
                    .focused($searchFocused)
                Text(model.countText).font(.callout).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            Divider()
            rows
            Divider()
            FooterView(model: model)
        }
        .frame(width: LauncherPanel.size.width, height: LauncherPanel.size.height)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .onAppear { searchFocused = store.searchFocus }
        .onChange(of: store.searchFocus) { _, focus in searchFocused = focus }
        .onChange(of: searchFocused) { _, focus in if store.searchFocus != focus { store.searchFocus = focus } }
        .onChange(of: model.shown) { _, _ in searchFocused = store.searchFocus }
    }

    private var rows: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    switch model.content {
                    case .search(let rows):
                        ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                            section(row.section, first: index == 0 || rows[index - 1].section != row.section)
                            SearchRowView(row: row, selected: index == store.selectedIndex)
                                .id(index)
                                .contentShape(Rectangle())
                                .onTapGesture { store.selectedIndex = index; model.enterActions(index) }
                                .onAppear { visible.insert(index) }
                                .onDisappear { visible.remove(index) }
                        }
                    case .list(let rows):
                        ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                            section(row.section, first: index == 0 || rows[index - 1].section != row.section)
                            ListRowView(row: row, selected: index == store.selectedIndex)
                                .id(index)
                                .contentShape(Rectangle())
                                .onTapGesture { store.selectedIndex = index; model.activateAction(index) }
                                .onAppear { visible.insert(index) }
                                .onDisappear { visible.remove(index) }
                        }
                    }
                }
                .padding(.vertical, 6)
            }
            .onChange(of: store.selectedIndex) { _, selection in proxy.scrollTo(selection) }
            .onChange(of: visible) { _, rows in model.visibleTop = rows.min() ?? 0 }
        }
    }

    @ViewBuilder
    private func section(_ name: String, first: Bool) -> some View {
        if !name.isEmpty && first {
            Text(name)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 16)
                .padding(.top, 10)
                .padding(.bottom, 4)
        }
    }
}

// The footer: the paper's pills in its menu, the note (a flash, an error), and the hints that fit.
struct FooterView: View {
    @ObservedObject var model: LauncherModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            let pills = model.paperPills
            if !pills.isEmpty {
                HStack(spacing: 6) {
                    ForEach(Array(pills.enumerated()), id: \.offset) { _, pill in PillView(text: pill.text, selected: false, filled: pill.mode == "tag") }
                }
            }
            let note = model.footerNote
            if !note.isEmpty {
                Text(note).font(.callout).foregroundStyle(.secondary).lineLimit(2)
            }
            GeometryReader { geometry in
                let fitted = FitHints.fit(model.hints(), width: geometry.size.width, gap: 14, widthOf: { FitHints.width($0) })
                HStack(spacing: 14) {
                    ForEach(fitted, id: \.self) { hint in
                        let p = FitHints.parts(hint)
                        HStack(spacing: 4) {
                            Text(p.keys).bold()
                            Text(p.desc).foregroundStyle(.secondary)
                        }
                        .font(.system(size: NSFont.smallSystemFontSize))
                        .fixedSize()
                    }
                }
            }
            .frame(height: 14)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}
