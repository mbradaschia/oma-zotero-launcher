import Foundation

// pins.json: what you pinned, papers, collections and tags, in your order (Service.qml's pins).
// Read through lib/Views.js's parsePins; written whole and atomically, from the file as it is now;
// refused while the sync folder is unavailable.
struct PinsFile {
    enum WriteError: Error, Equatable {
        case readOnly
        case damaged // the file is there, but not pins (a sync conflict, a half-written copy)
    }

    let url: URL
    var readOnly: Bool
    private(set) var pins: [Pin]

    static func load(_ url: URL, readOnly: Bool, core: JSCore) -> PinsFile {
        PinsFile(url: url, readOnly: readOnly, pins: read(url, core))
    }

    private static func read(_ url: URL, _ core: JSCore) -> [Pin] {
        let text = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        return (try? core.glue("parsePins", [text], as: [Pin].self)) ?? []
    }

    mutating func reload(_ core: JSCore) {
        pins = Self.read(url, core)
    }

    // The pins changed from the file as it is now (the other machine may have changed it).
    mutating func update(_ core: JSCore, _ change: ([Pin]) throws -> [Pin]) throws {
        guard !readOnly else { throw WriteError.readOnly }
        guard !Self.damaged(url) else { throw WriteError.damaged }
        reload(core)
        try save(change(pins), core: core)
    }

    // There but not `{ "pins": [...] }`: writing over it would lose every pin, on both machines.
    static func damaged(_ url: URL) -> Bool {
        guard let data = try? Data(contentsOf: url) else { return FileManager.default.fileExists(atPath: url.path) }
        if data.allSatisfy({ $0 == 0x20 || $0 == 0x0A || $0 == 0x0D || $0 == 0x09 }) { return false }
        return ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["pins"] as? [Any] == nil
    }

    // Written with its deletions and change times (contracts/Merge.js's stamp), for merging the
    // other machine's copy.
    mutating func save(_ next: [Pin], core: JSCore? = nil) throws {
        guard !readOnly else { throw WriteError.readOnly }
        guard !Self.damaged(url) else { throw WriteError.damaged }
        var data = try JSONSerialization.data(withJSONObject: ["pins": next.map(\.json)], options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        data.append(0x0A)
        if let core {
            let before = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
            let stamped = try core.glue("stamp", ["pins.json", before, String(decoding: data, as: UTF8.self), Date().timeIntervalSince1970 * 1000], as: String.self)
            data = Data(stamped.utf8)
        }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
        pins = next
    }
}
