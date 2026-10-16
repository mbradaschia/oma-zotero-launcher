import AppKit
import Foundation

// The chat window's outputs (ChatWindowModel.swift is the chat itself): the transcript copied, downloaded or saved to
// Zotero as a note, the links under answers, and the ways back to the launcher.
extension ChatWindowModel {
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
}
