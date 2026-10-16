A small follow-up to 0.3.1: safer updates, and the items its review left for later.

**Install or update** (macOS 14 or newer; Zotero 10 with the bridge plugin from the latest `v` release). With 0.3.1,
the menu bar offers it (*Update to 0.3.2…*); otherwise:

```bash
curl -fsSL https://github.com/mbradaschia/zotero-companion-launcher/releases/download/macos-v0.3.2/install.sh | bash
```

**What's new:**
- Updates are checked against the release's SHA-256s (GitHub's asset digests) before anything is replaced.
- *Processes at once* stays on each Mac when settings sync between machines.
- A Settings link lands on its row (the classifier link on the Jev key).

See `CHANGELOG.md` for everything.
