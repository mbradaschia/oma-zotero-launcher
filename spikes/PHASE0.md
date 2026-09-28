# Phase 0: spike results

Run on 2026-09-28 against Zotero 10.0.3 (Gecko 140), Quickshell 0.3.1 / Qt 6.11.2, and Hyprland 0.56.2 on this
machine. The data was this library: 2,816 top-level items and 127 tags. Every spike in `PLAN.md` §7 is decided.

**Reproduce**
- `make test`: 18 offline unit tests.
- `make smoke`: live read-only contract, security and latency checks.
- `make bench`: the in-bridge search benchmark.
- `quickshell -p spikes/qs-bridge-test`: the client-side spike.

## Summary

| Spike | Result | Decision |
|---|---|---|
| (a) endpoint contract, auth, QML client | Works end-to-end from Quickshell. All refusal paths verified. | The auth wrapper in `zotero-bridge/lib/bridge.js` is the Phase 1 base. The client must send `Zotero-Allowed-Request: 1`. |
| (b) index + search speed | Index: 2,795 entries in 290–490 ms. Search: p95 < 10 ms for most queries. Worst case is 11–18 ms (short prefixes), doubling under heavy system load. | Keep search in the bridge; every alternative measured slower. Mitigations: narrowing (done) and client coalescing (Phase 2). |
| (c) window discriminators + focus | Main window: `initialTitle == "Zotero"`. Reader window: `initialTitle == ""`. Lua focus dispatch from Quickshell works. | The bridge returns the exact window title and the shell matches `Hyprland.toplevels` on class + title. |
| (d) notes as Markdown | The Note Markdown translator takes 30 ms for a 58 KB note, and `Text.MarkdownText` renders it legibly. | Use it. Flatten `zotero:` citation links to text (contrast). |
| (e) unpacked dev loading | The proxy-file recipe works. Hot reload takes ~200 ms with no Zotero restart. | `make bridge-link` / `bridge-reload` / `bridge-unlink` |
| (f) tag counts + undo | One SQL query, 13 ms. Colors come as a Map with emoji names. Zotero's own undo IDs are reusable. | `tags/update` saves with `undoAction: 'undo-action-{add,remove,change}-tag'` |

## (a) Endpoint contract and client

- **Route shape.**
  - Instance fields `supportedMethods`, `supportedDataTypes`, and an arrow `init = (req) => …`, which keeps arity 1.
  - Zotero passes `{ method, pathname, pathParams, searchParams, headers, data }`. `headers` is case-insensitive and
    enumerable. JSON bodies arrive parsed.
- **Responses.** Return `[status, { "Content-Type": … }, body]` or a Promise of that.
- **Verified live** (`scripts/smoke.sh`):

  | Request | Result |
  |---|---|
  | browser User-Agent without `Zotero-Allowed-Request` | dropped by Zotero (curl exit 52) |
  | missing or wrong token | 401 |
  | any `Origin` | 403 |
  | body > 64 KiB | 413 |
  | unknown route | 404 |
  | wrong method | 400 |

  503 while stopped is covered by `tests/bridge-auth.test.js`.
- **What Quickshell's XHR sends:** `User-Agent: Mozilla/5.0`, `connection: Keep-Alive`, and **no `Origin`**.
  - Without `Zotero-Allowed-Request: 1` the request is dropped (status 0).
  - With it (plus the bearer token), it works.
  - `FileView` reads the 0600 handshake file fine.
- **Round-trip from Quickshell,** including `JSON.parse` (≤ 2 ms):

  | Conditions | p50 | p95 |
  |---|---|---|
  | quiet system | 7 ms | 11 ms |
  | load average 17 on 8 cores (a parallel `next build`) | 15 ms | 23 ms |

