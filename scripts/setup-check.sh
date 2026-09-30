#!/bin/bash
# What the launcher's Settings › Setup shows, as JSON: Zotero installed and running, the
# keybinding (ours, taken by something else, or none), the layer rule, Node.js, pdftotext.
ID=io.github.mbradaschia.oma-zotero
conf=(); for c in "$HOME"/.config/hypr/*.lua; do [[ -f $c ]] && conf+=("$c"); done
live() { grep -hE "$1" "${conf[@]}" 2>/dev/null | grep -vE '^[[:space:]]*--' | grep -q .; }
bind=none
if live "panel *= *\"$ID\""; then bind=ours
elif command -v hyprctl >/dev/null; then
  taken=$(hyprctl binds -j 2>/dev/null | jq -r '.[] | select(.modmask == 65 and (.key | ascii_upcase) == "Z") | (.description // .dispatcher)' | head -1)
  [[ -n $taken ]] && bind="taken:$taken"
fi
ZCMD=${ZOTERO_CMD:-zotero}
jq -nc --arg zotero "$(command -v "${ZCMD%% *}" || true)" --argjson running "$( (pgrep -x zotero-bin || pgrep -x zotero) >/dev/null && echo true || echo false)" \
  --arg bind "$bind" --argjson rule "$(live 'namespace *= *"oma-zotero"' && echo true || echo false)" \
  --arg node "$(node --version 2>/dev/null || true)" --argjson pdftotext "$(command -v pdftotext >/dev/null && echo true || echo false)" \
  '{zotero: $zotero, running: $running, bind: $bind, rule: $rule, node: $node, pdftotext: $pdftotext}'
