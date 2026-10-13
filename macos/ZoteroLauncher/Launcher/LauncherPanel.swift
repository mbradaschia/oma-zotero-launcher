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
    let model = LauncherModel()
    private var monitor: Any?
    private var windowedSink: AnyCancellable?

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
        windowedSink = model.$windowed.dropFirst().removeDuplicates().sink { [weak self] windowed in
            self?.place(windowed: windowed)
        }
    }

    private var current: NSWindow { model.windowed ? window : panel }

    func toggle() {
        current.isVisible ? hide() : show()
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
        startMonitor()
        if model.windowed { NSApp.activate() }
        current.makeKeyAndOrderFront(nil)
    }

    func hide() {
        panel.orderOut(nil)
        window.orderOut(nil)
        stopMonitor()
    }

    // W: the same view, moved between the panel and a regular window.
    private func place(windowed: Bool) {
        let from: NSWindow = windowed ? panel : window
        let to: NSWindow = windowed ? window : panel
        let wasVisible = from.isVisible
        if to.contentView !== hosting {
            from.contentView = nil
            to.contentView = hosting
        }
        guard wasVisible else { return }
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
        // where the caret is in the search box: → at its end opens the menu, before it moves the caret
        if let editor = current.firstResponder as? NSTextView {
            model.store.caretBack = max(0, (editor.string as NSString).length - editor.selectedRange().upperBound)
        }
        let flags = event.modifierFlags
        let key = KeyEvent(keyCode: event.keyCode, characters: event.characters, ignoringModifiers: event.charactersIgnoringModifiers,
                           shift: flags.contains(.shift), control: flags.contains(.control), option: flags.contains(.option), command: flags.contains(.command))
        return model.handle(key)
    }

    func windowDidResignKey(_ notification: Notification) {
        if (notification.object as? NSWindow) === panel && !model.windowed { hide() }
    }

    func windowWillClose(_ notification: Notification) {
        if (notification.object as? NSWindow) === window { model.windowed = false; stopMonitor() }
    }
}
