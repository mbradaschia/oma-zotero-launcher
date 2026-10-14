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
            Button("Open the Launcher") { appDelegate.launcher.toggle() }
            Divider()
            SettingsLink { Text("Settings…") }
                .keyboardShortcut(",")
            Button("Quit Zotero Launcher") { NSApp.terminate(nil) }
                .keyboardShortcut("q")
        }
        Settings {
            SettingsView(model: appDelegate.launcher.model)
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let launcher = LauncherController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        Icons.registerBundledFonts()
        KeyboardShortcuts.onKeyUp(for: .toggleLauncher) { [weak self] in
            MainActor.assumeIsolated { self?.launcher.toggle() }
        }
    }
}
