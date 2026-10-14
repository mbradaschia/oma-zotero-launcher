import Foundation

// extract.json: the text extraction's state on this machine (Service.qml's extractState): the
// papers left alone after one try (`skipped`: "lib:key" → why), the catch-up while one runs
// (`catchup`: { scope, title, done, skipped, failed, started }), and what later phases keep there
// (since, tagged, autoPrompts, update), left as they are. Written whole and atomically, its keys
// sorted (the QML keeps their order; nothing reads the order). It never syncs.
struct ExtractFile {
    let url: URL
    private(set) var object: [String: Any]

    static func load(_ url: URL) -> ExtractFile {
        let object = (try? Data(contentsOf: url)).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any] ?? [:]
        return ExtractFile(url: url, object: object)
    }

    var skipped: [String: Any] { object["skipped"] as? [String: Any] ?? [:] }
    var catchup: [String: Any]? { object["catchup"] as? [String: Any] }

    var since: String { object["since"] as? String ?? "" }
    var tagSince: String { object["tagSince"] as? String ?? "" }
    var tagged: [String: Any] { object["tagged"] as? [String: Any] ?? [:] }
    var autoPrompts: [String: Any] { object["autoPrompts"] as? [String: Any] ?? [:] }
    var upToDate: [String: Any]? { (object["update"] as? [String: Any]).flatMap { $0["jobs"] is [Any] ? $0 : nil } }

    // One key changed (nil: null), and the file written.
    mutating func set(_ key: String, _ value: Any?) throws {
        try update([key: value])
    }

    // Several keys at once (nil: null), one write.
    mutating func update(_ changes: [String: Any?]) throws {
        for (k, v) in changes { object[k] = v ?? NSNull() }
        var data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        data.append(0x0A)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }
}
