import Foundation

// What a run of the prompt runner gave back.
struct RunnerResult: Equatable {
    var status: Int32 = 0
    var stdout = ""
    var stderr = ""
    var timedOut = false
    var missing = false // the command wasn't found (not installed, or no Node)

    var ok: Bool { status == 0 && !timedOut && !missing }

    // Why it failed, in a line: the runner's last stderr line (without its name), else what happened.
    var problem: String {
        if missing { return "the AI features aren't installed (Settings › Setup)" }
        if timedOut { return "it didn't answer in time" }
        var last = stderr.split(whereSeparator: \.isNewline).last.map(String.init) ?? ""
        if last.hasPrefix("oma-zotero-prompt: ") { last = String(last.dropFirst("oma-zotero-prompt: ".count)) }
        return last.isEmpty ? "it stopped (exit \(status))" : last
    }

    // stdout as JSON, nil when it isn't.
    var json: Any? { try? JSONSerialization.jsonObject(with: Data(stdout.utf8)) }
}

// What the setup checklist needs to know of this Mac: Node's version ("" none), pdftotext, tesseract (OCR).
struct Requirements: Equatable {
    var node = ""
    var pdftotext = false
    var tesseract = false
}

// The prompt runner, the only AI path (decision 6): `oma-zotero-prompt` with Client.promptArgv's
// argv. A protocol so the model's tests answer for it.
@MainActor
protocol Runner: AnyObject {
    // Run and wait (off the main thread): `stdin` written then closed; killed after `timeout`.
    func run(_ argv: [String], stdin: String?, timeout: TimeInterval, completion: @escaping @MainActor (RunnerResult) -> Void)
    // Started and left to run (a prompt, an extraction, an editor): its progress is in the
    // runner's tasks, not here. → started.
    @discardableResult func launch(_ argv: [String]) -> Bool
    // Looked for again (off the main thread): Node may have been installed since.
    func requirements(completion: @escaping @MainActor (Requirements) -> Void)
    // Run, its stdout read line by line as it comes (a chat's events; RunnerStream.swift): `stdin` written
    // then closed; each line, then the end, on the main actor. → the run, to stop; nil when not started.
    @discardableResult
    func stream(_ argv: [String], stdin: String?, onLine: @escaping @MainActor (String) -> Void, completion: @escaping @MainActor (RunnerResult) -> Void) -> RunnerStream?
}

// The runner as a process: a clean environment (HOME, the XDG and OMA_ZOTERO_* variables, LANG,
// TMPDIR, the API keys' variables the runner reads) with an explicit PATH: Node's folder,
// ~/.local/bin (where install-runner.sh links the command), Homebrew's and the system's. Never a
// login shell: on a Mac it often doesn't load Homebrew's environment (decision 7). Node is looked
// for off the main thread (a slow shim must not freeze the launcher) and kept until asked again.
final class ProcessRunner: Runner, @unchecked Sendable {
    static let keptVariables = ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME",
                                "OMA_ZOTERO_PROMPTS_DIR", "OMA_ZOTERO_INSTRUCTIONS", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY",
                                "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "JEV_API_KEY", "TYPESAFE_API_KEY"]

    let base: [String: String]
    private let lock = NSLock()
    private var node: Node?
    private var nodeLooked = false
    let queue = DispatchQueue(label: "oma-zotero.runner", qos: .userInitiated, attributes: .concurrent)

    struct Node: Equatable {
        var path: String
        var major: Int
        var version: String
    }

    init(environment: [String: String] = ProcessInfo.processInfo.environment) {
        var kept = environment.filter { Self.keptVariables.contains($0.key) }
        // an app started from the Dock has no LANG: the Mac's language, for the runner (OCR reads it too)
        if kept["LANG"] == nil && kept["LC_ALL"] == nil { kept["LANG"] = Locale.current.identifier.replacingOccurrences(of: "-", with: "_") + ".UTF-8" }
        base = kept
        signal(SIGPIPE, SIG_IGN) // a runner gone before its stdin is written: an error to read, not the app killed
    }

