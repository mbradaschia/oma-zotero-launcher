import Foundation

// Zotero's own sync from the launcher: S and Go to › Sync Zotero (ZoteroSearch.qml:746, 4191;
// Service.qml:765-812). The Processes view that lists it on Omarchy is phase 6's: here a flash
// says when it ends.
extension LauncherModel {
    // When Zotero last synced, asked on each opening (the footer says it).
    func refreshSync() {
        bridge.post("/sync/status", [:], timeout: 4) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self, case .ok(let info) = result else { return }
                self.searchState.sync = info
                self.syncInfoChanged()
                self.followSync()
            }
        }
    }

    func syncZotero() {
        if let info = searchState.sync, info["configured"] as? Bool != true {
            return flashMessage("Zotero sync isn't set up: sign in under Zotero › Settings › Sync")
        }
        bridge.post("/sync/start", [:], timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self else { return }
                guard case .ok(let info) = result else {
                    let why: String
                    switch result {
                    case .zoteroDown, .noHandshake: why = "Zotero isn't running"
                    default: why = result.message
                    }
                    return self.flashMessage("Couldn't start the sync: " + why)
                }
                self.searchState.sync = info
                self.syncInfoChanged()
                self.searchState.syncRunning = true
                self.syncTimer?.invalidate()
                self.syncTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
                    MainActor.assumeIsolated { self?.refreshSync() }
                }
                self.flashMessage(info["started"] as? Bool == true ? "Syncing Zotero" : "Zotero is already syncing")
            }
        }
    }

    // While a sync started here runs: when it ends, synced or Zotero's error, and the results asked
    // again for what it brought.
    func followSync() {
        guard searchState.syncRunning, let info = searchState.sync else { return objectWillChange.send() }
        if info["running"] as? Bool == true { return objectWillChange.send() }
        syncTimer?.invalidate()
        syncTimer = nil
        searchState.syncRunning = false
        let run = info["run"] as? [String: Any] ?? [:]
        let ok = run["ok"] as? Bool != false
        guard opened else {
            libraryChanged = true
            if !ok { notify("Zotero couldn't sync", run["error"] as? String ?? "the sync failed") }
            return
        }
        flashMessage(ok ? "Zotero synced" : "Zotero couldn't sync: " + (run["error"] as? String ?? "the sync failed"))
        if store.inSearch { requestSearch() } else { libraryChanged = true }
    }

    // Go to's Sync Zotero line says how it's going (ZoteroSearch.qml:745).
    private func syncInfoChanged() {
        if store.inSearch && !store.filterText.isEmpty { rebuildSearch() }
    }

    // The footer's word at the top level: "synced 5 min ago", "syncing…", or nothing.
    var syncFooter: String {
        guard store.atRoot, let sync = searchState.sync, let core else { return "" }
        return (try? core.glue("syncFooter", [sync, nowMs], as: String.self)) ?? ""
    }
}
