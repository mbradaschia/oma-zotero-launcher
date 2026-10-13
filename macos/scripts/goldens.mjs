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
const require = createRequire(import.meta.url);
const Glue = require(join(root, "ZoteroLauncher", "Core", "Glue.js"));
const Views = require(join(root, "js", "lib", "Views.js"));
// Captured from a library and scrubbed (bridge/), or written by hand to exercise text the scrubber
// flattens: accents, CJK, emoji, capitals, markup (synthetic/).
const fixture = (name, dir = "bridge") => JSON.parse(readFileSync(join(root, "ZoteroLauncherTests", "Fixtures", dir, name + ".json"), "utf8"));

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
  add("searchRows/unicode", "searchRows", fixture("search-unicode", "synthetic"), COLOR, { noCommands: true });

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
  const labels = ["Étude über Straße", "İstanbul notes", "ıslak", "知識の創造", "Growth 🚀 plan", "Cafe\u0301 society", "CAFÉ"];
  const unicodeRows = labels.map((label) => Views.listRow({ rowId: "x", label, available: true }));
  for (const q of ["étu", "STRASSE", "i̇st", "ı", "知識", "🚀", "café", "Ca"]) add(`filterRows/unicode-${q}`, "filterRows", unicodeRows, q);
  add("orderSections/reversed", "orderSections", menu, sections(menu).reverse());
  add("fileRows/external", "fileRows", item, "external");
  add("fileRows/window", "fileRows", item, "window");

  const rows = Glue.searchRows(empty, COLOR, { noCommands: true });
  const papers = rows.filter((r) => r.kind === "item");
  add("selectionAfter/kept", "selectionAfter", rows, papers[2].key, false);
  add("selectionAfter/follow-top", "selectionAfter", rows, papers[2].key, true);
  add("selectionAfter/gone", "selectionAfter", rows, "ZZZZZZZZ", false);
  add("selectionAfter/no-rows", "selectionAfter", [], "", false);

  // phase 3b
  add("settings/none", "settings", null, null);
  add("settings/machine-and-shared", "settings", { general: { keys: "alt", keyDelay: 450, syncDir: "~/Sync" } }, { general: { citationStyle: "apa", maxResults: 40 }, status: { tags: ["queued", "done"] } });
  add("settings/not-an-object", "settings", [1, 2], null);
  const settings = Glue.settings(null, null).settings;
  const pins = Glue.parsePins(JSON.stringify({ pins: [{ key: "ABCD1234", libraryID: 1, title: "p", type: "item" }, { key: "WXYZ9876", libraryID: 1, type: "collection" }, { key: "a tag", type: "tag" }] }));
  add("searchBody/empty-with-pins", "searchBody", "", null, { ...settings, emptyQuery: { recent: "latest" } }, pins, [], [], []);
  add("searchBody/typed", "searchBody", "teece dyn", null, settings, pins, [], [], []);
  add("searchBody/collection", "searchBody", "", { type: "collection", key: "WXYZ9876", libraryID: 1, title: "c" }, settings, pins, [], [], []);
  add("searchBody/tag", "searchBody", "x", { type: "tag", key: "a tag", libraryID: 1, title: "#a tag" }, settings, [], [], [], []);
  add("searchBody/saved-search", "searchBody", "", { type: "search", key: "s1", libraryID: 1, title: "S", query: "y:2020" }, settings, [], [], [], []);

  const base = { details: item, viewerName: "Preview", prompts: null, promptsProblem: "", pinned: false, setup: true, extras: {} };
  add("menu/plain", "menu", base);
  add("menu/loading", "menu", { ...base, details: null });
  const plain = Glue.menu(base).rows;
  const ids = plain.map(identity);
  add("menu/arranged", "menu", { ...base, pins: [ids[ids.length - 1]], others: [ids[0]], order: { [plain[1].section]: plain.filter((r) => r.section === plain[1].section).map(identity).reverse() }, sections: sections(plain).reverse() });
  add("menu/filtered", "menu", { ...base, filter: "lib" });
  add("fileRows/filtered", "fileRows", item, "external", "pdf");
  add("usableFiles/window", "usableFiles", item, "window");
  add("confirmRows/ask", "confirmRows", { yes: "Delete it", no: "Keep it", detail: "On 3 papers" });
  add("confirmRows/defaults", "confirmRows", null);

  add("parsePins/mixed", "parsePins", JSON.stringify({ pins: [{ key: "ABCD1234", libraryID: "2" }, { key: "bad" }, { key: "t", type: "tag" }, null] }));
  add("parsePins/not-json", "parsePins", "{");
  add("togglePin/add", "togglePin", pins, { key: "QQQQ1111", libraryID: 1, title: "new" });
  add("togglePin/remove", "togglePin", pins, { key: "ABCD1234", libraryID: 1 });
  add("isPinned/yes", "isPinned", pins, { key: "WXYZ9876", libraryID: 1, type: "collection" });
  add("isPinned/other-type", "isPinned", pins, { key: "WXYZ9876", libraryID: 1 });
  add("movePin/down", "movePin", pins, { key: "ABCD1234", libraryID: 1 }, { key: "WXYZ9876", libraryID: 1, type: "collection" });
  add("toggleIdentity/add", "toggleIdentity", ["open"], "pin");
  add("toggleIdentity/remove", "toggleIdentity", ["open", "pin"], "open");
  add("moveIdentity/swap", "moveIdentity", ["a", "b", "c"], "c", "a");
  add("moveIdentity/missing", "moveIdentity", ["a"], "a", "z");
  add("moveSection/up", "moveSection", plain, plain[plain.length - 1].section, -1);
  add("moveSection/top", "moveSection", plain, plain[0].section, -1);
  add("rowIdentity/note", "rowIdentity", plain.find((r) => r.noteKey) || plain[0]);
  add("rowIdentity/plain", "rowIdentity", Views.listRow({ rowId: "open" }));
  add("contextLabel/menu", "contextLabel", "‹ Teece, 1997 · Dynamic capabilities");
  add("typeHint/tags", "typeHint", "‹ Tags · type to find or create one", false);
  add("rankLabels/full", "rankLabels", { ajg: "4*", abdc: "A*", ft50: true, utd24: true });
  add("rankLabels/none", "rankLabels", null);
  add("paperFooter/item", "paperFooter", { details: item });
  add("paperFooter/extracting", "paperFooter", { details: item, extracting: true });
  add("statusName/tag", "statusName", "s/reading");
  add("citationStyle/default", "citationStyle", settings);
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
