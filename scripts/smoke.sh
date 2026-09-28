#!/bin/bash
# Contract, security and latency checks against the running Zotero bridge.
#
#   scripts/smoke.sh                         read-only checks (never writes to the library)
#   OMA_ZOTERO_WRITE_TESTS=1 scripts/smoke.sh + a tag added to and removed from one item (cleaned up)
#   OMA_ZOTERO_UI_TESTS=1 scripts/smoke.sh   + real open/reveal round-trips: switches Zotero's
#                                            tab, selects an item, closes and reopens one open tab;
#                                            tabs, selection and your focused window are restored.
#
# Sample items come from the dev bridge's /dev/samples; with a production bridge
# (no dev routes) the sample-based checks are skipped.
set -uo pipefail

H="${XDG_RUNTIME_DIR:?}/oma-zotero/bridge.json"
[[ -r $H ]] || { echo "no handshake file at $H (is Zotero running with the bridge?)" >&2; exit 2; }
PORT=$(jq -r .port "$H")
TOKEN=$(jq -r .token "$H")
BASE="http://127.0.0.1:$PORT/oma-zotero"

pass=0
fail=0
check() { # name expected actual
  if [[ $3 == "$2" ]]; then echo "✔ $1"; ((pass++)); else echo "✖ $1: expected '$2', got '$3'"; ((fail++)); fi
}
AUTH=(-H "Authorization: Bearer $TOKEN")
ALLOW=(-H "Zotero-Allowed-Request: 1")
JSON=(-H "Content-Type: application/json")
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
post() { curl -s "${ALLOW[@]}" "${AUTH[@]}" "${JSON[@]}" -d "$2" "$BASE$1"; }
pcode() { curl -s -o /dev/null -w '%{http_code}' "${ALLOW[@]}" "${AUTH[@]}" "${JSON[@]}" -d "$2" "$BASE$1"; }
search() { post /search "$(jq -nc --arg q "$1" --argjson l "${2:-60}" '{query: $q, limit: $l}')"; }
key_body() { jq -nc --arg k "$1" '{key: $k}'; }
dry_action() { post "$1" "$(jq -nc --arg k "$2" '{key: $k, dryRun: true}')" | jq -r '.action // .error.code'; }

echo "== security"
curl -s -o /dev/null -A "Mozilla/5.0" "${AUTH[@]}" "$BASE/ping"
check "browser User-Agent without Zotero-Allowed-Request is dropped (curl exit 52)" 52 $?
check "missing token → 401" 401 "$(code "${ALLOW[@]}" "$BASE/ping")"
check "wrong token → 401" 401 "$(code "${ALLOW[@]}" -H "Authorization: Bearer $(printf '0%.0s' {1..64})" "$BASE/ping")"
check "Origin header → 403" 403 "$(code "${ALLOW[@]}" "${AUTH[@]}" -H "Origin: https://www.zotero.org" "$BASE/ping")"
check "body > 64 KiB → 413" 413 "$(head -c 70000 /dev/zero | tr '\0' a | jq -Rs '{query: .}' |
  curl -s -o /dev/null -w '%{http_code}' "${ALLOW[@]}" "${AUTH[@]}" "${JSON[@]}" --data-binary @- "$BASE/search")"
check "unknown route → 404" 404 "$(code "${ALLOW[@]}" "${AUTH[@]}" "$BASE/nope")"
check "GET on a POST route → 400" 400 "$(code "${ALLOW[@]}" "${AUTH[@]}" "$BASE/open")"

echo "== search"
check "ping → 200" 200 "$(code "${ALLOW[@]}" "${AUTH[@]}" "$BASE/ping")"
ping=$(curl -s "${ALLOW[@]}" "${AUTH[@]}" "$BASE/ping")
check "index built" true "$(jq '.index.count > 0' <<<"$ping")"
empty=$(search "")
check "empty query: ok" true "$(jq .ok <<<"$empty")"
check "empty query: open rows = openCount" "$(jq .openCount <<<"$ping")" "$(jq '.open | length' <<<"$empty")"
check "empty query: recent rows exclude open ones" 0 "$(jq '[.recent[].key] - ([.recent[].key] - [.open[].key]) | length' <<<"$empty")"
hit=$(search "${SMOKE_QUERY:-pimm 1984}" 5)
check "'${SMOKE_QUERY:-pimm 1984}' → first result by ${SMOKE_EXPECT_CREATOR:-Pimm}" true \
  "$(jq --arg c "${SMOKE_EXPECT_CREATOR:-Pimm}" '.results[0].creator | test($c; "i")' <<<"$hit")"
check "results carry titleRanges" true "$(jq '.results[0] | has("titleRanges")' <<<"$hit")"
check "'stev resil' → first-author Stevenson on top" true \
  "$(search "stev resil" 3 | jq '.results[0].creator | test("^Stevenson")')"

