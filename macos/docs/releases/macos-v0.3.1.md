The Mac app's first update: fixes found by driving it on screen and on the real AI runner, the requests made while
testing it, and updates from the menu bar from now on.

**Install or update** (macOS 14 or newer, Apple silicon or Intel; Zotero 10 with the bridge plugin from the latest `v` release):

```bash
curl -fsSL https://github.com/mbradaschia/zotero-companion-launcher/releases/download/macos-v0.3.1/install.sh | bash
```

From this version on, the app checks GitHub's releases once a day and offers the next one in the menu bar
(*Check for Updates…*, *Update to …*). It is signed ad hoc, not notarized: the installer clears the quarantine.

**Fixed:**
- Menus that kept showing the results' rows, back to the row you left, Home and End, the back arrow by the box.
- PDFs on an external drive: macOS now asks once instead of refusing their text extraction silently.
- A setting found from the search does what its row does (a switch flips), and never starts a job by itself.

**New:**
- Saved searches found from the search.
- *Processes at once* (1 to 4) for extraction, tagging and prompts on new papers.
- The sort named, ascending or descending, at the badges' right.
- The processes counted in the bottom bar, and the library's size at the top level.
- Settings reorganized (the classifier with the models, what runs on a paper you open in Defaults), on/off
  switches.
- The submenu arrow, a breadcrumb, smooth moves between lists, compact rankings, symbols on empty states.
- ⌘⌫ deletes in lists.

The search by author and two-digit year (`holling 73`) ships with the next release of the Zotero plugin. See
`CHANGELOG.md` for everything.
