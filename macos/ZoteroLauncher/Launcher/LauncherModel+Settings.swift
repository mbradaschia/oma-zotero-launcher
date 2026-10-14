import AppKit
import Foundation

// Settings: the pages lib/Settings.js builds, their rows, and saving one value into the machine and
// shared files (ZoteroSearch.qml:3573-3810, the set-* cases 1617-1937; Service.qml's saveSettings).
extension LauncherModel {
    // The page a settings view shows ("" the root).
    var settingsPageName: String {
        switch store.view {
        case "settings": return ""
        default: return String(store.view.dropFirst("settings-".count))
        }
    }

    // ; or the Settings row: the root page, or one of its pages on top of it (Esc goes back through the root).
    func openSettings(_ page: String) {
        runnerState.autoTested = []
        store.push("settings")
        if !page.isEmpty { store.push("settings-" + page) }
        if page == "styles" { refreshStyles() }
        rebuildList()
        refreshProviders()
        refreshModels()
        refreshRequirements()
        autoTestKeys()
    }

    func settingsRows(_ core: JSCore) throws -> [ListRow] {
        var extra: [String: Any] = ["filter": store.filterText, "provider": runnerState.provider, "modelsPath": runnerState.modelsPath, "only": runnerState.modelsOnly]
        if paths?.syncDir != nil, let machineOnly = (try? core.glueJSON("machineOnly", [])).flatMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }) {
            extra["machineOnly"] = machineOnly
        }
        if store.view == "settings-choice" { extra["choice"] = settingsView.choice }
        if store.view == "settings-edit" { extra["edit"] = settingsView.edit ?? [:] }
        return try core.glue("settingsPage", [settingsPageName, settingsJSON, settingsContext, extra], as: [ListRow].self)
    }

    var handshakeVersion: String { (bridge as? BridgeClient)?.handshake?.bridgeVersion ?? "" }

    // One setting saved, said in the footer. → saved?
    @discardableResult
    func saveSetting(_ path: String, _ value: Any?, _ message: String) -> Bool {
        guard let core, let settings, let paths else { return false }
        if syncFolderGone {
            flashMessage("Not saved: the sync folder isn't there (Settings › General)")
            return false
        }
        switch SettingsWriter.save(core, settings: settings, paths: paths, pathsJSON: pathsJSON, path: path, value: value) {
        case .refused(let why):
            flashMessage("Not saved: " + why)
            return false
        case .saved:
            reloadSettings()
            if !message.isEmpty { flashMessage(message) }
            if !path.hasPrefix("general.") {
                refreshProviders()
                refreshModels()
            }
            store.followTop = false
            rebuildList()
            return true
        }
    }

    func reloadSettings() {
        runnerState.index = nil
        guard let core, let paths else { return }
        let next = AppSettings.load(core, paths: paths, machine: AppPaths.readJSON(paths.settings))
        settings = next
        store.searchFirst = next.searchFirst
        store.keys = KeyBuffer(delay: next.keyDelay)
    }

    func toggleSetting(_ path: String) {
        guard let core else { return }
        let on = (try? core.glue("settingValue", [settingsJSON, path], as: Bool.self)) ?? false
        guard saveSetting(path, !on, "") else { return }
        // a provider or an endpoint turned on or off (ZoteroSearch.qml:3750)
        let parts = path.split(separator: ".").map(String.init)
        if parts.count == 3, ["providers", "endpoint"].contains(parts[0]), parts[2] == "enabled" {
            flashMessage(on ? "Off: its models leave the pickers" : "On")
            if !on { afterEnable(parts[1]) }
        }
    }

    func openSettingsEdit(_ path: String) {
        guard let core, let edit = (try? core.glueJSON("settingEdit", [path, settingsJSON])).flatMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }) as? [String: Any]
        else { return }
        settingsView.edit = edit
        store.push("settings-edit")
        store.filterText = edit["current"] as? String ?? ""
        rebuildList()
    }

    func saveSettingsEdit(_ text: String) {
        guard let edit = settingsView.edit, let core else { return }
        if saveProviderEdit(edit, text) { return }
        guard let item = edit["item"] else { return }
        let parsed = (try? core.glueJSON("parseValue", [item, text])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any] ?? [:]
        if let error = parsed["error"] as? String { return flashMessage(error) }
        if saveSetting(edit["path"] as? String ?? "", parsed["value"], "Saved") { back() }
    }

    // The citation styles installed in Zotero (/styles), for Settings › General › Citation style.
    func refreshStyles() {
        bridge.post("/styles", [:], timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self else { return }
                if case .ok(let answer) = result {
                    self.settingsView.styles = answer["styles"] as? [Any] ?? []
                    self.settingsView.stylesProblem = ""
                } else {
                    self.settingsView.stylesProblem = result.message
                }
                if self.store.view == "settings-styles" {
                    self.store.followTop = false
                    self.rebuildList()
                    self.selectRow { $0.checked }
                }
            }
        }
    }

    // The set-* rows (ActionMap's): what Enter does on each.
    func settingsAction(_ row: ListRow) {
        if providerAction(row) || setupAction(row) { return }
        switch row.rowId {
        case "set-nav":
            if row.value == "root" { back(); return }
            store.push("settings-" + row.value)
            if row.value == "styles" { refreshStyles() }
            rebuildList()
        case "set-toggle":
            toggleSetting(row.value)
        case "set-choice":
            settingsView.choice = row.value
            store.push("settings-choice")
            rebuildList()
            selectRow { $0.checked }
        case "set-opt":
            let path = row.value
            if saveSetting(path, row.tag, "") {
                back()
                selectRow { $0.rowId == "set-choice" && $0.value == path }
            }
        case "set-edit":
            openSettingsEdit(row.value)
        case "set-save":
            saveSettingsEdit(row.value)
        case "set-styles":
            store.push("settings-styles")
            refreshStyles()
            rebuildList()
            selectRow { $0.checked }
        case "set-style-opt":
            if saveSetting("general.citationStyle", row.value == "apa" ? nil : row.value, "Citations in " + row.label) {
                back()
                selectRow { $0.rowId == "set-styles" }
            }
        case "set-link":
            if let url = URL(string: row.value), ["http", "https"].contains(url.scheme ?? "") {
                _ = desktop.open(url: url)
                flashMessage("Opened in your browser")
            }
        case "tags-status":
            openSettings(row.value)
        default:
            break
        }
    }

    // Ctrl+V / ⌘V in a page for typing: the clipboard into what you type.
    func pasteIntoFilter() {
        guard let text = desktop.pasteboardText(), !text.isEmpty else { return }
        setFilter(store.filterText + text.components(separatedBy: .newlines).joined(separator: " ").trimmingCharacters(in: .whitespaces))
    }
}
