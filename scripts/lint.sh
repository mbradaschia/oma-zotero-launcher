#!/bin/bash
# Syntax checks: every JavaScript file parses (node --check), and every QML file parses
# (qmllint's [syntax] findings). qmllint's other warnings are not shown: most come from
# the Omarchy shell's qs.* modules, which it can't resolve outside the running shell.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
QMLLINT=${QMLLINT:-/usr/lib/qt6/bin/qmllint}
status=0
for f in lib/*.js zotero-bridge/*.js zotero-bridge/lib/*.js tests/*.js daemon/bin/*.mjs daemon/lib/*.mjs; do
  node --check "$f" || status=1
done
for f in *.qml; do
  [[ -x $QMLLINT ]] || { echo "lint: qmllint not found ($QMLLINT): QML skipped"; break; }
  out=$("$QMLLINT" -I /usr/share/omarchy/shell "$f" 2>&1)
  if grep -q "\[syntax\]" <<<"$out"; then
    grep -A2 "\[syntax\]" <<<"$out"
    status=1
  fi
done
for f in scripts/*.sh; do
  bash -n "$f" || status=1
done
((status == 0)) && echo "lint: ok ($(ls lib/*.js zotero-bridge/*.js zotero-bridge/lib/*.js tests/*.js daemon/bin/*.mjs daemon/lib/*.mjs | wc -l) js, $(ls *.qml | wc -l) qml, $(ls scripts/*.sh | wc -l) scripts)"
exit $status
