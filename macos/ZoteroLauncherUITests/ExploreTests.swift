import XCTest

// The real app on screen, driven by a script of keys (TEST_RUNNER_ZL_UI_SCRIPT: one step a line), each `dump NAME`
// writing the app's accessibility tree and a picture of its window to the runner's temporary folder. For exploring
// flows by hand; the checked flows are in FlowTests.
final class ExploreTests: XCTestCase {
    func testRunTheScript() throws {
        let env = ProcessInfo.processInfo.environment
        guard let scriptPath = env["ZL_UI_SCRIPT"] else { throw XCTSkip("no script") }
        // (the runner is sandboxed: its own temporary folder, said in the log)
        let out = NSTemporaryDirectory() + "zl-ui"
        try? FileManager.default.removeItem(atPath: out)
        try FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
        print("ZL_UI_OUT=\(out)")
        let app = XCUIApplication()
        app.launchArguments = ["-ZLOpenOnLaunch", "YES"]
        app.launch()
        sleep(3)
        for raw in try String(contentsOfFile: scriptPath, encoding: .utf8).split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }
            if line.hasPrefix("dump ") {
                let name = String(line.dropFirst(5))
                try app.debugDescription.write(toFile: "\(out)/\(name).txt", atomically: true, encoding: .utf8)
                let w = app.dialogs.firstMatch.exists ? app.dialogs.firstMatch : app.windows.firstMatch
                if w.exists { try w.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(out)/\(name).png")) }
            } else if line.hasPrefix("wait ") {
                usleep(UInt32((Double(line.dropFirst(5)) ?? 1) * 1_000_000))
            } else if line.hasPrefix("type ") {
                app.typeText(String(line.dropFirst(5)))
                usleep(400_000)
            } else {
                Keys.press(line, in: app)
                usleep(400_000)
            }
        }
    }
}

// "down", "shift+enter", "opt+x", "cmd+w", "f1", "?"…
enum Keys {
    static func press(_ spec: String, in app: XCUIApplication) {
        var parts = spec.split(separator: "+").map(String.init)
        let name = parts.removeLast()
        var flags: XCUIElement.KeyModifierFlags = []
        for m in parts {
            switch m {
            case "shift": flags.insert(.shift)
            case "opt", "alt": flags.insert(.option)
            case "ctrl": flags.insert(.control)
            case "cmd": flags.insert(.command)
            default: break
            }
        }
        let named: [String: XCUIKeyboardKey] = ["down": .downArrow, "up": .upArrow, "left": .leftArrow, "right": .rightArrow, "enter": .return,
                                               "esc": .escape, "tab": .tab, "backspace": .delete, "del": .forwardDelete, "f1": .F1,
                                               "pgdn": .pageDown, "pgup": .pageUp, "home": .home, "end": .end, "space": .space]
        if let key = named[name] { app.typeKey(key, modifierFlags: flags) } else { app.typeKey(name, modifierFlags: flags) }
    }
}
