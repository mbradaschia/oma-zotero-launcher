import Foundation

// Tag renames and deletes Zotero didn't get (closed, or not answering): kept on this Mac (pending-tags.json beside
// extract.json, never synced) and sent again when it answers, after a restart too. Until then a rename's old tag, or a
// removed status's, isn't read back as a status. And the tasks' t/ tag changes made while Zotero was away, sent then.
struct PendingTagOp: Codable, Equatable {
    var op: String // "rename" or "delete"
    var from: String
    var to = ""
}

extension LauncherModel {
    private var pendingTagsURL: URL? {
        paths.map { URL(fileURLWithPath: $0.extract).deletingLastPathComponent().appendingPathComponent("pending-tags.json") }
    }

    var pendingTagOps: [PendingTagOp] {
        get {
            guard let url = pendingTagsURL, let data = try? Data(contentsOf: url) else { return [] }
            return (try? JSONDecoder().decode([PendingTagOp].self, from: data)) ?? []
        }
        set {
            guard let url = pendingTagsURL else { return }
            if newValue.isEmpty { try? FileManager.default.removeItem(at: url); return }
            do {
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try JSONEncoder().encode(newValue).write(to: url, options: .atomic)
            } catch {
                NSLog("ZoteroLauncher: couldn't keep the tag changes for later: %@", String(describing: error))
            }
        }
    }

    // Kept for later. A rename of a pending rename's new name is one rename from the first name (a→b, b→c: a→c); a
    // delete of it deletes the first name.
    func queueTagOp(_ op: PendingTagOp) {
        var ops = pendingTagOps
        if let i = ops.firstIndex(where: { $0.op == "rename" && $0.to.lowercased() == op.from.lowercased() }) {
            ops[i] = op.op == "rename" ? PendingTagOp(op: "rename", from: ops[i].from, to: op.to) : PendingTagOp(op: "delete", from: ops[i].from)
        } else if !ops.contains(op) {
            ops.append(op)
        }
        pendingTagOps = ops
    }

    // A tag waiting to be renamed or deleted: not a status to bring back.
    func tagIsGoing(_ tag: String) -> Bool {
        let t = tag.lowercased()
        return pendingTagOps.contains { $0.from.lowercased() == t }
    }

    static func zoteroAway(_ result: BridgeResult) -> Bool {
        switch result {
        case .noHandshake, .zoteroDown, .bridgeMissing, .timeout: return true
        default: return false
        }
    }

    // A rename or delete sent; Zotero away: kept for later (said unless `quiet`). → done with Zotero's answer, nil
    // when it didn't happen (kept, or refused).
    func sendTagOp(_ op: PendingTagOp, quiet: Bool = false, done: (([String: Any]?) -> Void)? = nil) {
        let route = op.op == "rename" ? "/tags/rename" : "/tags/delete"
        let body: [String: Any] = op.op == "rename" ? ["from": op.from, "to": op.to] : ["name": op.from]
        bridge.post(route, body, timeout: 30) { [weak self] result in
            MainActor.assumeIsolated {
                guard let self else { return }
                switch result {
                case .ok(let answer):
                    self.pendingTagOps = self.pendingTagOps.filter { $0 != op }
                    self.tags.cache = [:]
                    self.libraryChanged = true
                    // the paper in view carried it, perhaps: its tags (its status, its pills) as Zotero has them now
                    if self.opened, self.details != nil { self.refreshDetails() }
                    done?(answer)
                case let r where Self.zoteroAway(r):
                    self.queueTagOp(op)
                    if !quiet { self.flashMessage("Zotero isn't answering: “\(op.from)” is \(op.op == "rename" ? "renamed" : "deleted") once it is") }
                    done?(nil)
                default:
                    if !quiet { self.flashMessage("Couldn't \(op.op) “\(op.from)”: \(result.message)") }
                    else { NSLog("ZoteroLauncher: couldn't %@ %@: %@", op.op, op.from, result.message) }
                    done?(nil)
                }
            }
        }
    }

    // Zotero answers again: what it missed. The renames and deletes, the tasks' tag changes, then every paper's t/ tags
    // from scratch (a task another machine changed meanwhile too).
    func catchUpTags() {
        for op in pendingTagOps { sendTagOp(op, quiet: true) }
        let missed = tasks.missedTaskTags
        tasks.missedTaskTags = []
        applyTaskTags(missed)
        syncTaskTags()
    }
}
