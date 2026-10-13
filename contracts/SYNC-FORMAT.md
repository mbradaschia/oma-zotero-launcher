# The sync format

What both launchers (the Omarchy launcher at the repository root, the Mac app in `macos/`)
agree on about your files, so one sync folder serves both. The code is `contracts/Paths.js`;
the tests in `contracts/tests/` pin every rule here, and both launchers run them. Changing a rule
means changing this file, `Paths.js`, its fixtures and both launchers in one PR.

## Names that never change

Your files and the bridge are shared, so their names are part of the format:

| What | Name |
|---|---|
| Config folder | `$XDG_CONFIG_HOME/omarchy/oma-zotero-launcher/` (`~/.config/...` without the variable) |
| Machine settings file | `$XDG_CONFIG_HOME/omarchy/oma-zotero-launcher.json` |
| State folder | `$XDG_STATE_HOME/oma-zotero/` (`~/.local/state/...`) |
| Cache folder | `$XDG_CACHE_HOME/oma-zotero-launcher/` (`~/.cache/...`) |
| Prompt runner | `oma-zotero-prompt` |
| Bridge routes | `http://127.0.0.1:<port>/oma-zotero/*`, its handshake `oma-zotero/bridge.json` |
| Overrides | `OMA_ZOTERO_PROMPTS_DIR`, `OMA_ZOTERO_INSTRUCTIONS` |

## Where each file lives

`Paths.resolve(env, machineSettings, probe)` decides; `contracts/fixtures/paths.json` is the table
both launchers must reproduce exactly (`contracts/tests/paths.test.js`).

- **Synced** (under `<syncDir>/shared/` when a sync folder is set, else their usual place):
  `settings.json` (the shared settings), `pins.json`, `searches.json`, `todos.json`, `view.json`,
  `instructions.md`, `prompts/`, `taxonomies/`, `taxonomy.json`, `chats/`, `artifacts/`.
- **Never synced:** the machine settings file, `extract.json`, the runner's `tasks/`, its state
  and caches (`prompt-versions.json`, `key-tests.json`, `models.json`), `sync-backups/`, and API
  keys (each machine's own secret store).
- **Your overrides win:** `OMA_ZOTERO_PROMPTS_DIR`, `OMA_ZOTERO_INSTRUCTIONS` and
  `general.artifactsDir` keep those where you put them; such a folder is not moved into the sync
  folder.
- **`syncDir`** is `general.syncDir` in the machine file; `~/` expands; anything else that isn't
  absolute is ignored (`sync-dir-invalid`).

## The files

| File | Shape |
|---|---|
| `pins.json` | `{ "pins": [{ "key", "libraryID", "type", "title"? }] }`; tags by `name` |
| `searches.json` | `{ "searches": [{ "id", "name", "query", "pinned" }] }` |
| `todos.json` | `{ "todos": [{ "id", "description", "status", "priority", "due", "item", "context", "isDefault", "created", "updated" }] }` |
| `view.json` | an object: `noteFontSize`, `noteOrder`, `sectionOrder`, `menuPins`, `menuOther`, `menuOrder`, `grouping` |
| `prompts/<id>.md` | YAML-ish frontmatter (`title`, `model`, `effort`, `output`, `brief`), then the instruction |
| `taxonomies/<id>.json`, `taxonomy.json` | a taxonomy's definition; each paper's labels and the review queue |
| `chats/<lib>-<KEY>/<id>.json` | one chat; **its `id` is its file name**, or it isn't read |
| `artifacts/<paper>_<lib>-<KEY>/<id>/meta.json` | `{ id, title, format, key, libraryID, paper, current, versions: [{ n, at, format, ... }] }`; `id` a slug, `current` and each `n` positive integers, formats known, or it isn't an artifact |
| `instructions.md` | your standing instructions, Markdown |

The last two rows' checks exist because these files arrive from another machine: what a file says
about itself never steers a write outside its own folder.

## Settings: two files

- **The machine file** keeps what belongs to the computer: `general.port`, `externalPdfCommand`,
  `promptCommand`, `zoteroCommand`, `artifactsDir`, `syncDir`, `machineName`, and **every AI
  provider's address** (`providers.<id>.baseURL`, `providers.compatible`).
- **The shared file** (`<syncDir>/shared/settings.json`) keeps the rest: the other `general` keys
  (`automationHost` among them), providers' on/off and context size, `defaults`, `tasks`, `status`,
  `rules`.
- **Reading:** the shared file wins shared keys only, never a machine one: a provider address in
  the shared file is ignored, so whoever can write to the sync folder can't send your keys
  elsewhere. Keys named `__proto__`, `constructor` or `prototype` are never read.
- **Writing:** a launcher keeps what it doesn't know in the shared file (a newer version's keys).
- **Unknown keys** in the machine file stay there. `Paths.SETTING_SCOPES` is the list
  (`contracts/tests/settings-scopes.test.js`).
- **This machine's copy** of the shared settings, `<config>/shared-settings.json`, is what's in
  effect while the sync folder is missing.

## Turning sync on and off

`Paths.syncPlan` makes the steps (`contracts/tests/sync-plan.test.js`); a launcher runs them in
order and stops at the first that fails. The machine settings file, which holds `syncDir`, is
always the last step, so a plan that stops part-way leaves the old setting.

| Case | What happens |
|---|---|
| **fill**: no marker in the folder | your machine file backed up; your synced files copied in; the shared settings and this machine's copy written; `.stignore` (`*.tmp`, `.DS_Store`) if absent; the marker; the machine file |
| **join**: the marker is there | your synced files moved to `sync-backups/<YYYY-MM-DD-HHMMSS>/`, your machine file copied there; the machine file rewritten with machine keys only |
| **leave**: `syncDir` cleared | each file the folder has a copy of comes back (yours backed up first); with the folder gone, your files stay; the settings recombined into the machine file |
| **refused** | data in the folder but no marker yet (Syncthing still copying), or a move from one folder to another (clear it first) |

**The marker** is `<syncDir>/shared/oma-zotero-sync.json`: `{ "version": 1, "created", "by" }`.

## The folder missing

With `syncDir` set and no marker (a drive not mounted, the folder renamed), `resolve` reports
`readOnly` and `sync-unavailable`. Nothing synced is written: no fallback to the local files,
which would split your data. A launcher says "Sync folder not found: <path>", keeps working with
everything else, and reads every synced file again when the folder is back.

## Writing

Every write to a synced file goes to a temporary file in the same folder, then renamed over the
old one, so the other machine never syncs half a file.

## Not yet

Conflict copies (`*.sync-conflict-*`, Dropbox's "conflicted copy") are left alone: the file next
to one is used as is. Merging them (`Merge.js`, tombstones, `updated` on pins and searches) is the
next change to this format.
