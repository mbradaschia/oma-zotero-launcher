import AppKit
import Combine
import Foundation

// One paper's chat in its own window (reference/ChatWindow.qml): the runner's `chat`, a turn at a time,
// streamed; its past chats and artifacts; the source it reads, its model and effort; the outputs. The
// pure parts (the events, the lines under answers, the page, the transcript) are GlueChat.js's.
@MainActor
final class ChatWindowModel: ObservableObject {
    unowned let launcher: LauncherModel
    @Published private(set) var item: PaperRef
    @Published var paper: [String: Any]? // the bridge's paper info: title, authors, year
    @Published var savedText: [String: Any]? // its extracted-text note, or nil
    @Published private(set) var state: [String: Any] = ChatWindowModel.freshState() // GlueChat's chat state
    @Published var sessions: [[String: Any]] = [] // this paper's past chats, newest first
    @Published var draft = ""
    @Published var flash = ""
    @Published var busy = false
    @Published var extracting = false
    @Published var groundSource = "note" // what a new chat reads: "note" (the .md note) or "pdf"
    @Published var effort: String
    @Published var showSidebar = false
    @Published var showKeys = false
    @Published var renaming = "" // the past chat being renamed
    @Published private(set) var page = "" // the conversation, as the web view's body
    var artifactViews: [String: String] = [:] // id → view, from this window's answers (before the list is read again)
    var close: () -> Void = {}
    var onDone: () -> Void = {}
    var focusInput: () -> Void = {} // (ChatInput's)
    private var turn: RunnerStream?
    private var turnId = 0 // the turn a line belongs to: a late one of an ended turn is dropped
    private var resumable = "" // the session id a turn started from ("" a new chat): kept unless the runner saved one (done)
    private var gotDone = false
    private var loading = 0 // a past chat being read (its token): a turn waits for it, and an old answer is dropped
    private var launcherSink: AnyCancellable?
    private var saving = false
    private var flashTimer: Timer?
    private var renderTimer: Timer?
    private var renderDue = false

    init(item: PaperRef, launcher: LauncherModel, session: String = "") {
        self.item = item
        self.launcher = launcher
        effort = (launcher.defaultsRaw["chat"] as? [String: Any])?["effort"] as? String ?? "high"
        render()
        loadPaper()
        refreshSessions()
        if !session.isEmpty { openSession(session) }
        if launcher.runnerState.models == nil { launcher.refreshModels() }
        if launcher.ai.prompts == nil { launcher.refreshPrompts() }
        // the launcher's lists (artifacts, prompts, models) as they change, at most twice a second
        launcherSink = launcher.objectWillChange.throttle(for: .milliseconds(500), scheduler: RunLoop.main, latest: true)
            .sink { [weak self] _ in self?.objectWillChange.send() }
    }

    static func freshState() -> [String: Any] {
        ["messages": [[String: Any]](), "sessionId": "", "grounding": "", "model": "default", "contextUsed": 0, "contextWindow": 0, "statusText": "", "pendingQuotes": NSNull()]
    }

    // ---- what the view shows

    var messages: [[String: Any]] { state["messages"] as? [[String: Any]] ?? [] }
    var sessionId: String { state["sessionId"] as? String ?? "" }
    var model: String { state["model"] as? String ?? "default" }
    var models: Any { launcher.runnerModels }
    var cite: String { (paper.flatMap { (try? launcher.core?.glue("paperCite", [$0], as: String.self)) }).flatMap { $0.isEmpty ? nil : $0 } ?? item.title }
    var paperTitle: String { paper?["title"] as? String ?? item.title }
    // The top bar: the cite, and the title once Zotero says it (not "Title · Title" meanwhile).
    var paperLine: String { paper?["title"] is String ? cite + " · " + paperTitle : cite }
    var windowTitle: String { "Chat · " + cite }
    var chatDefault: String { (launcher.runnerState.models?["defaults"] as? [String: Any])?["chat"] as? String ?? "" }

