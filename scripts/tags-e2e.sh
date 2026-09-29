#!/bin/bash
# End-to-end test of the tag editor (PLAN.md phase 5) in the live shell + Zotero.
#
#   scripts/tags-e2e.sh                          read-only: the tag list and its order, request
#                                                validation, the read-only-library refusal, the editor
#                                                (checks, colors, auto badges, fuzzy filter, Create row),
#                                                and an edit Zotero refuses (shown, then undone)
#   OMA_ZOTERO_WRITE_TESTS=1 scripts/tags-e2e.sh  + real edits on one item: adds the tag
#                                                "oma-zotero-test", removes it, adds it again and reverts
#                                                that with Zotero's own Edit → Undo. Afterwards the item has
#                                                its original tags, the unused test tag is purged and
#                                                Zotero's undo history is as before. The item's "date
#                                                modified" does change, and the edits sync if you sync.
#
# Zotero's tabs/selection and your focused window are restored. Needs the dev bridge.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/e2e-lib.sh"

TEST_TAG="oma-zotero-test"
TS=$(post /dev/tag-samples "$(jq -nc --arg t "$TEST_TAG" '{testTag: $t}')")
t() { jq -r ".$1.key // empty" <<<"$TS"; }
item_tags() { post /item "$(key_json "$1")" | jq -c '[.tags[].tag] | sort'; }
row_tags() { jq -c '[.actionRows[] | select(.rowId == "tag") | .tag]'; }

echo "== the library's tags (bridge)"
L=$(post /tags/list '{}')
check "tag list loads, editable library" "true true" "$(jq -r '"\(.ok) \(.editable)"' <<<"$L")"
check "colored tags first, in their slot order" true \
  "$(jq '[.tags[] | .position] | (map(select(. != null)) | . == sort) and (index(null) as $i | $i == null or (.[$i:] | all(. == null)))' <<<"$L")"
check "then the most used" true "$(jq '[.tags[] | select(.position == null) | .count] | . == (sort | reverse)' <<<"$L")"
check "unused colored tags are listed too" "$(jq '.coloredTags | length' <<<"$TS")" "$(jq '[.tags[] | select(.color != null)] | length' <<<"$L")"
upd() { post /tags/update "$(jq -nc --arg k "$(t writable)" --argjson a "$1" --argjson r "$2" '{key: $k, add: $a, remove: $r}')" | jq -r '.error.code // "ok"'; }
check "an empty name → 400 bad-tags" bad-tags "$(upd '["  "]' '[]')"
check "a 256-character name → 400 bad-tags" bad-tags "$(upd "[\"$(printf 'x%.0s' {1..256})\"]" '[]')"
check "the same name added and removed → 400" bad-tags "$(upd '["a"]' '["a"]')"
check "nothing to do → 400" bad-tags "$(upd '[]' '[]')"
check "not a list → 400" bad-tags "$(upd '"x"' '[]')"
ro=$(jq -c '.readOnlyItem // empty' <<<"$TS")
if [[ -n $ro ]]; then
  r=$(post /tags/update "$(jq -nc --argjson r "$ro" --arg t "$TEST_TAG" '{key: $r.key, libraryID: $r.libraryID, add: [$t]}')")
  check "read-only library ($(jq -r .library <<<"$ro")) → 409 read-only, named" "read-only true" \
    "$(jq -r --arg l "$(jq -r .library <<<"$ro")" '"\(.error.code) \(.error.message | contains($l))"' <<<"$r")"
  check "…and its item says so" false "$(post /item "$(jq -c '{key, libraryID}' <<<"$ro")" | jq .library.editable)"
else
  echo "  (no read-only library with items here; covered by tests/tags.test.js)"
fi

echo "== the editor: an item with colored and automatic tags"
auto=$(t withAutoTag)
select_item "$auto"
ipc key alt+t >/dev/null
s=$(wait_for '.view == "tags" and (.tags.loading | not)' 5)
check "Alt+T opens the tag editor" tags "$(jq -r .view <<<"$s")"
mine=$(item_tags "$auto")
check "the item's tags come first, checked" "$mine" \
  "$(jq -c --argjson n "$(jq length <<<"$mine")" '[.actionRows[:$n][] | select(.checked) | .tag] | sort' <<<"$s")"
