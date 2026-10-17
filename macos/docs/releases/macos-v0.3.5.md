Fixes from a check of what reaches Zotero: tasks you can search for, status and tag changes that survive Zotero being
closed, and taxonomy records that merge between computers. Plus copying citations from notes and a solid window.

**Install or update** (macOS 14 or newer; Zotero 10 with the bridge plugin). From 0.3.1 on, the menu bar offers it
(*Update to 0.3.5…*); otherwise:

```bash
curl -fsSL https://github.com/mbradaschia/zotero-companion-launcher/releases/download/macos-v0.3.5/install.sh | bash
```

Updates keep your configuration: they replace the app and the runner's own folder, never your settings, prompts,
taxonomies, saved searches, API keys or hotkey. After updating, *Settings › Setup › Install the AI features* brings the
runner's change (taxonomy records say when they last changed).

**Zotero and your tasks, statuses and tags:**
- `task:` and `has:task` find your papers' tasks (the Mac sent the search none).
- A task status removed or renamed takes its `t/` tag off papers, or renames it, instead of leaving it to come back.
- Renames and deletes made while Zotero was closed are kept and sent when it's back, after a restart too; so are the
  tasks' tag changes.
- A paper with two status tags keeps one when you change it.
- After a status change, or a tag renamed or deleted everywhere, the paper's tags are Zotero's, not the old ones.

**Two computers:** a sync conflict on `taxonomy.json` merges paper by paper, keeping each computer's tagging and the
labels you confirmed or dismissed.

**The launcher:**
- *i* and *r* copy the citation and the bibliography entry in a paper's Notes and the note reader too.
- *P* leaves the highlight where you were.
- The window is solid, no longer see-through.
