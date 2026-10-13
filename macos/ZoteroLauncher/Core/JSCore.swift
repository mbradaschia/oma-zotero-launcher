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
        for file in files {
            let value = try load(resources?.appendingPathComponent(file.path), as: file.path)
            modules[file.name] = value
            context.setObject(value, forKeyedSubscript: file.name as NSString)
        }
        guard let glue = resources?.appendingPathComponent("Glue.js"),
              let source = try? String(contentsOf: glue, encoding: .utf8)
        else { throw JSCoreError.missing("Glue.js") }
        context.evaluateScript(source, withSourceURL: glue)
        if let message = takeException() { throw JSCoreError.exception("Glue.js: \(message)") }
        guard context.objectForKeyedSubscript("Glue")?.isObject == true else { throw JSCoreError.missing("Glue.js") }
    }

    private func load(_ file: URL?, as name: String) throws -> JSValue {
        guard let file, let source = try? String(contentsOf: file, encoding: .utf8) else { throw JSCoreError.missing(name) }
        let wrapped = "(function () { var module = { exports: {} };\n\(source)\n;return module.exports })()"
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
        return try arguments.map { argument in
            let data = try JSONSerialization.data(withJSONObject: argument, options: [.fragmentsAllowed])
            return json.invokeMethod("parse", withArguments: [String(decoding: data, as: UTF8.self)]) as Any
        }
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
    func searchRows(_ response: [String: Any], color: String) throws -> [Row] {
        try glue("searchRows", [response, color, ["noCommands": true]], as: [Row].self)
    }
}
