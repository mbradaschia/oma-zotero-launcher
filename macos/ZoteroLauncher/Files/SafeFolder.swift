import Darwin
import Foundation

// A folder inside the sync folder, opened once and checked by its descriptor (F_GETPATH: the folder
// actually opened, not what its path names a moment later); everything in it is then reached by
// name from that descriptor (openat, renameat, unlinkat). A folder or a file swapped for a link
// meanwhile is never followed. The sync folder comes from another machine: nothing in it is trusted.
final class SafeFolder {
    let fd: Int32

    private init(fd: Int32) {
        self.fd = fd
    }

    deinit { close(fd) }

    // A path with every link resolved (as F_GETPATH reports them: /private/var, not /var).
    static func realPath(_ path: String) -> String? {
        guard let p = realpath(path, nil) else { return nil }
        defer { free(p) }
        return String(cString: p)
    }

    // `folder`, if what opens is `root` (a real path) or under it.
    static func open(_ folder: URL, under root: String) -> SafeFolder? {
        let fd = Darwin.open(folder.path, O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard fd >= 0 else { return nil }
        var buf = [CChar](repeating: 0, count: Int(MAXPATHLEN))
        guard fcntl(fd, F_GETPATH, &buf) != -1 else {
            close(fd)
            return nil
        }
        let path = String(cString: buf)
        guard path == root || path.hasPrefix(root + "/") else {
            close(fd)
            return nil
        }
        return SafeFolder(fd: fd)
    }

    static func plainName(_ name: String) -> Bool {
        !name.isEmpty && name != "." && name != ".." && !name.contains("/")
    }

    // Something by that name (a link counts; it isn't followed).
    func exists(_ name: String) -> Bool {
        var st = stat()
        return Self.plainName(name) && fstatat(fd, name, &st, AT_SYMLINK_NOFOLLOW) == 0
    }

    // The file's text, when it is a regular file (not a link) of at most `max` bytes.
    func read(_ name: String, max: Int) -> String? {
        guard Self.plainName(name) else { return nil }
        let f = openat(fd, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard f >= 0 else { return nil }
        let handle = FileHandle(fileDescriptor: f, closeOnDealloc: true)
        var st = stat()
        guard fstat(f, &st) == 0, st.st_mode & S_IFMT == S_IFREG, st.st_size <= max,
              let data = try? handle.readToEnd() ?? Data(), data.count <= max else { return nil }
        return String(data: data, encoding: .utf8)
    }

    // Written whole: a new file beside it, renamed over it (a link there is replaced, not followed).
    func write(_ text: String, to name: String) throws {
        guard Self.plainName(name) else { throw POSIXError(.EINVAL) }
        let tmp = ".oma-zotero-merge.\(UUID().uuidString)"
        let f = openat(fd, tmp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o644)
        guard f >= 0 else { throw Self.lastError() }
        let handle = FileHandle(fileDescriptor: f, closeOnDealloc: true)
        do {
            try handle.write(contentsOf: Data(text.utf8))
            try handle.synchronize()
        } catch {
            unlinkat(fd, tmp, 0)
            throw error
        }
        guard renameat(fd, tmp, fd, name) == 0 else {
            let e = Self.lastError()
            unlinkat(fd, tmp, 0)
            throw e
        }
    }

    func remove(_ name: String) throws {
        guard Self.plainName(name) else { throw POSIXError(.EINVAL) }
        guard unlinkat(fd, name, 0) == 0 else { throw Self.lastError() }
    }

    private static func lastError() -> POSIXError {
        POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
}
