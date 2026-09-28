# oma-zotero

Search your Zotero library from anywhere in Omarchy. Press **SUPER + SHIFT + Z**, type a few letters
of a title, author or year, and press **Enter**. Zotero jumps to the item: its open tab, or its PDF
opened in Zotero's reader, or the item selected in your library. Items you already have open in
Zotero are listed first.

Press **Tab** on a result for more: open the PDF in your PDF app or in its own Zotero window, read
the item's notes right in the overlay, add or remove tags, or show the item in your library.

![Search results, and the actions for one of them](preview.png)

It has two parts:

| Part | What it is |
|---|---|
| `zotero-bridge/` | A small Zotero 10 plugin. It lets the launcher search your library and control Zotero, locally and protected by a token. |
| the repo root | An Omarchy shell plugin (`io.github.mbradaschia.oma-zotero`): the search overlay and a background service. |

## Install

1. **The Zotero bridge.** Download `oma-zotero-bridge-<version>.xpi` from the releases (or build it with
   `make xpi`), then in Zotero: *Tools → Plugins → ⚙ → Install Plugin From File…*. Zotero keeps it updated.
2. **The Omarchy plugin.**
   ```bash
   omarchy plugin add https://github.com/mbradaschia/oma-zotero-plugin --enable
   ```
   From a checkout instead: `make install`.
3. **The keybinding.** Add this to `~/.config/hypr/bindings.lua`:
   ```lua
   o.bind("SUPER + SHIFT + Z", "Zotero search", { panel = "io.github.mbradaschia.oma-zotero" })
   ```
   Then run `hyprctl reload`.

If the overlay says *"The Zotero bridge isn't installed"*, step 1 is missing or Zotero hasn't restarted
since. *"Zotero isn't running"* means press Enter to start it. *"Zotero rejected the bridge token"*:
restart Zotero.

## Use

| Key | |
|---|---|
| type | fuzzy search (title, authors, year) |
| `↑` `↓`, `Ctrl+K` `Ctrl+J`, `PgUp` `PgDn` | move |
| `Enter` | open in Zotero |
| `Tab` (or `→`) | actions for the highlighted item (below) |
| `Alt+O` / `Alt+W` | open the PDF externally / in a new Zotero window (a picker if there are several files) |
| `Alt+N` / `Alt+T` / `Alt+L` | the item's notes / its tags / show it in your library |
| `Backspace`, `Ctrl+Backspace`, `Ctrl+U` | edit the query |
| `Esc` | clear the query, then close |

**Actions** (`Tab`):
- *Open in Zotero*: its detail says what Enter does, such as "Switch to its open tab" or "Open it in Zotero's reader".
- *Open PDF externally*: in your default PDF app (Evince), or `externalPdfCommand`.
- *Open PDF in a new Zotero window*: a separate reader window that you can tile.
- *Notes*: see below.
- *Tags*: see below.
- *Show in library*

When an item has several files, the file actions open a picker. Missing files, URL-only attachments and types
Zotero's reader can't show are listed but disabled, with the reason. Type to filter the actions.
`Backspace`, `←` or `Shift+Tab` goes back.

