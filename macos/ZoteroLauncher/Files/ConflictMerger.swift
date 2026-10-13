import Foundation

// The sync folder's conflict copies, merged into their files (contracts/Merge.js, the same bytes
// the Omarchy launcher writes): each copy merged and written over its file atomically (a
// "newer wins" file keeps the other beside it, <name>.conflict-<device>.<ext>), and only then the
// copy deleted. A copy Merge.js doesn't recognise, or one it can't read, is left alone.
enum ConflictMerger {
    struct Outcome: Equatable {
        var merged: [String] = [] // the files merged into (paths)
        var problems: [String] = []
    }

    static func run(_ core: JSCore, in folder: URL, now: Date = Date()) -> Outcome {
        var out = Outcome()
        let fm = FileManager.default
        guard let walker = fm.enumerator(at: folder, includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey]) else { return out }
        var copies: [URL] = []
        for case let url as URL in walker {
            let name = url.lastPathComponent
            guard name.contains(".sync-conflict-") || name.contains("'s conflicted copy"), !name.hasSuffix(".tmp") else { continue }
            copies.append(url)
        }
        for copy in copies.sorted(by: { $0.path < $1.path }) {
            guard let info = (try? core.glueJSON("conflictOf", [copy.lastPathComponent])).flatMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }) as? [String: Any],
                  let base = info["base"] as? String
            else { continue }
            let file = copy.deletingLastPathComponent().appendingPathComponent(base)
            guard let theirs = try? String(contentsOf: copy, encoding: .utf8) else { out.problems.append("couldn't read \(copy.lastPathComponent)"); continue }
            let mine = fm.fileExists(atPath: file.path) ? (try? String(contentsOf: file, encoding: .utf8)) : ""
            guard let mine else { out.problems.append("couldn't read \(base)"); continue }
            let ms = { (u: URL) -> Double in ((try? u.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000 }
            do {
                let json = try core.glueJSON("merge", [base, mine, theirs, fm.fileExists(atPath: file.path) ? ms(file) : 0, ms(copy), now.timeIntervalSince1970 * 1000])
                guard let merged = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any], let text = merged["text"] as? String else { continue }
                try Data(text.utf8).write(to: file, options: .atomic)
                if let kept = merged["kept"] as? String {
                    let name = try core.glue("keptName", [base, info["device"] as? String ?? "other"], as: String.self)
                    try Data(kept.utf8).write(to: file.deletingLastPathComponent().appendingPathComponent(name), options: .atomic)
                }
                try fm.removeItem(at: copy)
                out.merged.append(file.path)
            } catch {
                out.problems.append("\(base): \(error.localizedDescription)")
            }
        }
        return out
    }
}
