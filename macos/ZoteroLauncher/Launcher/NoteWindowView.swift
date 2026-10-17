import SwiftUI

// A note window: its paper's header (citation, title, rankings, status and task), the note, a
// line for what a key did.
struct NoteWindowView: View {
    @ObservedObject var model: NoteWindowModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                if let item = model.paperItem {
                    HStack(spacing: 6) {
                        Text(item["cite"] as? String ?? "").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        Spacer()
                        ForEach(model.ranks, id: \.self) { PillView(text: $0, selected: false, kind: "rank") }
                        let status = (try? model.launcher.core?.glue("statusName", [model.paperStatus], as: String.self)) ?? ""
                        if !status.isEmpty { PillView(text: status, selected: false, mode: "tag", kind: "status") }
                        if !model.taskName.isEmpty { PillView(text: "task: " + model.taskName, selected: false, mode: "tag", kind: "task") }
                    }
                    Text(item["title"] as? String ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Text(model.title).font(.title3.weight(.semibold)).lineLimit(2)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            Divider()
            if !model.error.isEmpty {
                Text("Couldn't load the note: " + model.error).foregroundStyle(.secondary).padding()
                Spacer()
            } else if model.data == nil {
                Text("Loading the note…").foregroundStyle(.secondary).padding()
                Spacer()
            } else {
                NoteView(html: model.body, size: model.launcher.noteTextSize, onLink: { url in _ = model.launcher.desktop.open(url: url) },
                         display: { model.display = $0 })
            }
            Divider()
            Text(model.flash.isEmpty ? "? keys · m menu · z zotero · c chat · y copy .md · s save .md · ⌘⌫ delete · ⌥→← status · ⇧⌥→← task · j k scroll · ⌘-/+ size · esc close" : model.flash)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 18)
                .padding(.vertical, 6)
        }
        // (over whatever shows: the note, or its loading or failure line)
        .overlay(alignment: .topTrailing) { if model.showKeys { WindowKeys(title: "The note window's keys", group: "note-window", launcher: model.launcher).padding(12) } }
        .frame(minWidth: 480, minHeight: 360)
    }
}

// The open note windows, one per note: w focuses one that is open already.
@MainActor
final class NoteWindows: NSObject, NSWindowDelegate {
    private var open: [String: (window: NSWindow, model: NoteWindowModel)] = [:]
    private var monitor: Any?
    var showMenu: ([String: Any], [String: Any]) -> Void = { _, _ in }

    func show(_ note: [String: Any], launcher: LauncherModel) {
        let key = note["key"] as? String ?? ""
        if let existing = open[key] {
            NSApp.activate()
            existing.window.makeKeyAndOrderFront(nil)
            return
        }
        let model = NoteWindowModel(note: note, launcher: launcher)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 640, height: 720), styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = note["title"] as? String ?? "Note"
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: NoteWindowView(model: model))
        window.delegate = self
        window.center()
        model.close = { [weak window] in window?.close() }
        model.showMenu = { [weak self] item, select in self?.showMenu(item, select) }
        open[key] = (window, model)
        model.load()
        startMonitor()
        NSApp.activate()
        window.makeKeyAndOrderFront(nil)
    }

    func close(_ key: String) { open[key]?.window.close() }

    private func startMonitor() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            MainActor.assumeIsolated {
                guard let self, let entry = self.open.values.first(where: { $0.window === event.window }) else { return event }
                let flags = event.modifierFlags
                let key = KeyEvent(keyCode: event.keyCode, characters: event.characters, ignoringModifiers: event.charactersIgnoringModifiers,
                                   shift: flags.contains(.shift), control: flags.contains(.control), option: flags.contains(.option), command: flags.contains(.command))
                return entry.model.handle(key) ? nil : event
            }
        }
    }

    func windowWillClose(_ notification: Notification) {
        guard let window = notification.object as? NSWindow, let key = open.first(where: { $0.value.window === window })?.key else { return }
        open[key]?.model.flushPending()
        open[key] = nil
        if open.isEmpty, let monitor {
            NSEvent.removeMonitor(monitor)
            self.monitor = nil
        }
    }
}

// A window's keys over its content (? or F1; esc hides it): Views.js's VIEW_KEYS, in the Mac's notation.
struct WindowKeys: View {
    let title: String
    let group: String
    let launcher: LauncherModel

    var body: some View {
        let keys = (try? launcher.core?.glue("windowKeys", [group], as: [[String]].self)) ?? []
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.headline)
            ForEach(Array(keys.enumerated()), id: \.offset) { _, k in
                HStack(alignment: .top) {
                    Text(k.first ?? "").font(.caption.monospaced()).frame(width: 140, alignment: .leading)
                    Text(k.count > 1 ? k[1] : "").font(.caption)
                }
            }
            Text("esc hides this").font(.caption2).foregroundStyle(.secondary)
        }
        .padding(12)
        .frame(width: 400, alignment: .leading)
        .background(Color(nsColor: .windowBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.secondary.opacity(0.25)))
        .accessibilityElement(children: .combine)
    }
}
