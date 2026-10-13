import Foundation

// JSON passed to the view logic as text, parsed there: its keys keep their order. Swift's
// dictionaries don't, and the files the JS writes (settings) would come out in another order than
// the Omarchy launcher writes them, churning the synced folder.
struct RawJSON {
    let text: String

    // A file's JSON, or nil when it is missing or not JSON.
    static func file(_ path: String?) -> RawJSON? {
        guard let path, let data = FileManager.default.contents(atPath: path),
              (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) != nil
        else { return nil }
        return RawJSON(text: String(decoding: data, as: UTF8.self))
    }
}
