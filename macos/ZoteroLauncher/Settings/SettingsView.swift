import KeyboardShortcuts
import SwiftUI

struct SettingsView: View {
    @ObservedObject var model: LauncherModel
    @State private var handshake = Handshake.load()

    var body: some View {
        Form {
            Section("Keys") {
                KeyboardShortcuts.Recorder("Open the launcher:", name: .toggleLauncher)
            }
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