check "header counts tags and the item's" "$(jq -r '.tags | length' <<<"$L") tags · $(jq length <<<"$mine") on this item" "$(jq -r .countText <<<"$s")"
autoTag=$(jq -r '.withAutoTag.autoTags[0]' <<<"$TS")
check "an automatic tag is marked auto" auto "$(jq -r --arg t "$autoTag" '.actionRows[] | select(.tag == $t) | .badge' <<<"$s")"
check "colored tags show their color" true "$(jq '[.actionRows[] | select(.swatch != "")] | length > 0' <<<"$s")"
check "counts on the right" true "$(jq '[.actionRows[] | .trailing] | map(select(. != "")) | length > 0' <<<"$s")"
first=$(jq -r '[.actionRows[] | select(.checked | not)][0].tag' <<<"$s")
q=$(tr -d ' ' <<<"$first" | cut -c1-4 | tr '[:upper:]' '[:lower:]')
ipc type "$q" >/dev/null
s=$(wait_for ".filterText == \"$q\"" 3)
check "typing filters the tags (fuzzy), with highlights" "true true" \
  "$(jq -r --arg t "$first" '"\([.actionRows[].tag] | index($t) != null) \(.actionRows[0].highlighted)"' <<<"$s")"
check "no tag has that exact name → a Create row last" "create" "$(jq -r '.actionRows[-1].rowId' <<<"$s")"
ipc key ctrl+u >/dev/null
existing=$(jq -r '.withAutoTag.tags[0]' <<<"$TS" | tr '[:lower:]' '[:upper:]')
ipc type "$existing" >/dev/null
s=$(wait_for '.filterText != ""' 3)
check "an existing name in other case → no Create row" false "$(jq '[.actionRows[].rowId] | index("create") != null' <<<"$s")"
ipc key ctrl+u >/dev/null
check "Ctrl+U clears the filter" '""' "$(wait_for '.filterText == ""' 3 | jq .filterText)"
ipc key backspace >/dev/null
s=$(wait_for '.view == "actions"' 3)
check "Backspace → the actions, whose Tags row lists the tags" true \
  "$(jq --arg t "$(jq -r '.withAutoTag.tags[0]' <<<"$TS")" '.actionRows[] | select(.rowId == "tags") | .detail | length > 0' <<<"$s")"
idx=$(jq '[.actionRows[].rowId] | index("tags")' <<<"$s")
sel=$(jq .selectedIndex <<<"$s")
for ((i = sel; i < idx; i++)); do ipc key down >/dev/null; done
ipc key enter >/dev/null
check "Enter on the Tags row → the editor" tags "$(wait_for '.view == "tags"' 3 | jq -r .view)"

echo "== an edit Zotero refuses is shown, then undone"
long=$(printf 'y%.0s' {1..256})
before=$(item_tags "$auto")
ipc type "$long" >/dev/null
ipc key ctrl+enter >/dev/null
s=$(wait_for '(.tags.pending == 0) and (.lastError != "")' 6)
check "the error is shown" true "$(jq '.lastError | startswith("Couldn'"'"'t add")' <<<"$s")"
check "…and the tag is not on the item (reverted)" false "$(jq --arg t "$long" '.tags.onItem | index($t) != null' <<<"$s")"
check "…nor in Zotero" "$before" "$(item_tags "$auto")"
check "…the filter was cleared for the next tag" '""' "$(jq .filterText <<<"$s")"
tagOn=$(jq -r '.[0]' <<<"$before")
ipc type "$tagOn" >/dev/null
ipc key ctrl+enter >/dev/null
check "Ctrl+Enter on a tag the item has → says so" "“$tagOn” is already on this item" "$(wait_for '.flash != ""' 3 | jq -r .flash)"
ipc key escape >/dev/null

echo "== real keys: Alt+T, type, Esc"
if real_open; then
  q=$(query_for "$(post /item "$(key_json "$auto")" | jq -r .item.title)")
  wtype "$q"
  s=$(wait_for "(.shownQuery == $(jq -Rn --arg t "$q" '$t')) and (.loading | not)" 6)
  idx=$(jq --arg k "$auto" '[.rows[].key] | index($k)' <<<"$s")
  for ((i = 0; i < idx; i++)); do wtype -k Down; done
  wtype -M alt t -m alt
  check "real Alt+T opens the editor" tags "$(wait_for '.view == "tags" and (.tags.loading | not)' 5 | jq -r .view)"
  wtype "$q"
  check "real typing filters" true "$(wait_for '.filterText != ""' 3 | jq '.listCount > 0')"
  wtype -k Escape
  wtype -k Escape
  check "real Esc clears, then goes back to the results" "true search" "$(wait_for '.view == "search"' 3 | jq -r '"\(.opened) \(.view)"')"
  ipc close >/dev/null
fi

