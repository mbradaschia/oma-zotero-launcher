# macOS port: a native app

An audit of `v0.2.1` + `master` (1de84ed) for running the launcher on macOS, and the plan for a
native SwiftUI app. Phase 1 (the shared core) is done in this branch; the rest is the plan.

## Verdict

The launcher has three layers, and they port very differently:

| Layer | Lines | Runs in | macOS effort |
|---|---|---|---|
| **Zotero bridge** (`zotero-bridge/`) | ~5k | Zotero itself (Gecko JS) | **None for users.** The `.xpi` is the same; only the dev scripts assume Linux |
| **Prompt runner** (`daemon/`) | ~5k | Node 22 | **Done (phase 1).** Keyring, notify/open, Homebrew paths, handshake path |
| **Launcher UI** (`*.qml`) | ~11k | Omarchy shell (Quickshell on Hyprland/Wayland) | **New native app.** Quickshell has no macOS backend |
| **View logic** (`lib/*.js`) | ~4.5k | QML's JS engine | **Reused as is** through JavaScriptCore |

The QML doesn't port: every file imports `Quickshell`, `Quickshell.Wayland`/`Quickshell.Hyprland`,
and Omarchy's own `qs.Commons` / `qs.Ui` (Style, Color, Border, Util), none of which exist on macOS.
`lib/*.js` (Views, Settings, Todos, Fuzzy, Client) is pure, Qt-free, node-tested ES5: the rows, sections,
badges, settings pages, task lists and fuzzy matching. macOS ships JavaScriptCore, so the native app
runs those same files instead of rewriting them in Swift. One source of truth for both frontends.

