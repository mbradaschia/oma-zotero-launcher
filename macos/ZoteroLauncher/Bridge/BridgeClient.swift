import Foundation

// One call's outcome, as lib/Client.js classify() has them.
enum BridgeResult {
    case ok([String: Any])
    case noHandshake        // no bridge.json: Zotero isn't running, or the plugin isn't installed
    case zoteroDown         // nothing answers on the port
    case bridgeMissing      // Zotero answers, the bridge's routes don't
    case unauthorized
    case timeout
    case error(String)

    var message: String {
        switch self {
        case .ok: return ""
        case .noHandshake: return "Zotero isn't running, or the Zotero plugin isn't installed"
        case .zoteroDown: return "Zotero isn't running"
        case .bridgeMissing: return "Zotero runs without the Zotero Omarchy Bridge plugin"
        case .unauthorized: return "Zotero refused the token: restart Zotero"
        case .timeout: return "Zotero took too long to answer"
        case .error(let message): return message
        }
    }
}

// JSON POSTs to the Zotero bridge on 127.0.0.1, with the handshake's token. Answers arrive on
// the main queue. An unauthorized answer re-reads the handshake once (Zotero restarted).
final class BridgeClient {
    private(set) var handshake: Handshake?
    private let session: URLSession
    private let handshakeURL: URL

    init(handshakeURL: URL = Handshake.url()) {
        self.handshakeURL = handshakeURL
        let config = URLSessionConfiguration.ephemeral
        config.connectionProxyDictionary = [:] // localhost only: never through a proxy
        session = URLSession(configuration: config)
        handshake = Handshake.load(from: handshakeURL)
    }

    func reload() {
        handshake = Handshake.load(from: handshakeURL)
    }

    func post(_ route: String, _ body: [String: Any], timeout: TimeInterval = 8,
              completion: @escaping (BridgeResult) -> Void) {
        send("POST", route, body, timeout: timeout, retried: false, completion: completion)
    }

    func get(_ route: String, timeout: TimeInterval = 8, completion: @escaping (BridgeResult) -> Void) {
        send("GET", route, nil, timeout: timeout, retried: false, completion: completion)
    }

    private func send(_ method: String, _ route: String, _ body: [String: Any]?, timeout: TimeInterval, retried: Bool,
                      completion: @escaping (BridgeResult) -> Void) {
        if handshake == nil { reload() }
        guard let handshake, let url = URL(string: "http://127.0.0.1:\(handshake.port)/oma-zotero\(route)") else {
            DispatchQueue.main.async { completion(.noHandshake) }
            return
        }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = method
        for (field, value) in Self.headers(handshake) { request.setValue(value, forHTTPHeaderField: field) }
        if let body { request.httpBody = try? JSONSerialization.data(withJSONObject: body) } // (a GET sends none)
        session.dataTask(with: request) { data, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let result = Self.classify(status: status, data: data, error: error)
            DispatchQueue.main.async {
                if case .unauthorized = result, !retried {
                    self.reload()
                    self.send(method, route, body, timeout: timeout, retried: true, completion: completion)
                } else {
                    completion(result)
                }
            }
        }.resume()
    }

    // Zotero drops requests without Zotero-Allowed-Request, and those whose User-Agent starts
    // with "Mozilla/" (lib/Client.js).
    static func headers(_ handshake: Handshake) -> [(String, String)] {
        [("Zotero-Allowed-Request", "1"),
         ("Authorization", "Bearer \(handshake.token)"),
         ("Content-Type", "application/json"),
         ("User-Agent", "ZoteroLauncher-macOS/0.1")]
    }

    static func classify(status: Int, data: Data?, error: Error?) -> BridgeResult {
        if let error = error as? URLError, error.code == .timedOut { return .timeout }
        if status == 0 { return .zoteroDown }
        let object = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
        if status == 200, let object, object["ok"] as? Bool == true { return .ok(object) }
        // Zotero answers unknown routes with a plain-text 404: the bridge isn't installed.
        if status == 404, object?["error"] == nil { return .bridgeMissing }
        if status == 401 { return .unauthorized }
        let detail = object?["error"] as? [String: Any]
        return .error(detail?["message"] as? String ?? "Zotero answered HTTP \(status)")
    }
}