if [[ ${OMA_ZOTERO_WRITE_TESTS:-} == 1 ]]; then
  echo "== writes: add, remove, add again, Zotero's Edit → Undo (item $(t writable))"
  w=$(t writable)
  orig=$(item_tags "$w")
  snap=$(post /dev/undo-snapshot '{}')
  E2E_CLEANUPS+=("tags_cleanup")
  tags_cleanup() {
    [[ $(item_tags "$w" | jq --arg t "$TEST_TAG" 'index($t) != null') == true ]] &&
      post /tags/update "$(jq -nc --arg k "$w" --arg t "$TEST_TAG" '{key: $k, remove: [$t]}')" >/dev/null
    post /dev/undo-restore "$(jq -nc --arg k "$w" '{keys: [$k]}')" >/dev/null
    post /dev/tag-purge "$(jq -nc --arg t "$TEST_TAG" '{name: $t}')" >/dev/null
  }
  select_item "$w"
  ipc key alt+t >/dev/null
  wait_for '.view == "tags" and (.tags.loading | not)' 5 >/dev/null
  ipc type "$TEST_TAG" >/dev/null
  s=$(wait_for ".filterText == \"$TEST_TAG\"" 3)
  check "a new name offers Create" "create" "$(jq -r '.actionRows[-1].rowId' <<<"$s")"
  ipc key ctrl+enter >/dev/null
  s=$(wait_for '.tags.pending == 0 and (.flash | startswith("Added"))' 6)
  check "Ctrl+Enter adds it and confirms" "Added “$TEST_TAG”" "$(jq -r .flash <<<"$s")"
  check "…filter cleared, cursor on the new tag, checked" "\"\" $TEST_TAG true" "$(jq -r '"\(.filterText | tojson) \(.actionRows[.selectedIndex].tag) \(.actionRows[.selectedIndex].checked)"' <<<"$s")"
  check "…Zotero has it" true "$(item_tags "$w" | jq --arg t "$TEST_TAG" 'index($t) != null')"
  pause 0.5 # the search index follows Zotero's notifier (debounced)
  check "…and search finds the item by it" "$w" "$(post /search "$(jq -nc --arg q "#^$TEST_TAG\$" '{query: $q}')" | jq -r '[.results[].key] | join(",")')"
  ipc key enter >/dev/null
  s=$(wait_for '.tags.pending == 0 and (.flash | startswith("Removed"))' 6)
  check "Enter on it removes it" "Removed “$TEST_TAG”" "$(jq -r .flash <<<"$s")"
  check "…Zotero agrees" "$orig" "$(item_tags "$w")"
  if real_open; then
    # real keys on the same item: Alt+T, find the test tag's row, real Enter adds it back
    q=$(query_for "$(post /item "$(key_json "$w")" | jq -r .item.title)")
    wtype "$q"
    s=$(wait_for "(.shownQuery == $(jq -Rn --arg t "$q" '$t')) and (.loading | not)" 6)
    idx=$(jq --arg k "$w" '[.rows[].key] | index($k)' <<<"$s")
    for ((i = 0; i < idx; i++)); do wtype -k Down; done
    wtype -M alt t -m alt
    wait_for '.view == "tags" and (.tags.loading | not)' 5 >/dev/null
    wtype "$TEST_TAG"
    wait_for ".filterText == \"$TEST_TAG\"" 3 >/dev/null
    # Ctrl+Enter adds exactly the typed name (plain Enter would toggle whatever row is first)
    wtype -M ctrl -k Return -m ctrl
    s=$(wait_for '.tags.pending == 0 and (.flash | startswith("Added"))' 6)
    check "real Ctrl+Enter adds it again" true "$(item_tags "$w" | jq --arg t "$TEST_TAG" 'index($t) != null')"
    wtype -k Escape
  fi
  u=$(post /dev/undo '{}')
  check "Zotero's Edit → Undo names the step \"Add Tag\"" "true undo-action-add-tag" "$(jq -r '"\(.done) \(.action.action)"' <<<"$u")"
  check "…and undoing it removes the tag" "$orig" "$(item_tags "$w")"
  tags_cleanup
  E2E_CLEANUPS=()
  after=$(post /dev/undo-snapshot '{}')
  check "Zotero's undo history is as before" "$(jq -c '{undo, redo, top}' <<<"$snap")" "$(jq -c '{undo, redo, top}' <<<"$after")"
  check "the item has its original tags" "$orig" "$(item_tags "$w")"
  check "the test tag is gone from the library" 0 "$(post /dev/tag-samples "$(jq -nc --arg t "$TEST_TAG" '{testTag: $t}')" | jq .testTagInUse)"
  check "…and from the tag list" false "$(post /tags/list '{}' | jq --arg t "$TEST_TAG" '[.tags[].tag] | index($t) != null')"
else
  echo "== writes skipped (set OMA_ZOTERO_WRITE_TESTS=1 to add and remove a test tag)"
fi

e2e_finish
