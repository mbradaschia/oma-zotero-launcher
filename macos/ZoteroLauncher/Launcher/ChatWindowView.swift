import AppKit
import Combine
import SwiftUI

// A paper's chat window (reference/ChatWindow.qml's layout): the top bar, the banner (its text, what it
// reads, the model and the context), the past chats and artifacts beside, the conversation, the box.
struct ChatWindowView: View {
    @ObservedObject var model: ChatWindowModel
    let launcher: LauncherModel // (not observed: the model passes its changes on, at most twice a second)

    var body: some View {
        HStack(spacing: 0) {
            if model.showSidebar {
                sidebar.frame(width: 280)
                Divider()
            }
            VStack(spacing: 0) {
                topBar
                Divider()
                banner
                Divider()
                ZStack(alignment: .topTrailing) {
                    ChatWebView(body: model.page, onLink: { model.link($0) })
                    if model.showKeys { keysPanel.padding(12) }
                }
                Divider()
                composer
            }
        }
        .frame(minWidth: 520, minHeight: 420)
    }

    // ---- top bar

    private var topBar: some View {
        HStack(spacing: 8) {
            Button { model.showSidebar.toggle() } label: { Image(systemName: "sidebar.left") }
                .help("Past chats and artifacts")
            Text(model.flash.isEmpty ? model.paperLine : model.flash)
                .font(.callout.weight(model.flash.isEmpty ? .regular : .semibold))
                .foregroundStyle(model.flash.isEmpty ? Color.secondary : Color.accentColor)
                .lineLimit(1)
            Spacer()
            Button { model.backToMenu(); model.close() } label: { Label("Back", systemImage: "chevron.left") }
                .help("esc (nothing typed) or ⌥M: back to the launcher, on this paper's menu")
            Menu("New chat") {
                Button("About this paper") { model.newChat() }
                Button("About another paper…") { model.chatAboutAnotherPaper() }
            }
            .fixedSize()
            .disabled(model.busy)
            Button { model.copyChat() } label: { Image(systemName: "doc.on.doc") }.help("Copy the whole chat as Markdown").disabled(model.messages.isEmpty)
            Button { model.saveChat() } label: { Image(systemName: "square.and.arrow.down.on.square") }.help("Save the whole chat to Zotero, as a note on the paper")
                .disabled(model.messages.isEmpty || model.busy)
            Button { model.downloadChat() } label: { Image(systemName: "arrow.down.doc") }.help("Download the whole chat as a .md file").disabled(model.messages.isEmpty)
            Button { model.showKeys.toggle() } label: { Image(systemName: "keyboard") }.help("? or F1: this window's keys")
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // ---- banner

    private var banner: some View {
        let info = model.infoLine
        return HStack(spacing: 10) {
            PillView(text: model.savedText != nil ? "\u{2713} Text extracted" : "Text not extracted", selected: false, mode: model.savedText != nil ? "tag" : "off", kind: "neutral")
            if model.savedText == nil {
                Button(model.extracting ? "Extracting…" : "Extract text") { model.extract() }
                    .disabled(model.extracting)
                    .help("The PDF's text as a page-numbered note, for chats and prompts")
            }
            Text("Ground in").foregroundStyle(.secondary)
            Picker("", selection: Binding(get: { model.groundSource }, set: { model.setSource($0) })) {
                Text(".md (extracted)").tag("note")
                Text("PDF").tag("pdf")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            .disabled(model.busy)
            Text(info.text)
                .font(.caption)
                .foregroundStyle(info.high ? Color.accentColor : Color.secondary)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }

    // ---- sidebar

    private var sidebar: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                Text(model.sessions.isEmpty ? "No past chats yet" : "PAST CHATS").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                ForEach(Array(model.sessions.enumerated()), id: \.offset) { _, s in sessionRow(s) }
                Divider().padding(.vertical, 6)
                Text(model.artifacts.isEmpty ? "No artifacts yet: ask for a diagram, mind map, image or page" : "ARTIFACTS")
                    .font(.caption.weight(.semibold)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                ForEach(Array(model.artifacts.enumerated()), id: \.offset) { _, a in artifactRow(a) }
            }
            .padding(12)
        }
    }

    @ViewBuilder
    private func sessionRow(_ s: [String: Any]) -> some View {
        let id = s["id"] as? String ?? ""
        if model.renaming == id {
            RenameField(text: s["title"] as? String ?? "", onDone: { model.renameSession(id, $0) }, onCancel: { model.renaming = "" })
        } else {
            HStack(alignment: .top) {
                Button { model.openSession(id) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s["title"] as? String ?? "chat").lineLimit(2).foregroundStyle(id == model.sessionId ? Color.accentColor : Color.primary)
                        let n = s["turns"] as? Int ?? 0
                        Text(String((s["updated"] as? String ?? "").prefix(10)) + " · \(n) " + (n == 1 ? "question" : "questions")).font(.caption).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .disabled(model.busy)
                Button { model.renaming = id } label: { Image(systemName: "pencil") }.buttonStyle(.borderless).help("Rename it")
            }
            .padding(.vertical, 3)
            .onTapGesture(count: 2) { model.renaming = id }
        }
    }

    private func artifactRow(_ a: [String: Any]) -> some View {
        HStack(alignment: .top) {
            Button { model.openArtifact(a["id"] as? String ?? "") } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text("▣ " + (a["title"] as? String ?? "")).lineLimit(2)
                    Text([a["formatLabel"] as? String ?? "", "version \(a["current"] as? Int ?? 1) of \(a["versions"] as? Int ?? 1)", String((a["updated"] as? String ?? "").prefix(10))]
                        .filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            Button { model.askToChange(a) } label: { Image(systemName: "pencil") }.buttonStyle(.borderless).help("Ask the chat to change it")
        }
        .padding(.vertical, 3)
    }

    // ---- the box

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .topLeading) {
                if model.draft.isEmpty { Text("Ask about the paper…").foregroundStyle(.tertiary).padding(.horizontal, 9).padding(.vertical, 6) }
                ChatInput(text: $model.draft, onSend: { model.send() }, onEscape: { model.escape() }, focus: { model.focusInput = $0 })
            }
            .frame(minHeight: 36, maxHeight: CGFloat(min(8, max(2, model.draft.split(separator: "\n", omittingEmptySubsequences: false).count + 1))) * 19 + 12)
            HStack(spacing: 10) {
                modelPicker
                promptsPicker
                Spacer()
                if model.busy { Button("Stop") { model.stop() }.keyboardShortcut(.cancelAction) } else {
                    Button("Send") { model.send() }.disabled(model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .padding(12)
    }

    // (typed pieces: the menu's Any lookups, inline, were slow for the compiler to type-check)
    private static func text(_ v: Any?) -> String { v as? String ?? "" }
    private static func list(_ v: Any?) -> [[String: Any]] { v as? [[String: Any]] ?? [] }
    private func choice(_ title: String, _ checked: Any?, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Label(title, systemImage: checked as? Bool == true ? "checkmark" : "") }
    }

    private var modelPicker: some View {
        let m = model.modelMenu
        return Menu(model.modelButton) {
            if m["none"] as? Bool == true {
                Text("No models: turn a provider on in Settings › Models & providers")
            } else {
                choice("Default · " + Self.text(m["defaultDetail"]), m["defaultChecked"]) { model.pickModel("default") }
                ForEach(Array(Self.list(m["groups"]).enumerated()), id: \.offset) { _, g in
                    Section(Self.text(g["name"])) {
                        ForEach(Array(Self.list(g["models"]).enumerated()), id: \.offset) { _, x in
                            choice(Self.text(x["label"]), x["checked"]) { model.pickModel(Self.text(x["spec"])) }
                        }
                    }
                }
                Section("Effort") {
                    ForEach(Array(Self.list(m["efforts"]).enumerated()), id: \.offset) { _, e in
                        choice(Self.text(e["name"]), e["checked"]) { model.effort = Self.text(e["name"]) }
                    }
                }
            }
        }
        .fixedSize()
        .disabled(model.busy)
    }

    private var promptsPicker: some View {
        Menu("Prompts") {
            if let prompts = launcher.ai.prompts, !prompts.isEmpty {
                ForEach(Array(prompts.enumerated()), id: \.offset) { _, p in Button(p["title"] as? String ?? "") { model.usePrompt(p) } }
            } else {
                Text(launcher.ai.prompts != nil ? "No prompts yet: make one in the launcher (a paper's menu › Prompts › New prompt…)"
                     : launcher.ai.promptsProblem.isEmpty ? "Loading your prompts…" : launcher.ai.promptsProblem)
            }
        }
        .fixedSize()
    }

    private var keysPanel: some View {
        WindowKeys(title: "The chat window's keys", group: "chat-window", launcher: model.launcher)
    }
}

// A past chat's title, renamed in place: ↵ saves, esc or leaving the field cancels.
private struct RenameField: View {
    @State var text: String
    let onDone: (String) -> Void
    let onCancel: () -> Void
    @FocusState private var focused: Bool

    init(text: String, onDone: @escaping (String) -> Void, onCancel: @escaping () -> Void) {
        _text = State(initialValue: text)
        self.onDone = onDone
        self.onCancel = onCancel
    }

    var body: some View {
        TextField("Rename the chat", text: $text)
            .textFieldStyle(.roundedBorder)
            .focused($focused)
            .onSubmit { onDone(text) }
            .onExitCommand { onCancel() }
            .onChange(of: focused) { _, now in if !now { onCancel() } }
            .onAppear { focused = true }
    }
}

// The open chat windows, one per paper: chatting about a paper whose window is open focuses it.
@MainActor
final class ChatWindows: NSObject, NSWindowDelegate {
    private var open: [String: (window: NSWindow, model: ChatWindowModel, title: AnyCancellable)] = [:]
    private var monitor: Any?

    private static func id(_ item: PaperRef) -> String { "\(item.libraryID == 0 ? 1 : item.libraryID):\(item.key)" }

    // A chat deleted in the launcher: the window of its paper leaves it.
    func deleted(_ item: PaperRef, _ id: String) {
        open[Self.id(item)]?.model.chatDeleted(id)
    }

    // A chat's window: most of a laptop's screen, at most 960 by 760 (it was 1100 by 900: giant on a laptop), never
    // below its minimum; the size you last gave one is kept for the next.
    static func initialSize(visible: NSRect) -> NSSize {
        NSSize(width: max(520, min(960, (visible.width * 0.7).rounded(.down))), height: max(420, min(760, (visible.height * 0.85).rounded(.down))))
    }
    private static let sizeKey = "ZLChatWindowSize"
    static var lastSize: NSSize? {
        get { (UserDefaults.standard.string(forKey: sizeKey)).map(NSSizeFromString).flatMap { $0.width >= 520 && $0.height >= 420 ? $0 : nil } }
        set { UserDefaults.standard.set(newValue.map(NSStringFromSize), forKey: sizeKey) }
    }

    func windowDidEndLiveResize(_ notification: Notification) {
        if let w = notification.object as? NSWindow { Self.lastSize = w.contentRect(forFrameRect: w.frame).size }
    }

    func show(_ item: PaperRef, session: String, launcher: LauncherModel) {
        let key = Self.id(item)
        if let existing = open[key] {
            if !session.isEmpty { existing.model.openSession(session) }
            NSApp.activate()
            existing.window.makeKeyAndOrderFront(nil)
            return
        }
        let model = ChatWindowModel(item: item, launcher: launcher, session: session)
        let size = Self.lastSize ?? Self.initialSize(visible: NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 875))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = model.windowTitle
        window.isReleasedWhenClosed = false
        window.contentMinSize = NSSize(width: 520, height: 420)
        window.contentView = NSHostingView(rootView: ChatWindowView(model: model, launcher: launcher))
        window.delegate = self
        window.center()
        model.close = { [weak window] in window?.close() }
        model.onDone = { [weak launcher] in
            launcher?.refreshChats()
            launcher?.refreshArtifacts()
        }
        let title = model.$paper.sink { [weak window, weak model] _ in
            DispatchQueue.main.async { if let model { window?.title = model.windowTitle } }
        }
        open[key] = (window, model, title)
        startMonitor()
        NSApp.activate()
        window.makeKeyAndOrderFront(nil)
    }

    private func startMonitor() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            MainActor.assumeIsolated {
                guard let self, let entry = self.open.values.first(where: { $0.window === event.window }) else { return event }
                return entry.model.windowKey(event) ? nil : event
            }
        }
    }

    func windowWillClose(_ notification: Notification) {
        guard let window = notification.object as? NSWindow, let key = open.first(where: { $0.value.window === window })?.key else { return }
        open[key]?.model.windowClosing()
        open[key] = nil
        if open.isEmpty, let monitor {
            NSEvent.removeMonitor(monitor)
            self.monitor = nil
        }
    }
}