samples=$(post /dev/samples '{}')
if [[ $(jq -r .ok <<<"$samples") == true ]]; then
  tag=$(jq -r .topTag <<<"$samples")
  check "'#^$tag\$' → exactly the $(jq .topTagIndexed <<<"$samples") entries tagged '$tag'" \
    "$(jq .topTagIndexed <<<"$samples")" "$(search "#^$tag\$" 1 | jq .total)"

  echo "== open / reveal (dry run)"
  s() { jq -r "$1 // empty" <<<"$samples"; }
  [[ -n $(s '.openItems[0].key') ]] && check "item open in a tab → switch-tab" switch-tab "$(dry_action /open "$(s '.openItems[0].key')")"
  [[ -n $(s .pdfNotOpen.key) ]] && check "PDF not open → open-reader" open-reader "$(dry_action /open "$(s .pdfNotOpen.key)")"
  [[ -n $(s .noAttachment.key) ]] && check "no attachment → select" select "$(dry_action /open "$(s .noAttachment.key)")"
  [[ -n $(s .standaloneFile.key) ]] && check "standalone file → open-reader" open-reader "$(dry_action /open "$(s .standaloneFile.key)")"
  [[ -n $(s .childNote.key) ]] && check "child note → open-note" open-note "$(dry_action /open "$(s .childNote.key)")"
  [[ -n $(s .inCurrentCollection.key) ]] && check "reveal → select" select "$(dry_action /reveal "$(s .inCurrentCollection.key)")"
  [[ -n $(s .trashed.key) ]] && check "trashed item → 409" 409 "$(pcode /open "$(key_body "$(s .trashed.key)")")"
else
  echo "  (no dev routes: sample-based checks skipped)"
fi

echo "== item details and attachments (phase 3 routes, read-only)"
att_samples=$(post /dev/attachment-samples '{}')
if [[ $(jq -r .ok <<<"$att_samples") == true ]]; then
  a() { jq -r "$1 // empty" <<<"$att_samples"; }
  item() { post /item "$(key_body "$1")"; }
  if [[ -n $(a .onePdf.key) ]]; then
    one=$(item "$(a .onePdf.key)")
    check "/item, one PDF: one existing file, Enter opens the reader" "1 true open-reader" \
      "$(jq -r '"\(.attachments | length) \(.attachments[0].exists) \(.openAction)"' <<<"$one")"
    oneAtt=$(jq -r '.attachments[0].key' <<<"$one")
    p=$(post /attachment "$(jq -nc --arg k "$oneAtt" '{key: $k, target: "path", markOpened: false, dryRun: true}')")
    f=$(jq -r .path <<<"$p")
    check "/attachment path: an existing file on disk" true "$([[ -f $f ]] && echo true || echo false)"
    check "/attachment window (dry run) plans a reader window" open-window \
      "$(post /attachment "$(jq -nc --arg k "$oneAtt" '{key: $k, target: "window", dryRun: true}')" | jq -r .action)"
    check "/attachment on a regular item → 400 not-a-file" 400 "$(pcode /attachment "$(jq -nc --arg k "$(a .onePdf.key)" '{key: $k, target: "path"}')")"
    check "/attachment bad target → 400" 400 "$(pcode /attachment "$(jq -nc --arg k "$oneAtt" '{key: $k, target: "print"}')")"
  fi
  [[ -n $(a .multiPdf.key) ]] && check "/item, several PDFs: ≥2 files on disk" true \
    "$(item "$(a .multiPdf.key)" | jq '[.attachments[] | select(.exists)] | length >= 2')"
  [[ -n $(a .multiPdfOneOnDisk.key) ]] && check "/item, missing best PDF: the file on disk comes first; Enter opens it" "true open-reader" \
    "$(item "$(a .multiPdfOneOnDisk.key)" | jq -r '"\(.attachments[0].exists) \(.openAction)"')"
  [[ -n $(a .urlOnly.key) ]] && check "/item, URL-only: no files" 0 "$(item "$(a .urlOnly.key)" | jq '.attachments | length')"
  [[ -n $(a .standalonePdf.key) ]] && check "/item, standalone PDF: the item is its own file" "$(a .standalonePdf.key)" \
    "$(item "$(a .standalonePdf.key)" | jq -r '.attachments[0].key')"
  if [[ -n $(a .missingFile.attachment.key) ]]; then
    check "/attachment on a missing file → 409 missing-file" "409" \
      "$(pcode /attachment "$(jq -nc --arg k "$(a .missingFile.attachment.key)" '{key: $k, target: "path", markOpened: false}')")"
  fi
fi

