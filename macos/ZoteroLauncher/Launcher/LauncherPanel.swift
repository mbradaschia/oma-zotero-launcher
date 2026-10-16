import AppKit
import Combine
import SwiftUI

// A Spotlight-style panel: borderless, floating over every Space, takes the keys without
// activating the app (the window behind keeps its place), closes when it loses them.
final class LauncherPanel: NSPanel {
    static let size = NSSize(width: 720, height: 480)

    init(content: NSView) {
        super.init(contentRect: NSRect(origin: .zero, size: Self.size),
                   styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
                   backing: .buffered, defer: false)
        isFloatingPanel = true
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        hidesOnDeactivate = false
        isMovableByWindowBackground = true // (dragged by its background: the header, the footer, an empty list)
        isReleasedWhenClosed = false
        backgroundColor = .clear
        isOpaque = false
        hasShadow = true
        contentView = content
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

// Shows and hides the launcher, gives it the keys (a local monitor: each key through the router,
// what it doesn't take goes on to the search box), and moves it into a window and back (W).
@MainActor
final class LauncherController: NSObject, NSWindowDelegate {
    // the runner with the app's environment (HOME and the rest), as the model's paths have it; in a Debug build
    // started with ZL_FIXTURES (the UI tests), the fixtures instead, in a home of its own
    let model: LauncherModel = {
        let env = ProcessInfo.processInfo.environment
        #if DEBUG
        if let dir = FixtureMode.directory(env) {
            return LauncherModel(bridge: FixtureBridge(dir: dir), env: FixtureMode.environment(base: AppPaths.environment(), syncAway: env["ZL_FIXTURES_SYNC_AWAY"] == "1"),
                                 runner: FixtureRunner(dir: dir, env: env), fetcher: URLSessionFetcher())
        }
        #endif
        return LauncherModel(runner: ProcessRunner(environment: env.merging(AppPaths.environment()) { _, b in b }), fetcher: URLSessionFetcher())
    }()
    private let noteWindows = NoteWindows()
    private let chatWindows = ChatWindows()
    private var monitor: Any?
    private var windowedSink: AnyCancellable?
    private var visible = false // shown, in the panel or the window
    private var moving = false // between the panel and the window: losing the keys then isn't closing

    private lazy var hosting = NSHostingView(rootView: LauncherView(model: model))
    private lazy var panel: LauncherPanel = {
        let panel = LauncherPanel(content: hosting)
        panel.delegate = self
        return panel
    }()
    private lazy var window: NSWindow = {
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: LauncherPanel.size), styleMask: [.titled, .closable, .miniaturizable],
                              backing: .buffered, defer: false)
        window.title = "Zotero"
        window.isReleasedWhenClosed = false
        window.delegate = self
        return window
    }()

    override init() {
        super.init()
        model.close = { [weak self] in self?.hide() }
        model.openWindow = { [weak self] note in
            guard let self else { return }
            self.noteWindows.show(note, launcher: self.model)
        }
        noteWindows.showMenu = { [weak self] item, select in self?.showMenu(item, select: select) }
        model.closeNoteWindow = { [weak self] key in self?.noteWindows.close(key) }
        model.openChat = { [weak self] item, session in
            guard let self else { return }
            self.chatWindows.show(item, session: session, launcher: self.model)
        }
        model.showMenuFor = { [weak self] item, select in
            self?.showMenu(["key": item.key, "libraryID": item.libraryID, "title": item.title, "itemType": item.itemType], select: select)
        }
        model.showLauncher = { [weak self] in self?.show() } // (in front, also when it was open behind the chat)
        model.chatDeleted = { [weak self] item, id in self?.chatWindows.deleted(item, id) }
        windowedSink = model.$windowed.dropFirst().removeDuplicates().sink { [weak self] windowed in
            self?.place(windowed: windowed)
        }
    }

    private var current: NSWindow { model.windowed ? window : panel }

