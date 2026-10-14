import Foundation
import JavaScriptCore

enum JSCoreError: Error, CustomStringConvertible {
    case noContext
    case missing(String)
    case exception(String)

    var description: String {
        switch self {
        case .noContext: return "JavaScriptCore didn't start"
        case .missing(let name): return "\(name) is missing from the app"
        case .exception(let message): return "the view logic failed: \(message)"
        }
    }
}

// The view logic (js/lib/*.js: rows, sections, settings pages, tasks, fuzzy matching, the app's own
// copy of the Omarchy launcher's) and the sync contract (Paths.js, shared with it), run in
// JavaScriptCore. Each file is plain ES5 that exports through `module.exports`; each gets its own
// `module`, and its exports become a global of that name, so Glue.js can reach them all. Swift
// calls Glue's wrappers, JSON in and out, so it sees plain Codable structs.
final class JSCore {
    static let libraries = ["Fuzzy", "Client", "Views", "Settings", "Todos"]
    static let glue = ["GlueLists.js", "GlueTodos.js", "GlueSearch.js", "GlueSettings.js", "GlueRunner.js", "GlueChat.js", "Glue.js"]

    private let context: JSContext
    private var modules: [String: JSValue] = [:]
    private var lastException: String?

    // `resources`: the folder holding lib/, Paths.js and Glue.js (the app bundle's Resources).
    init(resources: URL? = Bundle.main.resourceURL) throws {
        guard let context = JSContext() else { throw JSCoreError.noContext }
        self.context = context
        context.exceptionHandler = { [weak self] _, exception in
            self?.lastException = exception?.toString() ?? "unknown error"
        }
        var files = Self.libraries.map { (name: $0, path: "lib/\($0).js") }
        files.append((name: "Paths", path: "Paths.js"))
        files.append((name: "Merge", path: "Merge.js"))
        files.append((name: "Marked", path: "vendor/marked.umd.js")) // (its UMD exports through module)
        for file in files {
            let value = try load(resources?.appendingPathComponent(file.path), as: file.path)
            modules[file.name] = value
            context.setObject(value, forKeyedSubscript: file.name as NSString)
        }
        // GlueLists.js first: Glue.js merges it in.
        for name in Self.glue {
            guard let file = resources?.appendingPathComponent(name), let source = try? String(contentsOf: file, encoding: .utf8)
            else { throw JSCoreError.missing(name) }
            context.evaluateScript(source, withSourceURL: file)
            if let message = takeException() { throw JSCoreError.exception("\(name): \(message)") }
        }
        guard context.objectForKeyedSubscript("Glue")?.isObject == true else { throw JSCoreError.missing("Glue.js") }
    }

    private func load(_ file: URL?, as name: String) throws -> JSValue {
        guard let file, let source = try? String(contentsOf: file, encoding: .utf8) else { throw JSCoreError.missing(name) }
        let wrapped = "(function () { var module = { exports: {} }; var exports = module.exports;\n\(source)\n;return module.exports })()"
        let value = context.evaluateScript(wrapped, withSourceURL: file)
        if let message = takeException() { throw JSCoreError.exception("\(name): \(message)") }
        guard let value, value.isObject else { throw JSCoreError.missing(name) }
        return value
    }

    private func takeException() -> String? {
        defer { lastException = nil }
        return lastException
    }

    private func jsArguments(_ arguments: [Any]) throws -> [Any] {
        guard let json = context.objectForKeyedSubscript("JSON") else { throw JSCoreError.noContext }
        return try arguments.map { json.invokeMethod("parse", withArguments: [try Self.jsonText($0)]) as Any }
    }

    // A value as JSON text, a RawJSON's own text spliced in wherever it is (inside a dictionary or an
    // array too), so its keys keep their order.
    static func jsonText(_ value: Any) throws -> String {
        if let raw = value as? RawJSON { return raw.text }
        if let dict = value as? [String: Any] {
            return "{" + (try dict.map { try jsonText($0.key) + ":" + jsonText($0.value) }).joined(separator: ",") + "}"
        }
        if let list = value as? [Any] { return "[" + (try list.map(jsonText)).joined(separator: ",") + "]" }
        guard JSONSerialization.isValidJSONObject([value]) else { throw JSCoreError.exception("an argument JSON can't hold") }
        let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
        return String(decoding: data, as: UTF8.self)
    }

    private func stringify(_ result: JSValue?, _ what: String) throws -> String {
        if let message = takeException() { throw JSCoreError.exception("\(what): \(message)") }
        guard let json = context.objectForKeyedSubscript("JSON"),
              let text = json.invokeMethod("stringify", withArguments: [result as Any])?.toString(), text != "undefined"
        else { throw JSCoreError.exception("\(what) returned nothing") }
        return text
    }

    // A script's value as text (`typeof Views`, for the tests).
    func evaluate(_ script: String) throws -> String {
        let value = context.evaluateScript(script)
        if let message = takeException() { throw JSCoreError.exception(message) }
        return value?.toString() ?? ""
    }

    // Glue.function(...arguments): its answer as JSON text, as JSON.stringify writes it.
    func glueJSON(_ function: String, _ arguments: [Any]) throws -> String {
        guard let glue = context.objectForKeyedSubscript("Glue"),
              glue.objectForKeyedSubscript(function)?.isObject == true
        else { throw JSCoreError.missing("Glue.\(function)") }
        let result = glue.invokeMethod(function, withArguments: try jsArguments(arguments))
        return try stringify(result, "Glue.\(function)")
    }

    // Glue.function(...arguments), decoded.
    func glue<T: Decodable>(_ function: String, _ arguments: [Any], as type: T.Type) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(glueJSON(function, arguments).utf8))
    }

    // module.function(...arguments), each argument and the result through JSON.
    func call<T: Decodable>(_ module: String, _ function: String, _ arguments: [Any], as type: T.Type) throws -> T {
        guard let target = modules[module] else { throw JSCoreError.missing(module) }
        let result = target.invokeMethod(function, withArguments: try jsArguments(arguments))
        return try JSONDecoder().decode(T.self, from: Data(stringify(result, "\(module).\(function)").utf8))
    }

    // The launcher's rows for a /search answer (Views.buildRows), matches highlighted in `color`.
    func searchRows(_ response: [String: Any], color: String) throws -> [SearchRow] {
        try glue("searchRows", [response, color, ["noCommands": true]], as: [SearchRow].self)
    }
}
