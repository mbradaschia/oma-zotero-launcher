import Foundation

// The sync folder's conflict copies, merged into their files (contracts/Merge.js, the same bytes
// the Omarchy launcher writes): each copy merged and written over its file atomically (a
// "newer wins" file keeps the other beside it, <name>.conflict-<device>.<ext>), and only then the
// copy deleted. A copy Merge.js doesn't recognise, or one it can't read, is left alone.
// The folder comes from another machine: only regular files are read or written, never a link
// (a "copy" linking to ~/.ssh/id_rsa would otherwise be merged into a synced file and sent away),
// nothing outside the folder, nothing larger than 20 MB.
enum ConflictMerger {
    struct Outcome: Equatable {
        var merged: [String] = [] // the files merged into (paths)
        var problems: [String] = []
    }

    static let maxBytes = 20 * 1024 * 1024
    static let keys: Set<URLResourceKey> = [.contentModificationDateKey, .isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]

    // A plain file of a sane size, itself (not through a link), inside `folder`.
    static func plainFile(_ url: URL, in folder: URL) -> Bool {
        guard let v = try? url.resourceValues(forKeys: keys), v.isSymbolicLink != true, v.isRegularFile == true, (v.fileSize ?? 0) <= maxBytes else { return false }
        let root = folder.resolvingSymlinksInPath().standardizedFileURL.path + "/"
        return url.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL.path.appending("/").hasPrefix(root)
    }

    // `machine`: this machine's name, for a kept copy that was this machine's file.
    static func run(_ core: JSCore, in folder: URL, machine: String = "this machine", now: Date = Date()) -> Outcome {
        var out = Outcome()
        let fm = FileManager.default
        guard let walker = fm.enumerator(at: folder, includingPropertiesForKeys: Array(keys), options: [.skipsPackageDescendants]) else { return out }
        var copies: [URL] = []
        for case let url as URL in walker {
            let name = url.lastPathComponent
            let isCopy = (name.contains(".sync-conflict-") || name.contains("'s conflicted copy")) && !name.hasSuffix(".tmp")
            if (try? url.resourceValues(forKeys: [.isSymbolicLinkKey]))?.isSymbolicLink == true { // a link: never followed, a linked folder not walked
                walker.skipDescendants()
                if isCopy { out.problems.append("not a plain file: \(name)") }
                continue
            }
            guard isCopy else { continue }
            guard plainFile(url, in: folder) else { out.problems.append("not a plain file: \(name)"); continue }
            copies.append(url)
        }
        for copy in copies.sorted(by: { $0.path < $1.path }) {
            guard let info = (try? core.glueJSON("conflictOf", [copy.lastPathComponent])).flatMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }) as? [String: Any],
                  let base = info["base"] as? String
            else { continue }
            let file = copy.deletingLastPathComponent().appendingPathComponent(base)
            if fm.fileExists(atPath: file.path) || (try? file.resourceValues(forKeys: [.isSymbolicLinkKey]))?.isSymbolicLink == true {
                guard plainFile(file, in: folder) else { out.problems.append("not a plain file: \(base)"); continue }
            }
            guard let theirs = try? String(contentsOf: copy, encoding: .utf8) else { out.problems.append("couldn't read \(copy.lastPathComponent)"); continue }
            let ms = { (u: URL) -> Double in ((try? u.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000 }
            // the file missing beside a copy a moment old: the sync tool may be in the middle of its
            // rename; looked at again next time
            if !fm.fileExists(atPath: file.path) && now.timeIntervalSince1970 * 1000 - ms(copy) < 30_000 { continue }
            let mine = fm.fileExists(atPath: file.path) ? (try? String(contentsOf: file, encoding: .utf8)) : ""
            guard let mine else { out.problems.append("couldn't read \(base)"); continue }
            do {
                let json = try core.glueJSON("merge", [base, mine, theirs, fm.fileExists(atPath: file.path) ? ms(file) : 0, ms(copy), now.timeIntervalSince1970 * 1000])
                guard let merged = try JSONSerialization.jsonObject(with: Data(json.utf8), options: .fragmentsAllowed) as? [String: Any], let text = merged["text"] as? String else { continue } // nothing to merge: the copy stays
                // the other side kept first, then the file: a failure leaves the copy, and nothing is lost
                if let kept = merged["kept"] as? String {
                    let whose = merged["keptFrom"] as? String == "a" ? machine : info["device"] as? String ?? "other"
                    let name = try core.glue("keptName", [base, whose], as: String.self)
                    let target = file.deletingLastPathComponent().appendingPathComponent(name)
                    guard (try? target.resourceValues(forKeys: [.isSymbolicLinkKey]))?.isSymbolicLink != true else { out.problems.append("not a plain file: \(name)"); continue }
                    try Data(kept.utf8).write(to: target, options: .atomic)
                }
                try Data(text.utf8).write(to: file, options: .atomic)
                try fm.removeItem(at: copy)
                out.merged.append(file.path)
            } catch {
                out.problems.append("\(base): \(error.localizedDescription)")
            }
        }
        return out
    }
}
