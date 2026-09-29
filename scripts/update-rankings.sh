#!/bin/bash
# Download the journal rankings and write zotero-bridge/lib/rankingsData.js:
#   AJG 2024 (the "ABS list", Chartered ABS Academic Journal Guide: ISSNs, field, 1–4*),
#   FT50 (Financial Times research list) and UTD24 (UT Dallas list): journal titles,
#   ABDC (Australian Business Deans Council Journal Quality List: ISSNs, A*–C).
# AJG, FT50 and UTD24: snapshots from github.com/wosaide/wosaide-journal-lists (LIST/), which
# tracks the official pages; pass another raw base URL as $1 to use a different copy.
# ABDC: the official workbook from abdc.edu.au (its file name changes with each edition:
# ABDC_URL=… for a newer one; its first sheet is the current list).
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BASE=${1:-https://raw.githubusercontent.com/wosaide/wosaide-journal-lists/HEAD/LIST}
ABDC_URL=${ABDC_URL:-https://abdc.edu.au/wp-content/uploads/2026/09/ABDC-JQL-2025-v3-210926.xlsx}
OUT="$ROOT/zotero-bridge/lib/rankingsData.js"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

for f in AJG2024 FT50 UTD24; do
  curl -sfL --retry 3 "$BASE/$f.csv" -o "$tmp/$f.csv" || { echo "update-rankings: couldn't download $f.csv" >&2; exit 1; }
done
curl -sfL --retry 3 -A "Mozilla/5.0" "$ABDC_URL" -o "$tmp/abdc.xlsx" || { echo "update-rankings: couldn't download the ABDC list ($ABDC_URL)" >&2; exit 1; }
# An .xlsx is a zip of XML: the shared strings, the workbook (sheet names) and the first sheet.
unzip -p "$tmp/abdc.xlsx" xl/sharedStrings.xml >"$tmp/abdc-strings.xml"
unzip -p "$tmp/abdc.xlsx" xl/workbook.xml >"$tmp/abdc-workbook.xml"
unzip -p "$tmp/abdc.xlsx" xl/worksheets/sheet1.xml >"$tmp/abdc-sheet.xml"

node - "$tmp" "$OUT" "$BASE" "$ABDC_URL" <<'JS'
const fs = require("fs");
const [dir, out, base, abdcUrl] = process.argv.slice(2);
// Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, BOM).
function parse(text) {
  const rows = [];
  let row = [], field = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] || "").trim()])));
}
const read = (f) => parse(fs.readFileSync(`${dir}/${f}.csv`, "utf8"));
const ajg = read("AJG2024").map((r) => [r["Print ISSN"], r["E-ISSN"], r["Journal Title"], r["Field"], r["AJG 2024"]]).filter((r) => r[2] && r[4]);
const titles = (f) => read(f).map((r) => r["Journal title"] || r["Journal Title"]).filter(Boolean);
const ft50 = titles("FT50"), utd24 = titles("UTD24");

// ABDC: the first sheet's table under the row with "Journal Title" and "… rating".
const xml = (f) => fs.readFileSync(`${dir}/${f}`, "utf8");
const unescape = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
const strings = [...xml("abdc-strings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
const sheetName = unescape((/<sheet [^>]*name="([^"]*)"/.exec(xml("abdc-workbook.xml")) || [])[1] || "ABDC");
const rows = [...xml("abdc-sheet.xml").matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
  const cells = {};
  for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const v = /<v>([\s\S]*?)<\/v>/.exec(c[3] || "");
    const inline = /<is>([\s\S]*?)<\/is>/.exec(c[3] || "");
    cells[c[1]] = v ? (/t="s"/.test(c[2]) ? strings[+v[1]] : unescape(v[1])) : inline ? unescape(inline[1].replace(/<[^>]+>/g, "")) : "";
  }
  return cells;
});
const clean = (x) => String(x || "").replace(/\s+/g, " ").trim();
const head = rows.findIndex((r) => Object.values(r).some((v) => clean(v) === "Journal Title"));
if (head < 0) throw new Error("ABDC: no header row");
const col = (re) => Object.keys(rows[head]).find((k) => re.test(clean(rows[head][k])));
const [cTitle, cIssn, cEissn, cRating] = [col(/^Journal Title$/), col(/^ISSN$/), col(/^ISSN ?Online$/i), col(/rating/i)];
const abdc = rows.slice(head + 1)
  .map((r) => [clean(r[cIssn]), clean(r[cEissn]), clean(r[cTitle]), clean(r[cRating]).toUpperCase()])
  .filter((r) => r[2] && /^(A\*|A|B|C)$/.test(r[3]));
const abdcEdition = "ABDC " + ((/(\d{4})/.exec(sheetName) || [])[1] || "");

if (ajg.length < 1500 || ft50.length !== 50 || utd24.length !== 24 || abdc.length < 2000) throw new Error(`unexpected sizes: AJG ${ajg.length}, FT50 ${ft50.length}, UTD24 ${utd24.length}, ABDC ${abdc.length}`);
const data = { source: base, abdcSource: abdcUrl, fetched: new Date().toISOString().slice(0, 10), ajgEdition: "AJG 2024", abdcEdition, ajg, ft50, utd24, abdc };
fs.writeFileSync(out, `/* Generated by scripts/update-rankings.sh: do not edit. Journal rankings: AJG 2024 (Chartered ABS),
 * FT50, UTD24 (${base}) and ${abdcEdition} (${abdcUrl}), fetched ${data.fetched}. */
var OMA_RANKINGS_DATA = ${JSON.stringify(data)};
`);
console.log(`wrote ${out}: AJG ${ajg.length}, FT50 ${ft50.length}, UTD24 ${utd24.length}, ${abdcEdition} ${abdc.length}`);
JS
