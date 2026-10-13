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

// The prompt runner, the only AI path (decision 6): `oma-zotero-prompt` with Client.promptArgv's
// argv. A protocol so the model's tests answer for it.
@MainActor
protocol Runner: AnyObject {
    // Run and wait (off the main thread): `stdin` written then closed; killed after `timeout`.
    func run(_ argv: [String], stdin: String?, timeout: TimeInterval, completion: @escaping @MainActor (RunnerResult) -> Void)
    // Started and left to run (a prompt, an extraction, an editor): its progress is in the
    // runner's tasks, not here. → started.
    @discardableResult func launch(_ argv: [String]) -> Bool
    // For the setup checklist: Node's version ("" when there's none), pdftotext on the PATH.
    var nodeVersion: String { get }
    var hasPdftotext: Bool { get }
}

// The runner as a process: a clean environment (HOME, the XDG and OMA_ZOTERO_* variables, LANG,
// TMPDIR, the API keys' variables the runner reads) with an explicit PATH: Node's folder,
// ~/.local/bin (where install-runner.sh links the command), Homebrew's and the system's. Never a
// login shell: on a Mac it often doesn't load Homebrew's environment (decision 7).
final class ProcessRunner: Runner {
    static let keptVariables = ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME",
                                "OMA_ZOTERO_PROMPTS_DIR", "OMA_ZOTERO_INSTRUCTIONS", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY",
                                "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "JEV_API_KEY", "TYPESAFE_API_KEY"]

    let base: [String: String]
    private var node: Node?
    private var nodeLooked = false
    private var anyNode: String?

    struct Node: Equatable {
        var path: String
        var major: Int
        var version: String
    }

    init(environment: [String: String] = ProcessInfo.processInfo.environment) {
        base = environment.filter { Self.keptVariables.contains($0.key) }
    }

    var home: String { base["HOME"] ?? NSHomeDirectory() }

    // Node 22 or newer, found where Macs keep it (Homebrew, nvm, Volta, fnm, /usr/local), newest first.
    func findNode() -> Node? {
        if nodeLooked { return node }
        nodeLooked = true
        node = Self.candidates(home: home).lazy.compactMap(Self.probe).first { $0.major >= 22 }
        return node
    }

    // Asked again (after an install), not the answer kept from before.
    func forgetNode() {
        nodeLooked = false
        node = nil
        anyNode = nil
    }

    static func candidates(home: String, fm: FileManager = .default) -> [String] {
        var out = ["/opt/homebrew/bin/node", "/usr/local/bin/node", home + "/.volta/bin/node"]
        for dir in [home + "/.nvm/versions/node", home + "/.local/share/fnm/node-versions", home + "/Library/Application Support/fnm/node-versions"] {
            let versions = ((try? fm.contentsOfDirectory(atPath: dir)) ?? []).sorted { $0.compare($1, options: .numeric) == .orderedDescending }
            out += versions.flatMap { [dir + "/" + $0 + "/bin/node", dir + "/" + $0 + "/installation/bin/node"] }
        }
        out.append("/usr/bin/node")
        return out.filter { fm.isExecutableFile(atPath: $0) }
    }

    // `node --version` → its major version.
    static func probe(_ path: String) -> Node? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = ["--version"]
        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return nil }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        let v = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        guard p.terminationStatus == 0, v.hasPrefix("v"), let major = Int(v.dropFirst().split(separator: ".").first ?? "") else { return nil }
        return Node(path: path, major: major, version: v)
    }

    // (an old one too, for the checklist's "old" badge; looked for once, forgotten after an install)
    var nodeVersion: String {
        if anyNode == nil { anyNode = findNode()?.version ?? Self.candidates(home: home).lazy.compactMap(Self.probe).first?.version ?? "" }
        let v = anyNode ?? ""
        return v.hasPrefix("v") ? String(v.dropFirst()) : v
    }

    var hasPdftotext: Bool { resolve("pdftotext") != nil }

    // The PATH every run gets.
    var path: String {
        var dirs: [String] = []
        if let node = findNode() { dirs.append((node.path as NSString).deletingLastPathComponent) }
        dirs += [home + "/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
        var seen = Set<String>()
        return dirs.filter { seen.insert($0).inserted }.joined(separator: ":")
    }

    var environment: [String: String] {
        var env = base
        env["PATH"] = path
        if env["LANG"] == nil { env["LANG"] = "en_US.UTF-8" }
        return env
    }

    // The command's file: a path as given, else found in PATH.
    func resolve(_ command: String) -> String? {
        let fm = FileManager.default
        if command.contains("/") {
            let full = (command as NSString).expandingTildeInPath
            return fm.isExecutableFile(atPath: full) ? full : nil
        }
        return path.split(separator: ":").map { $0 + "/" + command }.first { fm.isExecutableFile(atPath: $0) }
    }

    private func process(_ argv: [String]) -> Process? {
        guard let first = argv.first, let exe = resolve(first) else { return nil }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        p.arguments = Array(argv.dropFirst())
        p.environment = environment
        p.currentDirectoryURL = URL(fileURLWithPath: home)
        return p
    }

    func run(_ argv: [String], stdin: String?, timeout: TimeInterval, completion: @escaping @MainActor (RunnerResult) -> Void) {
        guard let p = process(argv) else {
            completion(RunnerResult(status: 127, missing: true))
            return
        }
        let out = Pipe(), err = Pipe(), input = Pipe()
        p.standardOutput = out
        p.standardError = err
        p.standardInput = stdin == nil ? FileHandle.nullDevice : input
        DispatchQueue.global(qos: .userInitiated).async {
            var result = RunnerResult()
            do { try p.run() } catch {
                result.status = 127
                result.missing = true
                DispatchQueue.main.async { MainActor.assumeIsolated { completion(result) } }
                return
            }
            if let stdin {
                input.fileHandleForWriting.write(Data(stdin.utf8))
                try? input.fileHandleForWriting.close()
            }
            // killed when it runs too long: SIGKILL, so its end says it was this (a runner's own
            // failure exits with a status, never this signal)
            let timer = DispatchSource.makeTimerSource(queue: .global())
            timer.schedule(deadline: .now() + timeout)
            timer.setEventHandler { if p.isRunning { kill(p.processIdentifier, SIGKILL) } }
            timer.resume()
            // both pipes read at once: a full stderr can't block the run while stdout is read
            let group = DispatchGroup()
            var outData = Data(), errData = Data()
            group.enter()
            DispatchQueue.global().async { outData = out.fileHandleForReading.readDataToEndOfFile(); group.leave() }
            group.enter()
            DispatchQueue.global().async { errData = err.fileHandleForReading.readDataToEndOfFile(); group.leave() }
            group.wait()
            p.waitUntilExit()
            timer.cancel()
            result.status = p.terminationStatus
            result.stdout = String(decoding: outData, as: UTF8.self)
            result.stderr = String(decoding: errData, as: UTF8.self)
            result.timedOut = p.terminationReason == .uncaughtSignal && p.terminationStatus == SIGKILL
            DispatchQueue.main.async { MainActor.assumeIsolated { completion(result) } }
        }
    }

    @discardableResult
    func launch(_ argv: [String]) -> Bool {
        guard let p = process(argv) else { return false }
        p.standardInput = FileHandle.nullDevice
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        return (try? p.run()) != nil
    }
}
