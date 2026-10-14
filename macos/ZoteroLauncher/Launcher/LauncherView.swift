import SwiftUI

// The launcher: the context bar, the search box, the rows with their sections, the footer
// (ZoteroSearch.qml's card). The keys come through LauncherController's monitor, not the view.
struct LauncherView: View {
    @ObservedObject var model: LauncherModel
    @ObservedObject var store: AppStore
    @State private var top: Int? // the first row in view: 1…9 count from it

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
                    ForEach(context.ranks, id: \.self) { PillView(text: $0, selected: false, kind: "rank") }
                    if !context.count.isEmpty { Text(context.count).font(.callout).foregroundStyle(.secondary) }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
            }
            if let (strip, items) = stripShown {
                TaxonomyStrip(model: model, strip: strip, items: items)
            }
            HStack(spacing: 10) {
                Image(systemName: store.inSearch ? "magnifyingglass" : "chevron.left")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                StyledTextField(text: store.filterText, caretBack: store.caretBack, live: store.queryLive,
                                focused: Binding(get: { store.searchFocus }, set: { if store.searchFocus != $0 { store.searchFocus = $0 } }),
                                placeholder: model.headerPlaceholder(), segments: { model.segments($0, caret: $1) },
                                onEdit: { model.typed($0, caretBack: $1) }, onCaret: { store.caretBack = $0 })
                    .id(model.shown) // each opening: the field takes the keys again if it should
                Text(model.countText).font(.callout).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            if !model.badges.isEmpty { BadgeBar(model: model) }
            Divider()
            rows
            Divider()
            FooterView(model: model)
        }
        .frame(width: LauncherPanel.size.width, height: LauncherPanel.size.height)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    // The paper's taxonomy strip, when it has a label or a note to show.
    private var stripShown: ([String: Any], [[String: Any]])? {
        guard let strip = model.taxonomyStrip else { return nil }
        let items: [[String: Any]] = strip["items"] as? [[String: Any]] ?? []
        let note: String = strip["note"] as? String ?? ""
        return items.isEmpty && note.isEmpty ? nil : (strip, items)
    }

    @ViewBuilder
    private var rows: some View {
        if store.view == "todo-due" {
            CalendarView(model: model)
        } else if store.inNote && model.note.data != nil && !model.noteBodyHTML.isEmpty {
            NoteView(html: model.noteBodyHTML, size: model.noteTextSize, onLink: { model.openLink($0) }, display: { model.noteDisplay = $0 })
        } else if model.content.count == 0 {
            let empty = model.emptyState
            VStack(spacing: 6) {
                Spacer()
                Text(empty.title).font(.title3.weight(.semibold))
                if !empty.detail.isEmpty { Text(empty.detail).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center) }
                Spacer()
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
        } else {
            list
        }
    }

    private var list: some View {
        let hint = Access.hint(model.hints())
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    switch model.content {
                    case .search(let rows):
                        ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                            section(row.section, first: index == 0 || rows[index - 1].section != row.section)
                            SearchRowView(row: row, selected: index == store.selectedIndex, hint: hint)
                                .id(index)
                                .contentShape(Rectangle())
                                .onTapGesture { store.selectedIndex = index; model.enterActions(index) }
                                .accessibilityAction { store.selectedIndex = index; model.enterActions(index) }
                        }
                    case .list(let rows):
                        ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                            section(row.section, first: index == 0 || rows[index - 1].section != row.section)
                            ListRowView(row: row, selected: index == store.selectedIndex, hint: hint)
                                .id(index)
                                .contentShape(Rectangle())
                                .onTapGesture { store.selectedIndex = index; model.activateAction(index) }
                                .accessibilityAction { store.selectedIndex = index; model.activateAction(index) }
                        }
                    }
                }
                .padding(.vertical, 6)
                .scrollTargetLayout()
            }
            .scrollPosition(id: $top, anchor: .top)
            .onChange(of: store.selectedIndex) { _, selection in proxy.scrollTo(selection) }
            .onChange(of: top) { _, row in model.visibleTop = row ?? 0 }
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
                .accessibilityAddTraits(.isHeader)
        }
    }
}

