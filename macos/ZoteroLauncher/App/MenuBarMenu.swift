import KeyboardShortcuts
import SwiftUI

// The menu bar menu (macos/PLAN.md phase 10): the launcher (its hotkey named), its places as Go to names them, the
// login item, and Quit. The app's own Settings window (the hotkey, this Mac) is "Hotkey and Login…".
struct MenuBarMenu: View {
    let launcher: LauncherController
    @ObservedObject var login: LoginItem

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
        SettingsLink { Text("Hotkey and Login…") }
            .keyboardShortcut(",")
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
