# macOS port: what it takes

An audit of `v0.2.1` + `master` (1de84ed) for running the launcher on macOS. No code changed yet.

## Verdict

The launcher has three layers, and they port very differently:

| Layer | Lines | Runs in | macOS effort |
|---|---|---|---|
| **Zotero bridge** (`zotero-bridge/`) | ~5k | Zotero itself (Gecko JS) | **Small.** One real bug (handshake path), dev scripts |
| **Prompt runner** (`daemon/`) | ~5k | Node 22 | **Small to medium.** Keyring, clipboard/open/notify, binary discovery, paths |
| **Launcher UI** (`*.qml`, `lib/*.js`) | ~16k | Omarchy shell (Quickshell on Hyprland/Wayland) | **Rewrite of the views.** Quickshell has no macOS backend |

The bridge and runner are about 60% of the code and port with a platform layer. The UI does not port: every
QML file imports `Quickshell`, `Quickshell.Wayland`/`Quickshell.Hyprland`, and Omarchy's own `qs.Commons` /
`qs.Ui` (Style, Color, Border, Util). None of these exist on macOS. What does survive is `lib/*.js`
(Views, Settings, Todos, Fuzzy, Client: ~4.5k lines): they are pure, Qt-free and node-tested, so any
JavaScript frontend can reuse the view-model logic.

**Recommendation: one repo, not a fork.** The bridge and runner are shared; `scripts/check-versions.sh`
already enforces that the three parts share one version. A separate repo means every bridge fix twice.
Add a platform layer to the runner and a second frontend directory (`macos/` or `raycast/`).

## 1. Zotero bridge

| Issue | Where | Fix |
|---|---|---|
| **Handshake path mismatch (blocker).** Zotero writes `bridge.json` to `$XDG_RUNTIME_DIR` or, unset (always on macOS), `PathUtils.tempDir` = `$TMPDIR` (`/var/folders/…/T/`). The runner reads `$XDG_RUNTIME_DIR` or `/tmp`. On macOS they never meet. | `zotero-bridge/lib/bridge.js:749`, `daemon/lib/bridge.mjs:7` | Runner falls back to `os.tmpdir()` (same `$TMPDIR` as Zotero under launchd). Better: an explicit macOS path both agree on, `~/Library/Application Support/oma-zotero/bridge.json` (0700/0600). |
| Settings path is `~/.config/omarchy/oma-zotero-launcher.json` | `bridge.js:168` | Fine to keep (works on macOS), but rename the `omarchy` segment if the port goes public. |
| Dev scripts assume Linux Zotero | `scripts/bridge-dev-link.sh:20` (`~/.zotero/zotero`), `:35` (`pgrep zotero-bin`); `fresh-install-test.sh:50` (`/usr/lib/zotero/zotero`, `setsid`) | macOS profile: `~/Library/Application Support/Zotero/Profiles`; binary `/Applications/Zotero.app/Contents/MacOS/zotero`; process name `zotero`. |
| `.xpi` build uses `sha256sum` | `scripts/build-xpi.sh:48`, `install-bridge.sh:27` | `shasum -a 256` on macOS (or detect). |

The bridge's Zotero APIs (`IOUtils`, `PathUtils`, `Zotero.Prefs`, the HTTP server) are cross-platform. The
`.xpi` itself needs no macOS build.

## 2. Prompt runner (`daemon/`)

