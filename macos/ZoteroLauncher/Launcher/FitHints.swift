import AppKit

// The footer's hints on one line (lib/Views.js's hintParts and fitHints, ported: they measure
// text): the ones that go back (esc, ⌫) always, then the others in order while there is room.
enum FitHints {
    static let keyWords: Set<String> = ["tab", "esc", "del", "space", "pgup", "pgdn", "home", "end", "enter"]

    // "⇧↵ z zotero" → keys "⇧↵ z", desc "zotero".
    static func parts(_ hint: String) -> (keys: String, desc: String) {
        let words = hint.split(whereSeparator: \.isWhitespace).map(String.init)
        var n = 0
        while n < words.count - 1, words[n].count == 1 || words[n].contains(where: { !("a"..."z").contains($0) && $0 != "-" }) || keyWords.contains(words[n]) { n += 1 }
        return (words.prefix(n).joined(separator: " "), words.dropFirst(n).joined(separator: " "))
    }

    static func fit(_ hints: [String], width: CGFloat, gap: CGFloat, widthOf: (String) -> CGFloat) -> [String] {
        var used: CGFloat = 0
        var take = Set<Int>()
        for (i, h) in hints.enumerated() where parts(h).keys.contains("esc") || parts(h).keys.contains("⌫") {
            used += widthOf(h) + (used > 0 ? gap : 0)
            take.insert(i)
        }
        for (i, h) in hints.enumerated() where !take.contains(i) {
            let w = widthOf(h) + (used > 0 ? gap : 0)
            if used + w <= width {
                used += w
                take.insert(i)
            }
        }
        return hints.enumerated().filter { take.contains($0.offset) }.map(\.element)
    }

    // A hint's width in the footer's fonts: its keys in the bold one, its words in the regular.
    static func width(_ hint: String, size: CGFloat = NSFont.smallSystemFontSize) -> CGFloat {
        let p = parts(hint)
        let keys = (p.keys as NSString).size(withAttributes: [.font: NSFont.boldSystemFont(ofSize: size)]).width
        let desc = (p.desc as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: size)]).width
        return keys + (p.keys.isEmpty || p.desc.isEmpty ? 0 : 4) + desc
    }
}
