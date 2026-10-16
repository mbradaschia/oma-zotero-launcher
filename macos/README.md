# Zotero Launcher for macOS

**Your whole Zotero library, one hotkey away, as a native Mac app.** The macOS launcher of
[zotero-companion-launcher](https://github.com/mbradaschia/zotero-companion-launcher), next to the
Omarchy launcher at the repository's root: the same Zotero plugin and the same files, with a
SwiftUI frontend of its own.

Everything the Omarchy launcher does, all ten phases of [the plan](PLAN.md) (its 166 row ids): search as you type,
open a paper in Zotero or select it in the library; its menu, notes (in the launcher or a window), tags, files and
citations; tasks, saved searches, Settings, prompts, Processes and the background automation; chat with a paper (a
window per paper, its artifacts); taxonomies; sync between machines; the keys view; Open at login; VoiceOver labels.

## How it fits together

| Part | Where | For the Mac app |
|---|---|---|
| Zotero plugin (the bridge) | `zotero-bridge/` | The same `.xpi` both launchers use, from the repository's releases |
| The sync format | `contracts/` | Read in place by both launchers: `SYNC-FORMAT.md`, `Paths.js` |
| View logic | `macos/js/lib/` | The app's own copy, run in JavaScriptCore (see `VENDORED.md`) |
| Prompt runner (AI features) | `macos/runner/` | The app's own copy of the Node runner |
| The app | `macos/` | SwiftUI + AppKit, a menu-bar app |

The app reads nothing of the Omarchy launcher's code (`scripts/check-boundaries.sh` checks it in CI);
only the bridge's API and `contracts/` are shared.

## Try it

You need macOS 14 (Sonoma) or newer, on an Apple silicon or Intel Mac, and [Zotero](https://www.zotero.org) 10 with the bridge plugin.

1. **The Zotero plugin**: download `oma-zotero-launcher-<version>.xpi` from the
   [latest release](https://github.com/mbradaschia/zotero-companion-launcher/releases/latest); in Zotero,
   *Tools → Plugins → ⚙ → Install Plugin From File…*.
2. **The app**, in Terminal:
   ```bash
   curl -fsSL https://github.com/mbradaschia/zotero-companion-launcher/releases/download/macos-v0.3.2/install.sh | bash
   ```
   It downloads that release (or, with `macos-nightly` in the URL, the
   [nightly build](https://github.com/mbradaschia/zotero-companion-launcher/releases/tag/macos-nightly), rebuilt on
   every push to `master` that touches the app), checks it's whole and runs on this Mac, puts it
   in `/Applications`, clears the quarantine (it's signed ad hoc, not notarized) and opens it. Run it again
   to update, or let the app do it: once a day it looks at the releases, and the menu bar offers a newer one. With a `ZoteroLauncher.zip` you downloaded yourself: `bash macos/scripts/install.sh ~/Downloads/ZoteroLauncher.zip`.

   Or **from source**:
   ```bash
   git clone https://github.com/mbradaschia/zotero-companion-launcher
   cd zotero-companion-launcher/macos
   brew install xcodegen && xcodegen generate
   open ZoteroLauncher.xcodeproj   # then Run (⌘R)
   ```
3. Start Zotero, then press **⌃⌥Z** anywhere (change it in the menu bar icon › *Hotkey and Login…*, where *Open at
   login* is too).

## Keys

`?` (or F1 while typing) lists every key, the ones for where you are first; type to find one. The basics:

| Key | |
|---|---|
| type | search, as you type (the same filters as on Omarchy: `a:smith`, `y:2019..2021`, `#tag`, …) |
| `↑` `↓` | move |
| `↵` | a paper's menu (open it in Zotero, its notes, tags, files, chat, …) |
| `⇧↵` | the highlighted row's other action (select a paper in Zotero's library) |
| `esc` | back, then close |

## The menu bar

*Open the Launcher* (its hotkey shown), *Chats…*, *Processes…*, *Settings…* (the launcher's own), *Sync
Zotero*, *Open at Login*, *Hotkey and Login…* (the app's window: the hotkey and the login item), *Check for Updates…*
(and *Update to 0.3.2…* once a newer `macos-v*` release is out: it runs that release's `install.sh`), *Quit*. When macOS
wants your OK for the login item, the app opens *System Settings › General › Login Items*.

## What differs from Omarchy

- The hotkey is the app's (⌃⌥Z by default), not a Hyprland binding; *W* moves the launcher between its panel and a
  regular window; ⌘W closes it, as it closes a note's or a chat's window.
- ⌘ does what Ctrl does there: ⌘S saves a search, ⌘V pastes, ⌘-/+/0 size a note's text. Keys are written in the
  Mac's notation (⌘ ⌥ ⌃ ⇧ ↵ esc ⌫).
- API keys are kept in the Keychain; commands to copy are Homebrew's (`brew install …`).
- The app is signed ad hoc, not notarized (the installer clears the quarantine). A signed, notarized build with
  automatic updates needs the Apple Developer Program.
- Accessibility: VoiceOver reads each row as one element (its label, detail, keys and state), pills by their kind,
  and nothing animates with *Reduce Motion* on.

## Development

From `macos/`:

```bash
xcodegen generate                       # after adding or removing files
xcodebuild test -project ZoteroLauncher.xcodeproj -scheme ZoteroLauncher -destination 'platform=macOS'
npm ci --prefix runner && node --test js/tests/*.test.js   # the app's JS and runner
# the real app on screen, on the fixtures (real key presses; no Zotero, no runner, a home of its own):
xcodebuild test -project ZoteroLauncher.xcodeproj -scheme ZoteroLauncherUITests -destination 'platform=macOS'
# the same on your Zotero (read-only flows; ZL_UI_REAL=1 reaches the test runner as TEST_RUNNER_ZL_UI_REAL):
TEST_RUNNER_ZL_UI_REAL=1 xcodebuild test -project ZoteroLauncher.xcodeproj -scheme ZoteroLauncherUITests -destination 'platform=macOS'
```

Fixture mode (Debug builds only) is `ZL_FIXTURES=<ZoteroLauncherTests/Fixtures>`: made-up papers, prompts, a chat,
an artifact and a taxonomy instead of Zotero and the runner. The UI tests set it, and these switches with it:
`ZL_FIXTURE_CALLS` (a file the fixture runner logs each subcommand to), `ZL_FIXTURES_STREAM_DELAY` (seconds
between a chat answer's lines), `ZL_FIXTURES_NO_RUNNER=1` (as if the AI features weren't installed) and
`ZL_FIXTURES_SYNC_AWAY=1` (a sync folder that isn't there).

The Xcode project is generated from `project.yml` and not committed. CI
(`.github/workflows/macos.yml` at the repository root) runs both on every change under `macos/` or
`contracts/`, and builds an ad-hoc signed app.

## License

MIT
