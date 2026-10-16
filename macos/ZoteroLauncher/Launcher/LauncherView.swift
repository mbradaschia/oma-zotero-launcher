import SwiftUI

// The launcher: the context bar, the search box, the rows with their sections, the footer
// (ZoteroSearch.qml's card). The keys come through LauncherController's monitor, not the view.
struct LauncherView: View {
    @ObservedObject var model: LauncherModel
    @ObservedObject var store: AppStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var top: Int? // the first row in view: 1…9 count from it

    init(model: LauncherModel) {
        self.model = model
        self.store = model.store
    }

    var body: some View {
        VStack(spacing: 0) {
            if let context = model.context {
                HStack(spacing: 8) {
                    BreadcrumbBar(crumbs: model.breadcrumb, jump: { model.jumpToCrumb($0) })
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
                // at the top level the search's glass; below it (a collection or a tag too) the way back, as esc goes
                if store.atRoot {
                    Image(systemName: "magnifyingglass").font(.title2).foregroundStyle(.secondary)
                } else {
                    Button { model.back() } label: {
                        Image(systemName: "chevron.left").font(.title2).foregroundStyle(.secondary)
                            .frame(width: 22, height: 26).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help("Back (esc)")
                    .accessibilityLabel("Back")
                }
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
            // a new list slides in: from the right going in, from the left going back; the old one fades (its own
            // transition is the one it was drawn with, which knows nothing of this move). None with Reduce Motion, nor
            // to or from the reader and the calendar (a web view, a grid: they'd come in blank).
            ZStack {
                rows
                    .id(levelKey)
                    .transition(.asymmetric(insertion: .move(edge: store.movedIn ? .trailing : .leading).combined(with: .opacity), removal: .opacity))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()
            .animation(slide, value: levelKey)
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
                            SearchRowView(row: row, selected: index == store.selectedIndex, hint: hint, opens: model.searchRowOpens(row))
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
                // A new list for each view: the rows' ids (0, 1, 2…) repeat from one list to the next, and the lazy
                // stack kept drawing the last list's rows under them (a paper's menu showed the results).
                .id(listKey)
            }
            .scrollPosition(id: $top, anchor: .top)
            .onChange(of: store.selectedIndex) { _, selection in proxy.scrollTo(selection) }
            .onChange(of: top) { _, row in model.visibleTop = row ?? 0 }
            // a list drawn anew (each level is): the row you were on in view, numbered from what's shown
            .onAppear {
                top = nil
                model.visibleTop = 0
                if store.selectedIndex > 0 { proxy.scrollTo(store.selectedIndex) }
            }
        }
    }

    // A level: which view, how deep (the slide runs when it changes, never while you type or move in a list).
    private var levelKey: String { "\(store.view):\(store.stack.count)" }

    private var slide: Animation? {
        let still: Set<String> = ["note", "todo-due"]
        return still.contains(store.view) || still.contains(store.leftView) ? nil : Motion.slide(reduce: reduceMotion)
    }

    private var listKey: String {
        let kind: String
        if case .search = model.content { kind = "search" } else { kind = "list" }
        return "\(kind):\(store.view):\(store.stack.count)"
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
        HStack(spacing: 8) {
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(model.badges, id: \.id) { badge in
                            BadgeChip(name: badge.name, id: badge.id, active: badge.id != "+save" && badge.id == model.searchState.active) {
                                badge.id == "+save" ? model.saveSearchPrompt() : model.selectSearch(badge.id)
                            }
                        }
                    }
                    .padding(.leading, 16)
                }
                .onChange(of: model.searchState.active) { _, id in withAnimation(Motion.animation(reduce: reduceMotion)) { proxy.scrollTo(id) } }
            }
            // how the papers are sorted, its direction an arrow: a click (or g) the next, ⇧G back
            let sort = model.sortLabel
            if !sort.isEmpty {
                SortChip(label: sort, next: model.keyName("g"), back: model.keyName("G")) { model.cycleGrouping(1) }
                    .padding(.trailing, 16)
            }
        }
        .padding(.bottom, 8)
    }
}

// The results' sort, at the badges' right: "↓ Newest published", "Grouped by paper status"; a click is the next one.
struct SortChip: View {
    let label: String
    let next: String
    let back: String
    let tap: () -> Void

