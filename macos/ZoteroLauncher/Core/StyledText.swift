import SwiftUI

// lib/Views.js marks matches with the bit of Qt StyledText it uses: escaped text, with
// <font color="#rrggbb"> and <b> around the matched part. Anything else is shown as text.
enum StyledText {
    // `colored`: false keeps the matches bold but drops their color (on a highlighted row).
    static func attributed(_ html: String, colored: Bool = true) -> AttributedString {
        var out = AttributedString()
        var bold = 0
        var colors: [Color] = []
        var rest = Substring(html)
        while !rest.isEmpty {
            if rest.hasPrefix("<"), let close = rest.firstIndex(of: ">") {
                let tag = rest[rest.index(after: rest.startIndex)..<close].lowercased()
                rest = rest[rest.index(after: close)...]
                if tag == "b" { bold += 1 }
                else if tag == "/b" { bold = max(0, bold - 1) }
                else if tag.hasPrefix("font") { colors.append(fontColor(in: tag) ?? colors.last ?? .accentColor) }
                else if tag == "/font" { _ = colors.popLast() }
                continue
            }
            let end = rest.dropFirst().firstIndex(of: "<") ?? rest.endIndex
            var piece = AttributedString(unescape(String(rest[..<end])))
            if bold > 0 { piece.font = Font.body.bold() }
            if colored, let color = colors.last { piece.foregroundColor = color }
            out += piece
            rest = rest[end...]
        }
        return out
    }

    static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }

    static func unescape(_ text: String) -> String {
        text.replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&amp;", with: "&")
    }

    static func fontColor(in tag: String) -> Color? {
        guard let range = tag.range(of: "#[0-9a-f]{6}", options: .regularExpression),
              let value = Int(tag[range].dropFirst(), radix: 16)
        else { return nil }
        return Color(red: Double((value >> 16) & 0xff) / 255, green: Double((value >> 8) & 0xff) / 255, blue: Double(value & 0xff) / 255)
    }
}
