import KeyboardShortcuts
import SwiftUI

// The menu bar menu (macos/PLAN.md phase 10): the launcher (its hotkey named), its places as Go to names them, the
// login item, updates (GitHub's releases), and Quit. The app's own Settings window (the hotkey, this Mac) is "Hotkey and Login…".
struct MenuBarMenu: View {
    let launcher: LauncherController
    @ObservedObject var login: LoginItem
    @ObservedObject var updates: UpdateCheck

    var body: some View {
        Button(openTitle) { launcher.toggle() }
        Divider()
        Button("Chats…") { launcher.show(place: "chats") }
        Button("Processes…") { launcher.show(place: "tasks") }
        Button("Settings…") { launcher.show(place: "settings") }
        Button("Sync Zotero") { launcher.show(place: "sync") }
        Divider()
        Toggle("Open at Login", isOn: Binding(get: { login.enabled }, set: { login.set($0) }))
        if !login.problem.isEmpty || login.needsApproval { Text(login.detail) } // (a failure, said where it happened)
        OpenAppSettings() // Hotkey and Login…
        Button("Check for Updates…") { updates.checkFromMenu() }
        if let a = updates.available { Button("Update to \(a.version)…") { updates.confirmUpdate() } } // (asks first: Update / Later)
        Divider()
        Button("Quit Zotero Launcher") { NSApp.terminate(nil) }
            .keyboardShortcut("q")
            .onAppear { login.refresh() }
    }

    // "Open the Launcher  ⌃⌥Z": the hotkey as Settings has it now
    private var openTitle: String {
        guard let shortcut = KeyboardShortcuts.getShortcut(for: .toggleLauncher) else { return "Open the Launcher" }
        return "Open the Launcher  \(shortcut.description)"
    }
}

// Hotkey and Login…: the app's Settings window, in front. (SettingsLink opens it without bringing a menu bar app forward:
// it opened behind the app in front, out of sight, so the hotkey seemed impossible to change.)
struct OpenAppSettings: View {
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        Button("Hotkey and Login…") {
            NSApp.activate(ignoringOtherApps: true)
            openSettings()
            DispatchQueue.main.async { AppSettingsWindow.bringToFront() }
        }
        .keyboardShortcut(",")
    }
}

enum AppSettingsWindow {
    // SwiftUI's Settings window (its identifier names it), key and in front of every other app's windows.
    static func bringToFront() {
        NSApp.activate(ignoringOtherApps: true)
        guard let w = NSApp.windows.first(where: { $0.identifier?.rawValue.localizedCaseInsensitiveContains("settings") == true }) else { return }
        w.makeKeyAndOrderFront(nil)
        w.orderFrontRegardless()
    }
}

