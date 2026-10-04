HANDSHAKE := $(XDG_RUNTIME_DIR)/oma-zotero/bridge.json
ID := $(shell jq -r .id manifest.json)

.PHONY: help test lint xpi version release install prompts-install plugin-sync dev plugin-reload e2e e2e-write fresh-install providers-smoke \
	smoke smoke-ui smoke-write bench bridge-link bridge-unlink bridge-reload bridge-restart

help:            ## list the targets
	@grep -E '^[a-z0-9-]+:.*## ' Makefile | sed 's/:.*## /\t/' | expand -t 18

test:            ## unit tests (bridge search/actions/index/notes/tags/auth, plugin lib)
	node --test tests/*.test.js

lint:            ## syntax checks: JavaScript, QML, shell scripts
	scripts/lint.sh

xpi:             ## build dist/oma-zotero-launcher-<version>.xpi (no dev routes) and zotero-bridge/updates.json
	scripts/build-xpi.sh

install:         ## install this checkout's shell plugin and enable it (then add the keybinding, see README)
	scripts/dev-sync.sh
	omarchy plugin enable $(ID)

version:         ## print the version (the plugin, the bridge and the runner share it)
	@scripts/check-versions.sh

release:         ## cut a release: make release VERSION=X.Y.Z (bump, CHANGELOG, build, commit, tag)
	@scripts/release.sh "$(VERSION)"

# The runner goes outside the plugin folder: omarchy plugin validate refuses the symlinks
# node_modules holds, and the shell reloads plugins on every change in their folder.
RUNNER_DIR := $(or $(XDG_DATA_HOME),$(HOME)/.local/share)/oma-zotero-launcher/runner

prompts-install: ## install the prompt runner (Node 22+): the AI features; links ~/.local/bin/oma-zotero-prompt
	RUNNER_DIR=$(RUNNER_DIR) scripts/install-runner.sh

plugin-sync:     ## copy the shell plugin into ~/.config/omarchy/plugins/<id>/ and validate it
	scripts/dev-sync.sh

dev:             ## plugin-sync, then re-sync on every change (the shell hot-reloads)
	scripts/dev-sync.sh --watch

plugin-reload:   ## stop the shell, plugin-sync, start it (QML edits need a restart; no hot reloads of a half-copied plugin)
	scripts/shell-restart.sh --sync

e2e:             ## end-to-end tests in the live shell + Zotero (real keys; your state and windows restored)
	scripts/overlay-e2e.sh
	scripts/actions-e2e.sh
	scripts/notes-e2e.sh
	scripts/tags-e2e.sh
	scripts/settings-e2e.sh
	scripts/states-e2e.sh

e2e-write:       ## tags end-to-end with real edits on one item (a test tag added, removed, undone; cleaned up)
	OMA_ZOTERO_WRITE_TESTS=1 scripts/tags-e2e.sh

fresh-install:   ## the README's install from scratch: release .xpi in a throwaway Zotero + `omarchy plugin add`
	scripts/fresh-install-test.sh

smoke:           ## live contract/security/latency checks (read-only)
	scripts/smoke.sh

smoke-ui:        ## smoke + real open/reveal round-trips in Zotero (state restored afterwards)
	OMA_ZOTERO_UI_TESTS=1 scripts/smoke.sh

smoke-write:     ## smoke + a tag added to and removed from one item (cleaned up)
	OMA_ZOTERO_WRITE_TESTS=1 scripts/smoke.sh

providers-smoke: ## live: one grounded answer per model in OMA_LIVE_PROVIDERS (opt-in; see the script)
	scripts/providers-smoke.sh

bench:           ## in-bridge search benchmark on the real library (dev bridge only)
	@T=$$(jq -r .token $(HANDSHAKE)); P=$$(jq -r .port $(HANDSHAKE)); \
	curl -s -H "Authorization: Bearer $$T" -H 'Content-Type: application/json' -d '{"reps":30}' \
	  "http://127.0.0.1:$$P/oma-zotero/dev/bench" | jq -r \
	  '"entries=\(.entries) rebuildMs=\(.rebuildMs)", "cold:", (.results[] | "  \(.query) total=\(.total) avg=\(.avgMs) p95=\(.p95Ms)"), "typing (per keystroke):", (.typing[] | "  \(.query) avg=\(.avgMs) p95=\(.p95Ms) max=\(.maxMs)")'

bridge-link:     ## load zotero-bridge/ unpacked into Zotero (quit Zotero first)
	scripts/bridge-dev-link.sh

bridge-unlink:   ## remove the dev link and dev prefs (quit Zotero first)
	scripts/bridge-dev-link.sh --unlink

bridge-reload:   ## hot-reload bridge code (lib/*.js) without restarting Zotero
	scripts/bridge-reload.sh

bridge-restart:  ## graceful Zotero restart; only needed after editing bootstrap.js
	scripts/bridge-restart.sh
