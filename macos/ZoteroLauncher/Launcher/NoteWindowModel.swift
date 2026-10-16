import AppKit
import Combine
import Foundation

// One note in its own window (reference/NoteWindow.qml): the note, its paper's header (citation,
// rankings, status and default task), and its keys. The launcher's model does the saving.
@MainActor
final class NoteWindowModel: ObservableObject {
    let note: [String: Any] // { key, libraryID, title }
    unowned let launcher: LauncherModel
    @Published var data: [String: Any]?
    @Published var error = ""
    @Published var flash = ""
    @Published var paperTags: [String]? // its paper's tags, nil until read
    @Published var statusShown: String? // changed here, not saved yet
    @Published var taskShown = ""
    @Published var showKeys = false // ? or F1: the window's keys (VIEW_KEYS["note-window"])
    weak var display: NoteDisplay?
    var showMenu: ([String: Any], [String: Any]) -> Void = { _, _ in } // the launcher, on the paper's menu, the note highlighted
    var close: () -> Void = {}
    private var statusFrom = ""
    private var statusTimer: Timer?
    private var taskTimer: Timer?
    private var flashTimer: Timer?

    init(note: [String: Any], launcher: LauncherModel) {
        self.note = note
        self.launcher = launcher
    }

    var key: String { note["key"] as? String ?? "" }
    var paper: [String: Any]? { data?["paper"] as? [String: Any] }

    // Its paper, a regular item: { key, libraryID, title, cite }, or nil.
    var paperItem: [String: Any]? {
        guard let p = data?["parent"] as? [String: Any], let type = p["itemType"] as? String, !["note", "attachment"].contains(type) else { return nil }
        let cite = paper.flatMap { (try? launcher.core?.glue("paperCite", [$0], as: String.self)) ?? "" } ?? ""
        return ["key": p["key"] ?? "", "libraryID": p["libraryID"] ?? 1, "title": (paper?["title"] as? String) ?? (p["title"] as? String ?? ""), "cite": cite]
    }