**Its own repository: [zotero-launcher-macos](https://github.com/mbradaschia/zotero-launcher-macos).**
The bridge, the runner and `lib/*.js` stay here, the one place they're written; the Mac app pins this
repository as a git submodule (`shared/`) and bundles `lib/*.js` from it. Users install the same `.xpi`
from this repository's releases. A change to the shared parts lands here first, then the Mac app moves
its pin.

## 1. Zotero bridge

| Issue | Where | Status |
|---|---|---|
| Handshake path. Zotero writes `bridge.json` to `$XDG_RUNTIME_DIR` or, unset (always on macOS), `PathUtils.tempDir` = the per-user `$TMPDIR` (`/var/folders/…/T/`). The runner read `$XDG_RUNTIME_DIR` or `/tmp`: on macOS they never met. | `zotero-bridge/lib/bridge.js:749`, `daemon/lib/bridge.mjs:7` | **Fixed** in the runner: `XDG_RUNTIME_DIR`, else `TMPDIR`, else `/tmp`. The app uses `NSTemporaryDirectory()` (the same directory). Check on a real Mac in phase 2. |
| Dev scripts assume Linux Zotero | `scripts/bridge-dev-link.sh:20` (`~/.zotero/zotero`), `:35` (`pgrep zotero-bin`); `fresh-install-test.sh:50` | Open. macOS profile: `~/Library/Application Support/Zotero/Profiles`; binary `/Applications/Zotero.app/Contents/MacOS/zotero`. Only needed to develop the bridge on a Mac. |
| `sha256sum` in the `.xpi` build | `scripts/build-xpi.sh:48`, `install-bridge.sh:27` | Open, dev only (`shasum -a 256`). Releases build on Linux CI. |

## 2. Prompt runner (`daemon/`): done

| Was | Now |
|---|---|
| `secret-tool` only | `daemon/lib/secrets.mjs`: the login **Keychain** through `/usr/bin/security` on macOS. The key goes on stdin (`security -i`), never on a command line; it's read back to confirm; error text has the key cut out. Items trust `/usr/bin/security`, so the runner reads them without a prompt. The app must store keys through the runner (`secret set`, on stdin, as the QML does), not with `SecItemAdd`, or every read would prompt. |
| `notify-send` | `daemon/lib/platform.mjs` `notify()`: `osascript`, the text passed as arguments, never into the script |
| `omarchy-launch-editor` / `xdg-open` | `openInEditor()`: `open -t` |
| Tools found on PATH only | `toolPath()`: on macOS the runner adds `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin` to its PATH (an app-launched process has none of them): `pdftotext`, `ollama`, `claude`, `codex` are found |
| Chromium on PATH only | `daemon/lib/layout.mjs`: also the app bundles in `/Applications` (Chrome, Chromium, Brave, Edge, Vivaldi) |
| `omarchy pkg add …` hints | `installHint()`: `brew install …` on macOS |
| `stat -c`, `realpath -e` in `scripts/safe-dest.sh` (used by `install-runner.sh`) | GNU, else BSD forms |
| CI on Linux only | `test-macos` job: the unit tests on `macos-latest` |

Tests: `tests/platform.test.js` (PATH, hints, notify argv, editor, handshake path) and a Keychain test in
`tests/providers.test.js` with a fake `security` that fails if the key ever shows up in its argv.

## 3. The native app (`macos/`)

### Stack

- **SwiftUI + AppKit**, macOS 14+ (`.onKeyPress`, `@Observable`). A menu-bar agent (`LSUIElement`): no Dock
  icon, starts at login (`SMAppService`).
- **Project**: XcodeGen (`macos/project.yml`) so the project file is text you can review; CI runs
  `xcodegen` then `xcodebuild` on `macos-latest`.
- **Dependencies (SPM)**: [KeyboardShortcuts](https://github.com/sindresorhus/KeyboardShortcuts) for the
  global hotkey (user-recordable, no Accessibility permission), and a Markdown renderer for notes
  ([swift-markdown-ui](https://github.com/gonzalezreal/swift-markdown-ui)). Nothing else.

### What replaces what

| Linux (QML) | macOS (Swift) |
|---|---|
| Hyprland binding → `omarchy-shell` panel | KeyboardShortcuts global hotkey, default ⌃⌥Z (⌘⇧Z is Redo in most apps; rebindable in Settings) |
| `PanelWindow` + `WlrLayershell` overlay (`ZoteroSearch.qml`) | A borderless, floating `NSPanel` (Spotlight-style), centered, closes on Esc or losing focus |
| `FloatingWindow` note and chat windows | Regular SwiftUI windows: they tile, go fullscreen, sit in Stage Manager next to the PDF |
| `XMLHttpRequest` to the bridge (`Service.qml`) | `URLSession` → `127.0.0.1:<port>/oma-zotero/…`, Bearer token, a User-Agent that doesn't start with `Mozilla/` (Zotero drops those; `lib/Client.js`) |
| Handshake in `$XDG_RUNTIME_DIR` | `NSTemporaryDirectory()/oma-zotero/bridge.json`, watched with a `DispatchSource` so Zotero restarts are picked up |
| `lib/*.js` in QML's engine | The same files bundled as resources, run in a `JSContext`; rows come back as JSON and decode into Swift structs |
| Qt StyledText in titles (`<b>`, `<font color>`, `<a>`) | A small converter to `AttributedString` |
| `Process` / `StdioCollector` (~30 in `Service.qml`) | `Foundation.Process` running the runner by absolute path, JSON on stdout; chat streams JSON lines |
| `FileView` (settings, pins, tasks.json) | `DispatchSource` file watchers |
| `wl-copy` / `wl-paste` | `NSPasteboard` |
| `xdg-open`, `uwsm-app` | `NSWorkspace.open` |
| `notify-send` | `UNUserNotificationCenter` |
| Focus Zotero's window (`Hyprland.dispatch`) | `NSRunningApplication` activate `org.zotero.zotero`; the tab is selected by the bridge, as now |
| `qs.Commons` Style/Color, Omarchy theme | System colors, SF fonts, light/dark; accent from the system |
| Nerd Font glyphs (`lib/Views.js` `ICONS`) | SF Symbols, mapped by icon name |
| Floating terminal for installs (`Settings › Setup`) | Runs inline; progress in Processes, as the runner already reports |

### What stays exactly the same

The keyboard scheme is the product, and a native app can keep all of it: one key acts on the list,
typing goes to the search box after the 0.3 s window, `Alt+1…9`, `Alt+letter` actions, `Shift+Enter` to
Zotero, `Esc` back, `/` to search. The settings file, pins, prompts, taxonomies, chats and tasks live in
the same files the runner and bridge already use (`~/.config/omarchy/oma-zotero-launcher*`,
`~/.local/state/oma-zotero/`). A Mac and an Omarchy machine read the same formats.

### Layout (zotero-launcher-macos)

```
shared/                       this repository, pinned (git submodule)
project.yml                   XcodeGen
ZoteroLauncher/
  App/                        menu-bar agent, hotkey, login item
  Launcher/                   the NSPanel, its model and views
  Bridge/                     handshake, URLSession client
  Core/JSCore.swift           loads lib/*.js into a JSContext; typed calls into Views/Settings/Todos/Fuzzy
  Core/StyledText.swift       Qt StyledText → AttributedString
  Runner/                     Process wrapper for oma-zotero-prompt, chat stream (phase 3)
  Settings/
ZoteroLauncherTests/          handshake, bridge client, JS rows, StyledText
```

`shared/lib` is copied into the app bundle at build time, never duplicated.

## Phased plan

1. **Shared core portable**: done here (section 2).
2. **Skeleton** (about 1 week): the app target, hotkey, panel, handshake + bridge client, `JSContext`
   loading `lib/*.js`, search results as rows. Proves the two risky parts: JavaScriptCore running the
   view logic, and the panel taking keys without stealing focus wrongly. CI builds it.
3. **MVP** (2-3 weeks): paper menu, open PDF / show in Zotero, copy citation and bibliography, note
   reader and note window, tags, pins, run a prompt, Processes.
4. **Parity** (3-4 weeks): chat window, collections and saved searches, `@` pickers, Settings (providers,
   keys through the runner, rules, taxonomies), runner install from the app.
5. **Release**: an unsigned build from CI for your own Mac first. A signed, notarized `.app` for others
   needs an Apple Developer Program membership (99 USD a year): your call, later.

## What this needs from you

- **A Mac to run it on.** CI can build and unit-test the app, but only you can try the panel, the hotkey
  and the keys. Each phase ends with a build you run and a short list of things to check.
- **Xcode** on that Mac (free) if you want to build it yourself; otherwise CI's unsigned build (right-click,
  Open, the first time).
