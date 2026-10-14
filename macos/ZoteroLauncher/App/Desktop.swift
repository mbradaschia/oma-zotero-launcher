import AppKit

// What the launcher does on the Mac outside Zotero: open a file in its default app, the
// clipboard, Zotero to the front or started. The tests use a fake.
protocol Desktop: AnyObject {
    func open(path: String) -> Bool
    func copy(_ text: String) -> Bool
    func activateZotero()
    func launchZotero()
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

    func launchZotero() {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: Self.zoteroBundle) else { return }
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
    }
}