    var title: String {
        guard let html = data?["html"] as? String, let core = launcher.core,
              let parts = (try? core.glueJSON("noteParts", [html, data?["title"] as? String ?? ""])).flatMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }) as? [String: Any]
        else { return note["title"] as? String ?? "Note" }
        return parts["title"] as? String ?? ""
    }

    var body: String {
        guard let html = data?["html"] as? String else { return "" }
        return launcher.noteBody(html, title: data?["title"] as? String ?? "")
    }

    var ranks: [String] { paper.flatMap { (try? launcher.core?.glue("rankLabels", [$0["rank"] ?? NSNull()], as: [String].self)) ?? [] } ?? [] }

    var paperStatus: String {
        if let statusShown { return statusShown }
        return (try? launcher.core?.glue("paperStatusOf", [(paperTags ?? []).map { ["tag": $0] }, launcher.paperStatusTags], as: String.self)) ?? ""
    }

    var taskName: String {
        guard let item = paperItem else { return "" }
        if !taskShown.isEmpty { return launcher.todoStatuses.first { $0["id"] as? String == taskShown }?["name"] as? String ?? "" }
        return launcher.defaultTasks["\(item["libraryID"] ?? 1):\(item["key"] ?? "")"]?["name"] as? String ?? ""
    }

    func load() {
        launcher.bridge.post("/note", ["key": key, "libraryID": note["libraryID"] ?? 1, "format": "html"], timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self else { return }
                if case .ok(let answer) = result {
                    self.data = answer
                    self.error = ""
                    self.loadPaper()
                } else {
                    self.error = result.message
                }
            }
        }
    }

    private func loadPaper() {
        guard let item = paperItem else { return }
        launcher.bridge.post("/item", ["key": item["key"] ?? "", "libraryID": item["libraryID"] ?? 1], timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                if case .ok(let answer) = result { self?.paperTags = (answer["tags"] as? [[String: Any]] ?? []).compactMap { $0["tag"] as? String } }
            }
        }
    }

    func showFlash(_ text: String) {
        flash = text
        flashTimer?.invalidate()
        flashTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: false) { [weak self] _ in MainActor.assumeIsolated { self?.flash = "" } }
    }

    // ⌥→/←: the paper's status, shown at once, saved a second after the last press.
    func cycleStatus(_ delta: Int) {
        guard let item = paperItem, paperTags != nil else { return showFlash(paperItem == nil ? "This note isn't on a paper" : "Reading the paper's tags…") }
        if launcher.paperStatusTags.isEmpty { return showFlash("No paper statuses: add some in Settings › Paper status") }
        if statusShown == nil { statusFrom = paperStatus }
        let next = (try? launcher.core?.glue("nextPaperStatus", [launcher.paperStatusTags, paperStatus, delta], as: String.self)) ?? ""
        statusShown = next
        statusTimer?.invalidate()
        statusTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: false) { [weak self] _ in MainActor.assumeIsolated { self?.saveStatus(item) } }
        let name = (try? launcher.core?.glue("statusName", [next], as: String.self)) ?? ""
        showFlash("Status: " + (name.isEmpty ? "none" : name))
    }

    func saveStatus(_ item: [String: Any]) {
        guard let to = statusShown else { return }
        let from = statusFrom
        let add = !to.isEmpty && to.lowercased() != from.lowercased() ? [to] : []
        let remove = !from.isEmpty && from.lowercased() != to.lowercased() ? [from] : []
        guard !add.isEmpty || !remove.isEmpty else { statusShown = nil; return }
        launcher.updateTags(item, add: add, remove: remove) { [weak self] result in
            guard let self else { return }
            if case .ok = result {
                self.paperTags = (self.paperTags ?? []).filter { $0.lowercased() != from.lowercased() } + (to.isEmpty ? [] : [to])
                self.launcher.libraryChanged = true
            } else {
                self.showFlash("Couldn't save the status: \(result.message)")
            }
            if self.statusShown == to { self.statusShown = nil }
        }
    }

    // ⇧⌥→/←: the paper's default task to its next or previous status (the first press makes it).
    func cycleTask(_ delta: Int) {
        guard let item = paperItem, let core = launcher.core else { return showFlash("This note isn't on a paper") }
        let statuses = launcher.todoStatuses
        let id = "\(item["libraryID"] ?? 1):\(item["key"] ?? "")"
        let current = taskShown.isEmpty ? launcher.defaultTasks[id]?["id"] as? String ?? "" : taskShown
        let next = (try? core.glue("nextDefaultStatus", [statuses, current, delta], as: String.self)) ?? ""
        guard !next.isEmpty else { return }
        let made = current.isEmpty
        taskShown = next
        taskTimer?.invalidate()
        taskTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.launcher.marks.taskPending[id] = (item, next)
                self.launcher.flushDefaultTasks()
                self.taskShown = ""
            }
        }
        let name = statuses.first { $0["id"] as? String == next }?["name"] as? String ?? next
        let description = (try? core.glue("defaultTaskDescription", [launcher.settingsJSON, item], as: String.self)) ?? ""
        showFlash((made ? "New task, “\(description)”: " : "Task: ") + name)
    }

    // The window closing: what a key changed and the timer hasn't saved yet, saved now (NoteWindow.qml:80).
    func flushPending() {
        if statusTimer?.isValid == true, let item = paperItem {
            statusTimer?.invalidate()
            saveStatus(item)
        }
        if taskTimer?.isValid == true {
            taskTimer?.fire()
            taskTimer?.invalidate()
        }
    }

    // m: the paper this note is on (or the note itself), in the launcher, the note highlighted.
    func backToMenu() {
        if let parent = data?["parent"] as? [String: Any] {
            showMenu(parent, ["rowId": "note", "noteKey": key])
        } else {
            showMenu(["key": key, "libraryID": note["libraryID"] ?? 1, "title": note["title"] ?? "", "itemType": "note"], ["rowId": "read"])
        }
    }

    func exportNote(_ how: String) {
        showFlash(how == "save" ? "Saving…" : "Copying…")
        launcher.bridge.post("/note", ["key": key, "libraryID": note["libraryID"] ?? 1, "format": "export"], timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self else { return }
                guard case .ok(let answer) = result, let markdown = answer["markdown"] as? String else { return self.showFlash("Couldn't get the note: \(result.message)") }
                if how == "copy" { return self.showFlash(self.launcher.desktop.copy(markdown) ? "Copied the note as Markdown" : "Couldn't copy the note") }
                let name = (try? self.launcher.core?.glue("fileName", [answer["title"] as? String ?? self.note["title"] as? String ?? "note"], as: String.self)) ?? "note"
                do {
                    let url = try LauncherModel.saveMarkdown(markdown, named: name)
                    self.showFlash("Saved " + url.path.replacingOccurrences(of: NSHomeDirectory(), with: "~"))
                } catch {
                    self.showFlash("Couldn't save the note: \(error.localizedDescription)")
                }
            }
        }
    }

    func openInZotero() {
        launcher.bridge.post("/open", ["key": key, "libraryID": note["libraryID"] ?? 1], timeout: 8) { [weak self] result in
            MainActor.assumeIsolated { if case .ok = result { self?.launcher.desktop.activateZotero() } }
        }
    }

    // The window's keys (NoteWindow.qml's Keys.onPressed). → taken.
    func handle(_ e: KeyEvent) -> Bool {
        let c: Character? = { if case .character(let c) = e.key { return c } else { return nil } }()
        if e.command, c == "c" { return false } // copies the selection
        if e.command, c == "w" { close(); return true }
        if (e.control || e.command), let c, ["-", "+", "=", "0"].contains(c) {
            launcher.stepNoteFont(c == "-" ? -1 : c == "0" ? 0 : 1)
            showFlash("Text \(launcher.noteTextSize) px")
            objectWillChange.send()
            return true
        }
        let macDelete = e.command && !e.option && !e.control && e.key == .backspace // ⌘⌫, the Mac's delete (as the launcher's)
        if e.command && !macDelete { return false }
        if e.option && !e.control && (e.key == .left || e.key == .right) {
            let delta = e.key == .left ? -1 : 1
            if e.shift { cycleTask(delta) } else { cycleStatus(delta) }
            return true
        }
        if e.key == .f1 || c == "?" { showKeys.toggle(); return true }
        switch (e.key, c) {
        case (.escape, _) where showKeys: showKeys = false
        case (.escape, _): close()
        case (_, "z"): openInZotero()
        case (.enter, _) where e.shift: openInZotero()
        case (_, "m"): backToMenu()
        case (.delete, _) where !e.shift && !e.option && !e.control, (.backspace, _) where macDelete: // asked in the launcher, on the note's own menu
            showMenu(["key": key, "libraryID": note["libraryID"] ?? 1, "title": note["title"] ?? "", "itemType": "note"], ["rowId": "note-delete"])
        case (_, "y"): exportNote("copy")
        case (_, "s"): exportNote("save")
        case (_, "c"): // its paper's chat
            guard let p = paperItem else { showFlash("This note isn't on a paper: nothing to chat about"); break }
            guard launcher.runnerInstalled else { showFlash("Chat needs the AI features: Settings › Setup installs them"); break }
            launcher.openChatWindow(PaperRef(key: p["key"] as? String ?? "", libraryID: p["libraryID"] as? Int ?? 1, title: p["title"] as? String ?? "", itemType: ""))
        case (.down, _), (_, "j"): display?.scroll(by: 3)
        case (.up, _), (_, "k"): display?.scroll(by: -3)
        case (_, " ") where e.shift: display?.scrollPage(-1)
        case (.pageDown, _), (_, " "): display?.scrollPage(1)
        case (.pageUp, _), (_, "b"): display?.scrollPage(-1)
        case (.home, _): display?.scrollToTop()
        case (_, "g"): if e.shift { display?.scrollToEnd() } else { display?.scrollToTop() }
        case (.end, _): display?.scrollToEnd()
        default: return false
        }
        return true
    }
}