    var artifacts: [[String: Any]] { launcher.artifacts(of: item) }

    var infoLine: (text: String, high: Bool) {
        var o = state
        o["effort"] = effort
        let out = (try? launcher.core?.glueJSON("chatInfoLine", [o, models, chatDefault])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any]
        return (out?["text"] as? String ?? "", out?["high"] as? Bool ?? false)
    }

    var groundingNote: String { state["grounding"] as? String ?? "" }

    var modelMenu: [String: Any] {
        (try? launcher.core?.glueJSON("modelMenu", [models, model, effort, chatDefault])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any] ?? [:]
    }

    var modelButton: String {
        let label = (try? launcher.core?.glue("modelLabel", [models, model, chatDefault], as: String.self)) ?? model
        return label + " · " + (effort.isEmpty ? "default" : effort)
    }

    // ---- the page (re-rendered at most every 150 ms while an answer streams in)

    private func render() {
        let status = state["statusText"] as? String ?? ""
        page = (try? launcher.core?.glue("chatHtml", [messages, ["cite": cite, "status": status]], as: String.self)) ?? ""
    }

    private func renderSoon() {
        renderDue = true
        guard renderTimer == nil else { return }
        renderTimer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.renderTimer = nil
                if self.renderDue { self.renderDue = false; self.render() }
            }
        }
    }

    private func setState(_ next: [String: Any], now: Bool = true) {
        state = next
        if now { render() } else { renderSoon() }
    }

    func showFlash(_ text: String) {
        flash = text
        flashTimer?.invalidate()
        flashTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: false) { [weak self] _ in MainActor.assumeIsolated { self?.flash = "" } }
    }

    // ---- the paper

    private var itemArgs: [String] { ["--key", item.key, "--library", String(item.libraryID == 0 ? 1 : item.libraryID)] }

    func loadPaper() {
        launcher.bridge.post("/item", ["key": item.key, "libraryID": item.libraryID == 0 ? 1 : item.libraryID], timeout: 8) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self, case .ok(let d) = result else { return }
                self.paper = d["paper"] as? [String: Any]
                self.savedText = (try? self.launcher.core?.glueJSON("fulltextNote", [d])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any]
                if self.sessionId.isEmpty { self.setGrounding() }
                self.render()
                // Settings › Defaults › Extract the text first: as the window opens (the runner would at the first question)
                let hasPdf = (try? self.launcher.core?.glue("hasPdf", [d], as: Bool.self)) ?? false
                if self.launcher.defaultOn("autoExtract") && self.savedText == nil && hasPdf {
                    self.showFlash("Extracting the text first (Settings › Defaults)…")
                    self.extract()
                }
            }
        }
    }

    func setGrounding() {
        if savedText == nil { groundSource = "pdf" }
        var s = state
        s["grounding"] = groundSource == "note" && savedText != nil ? "the extracted text (.md note), page by page" : "the PDF, read when you ask"
        state = s
    }

    // Ground new chats in the .md note or the PDF; a chat in progress keeps its source, so switching starts a new one.
    func setSource(_ src: String) {
        guard src != groundSource, !busy else { return }
        if src == "note" && savedText == nil { return showFlash("Extract the text first") }
        groundSource = src
        if !messages.isEmpty {
            newChat()
            showFlash("A new chat, grounded in " + (src == "note" ? "the extracted text" : "the PDF"))
        }
        setGrounding()
    }

    func extract() {
        guard !extracting else { return }
        extracting = true
        showFlash("Extracting the text…")
        launcher.runRunner(["extract", "--json"] + itemArgs, timeout: 3600) { [weak self] r in
            guard let self else { return }
            self.extracting = false
            guard r.ok, let j = r.json as? [String: Any] else { return self.showFlash("Couldn't extract: " + r.problem) }
            self.savedText = ["key": j["note"] ?? "", "title": ""]
            if self.sessionId.isEmpty { self.groundSource = "note"; self.setGrounding() }
            self.showFlash(j["status"] as? String == "exists" ? "The text was already extracted"
                : "Extracted \(j["pages"] ?? 0) pages (p. \(j["first"] ?? "")–\(j["last"] ?? "")): new chats use it")
        }
    }

    // ---- sessions

    func refreshSessions() {
        launcher.runRunner(["chats"] + itemArgs, timeout: 30) { [weak self] r in
            self?.sessions = (r.json as? [String: Any])?["chats"] as? [[String: Any]] ?? []
        }
    }

    func openSession(_ id: String) {
        guard !busy else { return }
        loading += 1
        let token = loading
        launcher.runRunner(["chat-show", "--session", id] + itemArgs, timeout: 30) { [weak self] r in
            guard let self, token == self.loading, !self.busy else { return } // a later click, or a turn started meanwhile
            defer { self.loading = 0 }
            guard r.ok, let s = r.json as? [String: Any] else { return self.showFlash("Couldn't open that chat: " + r.problem) }
            var next = Self.freshState()
            next["messages"] = (try? self.launcher.core?.glueJSON("sessionMessages", [s, self.models])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } ?? []
            next["sessionId"] = s["id"] ?? ""
            let ctx = s["context"] as? [String: Any]
            next["contextUsed"] = ctx?["used"] ?? 0
            next["contextWindow"] = ctx?["window"] ?? 0
            if let m = s["model"] as? String, !m.isEmpty { next["model"] = m }
            if let e = s["effort"] as? String { self.effort = e }
            if let g = s["grounding"] as? [String: Any] {
                next["grounding"] = g["label"] ?? ""
                self.groundSource = g["source"] as? String == "note" ? "note" : "pdf"
            }
            self.setState(next)
        }
    }

    func newChat() {
        guard !busy else { return }
        var next = Self.freshState()
        next["grounding"] = state["grounding"] ?? ""
        effort = (launcher.defaultsRaw["chat"] as? [String: Any])?["effort"] as? String ?? "high"
        setState(next)
        setGrounding()
        focusInput()
    }

    func renameSession(_ id: String, _ title: String) {
        renaming = ""
        let t = title.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        launcher.runRunner(["chat-rename", "--session", id, "--title", t] + itemArgs, timeout: 30) { [weak self] r in
            guard let self else { return }
            if !r.ok { self.showFlash("Couldn't rename it: " + r.problem) }
            self.refreshSessions()
            self.launcher.refreshChats()
        }
    }

    // ---- a turn

    func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !busy, let core = launcher.core else { return }
        guard loading == 0 else { return showFlash("Opening the chat: a moment") }
        var s = state
        var ms = messages
        ms.append(["role": "user", "text": text, "pending": false, "failed": false, "info": ""])
        ms.append(["role": "assistant", "text": "", "pending": true, "failed": false, "info": ""])
        s["messages"] = ms
        setState(s)
        draft = ""
        busy = true
        var o = state
        o["effort"] = effort
        o["source"] = groundSource
        let args = (try? core.glue("chatArgs", [["key": item.key, "libraryID": item.libraryID == 0 ? 1 : item.libraryID], o], as: [String].self)) ?? []
        turnId += 1
        let id = turnId
        resumable = sessionId
        gotDone = false
        turn = launcher.runner.stream(launcher.runnerArgv(args), stdin: text, onLine: { [weak self] line in
            guard let self, id == self.turnId else { return }
            self.event(line)
        }, completion: { [weak self] r in
            guard let self, id == self.turnId else { return }
            self.turnEnded(r)
        })
        if !busy { turn = nil } // (ended already)
    }

    private func event(_ line: String) {
        // a delta, the most frequent: appended here (not the whole chat through JavaScriptCore each time)
        let ev = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any]
        if let ev, ev["type"] as? String == "delta" {
            var s = state
            var ms = messages
            guard var last = ms.popLast(), last["pending"] as? Bool == true else { return }
            last["text"] = (last["text"] as? String ?? "") + (ev["text"] as? String ?? "")
            ms.append(last)
            s["messages"] = ms
            s["statusText"] = ""
            return setState(s, now: false)
        }
        if ev?["type"] as? String == "done" { gotDone = true }
        guard let core = launcher.core,
              let out = (try? core.glueJSON("chatEvent", [state, line, models])).flatMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }) as? [String: Any],
              let next = out["state"] as? [String: Any] else { return }
        let done = (next["messages"] as? [[String: Any]])?.last?["pending"] as? Bool == false
        setState(next, now: done)
        if let flash = out["flash"] as? String, !flash.isEmpty { showFlash(flash) }
        if let a = out["artifact"] as? [String: Any], let id = a["id"] as? String {
            artifactViews[id] = a["view"] as? String ?? ""
            showSidebar = true
            launcher.refreshArtifacts()
        }
    }

    private func turnEnded(_ r: RunnerResult) {
        busy = false
        turn = nil
        let last = r.stderr.split(whereSeparator: \.isNewline).last.map { String($0).replacingOccurrences(of: "oma-zotero-prompt: ", with: "") } ?? (r.missing ? "the AI features aren't installed (Settings › Setup)" : "")
        if let next = (try? launcher.core?.glueJSON("turnEnded", [state, last])).flatMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }) as? [String: Any] {
            // the runner saves a chat only when its answer is done: a turn that failed or was stopped leaves the chat as
            // it was (the session it started from, or none: the next question starts a new chat)
            var s = next
            if !gotDone { s["sessionId"] = resumable }
            setState(s)
        }
        refreshSessions()
        launcher.refreshChats()
    }

    func stop() { turn?.stop() }

    // ---- the box

    func usePrompt(_ p: [String: Any]) {
        let text = (p["body"] as? String ?? p["excerpt"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let had = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = had.isEmpty ? text : had + "\n\n" + text
        focusInput()
        showFlash("“\(p["title"] as? String ?? "")” is in the question box: edit it, or press Enter")
    }

    func pickModel(_ spec: String) {
        var s = state
        s["model"] = spec
        state = s
        effort = (try? launcher.core?.glue("effortFor", [models, spec, effort], as: String.self)).flatMap { $0.isEmpty ? nil : $0 } ?? effort
    }

    func askToChange(_ a: [String: Any]) {
        draft = "Change the “\(a["title"] as? String ?? "")” " + (a["formatLabel"] as? String ?? "artifact").lowercased() + ": "
        focusInput()
    }

    func openArtifact(_ id: String) {
        let view = artifacts.first { $0["id"] as? String == id }?["view"] as? String ?? artifactViews[id] ?? ""
        if view.isEmpty || !launcher.desktop.open(path: view) { showFlash("That artifact isn't there any more") }
    }

    // ---- outputs

    private func question(before index: Int) -> String {
        (try? launcher.core?.glue("questionBefore", [messages, index], as: String.self)) ?? ""
    }

    private func titleFor(_ index: Int) -> String {
        "Chat: " + ((try? launcher.core?.glue("chatTitle", [question(before: index)], as: String.self)) ?? "chat")
    }

    var transcript: String {
        let title = sessions.first { $0["id"] as? String == sessionId }?["title"] as? String ?? item.title
        return (try? launcher.core?.glue("transcript", [messages, ["title": title, "cite": cite, "paperTitle": paper?["title"] ?? "", "models": models]], as: String.self)) ?? ""
    }

    func copy(_ text: String) { showFlash(launcher.desktop.copy(text) ? "Copied as Markdown" : "Couldn't copy") }

    func download(_ name: String, _ text: String) {
        let file = (try? launcher.core?.glue("fileName", [name], as: String.self)) ?? "chat"
        do {
            let url = try LauncherModel.saveMarkdown(text, named: file)
            showFlash("Saved " + url.path.replacingOccurrences(of: NSHomeDirectory(), with: "~"))
        } catch {
            showFlash("Couldn't save: \(error.localizedDescription)")
        }
    }

    func saveToZotero(_ title: String, _ text: String) {
        guard !saving else { return showFlash("Still saving the last note") }
        saving = true
        showFlash("Saving to Zotero…")
        // (no --tag: the runner's flag takes no value, so `--tag oma-chat` tagged the note "true"; its default is oma-chat)
        launcher.runRunner(["note", "--title", title] + itemArgs, stdin: text, timeout: 120) { [weak self] r in
            guard let self else { return }
            self.saving = false
            self.showFlash(r.ok ? "Saved to Zotero as a note on the paper" : "Couldn't save to Zotero: " + r.problem)
        }
    }

    // The whole chat's name: its title, else its first question (the QML's questionBefore(1)).
    private var chatName: String {
        if let t = sessions.first(where: { $0["id"] as? String == sessionId })?["title"] as? String, !t.isEmpty { return t }
        return (try? launcher.core?.glue("chatTitle", [question(before: 1)], as: String.self)) ?? "chat"
    }

    func copyChat() { copy(transcript) }
    func saveChat() { saveToZotero("Chat: " + chatName, transcript) }
    func downloadChat() { download("Chat · " + cite + " · " + chatName, transcript) }

    // The chat deleted in the launcher: this window, if it was on it, starts anew.
    func chatDeleted(_ id: String) {
        guard !id.isEmpty, id == sessionId else { return refreshSessions() }
        stop()
        busy = false
        newChat()
        refreshSessions()
        showFlash("This chat was deleted: a new one starts here")
    }

    // An answer's own link (oma-answer:<verb>/<index>): Copy, Save to Zotero, Download.
    func answerLink(_ verb: String, _ index: Int) {
        guard messages.indices.contains(index), let text = messages[index]["text"] as? String else { return }
        switch verb {
        case "copy": copy(text)
        case "save": saveToZotero(titleFor(index), text)
        case "download": download("Chat · " + cite + " · " + ((try? launcher.core?.glue("chatTitle", [question(before: index)], as: String.self)) ?? "chat"), text)
        default: break
        }
    }

    func link(_ url: URL) {
        switch (url.scheme ?? "").lowercased() {
        case "oma-answer":
            let parts = url.absoluteString.dropFirst("oma-answer:".count).split(separator: "/") // (only the app's own: GlueChat drops the model's)
            if parts.count == 2, let i = Int(parts[1]) { answerLink(String(parts[0]), i) }
        case "oma-artifact": openArtifact(String(url.absoluteString.dropFirst("oma-artifact:".count)))
        case "http", "https", "mailto": _ = launcher.desktop.open(url: url)
        default: break
        }
    }

    // Menu (⌥M): the launcher, on the paper's menu, its chat row highlighted.
    func backToMenu() {
        launcher.showMenuFor?(item, ["rowId": "chat"])
    }

    // About another paper…: the launcher's pick.
    func chatAboutAnotherPaper() {
        launcher.showLauncher?()
        launcher.pickPaperForChat()
    }

    // ---- keys: Glue's windowKeys("chat-window"), shown by WindowKeys

    // esc: the keys hidden, else a running answer stopped (never the window closed).
    func escape() {
        if showKeys { showKeys = false } else if busy { stop() }
    }

    // The window's own keys (its local monitor). → taken
    func windowKey(_ e: NSEvent) -> Bool {
        let flags = e.modifierFlags.intersection([.command, .option, .control, .shift]) // (Caps Lock aside)
        let chars = (e.charactersIgnoringModifiers ?? "").lowercased()
        let inBox = e.window?.firstResponder is NSText // the box, a rename field: their own keys
        if flags == .command && chars == "w" { close(); return true }
        if flags == .option && e.keyCode == 46 { backToMenu(); return true } // ⌥M
        if e.keyCode == 122 { showKeys.toggle(); return true } // F1
        if !inBox && chars == "?" { showKeys.toggle(); return true }
        if !inBox && e.keyCode == 53 { escape(); return true }
        return false
    }

    func windowClosing() {
        stop()
        onDone()
    }
}
