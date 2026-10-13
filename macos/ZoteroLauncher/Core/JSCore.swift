import Foundation
import JavaScriptCore

enum JSCoreError: Error, CustomStringConvertible {
    case noContext
    case missing(String)
    case exception(String)

    var description: String {
        switch self {
        case .noContext: return "JavaScriptCore didn't start"
        case .missing(let name): return "lib/\(name).js is missing from the app"
        case .exception(let message): return "the view logic failed: \(message)"
        }
    }
}

// The view logic the Omarchy launcher runs in QML (lib/*.js: rows, sections, settings pages, tasks,
// fuzzy matching), run here in JavaScriptCore so both launchers share one source of truth. Each
// file is plain ES5 that exports through `module.exports`; each gets its own `module`. Values go
// in and out as JSON, so Swift sees plain Codable structs.
final class JSCore {
    static let libraries = ["Fuzzy", "Client", "Views", "Settings", "Todos"]

    private let context: JSContext
    private var modules: [String: JSValue] = [:]
    private var lastException: String?

    init(libDirectory: URL? = Bundle.main.resourceURL?.appendingPathComponent("lib", isDirectory: true)) throws {
        guard let context = JSContext() else { throw JSCoreError.noContext }
        self.context = context
        context.exceptionHandler = { [weak self] _, exception in
            self?.lastException = exception?.toString() ?? "unknown error"
        }
        for name in Self.libraries {
            guard let file = libDirectory?.appendingPathComponent("\(name).js"),
                  let source = try? String(contentsOf: file, encoding: .utf8)
            else { throw JSCoreError.missing(name) }
            let wrapped = "(function () { var module = { exports: {} };\n\(source)\n;return module.exports })()"
            let value = context.evaluateScript(wrapped, withSourceURL: file)
            if let message = takeException() { throw JSCoreError.exception("\(name).js: \(message)") }
            guard let value, value.isObject else { throw JSCoreError.missing(name) }
            modules[name] = value
        }
    }

    private func takeException() -> String? {
        defer { lastException = nil }
        return lastException
    }

    // module.function(...arguments), each argument and the result through JSON.
    func call<T: Decodable>(_ module: String, _ function: String, _ arguments: [Any], as type: T.Type) throws -> T {
        guard let target = modules[module] else { throw JSCoreError.missing(module) }
        guard let json = context.objectForKeyedSubscript("JSON") else { throw JSCoreError.noContext }
        var jsArguments: [Any] = []
        for argument in arguments {
            let data = try JSONSerialization.data(withJSONObject: argument, options: [.fragmentsAllowed])
            jsArguments.append(json.invokeMethod("parse", withArguments: [String(decoding: data, as: UTF8.self)]) as Any)
        }
        let result = target.invokeMethod(function, withArguments: jsArguments)
        if let message = takeException() { throw JSCoreError.exception("\(module).\(function): \(message)") }
        guard let text = json.invokeMethod("stringify", withArguments: [result as Any])?.toString(), text != "undefined" else {
            throw JSCoreError.exception("\(module).\(function) returned nothing")
        }
        return try JSONDecoder().decode(T.self, from: Data(text.utf8))
    }

    // The launcher's rows for a /search answer (Views.buildRows), matches highlighted in `color`.
    func searchRows(_ response: [String: Any], color: String) throws -> [Row] {
        try call("Views", "buildRows", [response, color, ["noCommands": true]], as: [Row].self)
    }
}
