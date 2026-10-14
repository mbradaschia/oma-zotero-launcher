import AppKit
import SwiftUI

// One part of the search box's text, as lib/Views.js's querySegments (or Todos.taskSegments) cut
// it: a filter, an operator, a quoted phrase, a block. Offsets in UTF-16 units, as the JS counts.
struct TextSegment: Decodable, Equatable {
    var start: Int
    var end: Int
    var role: String // "field", "neg", "op", "paren", "quote", "status", … or ""
    var block: Bool
}

// The search box (phase 5's design, section 3): AppKit's field, so composed text, the services,
// word moves and the caret are the Mac's, with the query's runs tinted as you type. The QML draws a
// finished block as a chip with a short label; here the typed text stays and is tinted, because a
// label replacing text inside an editable field fights the caret and undo. It reports the text and
// the caret (as caretBack, UTF-16 units from the end) and whether it has the keys.
struct StyledTextField: NSViewRepresentable {
    var text: String
    var caretBack: Int
    var live = false // the word at the caret still being typed (it tints differently)
    @Binding var focused: Bool
    var placeholder: String
    var font = NSFont.preferredFont(forTextStyle: .title2)
    var segments: (String, Int) -> [TextSegment] // text, caret
    var onEdit: (String, Int) -> Void // text, caretBack
    var onCaret: (Int) -> Void // caretBack

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    // A field that says when it takes the keys (a click into it), not only on its first edit.
    final class Field: NSTextField {
        var onFocus: (NSTextView?) -> Void = { _ in }

        override func becomeFirstResponder() -> Bool {
            let took = super.becomeFirstResponder()
            if took { onFocus(currentEditor() as? NSTextView) }
            return took
        }
    }

    func makeNSView(context: Context) -> NSTextField {
        let field = Field()
        let c = context.coordinator
        field.onFocus = { [weak c] editor in c?.tookKeys(editor) }
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = font
        field.lineBreakMode = .byTruncatingHead
        field.cell?.isScrollable = true
        field.cell?.wraps = false
        field.allowsEditingTextAttributes = false
        field.delegate = context.coordinator
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        return field
    }

    func updateNSView(_ field: NSTextField, context: Context) {
        let c = context.coordinator
        c.parent = self
        field.placeholderString = placeholder
        field.setAccessibilityLabel(placeholder) // what the box searches, or what you type there
        if field.stringValue != text {
            c.applying = true
            field.stringValue = text
            if let editor = field.currentEditor() as? NSTextView {
                let at = max(0, (text as NSString).length - caretBack)
                editor.setSelectedRange(NSRange(location: at, length: 0))
            }
            c.applying = false
        }
        c.tintIfChanged(field)
        guard let window = field.window else { return }
        let editing = field.currentEditor() != nil && window.firstResponder === field.currentEditor()
        if focused && !editing {
            DispatchQueue.main.async {
                guard window.makeFirstResponder(field), let editor = field.currentEditor() as? NSTextView else { return }
                // the caret where the model has it, not everything selected: the next key adds to it
                let at = max(0, (field.stringValue as NSString).length - self.caretBack)
                editor.setSelectedRange(NSRange(location: at, length: 0))
                c.watch(editor)
            }
        } else if !focused && editing {
            DispatchQueue.main.async { window.makeFirstResponder(nil) }
        }
    }

    static func dismantleNSView(_ field: NSTextField, coordinator: Coordinator) {
        coordinator.watch(nil)
    }

    @MainActor
    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: StyledTextField
        var applying = false // the model's text going in: not an edit to report
        private var watched: NSTextView?
        private var tinted: (text: String, caret: Int, live: Bool)? // what the colours were made for

        init(_ parent: StyledTextField) {
            self.parent = parent
        }

