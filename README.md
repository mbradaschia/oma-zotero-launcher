# Zotero Launcher for macOS

**Your whole Zotero library, one hotkey away, as a native Mac app.** The macOS sibling of
[oma-zotero-launcher](https://github.com/mbradaschia/oma-zotero-launcher) (the Omarchy launcher): the
same Zotero plugin, the same AI runner, the same view logic, with a SwiftUI frontend.

> Early: phase 2 of [the plan](https://github.com/mbradaschia/oma-zotero-launcher/blob/master/PLAN-macos.md).
> Search, open a paper in Zotero, select it in the library. The paper menu, notes, tags, prompts and chat
> come next.

## How it fits together

| Part | Where | On macOS |
|---|---|---|
| Zotero plugin (the bridge) | `oma-zotero-launcher/zotero-bridge` | The same `.xpi`, from that repository's releases |
| Prompt runner (AI features) | `oma-zotero-launcher/daemon` | The same Node runner (Keychain, Homebrew paths) |
| View logic (`lib/*.js`) | `oma-zotero-launcher/lib`, here as the `shared` submodule | Run in JavaScriptCore inside the app |
| The launcher | this repository | SwiftUI + AppKit, a menu-bar app |

`shared/` pins the Omarchy launcher at a commit: the app's rows, sections and highlights come from its
`lib/*.js`, never from a copy. Update the pin with `git -C shared fetch && git -C shared checkout <commit>`.

## Try it

You need macOS 14 (Sonoma) or newer and [Zotero](https://www.zotero.org) 10 with the bridge plugin.

1. **The Zotero plugin**: download `oma-zotero-launcher-<version>.xpi` from the
   [latest release](https://github.com/mbradaschia/oma-zotero-launcher/releases/latest); in Zotero,
   *Tools → Plugins → ⚙ → Install Plugin From File…*.
2. **The app**, either:
   - **The nightly build**: `ZoteroLauncher.zip` from the
     [Nightly release](https://github.com/mbradaschia/zotero-launcher-macos/releases/tag/nightly) (rebuilt on
     every push to `main`). Unzip it (Safari may already have), move `ZoteroLauncher.app` to
     `/Applications`, then, once (it isn't notarized):
     `xattr -dr com.apple.quarantine /Applications/ZoteroLauncher.app`
   - **From source**:
     ```bash
     git clone --recurse-submodules https://github.com/mbradaschia/zotero-launcher-macos
     cd zotero-launcher-macos
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

```bash
xcodegen generate                       # after adding or removing files
xcodebuild test -project ZoteroLauncher.xcodeproj -scheme ZoteroLauncher -destination 'platform=macOS'
```

The Xcode project is generated from `project.yml` and not committed. CI (`.github/workflows/ci.yml`)
runs the unit tests and builds an ad-hoc signed app on every push.

## License

MIT
