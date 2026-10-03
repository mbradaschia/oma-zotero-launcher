// A paper's menu: its own pins (p) and its rows' order (Shift+↑/↓); the pills' colours (Views.pillPalette);
// the keybindings for where you are (? / F1: Views.keysContext, buildKeyRows' "Here").
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const V = require("../lib/Views.js");

const row = (rowId, section, more) => V.listRow(Object.assign({ rowId: rowId, section: section, label: rowId, available: true }, more || {}));

test("a row's identity: what it is and which one (a note, a chat, a citation), not a file's key nor its label", () => {
  assert.equal(V.rowIdentity(row("note", "Notes", { note: { key: "NOTE0001" } })), "note:NOTE0001");
  assert.equal(V.rowIdentity(row("cite-copy", "This paper", { value: "citation" })), "cite-copy:citation");
  assert.equal(V.rowIdentity(row("external", "This paper", { att: { key: "ATT00001", libraryID: 1 } })), "external");
  assert.equal(V.rowIdentity(row("pin", "This paper", { label: "Unpin" })), "pin");
});

test("Shift+↑/↓: your order within a section (the placed first, the rest as they come); other sections untouched", () => {
  const rows = [row("prompts", "Prompts and chat"), row("chat", "Prompts and chat"), row("extract", "Prompts and chat"), row("open", "This paper"), row("reveal", "This paper")];
  const out = V.orderRows(rows, { "Prompts and chat": ["extract", "prompts"] });
  assert.deepEqual(out.map((r) => r.rowId), ["extract", "prompts", "chat", "open", "reveal"]);
  assert.equal(V.orderRows(rows, null), rows);
  // moving: the identity to where the other one is
  const ids = rows.slice(0, 3).map(V.rowIdentity);
  assert.deepEqual(V.moveIdentity(ids, "extract", "chat"), ["prompts", "extract", "chat"]);
  assert.deepEqual(V.moveIdentity(ids, "prompts", "chat"), ["chat", "prompts", "extract"]);
  assert.equal(V.moveIdentity(ids, "nope", "chat"), null);
  assert.equal(V.moveIdentity(ids, "chat", "chat"), null);
});

test("p: the pinned rows out of their sections into Pinned, on top, in your order; again: unpinned", () => {
  const rows = [row("note", "Notes", { note: { key: "NOTE0001" } }), row("chat", "Prompts and chat"), row("cite-copy", "This paper", { value: "citation" }), row("reveal", "This paper")];
  const pins = V.toggleIdentity(V.toggleIdentity([], "cite-copy:citation"), "chat")
  assert.deepEqual(pins, ["cite-copy:citation", "chat"]);
  const out = V.pinRows(rows, pins.concat(["gone"])); // a pin whose row isn't here (another paper's note): left out
  assert.deepEqual(out.map((r) => [r.section, V.rowIdentity(r)]), [["Pinned", "cite-copy:citation"], ["Pinned", "chat"], ["Notes", "note:NOTE0001"], ["This paper", "reveal"]]);
  assert.equal(rows[1].section, "Prompts and chat"); // the rows given aren't changed
  assert.deepEqual(V.toggleIdentity(pins, "chat"), ["cite-copy:citation"]);
  assert.equal(V.pinRows(rows, []), rows);
  // the ListModel takes its roles from the first row: a pinned row keeps every role
  assert.deepEqual(Object.keys(out[0]).sort(), Object.keys(rows[0]).sort());
});

