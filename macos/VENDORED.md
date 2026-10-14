# What the Mac app copied, and from where

The Mac app owns its view logic and its prompt runner. They began as one-time copies of the Omarchy
launcher's (the root of this repository) at commit `3c3a0d6` (2026-10-13), and changed here on
their own since. Only `contracts/` and the bridge's HTTP API are shared, read in place.

| Here | From the root | Changed in the copy |
|---|---|---|
| `js/lib/` | `lib/*.js` (Client, Fuzzy, Settings, Todos, Views) | nothing |
| `runner/` | `daemon/` (without `node_modules`) | `lib/paths.mjs` loads `../../../contracts/Paths.js` in a checkout |
| `scripts/install-runner.sh`, `safe-dest.sh`, `copy-shared-paths.sh` | `scripts/` | install `runner/`; copy `../contracts/Paths.js` |
| `js/tests/` | 34 files of `tests/` | paths to `../../runner/`, `macos/`, `../contracts/`; the bridge's tests left out of `collections`, `paper-status`, `sync`; the two `dev-sync.sh` tests left out of `safe-dest` (the Omarchy plugin's script) |
| `reference/*.qml` | `ZoteroSearch.qml`, `Service.qml`, `ChatWindow.qml`, `NoteWindow.qml` | nothing; read while porting and by `parity.sh`, never built; copied again from the root when the Mac follows a change there (last: 2026-10-13, deleting notes and OCR) |

Not copied: `contracts/` (shared, read in place), `zotero-bridge/` (used over HTTP), the Omarchy
plugin's scripts (`dev-sync.sh`, `sync-apply.sh`, the end-to-end scripts) and their tests.
