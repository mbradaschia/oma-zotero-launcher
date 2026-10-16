import Foundation

// What the launcher asks of Zotero's bridge: JSON POSTs (and GET /ping), answers on the main queue. BridgeClient
// talks to Zotero; the tests use a fake.
protocol Bridge: AnyObject {
    func reload()
    func post(_ route: String, _ body: [String: Any], timeout: TimeInterval, completion: @escaping (BridgeResult) -> Void)
    func get(_ route: String, timeout: TimeInterval, completion: @escaping (BridgeResult) -> Void)
}

extension BridgeClient: Bridge {}
