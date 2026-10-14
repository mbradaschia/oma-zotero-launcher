import Foundation

// The shared files (contracts/Paths.js): read on each opening, the sync folder's conflict copies
// merged, a write refused while the sync folder is away, and how errors about them read.
extension LauncherModel {
    func loadFiles() {
        guard let core else { return }
        do {
            let (paths, machine, raw) = try AppPaths.resolveAll(core, env: env)
            self.paths = paths
            pathsJSON = raw
            let settings = AppSettings.load(core, paths: paths, machine: machine)
            self.settings = settings
            pins = PinsFile.load(URL(fileURLWithPath: paths.pins), readOnly: paths.readOnly, core: core)
            prefs = ViewPrefs.load(URL(fileURLWithPath: paths.view), readOnly: paths.readOnly)
            todos = TodosFile.load(URL(fileURLWithPath: paths.todos), readOnly: paths.readOnly, core: core)
            searchesFile = SearchesFile.load(URL(fileURLWithPath: paths.searches), readOnly: paths.readOnly, core: core)
            if extractFile == nil { loadExtractState() } // (machine-only: read once, kept by the app)
            watchTasks()
            mergeConflicts()
            store.searchFirst = settings.searchFirst
            store.keys = KeyBuffer(delay: settings.keyDelay)
        } catch {
            lastError = String(describing: error)
        }
    }

    // The sync folder's conflict copies merged (contracts/Merge.js), on each open and whenever the
    // folder changes while the app runs; the files read again after a merge.
    func mergeConflicts() {
        guard let core, let dir = paths?.syncDir, paths?.readOnly == false else { syncWatcher = nil; watching = ""; return }
        let shared = URL(fileURLWithPath: dir).appendingPathComponent("shared")
        if watching != shared.path {
            watching = shared.path
            syncWatcher = FolderWatcher(shared) { [weak self] in
                MainActor.assumeIsolated {
                    guard let self, let core = self.core else { return }
                    if !ConflictMerger.run(core, in: shared, machine: self.paths?.machine ?? "this machine").merged.isEmpty { self.reloadSyncedFiles() }
                }
            }
        }
        let outcome = ConflictMerger.run(core, in: shared, machine: paths?.machine ?? "this machine")
        if !outcome.merged.isEmpty { reloadSyncedFiles() }
        if let problem = outcome.problems.first { NSLog("ZoteroLauncher: sync conflict: %@", problem) }
    }

    // pins.json, view.json, todos.json, searches.json and the settings, read again (a merge, the other machine).
    func reloadSyncedFiles() {
        guard let core else { return }
        pins?.reload(core)
        prefs?.reload()
        todos?.reload(core)
        searchesFile?.reload(core)
        reloadSettings()
        searchesChanged()
    }

    // A change refused while the sync folder is away, or a write that failed: said in the footer.
    func saved(_ write: () throws -> Void) {
        if syncFolderGone {
            lastError = "Not saved: " + syncFolderAway
            return
        }
        do { try write() } catch PinsFile.WriteError.readOnly, ViewPrefs.WriteError.readOnly, TodosFile.WriteError.readOnly, SearchesFile.WriteError.readOnly {
            lastError = "Not saved: " + syncFolderAway
        } catch PinsFile.WriteError.damaged {
            lastError = shown(paths?.pins ?? "pins.json") + " isn't valid: not changed, so your pins aren't lost (fix or remove it)"
        } catch TodosFile.WriteError.damaged {
            lastError = shown(paths?.todos ?? "todos.json") + " isn't valid: not changed, so your tasks aren't lost (fix or remove it)"
        } catch SearchesFile.WriteError.damaged {
            lastError = shown(paths?.searches ?? "searches.json") + " isn't valid: not changed, so your saved searches aren't lost (fix or remove it)"
        } catch ViewPrefs.WriteError.damaged {
            lastError = shown(paths?.view ?? "view.json") + " isn't valid: not changed, so your arrangement isn't lost (fix or remove it)"
        } catch {
            lastError = "Couldn't save it: \(error)"
        }
    }

    // The sync folder away, said one way everywhere (after "Not saved: "), the folder named.
    var syncFolderAway: String { "the sync folder \(shown(paths?.syncDir ?? "")) isn't there: what's synced stays as it was until it's back (Settings › General)" }

    // A path as you'd write it: your home folder as ~.
    func shown(_ path: String) -> String {
        let home = env["HOME"] ?? NSHomeDirectory()
        return path == home ? "~" : path.hasPrefix(home + "/") ? "~" + path.dropFirst(home.count) : path
    }

    // A sync folder set whose marker went away since the files were read (renamed, a drive gone):
    // writing would make a lone copy of the folder.
    var syncFolderGone: Bool {
        guard let marker = paths?.marker, paths?.readOnly == false else { return false }
        return !FileManager.default.fileExists(atPath: marker)
    }
}
