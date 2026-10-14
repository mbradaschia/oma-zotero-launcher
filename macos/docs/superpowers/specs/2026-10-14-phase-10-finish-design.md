# Phase 10: finish (design)

Phase 10 of [`macos/PLAN.md`](../../../PLAN.md) has no row ids of its own (parity is 166 of 166 after phase 9). It
covers what makes the app complete as a Mac app, and its release. Conventions: `macos/docs/ux-conventions.md`.

## 1. The keybindings panel (? and F1)

- `?` with the list's keys, or F1 anywhere (also while typing), opens the `keys` view: `Views.buildKeyRows`.
  - It begins with `Here · <where you are>` (`Views.keysContext`, with ⌥ keys in the ⌥-key mode).
  - Then every section of `KEYBINDINGS`.
  - Typing finds a key by any word. Esc clears, then goes back.
- **The keys in the Mac's notation** (Glue's `keyRows`):
  - Modifiers become ⌘ ⌥ ⌃ ⇧; Enter ↵, Esc esc, Backspace ⌫, Delete del, Tab tab.
  - Ctrl+S, Ctrl+V and Ctrl+-/+/0 become ⌘ (as the Mac binds them).
  - The Omarchy lines change: the hotkey (Super+Shift+Z) becomes the app's (⌃⌥Z by default, Settings › Hotkey);
    Super+W, Hyprland's close, becomes ⌘W in the overlay as a window.
- **Keys where the Mac has its own:**
  - The note reader's ? opens the same view.
  - The note window's and the chat window's ? show their own keys (the chat window's panel already does).
- The title is `‹ Keybindings · type to find one`; the hint `type to find a key · ↑↓ move · esc clear, then back`.

## 2. Open at login, the menu bar

- **Open at login** uses `SMAppService.mainApp`:
  - A toggle in the app's Settings window (next to the hotkey) and in the menu bar menu.
  - Its state is read from the service, not stored.
  - When macOS needs your OK (`requiresApproval`), the toggle says so and opens System Settings › General › Login
    Items.
- **The menu bar menu:**
  - Open the Launcher (its hotkey shown).
  - Chats…, Processes…, Settings… (the launcher's, on Settings).
  - Sync Zotero.
  - Open at Login, and *Hotkey and Login…* (the app's own Settings window: the hotkey and this toggle).
  - Quit.

## 3. Accessibility

- **Rows:** each list row is one accessibility element:
  - Its label, then its detail.
  - "dimmed" when unavailable; "selected" when highlighted.
  - The row's own keys as its hint (the footer's first two hints).
- **Pills** read as their text and kind ("status: reading").
- The **search box** says what it searches (the placeholder).
- **Reduce Motion:** no animated scrolling or transitions when the system asks for less motion
  (`accessibilityDisplayShouldReduceMotion`).
- **Larger text:** the reader's and windows' text size (⌘+ ⌘-) is kept per machine, as it is now. The list's font
  follows the system's size setting where SwiftUI does.

## 4. Performance

- **The budget:** a keystroke in a search over a 5,000-paper library is under 50 ms, the app adding at most 10 ms.
  Zotero does the searching; the app's share grows with the rows an answer has, at most 200 (General › Results per
  search), not with the library.
- **Measured** in XCTest on a made-up 200-result answer: `Glue.results` (JSON in, the rows out) and the rows'
  Codable decoding, under 10 ms on CI's machine class, with a margin.
- A failure prints the time each step took.

## 5. The release

- README and CHANGELOG for the Mac app (macos/README.md, a Mac section in CHANGELOG.md): what it does, how to install
  it, what differs from Omarchy.
- **`macos-v0.3.0` = parity:**
  - The build is the same `scripts/build.sh` / `install.sh`.
  - It is unsigned unless you choose the Apple Developer Program (your decision: 99 USD a year buys a signed,
    notarized build with Sparkle updates; without it, `install.sh` keeps working).
- Publishing a release is an outward step: prepared here (notes, the tag's name, the build checked), and published
  only with your OK.

## Testing

- The keys view's rows (goldens: `keyRows` here, typed, ⌥ mode) and the Mac notation.
- XCTest:
  - ? and F1 open it from the results, a menu, while typing.
  - The login item's toggle with a fake service.
  - The rows' accessibility labels.
  - Reduce Motion honoured.
- The performance test above.