    func toggle() {
        visible ? hide() : show()
    }

    func show() {
        // On the screen with the pointer, a little above the middle.
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
        if let frame = screen?.visibleFrame, !model.windowed {
            let size = LauncherPanel.size
            panel.setFrameOrigin(NSPoint(x: frame.midX - size.width / 2, y: frame.midY - size.height / 2 + frame.height * 0.08))
        }
        model.willShow()
        visible = true
        startMonitor()
        if model.windowed { NSApp.activate() }
        current.makeKeyAndOrderFront(nil)
    }

    // From the menu bar menu: the launcher, on one of Go to's places (chats, tasks, settings, sync).
    func show(place: String) {
        if !visible { show() } else { current.makeKeyAndOrderFront(nil); NSApp.activate() }
        model.openPlace(place)
    }

    // From a note window: the launcher, on that paper's menu, with the row the window came from.
    func showMenu(_ item: [String: Any], select: [String: Any]) {
        if !visible { show() }
        let ref = PaperRef(key: item["key"] as? String ?? "", libraryID: item["libraryID"] as? Int ?? 1, title: item["title"] as? String ?? "", itemType: item["itemType"] as? String ?? "")
        let rowId = select["rowId"] as? String ?? "", noteKey = select["noteKey"] as? String
        model.enterActionsFor(ref, select: { $0.rowId == rowId && (noteKey == nil || $0.noteKey == noteKey) })
    }

    func hide() {
        visible = false
        panel.orderOut(nil)
        window.orderOut(nil)
        stopMonitor()
        model.didHide()
    }

    // W: the same view, moved between the panel and a regular window.
    private func place(windowed: Bool) {
        let from: NSWindow = windowed ? panel : window
        let to: NSWindow = windowed ? window : panel
        if to.contentView !== hosting {
            from.contentView = nil
            to.contentView = hosting
        }
        guard visible else { return } // hidden: it shows in its new place next time
        moving = true
        defer { moving = false }
        if windowed {
            window.setFrame(window.frameRect(forContentRect: panel.frame), display: false)
            NSApp.activate()
        }
        from.orderOut(nil)
        to.makeKeyAndOrderFront(nil)
    }

    private func startMonitor() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, event.window === self.current else { return event }
            return MainActor.assumeIsolated { self.handle(event) ? nil : event }
        }
    }

    private func stopMonitor() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }

    private func handle(_ event: NSEvent) -> Bool {
        if let editor = current.firstResponder as? NSTextView {
            // an input method composing (Japanese, Chinese…): every key is the composition's
            if editor.hasMarkedText() { return false }
            // where the caret is in the search box: → at its end opens the menu, before it moves the caret
            model.store.caretBack = max(0, (editor.string as NSString).length - editor.selectedRange().upperBound)
        }
        let flags = event.modifierFlags
        // ⌘W closes the launcher as its close button does, back to the panel next time (Omarchy's Super+W; the app
        // has no menu bar of its own to do it)
        if flags.intersection([.command, .shift, .control, .option]) == .command, event.charactersIgnoringModifiers?.lowercased() == "w" {
            model.dismiss()
            return true
        }
        let key = KeyEvent(keyCode: event.keyCode, characters: event.characters, ignoringModifiers: event.charactersIgnoringModifiers,
                           shift: flags.contains(.shift), control: flags.contains(.control), option: flags.contains(.option), command: flags.contains(.command))
        return model.handle(key)
    }

    func windowDidResignKey(_ notification: Notification) {
        if (notification.object as? NSWindow) === panel && !model.windowed && !moving && !model.pinnedOpen { hide() } // (pinned: it stays)
    }

    // The window closed (its button, ⌘W): the launcher is dismissed, as the QML's floatWin does.
    func windowWillClose(_ notification: Notification) {
        if (notification.object as? NSWindow) === window && visible { model.dismiss() }
    }
}
