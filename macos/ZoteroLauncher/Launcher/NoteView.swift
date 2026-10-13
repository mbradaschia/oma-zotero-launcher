import AppKit
import SwiftUI
import WebKit

// A note, read (decision 5): Views.noteHtml in a web view with the page's JavaScript off and no
// network (a CSP allowing only inline styles and data: images), page CSS for light and dark.
// Links go to their app (the browser, Zotero) and the launcher closes; nothing loads in place.
struct NoteView: NSViewRepresentable {
    let html: String // the note's body (Views.noteHtml)
    let size: Int
    var onLink: (URL) -> Void = { _ in }
    var display: (NoteDisplay?) -> Void = { _ in }

    static func page(_ body: String, size: Int) -> String {
        """
        <!doctype html><html><head><meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
        <style>
        :root { color-scheme: light dark; }
        body { font: \(size)px -apple-system, "SF Pro Text", sans-serif; margin: 14px 18px; color: CanvasText; background: transparent;
               -webkit-user-select: text; }
        a { color: AccentColor; }
        table { border-collapse: collapse; } td, th { border: 1px solid GrayText; padding: 4px 6px; }
        img { max-width: 100%; }
        </style></head><body>\(body)</body></html>
        """
    }

    func makeCoordinator() -> Coordinator { Coordinator(onLink: onLink) }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: config)
        view.setValue(false, forKey: "drawsBackground")
        view.allowsLinkPreview = false // a force-click preview would load the page outside the policy below
        view.navigationDelegate = context.coordinator
        context.coordinator.view = view
        display(context.coordinator)
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        context.coordinator.onLink = onLink
        let page = Self.page(html, size: size)
        if context.coordinator.loaded != page {
            context.coordinator.loaded = page
            view.loadHTMLString(page, baseURL: nil)
        }
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, NoteDisplay {
        weak var view: WKWebView?
        var loaded = ""
        var onLink: (URL) -> Void

        init(onLink: @escaping (URL) -> Void) {
            self.onLink = onLink
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            // the page itself (loadHTMLString) loads; a click on a link goes to its app
            if action.navigationType == .other, action.request.url?.absoluteString == "about:blank" || action.request.url?.scheme == nil {
                return decisionHandler(.allow)
            }
            decisionHandler(.cancel)
            if action.navigationType == .linkActivated, let url = action.request.url, ["http", "https", "mailto", "zotero"].contains((url.scheme ?? "").lowercased()) {
                onLink(url)
            }
        }

        // The app's own scrolling (the page's JavaScript is off; this runs in the app's world).
        private func run(_ script: String) {
            view?.evaluateJavaScript(script, in: nil, in: .defaultClient) { _ in }
        }

        func scroll(by lines: CGFloat) { run("window.scrollBy(0, \(lines * 22))") }
        func scrollPage(_ pages: CGFloat) { run("window.scrollBy(0, \(pages) * (window.innerHeight - 60))") }
        func scrollToTop() { run("window.scrollTo(0, 0)") }
        func scrollToEnd() { run("window.scrollTo(0, document.body.scrollHeight)") }
    }
}
