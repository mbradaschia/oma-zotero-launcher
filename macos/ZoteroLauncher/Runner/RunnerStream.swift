import Foundation

// A run being streamed (a chat's turn): stop() ends it, SIGTERM (the runner's `chat` has no handler: it
// ends at once; reference/ChatWindow.qml stops a turn the same way).
protocol RunnerStream: AnyObject {
    func stop()
}

extension ProcessRunner {
    // Its lines as they come, an hour at most. A line is what ends with "\n" (a last one without it, at the
    // end); stderr is kept for the end's problem.
    @discardableResult
    func stream(_ argv: [String], stdin: String?, onLine: @escaping @MainActor (String) -> Void, completion: @escaping @MainActor (RunnerResult) -> Void) -> RunnerStream? {
        let run = StreamedRun() // (the command is looked for on the queue: finding Node may run it)
        queue.async { [self] in
            let deliver = { (line: String) in DispatchQueue.main.async { MainActor.assumeIsolated { onLine(line) } } }
            let finish = { (r: RunnerResult) in DispatchQueue.main.async { MainActor.assumeIsolated { completion(r) } } }
            guard let p = process(argv) else { return finish(RunnerResult(status: 127, missing: true)) }
            let out = Pipe(), err = Pipe(), input = Pipe()
            p.standardOutput = out
            p.standardError = err
            p.standardInput = stdin == nil ? FileHandle.nullDevice : input
            let outDone = DispatchSemaphore(value: 0), errDone = DispatchSemaphore(value: 0), exited = DispatchSemaphore(value: 0)
            let lines = LineBuffer()
            out.fileHandleForReading.readabilityHandler = { h in
                let d = h.availableData
                if d.isEmpty {
                    h.readabilityHandler = nil
                    if let rest = lines.flush() { deliver(rest) }
                    outDone.signal()
                } else {
                    lines.add(d).forEach(deliver)
                }
            }
            let errText = LineBuffer()
            err.fileHandleForReading.readabilityHandler = { h in
                let d = h.availableData
                if d.isEmpty { h.readabilityHandler = nil; errDone.signal() } else { errText.keep(d) }
            }
            p.terminationHandler = { _ in exited.signal() }
            do { try p.run() } catch {
                out.fileHandleForReading.readabilityHandler = nil
                err.fileHandleForReading.readabilityHandler = nil
                return finish(RunnerResult(status: 127, missing: true))
            }
            run.started(p.processIdentifier)
            if let stdin {
                try? input.fileHandleForWriting.write(contentsOf: Data(stdin.utf8))
                try? input.fileHandleForWriting.close()
            }
            var result = RunnerResult()
            if exited.wait(timeout: .now() + 3600) == .timedOut {
                result.timedOut = true
                kill(p.processIdentifier, SIGKILL)
                exited.wait()
            }
            _ = outDone.wait(timeout: .now() + 1)
            _ = errDone.wait(timeout: .now() + 1)
            out.fileHandleForReading.readabilityHandler = nil
            err.fileHandleForReading.readabilityHandler = nil
            run.ended()
            result.status = p.terminationStatus
            result.stderr = errText.kept
            finish(result)
        }
        return run
    }
}

// The process being streamed, stopped from the main thread while it runs on the runner's queue.
final class StreamedRun: RunnerStream, @unchecked Sendable {
    private let lock = NSLock()
    private var pid: pid_t = 0
    private var stopWanted = false
    private var over = false

    func started(_ pid: pid_t) {
        lock.lock()
        self.pid = pid
        let stopNow = stopWanted
        lock.unlock()
        if stopNow { kill(pid, SIGTERM) }
    }

    func ended() {
        lock.lock()
        over = true
        lock.unlock()
    }

    func stop() {
        lock.lock()
        defer { lock.unlock() }
        guard !over else { return }
        if pid > 0 { kill(pid, SIGTERM) } else { stopWanted = true }
    }
}

// Bytes in, whole lines out (UTF-8 never cut in a character: lines split on the newline byte).
final class LineBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private var pending = Data()
    private(set) var kept = ""

    func add(_ data: Data) -> [String] {
        lock.lock()
        defer { lock.unlock() }
        pending.append(data)
        var out: [String] = []
        while let nl = pending.firstIndex(of: 0x0A) {
            out.append(String(decoding: pending[pending.startIndex..<nl], as: UTF8.self))
            pending.removeSubrange(pending.startIndex...nl)
        }
        return out
    }

    func flush() -> String? {
        lock.lock()
        defer { lock.unlock() }
        guard !pending.isEmpty else { return nil }
        let rest = String(decoding: pending, as: UTF8.self)
        pending = Data()
        return rest
    }

    func keep(_ data: Data) {
        lock.lock()
        kept += String(decoding: data, as: UTF8.self)
        if kept.count > 20000 { kept = String(kept.suffix(20000)) }
        lock.unlock()
    }
}