    private var spoken: String {
        let plain = label.replacingOccurrences(of: "↓ ", with: "").replacingOccurrences(of: "↑ ", with: "")
        let way = label.hasPrefix("↑") ? ", ascending" : label.hasPrefix("↓") ? ", descending" : ""
        return "Sorted: " + plain + way
    }

    var body: some View {
        let fill: Color = Color.secondary.opacity(0.14)
        Button(action: tap) {
            Text(label).font(.caption.weight(.medium)).lineLimit(1)
                .padding(.horizontal, 8).padding(.vertical, 2)
                .background(Capsule().fill(fill))
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .fixedSize()
        .help("Sort: " + next + " the next, " + back + " back")
        .accessibilityLabel(spoken)
    }
}

// A badge: All, a pinned search (⌕ and its name), or the hint that saves what is typed. (Its own view, typed, so
// the bar's ForEach stays quick to type-check.)
struct BadgeChip: View {
    let name: String
    let id: String
    let active: Bool
    let tap: () -> Void

    var body: some View {
        let save: Bool = id == "+save"
        let plain: Bool = id.isEmpty || save
        let fill: Color = active ? .accentColor : .clear
        let stroke: Color = Color.secondary.opacity(save || active ? 0 : 0.4)
        let ink: Color = active ? .white : .primary
        let traits: AccessibilityTraits = active ? [.isButton, .isSelected] : .isButton
        Text(plain ? name : "\u{2315} " + name)
            .font(.caption.weight(active ? .semibold : .regular))
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .background(Capsule().fill(fill))
            .overlay(Capsule().strokeBorder(stroke))
            .foregroundStyle(ink)
            .opacity(save ? 0.6 : 1)
            .onTapGesture(perform: tap)
            .accessibilityLabel(plain ? name : "saved search: " + name)
            .accessibilityAddTraits(traits)
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
            let processes = model.processesFooter
            if !note.isEmpty || !sync.isEmpty || !processes.isEmpty {
                HStack(alignment: .firstTextBaseline) {
                    Text(note).font(.callout).foregroundStyle(.secondary).lineLimit(2)
                    Spacer(minLength: 8)
                    // what's running, waiting or failed: a click opens Processes
                    if !processes.isEmpty {
                        Button { model.openTasks() } label: {
                            Label(processes, systemImage: processes.contains("failed") ? "exclamationmark.triangle" : "gearshape.2").font(.caption)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(processes.contains("failed") ? Color.orange : Color.secondary)
                        .help("Processes (" + model.keyName(".") + ")")
                        .accessibilityLabel("Processes: " + processes.replacingOccurrences(of: " · ", with: ", "))
                    }
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

// The breadcrumb (above the search box, below the top level): where you came from, then where you are, in bold.
// A click on an earlier level goes back there; a long path keeps its first level and its last ones.
struct BreadcrumbBar: View {
    let crumbs: [String]
    let jump: (Int) -> Void
    static let shown = 5

    var body: some View {
        let names = Breadcrumb.fit(crumbs, max: Self.shown)
        // (each shown name's level, nil for "…")
        let levels: [Int?] = crumbs.count > Self.shown ? [0, nil] + Array(crumbs.count - (Self.shown - 2) ..< crumbs.count) : Array(crumbs.indices)
        HStack(spacing: 4) {
            ForEach(Array(names.enumerated()), id: \.offset) { i, name in
                if i > 0 { Text("›").font(.callout).foregroundStyle(.tertiary) }
                let level = levels[i]
                if i == names.count - 1 {
                    Text(name).font(.callout.weight(.semibold)).lineLimit(1).truncationMode(.middle).layoutPriority(1)
                } else if let level {
                    Text(name).font(.callout).foregroundStyle(.secondary).lineLimit(1).truncationMode(.tail)
                        .onTapGesture { jump(level) }
                        // (set, not pushed: a click can take the crumb away before the pointer leaves it)
                        .onContinuousHover { phase in if case .active = phase { NSCursor.pointingHand.set() } else { NSCursor.arrow.set() } }
                        .help("Back to " + name)
                } else {
                    Text(name).font(.callout).foregroundStyle(.tertiary)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Path: " + crumbs.joined(separator: ", "))
        .accessibilityActions {
            ForEach(Array(crumbs.dropLast().enumerated()), id: \.offset) { i, name in
                Button("Back to " + name) { jump(i) }
            }
        }
    }
}