**Notes.** The item's notes, newest edit first; type to filter. `Enter` reads one in the overlay, as formatted
Markdown: headings, lists, tables, citations as text, web links you can click. Images show as `[image]`. Very
long notes show their first part.
- In a note: `↑` `↓` `PgUp` `PgDn` `Space` `Home` `End` scroll, `Enter` opens it in Zotero's note editor,
  `Ctrl+C` copies it as Markdown (the same text Zotero's *Export Note → Markdown* gives).
- In the list, `Alt+Enter` opens the highlighted note in Zotero right away.

**Tags.** Every tag in the item's library, with the item's own tags first and checked, colored tags with their
color, how many items use each, and `auto` on automatic tags (added by Zotero or an import, not by hand).
- Type to find a tag (fuzzy), `Enter` adds or removes it. The list shows the change at once and puts it back
  if Zotero refuses (say, a read-only group library).
- A name no tag has yet gets a *Create tag "…"* row; `Ctrl+Enter` adds exactly what you typed.
- Edits land in Zotero's own undo history: *Edit → Undo* in Zotero reverts them.

Query syntax (fzf-style; terms are ANDed):

| Term | Meaning |
|---|---|
| `resil`, `stev resil` | fuzzy match on title and authors; first authors rank higher, whole title phrases highest |
| `a:smith`, `t:resilience` | authors only, title only |
| `2020`, `y:2019..2021` | year (a bare 4-digit term is a year) |
| `#tag` | tag |
| `'exact`, `^prefix`, `suffix$` | exact, prefix and suffix matches |
| `!term` | exclude |
| `a \| b` | either term |

## Settings

`~/.config/omarchy/oma-zotero.json`; every setting is optional. A setting that isn't valid falls back to its
default, and the overlay's footer names it.

```json
{
  "enterAction": "reader",
  "externalPdfCommand": ["zathura"],
  "maxResults": 60,
  "accelerators": true,
  "emptyQuery": { "showOpen": true, "tabOrder": "mru", "recent": "added", "recentLimit": 15 },
  "port": 23119
}
```

| Setting | |
|---|---|
| `enterAction` | `"reader"` (default): Enter opens the item's PDF in Zotero's reader when it isn't open yet. `"select"`: Enter only selects it in your library. |
| `externalPdfCommand` | Opens PDFs in this app instead of your default one. Other files always use `xdg-open`. |
| `maxResults` | How many results a search lists, 10–200 (default 60). |
| `accelerators` | `false` turns off `Alt+O/W/N/T/L` in the results. |
| `emptyQuery.showOpen` | List the items open in Zotero before you type (default `true`). |
| `emptyQuery.tabOrder` | `"mru"`: most recently used first (default). `"tabbar"`: Zotero's tab order. |
| `emptyQuery.recent` | Below them: `"added"` (default) or `"modified"` recently, or `"none"`. |
| `emptyQuery.recentLimit` | How many of those, 0–50 (default 15). |
| `port` | Zotero's HTTP port, if you changed it in Zotero (default 23119). |

## Scripting

`omarchy-shell oma-zotero search "pimm 1984"` opens the overlay with a query, `… key tab` / `… key alt+n` /
`… type text` drive it, and `omarchy-shell oma-zotero state` prints what it shows, as JSON.

## How it talks to Zotero

The bridge adds routes under `/oma-zotero/` to Zotero's own local HTTP server (127.0.0.1 only). Every request
needs a token that only your user can read (`$XDG_RUNTIME_DIR/oma-zotero/bridge.json`, mode 0600); requests
from web pages are refused. Nothing leaves your machine. Only the tag editor changes your library, and only
through Zotero's own item API.

## Develop

| Command | |
|---|---|
| `make test` | unit tests (node) |
| `make lint` | syntax checks: JavaScript, QML, scripts |
| `make smoke` / `make smoke-ui` | live bridge checks; `-ui` also switches Zotero tabs and restores them |
| `make e2e` | end-to-end: real keybinding and keystrokes, through to Zotero or the viewer |
| `make e2e-write` / `make smoke-write` | the tag edits for real, on one item (see below) |
| `make fresh-install` | the install above, from scratch: the release `.xpi` in a throwaway Zotero, then `omarchy plugin add` |
| `make bench` | search timings inside Zotero |
| `make bridge-link` | load `zotero-bridge/` unpacked into Zotero (quit Zotero first), with the dev routes the tests use |
| `make bridge-reload` | reload the bridge's `lib/*.js` without restarting Zotero |
| `make plugin-reload` | sync the Omarchy plugin and restart the shell (needed for QML changes) |
| `make xpi` | build the release `.xpi` (no dev routes) and `zotero-bridge/updates.json` |

What the live tests touch:
- **Everything is put back:** Zotero's tabs and selection, your focused window, the clipboard (`Ctrl+C` test),
  the settings file and the bridge handshake (state tests), your installed plugin and `shell.json`
  (`make fresh-install`).
- **The overlay takes the keyboard while it's open.** Don't type during `make e2e`: your keys would land in
  the overlay and fail the checks.
- They open and close Evince and Zotero reader windows, and one note in Zotero's note editor (a note already in
  the editor's current format; the test checks it wasn't changed). Opening files externally counts as opening
  them in Zotero, as it does in Zotero itself.
- **Only `make e2e-write` and `make smoke-write` edit your library.** They add the tag `oma-zotero-test` to one
  item and remove it again, then clean up Zotero's undo history and the unused tag. The item's "date modified"
  changes, and the edits sync if you use Zotero sync.

`PLAN.md` has the design, and `spikes/PHASE0.md` the measurements behind it.

## License

MIT
