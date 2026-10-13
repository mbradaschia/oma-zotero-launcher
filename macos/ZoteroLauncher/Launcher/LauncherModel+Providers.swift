import Foundation

// Settings › Models & providers and the default models (ZoteroSearch.qml:1695-1736, 1851-1859,
// 3717-3845): a provider's page, turning it on, testing it, its key, endpoints, picking models.
extension LauncherModel {
    // A settings change saved (GlueSettings.js's settingsChange), said in the footer when refused;
    // the providers and models asked again, as saveSetting does for paths outside general.
    // → saved, and a new endpoint's id.
    @discardableResult
    func changeSettings(_ op: String, _ args: [Any], refresh: Bool = true) -> (ok: Bool, id: String) {
        guard let core, let settings, let paths else { return (false, "") }
        if syncFolderGone {
            flashMessage("Not saved: the sync folder isn't there (Settings › General)")
            return (false, "")
        }
        let r = SettingsWriter.change(core, settings: settings, paths: paths, pathsJSON: pathsJSON, op: op, args: args)
        if case .refused(let why) = r.outcome {
            flashMessage("Not saved: " + why)
            return (false, "")
        }
        reloadSettings()
        if refresh {
            refreshProviders()
            refreshModels()
        }
        return (true, r.id)
    }

    @discardableResult
    func changeSettings(_ op: String, _ args: [Any]) -> Bool { changeSettings(op, args, refresh: true).ok }

    // A provider's row, on its page or in Models & providers. → handled.
    func providerAction(_ row: ListRow) -> Bool {
        switch row.rowId {
        case "set-provider": openProviderPage(row.value)
        case "set-quick":
            guard changeSettings("value", ["providers.\(row.value).enabled", true]) else { return true }
            flashMessage(row.label.replacingOccurrences(of: "Use ", with: "") + " is on")
            afterEnable(row.value)
            store.followTop = false
            rebuildList()
        case "set-test": testProvider(row.value)
        case "set-key": setKeyFromClipboard(row.value)
        case "set-key-remove": removeKey(row.value)
        case "set-endpoint-new":
            settingsView.edit = (try? core?.glueJSON("endpointNameEdit", [])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any]
            store.push("settings-edit")
            rebuildList()
        case "set-endpoint-remove":
            guard changeSettings("removeEndpoint", [row.value]) else { return true }
            flashMessage("Endpoint removed")
            back()
        case "set-models":
            runnerState.modelsPath = row.value
            runnerState.modelsOnly = ""
            store.push("settings-models")
            rebuildList()
            selectRow { $0.checked }
        case "set-use":
            runnerState.modelsPath = "defaults.both"
            runnerState.modelsOnly = row.value
            store.push("settings-models")
            rebuildList()
        case "set-model": chooseDefaultModel(runnerState.modelsPath, row.tag)
        default: return false
        }
        return true
    }

    func openProviderPage(_ id: String) {
        runnerState.provider = id
        store.push("settings-provider")
        rebuildList()
        testProvider(id) // Test before use: it lists the models, or says what's wrong (not twice at once)
    }

    // A default model picked (for prompts, chat, both, or the fallback).
    func chooseDefaultModel(_ path: String, _ value: String) {
        let saved = path == "defaults.both" ? changeSettings("both", [value]) : changeSettings("value", [path, value.isEmpty ? NSNull() : value])
        guard saved else { return }
        back()
        flashMessage(value.isEmpty ? "No fallback model" : (path == "defaults.both" ? "Prompts and chat use " : "Now ") + value)
    }

    // The endpoint's two steps, or a value of a provider's (its base URL, its context size).
    // → handled (else general's edit).
    func saveProviderEdit(_ edit: [String: Any], _ text: String) -> Bool {
        guard let core else { return false }
        switch edit["type"] as? String {
        case "endpoint-name":
            guard !text.isEmpty else { return true }
            settingsView.edit = (try? core.glueJSON("endpointURLEdit", [text])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any]
            store.filterText = ""
            rebuildList()
            return true
        case "endpoint-url":
            let parsed = (try? core.glueJSON("parseValue", [["type": "url", "label": "Base URL"], text])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any] ?? [:]
            if let error = parsed["error"] as? String { flashMessage(error); return true }
            let name = edit["name"] as? String ?? ""
            let r = changeSettings("addEndpoint", [name, parsed["value"] ?? text], refresh: true)
            guard r.ok else { return true }
            back()
            openProviderPage(r.id)
            flashMessage("Added “\(name)”: set its key if it needs one, then test it")
            return true
        default:
            return false
        }
    }

    // Settings › Models & providers › a provider: its name, for the header.
    var providerName: String {
        let providers = runnerState.info?["providers"] as? [[String: Any]] ?? []
        return providers.first { $0["id"] as? String == runnerState.provider }?["name"] as? String ?? runnerState.provider
    }
}
