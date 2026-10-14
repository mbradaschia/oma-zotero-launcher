import AppKit
import Foundation

// What a note view draws on (the reader's web view): scrolling, as the keys ask.
@MainActor
protocol NoteDisplay: AnyObject {
    func scroll(by lines: CGFloat)
    func scrollPage(_ pages: CGFloat)
    func scrollToTop()
    func scrollToEnd()
}

// A paper's notes: the list, the reader, the paper's other notes, export, notes under a paper in
// the results, their order and text size (ZoteroSearch.qml:595-622, 3383-3410, 3950-4262, 4713-4750).
extension LauncherModel {
    // Your order of the paper's notes (view.json's noteOrder).
    var noteOrder: [String] {
        guard let item = actionItem else { return [] }
        return (prefs?.values["noteOrder"] as? [String: Any])?[item.id] as? [String] ?? []
    }

    func notes(of details: [String: Any]?, order: [String]) -> [[String: Any]] {
        (core.flatMap { try? $0.glueJSON("ownNotes", [details ?? NSNull(), order]) }).flatMap(Self.jsonArray) ?? []
    }

    // Notes: one opens straight in the reader, several get the list (ZoteroSearch.qml:3950).
    func enterNotes() {
        let list = notes(of: details, order: noteOrder)
        if list.count == 1 { return openNoteView(list[0]) }
        if list.count > 1 {
            store.push("notes")
            rebuildList()
            return
        }
        selectRow { $0.rowId == "notes-empty" }
        store.followTop = false
    }

    func openNoteView(_ target: [String: Any]) {
        store.push("note")
        content = .list([])
        loadNote(target)
    }

    // The note shown: from the cache, else asked of Zotero; then its paper's other notes.
    func loadNote(_ target: [String: Any]) {
        let key = target["key"] as? String ?? ""
        note.target = ["key": key, "libraryID": target["libraryID"] ?? 1, "title": (target["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Untitled note"]
        note.error = ""
        noteDisplay?.scrollToTop()
        note.serial += 1 // an answer still on its way is for another note now
        if let cached = note.cache[key] {
            note.data = cached
            loadNoteSiblings(cached["parent"] as? [String: Any])
            refreshPaperPills()
            objectWillChange.send()
            return
        }
        note.data = nil
        let serial = note.serial
        bridge.post("/note", ["key": key, "libraryID": target["libraryID"] ?? 1, "format": "html"], timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self, serial == self.note.serial, self.opened, self.store.inNote else { return }
                if case .ok(let answer) = result {
                    self.note.data = answer
                    self.note.cache[key] = answer
                    self.loadNoteSiblings(answer["parent"] as? [String: Any])
                } else {
                    self.note.error = result.message
                }
                self.refreshPaperPills() // (the paper's pills: on its own note only)
                self.objectWillChange.send()
            }
        }
    }

    // The paper's notes, in your order; opened from the results, that paper becomes the one in view.
    private func loadNoteSiblings(_ parent: [String: Any]?) {
        guard let parent, let key = parent["key"] as? String else {
            note.siblings = []
            note.siblingsOf = ""
            return
        }
        let lib = parent["libraryID"] as? Int ?? 1
        let id = "\(lib):\(key)"
        if id == note.siblingsOf && !note.siblings.isEmpty { return }
        note.siblingsOf = id
        note.siblings = []
        bridge.post("/item", ["key": key, "libraryID": lib], timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                // still reading a note of that paper: else it would repoint the menu you are in now
                guard let self, self.note.siblingsOf == id, self.store.inNote, case .ok(let answer) = result else { return }
                let order = (self.prefs?.values["noteOrder"] as? [String: Any])?[id] as? [String] ?? []
                self.note.siblings = self.notes(of: answer, order: order)
                if self.actionItem?.id != id {
                    let info = answer["item"] as? [String: Any] ?? [:]
                    self.actionItem = PaperRef(key: key, libraryID: lib, title: info["title"] as? String ?? parent["title"] as? String ?? "", itemType: info["itemType"] as? String ?? "")
                    self.details = answer
                }
                self.objectWillChange.send()
            }
        }
    }

