import XCTest
@testable import ZoteroLauncher

final class HandshakeTests: XCTestCase {
    let token = String(repeating: "ab", count: 32)

    func testParsesTheBridgesFile() {
        let json = #"{"port": 23119, "token": "\#(token)", "bridgeVersion": "0.2.1", "zoteroVersion": "10.0"}"#
        XCTAssertEqual(Handshake.parse(Data(json.utf8)), Handshake(port: 23119, token: token, bridgeVersion: "0.2.1", zoteroVersion: "10.0"))
    }

    func testRefusesABadTokenOrPort() {
        XCTAssertNil(Handshake.parse(Data(#"{"port": 23119, "token": "short"}"#.utf8)))
        XCTAssertNil(Handshake.parse(Data(#"{"port": 0, "token": "\#(token)"}"#.utf8)))
        XCTAssertNil(Handshake.parse(Data("not json".utf8)))
    }

    func testLooksWhereZoteroWritesIt() {
        XCTAssertEqual(Handshake.url(environment: ["XDG_RUNTIME_DIR": "/run/user/501"], temporaryDirectory: "/var/folders/x/T/").path,
                       "/run/user/501/oma-zotero/bridge.json")
        XCTAssertEqual(Handshake.url(environment: [:], temporaryDirectory: "/var/folders/x/T/").path,
                       "/var/folders/x/T/oma-zotero/bridge.json")
    }

    func testLoadsFromAFile() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("bridge.json")
        try Data(#"{"port": 23119, "token": "\#(token)"}"#.utf8).write(to: file)
        XCTAssertEqual(Handshake.load(from: file)?.port, 23119)
        XCTAssertNil(Handshake.load(from: dir.appendingPathComponent("missing.json")))
    }
}

final class BridgeClientTests: XCTestCase {
    func testClassifiesAnswersAsTheLinuxLauncherDoes() {
        if case .ok = BridgeClient.classify(status: 200, data: Data(#"{"ok": true, "results": []}"#.utf8), error: nil) {} else { XCTFail("ok") }
        if case .zoteroDown = BridgeClient.classify(status: 0, data: nil, error: nil) {} else { XCTFail("down") }
        if case .bridgeMissing = BridgeClient.classify(status: 404, data: Data("No endpoint found".utf8), error: nil) {} else { XCTFail("missing") }
        if case .unauthorized = BridgeClient.classify(status: 401, data: nil, error: nil) {} else { XCTFail("401") }
        if case .timeout = BridgeClient.classify(status: 0, data: nil, error: URLError(.timedOut)) {} else { XCTFail("timeout") }
        if case .error(let message) = BridgeClient.classify(status: 400, data: Data(#"{"error": {"code": "bad", "message": "bad query"}}"#.utf8), error: nil) {
            XCTAssertEqual(message, "bad query")
        } else { XCTFail("error") }
    }

    func testSendsTheHeadersZoteroRequires() {
        let headers = Dictionary(uniqueKeysWithValues: BridgeClient.headers(Handshake(port: 1, token: "t", bridgeVersion: "", zoteroVersion: "")))
        XCTAssertEqual(headers["Zotero-Allowed-Request"], "1")
        XCTAssertEqual(headers["Authorization"], "Bearer t")
        XCTAssertFalse(headers["User-Agent"]!.hasPrefix("Mozilla/"))
    }
}
