# Zotero Launcher for macOS

**Your whole Zotero library, one hotkey away, as a native Mac app.** The macOS launcher of
[zotero-companion-launcher](https://github.com/mbradaschia/zotero-companion-launcher), next to the
Omarchy launcher at the repository's root: the same Zotero plugin and the same files, with a
SwiftUI frontend of its own.

> In progress: phases 1 to 7 of [the plan](PLAN.md) (122 of the 164 row ids); chat, taxonomies and the release to come.
> Search, open a paper in Zotero, select it in the library. The paper menu, notes, tags, prompts and chat
> come next.

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
   curl -fsSL https://github.com/mbradaschia/zotero-companion-launcher/releases/download/macos-nightly/install.sh | bash
   ```
   It downloads the [nightly build](https://github.com/mbradaschia/zotero-companion-launcher/releases/tag/macos-nightly)
   (rebuilt on every push to `master` that touches the app), checks it's whole and runs on this Mac, puts it
   in `/Applications`, clears the quarantine (it's signed ad hoc, not notarized) and opens it. Run it again
   to update. With a `ZoteroLauncher.zip` you downloaded yourself: `bash macos/scripts/install.sh ~/Downloads/ZoteroLauncher.zip`.

   Or **from source**:
   ```bash
   git clone https://github.com/mbradaschia/zotero-companion-launcher
   cd zotero-companion-launcher/macos
   brew install xcodegen && xcodegen generate
   open ZoteroLauncher.xcodeproj   # then Run (⌘R)
   ```
3. Start Zotero, then press **⌃⌥Z** anywhere (change it in the menu bar icon › *Settings…*).

## Keys (so far)

| Key | |
|---|---|
| type | search, as you type (the same filters as on Omarchy: `a:smith`, `y:2019..2021`, `#tag`, …) |
| `↑` `↓` | move |
| `Enter` | open the paper in Zotero (its tab or PDF) |
| `Shift+Enter` | select it in Zotero's library |
| `Esc` | close |

## Development

From `macos/`:

```bash
xcodegen generate                       # after adding or removing files
xcodebuild test -project ZoteroLauncher.xcodeproj -scheme ZoteroLauncher -destination 'platform=macOS'
npm ci --prefix runner && node --test js/tests/*.test.js   # the app's JS and runner
```

The Xcode project is generated from `project.yml` and not committed. CI
(`.github/workflows/macos.yml` at the repository root) runs both on every change under `macos/` or
`contracts/`, and builds an ad-hoc signed app.

## License

MIT