// The badges above the results (ZoteroSearch.qml:5680): All, your pinned searches, and a hint that
// saves what is typed. The one the results are in is filled; a click selects it (or saves).
struct BadgeBar: View {
    @ObservedObject var model: LauncherModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(model.badges, id: \.id) { badge in
                        let save = badge.id == "+save"
                        let active = !save && badge.id == model.searchState.active
                        Text((badge.id.isEmpty || save ? "" : "\u{2315} ") + badge.name)
                            .font(.caption.weight(active ? .semibold : .regular))
                            .lineLimit(1)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 3)
                            .background(Capsule().fill(active ? Color.accentColor : Color.clear))
                            .overlay(Capsule().strokeBorder(Color.secondary.opacity(save || active ? 0 : 0.4)))
                            .foregroundStyle(active ? Color.white : Color.primary)
                            .opacity(save ? 0.6 : 1)
                            .id(badge.id)
                            .onTapGesture { save ? model.saveSearchPrompt() : model.selectSearch(badge.id) }
                            .accessibilityLabel(badge.id.isEmpty || save ? badge.name : "saved search: " + badge.name)
                            .accessibilityAddTraits(active ? [.isButton, .isSelected] : .isButton)
                    }
                }
                .padding(.horizontal, 16)
            }
            .onChange(of: model.searchState.active) { _, id in withAnimation(Motion.animation(reduce: reduceMotion)) { proxy.scrollTo(id) } }
        }
        .padding(.bottom, 8)
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
                    ForEach(Array(pills.enumerated()), id: \.offset) { _, pill in PillView(text: pill.text, selected: false, mode: pill.mode, kind: pill.kind) }
                }
            }
            let note = model.footerNote
            let sync = model.syncFooter
            if !note.isEmpty || !sync.isEmpty {
                HStack(alignment: .firstTextBaseline) {
                    Text(note).font(.callout).foregroundStyle(.secondary).lineLimit(2)
                    Spacer(minLength: 8)
                    if !sync.isEmpty { Label(sync, systemImage: "arrow.triangle.2.circlepath").font(.caption).foregroundStyle(.secondary) }
                }
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

// A paper's taxonomy labels under the context bar (Views.taxonomyStrip): a pill each, a click opens its papers;
// then a word on them (tagging…, out of date, not tagged yet).
struct TaxonomyStrip: View {
    let model: LauncherModel
    let strip: [String: Any]
    let items: [[String: Any]]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                Text("Taxonomies").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                ForEach(Array(items.enumerated()), id: \.offset) { _, t in
                    TaxonomyGroup(model: model, name: t["name"] as? String ?? "", prefix: t["prefix"] as? String ?? "", labels: t["labels"] as? [String] ?? [])
                }
                if let note = strip["note"] as? String, !note.isEmpty { Text(note).font(.caption).foregroundStyle(.secondary) }
            }
            .padding(.horizontal, 16)
        }
        .padding(.top, 6)
    }
}

// One taxonomy in the strip: its name, then its labels on the paper, each a click away from its papers. (Its own
// view, typed: the strip's nested ForEach with Any lookups was too slow for CI's compiler to type-check.)
struct TaxonomyGroup: View {
    let model: LauncherModel
    let name: String
    let prefix: String
    let labels: [String]

    var body: some View {
        Text(name).font(.caption).foregroundStyle(.secondary).padding(.leading, 4)
        ForEach(Array(labels.enumerated()), id: \.offset) { _, label in
            pill(label)
        }
    }

    private func pill(_ label: String) -> some View {
        let tag: String = prefix + label
        let help: String = "\(name): \(tag) · its papers"
        return PillView(text: label, selected: false, mode: "tag", kind: "taxonomy")
            .onTapGesture { model.openTaggedPapers(tag) }
            .onHover { inside in if inside { NSCursor.pointingHand.push() } else { NSCursor.pop() } }
            .help(help)
            .accessibilityLabel("\(name): \(label)")
            .accessibilityAddTraits(.isButton)
    }
}