    // Reading a note: its paper is the one in view (its details loaded).
    var notePaperInView: Bool {
        guard let p = note.data?["parent"] as? [String: Any], let item = actionItem, details != nil else { return false }
        return p["key"] as? String == item.key && (p["libraryID"] as? Int ?? 1) == item.libraryID
    }

    // Shift+↑/↓ in the reader: the paper's previous or next note, round and round.
    func cycleNote(_ delta: Int) {
        let n = note.siblings.count
        if n < 2 { return flashMessage(n == 1 ? "The paper's only note" : "No other notes") }
        let i = note.siblings.firstIndex { $0["key"] as? String == note.target?["key"] as? String } ?? 0
        loadNote(note.siblings[((i + delta) % n + n) % n])
    }

    // Delete a note (Delete on a note row or while reading it, the menu's Delete this note, its window's Delete):
    // asked first, to Zotero's trash (restorable there); its window closes, the reader leaves it.
    func askDeleteNote(_ target: [String: Any]?) {
        guard let target, let key = target["key"] as? String, !key.isEmpty else { return }
        let name = (target["title"] as? String ?? actionItem?.title ?? "").trimmingCharacters(in: .whitespaces)
        askConfirm(ConfirmAsk(title: name.isEmpty ? "Delete this note?" : "Delete the note “\(name)”?", yes: "Delete it (to Zotero's trash)", no: "Keep it",
                              detail: "You can restore it from Zotero's trash", run: { [weak self] in
            self?.bridge.post("/notes/delete", ["key": key, "libraryID": target["libraryID"] ?? 1], timeout: 8) { result in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    guard case .ok = result else {
                        // an older plugin, without the route, answers as if it were missing
                        if case .bridgeMissing = result { return self.flashMessage("Couldn't delete the note: the Zotero Omarchy Bridge is older than the app (Settings › Setup › Update the Zotero Omarchy Bridge)") }
                        return self.flashMessage("Couldn't delete the note: " + result.message)
                    }
                    self.closeNoteWindow(key)
                    // leave what showed only that note: the reader, its own menu
                    if self.store.inNote && self.note.target?["key"] as? String == key { self.back() }
                    if self.store.view == "actions" && self.actionItem?.key == key { // its own menu: back to the results, searched again
                        while self.store.view == "actions" && self.back() {}
                        if self.store.inSearch { self.requestSearch() }
                    }
                    self.flashMessage("The note is in Zotero's trash")
                    self.refreshDetails()
                }
            }
        }))
    }

    // The note under the cursor in a list, or the one being read.
    func selectedNoteTarget() -> [String: Any]? {
        if store.inNote { return note.target }
        guard let row = selectedListRow, !row.noteKey.isEmpty else { return nil }
        return ["key": row.noteKey, "libraryID": row.noteLibraryID, "title": ["read", "note-delete"].contains(row.rowId) ? actionItem?.title ?? "Note" : row.label]
    }

    // y: the note as Zotero exports it (Markdown) to the clipboard; s: saved as a .md in Downloads.
    func exportNote(_ how: String) {
        guard let target = selectedNoteTarget(), let core else { return }
        flashMessage(how == "save" ? "Saving…" : "Copying…")
        bridge.post("/note", ["key": target["key"] ?? "", "libraryID": target["libraryID"] ?? 1, "format": "export"], timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self else { return }
                guard case .ok(let answer) = result, let markdown = answer["markdown"] as? String else {
                    return self.flashMessage("Couldn't get the note" + (result.message.isEmpty ? "" : ": " + result.message))
                }
                if how == "copy" { return self.flashMessage(self.desktop.copy(markdown) ? "Copied the note as Markdown" : "Couldn't copy the note") }
                let name = (try? core.glue("fileName", [target["title"] as? String ?? "note"], as: String.self)) ?? "note"
                do {
                    let url = try Self.saveMarkdown(markdown, named: name)
                    self.flashMessage("Saved " + url.path.replacingOccurrences(of: NSHomeDirectory(), with: "~"))
                } catch {
                    self.flashMessage("Couldn't save the note: \(error.localizedDescription)")
                }
            }
        }
    }

    // ~/Downloads/<name>.md, or <name> (2).md and so on when taken (Service.qml's saveMarkdown).
    static func saveMarkdown(_ text: String, named name: String, in folder: URL? = nil) throws -> URL {
        let dir = folder ?? FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Downloads")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var url = dir.appendingPathComponent("\(name).md")
        var i = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = dir.appendingPathComponent("\(name) (\(i)).md")
            i += 1
        }
        try Data(text.utf8).write(to: url, options: .withoutOverwriting)
        return url
    }

    // z, or Shift+Enter, on a note: it, in Zotero's note editor.
    func openNoteInZotero() {
        guard let target = selectedNoteTarget() else { return }
        openNoteInZotero(target)
    }

    func openNoteInZotero(_ target: [String: Any]) {
        dismiss()
        bridge.post("/open", ["key": target["key"] ?? "", "libraryID": target["libraryID"] ?? 1], timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                switch result {
                case .ok: self?.desktop.activateZotero()
                case .zoteroDown, .noHandshake: self?.desktop.launchZotero()
                default: self?.notify("Couldn't open the note", result.message)
                }
            }
        }
    }

    // Space on a paper in the results (or one of its notes): its notes under it, or hidden again.
    func toggleNotes() -> Bool {
        guard store.inSearch, case .search(let rows) = content, rows.indices.contains(store.selectedIndex) else { return false }
        var i = store.selectedIndex
        while i > 0 && rows[i].kind == "note-child" { i -= 1 }
        let r = rows[i]
        guard r.kind == "item", !["note", "attachment"].contains(r.itemType) else { return false }
        let id = "\(r.libraryID):\(r.key)"
        if expandedNotes[id] != nil {
            expandedNotes[id] = nil
            store.followTop = false
            store.selectedIndex = i // the paper keeps the cursor
            rebuildSearch()
            return true
        }
        if r.noteCount == 0 { flashMessage("No notes on this paper"); return true }
        bridge.post("/item", ["key": r.key, "libraryID": r.libraryID], timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self else { return }
                guard case .ok(let answer) = result else { return self.flashMessage("Couldn't list its notes: \(result.message)") }
                let order = (self.prefs?.values["noteOrder"] as? [String: Any])?[id] as? [String] ?? []
                self.expandedNotes[id] = self.notes(of: answer, order: order)
                self.store.followTop = false
                if self.store.inSearch { self.rebuildSearch() }
            }
        }
        return true
    }

    // Shift+↑/↓ on a note in a paper's menu or its notes: among the notes, kept per paper.
    func moveNote(_ delta: Int) {
        let rows = listRows, i = store.selectedIndex
        guard rows.indices.contains(i), rows.indices.contains(i + delta), rows[i].rowId == "note", rows[i + delta].rowId == "note",
              let item = actionItem, var prefs else { return }
        var keys = rows.filter { $0.rowId == "note" }.map(\.noteKey)
        guard let a = keys.firstIndex(of: rows[i].noteKey), let b = keys.firstIndex(of: rows[i + delta].noteKey) else { return }
        keys.swapAt(a, b)
        let key = rows[i].noteKey
        saved {
            prefs.reload()
            var all = prefs.values["noteOrder"] as? [String: Any] ?? [:]
            all[item.id] = keys
            try prefs.set("noteOrder", all)
            self.prefs = prefs
        }
        store.followTop = false
        rebuildList()
        selectRow { $0.rowId == "note" && $0.noteKey == key }
    }

    // Ctrl+-/+ the notes' text size (kept for every note, here and in note windows), Ctrl+0 the theme's.
    func stepNoteFont(_ step: Int) {
        guard var prefs else { return }
        let size = noteTextSize
        let next = step == 0 ? 0 : max(8, min(40, size + step))
        saved {
            try prefs.set("noteFontSize", next == Self.themeNoteSize ? 0 : next)
            self.prefs = prefs
        }
        flashMessage("Text \(noteTextSize) px")
        objectWillChange.send()
    }

    static let themeNoteSize = 15
    var noteTextSize: Int { (prefs?.noteFontSize).flatMap { $0 == 0 ? nil : $0 } ?? Self.themeNoteSize }

    // The reader's keys (ZoteroSearch.qml:4713 handleNoteKey). → taken (the rest is swallowed too).
    func noteKey(_ e: KeyEvent) {
        let c: Character? = { if case .character(let c) = e.key { return c } else { return nil } }()
        if e.option && !e.control && (e.key == .left || e.key == .right) {
            let delta = e.key == .left ? -1 : 1
            if !(e.shift ? cycleDefaultTask(delta) : cyclePaperStatus(delta)) { flashMessage("This note isn't on a paper") }
            return
        }
        if e.control || e.command, let c, ["-", "+", "=", "0"].contains(c) { return stepNoteFont(c == "-" ? -1 : c == "0" ? 0 : 1) }
        if e.command { return }
        switch (e.key, c) {
        case (.up, _) where e.shift: cycleNote(-1)
        case (.down, _) where e.shift: cycleNote(1)
        case (.backspace, _), (.left, _), (.backtab, _), (_, "h"): back()
        case (.enter, _) where e.shift: openNoteInZotero()
        case (_, "z"): openNoteInZotero()
        case (.delete, _) where !e.shift && !e.option && !e.control: askDeleteNote(note.target)
        case (_, "y"): exportNote("copy")
        case (_, "s"): exportNote("save")
        case (_, "i"), (_, "r"): copyCite(c == "i" ? "citation" : "bibliography")
        case (_, "w"): openNoteWindow()
        case (_, "p") where e.option: if let item = actionItem { togglePin(item.json.merging(["type": "item"]) { a, _ in a }) }
        case (.up, _), (_, "k"): noteDisplay?.scroll(by: -3)
        case (.down, _), (_, "j"): noteDisplay?.scroll(by: 3)
        case (.pageUp, _), (_, "b"): noteDisplay?.scrollPage(-1)
        case (_, " ") where e.shift: noteDisplay?.scrollPage(-1)
        case (.pageDown, _), (_, " "): noteDisplay?.scrollPage(1)
        case (.home, _), (_, "g") where !e.shift: noteDisplay?.scrollToTop()
        case (.end, _), (_, "g"): noteDisplay?.scrollToEnd()
        case (_, "?"): openKeys()
        case (_, ";"): openSettings("")
        case (_, "t"), (_, "a"): addTodoKey() // a task about this note
        case (_, "c"): // its paper's chat: the note's own parent (the menu left behind may be another paper's)
            if let p = note.data?["parent"] as? [String: Any], let key = p["key"] as? String, !["note", "attachment"].contains(p["itemType"] as? String ?? "") {
                openChatWindow(PaperRef(key: key, libraryID: p["libraryID"] as? Int ?? 1, title: p["title"] as? String ?? "", itemType: ""))
            } else if note.data == nil, let item = actionItem, !["note", "attachment"].contains(item.itemType) { openChatWindow(item) }
            else { flashMessage("This note isn't on a paper: nothing to chat about") }
        case (_, "."): openTasks()
        default: break
        }
    }

    // A note's HTML for the reader: its title block out (shown above it), Views.noteHtml's styles,
    // colors the page's own (light and dark).
    func noteBody(_ html: String, title: String) -> String {
        guard let core else { return "" }
        let parts = (try? core.glueJSON("noteParts", [html, title])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any]
        let looks: [String: Any] = ["size": noteTextSize, "color": "CanvasText", "accent": Self.accentHex, "dim": "GrayText"]
        return (try? core.glue("noteHtml", [parts?["html"] as? String ?? html, looks], as: String.self)) ?? ""
    }

    var noteBodyHTML: String {
        guard let html = note.data?["html"] as? String else { return "" }
        return noteBody(html, title: note.data?["title"] as? String ?? "")
    }

    // A link in a note: its app (the browser, Zotero); the launcher closes.
    func openLink(_ url: URL) {
        dismiss()
        _ = desktop.open(url: url)
    }

    // w: the note in its own window (focused if it is open already); the launcher closes.
    func openNoteWindow() {
        guard let target = selectedNoteTarget() else { return }
        dismiss()
        openWindow(target)
    }
}