echo "== notes and tags (phase 4/5 routes, read-only)"
note_samples=$(post /dev/note-samples '{}')
tag_samples=$(post /dev/tag-samples '{}')
if [[ $(jq -r .ok <<<"$note_samples") == true ]]; then
  ns() { jq -r "$1 // empty" <<<"$note_samples"; }
  several=$(post /item "$(key_body "$(ns .severalNotes.key)")")
  check "/item lists the notes, newest edit first" true "$(jq '.notes | length >= 3 and ([.[].dateModified] | . == (sort | reverse))' <<<"$several")"
  check "/item notes carry title and excerpt" true "$(jq '.notes | all(has("title") and has("excerpt") and has("key"))' <<<"$several")"
  d=$(post /note "$(jq -nc --arg k "$(ns .withTable.key)" '{key: $k, linkColor: "#7aa2f7"}')")
  check "/note display: Markdown, table rows on one line each" "markdown true" \
    "$(jq -r '"\(.format) \(.markdown | split("\n") | map(select(startswith("|"))) | length > 2 and all(endswith("|")))"' <<<"$d")"
  check "/note display: no zotero:// links, no raw images" "false false" \
    "$(post /note "$(jq -nc --arg k "$(ns .withImage.key)" '{key: $k}')" | jq -r '"\(.markdown | test("zotero://")) \(.markdown | test("<img|!\\["))"')"
  check "/note export keeps Zotero's own Markdown (app links)" true \
    "$(post /note "$(jq -nc --arg k "$(ns .withCitation.key)" '{key: $k, format: "export"}')" | jq '.markdown | test("zotero://")')"
  check "/note on a regular item → 400 not-a-note" 400 "$(pcode /note "$(key_body "$(ns .severalNotes.key)")")"
  check "/note bad format → 400" 400 "$(pcode /note "$(jq -nc --arg k "$(ns .withTable.key)" '{key: $k, format: "pdf"}')")"
  [[ -n $(ns .longest.key) ]] && check "/note: a very long note is cut and flagged" true \
    "$(post /note "$(key_body "$(ns .longest.key)")" | jq '.truncated and (.markdown | length) <= 61000')"
fi
if [[ $(jq -r .ok <<<"$tag_samples") == true ]]; then
  tl=$(post /tags/list '{}')
  check "/tags/list: colored tags first, then by use" true \
    "$(jq '([.tags[] | select(.position != null)] | length) as $n | (.tags[:$n] | all(.position != null)) and ([.tags[$n:][].count] | . == (sort | reverse))' <<<"$tl")"
  w=$(jq -r .writable.key <<<"$tag_samples")
  check "/tags/update: empty name → 400" 400 "$(pcode /tags/update "$(jq -nc --arg k "$w" '{key: $k, add: [" "]}')")"
  check "/tags/update: nothing to do → 400" 400 "$(pcode /tags/update "$(jq -nc --arg k "$w" '{key: $k}')")"
  ro=$(jq -c '.readOnlyItem // empty' <<<"$tag_samples")
  [[ -n $ro ]] && check "/tags/update in a read-only library → 409 read-only" "409" \
    "$(pcode /tags/update "$(jq -nc --argjson r "$ro" '{key: $r.key, libraryID: $r.libraryID, add: ["x"]}')")"
fi
if [[ $(jq -r .ok <<<"$samples") == true ]]; then
  t=$(post /item "$(key_body "$(jq -r .pdfNotOpen.key <<<"$samples")")" | jq -r .item.title)
  check "typing a whole title puts that item first" "$(jq -r .pdfNotOpen.key <<<"$samples")" \
    "$(search "$(sed "s/[|!#'^\$:]/ /g" <<<"$t")" 5 | jq -r '.results[0].key')"
fi

if [[ ${OMA_ZOTERO_WRITE_TESTS:-} == 1 && $(jq -r .ok <<<"$tag_samples") == true ]]; then
  echo "== tag writes (OMA_ZOTERO_WRITE_TESTS=1: adds and removes \"oma-zotero-test\", then cleans up)"
  w=$(jq -r .writable.key <<<"$tag_samples")
  tags_of() { post /item "$(key_body "$w")" | jq -c '[.tags[].tag] | sort'; }
  orig=$(tags_of)
  post /dev/undo-snapshot '{}' >/dev/null
  r=$(post /tags/update "$(jq -nc --arg k "$w" '{key: $k, add: ["oma-zotero-test"]}')")
  check "add → the item has it" true "$(jq '[.tags[].tag] | index("oma-zotero-test") != null' <<<"$r")"
  r=$(post /tags/update "$(jq -nc --arg k "$w" '{key: $k, remove: ["oma-zotero-test"]}')")
  check "remove → back to the original tags" "$orig" "$(jq -c '[.tags[].tag] | sort' <<<"$r")"
  post /dev/undo-restore "$(jq -nc --arg k "$w" '{keys: [$k]}')" >/dev/null
  post /dev/tag-purge '{"name": "oma-zotero-test"}' >/dev/null
  check "cleanup: the test tag is gone" 0 "$(post /dev/tag-samples '{}' | jq .testTagInUse)"
fi

echo "== open / reveal errors"
check "malformed key → 400" 400 "$(pcode /open '{"key":"nope"}')"
check "unknown key → 404" 404 "$(pcode /open '{"key":"ZZZZZZZZ"}')"
check "unknown library → 400" 400 "$(pcode /open '{"key":"ZZZZZZZZ","libraryID":999999}')"
check "reveal unknown key → 404" 404 "$(pcode /reveal '{"key":"ZZZZZZZZ"}')"

if [[ ${OMA_ZOTERO_UI_TESTS:-} == 1 && $(jq -r .ok <<<"$samples") == true ]]; then
  echo "== UI round-trips (restored afterwards)"
  focus=$(hyprctl activewindow -j | jq -r .address)
  state=$(post /dev/ui-state '{}')
  restore() {
    post /dev/ui-restore "$(jq -c '{state: .}' <<<"$state")" >/dev/null
    hyprctl dispatch "hl.dsp.focus({ window = \"address:$focus\" })" >/dev/null 2>&1 ||
      hyprctl dispatch focuswindow "address:$focus" >/dev/null 2>&1
  }
  trap restore EXIT
  ui() { post /dev/ui-state '{}'; }
  k0=$(jq -r '.openItems[0].key // empty' <<<"$samples")
  k1=$(jq -r '.openItems[1].key // empty' <<<"$samples")
  t1=$(jq -r '.openItems[1].tabId // empty' <<<"$samples")
  kc=$(jq -r '.inCurrentCollection.key // empty' <<<"$samples")

  if [[ -n $k0 ]]; then
    r=$(post /open "$(key_body "$k0")")
    check "open (real): switch-tab to the item's tab" "switch-tab main" "$(jq -r '"\(.action) \(.windowKind)"' <<<"$r")"
    check "  Zotero now shows that item's tab" "$k0" "$(ui | jq -r .selectedTabTopKey)"
  fi
  if [[ -n $kc ]]; then
    r=$(post /reveal "$(key_body "$kc")")
    check "reveal (real): select" select "$(jq -r .action <<<"$r")"
    after=$(ui)
    check "  library tab is selected" zotero-pane "$(jq -r .selectedTabId <<<"$after")"
    check "  the item is selected" true "$(jq --arg k "$kc" '.selectedItemKeys | index($k) != null' <<<"$after")"
  fi
  if [[ -n $k1 && -n $t1 ]]; then
    closedKey=$(ui | jq -r --arg t "$t1" '.tabs[] | select(.id == $t) | .itemKey')
    post /dev/close-tab "$(jq -nc --arg t "$t1" '{tabId: $t}')" >/dev/null
    r=$(post /open "$(key_body "$k1")")
    check "open (real) after closing its tab: open-reader" open-reader "$(jq -r .action <<<"$r")"
    after=$(ui)
    check "  its reader tab is back and selected" "$k1" "$(jq -r .selectedTabTopKey <<<"$after")"
    check "  same attachment as before" "$closedKey" "$(jq -r .selectedTabItemKey <<<"$after")"
  fi

  restore
  trap - EXIT
  final=$(ui)
  check "restored: same tabs, same order, same loaded/unloaded state" \
    "$(jq -c '[.tabs[] | [.topKey, .type]]' <<<"$state")" "$(jq -c '[.tabs[] | [.topKey, .type]]' <<<"$final")"
  check "restored: same selected tab" "$(jq -r .selectedTabTopKey <<<"$state")" "$(jq -r .selectedTabTopKey <<<"$final")"
  check "restored: same selected items" \
    "$(jq -c '.selectedItemKeys | sort' <<<"$state")" "$(jq -c '.selectedItemKeys | sort' <<<"$final")"
fi

echo "== latency (end-to-end over HTTP, 5 queries x 10)"
times=()
for q in "s" "sup" "supply chain" "stev resil" "${SMOKE_QUERY:-pimm 1984}"; do
  body=$(jq -nc --arg q "$q" '{query: $q}')
  for _ in {1..10}; do
    times+=("$(curl -s -o /dev/null -w '%{time_total}' "${ALLOW[@]}" "${AUTH[@]}" "${JSON[@]}" -d "$body" "$BASE/search")")
  done
done
printf '%s\n' "${times[@]}" | sort -n | awk '{a[NR]=$1*1000} END {printf "  p50 %.1f ms  p95 %.1f ms  max %.1f ms  (n=%d)\n", a[int(NR*0.5)], a[int(NR*0.95)], a[NR], NR}'

echo "== $pass passed, $fail failed"
((fail == 0))
