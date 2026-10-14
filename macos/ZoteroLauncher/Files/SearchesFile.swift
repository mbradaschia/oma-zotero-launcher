import Foundation

// searches.json: your saved searches (Service.qml's searches), read through lib/Views.js's
// parseSearches and written whole, atomically, from the file as it is now, through
// contracts/Merge.js's stamp (their change times and deletions, for merging the other machine's
// copy). Refused while the sync folder is unavailable, and over a file that is there but isn't
// searches (a half-written copy: writing over it would lose them).
struct SearchesFile {
    enum WriteError: Error, Equatable {
        case readOnly
        case damaged
    }

    let url: URL
    var readOnly: Bool
    private(set) var searches: [[String: Any]] // for Swift to read
    private(set) var json = RawJSON(text: "[]") // the same, in order, for the JS

    static func load(_ url: URL, readOnly: Bool, core: JSCore) -> SearchesFile {
        let (list, json) = read(url, core)
        return SearchesFile(url: url, readOnly: readOnly, searches: list, json: json)
    }

    private static func read(_ url: URL, _ core: JSCore) -> ([[String: Any]], RawJSON) {
        let text = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        let json = (try? core.glueJSON("parseSearches", [text])) ?? "[]"
        return (((try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [[String: Any]]) ?? [], RawJSON(text: json))
    }

    static func damaged(_ url: URL) -> Bool {
        guard let data = try? Data(contentsOf: url) else { return FileManager.default.fileExists(atPath: url.path) }
        if data.allSatisfy({ $0 == 0x20 || $0 == 0x0A || $0 == 0x0D || $0 == 0x09 }) { return false }
        return ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["searches"] as? [Any] == nil
    }

    mutating func reload(_ core: JSCore) {
        (searches, json) = Self.read(url, core)
    }

    // The searches changed from the file as it is now: `change` gets them (JSON, keys in order) and
    // gives back the new list as JSON text (a Glue answer).
    mutating func update(_ core: JSCore, now: Date = Date(), _ change: (RawJSON) throws -> String) throws {
        guard !readOnly else { throw WriteError.readOnly }
        guard !Self.damaged(url) else { throw WriteError.damaged }
        reload(core)
        let list = try change(json)
        let after = try core.glue("searchesText", [RawJSON(text: list)], as: String.self)
        let before = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        let text = try core.glue("stamp", ["searches.json", before, after, now.timeIntervalSince1970 * 1000], as: String.self)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: url, options: .atomic)
        reload(core)
    }
}