- **Gotchas found:**
  - `ChromeUtils.now()` does not exist in the Gecko 140 plugin sandbox; `performance` is not a global either. Use
    `Components.utils.now()` (`omaNow()` in `bridge.js`).
  - `Zotero.Reader._readers` can keep a closed `ReaderWindow` whose `_window` is a dead wrapper. Touching it throws
    "can't access dead object". `tabs.js` guards with `Components.utils.isDeadWrapper`.

## (b) Index and search

- **Index.** Regular top-level items plus standalone file attachments: 2,795 entries.
  - Built in **290–490 ms** (data load 50 ms), asynchronously after startup, so it never blocks Zotero.
  - Kept current by a `Zotero.Notifier` observer (`item`, `item-tag`, `trash`), with a child→parent map for attachment
    and note counts.
- **Optimisations**, all covered by tests:
  - per-field character masks
  - cheapest-first evaluation of AND-groups
  - bounded top-K instead of a full sort
  - no `localeCompare`; ISO dates compare as strings
  - native `indexOf`/`lastIndexOf` subsequence scans
  - **fzf-style incremental narrowing.** `OmaSearch.canNarrow` decides when the previous matches are a safe candidate
    set. A test types seven queries character by character and asserts identical results to full scans.

In-bridge search on the real library, in ms (`make bench`). The quiet run was taken before the parallel build started:

| Query | Hits | Cold avg | Cold p95 | Typing avg/keystroke | Typing p95 |
|---|---|---|---|---|---|
| `s` | 2,713 | 7.2 | 11.1 | 8.5 | 9.6 |
| `su` | 2,241 | 5.1 | 5.6 | 7.8 | 11.9 |
| `supply chain` | 408 | 5.9 | 6.5 | 5.5 | 9.7 |
| `stev resil` | 1,102 | 9.8 | 11.2 | 7.6–9.2 | 10.7–17.6 |
| `pimm 1984` | 1 | 0.6 | 0.8 | 3.5 | 5.5 |
| `complexity ecosys` | 23 | 1.4 | 1.6 | 2.7 | 7.6 |
| `a:ivanov` | 144 | 1.8 | 1.9 | 3.1 | 9.2 |
| `#resilience` | 2 | 0.6 | 0.9 | 0.2 | 1.1 |
| `zzqx` | 7 | 0.5 | 0.6 | 1.4 | 3.2 |

- **Engine comparison.** On the same data, V8 (node) runs the worst query (`stev resil`) in 6.4 ms, so SpiderMonkey
  here is ~1.5–2× slower. Under the load spike every number roughly doubled.
- **Alternatives** (planning benchmark): 8–87 ms per keystroke in Qt V4, and 21–27 ms per `fzf --filter` spawn.
  **Decision:** search stays in the bridge.
- **Remaining levers:**
  - The Phase 2 client sends at most one search at a time and always the latest text.
  - If short queries ever feel slow: word-prefix semantics for 1–2-character queries (Phase 6, optional).

## (c) Windows and focus

| Window | Hyprland class | `initialTitle` | Title | Zotero `windowtype` |
|---|---|---|---|---|
| Main | `Zotero` | `Zotero` | `<selected tab title> - Zotero` | `navigator:browser` |
| Reader window | `Zotero` | *(empty)* | `<title> - <creator> - <year>` (same as the tab title) | `zotero:reader` |
| Note window (source) | `Zotero` | – | note title; `window.name = zotero-note-<id>` | `zotero:note` |

- **Focus.** `Hyprland.dispatch('hl.dsp.focus({ window = "address:0x<addr>" })')` from Quickshell focused the
  Zotero window. `HyprlandToplevel.address` is hex without `0x`.
- **Toplevel model.** A *fresh* Quickshell instance fills `Hyprland.toplevels` asynchronously
  (`refreshToplevels()`). The long-running omarchy-shell always has it populated.
- **Restored tabs** are `reader-unloaded` with `timeSelected = 0` until you select them. Until then, "most recently
  used" falls back to tab-bar order.
