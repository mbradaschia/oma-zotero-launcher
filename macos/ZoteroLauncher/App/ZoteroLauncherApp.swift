import AppKit
import KeyboardShortcuts
import SwiftUI

extension KeyboardShortcuts.Name {
    // ⌃⌥Z by default: ⌘⇧Z is Redo in most apps. Rebind it in Settings.
    static let toggleLauncher = Self("toggleLauncher", default: .init(.z, modifiers: [.control, .option]))
}

@main
struct ZoteroLauncherApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        MenuBarExtra("Zotero Launcher", systemImage: "books.vertical") {
            MenuBarMenu(launcher: appDelegate.launcher, login: appDelegate.login, updates: appDelegate.updates)
        }
        Settings {
            SettingsView(model: appDelegate.launcher.model, login: appDelegate.login)
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let launcher = LauncherController()
    let login = LoginItem()
    let updates = UpdateCheck(fetcher: URLSessionFetcher())
    private var updateTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        Icons.registerBundledFonts()
        KeyboardShortcuts.onKeyUp(for: .toggleLauncher) { [weak self] in
            MainActor.assumeIsolated { self?.launcher.toggle() }
        }
        // The UI tests (ZoteroLauncherUITests): the launcher open from the start, as the hotkey would open it.
        if UserDefaults.standard.bool(forKey: "ZLOpenOnLaunch") { launcher.show() }
        // GitHub's releases, once a day (the check itself skips a day already asked)
        if UpdateCheck.automatic(ProcessInfo.processInfo.environment) {
            updates.check(now: false)
            updateTimer = Timer.scheduledTimer(withTimeInterval: 3600, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.updates.check(now: false) }
            }
        }
    }
}
