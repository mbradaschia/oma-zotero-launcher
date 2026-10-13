import Foundation

// pins.json: what you pinned, papers, collections and tags, in your order (Service.qml's pins).
// Read through lib/Views.js's parsePins; written whole and atomically, from the file as it is now;
// refused while the sync folder is unavailable.
struct PinsFile {
    enum WriteError: Error, Equatable {
        case readOnly
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
        reload(core)
        try save(change(pins))
    }

    mutating func save(_ next: [Pin]) throws {
        guard !readOnly else { throw WriteError.readOnly }
        var data = try JSONSerialization.data(withJSONObject: ["pins": next.map(\.json)], options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        data.append(0x0A)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
        pins = next
    }
}
