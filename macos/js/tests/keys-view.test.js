// Phase 10: the keys view in the Mac's notation (Glue.keyRows, windowKeys).
const test = require("node:test");
const assert = require("node:assert");
const Glue = require("../../ZoteroLauncher/Core/Glue.js");

const here = (alt) => Glue.keysContext("search", { scope: false, pickFor: "", inSettings: false, textEntry: false }, alt);
const mine = (rows) => rows.filter((r) => r.section.startsWith("Here · "));

test("the ⌥-key mode writes Here's keys as the hints do, a capital apart", () => {
  const keys = mine(Glue.keyRows("", here(true))).map((r) => r.trailing);
  assert.ok(keys.includes("⌥g  ⌥⇧G"), keys.join(" | "));
  assert.ok(keys.some((k) => k.includes("⌥s") && k.includes("⌘S")));
  assert.ok(!keys.some((k) => /Alt|⌥[A-Z]/.test(k)), keys.join(" | ")); // (a capital only after ⌥⇧)
});

test("no Omarchy notation or words left, and ⌃U clears the box", () => {
  const rows = Glue.keyRows("", here(false));
  for (const r of rows) assert.ok(!/Ctrl\+|Alt\+|Super|Shift\+|\bPgUp\b|\bPgDn\b|Backspace|\bEnter\b|README/.test(r.trailing + " " + r.label + " " + r.labelHtml), r.trailing + " | " + r.labelHtml);
  assert.ok(rows.some((r) => r.trailing === "/  ⌃U"));
});

test("typing finds keys by the words shown and the symbols' names, not Omarchy's", () => {
  assert.ok(Glue.keyRows("cmd", here(false)).length > 0);
  assert.ok(Glue.keyRows("option", here(false)).length > 0);
  assert.equal(Glue.keyRows("super", here(false)).length, 0);
  assert.equal(Glue.keyRows("hyprland", here(false)).length, 0);
  assert.ok(Glue.keyRows("sync", here(false)).every((r) => (r.section + r.trailing + r.label).toLowerCase().includes("sync")));
});

test("each window's keys end with ⌘W; the chat window's ? works outside its box", () => {
  for (const g of ["note-window", "chat-window"]) assert.equal(Glue.windowKeys(g).at(-1)[0], "⌘W");
  assert.ok(Glue.windowKeys("chat-window").some((k) => k[0] === "F1  ?"));
  assert.deepEqual(Glue.windowKeys("nowhere"), []);
});
