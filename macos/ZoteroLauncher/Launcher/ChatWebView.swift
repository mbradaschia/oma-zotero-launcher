import AppKit
import SwiftUI
import WebKit

// The conversation (decision 5, as NoteView): a web view with the page's JavaScript off and no network
// (a CSP allowing inline styles only). The page is loaded once; each change replaces its body from the app's
// own world (no reload, so no flicker while an answer streams in), kept at the end when it was there.
// Links go to the model (an answer's Copy, Save, Download; an artifact; a web page); nothing loads in place.
struct ChatWebView: NSViewRepresentable {
    let body: String
    var onLink: (URL) -> Void = { _ in }

    static let shell = """
    <!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <style>
    :root { color-scheme: light dark; }
    body { font: 14px -apple-system, "SF Pro Text", sans-serif; margin: 14px 22px 22px; color: CanvasText; background: transparent; -webkit-user-select: text; line-height: 1.45; }
    a { color: AccentColor; }
    .empty { text-align: center; opacity: 0.55; max-width: 34em; margin: 1.2em auto; }
    .msg { margin: 14px 0; }
    .user { display: flex; justify-content: flex-end; }
    .bubble { max-width: 80%; padding: 8px 12px; border-radius: 12px; background: color-mix(in srgb, AccentColor 14%, transparent); color: CanvasText; }
    .assistant { max-width: 100%; }
    .assistant.failed { opacity: 0.75; }
    .note { text-align: center; opacity: 0.6; font-size: 13px; }
    .status { opacity: 0.55; font-style: italic; }
    .info { opacity: 0.55; font-size: 12px; margin: 4px 0; }
    .info.warn { opacity: 0.9; color: AccentColor; }
    .acts { font-size: 12px; opacity: 0.7; margin: 2px 0 0; }
    pre, code { font: 12.5px ui-monospace, "SF Mono", monospace; }
    pre { padding: 8px 10px; border-radius: 6px; background: color-mix(in srgb, CanvasText 6%, transparent); overflow-x: auto; }
    blockquote { margin-left: 0; padding-left: 12px; border-left: 3px solid color-mix(in srgb, CanvasText 25%, transparent); }
    table { border-collapse: collapse; } td, th { border: 1px solid GrayText; padding: 4px 6px; }
    </style></head><body></body></html>
    """

    func makeCoordinator() -> Coordinator { Coordinator(onLink: onLink) }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: config)
        view.setValue(false, forKey: "drawsBackground")
        view.allowsLinkPreview = false
        view.navigationDelegate = context.coordinator
        context.coordinator.view = view
        view.loadHTMLString(Self.shell, baseURL: nil)
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        context.coordinator.onLink = onLink
        context.coordinator.show(body)
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        weak var view: WKWebView?
        var onLink: (URL) -> Void
        private var ready = false
        private var shown: String?
        private var waiting: String?

        init(onLink: @escaping (URL) -> Void) { self.onLink = onLink }

        func show(_ body: String) {
            guard body != shown else { return }
            guard ready else { waiting = body; return }
            shown = body
            let json = String(decoding: (try? JSONSerialization.data(withJSONObject: [body])) ?? Data("[\"\"]".utf8), as: UTF8.self)
            // (the app's world: the page's own JavaScript stays off)
            let script = "(function(){var e=document.scrollingElement||document.body;var atEnd=e.scrollTop+window.innerHeight>=e.scrollHeight-160;" +
                "document.body.innerHTML=\(json)[0];if(atEnd)window.scrollTo(0,e.scrollHeight)})()"
            view?.evaluateJavaScript(script, in: nil, in: .defaultClient) { _ in }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            ready = true
            if let waiting { self.waiting = nil; show(waiting) }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if action.navigationType == .other, action.request.url?.absoluteString == "about:blank" || action.request.url?.scheme == nil {
                return decisionHandler(.allow)
            }
            decisionHandler(.cancel)
            if action.navigationType == .linkActivated, let url = action.request.url,
               ["http", "https", "mailto", "oma-answer", "oma-artifact"].contains((url.scheme ?? "").lowercased()) {
                onLink(url)
            }
        }
    }
}

// The question box: ↵ sends, ⇧↵ a new line; esc goes to the window (stop, close a pop-up); it grows to 8 lines.
struct ChatInput: NSViewRepresentable {
    @Binding var text: String
    var onSend: () -> Void
    var onEscape: () -> Void
    var focus: (@escaping () -> Void) -> Void = { _ in }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSTextView.scrollableTextView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        let tv = scroll.documentView as! NSTextView
        let input = InputTextView(frame: tv.frame, textContainer: tv.textContainer)
        input.isRichText = false
        input.allowsUndo = true
        input.font = .systemFont(ofSize: 14)
        input.drawsBackground = false
        input.isAutomaticQuoteSubstitutionEnabled = false
        input.isAutomaticDashSubstitutionEnabled = false
        input.textContainerInset = NSSize(width: 4, height: 6)
        input.delegate = context.coordinator
        input.minSize = NSSize(width: 0, height: 0)
        input.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        input.isVerticallyResizable = true
        input.autoresizingMask = [.width]
        input.onSend = { context.coordinator.parent.onSend() }
        input.onEscape = { context.coordinator.parent.onEscape() }
        input.setAccessibilityLabel("Ask about the paper")
        scroll.documentView = input
        context.coordinator.input = input
        focus { [weak input] in input?.window?.makeFirstResponder(input) }
        DispatchQueue.main.async { input.window?.makeFirstResponder(input) }
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        context.coordinator.parent = self
        if let input = context.coordinator.input, input.string != text {
            input.string = text
            input.setSelectedRange(NSRange(location: (text as NSString).length, length: 0))
        }
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: ChatInput
        weak var input: InputTextView?
        init(_ parent: ChatInput) { self.parent = parent }
        func textDidChange(_ notification: Notification) {
            guard let tv = notification.object as? NSTextView else { return }
            parent.text = tv.string
        }
    }

    final class InputTextView: NSTextView {
        var onSend: () -> Void = {}
        var onEscape: () -> Void = {}
        override func keyDown(with event: NSEvent) {
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if event.keyCode == 36 || event.keyCode == 76 { // ↵: send; ⇧↵ (or ⌥↵): a new line
                if flags.contains(.shift) || flags.contains(.option) { insertNewlineIgnoringFieldEditor(nil) } else { onSend() }
                return
            }
            if event.keyCode == 53 { return onEscape() }
            super.keyDown(with: event)
        }
    }
}