test("pills: a colour per kind, the status in the accent; apart from each other and readable on the background, on every theme", () => {
  const themes = ["/usr/share/omarchy/themes", path.join(process.env.HOME || "", ".config/omarchy/themes")].filter((d) => fs.existsSync(d))
    .flatMap((d) => fs.readdirSync(d).map((t) => path.join(d, t, "colors.toml"))).filter((f) => fs.existsSync(f));
  const samples = themes.map((f) => V.parseThemeColors(fs.readFileSync(f, "utf8")));
  samples.push({ accent: "#7aa2f7", background: "#1a1b26", foreground: "#c0caf5" }); // no named colours: hues turned from the accent
  samples.push({ accent: "#e68e0d", background: "#121212", foreground: "#bebebe", blue: "#e68e0d", cyan: "#bebebe", green: "#FFC107" }); // names that repeat the accent or are grey
  samples.push({ accent: "#1e66f5", background: "#eff1f5", foreground: "#4c4f69" }); // a light theme
  for (const t of samples) {
    const p = V.pillPalette(t, { accent: t.accent, foreground: t.foreground, background: t.background });
    const kinds = ["status", "task", "rank", "taxonomy", "scope", "priority"];
    assert.equal(p.status.toLowerCase(), t.accent.toLowerCase().slice(0, 7));
    assert.equal(p.neutral, t.foreground);
    for (const k of kinds) assert.match(p[k], /^#[0-9a-f]{6}$/);
    for (const k of kinds.slice(1)) assert.ok(V.contrast(p[k], t.background) >= 3, `${k} ${p[k]} on ${t.background}`);
    for (let i = 0; i < kinds.length; i++) for (let j = i + 1; j < kinds.length; j++)
      assert.ok(V.colorDistance(p[kinds[i]], p[kinds[j]]) >= 100, `${kinds[i]} ${p[kinds[i]]} vs ${kinds[j]} ${p[kinds[j]]}`);
  }
  // a theme's own colour, when it stands apart, is used as it is
  const tokyo = V.pillPalette({ green: "#9ece6a", magenta: "#f7768e" }, { accent: "#7aa2f7", foreground: "#c0caf5", background: "#1a1b26" });
  assert.deepEqual([tokyo.task, tokyo.taxonomy], ["#9ece6a", "#f7768e"]);
  // one too close to a colour already taken (lavender by the blue accent): another one
  assert.notEqual(V.pillPalette({ magenta: "#bb9af7" }, { accent: "#7aa2f7", foreground: "#c0caf5", background: "#1a1b26" }).taxonomy, "#bb9af7");
});

test("? / F1: where you are decides the keys shown first", () => {
  const ctx = (view, more) => V.keysContext(view, more).group;
  assert.equal(ctx("search", {}), "results");
  assert.equal(ctx("search", { scope: true }), "scope");
  assert.equal(ctx("search", { pickFor: "chat" }), "pick");
  assert.equal(ctx("actions"), "actions");
  assert.equal(ctx("note"), "note");
  assert.equal(ctx("picker-values"), "picker");
  assert.deepEqual([ctx("todo-edit"), ctx("todo-priority"), ctx("todo-due"), ctx("todo-new"), ctx("tasks")], ["task", "task", "calendar", "todo-new", "processes"]);
  assert.equal(ctx("settings-taxonomies", { inSettings: true }), "settings");
  assert.equal(ctx("settings-edit", { inSettings: true, textEntry: true }), "typing");
  assert.deepEqual([ctx("chat-menu"), ctx("extract-menu"), ctx("confirm")], ["menu", "menu", "menu"]);
  // every launcher view has keys to show
  const qml = fs.readFileSync(path.join(__dirname, "..", "ZoteroSearch.qml"), "utf8");
  const views = new Set([...qml.matchAll(/root\.view === "([a-z-]+)"/g)].map((m) => m[1]));
  for (const v of views) {
    const g = V.keysContext(v, { inSettings: v.indexOf("settings") === 0, textEntry: /name|rename|edit$|text|change/.test(v) }).group;
    assert.ok(V.VIEW_KEYS[g] && V.VIEW_KEYS[g].length, `${v} → ${g}`);
  }
});

test("Keybindings: Here first (the Alt keys in Alt-key mode), then every section; typing finds keys in both", () => {
  const rows = V.buildKeyRows("", { group: "actions", title: "a paper's menu" });
  assert.equal(rows[0].section, "Here · a paper's menu");
  assert.equal(rows.filter((r) => r.section === "Here · a paper's menu").length, V.VIEW_KEYS.actions.length);
  assert.ok(rows.some((r) => r.section === "Everywhere" && r.trailing === "?  F1"));
  assert.ok(rows.some((r) => r.section === "A paper's menu" && r.trailing === "p"));
  const pin = V.buildKeyRows("pin the highlighted", { group: "actions", title: "a paper's menu" });
  assert.deepEqual([...new Set(pin.map((r) => r.section))], ["Here · a paper's menu", "A paper's menu"]);
  assert.ok(pin.some((r) => r.section === "A paper's menu" && r.trailing === "p"));
  const alt = V.buildKeyRows("", { group: "actions", title: "a paper's menu", alt: true });
  assert.equal(alt.find((r) => /^Pin the highlighted row/.test(r.label)).trailing, "Alt+P");
  assert.equal(V.altKeys("n  #  x"), "Alt+N  Alt+#  Alt+X");
  assert.equal(V.altKeys("Shift+↑ ↓"), "Shift+↑ ↓");
  assert.equal(V.buildKeyRows("").length, V.KEYBINDINGS.length); // no "Here": every key
  for (const k of V.KEYBINDINGS) assert.equal(k.length, 3);
  for (const g of Object.keys(V.VIEW_KEYS)) for (const k of V.VIEW_KEYS[g]) assert.equal(k.length, 2, g);
});

test("the footer: a hint's keys apart from what they do; the hints that fit, whole, going back always", () => {
  assert.deepEqual(V.hintParts("⇧↵ z zotero"), { keys: "⇧↵ z", desc: "zotero" });
  assert.deepEqual(V.hintParts("alt+→← status"), { keys: "alt+→←", desc: "status" });
  assert.deepEqual(V.hintParts("esc one-key actions"), { keys: "esc", desc: "one-key actions" });
  assert.deepEqual(V.hintParts("type to search"), { keys: "", desc: "type to search" });
  assert.deepEqual(V.hintParts("⌫ esc back"), { keys: "⌫ esc", desc: "back" });
  const width = (h) => h.length * 10; // 10 px a character
  const hints = ["/ search", "? keys", "↵ menu", "o/w pdf in your app", "n notes", "⌫ esc back"];
  // 200 px, 16 between: going back first (100), then / search (+96), the rest left out
  assert.deepEqual(V.fitHints(hints, width, 200, 16), ["/ search", "⌫ esc back"]);
  // a long one left out, shorter ones after it still fit
  assert.deepEqual(V.fitHints(hints, width, 440, 16), ["/ search", "? keys", "↵ menu", "n notes", "⌫ esc back"]);
  assert.deepEqual(V.fitHints(hints, width, 5000, 16), hints);
});

test("P: rows moved out of the way, out of their sections into Other at the bottom, in your order; not a pinned one", () => {
  const rows = [row("chat", "Prompts and chat"), row("extract", "Prompts and chat"), row("reveal", "This paper"), row("open", "This paper")];
  const out = V.otherRows(V.pinRows(rows, ["open"]), ["reveal", "chat", "open", "gone"]);
  assert.deepEqual(out.map((r) => [r.section, r.rowId]), [["Pinned", "open"], ["Prompts and chat", "extract"], ["Other", "reveal"], ["Other", "chat"]]);
  assert.equal(V.otherRows(rows, []), rows);
  assert.deepEqual(Object.keys(out[2]).sort(), Object.keys(rows[0]).sort());
});