- **Decision.** Every open or focus action returns `{ windowKind, windowTitle }` read from the real window. The shell
  focuses the toplevel whose class is `Zotero` and whose title matches, falling back to `initialTitle == "Zotero"` for
  the main window.

## (d) Notes

- **Call form** (`zotero-bridge/lib/notes.js`): `new Zotero.Translate.Export()`, `setItems([note])`,
  `setTranslator(Zotero.Translators.TRANSLATOR_ID_NOTE_MARKDOWN)`, `setHandler("done", (obj, ok) => obj.string)`,
  `translate()`.
- **Test note.** A 58.7 KB HTML note (Beaver summary) became 3.9 KB of Markdown in **30 ms**. Headings, bold and links
  survived; inline math stays as `$…$`. Better Notes' `html2md` also works, but takes 290 ms.
- **Rendering** with `Text.MarkdownText`, offscreen at 720 px:
  - Headings, bold lead-ins and wrapped paragraphs all render correctly.
  - Links use Qt's default dark blue. `Text.linkColor` is ignored for Markdown, which hurts contrast on dark themes.
    All 21 links in the note were `zotero:` citation links. **Decision:** `noteFormat.js` flattens `zotero:` links to
    plain text and keeps http(s) links.
- **Gotcha.** The `itemNotes` table also stores attachments' note field, so filter by the note `itemTypeID` when
  querying notes.
- Note windows are **not** opened in tests, because the note editor can re-save older notes when it opens them.

## (e) Dev loading (`scripts/bridge-dev-link.sh`)

Verified against Gecko's `XPIProvider` / `XPIDatabase` source, then live.

1. **Proxy file.** A file named after the add-on id, whose first line is the source directory.
2. **Rescan trigger.** Remove `extensions.lastAppBuildId` and `lastAppVersion`. With `startupScanScopes = 0`, Zotero
   only rescans when it thinks the app changed.
3. **Auto-disable.** A newly detected profile-scope add-on is a *foreign install*. Zotero's default
   `autoDisableScopes = 15` would start it disabled, so the script sets 14 for one start. On startup the bridge clears
   it again (verified: back to 15, no user value).
4. **Hot reload.** `POST /oma-zotero/dev/reload` calls `AddonWrapper.reload()` from the AddonManager, outside the
   plugin sandbox. The code is live again in ~200 ms, the token persists, and there is no Zotero restart.
   `make bridge-reload` wraps this.

## (f) Tags

- **Counts.** One query: `itemTags ⋈ tags ⋈ items`, excluding `deletedItems`, grouped by name and type. It takes
  **13 ms** (`Zotero.Tags.getAll` also takes 14 ms). 126 tags are in use, 127 exist.
- **Colors.** `Zotero.Tags.getColors(libraryID)` returns `Map<name, { color, position }>`.
  - This library has 11 colored tags with emoji names (`⚡ Scan`, `📖 Full Read`, `★ Best`, …).
  - Automatic tags (type 1) exist, so the editor must mark them.
- **Undo.** Zotero's own tag box saves with `saveTx({ undoAction: 'undo-action-add-tag' | 'undo-action-remove-tag' |
  'undo-action-change-tag' })`. The Fluent messages take `{ count }`. Reusing them makes launcher edits undoable from
  Zotero's Edit menu, with no plugin FTL needed.

## State left on this machine

- **Zotero profile** `~/.zotero/zotero/<profile>.default/`:
  - the proxy file `extensions/oma-zotero-bridge@mbradaschia.github.io`
  - the prefs `extensions.oma-zotero-bridge.dev = true` and `…token`
  - a backup `prefs.js.oma-zotero.bak.<timestamp>`
  - `extensions.autoDisableScopes` is back to Zotero's default
- **Handshake file** `$XDG_RUNTIME_DIR/oma-zotero/bridge.json` (0600). It is rewritten on each Zotero start.
- **To remove everything:** quit Zotero, then run `make bridge-unlink`.
