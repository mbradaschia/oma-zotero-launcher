// The goldens: each Glue wrapper on the captured bridge answers (ZoteroLauncherTests/Fixtures/bridge,
// scrubbed), as Node computes it. GoldenTests runs the same cases through JavaScriptCore and
// compares. Each case carries its arguments, so the Swift side only calls and compares.
//   node scripts/goldens.mjs            write ZoteroLauncherTests/Fixtures/goldens/cases.json
//   node scripts/goldens.mjs --check    fail if that file is missing or differs (CI)
//   --out <path>                        another file (the tests)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const Glue = createRequire(import.meta.url)(join(root, "ZoteroLauncher", "Core", "Glue.js"));
const fixture = (name) => JSON.parse(readFileSync(join(root, "ZoteroLauncherTests", "Fixtures", "bridge", name + ".json"), "utf8"));

const args = process.argv.slice(2);
const at = args.indexOf("--out");
const out = at >= 0 ? args[at + 1] : join(root, "ZoteroLauncherTests", "Fixtures", "goldens", "cases.json");

const COLOR = "#0a84ff";
const identity = (r) => String(r.rowId) + ((r.noteKey || r.value || r.promptId) ? ":" + (r.noteKey || r.value || r.promptId) : "");
const sections = (rows) => rows.map((r) => r.section).filter((s, i, all) => all.indexOf(s) === i);

function cases() {
  const empty = fixture("search-empty");
  const typed = fixture("search-typed");
  const item = fixture("item");
  const list = [];
  const add = (name, wrapper, ...a) => list.push({ name, wrapper, args: a, expect: JSON.parse(JSON.stringify(Glue[wrapper](...a))) });

  add("searchRows/empty", "searchRows", empty, COLOR, { noCommands: true });
  add("searchRows/typed", "searchRows", typed, COLOR, { noCommands: true });

  const prompts = [{ id: "summary", title: "Summary", model: "default" }];
  add("actions/loading", "actions", null, "Preview", null, "", false, false, {});
  add("actions/item", "actions", item, "Preview", null, "no prompts yet", false, false, {});
  add("actions/item-pinned-with-prompts", "actions", item, "Preview", prompts, "", true, false, {});
  add("actions/item-setup-unfinished", "actions", item, "Preview", prompts, "", false, true, {});

  const menu = Glue.actions(item, "Preview", prompts, "", false, false, {});
  const firstSection = menu[0].section;
  const own = menu.filter((r) => r.section === firstSection).map(identity);
  add("orderRows/first-section-reversed", "orderRows", menu, { [firstSection]: own.slice().reverse() });
  add("orderRows/none", "orderRows", menu, null);
  add("pinRows/two", "pinRows", menu, [identity(menu[menu.length - 1]), identity(menu[0])]);
  add("pinRows/unknown", "pinRows", menu, ["no-such-row"]);
  add("otherRows/one", "otherRows", menu, [identity(menu[0])]);
  add("filterRows/win", "filterRows", menu, "win");
  add("filterRows/empty", "filterRows", menu, "");
  add("orderSections/reversed", "orderSections", menu, sections(menu).reverse());
  add("fileRows/external", "fileRows", item, "external");
  add("fileRows/window", "fileRows", item, "window");

  const rows = Glue.searchRows(empty, COLOR, { noCommands: true });
  const papers = rows.filter((r) => r.kind === "item");
  add("selectionAfter/kept", "selectionAfter", rows, papers[2].key, false);
  add("selectionAfter/follow-top", "selectionAfter", rows, papers[2].key, true);
  add("selectionAfter/gone", "selectionAfter", rows, "ZZZZZZZZ", false);
  add("selectionAfter/no-rows", "selectionAfter", [], "", false);
  return list;
}

const text = JSON.stringify(cases(), null, 1) + "\n";
if (args.includes("--check")) {
  let committed = null;
  try { committed = readFileSync(out, "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (committed !== text) {
    console.error(committed === null ? `${out} is missing: run node scripts/goldens.mjs` : `${out} is out of date: run node scripts/goldens.mjs and look at the diff`);
    process.exit(1);
  }
} else {
  writeFileSync(out, text);
  console.log(`wrote ${out}`);
}
