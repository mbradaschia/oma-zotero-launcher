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
    // `badge`: a task's state ("running", "failed", "" done).
    static func symbol(rowId: String, badge: String = "") -> String {
        switch rowId {
        case "task": return badge == "running" ? "arrow.triangle.2.circlepath" : badge == "failed" ? "xmark.octagon" : "checkmark.circle"
        case "tasks-clear", "ext-delete", "set-key-remove", "set-endpoint-remove": return "trash"
        case "prompt-new", "set-endpoint-new", "status-add", "task-action-add": return "plus"
        case "set-models", "set-model", "pe-model", "pe-model-opt", "set-use": return "cpu"
        case "pe-effort", "pe-effort-opt": return "gauge.with.dots.needle.33percent"
        case "pe-output", "pe-output-opt": return "doc.richtext"
        case "pe-title", "pe-title-save", "pe-text", "set-system-edit": return "pencil"
        case "pe-title-ai": return "sparkles"
        case "pe-brief": return "list.bullet.rectangle"
        case "set-key": return "key"
        case "key-info": return "keyboard"
        case "set-test": return "bolt.horizontal"
        case "set-provider", "set-quick": return "server.rack"
        case "set-rule": return "checklist.checked"
        case "set-rules-reset", "set-system-reset", "set-extract-retry": return "arrow.counterclockwise"
        case "set-extract-all": return "doc.on.doc"
        case "ext-read": return "doc.text"
        case "ext-again": return "arrow.clockwise"
        case "ext-zotero": return "arrow.up.forward.app"
        case "setting-go": return "gearshape"
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
        case "set-nav", "tags-status": return "gearshape"
        case "set-toggle": return "switch.2"
        case "set-choice", "set-edit", "set-styles": return "slider.horizontal.3"
        case "set-opt", "set-style-opt": return "circle"
        case "set-save": return "checkmark.circle"
        case "set-link": return "link"
        case "set-setup", "set-install": return "wrench.and.screwdriver"
        case "set-info": return "info.circle"
        case "pstatus", "pstatus-add", "pstatus-migrate": return "flag"
        case "tag-rename", "tag-name-save": return "pencil"
        case "tag-to-paper", "tag-to-task", "tag-status-opt": return "arrow.triangle.branch"
        case "tag-delete": return "trash"
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
