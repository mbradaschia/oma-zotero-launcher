import Foundation

// How you arranged things, kept in view.json (contracts/SYNC-FORMAT.md): the notes' text size,
// your order of notes, sections and menu rows, a menu's pins and others, the grouping. Read whole
// and written whole, atomically, as Service.qml does; keys this version doesn't know are kept, for
// the launcher on another machine. Nothing is written while the sync folder is unavailable.
struct ViewPrefs {
    enum WriteError: Error, Equatable {
        case readOnly
    }

    let url: URL
    let readOnly: Bool
    private(set) var values: [String: Any]

    // view.json at `url` (Paths.resolve's `view`); missing, unreadable or not an object: empty.
    static func load(_ url: URL, readOnly: Bool) -> ViewPrefs {
        let object = (try? Data(contentsOf: url)).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
        return ViewPrefs(url: url, readOnly: readOnly, values: object ?? [:])
    }

    // The notes' text size, 8 to 40; 0 is the theme's.
    var noteFontSize: Int {
        let n = (values["noteFontSize"] as? NSNumber)?.doubleValue ?? 0
        return n >= 8 && n <= 40 ? Int(n.rounded()) : 0
    }

    // `key` set to `value` (nil removes it), and the file written.
    mutating func set(_ key: String, _ value: Any?) throws {
        guard !readOnly else { throw WriteError.readOnly }
        var next = values
        next[key] = value
        var data = try JSONSerialization.data(withJSONObject: next, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        data.append(0x0A)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
        values = next
    }
}
