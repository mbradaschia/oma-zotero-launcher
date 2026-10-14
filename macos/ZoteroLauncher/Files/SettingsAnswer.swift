import Foundation

// Glue.settings' answer: the settings in effect (lib/Client.js's normalizeSettings), typed for what
// the app reads, and what was wrong with the files.
struct SettingsAnswer: Decodable {
    struct Values: Decodable, Equatable {
        var keys: String // "single" or "alt"
        var keysStart: String // "list" or "search"
        var keyDelay: Int // ms
        var maxResults: Int
        var accelerators: Bool // the paper letters in the results (o, w, p, l…)
        var citationStyle: String?
        var paperStatuses: [String]
    }

    var settings: Values
    var problems: [String]
}
