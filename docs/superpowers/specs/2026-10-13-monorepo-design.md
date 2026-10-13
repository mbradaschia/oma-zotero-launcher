# One repository, three projects: zotero-companion-launcher (design)

The Omarchy launcher, the Zotero bridge with the contracts both launchers share, and the macOS
app, in one public repository: this one, renamed from `oma-zotero-launcher` to
`zotero-companion-launcher`. It supersedes the copy-and-check design of
`zotero-launcher-macos/docs/superpowers/specs/2026-10-13-independent-app-design.md` (never
merged): with both launchers in one tree, the contracts are read in place.

## Decisions

- **One repository, public.** The Omarchy plugin installs from a public git URL and the bridge's
  `.xpi` downloads without signing in, so the repository stays public, and the Mac app's code
  becomes public with it.
- **The two launchers stay independent.** Each owns its view logic, its prompt runner and its UI.
  Only two things are common: **the bridge** (its HTTP API) and **the contracts** (the sync
  folder's layout and formats, with the code that implements them).
- **Renamed to `zotero-companion-launcher`.** The shared names stay (below).

## Layout

```
zotero-companion-launcher/        public
├── manifest.json, *.qml,         the Omarchy launcher, at the root: `omarchy plugin add <url>`
│   lib/, daemon/, scripts/,        takes the repository as the plugin
│   tests/, Makefile
├── zotero-bridge/                the bridge: its path is fixed by the update URL installed copies hold
├── contracts/                    common to both launchers
│   ├── SYNC-FORMAT.md              the sync folder, in words
│   ├── Paths.js                    every path, settings scopes, sync plans (from lib/Paths.js)
│   ├── fixtures/                   paths.json, and each later format's
│   └── tests/                      paths, settings-scopes, sync-plan
└── macos/                        the Mac app, from zotero-launcher-macos with its history
    ├── ZoteroLauncher/, ZoteroLauncherTests/, project.yml, scripts/, PLAN.md, README.md
    ├── js/lib/                     its own copy of the view logic (lib/*.js but Paths.js)
    ├── js/tests/                   the copied tests of that code
    ├── runner/                     its own copy of daemon/
    └── reference/                  the Omarchy QML as it was at the copy, for porting and parity.sh
```

### Why the Omarchy launcher stays at the root

`omarchy plugin add https://github.com/<owner>/<repo>` installs the repository as the plugin,
with its `manifest.json` at the top. Moving the launcher into a folder would need Omarchy to
support plugins in a subfolder; nothing says it does. It stays where it is, and the other projects
sit beside it.

### Why the bridge stays at `zotero-bridge/`

Every installed copy of the bridge checks for updates at
`https://raw.githubusercontent.com/<owner>/<repo>/master/zotero-bridge/updates.json`. That path
can't move without stranding those copies.

## The rename

- **What moves:** the repository name; every link in the READMEs, the CHANGELOG and the Settings
  pages; `scripts/install-bridge.sh`'s `REPO`; the bridge manifest's `homepage_url` and
  `update_url`; the Mac app's `install.sh` and its release URLs; CI badges; this clone's `origin`.
- **What stays, because both launchers and your files share it:** the Omarchy plugin id, the
  config and state folders (`~/.config/omarchy/oma-zotero-launcher/`, `~/.local/state/oma-zotero/`),
  the runner's name (`oma-zotero-prompt`), the bridge's routes (`/oma-zotero/*`), the handshake
  path, the Keychain service, and the `.xpi`'s file name. Renaming them is a sync-contract change
  with a migration, not part of this.
- **The update URL across the rename:** GitHub redirects a renamed repository's web and git URLs.
  The first bridge release after the rename sets `update_url` to the new name; until each
  installed copy updates once, it uses the old URL. Right after the rename, a `curl -I` of the old
  raw URL checks the redirect. If raw files don't follow it, `oma-zotero-launcher` is recreated as
  a tiny public repository holding only `zotero-bridge/updates.json`, kept in step by the release
  script, until the old version is gone from your machines.
- **The old name is never reused** for another repository: that would end every redirect.

## The contracts

- **`contracts/Paths.js`** is `lib/Paths.js`, moved (`git mv`, history kept). The Omarchy launcher
  imports `contracts/Paths.js`; its runner loads `./shared-paths.cjs` (installed) or
  `../../contracts/Paths.js` (a checkout); `scripts/copy-shared-paths.sh` copies it from there.
  The Mac app bundles the same file from `../contracts/` (its `project.yml`), and its own runner
  copy loads `../../../contracts/Paths.js` from a checkout, or the `shared-paths.cjs` that
  `macos/scripts/copy-shared-paths.sh` puts in an installed runner.
- **`contracts/fixtures/paths.json`** is `tests/fixtures/paths.json`, moved; both launchers' tests
  read it in place.
- **`contracts/tests/`**: the tests of the contract code (`paths`, `settings-scopes`,
  `sync-plan`), moved from `tests/`. `make test` runs them with the rest. The tests of each
  launcher's use of it (`runner-settings`, `sync-apply`, `runner-paths`) stay with that launcher.
- **`contracts/SYNC-FORMAT.md`**: the sync folder in words, from the phase 2.5 design (layout,
  scopes, fill/join/leave, read-only, the marker), kept with the code.
- **Later:** `Merge.js` and its fixtures (phase 4b) land here, once, for both.
- **The plugin copy:** `scripts/dev-sync.sh` (and so the plugin as installed) includes
  `contracts/Paths.js`, the only contract file the shell loads.

## The boundary

- `macos/` reads nothing of the Omarchy launcher's: not `lib/`, `daemon/`, `scripts/`, `*.qml`.
  It reads `contracts/` and talks to the bridge over HTTP.
- The Omarchy launcher reads nothing under `macos/`.
- **`scripts/check-boundaries.sh`** fails CI on a crossing: a path under `macos/` naming `../lib`,
  `../daemon`, `../scripts` or a root QML file, or a root file naming `macos/`.

## Moving the Mac app in

- `git subtree add --prefix=macos <zotero-launcher-macos> main`: its history, as is, under `macos/`.
- Its `shared/` submodule and `.gitmodules` go.
- The one-time copies for its independence, from this repository at the import commit:
  root `lib/*.js` but `Paths.js` → `macos/js/lib/`; `daemon/` → `macos/runner/`; the install
  scripts the runner needs → `macos/scripts/`; the tests of that code → `macos/js/tests/`; the
  four QML files → `macos/reference/`. `macos/VENDORED.md` records the commit.
- `macos/PLAN.md` gains the monorepo as revision 4 (replacing the unmerged one).
- **zotero-launcher-macos** is archived: its README points here, its last nightly stays up.

## CI and releases

- **`.github/workflows/ci.yml`** (the Omarchy launcher, the bridge, the contracts): as today, plus
  `contracts/tests/`, `scripts/check-boundaries.sh`; it ignores changes only under `macos/`.
- **`.github/workflows/macos.yml`** (from the Mac app's `ci.yml`): runs from `macos/`, on
  changes under `macos/` or `contracts/`. Adds a JavaScript job (`node --test macos/js/tests`).
  Its nightly release is the tag `macos-nightly`.
- **Releases:** `vX.Y.Z` stays the Omarchy launcher's and the bridge's (one version, as now,
  with the `.xpi`). The Mac app's are `macos-vX.Y.Z`. `scripts/release.sh` and `install.sh`
  follow their own prefix.

## Testing

- `make test` green: the Omarchy launcher's tests, the bridge's, and `contracts/tests/`.
- `macos.yml` green: the Swift tests (with `contracts/Paths.js` bundled), the copied JS tests.
- `scripts/check-boundaries.sh` passes, and fails when a test file under `macos/` requires
  `../lib/Views.js` (tried once in the PR).
- After the rename: `git clone` and `omarchy plugin add` with the old URL still work, and the old
  raw `updates.json` URL answers (or the fallback repository is in place).
- `scripts/fresh-install-test.sh` on the Omarchy machine: the plugin installs from the renamed
  URL, with `contracts/Paths.js` in it.

## What it costs

- The Mac app's code is public.
- The Omarchy plugin, installed by cloning, also downloads `macos/` (a few MB, never loaded).
- A one-time migration of about a day, and a rename that leans on GitHub's redirects.

## Out of scope

- Renaming the shared names (the plugin id, the folders, the runner, the routes).
- Moving the Omarchy launcher into a subfolder.