    var home: String { base["HOME"] ?? NSHomeDirectory() }

    // Node 22 or newer, found where Macs keep it (Homebrew, nvm, Volta, fnm, /usr/local), newest
    // first; looked for once until forgotten. Never on the main thread (it runs `node --version`).
    func findNode() -> Node? {
        lock.lock()
        defer { lock.unlock() }
        if nodeLooked { return node }
        nodeLooked = true
        node = Self.candidates(home: home).lazy.compactMap { Self.probe($0) }.first { $0.major >= 22 }
        return node
    }

    func forgetNode() {
        lock.lock()
        nodeLooked = false
        node = nil
        lock.unlock()
    }

    static func candidates(home: String, fm: FileManager = .default) -> [String] {
        var out = ["/opt/homebrew/bin/node", "/usr/local/bin/node", home + "/.volta/bin/node"]
        for dir in [home + "/.nvm/versions/node", home + "/.local/share/fnm/node-versions", home + "/Library/Application Support/fnm/node-versions"] {
            let names: [String] = (try? fm.contentsOfDirectory(atPath: dir)) ?? []
            let versions = names.sorted { (a: String, b: String) -> Bool in a.compare(b, options: .numeric) == .orderedDescending }
            for v in versions {
                let base: String = "\(dir)/\(v)"
                out.append(base + "/bin/node")
                out.append(base + "/installation/bin/node")
            }
        }
        out.append("/usr/bin/node")
        return out.filter { fm.isExecutableFile(atPath: $0) }
    }

