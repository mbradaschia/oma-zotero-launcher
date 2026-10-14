# Phase 6a: the runner, setup, models and providers, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Each task is test first.

**Goal:** 6a's 13 ids and the runner client they stand on. **Spec:**
`macos/docs/superpowers/specs/2026-10-13-phase-6a-runner-setup-providers-design.md`.

Global constraints as before (macos/ only; `js/lib` vendored, Mac logic in Glue; files under 400
lines; the QML open; no em dashes; Co-Authored-By). Never a real key in a test, a fixture or an
argv: the fake runner records stdin to check that.

## Tasks

1. **`RunnerClient.swift`:** `Runner`, `RunnerResult`, `ProcessRunner` (environment, PATH, Node,
   run with stdin and timeout, launch). Tests against `/bin/sh` scripts in a temp HOME.
2. **`GlueSettings.js`:** a real `settingsState` from what Swift passes (info, models, defaults,
   tests, runner, reqs, setup, bridge); the Mac setup rows; pages providers, provider, models,
   defaults; `settingsSaveAll`, `withValue`, `addEndpoint`, `removeEndpoint`, `parseValue` for
   urls, `settingsIndex`, `settingRows`/`settingMenuRows`; `promptArgv`. Goldens.
3. **`LauncherModel+Runner.swift`:** runner state; `refreshProviders`, `refreshModels`,
   `testProvider`, `setKey`, `removeKey`, `autoTestKeys`, `afterEnable`/`afterTest`; Settings opened
   asks for them.
4. **`LauncherModel+Providers.swift`:** the ids on the provider pages, the models picker, endpoints
   (the two-step edit), `chooseDefaultModel`; `settingsAction` routing.
5. **Setup:** `SetupProbe` on `Desktop` (Zotero installed, running), requirements from the runner;
   `runSetupAction`; `BridgeDownloader` (fetcher protocol, SHA-256); `set-install` with the
   bundled `RunnerKit` (a build phase rsyncs it), installing, the reinstall offer.
6. **Settings from the search:** the index, Go to's `setting` rows, `setting-go` below a menu,
   `openSettingAt`.
7. **Chrome** for the new pages.
8. **Verify and review:** every suite, goldens, parity, a snapshot of Models & providers, a fresh
   reviewer and a security review of the key path, one fix pass, push, PR stacked on phase 5.