| Linux dependency | Where | macOS replacement |
|---|---|---|
| `secret-tool` (Secret Service) for API keys | `daemon/lib/secrets.mjs` (whole file), tests in `providers.test.js`, `settings.test.js`, `taxonomies.test.js`, `key-tests.test.js` | Keychain via `security`. **Don't pass the key on argv** (`security add-generic-password -w KEY` shows in `ps`): feed `add-generic-password … -w KEY` to `security -i` on stdin, or use `@napi-rs/keyring` (Keychain / Secret Service / Windows, one API). |
| `notify-send` | `bin/oma-zotero-prompt.mjs:117` | `osascript -e 'display notification …'` (or `terminal-notifier`). |
| `omarchy-launch-editor`, `xdg-open` | `bin/oma-zotero-prompt.mjs:122-123` | `open -t` (default text editor) / `open`. |
| `pdftotext` (Poppler) | `lib/extract.mjs:16`, `bin/…:1122` | `brew install poppler`. **PATH problem:** GUI-launched processes don't get `/opt/homebrew/bin`. Search `/opt/homebrew/bin` and `/usr/local/bin` explicitly. |
| `claude` / `codex` CLIs found with `command -v` | `providers/claude.mjs:12`, `providers/chatgpt.mjs:26` | Same PATH problem; same fix (plus `~/.local/bin`, `~/.npm-global/bin`). |
| Headless Chromium for SVG layout checks | `lib/layout.mjs:12-23` (`chromium`, `google-chrome-stable`, … on PATH) | macOS browsers live in app bundles: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, Brave, Edge, Chromium. Without one it already falls back to the estimate, so this is polish. |
| Install hints say `omarchy pkg add …` | `extract.mjs:20`, `providers/ollama.mjs:74`, `secrets.mjs`, `lib/Settings.js:578` | Per-platform hint: `brew install …`. |
| XDG paths (`XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`) with `~/.config`, `~/.local/state`, `~/.cache` fallbacks | `settings.mjs`, `prompts.mjs`, `taxonomies.mjs`, `tasks.mjs`, `chat.mjs`, `artifacts.mjs`, `models.mjs`, providers | Work as-is on macOS (they're just directories). Moving to `~/Library/…` is optional; keep XDG for one code path. |
| `scripts/install-runner.sh` | `.local/share` runner dir, `~/.local/bin` link | Works; `~/.local/bin` isn't on macOS's default PATH, so print a hint. |

Everything else in the runner (AI SDK providers, Ollama, prompts, chat, taxonomies, catch-up, artifacts) is
plain Node and portable.

**Suggested shape:** one `daemon/lib/platform.mjs` exporting `notify`, `openFile`, `openInEditor`,
`copyToClipboard`, `findBinary(name)` (with the Homebrew dirs), `handshakePath`, `installHint(pkg)`, and a
keyring backend. Each Linux call site switches to it. Linux behavior stays identical.

## 3. Launcher UI: the real work

What the QML relies on, and what it maps to on macOS:

| Capability | Linux today | macOS needs |
|---|---|---|
| Global hotkey (SUPER+SHIFT+Z) | Hyprland binding → `omarchy-shell` panel (`add-keybinding.sh`, `Service.qml:1925`) | A launcher host with a global shortcut |
| Overlay window | `PanelWindow` + `WlrLayershell` (`ZoteroSearch.qml:5197`) | Floating panel |
| Note / chat windows | `FloatingWindow` (`NoteWindow.qml:14`, `ChatWindow.qml:17`) | Separate windows, or a detail pane |
| Focus Zotero's window | `Hyprland.toplevels` / `Hyprland.dispatch` (`Service.qml:753,780`, `ZoteroSearch.qml:4056,4078`) | `open -a Zotero` / AppleScript `activate`; tab selection is already done inside Zotero by the bridge |
| Clipboard | `wl-copy` / `wl-paste` (`Service.qml:693,1819,1871`) | `pbcopy` / `pbpaste` or the host's clipboard API |
| Open files / URLs | `xdg-open`, `uwsm-app` (`Service.qml:911,1934`, `ZoteroSearch.qml:4220`, `lib/Client.js:88`) | `open` |
| Notifications | `notify-send` (`Service.qml:1938`) | host API / `osascript` |
| Floating terminal for installs | `omarchy-launch-floating-terminal-with-presentation` (`Service.qml:1930`) | `open -a Terminal` with a script, or run inline and show progress |
| Subprocesses + file watching | Quickshell `Process`, `StdioCollector`, `FileView` (~30 instances in `Service.qml`) | host's process/file APIs |
| Theme, fonts, spacing | `qs.Commons` `Style`/`Color`/`Border` (~360 references) | host theme |
| Nerd Font glyph icons | `lib/Views.js` `ICONS` | Not installed by default on macOS: SF Symbols or bundled icons |

### Frontend options

| Option | Reuse | Cost | Trade-offs |
|---|---|---|---|
| **A. Raycast extension** (TypeScript/React) | `lib/*.js` view-models, all of the bridge + runner | ~2-3 weeks for search + paper menu + notes + prompts + tasks; chat after | Hotkey, panel, clipboard, Keychain-backed password prefs, theming come free. Loses the custom key scheme (single-key actions, `Alt+1…9`, 0.3 s typing window): Raycast uses `Cmd+K` action panels and its own shortcuts. No free-floating note window to tile next to a PDF; chat becomes a List + Detail. Store listing needs a public repo and review; private use works with `npm run dev`. Existing Zotero extensions in the Raycast store mostly read the SQLite database directly, so the bridge + AI grounding is a real differentiator. |
| B. Qt 6 app hosting the existing QML | Most of the QML, all of `lib/*.js` | ~3-5 weeks | A C++ shim must re-implement `Process`, `FileView`, `StdioCollector`, `IpcHandler`, `FloatingWindow`, and stub `qs.Commons`/`qs.Ui`; plus a native global hotkey, `macdeployqt`, code signing and notarization. Keeps the keyboard UX exactly. Two Qt hosts to maintain. |
| C. Tauri / Electron app | `lib/*.js`; views rewritten in HTML | ~4-6 weeks | Full control of the UX, could become the Linux/Windows frontend too. Heaviest build and signing story. |
| D. SwiftUI | none of the UI | ~6+ weeks | Best native feel, zero reuse, new language. |

**Pick A (Raycast)** unless the exact keyboard scheme or the tiled note window is non-negotiable; then B.
Raycast solves the macOS-specific parts (hotkey, panel, Keychain, clipboard) that would otherwise be the
bulk of the work, and the repo's architecture already separates the logic Raycast would call.

## Phased plan

1. **Shared core portable** (1-2 days, no UI): handshake path fix in bridge + runner, `daemon/lib/platform.mjs`,
   Keychain backend, Homebrew-aware binary lookup, `brew` hints, `shasum` fallback. Run `make test` on a
   macOS GitHub runner (`runs-on: macos-latest` in `ci.yml`). After this, `oma-zotero-prompt` works on a Mac
   from the terminal against a live Zotero.
2. **Frontend MVP** (Raycast): search, paper menu, open PDF / show in Zotero, copy citation, read a note,
   tags, run a prompt, tasks list.
3. **Parity pass**: chat, taxonomies audit, settings/provider setup, collections and saved searches.
4. **Release**: macOS install docs in README, versions shared across all four parts.

## Open questions (they change the plan)

- Is this for daily use on a Mac (e.g. during the sandwich period), or a nice-to-have? If daily, phase 1 +
  a Raycast MVP covers 80% of the use for ~20% of the effort.
- Is the keyboard scheme the product (option B), or is "Zotero + grounded AI, one hotkey away" the
  product (option A)?
- Do you want the macOS frontend public (Raycast Store) or private?