    // `node --version` → its major version; nothing from one that doesn't answer in `timeout`.
    static func probe(_ path: String, timeout: TimeInterval = 3) -> Node? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = ["--version"]
        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice
        p.standardInput = FileHandle.nullDevice
        let exited = DispatchSemaphore(value: 0)
        p.terminationHandler = { _ in exited.signal() }
        guard (try? p.run()) != nil else { return nil }
        if exited.wait(timeout: .now() + timeout) == .timedOut {
            kill(p.processIdentifier, SIGKILL)
            return nil
        }
        let data = out.fileHandleForReading.availableData
        let v = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        guard p.terminationStatus == 0, v.hasPrefix("v"), let major = Int(v.dropFirst().split(separator: ".").first ?? "") else { return nil }
        return Node(path: path, major: major, version: v)
    }

    func requirements(completion: @escaping @MainActor (Requirements) -> Void) {
        forgetNode()
        queue.async { [self] in
            let node = findNode()?.version ?? Self.candidates(home: home).lazy.compactMap { Self.probe($0) }.first?.version ?? ""
            let r = Requirements(node: node.hasPrefix("v") ? String(node.dropFirst()) : node, pdftotext: resolve("pdftotext") != nil, tesseract: resolve("tesseract") != nil)
            DispatchQueue.main.async { MainActor.assumeIsolated { completion(r) } }
        }
    }

    // The PATH every run gets. `probing: false`: Node's folder only if it was found already (nothing
    // run to find it: for the main thread).
    func path(probing: Bool = true) -> String {
        var dirs: [String] = []
        let known: Node? = probing ? findNode() : { lock.lock(); defer { lock.unlock() }; return node }()
        if let node = known { dirs.append((node.path as NSString).deletingLastPathComponent) }
        dirs += [home + "/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
        var seen = Set<String>()
        return dirs.filter { seen.insert($0).inserted }.joined(separator: ":")
    }

    var environment: [String: String] {
        var env = base
        env["PATH"] = path()
        if env["LANG"] == nil { env["LANG"] = "en_US.UTF-8" }
        return env
    }

    // The command's file: a path as given, else found in PATH.
    func resolve(_ command: String, probing: Bool = true) -> String? {
        let fm = FileManager.default
        if command.contains("/") {
            let full = (command as NSString).expandingTildeInPath
            return fm.isExecutableFile(atPath: full) ? full : nil
        }
        return path(probing: probing).split(separator: ":").map { $0 + "/" + command }.first { fm.isExecutableFile(atPath: $0) }
    }

    func process(_ argv: [String]) -> Process? {
        guard let first = argv.first, let exe = resolve(first) else { return nil }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        p.arguments = Array(argv.dropFirst())
        p.environment = environment
        p.currentDirectoryURL = URL(fileURLWithPath: home)
        return p
    }

    // What a run collects, from two readers and the deadline.
    private final class Collected: @unchecked Sendable {
        let lock = NSLock()
        var out = Data()
        var err = Data()
        func add(_ data: Data, toErr: Bool) {
            lock.lock()
            if toErr { err.append(data) } else { out.append(data) }
            lock.unlock()
        }
    }

    func run(_ argv: [String], stdin: String?, timeout: TimeInterval, completion: @escaping @MainActor (RunnerResult) -> Void) {
        queue.async { [self] in
            let finish = { (r: RunnerResult) in DispatchQueue.main.async { MainActor.assumeIsolated { completion(r) } } }
            guard let p = process(argv) else { return finish(RunnerResult(status: 127, missing: true)) }
            let out = Pipe(), err = Pipe(), input = Pipe()
            p.standardOutput = out
            p.standardError = err
            p.standardInput = stdin == nil ? FileHandle.nullDevice : input
            let got = Collected()
            let outDone = DispatchSemaphore(value: 0), errDone = DispatchSemaphore(value: 0), exited = DispatchSemaphore(value: 0)
            // both pipes read as they fill: a full stderr never blocks the run
            out.fileHandleForReading.readabilityHandler = { h in
                let d = h.availableData
                if d.isEmpty { h.readabilityHandler = nil; outDone.signal() } else { got.add(d, toErr: false) }
            }
            err.fileHandleForReading.readabilityHandler = { h in
                let d = h.availableData
                if d.isEmpty { h.readabilityHandler = nil; errDone.signal() } else { got.add(d, toErr: true) }
            }
            p.terminationHandler = { _ in exited.signal() }
            do { try p.run() } catch {
                out.fileHandleForReading.readabilityHandler = nil
                err.fileHandleForReading.readabilityHandler = nil
                return finish(RunnerResult(status: 127, missing: true))
            }
            let deadline = DispatchTime.now() + timeout // from the start, stdin included
            if let stdin {
                try? input.fileHandleForWriting.write(contentsOf: Data(stdin.utf8))
                try? input.fileHandleForWriting.close()
            }
            var result = RunnerResult()
            if exited.wait(timeout: deadline) == .timedOut {
                result.timedOut = true
                kill(p.processIdentifier, SIGKILL)
                exited.wait()
            }
            // what it wrote; a grandchild still holding the pipes (npm under install-runner.sh)
            // isn't waited for beyond a moment
            _ = outDone.wait(timeout: .now() + 1)
            _ = errDone.wait(timeout: .now() + 1)
            out.fileHandleForReading.readabilityHandler = nil
            err.fileHandleForReading.readabilityHandler = nil
            got.lock.lock()
            result.stdout = String(decoding: got.out, as: UTF8.self)
            result.stderr = String(decoding: got.err, as: UTF8.self)
            got.lock.unlock()
            result.status = p.terminationStatus
            finish(result)
        }
    }

    // Checked here (the command there, nothing probed), started on the runner's queue (finding Node
    // may run it): the main thread never waits.
    @discardableResult
    func launch(_ argv: [String]) -> Bool {
        guard let first = argv.first, resolve(first, probing: false) != nil else { return false }
        queue.async { [self] in
            guard let p = process(argv) else { return }
            p.standardInput = FileHandle.nullDevice
            p.standardOutput = FileHandle.nullDevice
            p.standardError = FileHandle.nullDevice
            if (try? p.run()) == nil { NSLog("ZoteroLauncher: couldn't start %@", first) }
        }
        return true
    }
}
