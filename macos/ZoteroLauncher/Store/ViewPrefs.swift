import Foundation

// How you arranged things, kept in view.json (contracts/SYNC-FORMAT.md): the notes' text size,
// your order of notes, sections and menu rows, a menu's pins and others, the grouping. Read whole
// and written whole, atomically, as Service.qml does; keys this version doesn't know are kept, for
// the launcher on another machine. A write starts from the file as it is now (the other machine
// may have changed it through the sync folder). Nothing is written while the folder is unavailable.
struct ViewPrefs {
    enum WriteError: Error, Equatable {
        case readOnly
        case notJSON(String) // a value JSON can't hold
    }

    let url: URL
    var readOnly: Bool // Paths.resolve's, as it changes
    private(set) var values: [String: Any]

    // view.json at `url` (Paths.resolve's `view`); missing, unreadable or not an object: empty.
    static func load(_ url: URL, readOnly: Bool) -> ViewPrefs {
        ViewPrefs(url: url, readOnly: readOnly, values: read(url))
    }

    private static func read(_ url: URL) -> [String: Any] {
        (try? Data(contentsOf: url)).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any] ?? [:]
    }

    // The file as it is now (after the sync folder brought another machine's change).
    mutating func reload() {
        values = Self.read(url)
    }

    // The notes' text size, 8 to 40; 0 is the theme's.
    var noteFontSize: Int {
        let n = (values["noteFontSize"] as? NSNumber)?.doubleValue ?? 0
        return n >= 8 && n <= 40 ? Int(n.rounded()) : 0
    }

    // `key` set to `value` (nil removes it), and the file written.
    mutating func set(_ key: String, _ value: Any?) throws {
        guard !readOnly else { throw WriteError.readOnly }
        var next = Self.read(url)
        next[key] = value
        guard JSONSerialization.isValidJSONObject(next) else { throw WriteError.notJSON(key) }
        var data = try JSONSerialization.data(withJSONObject: next, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        data.append(0x0A)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
        values = next
    }
}
