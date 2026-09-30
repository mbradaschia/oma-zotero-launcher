#!/bin/bash
# Add the launcher's keybinding (SUPER+SHIFT+Z) and, with it, the layer rule that lets it open
# growing from the middle, to your Hyprland bindings (~/.config/hypr/bindings.lua): backed up
# first, and put back if Hyprland reports an error. Only what's missing is added; a
# SUPER+SHIFT+Z that already does something else is left alone (the script says what it does).
#
#   scripts/add-keybinding.sh           the keybinding and the layer rule
#   scripts/add-keybinding.sh --rule    only the layer rule
set -euo pipefail
HYPR_DIR=${HYPR_DIR:-$HOME/.config/hypr}
F=${HYPR_BINDINGS:-$HYPR_DIR/bindings.lua}
ID=io.github.mbradaschia.oma-zotero
fail() { echo "add-keybinding: $*" >&2; exit 1; }
[[ -f $F ]] || fail "no $F: add the README's two lines to your Hyprland config yourself"
command -v hyprctl >/dev/null || fail "hyprctl isn't here (not in Hyprland?)"

conf=(); for c in "$HYPR_DIR"/*.lua; do [[ -f $c ]] && conf+=("$c"); done
live() { grep -hE "$1" "${conf[@]}" 2>/dev/null | grep -vE '^[[:space:]]*--' | grep -q .; }
add=""
if [[ ${1:-} != --rule ]] && ! live "panel *= *\"$ID\""; then
  taken=$(hyprctl binds -j | jq -r '.[] | select(.modmask == 65 and (.key | ascii_upcase) == "Z") | (.description // .dispatcher)' | head -1)
  [[ -n $taken ]] && fail "SUPER+SHIFT+Z already does “$taken”: pick another key and add o.bind(\"…\", \"Zotero launcher\", { panel = \"$ID\" }) yourself"
  add+=$'-- Zotero launcher (oma-zotero-launcher): SUPER+SHIFT+Z opens it\n'
  add+="o.bind(\"SUPER + SHIFT + Z\", \"Zotero launcher\", { panel = \"$ID\" })"$'\n'
fi
if ! live 'namespace *= *"oma-zotero"'; then
  add+=$'-- The launcher opens with its own animation (from the middle): no layer slide from the corner.\n'
  add+=$'hl.layer_rule({ match = { namespace = "oma-zotero" }, no_anim = true, animation = "none" })\n'
fi
[[ -n $add ]] || { echo "already set up"; exit 0; }

bak="$F.bak.oma-zotero.$(date +%s)"
cp -p "$F" "$bak"
printf '\n%s' "$add" >>"$F"
hyprctl reload >/dev/null
errs=$(hyprctl configerrors 2>/dev/null | grep -v '^\s*$' || true)
if [[ -n $errs ]]; then
  cp -p "$bak" "$F"
  hyprctl reload >/dev/null
  fail "Hyprland reported an error, so the change was undone: $(head -1 <<<"$errs")"
fi
echo "added to $F (backup: $bak)"
