import Foundation

// A key press as the router reads it: which key, what it types, and the modifiers. Option is the
// QML's Alt; ⌘ only matters for ⌘V, which pastes as Ctrl+V does.
struct KeyEvent: Equatable {
    enum Key: Equatable {
        case escape, f1, enter, tab, backtab, backspace, delete
        case up, down, left, right, pageUp, pageDown, home, end
        case character(Character) // lowercased, as the QML's key code: a letter, a digit, a symbol, the space
    }

    var key: Key
    var text: String // what it types; "" with ⌃, ⌥ or ⌘ held
    var shift = false
    var control = false
    var option = false
    var command = false

    // A typing key with no modifier but Shift (the QML's printable test).
    var printable: Bool {
        guard !control && !option && !command, text.count == 1, let scalar = text.unicodeScalars.first else { return false }
        return scalar.value >= 32 && scalar.value != 127
    }

    // AppKit's key codes (kVK_*) for the keys that aren't characters.
    private static let special: [UInt16: Key] = [53: .escape, 122: .f1, 36: .enter, 76: .enter, 48: .tab, 51: .backspace, 117: .delete,
                                                 126: .up, 125: .down, 123: .left, 124: .right, 116: .pageUp, 121: .pageDown, 115: .home, 119: .end]

    init(key: Key, text: String, shift: Bool = false, control: Bool = false, option: Bool = false, command: Bool = false) {
        self.key = key
        self.text = text
        self.shift = shift
        self.control = control
        self.option = option
        self.command = command
    }

    // From an NSEvent's keyCode, characters and charactersIgnoringModifiers. With ⌥ the key is the
    // letter under it (⌥T types "†"; ⌥E is a dead key that types nothing yet): the key, not what it
    // types. A dead key without ⌥ (' on a US International layout) types itself.
    init(keyCode: UInt16, characters: String?, ignoringModifiers: String?, shift: Bool, control: Bool, option: Bool, command: Bool) {
        self.shift = shift
        self.control = control
        self.option = option
        self.command = command
        if let special = Self.special[keyCode] {
            key = special == .tab && shift ? .backtab : special
            text = ""
            return
        }
        let base = ignoringModifiers ?? characters ?? ""
        key = .character(Character(base.first.map { String($0).lowercased() } ?? "\u{0}"))
        if control || option || command { text = "" }
        else if let typed = characters, !typed.isEmpty { text = typed }
        else { text = base }
    }
}
