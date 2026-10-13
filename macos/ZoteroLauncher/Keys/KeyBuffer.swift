import Foundation

// Single keys (queueKey / flushKeys, ZoteroSearch.qml:2062-2087): with the list holding the keys,
// a key waits `delay`; another before then means typing, and both go to the search box. The clock
// is passed in, so the tests set it; the launcher calls tick when its timer fires.
struct KeyBuffer {
    let delay: TimeInterval
    private var text = ""
    private var due = Date.distantFuture

    init(delay: TimeInterval = 0.3) {
        self.delay = delay
    }

    var pending: Bool { !text.isEmpty }
    var deadline: Date? { pending ? due : nil }

    // A key through the router, the waiting one first when this key isn't another single key.
    // Esc, Shift+Esc and F1 drop it, as the QML does.
    mutating func handle(_ event: KeyEvent, _ state: KeyState, at now: Date) -> [KeyCommand] {
        if event.key == .escape || event.key == .f1 { drop() }
        var out = tick(at: now)
        if pending && !state.inNote && !(state.listKeys && event.printable) { out += flush() } // the reader's keys come first, as in the QML
        let command = KeyRouter.route(event, state)
        if case .queue(let typed) = command { return out + queue(typed, at: now) }
        return out + [command]
    }

    // A single key: it waits, or with the one waiting it is typing.
    mutating func queue(_ typed: String, at now: Date) -> [KeyCommand] {
        let late = tick(at: now) // the timer was late: the waiting key acts first
        text += typed
        if text.count > 1 {
            let both = text
            drop()
            return late + [.typing(both)]
        }
        due = now.addingTimeInterval(delay)
        return late
    }

    // The waiting key's action once its time is up.
    mutating func tick(at now: Date) -> [KeyCommand] {
        pending && now >= due ? flush() : []
    }

    private mutating func flush() -> [KeyCommand] {
        guard let c = text.first, text.count == 1 else { drop(); return [] }
        drop()
        return [KeyRouter.keyAction(c) ?? .keyActionOrTyping(c)]
    }

    // Nothing waiting: a view changed (push, back, open), as the QML clears keyBuffer.
    mutating func clear() {
        drop()
    }

    private mutating func drop() {
        text = ""
        due = .distantFuture
    }
}
