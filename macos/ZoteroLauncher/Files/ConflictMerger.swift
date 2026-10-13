import Darwin
import Foundation

// The sync folder's conflict copies, merged into their files (contracts/Merge.js, the same bytes
// the Omarchy launcher writes): each copy merged and written over its file atomically (a
// "newer wins" file keeps the other beside it, <name>.conflict-<device>.<ext>), and only then the
// copy deleted. A copy Merge.js doesn't recognise, or one it can't read, is left alone.
// The folder comes from another machine: only regular files are read or written, never through a
// link (a "copy" linking to ~/.ssh/id_rsa would otherwise be merged into a synced file and sent
// away; a folder linking to ~/.config would take what's merged), nothing outside the folder,
// nothing larger than 20 MB. Each copy's folder is opened once and checked by its descriptor
// (SafeFolder), and the files in it reached by name from there.
enum ConflictMerger {
    struct Outcome: Equatable {
        var merged: [String] = [] // the files merged into (paths)
        var problems: [String] = []
    }

    static let maxBytes = 20 * 1024 * 1024
    static let keys: Set<URLResourceKey> = [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]

    // `machine`: this machine's name, for a kept copy that was this machine's file.
    static func run(_ core: JSCore, in folder: URL, machine: String = "this machine", now: Date = Date()) -> Outcome {
        var out = Outcome()
        guard let root = SafeFolder.realPath(folder.path),
              let walker = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: Array(keys), options: [.skipsPackageDescendants])
        else { return out }
        var copies: [URL] = []
        for case let url as URL in walker {
            let name = url.lastPathComponent
            let isCopy = (name.contains(".sync-conflict-") || name.contains("'s conflicted copy")) && !name.hasSuffix(".tmp")
            let v = try? url.resourceValues(forKeys: keys)
            if v?.isSymbolicLink == true { // a link: never followed, a linked folder not walked
                walker.skipDescendants()
                if isCopy { out.problems.append("not a plain file: \(name)") }
                continue
            }
            guard isCopy else { continue }
            guard v?.isRegularFile == true, (v?.fileSize ?? 0) <= maxBytes else { out.problems.append("not a plain file: \(name)"); continue }
            copies.append(url)
        }
        let nowMs = now.timeIntervalSince1970 * 1000
        for copy in copies.sorted(by: { $0.path < $1.path }) {
            let name = copy.lastPathComponent
            guard let info = (try? core.glueJSON("conflictOf", [name])).flatMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }) as? [String: Any],
                  let base = info["base"] as? String
            else { continue }
            guard let dir = SafeFolder.open(copy.deletingLastPathComponent(), under: root) else { out.problems.append("not inside the sync folder: \(name)"); continue }
            guard let theirs = dir.read(name, max: maxBytes) else { out.problems.append("couldn't read \(name)"); continue }
            let there = dir.exists(base)
            // the file missing beside a copy a moment old: the sync tool may be in the middle of its
            // rename; looked at again next time
            if !there && nowMs - modified(dir, name) < 30_000 { continue }
            let mine = there ? dir.read(base, max: maxBytes) : ""
            guard let mine else { out.problems.append("not a plain file: \(base)"); continue }
            do {
                let json = try core.glueJSON("merge", [base, mine, theirs, there ? modified(dir, base) : 0, modified(dir, name), nowMs])
                guard let merged = try JSONSerialization.jsonObject(with: Data(json.utf8), options: .fragmentsAllowed) as? [String: Any],
                      let text = merged["text"] as? String else { continue } // nothing to merge: the copy stays
                // the other side kept first, then the file: a failure leaves the copy, and nothing is lost
                if let kept = merged["kept"] as? String {
                    let whose = merged["keptFrom"] as? String == "a" ? machine : info["device"] as? String ?? "other"
                    try dir.write(kept, to: try core.glue("keptName", [base, whose], as: String.self))
                }
                try dir.write(text, to: base)
                try dir.remove(name)
                out.merged.append(copy.deletingLastPathComponent().appendingPathComponent(base).path)
            } catch {
                out.problems.append("\(base): \(error.localizedDescription)")
            }
        }
        return out
    }

    // A file's modification time in ms (0 when it isn't there), its link not followed.
    private static func modified(_ dir: SafeFolder, _ name: String) -> Double {
        var st = stat()
        guard fstatat(dir.fd, name, &st, AT_SYMLINK_NOFOLLOW) == 0 else { return 0 }
        return Double(st.st_mtimespec.tv_sec) * 1000 + Double(st.st_mtimespec.tv_nsec) / 1_000_000
    }
}
