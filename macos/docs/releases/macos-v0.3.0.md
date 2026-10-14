The first release of the Mac app: everything the Omarchy launcher does, as a native menu-bar app (all 166 of the
plan's row ids, phases 1 to 10).

**Install** (macOS 14 or newer, Apple silicon or Intel; Zotero 10 with the bridge plugin from the latest `v` release):

```bash
curl -fsSL https://github.com/mbradaschia/zotero-companion-launcher/releases/download/macos-v0.3.0/install.sh | bash
```

It is signed ad hoc, not notarized: the installer clears the quarantine for you.

**What's in it:** search as you type, a paper's menu (open, select, notes, tags, files, cite), notes in a reader or a
window of their own, tasks, saved searches, Settings, prompts and Processes, the background automation, chat with a
paper (and its artifacts), taxonomies, sync between machines, the keys view (? or F1), Open at login, VoiceOver
labels and Reduce Motion.

**What differs from Omarchy:** the hotkey is ⌃⌥Z (change it in the menu bar icon › Hotkey and Login…), ⌘ does what Ctrl does there (⌘S, ⌘V,
⌘-/+/0) and ⌘W closes the launcher (Super+W there), API keys live in the Keychain, and commands are Homebrew's. See `macos/README.md`.
