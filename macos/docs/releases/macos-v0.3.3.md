Fixes and requests from using 0.3.2: catching up that respects what's already in Zotero, a launcher you can move and
pin, and a hotkey you can actually change.

**Install or update** (macOS 14 or newer; Zotero 10 with the bridge plugin). From 0.3.1 on, the menu bar offers it
(*Update to 0.3.3…*); otherwise:

```bash
curl -fsSL https://github.com/mbradaschia/zotero-companion-launcher/releases/download/macos-v0.3.3/install.sh | bash
```

Updates keep your configuration: they replace the app and the runner's own folder, never your settings, prompts,
taxonomies, saved searches, API keys or hotkey. After updating, *Settings › Setup › Install the AI features* brings the
runner's fixes too.

**Catching up:**
- It now asks Zotero what's already there. A paper given a prompt's note, or tagged, on another computer is left
  alone.
- *Only where missing* or *Replace them*, for prompts and taxonomies apart (Settings › Defaults).
- It runs up to *Processes at once*, never two jobs on one paper.

**Processes:** *Stop all* (it asks first), and pills that show one state at a time.

**The launcher:**
- It moves by dragging its background.
- The pin keeps it open over other apps (then esc doesn't close it).
- The highlighted row stays in sight through sections.

**Chats:** the window fits the screen, and esc goes back to the paper's menu.

**The hotkey:** *Hotkey and Login…* now opens its window in front. ⌃⌥Z, the default, is also the Claude app's voice
shortcut: if you use both, pick another there.
