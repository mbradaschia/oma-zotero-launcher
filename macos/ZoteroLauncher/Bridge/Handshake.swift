import Foundation

// The file the Zotero bridge writes when Zotero starts: the port and a token only you can read.
// Zotero puts it in $XDG_RUNTIME_DIR, else its temporary directory, which on macOS is the
// per-user $TMPDIR (/var/folders/…/T/), the same directory NSTemporaryDirectory() returns.
struct Handshake: Equatable {
    let port: Int
    let token: String
    let bridgeVersion: String
    let zoteroVersion: String

    static func parse(_ data: Data) -> Handshake? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = object["token"] as? String,
              token.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
              let port = (object["port"] as? NSNumber)?.intValue, port > 0
        else { return nil }
        return Handshake(port: port, token: token,
                         bridgeVersion: object["bridgeVersion"] as? String ?? "",
                         zoteroVersion: object["zoteroVersion"] as? String ?? "")
    }

    static func url(environment: [String: String] = ProcessInfo.processInfo.environment,
                    temporaryDirectory: String = NSTemporaryDirectory()) -> URL {
        let runtime = environment["XDG_RUNTIME_DIR"].flatMap { $0.isEmpty ? nil : $0 }
        return URL(fileURLWithPath: runtime ?? temporaryDirectory, isDirectory: true)
            .appendingPathComponent("oma-zotero", isDirectory: true)
            .appendingPathComponent("bridge.json")
    }

    static func load(from url: URL = Handshake.url()) -> Handshake? {
        (try? Data(contentsOf: url)).flatMap(parse)
    }
}