        // The field editor's caret moves (arrows, clicks): reported, so @ inserts where you are.
        func watch(_ editor: NSTextView?) {
            if let watched { NotificationCenter.default.removeObserver(self, name: NSTextView.didChangeSelectionNotification, object: watched) }
            watched = editor
            if let editor {
                NotificationCenter.default.addObserver(self, selector: #selector(selectionChanged(_:)), name: NSTextView.didChangeSelectionNotification, object: editor)
            }
        }

        @objc func selectionChanged(_ note: Notification) {
            guard !applying, let editor = note.object as? NSTextView else { return }
            let back = Self.caretBack(editor)
            if back != parent.caretBack { parent.onCaret(back) }
        }

        static func caretBack(_ editor: NSTextView) -> Int {
            let length = (editor.string as NSString).length
            return max(0, length - NSMaxRange(editor.selectedRange()))
        }

        func controlTextDidChange(_ note: Notification) {
            guard !applying, let field = note.object as? NSTextField else { return }
            let editor = field.currentEditor() as? NSTextView
            // a character still being composed (an input method) isn't typed yet: the search waits for it
            if editor?.hasMarkedText() == true { return }
            parent.onEdit(field.stringValue, editor.map(Self.caretBack) ?? 0)
            tint(field)
        }

        // Coloured again only when the text or the caret moved (each costs a call into the JS).
        func tintIfChanged(_ field: NSTextField) {
            let now = (text: field.stringValue, caret: parent.caretBack, live: parent.live)
            if let t = tinted, t.text == now.text, t.caret == now.caret, t.live == now.live { return }
            tint(field)
        }

        // The field became first responder (a click, or the model giving it the keys).
        func tookKeys(_ editor: NSTextView?) {
            watch(editor)
            if !parent.focused { parent.focused = true }
        }

        // (still the way in for an edit when the field already had the keys)
        func controlTextDidBeginEditing(_ note: Notification) {
            if let field = note.object as? NSTextField { watch(field.currentEditor() as? NSTextView) }
            if !parent.focused { parent.focused = true }
        }

        func controlTextDidEndEditing(_ note: Notification) {
            watch(nil)
            if parent.focused { parent.focused = false }
        }

        // The runs' colours: in the field editor while typing (never in the middle of composing a
        // character), else in the field's own text.
        func tint(_ field: NSTextField) {
            let text = field.stringValue
            let caret = max(0, (text as NSString).length - parent.caretBack)
            let runs = parent.segments(text, caret)
            tinted = (text, parent.caretBack, parent.live)
            let base: [NSAttributedString.Key: Any] = [.font: parent.font, .foregroundColor: NSColor.labelColor]
            if let editor = field.currentEditor() as? NSTextView, let storage = editor.textStorage {
                guard !editor.hasMarkedText() else { return }
                let selection = editor.selectedRanges
                storage.beginEditing()
                storage.setAttributes(base, range: NSRange(location: 0, length: storage.length))
                for run in runs { Self.apply(run, to: storage) }
                storage.endEditing()
                editor.selectedRanges = selection
                editor.typingAttributes = base
            } else {
                let out = NSMutableAttributedString(string: text, attributes: base)
                for run in runs { Self.apply(run, to: out) }
                field.attributedStringValue = out
            }
        }

        // The roles lib/Views.js's querySegments and lib/Todos.js's taskSegments give.
        static func color(_ role: String) -> NSColor? {
            switch role {
            case "": return nil
            case "op": return .systemOrange
            case "neg": return .systemRed
            case "quote": return .systemGreen
            case "paren": return .secondaryLabelColor
            default: return .controlAccentColor // a field, a status, a due date, …
            }
        }

        static func apply(_ run: TextSegment, to text: NSMutableAttributedString) {
            guard run.end > run.start, run.start >= 0, run.end <= text.length, let color = color(run.role) else { return }
            let range = NSRange(location: run.start, length: run.end - run.start)
            text.addAttribute(.foregroundColor, value: color, range: range)
            if run.block { text.addAttribute(.backgroundColor, value: color.withAlphaComponent(0.16), range: range) }
        }
    }
}
