import AppKit
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

final class LauncherController: NSObject, NSWindowDelegate {
    let model = LauncherModel()

    private lazy var panel: LauncherPanel = {
        let view = LauncherView(model: model, close: { [weak self] in self?.hide() })
        let panel = LauncherPanel(content: NSHostingView(rootView: view))
        panel.delegate = self
        return panel
    }()

    func toggle() {
        panel.isVisible ? hide() : show()
    }

    func show() {
        // On the screen with the pointer, a little above the middle.
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
        if let frame = screen?.visibleFrame {
            let size = LauncherPanel.size
            panel.setFrameOrigin(NSPoint(x: frame.midX - size.width / 2, y: frame.midY - size.height / 2 + frame.height * 0.08))
        }
        model.willShow()
        panel.makeKeyAndOrderFront(nil)
    }

    func hide() {
        panel.orderOut(nil)
    }

    func windowDidResignKey(_ notification: Notification) {
        hide()
    }
}
