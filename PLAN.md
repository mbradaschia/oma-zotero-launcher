# oma-zotero — Zotero launcher for Omarchy: implementation plan

A keyboard-first Zotero launcher for Omarchy 4. One keybinding opens a search overlay:

- You fuzzy-search the library by title, author and year.
- Items already open in Zotero are listed before you type.
- **Enter** opens the item in Zotero.
- **Tab** opens a submenu: open the PDF externally or in its own window, read notes, and add or remove tags with fuzzy tag search.

> Status: **Phases 0–6 done (2026-09-28)**. `SUPER+SHIFT+Z` opens the overlay; typing and Enter land on the right
> Zotero tab, focused. Tab opens the item's actions: the PDF externally or in a new Zotero window, the item's
> notes (read as Markdown in the overlay), its tags (a fuzzy tag editor), or the item in the library.
> Passing: `make test` (89 unit tests), `make lint`, `make smoke` (49 live bridge checks), `make e2e` (25 overlay
> + 44 actions + 50 notes + 33 tags + 23 states end-to-end checks with real keystrokes), `make e2e-write` (47, real
> tag edits, cleaned up) and `make fresh-install` (27: the release `.xpi` in a throwaway Zotero profile, then
> `omarchy plugin add` from git). Spike results are in [`spikes/PHASE0.md`](spikes/PHASE0.md). Phase 7 is optional.
> Facts below were checked against local source (`/usr/share/omarchy`, Zotero's `omni.ja`) or tested live on this
> machine: Omarchy 4.0.0, Hyprland 0.56.2, Quickshell 0.3.1 / Qt 6.11.2, Zotero 10.0.3.

---

## 1. What we are building

| # | Component | Runs in | Why it is needed |
|---|-----------|---------|------------------|
| A | **Zotero bridge**: a small Zotero 10 bootstrap plugin (`.xpi`) exposing token-protected endpoints on Zotero's own local server | the Zotero process | Open tabs are only visible from inside Zotero. `session.json` lags up to 5 min and is never written on tab switch. Switching tabs, opening readers and editing tags need Zotero's JS APIs. Fuzzy search is only fast in Zotero's JIT (see the benchmark in §2). |
| B | **Omarchy shell plugin**: overlay + service (QML) | the `omarchy-shell` Quickshell process | Native Omarchy look via theme tokens, a layer-shell overlay on the focused monitor, `o.bind(... { panel = ... })` keybinding, hot reload. It stays loaded, so it appears instantly. |

```
 SUPER+SHIFT+Z ─► Hyprland ─► omarchy-shell shell toggle <plugin-id>
                                   │
                    ┌──────────────▼───────────────────────────────┐
                    │ Omarchy shell plugin (QML)                   │
                    │  ZoteroSearch.qml  overlay: views, keys, UI  │
                    │  Service.qml       client, state, focusing   │
                    └──────┬─────────────────────────────┬─────────┘
  XHR → 127.0.0.1:23119    │ headers: Zotero-Allowed-Request: 1       │ Hyprland.toplevels
                           │          Authorization: Bearer <token>   │ + focus dispatch
                    ┌──────▼──────────────────┐   ┌──────▼──────────────┐
                    │ Zotero 10               │   │ Zotero window(s)    │
                    │ oma-zotero-launcher.xpi │   │ class "Zotero"      │
                    │  /oma-zotero/* routes   │   └─────────────────────┘
                    │  in-memory search index │
                    │  Items/Tabs/Reader/Tags │   token handshake file:
                    └─────────────────────────┘   $XDG_RUNTIME_DIR/oma-zotero/bridge.json (0600)
   External PDFs: the shell runs `uwsm-app -- xdg-open <path>` (→ Evince), not Zotero.
```

### Requirement → design

| Requirement | How |
|---|---|
| Keybinding shows a search box | `o.bind("SUPER + SHIFT + Z", "Zotero search", { panel = "<id>" })` in `~/.config/hypr/bindings.lua` toggles a `keepLoaded` overlay plugin |
| Fuzzy search by title, author, year | `POST /oma-zotero/search` runs an fzf-style scorer over an in-memory index inside Zotero (§5.4) |
| Items already opened in Zotero shown by default | An empty query returns **Open in Zotero** first. This covers reader and note tabs plus separate reader windows, most recently used first (`timeSelected`), with the current tab marked. **Recently added** follows and can be switched off. Open items are also badged and boosted in normal results. |
| Enter opens the item in Zotero | If it is open, switch to its tab or window. Otherwise open the best PDF, EPUB or snapshot in Zotero's reader. Otherwise select it in the library. Then the shell focuses the right Zotero window through Hyprland. |
| Tab → submenu | Actions: *Open PDF in external viewer* (xdg-open → Evince), *Open PDF in new Zotero window*, *Notes (n)*, *Tags (n)*, *Show in library* |
| Show notes | Notes list, then a note reader in the overlay (Markdown from Zotero's Note Markdown translator). Enter opens the note in Zotero. |
| Add/remove tags with fuzzy search of existing tags | Tag editor: the item's tags (✓) plus all library tags, fuzzy-filtered as you type. Enter toggles. A "Create tag …" row appears when there is no exact match. Colored and automatic tags are shown distinctly. |

---

## 2. Facts about this machine that shaped the plan

**Omarchy shell**
- Omarchy `4.0.0.r6663` is a read-only package at `/usr/share/omarchy`. The shell is
  `quickshell -n -p /usr/share/omarchy/shell`.
- Plugin location and manifest:
  - Plugins live in `~/.config/omarchy/plugins/<id>/`.
  - `manifest.json` needs `schemaVersion: 1` and `id, name, version, kinds, entryPoints`.
  - `kinds` ∈ `bar | bar-widget | menu | overlay | panel | service`. Each kind needs its entry point.
  - Ids may not use `omarchy.*`, and symlinks inside the folder are refused.
- Hot reload and enablement:
  - Saving under the plugins dir hot-reloads the plugin (`inotifywait`).
  - A third-party plugin must be in `shell.json` `plugins[]`; `omarchy plugin enable <id>` does that.
- Overlay contract: a QML `Item` with `shell`, `manifest`, `service` (injected, including the plugin's own `service`
  instance), `opened`, `open(payloadJson)` and `close()`. `keepLoaded: true` keeps the surface alive between summons.
  `qs.Commons` (`Color`, `Style`, `Util`, `Border`) and `qs.Ui` (`OverlayWindow`, `BorderSurface`, …) are importable.
  Community plugins do this (136 and 124 imports).
- Reference code: `$OMARCHY_PATH/shell/plugins/menu/Menu.qml` (rows, header-as-input, keys, scroll scrims) and
  `emojis/Emojis.qml` (minimal overlay). `Util.editsFilter` / `editedFilter` / `execArgv` are reusable.
- Settings convention: `~/.config/omarchy/<name>.json`. Tab and Backtab can be captured in overlays; `image-picker`
  and `PanelKeyCatcher` do it. XHR over http works in the shell; the news plugin uses it.
- Logs: `quickshell log -p /usr/share/omarchy/shell -f` (`console.warn` shows up there).

**Hyprland 0.56.2 (Lua config)**
- Bindings go in `~/.config/hypr/bindings.lua` with `o.bind`. `{ panel = id }` falls back to
  `omarchy-shell shell toggle <id>` for plugins that are not in `default/omarchy/shortcuts`.
- Free: `SUPER+Z`, `SUPER+SHIFT+Z`, `SUPER+ALT+Z`. Taken: `SUPER+CTRL+Z` (zoom), `SUPER+CTRL+ALT+Z`.
- Focus: `hyprctl dispatch 'hl.dsp.focus({ window = "address:0x…" })'`, falling back to classic `focuswindow`
  (this is `omarchy-launch-or-focus`). Quickshell exposes `Hyprland.toplevels` (`address`, `title`,
  `lastIpcObject`), `refreshToplevels()` and `dispatch()`.

**Zotero 10.0.3** (Arch build `10.0.3.SOURCE`, Gecko 140 ESR)
- **Server.** It listens on **127.0.0.1:23119 only** (not `::1`) and rejects any `Host` other than localhost or 127.0.0.1.
  A request whose User-Agent starts with `Mozilla/`, or that carries `Origin`, is **dropped without a response** unless
  it sends `Zotero-Allowed-Request` (or a connector version header).
  - Qt's XHR User-Agent is `Mozilla/5.0`. **Tested: QML XHR → status 0 without the header, 200 with
    `Zotero-Allowed-Request: 1`.**
  - CORS headers are only ever sent for `https://www.zotero.org`.
- **Endpoint contract.** `Zotero.Server.Endpoints["/path"] = class`:
  - Instance `supportedMethods` / `supportedDataTypes`. JSON bodies are parsed automatically.
  - An `init` of arity 1 receives `{method, pathname, pathParams, searchParams, headers(case-insensitive), data}` and
    returns `[status, contentType|headers, body]` or a Promise of that.
  - A default parameter (`init(o = {})`) has arity 0 and gets a different calling convention, so avoid it.
- **Local API.** Enabled, and read-write in 10.0.3. Writes need a key approved in a modal, `Zotero-Server-ID`, and
  version preconditions. It has no open tabs and no tag colors. A full `items/top` JSON dump takes **4–5 s / 12.5 MB**
  for this library (the `keys` and `versions` formats take ~40–50 ms).
- **Tabs.** `Zotero_Tabs._tabs` holds `{id, type, title, data:{itemID}, timeSelected, timeUnselected}`, with types
  `library`, `reader[-unloaded|-loading]`, `note[-unloaded|-loading]`.
  - Tabs auto-unload (only 3–5 stay loaded), so `_tabs` is the source of truth, not `Zotero.Reader._readers`.
  - Reader windows are `ReaderWindow` instances (`windowtype zotero:reader`).
  - The main window title is `<selected tab title> - Zotero`.
  - Tab notifier events are incomplete: `select` and `close` carry no itemID, so read tabs on demand.
- **Other internals.** `session.json` is written at quit or 5 min after a tab is added or closed, never on switch, so it
  is only a degraded fallback. The DB is opened with `locking_mode=EXCLUSIVE` + WAL, so it can't be read directly.
- **Plugins.** Unsigned XPIs install fine. An XPI dropped into the profile folder is a "foreign install" and starts
  disabled, so install via *Tools → Plugins → Install From File*. `llm-for-zotero` and `Beaver` (installed) register
  token-authenticated endpoints the same way we will.
- **This library.** 2,816 top-level items (9,739 in total), 127 tags, no groups. The window class is `Zotero`.
  `zotero://` → `zotero -url %U` (D-Bus remote to the running instance). The default PDF app is **Evince**.

**Fuzzy-search benchmark** (my spike: an fzf-v1-style scorer over synthetic titles and authors, top 150)

| Engine | 3k items | 10k items | 30k items |
|---|---|---|---|
| node / V8 (proxy for Zotero's SpiderMonkey JIT) | 2.4 – 6.4 ms | 5 – 19 ms | 16 – 64 ms |
| Qt V4 (the shell's JS engine), JIT on | 8 – 87 ms | 26 – 268 ms | 107 – 836 ms |
| Qt V4 + char-mask prefilter + incremental narrowing | avg 14–34, max 84 ms/keystroke | avg 52–117 ms | — |
| `fzf --filter` subprocess (spawn + filter) | 21 – 27 ms | 24 – 50 ms | — |

⇒ **Search runs inside Zotero; QML stays a thin, always-smooth UI.** `fzf --filter` over a cached index is the
offline fallback. It folds diacritics (`muller` → `Müller`), and Qt V4 has `String.normalize` for local lists.

### Alternatives considered

| Option | Verdict |
|---|---|
| Extend the built-in Omarchy menu (`omarchy-menu.jsonc` provider) | ✗ Enter/→ only, fixed built-in providers, no Tab or per-row actions, no preview or toggling |
| fzf in a floating terminal | ✗ Not native, and slower to appear. Kept only as the offline search engine. |
| Local API only (no Zotero plugin) | ✗ No live open tabs, a 4–5 s full sync, and interactive per-app approval for writes. Kept as a degraded "bridge missing" mode (phase 7). |
| Search in QML | ✗ 8–87 ms per keystroke at 3k items |
| **Bridge XPI + shell overlay, search in Zotero** | ✓ chosen |

---

## 3. Repository layout

The repo root **is** the Omarchy plugin, so `omarchy plugin add <git-url> --enable` works for distribution.
The Zotero bridge lives in a subfolder and is built into an `.xpi`.

```
oma-zotero-launcher/
├── manifest.json               # Omarchy plugin manifest (overlay + service)
├── ZoteroSearch.qml            # overlay entry point: view stack, keyboard, layout
├── Service.qml                 # service entry point: bridge client, status, focus, launching
├── lib/
│   ├── Client.js               # pure: handshake parsing, response classification, search coalescing,
│   │                           #   settings validation (normalizeSettings)
│   ├── Views.js                # pure: rows/sections, highlights, icons, counts, selection; actions, file
│   │                           #   picker, notes list and tag editor rows (one row shape for all lists)
│   └── Fuzzy.js                # pure: fzf-style scorer for the local lists (tags, notes)
├── zotero-bridge/              # Zotero 10 bootstrap plugin
│   ├── manifest.json           # manifest_version 2, applications.zotero {...}
│   ├── bootstrap.js            # lifecycle → loads lib/*.js, Bridge.start()/stop()
│   ├── prefs.js                # default prefs (token, enterAction, …), loaded automatically
│   ├── lib/bridge.js           # endpoint registration, auth, routing, error model, handshake file
│   ├── lib/index.js            # in-memory index + Zotero.Notifier maintenance
│   ├── lib/search.js           # PURE query parser + scorer (node-testable)
│   ├── lib/tabs.js             # open tabs/windows adapter (the only user of private UI internals)
│   ├── lib/loader.js           # module list, re-read on hot reload (bootstrap.js is cached by Zotero)
│   ├── lib/actions.js          # Enter semantics: pure plan() + execute(); fileAttachments() + its order
│   ├── lib/notes.js            # notes list, note → Markdown (Zotero's translator on a cleaned copy)
│   ├── lib/noteFormat.js       # pure: Markdown clean-up (images, app links, raw HTML, links, spacing),
│   │                           #   size cap, excerpts, plain titles
│   ├── lib/tags.js             # tag list/counts/colors, item tags, undoable updates; compare/cleanNames pure
│   ├── lib/dev.js              # dev-only routes (bench, samples, ui-state/restore, note/tag samples, undo
│   │                           #   snapshot/restore, tag purge, delay, …); left out of release builds
│   └── updates.json            # update manifest (update_url target), written by build-xpi.sh
├── tests/                      # node --test: bridge search/actions/index/notes/tags/auth/tabs, plugin libs
├── scripts/
│   ├── dev-sync.sh             # copy the shell plugin → ~/.config/omarchy/plugins/<id>/ (+ --watch)
│   ├── shell-restart.sh        # omarchy restart shell, verified (retries once if the shell didn't come back)
│   ├── e2e-lib.sh              # shared helpers for the end-to-end scripts (IPC, waits, restore)
│   ├── overlay-e2e.sh          # end-to-end: real keybinding/keys → Zotero tab + focus (make e2e)
│   ├── actions-e2e.sh          # end-to-end: Tab actions, picker, viewer/reader window (make e2e)
│   ├── notes-e2e.sh            # end-to-end: notes list, reader, copy, open in Zotero (make e2e)
│   ├── tags-e2e.sh             # end-to-end: tag editor; real edits with OMA_ZOTERO_WRITE_TESTS=1 (make e2e-write)
│   ├── states-e2e.sh           # end-to-end: no matches, timeout, rejected token, every setting (make e2e)
│   ├── fresh-install-test.sh   # the README install from scratch (make fresh-install)
│   ├── lint.sh                 # syntax checks: JavaScript, QML ([syntax] findings), shell scripts
│   ├── uinput-keys.py          # kernel-level key chord (fires Hyprland binds; wtype can't)
│   ├── build-xpi.sh            # reproducible release .xpi (no dev.js) + updates.json with its sha256
│   ├── bridge-dev-link.sh      # extension proxy file for unpacked dev loading (verified, see §8)
│   ├── bridge-reload.sh        # hot-reload bridge code without restarting Zotero
│   ├── bridge-restart.sh       # graceful Zotero restart (only after editing bootstrap.js)
│   └── smoke.sh                # curl+jq contract, security & latency checks against live Zotero
├── Makefile                    # make help: test, lint, xpi, install, e2e, smoke, fresh-install, bridge-*
├── README.md  LICENSE (MIT)  preview.png  PLAN.md  .gitignore (dist/)
```

**Identifiers** (placeholders, see §10)
- Omarchy plugin id: `io.github.mbradaschia.oma-zotero`
- Zotero add-on id: `oma-zotero-bridge@mbradaschia.github.io`
- HTTP routes: `/oma-zotero/*`
- Handshake file: `$XDG_RUNTIME_DIR/oma-zotero/bridge.json` (0600). It is rewritten on every Zotero start and disappears on logout.
- Settings file: `~/.config/omarchy/oma-zotero.json`

---

## 4. Shared behaviour contract

- The **empty query** shows `open` (MRU, or tab-bar order) and then `recent` (by `dateAdded` or `dateModified`,
  excluding open items, default 15), per the `emptyQuery` setting (§6.7).
- **Search scope** is regular top-level items plus standalone file attachments. Trashed items are excluded.
- **Query syntax** is an fzf-compatible subset, so the offline fallback behaves the same:
  - Space-separated tokens are ANDed.
  - `'exact` matches a substring, `^prefix` and `suffix$` anchor, `!term` negates, `a|b` is OR.
  - Field qualifiers: `a:` author, `t:` title, `y:` year (`y:2019..2021`), `#tag`.
  - A bare 4-digit token is matched primarily against the year.
- **Ranking**:
  - fzf-v1 subsequence scoring: word-boundary, consecutive-run and field-start bonuses, minus a gap penalty.
  - The best field per token wins, weighted title 1.0, creators 1.2, exact year high.
  - Token scores are summed. A title holding the query's title words as one phrase gets a bonus, larger at the
    start of the title and the more of the title the phrase covers (queries of 3+ characters), so typing a whole
    title puts that item first. Ties go to open items first, then the newest `dateModified`.

---

## 5. Component A: Zotero bridge

### 5.1 Packaging & lifecycle
- `manifest.json` uses `manifest_version: 2` with `applications.zotero { id, update_url, strict_max_version }`, all
  **required**, or install fails. Set `strict_min_version: "10.0"` and `strict_max_version: "10.*"`. Zotero's docs
  suggest `10.0.*` bumped after testing; this Arch `SOURCE` build doesn't enforce the max, but official builds do.
- Hooks are called as `fn({ id, version, rootURI }, reason)` in a system-principal sandbox. `Zotero`, `Services`,
  `IOUtils`, `PathUtils`, `crypto`, `fetch` and timers are available. `startup` runs after Zotero init, when the HTTP
  server is already up. Before using synchronous item getters, call
  `await Zotero.Libraries.get(id).waitForDataLoad('item')`.
- `shutdown`: return early on `APP_SHUTDOWN`. Otherwise unregister endpoints and the notifier and clear timers, so
  disable/enable hot-reloads cleanly. Don't rely on the `reason` passed to `onMainWindowUnload`: it is a known
  loader bug (9 instead of 10).

```js
// bootstrap.js (shape)
var bridge;
async function startup({ id, version, rootURI }, reason) {
  const scope = { Zotero, Services, IOUtils, PathUtils, crypto };
  // the module list lives in lib/loader.js (re-read on hot reload); "dev" is optional
  for (const f of ["noteFormat", "search", "tabs", "index", "notes", "tags", "actions", "dev", "bridge"])
    Services.scriptloader.loadSubScript(`${rootURI}lib/${f}.js`, scope);
  bridge = new scope.Bridge({ id, version, rootURI });
  await bridge.start();          // waitForDataLoad → build index → register routes → write handshake
}
function shutdown(data, reason) { if (reason === APP_SHUTDOWN) return; bridge?.stop(); bridge = null; }
function install() {}  function uninstall() {}
```

### 5.2 Security
Zotero already blocks cross-site web pages (Host check, User-Agent/Origin dropping, no CORS). What remains exposed is
local processes and scripts on www.zotero.org. So:
1. **Token.** Generate a `crypto.randomUUID()` token once and store it in a pref. On every start, write
   `{port, token, bridgeVersion, zoteroVersion}` to `$XDG_RUNTIME_DIR/oma-zotero/bridge.json` (dir 0700, file 0600).
   Every route requires `Authorization: Bearer <token>` (constant-time compare), otherwise 401.
2. **Reject any request with an `Origin` header** (403). Verified: Quickshell's XHR sends none (it sends
   `User-Agent: Mozilla/5.0`, which is why `Zotero-Allowed-Request: 1` is mandatory).
   Never set `allowRequestsFromUnsafeWebContent`.
3. POST + JSON only (except `ping`), with strict validation: keys `^[A-Z0-9]{8}$`, integer `libraryID`, tags trimmed
   to 1–255 characters, body ≤ 64 KiB. Check `Zotero.Libraries.get(id).editable` before writes. No generic
   eval/execute route, ever.
4. Endpoint wrapper pattern (from llm-for-zotero + Beaver):
   - `init = async (req) => …` keeps arity 1.
   - A shared `active` flag makes in-flight calls after unregistering return 503.
   - On stop, delete a route only if it is still our class.

```js
function route(handler, methods = ["POST"]) {
  return class {
    supportedMethods = methods;
    supportedDataTypes = ["application/json"];
    init = async (req) => {                                  // {method, headers, data, searchParams, ...}
      if (!Bridge.active) return reply(503, { code: "inactive" });
      if (req.headers.origin) return reply(403, { code: "origin" });
      if (!Bridge.tokenOk(req.headers.authorization)) return reply(401, { code: "token" });
      try { return [200, "application/json", JSON.stringify({ ok: true, ...(await handler(req.data ?? {})) })]; }
      catch (e) { Zotero.logError(e); return reply(e.status ?? 500, { code: e.code ?? "internal", message: String(e.message) }); }
    };
  };
}
```

### 5.3 Routes (responses `{ ok: true, … }` or `{ ok: false, error: { code, message } }`)

| Method | Route | Request | Response / effect | Zotero APIs |
|---|---|---|---|---|
| GET | `/oma-zotero/ping` | – | versions, counts, `openCount` | `Zotero.version` |
| POST | `/oma-zotero/search` | `{ query, limit≤200, emptyQuery? }` | `{ open[], recent[], results[], total }`; an empty query also returns `recentBy` and the effective `emptyQuery` options. Row: `key, libraryID, itemType, title, creator, year, publication, open{kind,tabId,selected}, pdfCount, noteCount, tags[≤3], tagCount, titleRanges[[s,e]]` | index, `tabs.js` |
| POST | `/oma-zotero/item` | `{ key, libraryID }` | `{ item, openAction, attachments[], notes[], noteCount, tags[], tagCount, library }`. `openAction` is what Enter would do (§5.6). `attachments`: the file attachments (linked URLs have none), each `{key, libraryID, title, filename, contentType, readerType, exists, best}`, sorted existing files first, then Zotero's best attachment, then PDFs, then by title. A standalone file lists itself. `notes`: child notes, newest edit first, `{key, libraryID, title, dateModified, excerpt}` (a note lists itself). `tags`: one per name, manual winning over automatic, `{tag, type, color, position}`. `library`: `{libraryID, name, type, editable}`. | `getByLibraryAndKeyAsync`, `getAttachments`, `getBestAttachment`, `getFilePathAsync`, `getNotes`, `getTags`, `Zotero.Tags.getColors` |
| POST | `/oma-zotero/note` | `{ key, libraryID?, format?: "display"\|"export", linkColor? }` | `{ key, libraryID, title, dateModified, parent, format: "markdown"\|"text", markdown, truncated, chars }`. `display` (default): cleaned for the overlay (below), cut at a paragraph break after 60,000 characters, web links as `<a style="color:…">` in `linkColor`, small spacers between paragraphs. `export`: exactly Zotero's *Export Note → Markdown* (app links kept), for Ctrl+C. Errors: 400 `not-a-note` / `bad-format`, 500 `export-failed` (export only; display falls back to plain text). | Note Markdown translator (`TRANSLATOR_ID_NOTE_MARKDOWN`, display option `includeAppLinks: false` for display), `DOMParser`, `Zotero.Utilities.unescapeHTML` |
| POST | `/oma-zotero/open` | `{ key, libraryID?, dryRun? }` | Enter semantics (§5.6). Returns `{ action, windowKind, windowTitle, item }`; with `dryRun`, the plan only. Errors: 400 `bad-key` / `bad-library`, 404 `not-found`, 409 `trashed` / `no-main-window` / `window-gone` / `not-selectable` | `Zotero_Tabs.select`, `Zotero.Reader.open`, `Zotero.Notes.open`, `ZoteroPane.selectItem` |
| POST | `/oma-zotero/attachment` | `{ key, libraryID?, target: "path"\|"window", markOpened?, dryRun? }` for one file attachment (the shell picks it from `/item`) | `path`: `{ path, key, contentType, readerType }`; the shell launches the viewer. Like Zotero's own external open, it fires `Zotero.Notifier.trigger('open','file',id)` unless `markOpened: false` or `dryRun`. `window`: opens a separate reader window, `{ windowKind: "reader", windowTitle, … }`. Errors: 400 `not-a-file` / `bad-target`, 409 `missing-file` / `no-reader` (window only), plus the `_item` errors of `/open`. | `getFilePathAsync`, `Zotero.Reader.open(id, null, { openInWindow: true, allowDuplicate: true })` after `OmaTabs.pruneDeadReaderWindows()` |
| POST | `/oma-zotero/reveal` | `{ key, libraryID?, dryRun? }` | Select in the library tab, switching to the library root (or trash) if the item isn't in the current view. Also used for Enter when `enterAction: "select"`. | `ZoteroPane.selectItem`, verified via `getSelectedItems` |
| POST | `/oma-zotero/tags/list` | `{ libraryID? }` | `{ libraryID, editable, tags: [{ tag, types[], count, color, position }] }`: colored tags first (by slot, unused ones included), then by count, then by name. 129 tags in ~20 ms. | `Zotero.Tags.getColors` (Map; emoji names), one count query over `itemTags ⋈ tags ⋈ items` minus `deletedItems` |
| POST | `/oma-zotero/tags/update` | `{ key, libraryID?, add[], remove[] }` | `{ item, added[], removed[], tags[] }` (the item's tags after the save). Names are trimmed and de-duplicated; empty, multi-line, >255-character (Zotero's sync limit), >50, both-added-and-removed, or nothing to do → 400 `bad-tags`. Read-only library → 409 `read-only`, naming it. Adding a name the item already has (either type) is a no-op. | `item.addTag(t, 0)`, `item.removeTag(t)`, one `await item.saveTx({ undoAction, undoActionArgs: { count } })` with Zotero's own labels: "Add Tag", "Remove Tag", "Remove N Tags", "Change Tag" (add + remove) |

`allowDuplicate: true` is required for "new window". Without it, `Reader.open` just selects an existing unloaded tab.
A `ReaderWindow` leaves `Zotero.Reader._readers` only through `reader.close()`, which `reader.xhtml`'s `onclose`
calls. A window closed by script (`win.close()`) stays listed, and the next `Reader.open(…, { openInWindow })` would
reuse that dead entry and open nothing. So the window target first prunes readers without a tab whose window is
dead or closed, and the dev routes close reader windows with `reader.close()`.
`getTags()` omits `type` for manual tags (0), and a tag with both types appears twice, so merge by name.
**Editability:** `item.isEditable()` is true for feed items (Zotero itself writes their read state), so the bridge
also requires the library's `editable` flag. Feed items load lazily; `_item()` loads them before use.
**Notes for display** (`notes.js`, `noteFormat.js`): the translator gets an unsaved copy of the note (as Zotero's own
editor does for copy-as-Markdown) whose HTML is cleaned first: `<img>` → `[image]`, links other than http(s)/mailto
keep only their text, table cells are flattened to one line (note-editor cells hold `<p>`s, which the translator
spreads over several lines), and a table's first row becomes a heading row (the translator keeps heading-less tables
as raw HTML). Afterwards, raw HTML outside code is shown as text except a few attribute-free inline tags (Qt renders
HTML in Markdown and would load remote images), and web links become colored `<a>` tags (Qt ignores `linkColor` and
`palette.link` for Markdown). The translator reports success only through "done"; failures (e.g. translators not yet
installed right after a new profile's first start) surface as an error, a rejected promise, or nothing, so the
conversion also listens for those and gives up after 15 s, and the overlay gets plain text instead.

### 5.4 Index (`index.js`) and search (`search.js`)
- **Build.** Wait for `waitForDataLoad('item')`, then take `Zotero.Items.getAll(libraryID, true, false, true)` for
  every library and filter to `isRegularItem()` plus standalone file attachments. `onlyTopLevel` does *not* exclude
  annotations. Entry fields:
  - `getDisplayTitle()`, with Zotero's rich-text markup (`<i>`, `<b>`, `<sub>`, `<sup>`, small caps, nocase) and
    stray whitespace removed, so rows show plain titles and match offsets stay right
  - `getField('firstCreator', true)`
  - names from `getCreatorsJSON()`
  - `getField('year')`, `publicationTitle`
  - `dateAdded`, `dateModified`
  - counts from `getAttachments()` / `getNotes()`, tag names
  Folded copies are made per character (lowercase, NFD, combining marks stripped), so match offsets map onto the
  original title. Avoid per-item `toJSON()` and `getBestAttachments()`, which run one SQL query each. Measured:
  2,795 entries in 290–490 ms, built asynchronously after startup.
- **Maintenance.** `Zotero.Notifier.registerObserver(obs, ['item','item-tag','tag','trash'], 'oma-zotero')`, debounced
  to 200 ms:
  - Recompute the affected entries.
  - Use a child→parent map so attachment and note add/delete events update the parent's counts.
  - `item-tag` ids look like `"<itemID>-<tagID>"`.
- **Search.** A pure function over entries implementing §4, with per-field char masks, cheapest-first term order,
  bounded top-K, and fzf-style incremental narrowing (`OmaSearch.canNarrow`, proven equivalent by tests).
  - Measured in-bridge: p95 < 10 ms for most queries, 11–18 ms worst case (1–3-char prefixes), doubling under
    heavy system load.
  - End-to-end from Quickshell: p50 7 ms / p95 11 ms when the system is quiet.
  - Remaining lever: client coalescing (Phase 2). If still needed, word-prefix semantics for 1–2-char queries.

### 5.5 Open tabs adapter (`tabs.js`)
- Enumerate `Zotero.getMainWindow().Zotero_Tabs._tabs` with types `reader*` and `note*`. Map `data.itemID` (the
  attachment or note) to its parent regular item, or keep it standalone. De-duplicate, keeping the tab with the
  newest `timeSelected`. Mark `Zotero_Tabs.selectedID`. Sort by MRU, or by tab-bar position (`openItems({ order:
  "tabbar" })`, the `emptyQuery.tabOrder` setting), separate windows last.
- Reader windows: `Zotero.Reader._readers` entries without a `tabID` (ReaderWindow). Report
  `{kind:"window", title: win.document.title}`.
- Feature-detect everything. If internals change, degrade to `session.json` (stale) plus the currently selected tab
  parsed from the Hyprland window title, and log a warning.

### 5.6 Enter semantics (`/open`)
Implemented in `lib/actions.js`: the pure `plan()` decides and `execute()` acts. `tests/actions.test.js` covers
every branch.
1. **`switch-tab`**: the item itself, or any of its attachments or notes, has a tab →
   `Zotero_Tabs.select(tabId)`, which also loads unloaded tabs.
   - The selected tab wins, then the most recently selected, then tab-bar order.
   - A tab wins over a separate window.
2. **`focus-window`**: it only has a separate reader or note window → `win.focus()`, and its title is reported.
3. **`open-note`**: the key is a note → `Zotero.Notes.open`, which opens a note tab, or a window per Zotero's prefs.
4. **`open-reader`**: the item has a readable file → `Zotero.Reader.open(att.id)`. Readable means the file exists
   and `attachmentReaderType` is pdf/epub/snapshot. For a regular item that is the first such file in `/item`'s
   order, not blindly `getBestAttachment()`, which can pick a missing file while a sibling PDF exists. A standalone
   file uses itself. This always uses Zotero's reader, even if its file-handler prefs say "system"; the submenu has
   the explicit external action.
5. **`select`**: nothing is openable (no attachment, missing file, linked URL, unsupported type) →
   `ZoteroPane.selectItem`.
6. **Return value**: `{ action, windowKind: "main"|"reader"|"note", windowTitle }`. The **shell** focuses the window
   (§6.2). Even though Omarchy sets `focus_on_activate = true`, most of these actions are DOM-level and don't raise
   Zotero on their own.

---

## 6. Component B: Omarchy shell plugin

### 6.1 `manifest.json`
```json
{
  "schemaVersion": 1,
  "id": "io.github.mbradaschia.oma-zotero",
  "name": "Zotero",
  "version": "0.1.0",
  "author": "…",
  "license": "MIT",
  "description": "Fuzzy-search your Zotero library from anywhere: open items, PDFs, notes and tags",
  "kinds": ["overlay", "service"],
  "keepLoaded": true,
  "entryPoints": { "overlay": "ZoteroSearch.qml", "service": "Service.qml" }
}
```

### 6.2 `Service.qml` (mounted at shell start)
- **Watches** the handshake file (`$XDG_RUNTIME_DIR/oma-zotero/bridge.json`) and the settings file with
  `FileView { watchChanges: true }`.
- **`Client.js`** sends XHR to `http://127.0.0.1:<port>/oma-zotero/…`. Use the literal `127.0.0.1`, because the server
  is not on `::1`.
  - Headers: `Zotero-Allowed-Request: 1`, `Authorization: Bearer <token>`, `Content-Type: application/json`.
  - A `Timer` aborts slow requests (search 4 s; item details and opening things 8 s). `abort()` fires the XHR's
    DONE event synchronously with status 0, which is classified as a timeout, not "Zotero is down".
  - **Search coalescing:** one search in flight at a time, and the newest pending query is sent when it returns.
  - XHR is right here because the peer is our own bridge. The news plugin's reason to avoid XHR (unbounded
    untrusted feeds) doesn't apply.
- **`status`**:
  - `ready`
  - `zotero-down`: connection refused, or `/connector/ping` fails
  - `bridge-missing`: Zotero is up but `/oma-zotero/ping` returns 404 or there is no handshake file
  - `unauthorized`: after 401, re-read the handshake once
  - `error`
- **`focusZotero({windowKind, windowTitle})`**: call `Hyprland.refreshToplevels()`. Among toplevels whose
  `lastIpcObject.class == "Zotero"`, pick an exact title match (reader windows are titled
  `<title> - <creator> - <year>`), else the main window (`initialTitle == "Zotero"`). Dispatch
  `Hyprland.dispatch('hl.dsp.focus({ window = "address:0x…" })')` (verified; addresses come without `0x`), falling
  back to `hyprctl dispatch focuswindow`. Poll for up to 300 ms if the title update lags.
- **Launching.** `launchZotero()` runs `uwsm-app -- zotero`. `openExternal(paths)` runs `uwsm-app -- xdg-open <path>`,
  and the command is overridable (e.g. `zathura`). Both go through `Util.execArgv`, so no shell interpolation.
- **Errors after the overlay has closed** are reported with `notify-send "Zotero" "…"`.
- **Settings** are read synchronously (`blockLoading`) at start, on change, and on every open (a file created after
  the shell started isn't watched yet), and normalized by `Client.normalizeSettings`: invalid values fall back to
  their defaults and are listed in `settingsProblems` (logged, and the first shown in the overlay's footer).
- **Notes and tags:** `noteContent(note, { format, linkColor })`, `openNote(note)` (`/open` on the note key, then
  focus), `tagList(libraryID)`, `updateTags(item, add, remove)`. `copyText(text)` pipes into `wl-copy` through a
  `Process`'s stdin (a note can be longer than one command-line argument may be).

### 6.3 `ZoteroSearch.qml` (overlay)
- **Structure** follows `Menu.qml`: `OverlayWindow` (scrim, focused monitor) → `BorderSurface` card using the
  `Color.menu.*` and `Style.*` tokens, so every Omarchy theme styles it.
  - The card is `min(Style.space(760), screen − gaps)` wide.
  - The header acts as the input: typed text, placeholder "Search Zotero…", and a status on the right (`3 open · 2,816 items`).
  - A footer shows key hints.
- **View stack.** Back restores each view's filter and cursor: `search → actions → notes → note`, `actions → tags`,
  and `actions → files` (only when there is more than one file). One note goes straight to the reader.
- **Filtering.** Only the main search goes to the bridge. Notes and tags are ranked locally with `lib/Fuzzy.js`
  (fzf-style: terms ANDed in any order, word starts and runs score higher, matches highlighted); the few actions
  use a word-start-first subsequence filter. All list views share one row shape and delegate.
- **Tag editor.** Rows: the item's tags as they were when the view opened (kept in place when unchecked, so a slip
  is easy to undo), then tags added since, then the library's (colored by slot, then most used); capped at 300.
  Toggling is optimistic: the check and count change at once, the filter clears for the next tag, the cursor
  stays on the tag, and an error puts it back and says why in the footer. Tag lists are cached per opening.
- **`open(payload)`** accepts `{ "query": "…" }`, so scripts can pre-fill:
  `omarchy-shell shell summon <id> '{"query":"pimm 1984"}'`.
  - The previous results show instantly while fresh ones load, so the card never flashes empty.
  - An empty-query request fires on every open, so the open-tab list is always live.
- **Notes** render with `Text.MarkdownText` in a `Flickable` at the title font size, with the parent item's title
  above. Images become `[image]`, long notes are cut (with a line saying so), and web links (in the theme's accent)
  open with `uwsm-app -- xdg-open` after the overlay closes. Notes fetched once per opening are cached.

### 6.4 Keyboard map

| View | Keys |
|---|---|
| all | type = filter · `Backspace` / `Ctrl+Backspace` / `Ctrl+U` edit (`Util.editsFilter`) · `↑/↓`, `Ctrl+K/J`, `PgUp/PgDn` move · `Esc` clears the filter, or closes when it is empty · `Backspace`/`←`/`Shift+Tab` on an empty filter goes back (same as the Omarchy menu) |
| search | `Enter` open in Zotero · `Tab` / `→` actions for the highlighted item · `Alt+O` external PDF · `Alt+W` PDF in new Zotero window · `Alt+N` notes (straight to the note when there is one) · `Alt+T` tags · `Alt+L` show in library. With several files, `Alt+O`/`Alt+W` open the picker; with none (or no notes), the actions view on that row, which says why. `accelerators: false` turns the Alt keys off. |
| actions | type = filter the actions (word starts rank first) · `Enter` / `Tab` / `→` run the action or open its sub-view. Rows that can't run are dimmed and say why (no file, file missing, type the reader can't show). |
| files (picker) | `Enter` / `Tab` / `→` open the highlighted file; missing and unreadable files are listed but disabled |
| notes | type = fuzzy filter (title, then excerpt) · `Enter` / `Tab` / `→` read · `Alt+Enter` open the note in Zotero |
| note | no filter · `↑/↓` (`Ctrl+K/J`) scroll · `PgUp/PgDn`, `Space` / `Shift+Space` page · `Home/End` · `Enter` open in Zotero · `Ctrl+C` copy Markdown (`wl-copy`) · `Backspace`/`←`/`Shift+Tab` back |
| tags | type = fuzzy filter · `Enter` toggles the highlighted tag (or creates the *Create tag* row's name) · `Ctrl+Enter` adds exactly the typed text |

Tab and Backtab are accepted in the handler, so Qt never uses them for focus traversal. Alt-modified keys are
never treated as filter input (the shell's `Util.editsFilter` convention).

### 6.5 Row anatomy
```
󰈙  Supply Chain Coherence: Building Resilience for an Ever-Changing World          ● 1 3
   Stevenson et al. · 2026 · Journal of Business Logistics                  #resilience #sc
```
- **Content**: item-type Nerd Font glyph · title with the matched characters highlighted (escaped RichText spans) ·
  dim second line with the first creator, year and publication.
- **Trailing badges**: `●` open in Zotero (accent color), then PDF and note counts. The first 3 tags (`#a #b #c +N`)
  sit dimmer at the right of the second line and give way to the subtitle when space is short.
- **Empty-query sections**: *Open in Zotero*, *Recently added* (or *Recently modified*).
- **Tag rows**: ✓ state · colored-tag swatch · dim `auto` badge for automatic tags · a "Create tag “…”" row when
  there is no exact (case-insensitive) match.

### 6.6 States
- `bridge-missing`: "The Zotero bridge isn't installed", pointing to the README.
- `zotero-down`: "Zotero isn't running", and Enter starts it.
- `unauthorized`: after re-reading the handshake once, "Zotero rejected the bridge token: restart Zotero".
- Timeouts: "Search failed: Zotero didn't answer in time" (the next keystroke searches again).
- No results: "No matches for “…”" with a syntax tip, as in the menu.
- Notes: "Loading the note…", "Couldn't load the note", "This note is empty"; long notes say they're cut.
- Tags: "Loading tags…", an empty library invites a first tag, a read-only library disables the rows and says so
  in the header and the Tags action.
- Footer, right: a confirmation ("Copied the note as Markdown", "Added “…”"), else the last error, else the first
  settings problem.

### 6.7 Settings (`~/.config/omarchy/oma-zotero.json`, all optional)
```json
{
  "enterAction": "reader",
  "emptyQuery": { "showOpen": true, "tabOrder": "mru", "recent": "added", "recentLimit": 15 },
  "externalPdfCommand": ["zathura"],
  "maxResults": 60,
  "accelerators": true,
  "port": 23119
}
```
Validated by `Client.normalizeSettings` (unit-tested): `enterAction` `"reader"|"select"`, `maxResults` 10–200,
`port` 1–65535, `externalPdfCommand` a non-empty list of strings, `accelerators` boolean, `emptyQuery.showOpen`
boolean, `.tabOrder` `"mru"|"tabbar"`, `.recent` `"added"|"modified"|"none"`, `.recentLimit` 0–50. Anything else,
unknown keys and broken JSON are reported (footer + shell log) and fall back to the defaults. The bridge validates
`emptyQuery` again.

### 6.8 Keybinding & enablement
```lua
-- ~/.config/hypr/bindings.lua
o.bind("SUPER + SHIFT + Z", "Zotero search", { panel = "io.github.mbradaschia.oma-zotero" })
```
Then run `omarchy plugin enable io.github.mbradaschia.oma-zotero`, `hyprctl reload`, and `hyprctl configerrors` (must be clean).
Optionally, add a `zotero` row to `~/.config/omarchy/extensions/omarchy-menu.jsonc` whose action is
`omarchy-shell shell summon <id>`.

---

## 7. Implementation phases (each ends in something runnable)

| Phase | Scope | Size | Done when |
|---|---|---|---|
| **0 Spikes** ✅ | (a) minimal XPI with `ping` plus one POST route: arity-1 `init`, 401/403/503 paths via curl, QML XHR round-trip, and whether Qt sends `Origin`. (b) index build time and `search.js` latency on the real library, inside Zotero. (c) Hyprland discriminators for main, reader and note windows (title, `initialTitle`) and `Hyprland.dispatch` with `hl.dsp.focus`. (d) Note Markdown translator call form and output on a real note, rendered with `Text.MarkdownText`. (e) unpacked dev loading via proxy file on 10.x. (f) tag-count SQL, and Zotero 10 undo for tag edits. | S | **Done.** All decided, see `spikes/PHASE0.md`. Search stays in the bridge (p95 < 10 ms for most queries; mitigations for short prefixes). |
| **1 Bridge core** ✅ | lifecycle, handshake, auth wrapper, `ping`, index + notifier, `search` (incl. open + recent), `tabs.js`, `open`, `reveal` | M | **Done.** `make test` (29) and `make smoke-ui` (38 live checks, Zotero state restored) pass. `pimm 1984` → Pimm, `stev resil` → first-author Stevenson (first-author weighting added), `#^notion$` → exactly the 1,019 tagged entries. |
| **2 Overlay MVP** ✅ | manifest, Service (client, status, focus), search view, rows, empty-query sections, Enter, keybinding, dev-sync loop | M | **Done.** `make e2e` (25 checks): a real SUPER+SHIFT+Z (uinput) opens the overlay with keyboard focus; the empty query lists the open items first; typed `pimm 1984` / `stev resil` + Enter → Zotero on that tab, focused; Down/Up/Backspace/Esc; bridge-missing and zotero-down cards; state restored. |
| **3 Tab actions** ✅ | actions view, external PDF, PDF in new Zotero window, show in library, attachments picker | S | **Done.** `make e2e` adds 44 action checks with real keys: items with 0 files (URL only), 1 PDF, several PDFs (picker, back navigation), several with one on disk, a missing file, a snapshot, and a standalone PDF. Each is verified at the result: the viewer's command line names the right file, a new Zotero reader window is focused, or the library selection is correct. Everything the tests open is closed again. `make test` 49, `make smoke` 36. |
| **4 Notes** ✅ | `item` + `note` routes, notes list, Markdown reader, open note in Zotero, copy | S–M | **Done.** `make e2e` adds 50 note checks. On real notes: tables (one row per line), images → `[image]`, citations and highlights as text, note links (Better Notes) and `zotero://` links as text, web links in the theme color, code, math, and the longest note (93,504 chars) cut and flagged. Also: Alt+N with 0/1/3 notes, fuzzy filter with highlights, the reader's scrolling (PgDn/End/↑/Home), Ctrl+C (clipboard = Zotero's export; your clipboard put back), and Enter opening the note in Zotero, focused and unchanged. Real keys throughout. |
| **5 Tags** ✅ | `tags/list` + `tags/update`, tag editor (✓, fuzzy filter, toggle, create, colored/auto), optimistic updates | M | **Done.** `make e2e` adds 33 tag checks (order, validation, the item's tags first and checked, `auto` badges, colors, fuzzy filter, Create row rules, an edit Zotero refuses shown then reverted, real keys). The read-only refusal is checked live on a feed (409, named). `make e2e-write` (47): add → search finds it → remove → real Ctrl+Enter adds → Zotero's own Undo ("Add Tag") removes it; Zotero's undo history, the item's tags and the tag list end as they started. |
| **6 Polish & ship** ✅ | match highlighting, accelerators, key hints, every state, settings file, README + preview, `build-xpi.sh` + `updates.json`, `omarchy plugin validate` | M | **Done.** `make fresh-install` (27): the reproducible release `.xpi` installs in a new headless Zotero profile (own port, data and runtime dir), starts locked down without dev routes, and indexes, searches, converts notes and edits tags on an item saved through Zotero's connector; then `omarchy plugin add <git-url> --enable` installs the plugin, the real SUPER+SHIFT+Z opens it, and it searches the real library (your install restored). `states-e2e.sh` (23) covers no matches, a timeout, a rejected token and every setting. Title-phrase ranking, plain titles, `make lint`, LICENSE and preview added. |
| 7 Optional | offline mode (cached index + `fzf --filter`, `zotero -url zotero://select/...` to open), no-bridge degraded mode (Local API `q`), bar widget with open count, Omarchy-menu row, copy citation (`Zotero.QuickCopy`), open DOI/URL, open the external viewer at the last-read page (evince `-p`), annotations view, self-registering bind via `hyprctl eval` | – | – |

The critical path was 0 → 1 → 2. Phases 3, 4 and 5 were independent. Found and fixed during 4–6: a timed-out
request reported as "Zotero isn't running"; exact titles ranking low; notes' tables broken by the translator;
excerpts running paragraphs together; Zotero rich-text markup in titles; the note conversion never answering on
a brand-new profile.

---

## 8. Development workflow
- **Shell plugin**:
  - Edit in this repo. `make plugin-sync` copies only what the shell loads (`manifest.json`, `*.qml`, `lib/`,
    README) to `~/.config/omarchy/plugins/<id>/` and runs `omarchy plugin validate`. `make dev` re-syncs on save.
  - **QML/JS edits need `make plugin-reload`** (sync + `omarchy restart shell`, ~2 s). The shell does re-create a
    changed plugin, but this Quickshell has no `Qt.clearComponentCache`, so it rebuilds from the *cached* compiled
    component and the old code keeps running (verified: a single IPC target, still answering with old code).
    `scripts/shell-restart.sh` checks that the shell answers IPC afterwards and restarts it once more if not: once,
    `omarchy restart shell` stopped it without relaunching it.
  - Don't use a symlink instead: the shell's watcher may not follow it, and `omarchy plugin validate` refuses links.
  - Tail logs with `quickshell log -p /usr/share/omarchy/shell -f`.
  - Script or inspect the overlay: `omarchy-shell oma-zotero-launcher {toggle | search <q> | type <text> | key <name> | state}`.
    `state` reports rows, status, geometry and `keyboardFocus`.
  - Synthetic input:
    - `wtype` (a Wayland virtual keyboard) reaches the overlay, but Hyprland does not run compositor keybinds for
      it.
    - `scripts/uinput-keys.py super+shift+z` makes a kernel uinput keyboard, so the real binding fires. It needs
      the `input` group.
    - Only type once `state.keyboardFocus` is true. Keys sent before the compositor hands the new surface focus go
      to the previously focused window. Focus arrives ~40 ms after the bind.
- **Bridge**:
  - `make xpi`, then *Tools → Plugins → ⚙ → Install Plugin From File* (reinstalling replaces it). An XPI dropped
    into `extensions/` starts disabled.
  - The faster loop (verified) is `make bridge-link`, with Zotero closed, then start Zotero:
    - It writes a proxy file `~/.zotero/zotero/<profile>.default/extensions/<addon-id>` pointing at `zotero-bridge/`.
    - It drops `extensions.lastAppBuildId` / `lastAppVersion` from `prefs.js`, forcing the add-on rescan.
    - It sets `extensions.autoDisableScopes = 14` for one start, so the sideload isn't auto-disabled. The bridge
      restores Zotero's default on startup.
  - After that, `make bridge-reload` hot-reloads `lib/*.js` in ~200 ms through `AddonWrapper.reload()`, with no
    restart. `make bridge-unlink` (Zotero closed) removes it all.
  - Zotero caches `bootstrap.js` until it restarts, so keep it minimal. The module list lives in `lib/loader.js`,
    which *is* re-read on reload. After editing `bootstrap.js`, run `make bridge-restart`: a graceful restart,
    ~15 s, tabs restored, focus handed back.
  - Zotero's DB layer refuses `LIKE` with literal patterns ("Please enter a LIKE clause with bindings"). Bind
    them, or use `INSTR`.
  - Debug with `Zotero.debug("[oma-zotero] …")` and *Help → Debug Output Logging*.
- **Make targets** (`make help`):
  - `make test` → `node --test tests/`.
  - `make lint` → `node --check` on every JS file, `qmllint`'s `[syntax]` findings (its other warnings are mostly
    the shell's `qs.*` modules, which it can't resolve), `bash -n` on the scripts.
  - `make smoke` → live read-only checks; `smoke-ui` adds real open/reveal round-trips (restored); `smoke-write` a
    tag round trip (cleaned up).
  - `make e2e` → the five end-to-end scripts; `make e2e-write` → the tag edits for real.
  - `make fresh-install` → the README install from scratch (§9).
  - `make xpi` → the release `.xpi` and `updates.json`; `make install` → sync + enable this checkout's plugin.
  - `make bench` → in-bridge search timings.

## 9. Testing strategy
- **End-to-end (`make e2e`, live shell + Zotero)**:
  - `overlay-e2e.sh` (25 checks) covers the real keybinding and keystrokes, the result checked in Zotero's tab state
    and Hyprland's focused window, both status cards, and exact restoration.
  - `actions-e2e.sh` (44 checks) finds sample items through `/dev/attachment-samples`: 1 PDF, several PDFs, several
    with one on disk, URL only, a missing file, snapshot only, a standalone PDF. For each it checks the action rows
    and their disabled reasons, then runs the actions with real keys. It checks that the external viewer's
    `/proc/<pid>/cmdline` names the expected file, that a new Zotero reader window has focus, and that Show in library
    selected the item. It waits up to 20 s for a cold viewer start. It closes every viewer and reader window it opened
    (reader windows through `/dev/close-reader-windows`, i.e. `reader.close()`).
  - `notes-e2e.sh` (50), `tags-e2e.sh` (33, or 47 with `OMA_ZOTERO_WRITE_TESTS=1`) and `states-e2e.sh` (23): see
    §7. Fixtures come from `/dev/note-samples` and `/dev/tag-samples`. The note opened in Zotero is one already in the
    note editor's current format (the editor re-saves older notes when it opens them), checked unchanged afterwards
    (version, date, content hash). The clipboard, the settings file and the handshake are restored.
  - All of them abort rather than type when the overlay lacks keyboard focus. The overlay takes the keyboard while
    it's open, so **don't type during `make e2e`**: keys land in the overlay and fail the checks.
  - Keys sent by IPC (`key ctrl+enter`) go through the same `handleKey()` as real ones; every script also sends
    real keys (uinput for the binding, `wtype` for the rest).
  - Side effect: an external open counts as opening the file in Zotero (the `open` notifier fires, as it does for
    Zotero's own "Show File"/external opens), so the sample items show as recently opened.
- **Unit (node)**, 89 tests today:
  - `tests/plugin-lib.test.js`: handshake, response classification, search coalescing, highlight escaping, rows and
    sections, counts, selection.
  - `tests/plugin-actions.test.js`: the actions and picker rows for 0/1/several PDFs, one on disk, URL-only,
    missing, snapshot, a non-reader type, standalone files and still-loading details; the filter; the external
    command and viewer name.
  - `tests/tabs.test.js`: pruning dead reader windows; open items in MRU and tab-bar order.
  - `tests/plugin-notes-tags.test.js`: Notes/Tags action rows, notes list, tag editor order/create/read-only/cap,
    result rows' tags, settings validation. `tests/fuzzy.test.js`: matching, positions, ranking.
  - `tests/tags.test.js` (fake Zotero): order, name validation, list merge, item tags, undo labels, no-op adds,
    the read-only refusal (feeds included). `tests/noteFormat.test.js`: images, app links, HTML neutralizing
    (code untouched), link coloring, spacing, the size cap, excerpts, plain titles.
  - `search.js`: tokenizer, extended syntax, diacritics (`muller` → `Müller`), year and ranges, ranking fixtures, match
    offsets, first-author weighting, and narrowing equivalence while typing.
  - `actions.js`: every `plan()` branch, and the attachment order (existing, best, PDF, title).
  - `index.js`: build and Notifier maintenance against a fake Zotero (edits, child add/delete, trash, tags, position
    map consistency).
  - `bridge.js`: the auth wrapper in a VM (401/403/413/503/error mapping).
  - Pure files use the `if (typeof module !== "undefined") module.exports` guard, as Omarchy's `EmojiSearch.js` does.
- **Contract and security (`smoke.sh`, live Zotero)**:
  - Functional: ping; an empty query returns exactly the tabs open in Zotero; known queries; item, note and tag reads.
  - Open/reveal: dry-run plans for every item category (via `/dev/samples`) and all error codes.
  - `smoke-ui`: real switch-tab, reveal, and close-then-reopen, each verified through `/dev/ui-state`, then restored.
  - Latency: p50/p95 over 50 queries. The tail spikes while Zotero renders PDFs on its main thread, so the overlay
    must keep showing the previous results and coalesce requests (Phase 2).
  - Security:
    - `-A Mozilla/5.0` without the allowed header → dropped (curl exit 52).
    - With the header but no or a wrong token → 401.
    - With `Origin:` → 403.
    - Oversized body → 413.
  - Notes and tags: display/export formats on real notes, `/tags/list` order, validation errors, the read-only
    refusal, and "a whole title ranks its item first".
  - **Write tests run only with `OMA_ZOTERO_WRITE_TESTS=1`.** They add and then remove the tag `oma-zotero-test`
    on one item and verify cleanup (Zotero's undo history restored, the unused tag purged).
- **Fresh install (`make fresh-install`)**: see §7, phase 6. The throwaway profile sets
  `extensions.zoteroOpenOfficeIntegration.skipInstallation`: a new profile otherwise runs Zotero's LibreOffice
  plugin installer (`unopkg`) against your LibreOffice on its first start.
- **Manual QA**: Zotero closed; bridge missing; 0, 1 and many open tabs; unloaded tabs; a note tab; a separate
  reader window; items with 0, 1 and several PDFs; a standalone PDF; Unicode and very long titles; colored and
  automatic tags; multi-monitor; a theme switch; Zotero on another workspace.

## 10. Decisions taken (defaults; override any)
1. **Keybinding** `SUPER+SHIFT+Z`, following Omarchy's "SUPER+SHIFT = app" convention. `SUPER+Z` is also free.
2. **Enter on an item that isn't open** always opens Zotero's reader. `enterAction: "select"` only selects it in the library.
3. **"Open PDF in external windows"** is offered both ways: the system viewer (Evince) and a separate Zotero reader
   window, which tiles nicely in Hyprland.
4. **Open items** are shown most recently used first, with the current tab marked, and include note tabs and reader windows.
5. **Notes** are read as Markdown in the overlay. Enter jumps to the note in Zotero for editing.
6. **Empty query** shows open items plus 15 recently added. It can be set to open items only.
7. **IDs** use the `io.github.mbradaschia` namespace. Change it if your GitHub handle differs, before the first release.
8. **Handshake** lives in `$XDG_RUNTIME_DIR` (tmpfs, per session) rather than `~/.local/state`.
9. **Ctrl+C in a note** copies Zotero's own *Export Note → Markdown* (whole note, `zotero://` links kept), not the
   cleaned display text.
10. **Release builds** leave out `lib/dev.js`; the loader treats it as optional.
11. **License**: MIT (as the manifest declared).

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `Zotero_Tabs` / `Zotero.Reader` are private and may change in Zotero 11+ | Isolated in `tabs.js` with feature detection. Degraded `session.json` + window-title fallback. `strict_max_version` and a smoke run on every Zotero update. |
| Zotero's server hardening evolves (9/10 added User-Agent/Origin filtering) | The client sends `Zotero-Allowed-Request: 1`, and `smoke.sh` catches regressions immediately |
| Local processes calling the routes | Bearer token from a 0600 handshake file, `Origin` rejection, POST+JSON, strict validation, no eval routes |
| Wayland focus: Zotero can only request attention | The shell focuses by Hyprland address, using `Hyprland.toplevels` |
| Omarchy 4 plugin API churn (young platform) | Documented patterns only (overlay `open`/`close`, `service`, `OverlayWindow`, `Color`/`Style`). `schemaVersion: 1`. `omarchy plugin validate` in CI. |
| Hyprland Lua dispatch syntax churn | The same two-step dispatch as `omarchy-launch-or-focus` |
| Search slower than expected in SpiderMonkey | Measured in Phase 0. Prefilter and narrowing already prototyped, then the `fzf --filter` fallback. |
| Stale `ReaderWindow` entries (a reader window closed by script stays in `Zotero.Reader._readers`, so "new window" reopens nothing) | The window target prunes tab-less readers with a dead or closed window before `Reader.open`, which is unit-tested and was verified live over repeated open/close cycles. Our tooling closes reader windows with `reader.close()`. |
| Zotero's best attachment is a missing file while another copy exists | Enter and the actions use the first *existing* readable file. Missing files are listed as disabled with a reason. |
| Accidental writes to the real library during development | Opt-in, self-cleaning write tests. Writes go only through validated routes. |
| Opening a note in Zotero re-saves notes in an older editor format | The feature does what Zotero does. Tests only open notes already in the current format and check them unchanged. |
| Raw HTML in a note's Markdown (Qt renders it, remote images included) | Neutralized outside code (only a few attribute-free inline tags kept); images stripped before and after conversion. |
| The note translator never answering (e.g. translators not installed yet on a new profile) | Error/promise listeners plus a 15 s cap; the overlay shows plain text. |
| A new Zotero profile installs Zotero's LibreOffice plugin into the user's LibreOffice | The fresh-install test's profile sets `skipInstallation`. (Observed once during development; the half-installed extension and temp files were removed with `unopkg remove`.) |
| Tag edits sync to zotero.org | Only the opt-in write tests edit, on one item, net unchanged (its date modified does change). |
