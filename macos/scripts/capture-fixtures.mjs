#!/usr/bin/env node
// Record a few real bridge answers from your Zotero as test fixtures, scrubbed (scripts/scrub.mjs):
// nothing of your library is written, only its shapes. Zotero must be running with the bridge.
//   node scripts/capture-fixtures.mjs [OUT_DIR]   (default ZoteroLauncherTests/Fixtures/bridge)
// Refuses to write a file if any original value survives scrubbing.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { scrub, leaks } from "./scrub.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || join(HERE, "..", "ZoteroLauncherTests", "Fixtures", "bridge");
const handshake = JSON.parse(readFileSync(join(process.env.XDG_RUNTIME_DIR || tmpdir(), "oma-zotero", "bridge.json"), "utf8"));

async function post(route, body) {
  const r = await fetch(`http://127.0.0.1:${handshake.port}/oma-zotero${route}`, {
    method: "POST",
    headers: { "Zotero-Allowed-Request": "1", Authorization: `Bearer ${handshake.token}`, "Content-Type": "application/json", "User-Agent": "ZoteroLauncher-fixtures/1" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`${route}: ${JSON.stringify(j.error)}`);
  return j;
}

// Long lists cut short: a fixture needs the shape, not the whole library.
function trim(answer) {
  const out = { ...answer };
  for (const k of ["results", "recent", "open", "pinned", "collections", "tags", "values", "notes", "attachments"]) {
    if (Array.isArray(out[k])) out[k] = out[k].slice(0, k === "tags" || k === "values" ? 40 : 20);
  }
  return out;
}

function save(name, answer) {
  const original = trim(answer);
  const clean = scrub(original);
  const leaked = leaks(original, clean);
  if (leaked.length) throw new Error(`${name}: ${leaked.length} value(s) survived scrubbing; nothing written`);
  writeFileSync(join(OUT, name + ".json"), JSON.stringify(clean, null, 2) + "\n");
  console.log("wrote", name);
}

mkdirSync(OUT, { recursive: true });
const empty = await post("/search", { query: "", limit: 20, emptyQuery: { showOpen: true, tabOrder: "mru", recent: "latest", recentLimit: 15 }, pinned: [] });
save("search-empty", empty);
const first = [...(empty.recent || []), ...(empty.results || [])].find((r) => r.title && r.title.length > 3);
if (!first) throw new Error("no paper in your library to search for");
const query = first.title.replace(/[^\p{L}]/gu, "").slice(0, 3);
save("search-typed", await post("/search", { query, limit: 20 }));
const withNotes = [...(empty.recent || []), ...(empty.results || [])].find((r) => r.noteCount > 0) || first;
const item = await post("/item", { key: withNotes.key, libraryID: withNotes.libraryID });
save("item", item);
if ((item.notes || []).length) save("note", await post("/note", { key: item.notes[0].key, libraryID: item.notes[0].libraryID, format: "display" }));
save("tags-list", await post("/tags/list", { libraryID: 1 }));
save("facets-tag", await post("/facets", { field: "tag" }));
save("facets-year", await post("/facets", { field: "year" }));
