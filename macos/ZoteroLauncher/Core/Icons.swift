import AppKit
import CoreText
import SwiftUI

// Row icons (decision 4): the Nerd Font glyph lib/Views.js gives, drawn in the Symbols Nerd Font
// when the app bundles it (Resources/Fonts); without it, an SF Symbol for what the row is.
enum Icons {
    static let fontName = "Symbols Nerd Font Mono"

    // The bundled fonts, registered for this process (at launch).
    static func registerBundledFonts(_ bundle: Bundle = .main) {
        for url in bundle.urls(forResourcesWithExtension: "ttf", subdirectory: "Fonts") ?? [] {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }

    static var nerdFont: Bool { NSFont(name: fontName, size: 12) != nil }

    // An SF Symbol for a list row, by what it does.
    static func symbol(rowId: String) -> String {
        switch rowId {
        case "open": return "arrow.up.forward.app"
        case "reveal": return "folder"
        case "external": return "doc.richtext"
        case "window": return "macwindow"
        case "pick": return "doc"
        case "pin": return "pin"
        case "cite-copy": return "quote.opening"
        case "confirm-yes": return "checkmark.circle"
        case "confirm-no": return "xmark.circle"
        case "note", "read", "notes", "notes-empty": return "note.text"
        case "chat", "chat-session": return "bubble.left"
        case "prompts", "prompt", "setup": return "text.bubble"
        case "extract": return "doc.text.magnifyingglass"
        case "tags", "tag", "create": return "tag"
        case "paper-status": return "flag"
        case "default-task", "todo", "task-default": return "checklist"
        case "classify", "classify-audit": return "square.stack.3d.up"
        case "artifact": return "sparkles.rectangle.stack"
        default: return "circle"
        }
    }
}

// A row's icon: the glyph in the Nerd Font, else the symbol.
struct RowIcon: View {
    let glyph: String
    let symbol: String

    var body: some View {
        if Icons.nerdFont && !glyph.isEmpty {
            Text(glyph).font(.custom(Icons.fontName, size: 15))
        } else {
            Image(systemName: symbol)
        }
    }
}
