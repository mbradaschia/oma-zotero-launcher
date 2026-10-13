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
    private(set) var todos: [Any] // as lib/Todos.js keeps them; the builders read them

    static func load(_ url: URL, readOnly: Bool, core: JSCore) -> TodosFile {
        TodosFile(url: url, readOnly: readOnly, todos: read(url, core))
    }

    private static func read(_ url: URL, _ core: JSCore) -> [Any] {
        let text = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        return ((try? core.glueJSON("parseTodos", [text])).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [Any]) ?? []
    }

    static func damaged(_ url: URL) -> Bool {
        guard let data = try? Data(contentsOf: url) else { return FileManager.default.fileExists(atPath: url.path) }
        if data.allSatisfy({ $0 == 0x20 || $0 == 0x0A || $0 == 0x0D || $0 == 0x09 }) { return false }
        return ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["todos"] as? [Any] == nil
    }

    mutating func reload(_ core: JSCore) {
        todos = Self.read(url, core)
    }

    // The tasks changed from the file as it is now. `change` gets them and gives back the file's
    // text (lib/Todos.js's serializeTodos) and the new list; → the change's own answer.
    @discardableResult
    mutating func update(_ core: JSCore, _ change: ([Any]) throws -> (text: String, todos: [Any], answer: [String: Any])) throws -> [String: Any] {
        guard !readOnly else { throw WriteError.readOnly }
        guard !Self.damaged(url) else { throw WriteError.damaged }
        reload(core)
        let next = try change(todos)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(next.text.utf8).write(to: url, options: .atomic)
        todos = next.todos
        return next.answer
    }
}
