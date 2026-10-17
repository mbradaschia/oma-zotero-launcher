import SwiftUI

// The bars above the list (LauncherView.swift is the card): a paper's taxonomy strip, and the breadcrumb.

// A paper's taxonomy labels under the context bar (Views.taxonomyStrip): a pill each, a click opens its papers;
// then a word on them (tagging…, out of date, not tagged yet). They wrap onto more lines when they don't fit.
struct TaxonomyStrip: View {
    let model: LauncherModel
    let strip: [String: Any]
    let items: [[String: Any]]

    var body: some View {
        FlowLayout(spacing: 6, lineSpacing: 4) {
            Text("Taxonomies").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            ForEach(Array(items.enumerated()), id: \.offset) { _, t in
                TaxonomyGroup(model: model, name: t["name"] as? String ?? "", prefix: t["prefix"] as? String ?? "", labels: t["labels"] as? [String] ?? [])
            }
            if let note = strip["note"] as? String, !note.isEmpty { Text(note).font(.caption).foregroundStyle(.secondary) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.top, 6)
    }
}

// One taxonomy in the strip: its name, then its labels on the paper, each a click away from its papers. (Its own
// view, typed: the strip's nested ForEach with Any lookups was too slow for CI's compiler to type-check.) The name
// goes with the first label, so a line never ends on a name; the other labels wrap one by one.
struct TaxonomyGroup: View {
    let model: LauncherModel
    let name: String
    let prefix: String
    let labels: [String]

    var body: some View {
        HStack(spacing: 6) {
            Text(name).font(.caption).foregroundStyle(.secondary).padding(.leading, 4)
            if let first = labels.first { pill(first) }
        }
        ForEach(Array(labels.dropFirst().enumerated()), id: \.offset) { _, label in
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

// The header's pin: pinned, the launcher stays open while you use other apps, and esc doesn't close it.
struct PinButton: View {
    let pinned: Bool
    let tap: () -> Void

    var body: some View {
        Button(action: tap) {
            Image(systemName: pinned ? "pin.fill" : "pin").font(.callout).foregroundStyle(pinned ? Color.accentColor : Color.secondary)
                .rotationEffect(.degrees(pinned ? 0 : 45)).frame(width: 20, height: 22).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(pinned ? "Pinned: it stays open over other apps; esc doesn't close it (⌘W does). Click to unpin" : "Pin it: it stays open while you use other apps")
        .accessibilityLabel(pinned ? "Unpin the launcher" : "Pin the launcher open")
    }
}

// Processes' pills (R15): every state, or one (a click), each with its count; the one shown filled.
struct ProcessFilterBar: View {
    @ObservedObject var model: LauncherModel

    var body: some View {
        HStack(spacing: 6) {
            ForEach(model.processFilters, id: \.id) { f in
                BadgeChip(name: f.label + " " + String(f.count), id: f.id, active: model.ai.taskFilter == f.id) { model.setProcessFilter(f.id) }
                    .opacity(f.count == 0 && !f.id.isEmpty ? 0.45 : 1)
                    .accessibilityLabel("\(f.label): \(f.count)")
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }
}

