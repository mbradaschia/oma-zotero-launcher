import AppKit

// What the launcher does on the Mac outside Zotero: open a file in its default app, the
// clipboard, Zotero to the front or started. The tests use a fake.
protocol Desktop: AnyObject {
    func open(path: String) -> Bool
    func copy(_ text: String) -> Bool
    func activateZotero()
    func launchZotero()
    func open(url: URL) -> Bool // a web page or a zotero:// link, in its app
    func pasteboardText() -> String?
    // The clipboard emptied, if it still holds `text` (an API key just handed over: not left there).
    func clearPasteboard(ifStill text: String)
    var zoteroInstalled: Bool { get }
    var zoteroRunning: Bool { get }
}

final class SystemDesktop: Desktop {
    static let zoteroBundle = "org.zotero.zotero"

    func open(path: String) -> Bool {
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }

    func copy(_ text: String) -> Bool {
        NSPasteboard.general.clearContents()
        return NSPasteboard.general.setString(text, forType: .string)
    }

    func activateZotero() {
        _ = NSRunningApplication.runningApplications(withBundleIdentifier: Self.zoteroBundle).first?.activate()
    }

    func open(url: URL) -> Bool {
        NSWorkspace.shared.open(url)
    }

    func pasteboardText() -> String? {
        NSPasteboard.general.string(forType: .string)
    }

    func clearPasteboard(ifStill text: String) {
        if NSPasteboard.general.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines) == text { NSPasteboard.general.clearContents() }
    }

    var zoteroInstalled: Bool { NSWorkspace.shared.urlForApplication(withBundleIdentifier: Self.zoteroBundle) != nil }
    var zoteroRunning: Bool { !NSRunningApplication.runningApplications(withBundleIdentifier: Self.zoteroBundle).isEmpty }

    func launchZotero() {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: Self.zoteroBundle) else { return }
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
    }
}
