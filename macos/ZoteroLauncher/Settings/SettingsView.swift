import KeyboardShortcuts
import SwiftUI

struct SettingsView: View {
    @ObservedObject var model: LauncherModel
    @ObservedObject var login: LoginItem
    @State private var handshake = Handshake.load()

    var body: some View {
        Form {
            Section("Keys") {
                KeyboardShortcuts.Recorder("Open the launcher:", name: .toggleLauncher)
            }
            Section("This Mac") {
                Toggle("Open at login", isOn: Binding(get: { login.enabled }, set: { login.set($0) }))
                Text(login.detail).font(.caption).foregroundStyle(login.problem.isEmpty ? Color.secondary : Color.red)
            }
            .onAppear { login.refresh() }
            Section("Zotero") {
                LabeledContent("Handshake") {
                    Text(Handshake.url().path)
                        .textSelection(.enabled)
                        .font(.caption.monospaced())
                }
                if let handshake {
                    LabeledContent("Bridge", value: "\(handshake.bridgeVersion) on port \(handshake.port)")
                    LabeledContent("Zotero", value: handshake.zoteroVersion)
                } else {
                    Text("No handshake: start Zotero, with the Zotero Omarchy Bridge plugin installed.")
                        .foregroundStyle(.secondary)
                }
                Button("Check again") { handshake = Handshake.load() }
            }
        }
        .formStyle(.grouped)
        .frame(width: 520)
        .padding()
    }
}
