#!/bin/bash
# Live smoke test of the model providers (PLAN-providers.md §8), opt-in: for each model in
# OMA_LIVE_PROVIDERS, one chat question on a paper, grounded in its text, and a check that the
# answer quotes it with a page number. For maintainers and contributors with the accounts or
# keys; never in CI. Your settings aren't touched: each run uses a throwaway settings file.
#
#   OMA_LIVE_PROVIDERS="claude:haiku,ollama:qwen3:8b,openai:gpt-5.5-mini" \
#     OMA_SMOKE_KEY=<an item key with an extracted-text note> scripts/providers-smoke.sh
#
# API keys come from the keyring or the environment, as in normal use. Needs Zotero with the
# bridge, and the runner's packages (npm ci --prefix daemon).
set -uo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
: "${OMA_LIVE_PROVIDERS:?set OMA_LIVE_PROVIDERS, e.g. claude:haiku,ollama:qwen3:8b}"
: "${OMA_SMOKE_KEY:?set OMA_SMOKE_KEY to a Zotero item key (a paper with its text extracted)}"
QUESTION="${OMA_SMOKE_QUESTION:-Quote one sentence from the paper that states its main contribution, verbatim, with an APA 7 citation and page number. One sentence of your own at most.}"
pass=0
fail=0
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

IFS=, read -ra MODELS <<<"$OMA_LIVE_PROVIDERS"
for spec in "${MODELS[@]}"; do
  provider=${spec%%:*}
  mkdir -p "$T/$provider/omarchy"
  if [[ $provider == claude || $provider == chatgpt || $provider == openai || $provider == anthropic || $provider == google || $provider == openrouter || $provider == ollama ]]; then
    providers="{\"$provider\": {\"enabled\": true}}"
  else
    echo "✖ $spec: only the built-in providers here (an endpoint needs its URL)"; ((fail++)); continue
  fi
  printf '{"providers": %s, "defaults": {"chat": {"model": "%s", "effort": ""}}}\n' "$providers" "$spec" >"$T/$provider/omarchy/oma-zotero-launcher.json"
  echo "== $spec"
  start=$SECONDS
  out=$(echo "$QUESTION" | XDG_CONFIG_HOME="$T/$provider" timeout "${OMA_SMOKE_TIMEOUT:-900}" node "$ROOT/daemon/bin/oma-zotero-prompt.mjs" chat --key "$OMA_SMOKE_KEY" 2>&1)
  done=$(jq -c 'select(.type == "done")' <<<"$out" 2>/dev/null | tail -1)
  err=$(jq -r 'select(.type == "error") | .message' <<<"$out" 2>/dev/null | tail -1)
  if [[ -z $done ]]; then echo "✖ no answer: ${err:-$(tail -1 <<<"$out")}"; ((fail++)); continue; fi
  text=$(jq -r .text <<<"$done")
  quotes=$(jq -c 'select(.type == "quotes")' <<<"$out" | tail -1)
  echo "   $(jq -r .model <<<"$done") · $((SECONDS - start)) s · ${quotes:-no quote check}"
  echo "   ${text:0:220}"
  if grep -Eq '[“"].{12,}[”"]' <<<"$text" && grep -Eq '\bpp?\. ?[0-9]+' <<<"$text"; then echo "✔ a quote and a page number"; ((pass++)); else echo "✖ no quote with a page number"; ((fail++)); fi
  if [[ -n $quotes && $(jq '.missing | length' <<<"$quotes") == 0 ]]; then echo "✔ the quote is in the paper"; ((pass++)); elif [[ -n $quotes ]]; then echo "✖ quote not found in the paper: $(jq -c .missing <<<"$quotes")"; ((fail++)); fi
done
echo "== $pass passed, $fail failed"
((fail == 0))
