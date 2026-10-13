# Phase 6a: the runner, setup, models and providers (design)

Phase 6 of [`macos/PLAN.md`](../../../PLAN.md) has 41 row ids, too many for one reviewable change.
It is split: **6a** (this) is the runner client, the setup checklist and installing the AI features,
Models & providers with their keys, Defaults' model rows, and settings found from the search;
**6b** is prompts, Processes, extraction and Rules. 6a's 13 ids: `set-models set-use set-model
set-provider set-quick set-test set-key set-key-remove set-endpoint-new set-endpoint-remove
set-setup set-install setting-go`. Ported with the QML open (`ZoteroSearch.qml` 526-560,
1695-1870, 3561-3845; `Service.qml` 1679-1745, 2045-2240).

## 1. The runner client (decisions 6 and 7)

- **`Runner`** (a protocol, faked in tests) and **`ProcessRunner`**: `Client.promptArgv(settings,
  args)` (so `promptCommand` is honoured), spawned directly, never through a login shell, in a clean
  environment (HOME, LANG, TMPDIR, the XDG and `OMA_ZOTERO_*` variables, the providers' key
  variables) with an explicit PATH: Node's folder, `~/.local/bin`, Homebrew's, the system's.
- **Node ≥ 22** found where Macs keep it (Homebrew, `/usr/local`, nvm, Volta, fnm), newest first.
- **`run`** waits off the main thread, writes stdin and closes it, reads stdout and stderr together
  (a full stderr never blocks), and kills the run after a timeout (SIGKILL: the end says why). The
  QML has no timeouts; the Mac's: `providers` 20 s, `models` 60 s, `provider-test` 60 s, `secret`
  20 s. **`launch`** starts a run and leaves it (6b's prompts and extractions).
- Waited calls pass `--quiet`: the launcher says what failed itself, so the runner's "Prompt failed"
  notification would only repeat it. A failure is the last stderr line without its
  `oma-zotero-prompt: ` prefix; exit 127 or no command means not installed.

## 2. Setup and installing the AI features

- **What the Mac checks:** Zotero installed (its bundle id, or `zoteroCommand`), running, the
  bridge (the handshake's status and version against the bundled plugin's), Node, pdftotext on the
  PATH, the runner (its command there and `providers` answering), the keyring (the runner's).
- **`Settings.setupItems` as the Mac shows it** (`GlueSettings.js`, after `buildRoot`): the
  Hyprland rows go (the keybinding, the layer rule); `omarchy install dev-env node` and
  `omarchy pkg add poppler` become `brew install node` and `brew install poppler`, which Enter
  **copies** for Terminal (a terminal opened by the app would need Automation access); the plugin
  steps say ⌘⇧G, ⌘V; "after an update of the plugin" says the app.
- **`set-setup`** (`runSetupAction`): `zotero-start` (started, then the handshake asked every 3 s,
  60 times at most), `zotero-get` (zotero.org in the browser), `bridge-install`, `copy:<command>`,
  `install`, `settings-<page>`.
- **The bridge on the Mac** (`BridgeDownloader`, in place of `install-bridge.sh`, which needs jq,
  sha256sum, wl-copy and uwsm): GitHub's releases of this repository, the newest `vX.Y.Z` that has
  an `.xpi` (not the Mac app's `macos-v*`), downloaded to Downloads, checked against its `.sha256`
  (CryptoKit), its path on the clipboard, Zotero started. The same flashes as the QML.
- **`set-install`**: the bundled `install-runner.sh` (the app carries `RunnerKit/` in its
  resources: `macos/runner/` without `node_modules`, its three scripts, `contracts/Paths.js`, in the
  layout the scripts expect), run with the explicit PATH; `installing` shown on the row and in the
  count; when it ends, a flash ("AI features installed" or the last stderr line) and providers,
  models asked again.
- **The reinstall offer** (decision 7, Mac only): the installed runner's `package.json` version
  against the bundled one; newer bundled: the runner row says so and Enter installs it.

## 3. Models & providers

- **State:** the providers (`providers`), the models (`models --json`: models, groups, defaults),
  the tests (`provider-test <id>`, one at a time per provider), installing, the requirements; the
  provider page open, the models picker's path and `only`, the provider whose first test fills the
  empty defaults (`autoDefault`), the keys tested this opening (`autoTestKeys`).
- **Pages** through Settings.js: `settings-providers` (`buildProviders`), `settings-provider`
  (`buildProvider`), `settings-models` (`buildModelPicker`), `settings-defaults`
  (`buildDefaults`; its paper's-text rows are 6b's and show what the Mac knows).
- **Rows:** `set-provider` (its page, tested on the way in), `set-quick` (on, then `afterEnable`:
  its first model fills empty defaults), `set-toggle` on providers and endpoints, `set-test`,
  `set-key` (the key read from the clipboard, given to `secret set <id>` on stdin, the clipboard
  cleared if it still holds that key; never on a command line), `set-key-remove`,
  `set-endpoint-new` (name, then base URL: `Settings.addEndpoint`), `set-endpoint-remove`,
  `set-edit` for an endpoint's base URL and context, `set-models`, `set-use`, `set-model`
  (`defaults.both` sets prompts and chat).
- **Saving a whole settings object** (`defaults.both`, endpoints): `settingsSaveAll` beside the
  one-path `settingsSave`; a non-general path asks for providers and models again.

## 4. Settings found from the search

`settingsIndex` from every page that exists by now (Settings.js's builders with today's state);
typed text finds them under Go to (`Views.settingRows`) and below a menu's rows
(`Views.settingMenuRows`, `setting-go`); Enter opens the page on that row (`openSettingAt`).

## 5. Chrome

Placeholders, counts ("installing…", "N models"), hints ("↵ read the key from the clipboard", the
verbs choose, change, test, open) and the setup rows' badges, as the QML has them.

## Testing

- Goldens for every new Glue wrapper (`GlueSettings.js`), the Mac setup rows included.
- `ProcessRunner` against `/bin/sh` scripts: stdout and stderr together, stdin closed, the timeout,
  a missing command, the environment and PATH (nothing else leaks in), Node found in a temp HOME.
- XCTest with a fake runner: each of the 13 ids; the key never in an argv, the clipboard cleared;
  a failed test's detail; `afterEnable` filling the defaults; endpoints added and removed; the
  install and the reinstall offer; `setting-go` landing on its row.
- `BridgeDownloader` with a fake fetcher: the right release picked, a bad checksum refused, the
  file in Downloads.
- `scripts/parity.sh --phase 6` reports 6a's ids ported (6b's remaining).
