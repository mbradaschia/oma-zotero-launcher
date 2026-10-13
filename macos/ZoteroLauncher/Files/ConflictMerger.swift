import Foundation

// The sync folder's conflict copies, merged into their files (contracts/Merge.js, the same bytes
// the Omarchy launcher writes): each copy merged and written over its file atomically (a
// "newer wins" file keeps the other beside it, <name>.conflict-<device>.<ext>), and only then the
// copy deleted. A copy Merge.js doesn't recognise, or one it can't read, is left alone.
// The folder comes from another machine: only regular files are read or written, never a link
// (a "copy" linking to ~/.ssh/id_rsa would otherwise be merged into a synced file and sent away),
// nothing outside the folder, nothing larger than 20 MB; each file read through a descriptor that
// refuses a link and written by a rename (a link swapped in meanwhile is replaced, not followed).
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

    // The file's text, read through a descriptor that refuses a link (O_NOFOLLOW) and checked, once
    // open, to be a regular file of a sane size: a link swapped in after the listing gets nothing.
    static func readPlain(_ url: URL) -> String? {
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { return nil }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        var st = stat()
        guard fstat(fd, &st) == 0, st.st_mode & S_IFMT == S_IFREG, st.st_size <= maxBytes,
              let data = try? handle.readToEnd() ?? Data(), data.count <= maxBytes else { return nil }
        return String(data: data, encoding: .utf8)
    }

    // Written whole by a rename in its own folder: a link put there is replaced, never written through.
    static func writePlain(_ text: String, to url: URL) throws {
        let tmp = url.deletingLastPathComponent().appendingPathComponent(".oma-zotero-merge.\(UUID().uuidString)")
        let fd = open(tmp.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o644)
        guard fd >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        do {
            try handle.write(contentsOf: Data(text.utf8))
            try handle.synchronize()
        } catch {
            unlink(tmp.path)
            throw error
        }
        guard rename(tmp.path, url.path) == 0 else {
            let code = POSIXErrorCode(rawValue: errno) ?? .EIO
            unlink(tmp.path)
            throw POSIXError(code)
        }
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
            guard let theirs = readPlain(copy) else { out.problems.append("couldn't read \(copy.lastPathComponent)"); continue }
            let ms = { (u: URL) -> Double in ((try? u.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000 }
            // the file missing beside a copy a moment old: the sync tool may be in the middle of its
            // rename; looked at again next time
            if !fm.fileExists(atPath: file.path) && now.timeIntervalSince1970 * 1000 - ms(copy) < 30_000 { continue }
            let mine = fm.fileExists(atPath: file.path) ? readPlain(file) : ""
            guard let mine else { out.problems.append("couldn't read \(base)"); continue }
            do {
                let json = try core.glueJSON("merge", [base, mine, theirs, fm.fileExists(atPath: file.path) ? ms(file) : 0, ms(copy), now.timeIntervalSince1970 * 1000])
                guard let merged = try JSONSerialization.jsonObject(with: Data(json.utf8), options: .fragmentsAllowed) as? [String: Any], let text = merged["text"] as? String else { continue } // nothing to merge: the copy stays
                // the other side kept first, then the file: a failure leaves the copy, and nothing is lost
                if let kept = merged["kept"] as? String {
                    let whose = merged["keptFrom"] as? String == "a" ? machine : info["device"] as? String ?? "other"
                    let name = try core.glue("keptName", [base, whose], as: String.self)
                    let target = file.deletingLastPathComponent().appendingPathComponent(name)
                    try writePlain(kept, to: target)
                }
                try writePlain(text, to: file)
                try fm.removeItem(at: copy)
                out.merged.append(file.path)
            } catch {
                out.problems.append("\(base): \(error.localizedDescription)")
            }
        }
        return out
    }
}
