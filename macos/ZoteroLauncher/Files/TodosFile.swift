import Foundation

// todos.json: your tasks (Service.qml's todos), read through lib/Todos.js's parseTodos and written
// whole, atomically, from the file as it is now. Refused while the sync folder is unavailable,
// and over a file that is there but not tasks (a sync conflict, a half-written copy).
struct TodosFile {
    enum WriteError: Error, Equatable {
        case readOnly
        case damaged
    }

    let url: URL
    var readOnly: Bool
    private(set) var todos: [Any] // as lib/Todos.js keeps them, for Swift to read
    private(set) var json = RawJSON(text: "[]") // the same, in order: what the JS gets back

    static func load(_ url: URL, readOnly: Bool, core: JSCore) -> TodosFile {
        let (todos, json) = read(url, core)
        return TodosFile(url: url, readOnly: readOnly, todos: todos, json: json)
    }

    private static func read(_ url: URL, _ core: JSCore) -> ([Any], RawJSON) {
        let text = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        let json = (try? core.glueJSON("parseTodos", [text])) ?? "[]"
        return (((try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [Any]) ?? [], RawJSON(text: json))
    }

    static func damaged(_ url: URL) -> Bool {
        guard let data = try? Data(contentsOf: url) else { return FileManager.default.fileExists(atPath: url.path) }
        if data.allSatisfy({ $0 == 0x20 || $0 == 0x0A || $0 == 0x0D || $0 == 0x09 }) { return false }
        return ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["todos"] as? [Any] == nil
    }

    mutating func reload(_ core: JSCore) {
        (todos, json) = Self.read(url, core)
    }

    // The tasks changed from the file as it is now. `change` gets them (as JSON, keys in order) and
    // gives back the file's text (lib/Todos.js's serializeTodos) and the new list; → its answer.
    @discardableResult
    mutating func update(_ core: JSCore, _ change: (RawJSON) throws -> (text: String, todos: [Any], answer: [String: Any])) throws -> [String: Any] {
        guard !readOnly else { throw WriteError.readOnly }
        guard !Self.damaged(url) else { throw WriteError.damaged }
        reload(core)
        let next = try change(json)
        let before = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        // its deletions kept as tombstones (contracts/Merge.js), for merging the other machine's copy
        let text = try core.glue("stamp", ["todos.json", before, next.text, Date().timeIntervalSince1970 * 1000], as: String.self)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: url, options: .atomic)
        reload(core)
        return next.answer
    }
}
