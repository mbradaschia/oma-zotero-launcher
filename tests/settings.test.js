// The Settings view (lib/Settings.js) and the sectioned settings file (lib/Client.js):
// migration from the flat file, edits, validation, and the rows of each page, onboarding
// included (PLAN-providers.md §3, §5).
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../lib/Settings.js");
const C = require("../lib/Client.js");
const V = require("../lib/Views.js");

const row = V.listRow;

function providers(over) {
  const base = [
    { id: "claude", name: "Claude (subscription)", kind: "subscription", enabled: false, takesKey: false, needsKey: false, key: { set: false }, detected: { available: true, signedIn: null, detail: "Claude Code is installed" }, privacy: "p", cost: "c", signIn: "claude, then /login" },
    { id: "chatgpt", name: "ChatGPT (subscription)", kind: "subscription", enabled: false, takesKey: false, key: { set: false }, detected: { available: true, signedIn: false, detail: "not signed in: codex login" }, privacy: "p", cost: "c" },
    { id: "openai", name: "OpenAI API", kind: "api", enabled: false, takesKey: true, needsKey: true, key: { set: false }, detected: { available: false }, envNames: ["OPENAI_API_KEY"], keyUrl: "https://platform.openai.com/api-keys", privacy: "p", cost: "c" },
    { id: "openrouter", name: "OpenRouter", kind: "api", enabled: false, takesKey: true, needsKey: true, key: { set: true, from: "keyring", masked: "sk-…abcd" }, detected: { available: false }, privacy: "p", cost: "c" },
    { id: "ollama", name: "Ollama", kind: "local", enabled: true, takesKey: false, key: { set: false }, detected: { available: true, signedIn: true, detail: "running, with 2 models" }, baseURL: "http://localhost:11434/v1", privacy: "p", cost: "c" },
    { id: "lab", name: "Lab", kind: "endpoint", endpoint: true, enabled: true, takesKey: true, needsKey: false, key: { set: false }, detected: { available: false }, baseURL: "https://gw/v1", privacy: "p", cost: "c" },
  ];
  return base.map((p) => Object.assign({}, p, (over || {})[p.id] || {}));
}

function state(over) {
  return Object.assign({
    settings: C.normalizeSettings({ providers: { ollama: { enabled: true } } }).settings,
    info: { keyring: { ok: true }, providers: providers() },
    runner: { installed: true, installing: false },
    reqs: { node: "v26.10.0", pdftotext: true },
    models: [{ value: "ollama:qwen3:8b", displayName: "qwen3:8b", group: "Ollama", context: 40960, efforts: ["low"] }],
    defaults: { prompts: "ollama:qwen3:8b", chat: "ollama:qwen3:8b" },
    tests: {}, open: "",
  }, over || {});
}

test("the file: flat settings move into general; providers and defaults round-trip and validate", () => {
  const flat = C.normalizeSettings({ maxResults: 40, emptyQuery: { recent: "added" } }).settings;
  assert.equal(flat.configured, false);
  assert.equal(flat.providers.claude.enabled, true); // before sections: Claude
  const file = S.toFile(flat);
  assert.deepEqual(file.general, { maxResults: 40, emptyQuery: { recent: "added" } });
  assert.equal(file.providers.claude.enabled, true); // written out, so it stays on
  const back = C.normalizeSettings(file);
  assert.deepEqual(back.problems, []);
  assert.equal(back.settings.maxResults, 40);
  assert.equal(back.settings.configured, true);
  // edits on normalized settings, then the file
  let s = S.withValue(back.settings, "providers.openai.enabled", true);
  s = S.withValue(s, "general.accelerators", false);
  s = S.withValue(s, "defaults.chat.model", "openai:gpt-5.5");
  s = S.withValue(s, "general.externalPdfCommand", ["zathura", "--fork"]);
  const added = S.addEndpoint(s, "Lab Gateway!", "https://gw.example.edu/v1");
  assert.equal(added.id, "lab-gateway");
  assert.equal(S.addEndpoint(added.settings, "Lab Gateway", "https://x/v1").id, "lab-gateway-2");
  assert.equal(S.addEndpoint(s, "OpenAI", "https://x/v1").id, "openai-2"); // never a provider's id
  s = S.withValue(added.settings, "endpoint.lab-gateway.context", 32768);
  const f2 = S.toFile(s);
  assert.deepEqual(f2.general, { maxResults: 40, emptyQuery: { recent: "added" }, accelerators: false, externalPdfCommand: ["zathura", "--fork"] });
  assert.deepEqual(f2.providers.compatible, [{ id: "lab-gateway", name: "Lab Gateway!", baseURL: "https://gw.example.edu/v1", enabled: true, context: 32768 }]);
  assert.deepEqual(f2.defaults, { chat: { model: "openai:gpt-5.5", effort: "high" } });
  const r = C.normalizeSettings(f2);
  assert.deepEqual(r.problems, []);
  assert.equal(r.settings.providers.openai.enabled, true);
  assert.equal(r.settings.endpoints[0].context, 32768);
  assert.deepEqual(S.removeEndpoint(s, "lab-gateway").endpoints, []);
  assert.equal(S.withValue(s, "general.externalPdfCommand", undefined).externalPdfCommand, undefined); // back to the default
  // what the validator refuses, the launcher doesn't write
  const bad = C.normalizeSettings({ providers: { openai: { enabled: "yes" }, nope: {}, compatible: [{ id: "openai", baseURL: "x" }] }, defaults: { chat: { model: "a b" } } });
  assert.deepEqual(bad.problems, [
    "providers.openai.enabled must be true or false",
    'unknown provider "nope"',
    "providers.compatible[0] needs a new id (a-z, 0-9, -; not a provider's name)",
    'defaults.chat.model must be a model, e.g. "openai:gpt-5.5"',
  ]);
  assert.deepEqual(C.normalizeSettings({ general: { colour: 1 } }).problems, ['unknown setting "colour"']);
});

test("parseValue: numbers in range, commands, URLs, context sizes", () => {
  const n = S.generalItem("maxResults");
  assert.deepEqual(S.parseValue(n, "80"), { value: 80 });
  assert.match(S.parseValue(n, "5").error, /10 to 200/);
  assert.match(S.parseValue(n, "lots").error, /whole number/);
  assert.deepEqual(S.parseValue(S.generalItem("externalPdfCommand"), " zathura  --fork "), { value: ["zathura", "--fork"] });
  assert.deepEqual(S.parseValue(S.generalItem("externalPdfCommand"), ""), { value: undefined });
  assert.deepEqual(S.parseValue({ type: "url" }, "http://localhost:1234/v1/"), { value: "http://localhost:1234/v1" });
  assert.ok(S.parseValue({ type: "url" }, "localhost:1234").error);
  assert.deepEqual(S.parseValue({ type: "context" }, "32k"), { value: 32768 });
  assert.deepEqual(S.parseValue({ type: "context" }, ""), { value: undefined });
  assert.equal(S.valueText(S.generalItem("emptyQuery.recent"), undefined), "Newest added or changed");
});

test("Settings pages: the root with the setup checklist; General from the schema, choices as pages", () => {
  const ready = { setup: { zotero: "/usr/bin/zotero", running: true, bind: "ours", rule: true, node: "v26.10.0", pdftotext: true },
    bridge: { status: "ready", version: "0.1.0", zoteroVersion: "10.0.3", expected: "0.1.0" } };
  const root = S.buildRoot(state(ready), row);
  // the setup steps, in order, each with its checkmark
  assert.deepEqual(root.map((r) => [r.section, r.label, r.showCheck && r.checked]), [
    ["Settings", "Models & providers", false], ["Settings", "Defaults", false], ["Settings", "Paper status", false], ["Settings", "Tasks", false], ["Settings", "General", false],
    ["Setup", "Install Zotero", true], ["Setup", "Start Zotero", true], ["Setup", "Install the Zotero plugin", true], ["Setup", "Add the keybinding", true],
    ["Setup", "Open from the middle (optional)", true], ["Setup", "Install Node.js", true], ["Setup", "Install the AI features", true], ["Setup", "Set up an AI model", true],
    ["Setup", "Install pdftotext", true], ["Setup", "A system keyring", true]]);
  assert.equal(root[5].detail, "Installed 10.0.3");
  assert.equal(root[2].detail, "to read, reading, read · the tags Tab / Shift+Tab cycles on a paper");
  assert.equal(root[0].detail, "Ollama, Lab are on");
  assert.equal(root[1].detail, "Prompts: ollama:qwen3:8b · Chat: ollama:qwen3:8b");
  const fresh = S.buildRoot(state({ runner: { installed: false, installing: false }, reqs: { node: "", pdftotext: false }, info: null,
    setup: { zotero: "", running: false, bind: "none", rule: false, node: "", pdftotext: false }, bridge: { status: "zotero-down" } }), row);
  const install = fresh.find((r) => r.rowId === "set-install");
  assert.deepEqual([install.label, install.available, install.detail], ["Install the AI features", false, "Install Node.js first"]);
  assert.deepEqual(fresh.filter((r) => r.section === "Setup").map((r) => [r.label, r.value, r.checked]), [
    ["Install Zotero", "zotero-get", false], ["Start Zotero", "", false], ["Install the Zotero plugin", "", false], ["Add the keybinding", "bind-add", false],
    ["Open from the middle (optional)", "rule-add", false], ["Install Node.js", "term:omarchy install dev-env node", false], ["Install the AI features", "", false],
    ["Install pdftotext", "term:omarchy pkg add poppler", false]]);
  const g = S.buildGeneral(state(), row);
  assert.equal(g.length, S.GENERAL.length); // one row per setting; choices open a page
  assert.deepEqual([...new Set(g.map((r) => r.section))], ["Keys", "Search", "Before you type", "Opening papers", "Advanced"]);
  assert.ok(g.filter((r) => r.rowId === "set-choice").every((r) => r.submenu));
  const opts = S.buildChoice(state(), "general.emptyQuery.recent", row);
  assert.deepEqual(opts.map((r) => [r.tag, r.checked]), [["latest", true], ["added", false], ["modified", false], ["none", false]]);
  assert.deepEqual(S.buildChoice(state(), "general.keys", row).map((r) => [r.tag, r.checked]), [["single", true], ["alt", false]]);
  assert.deepEqual(S.buildChoice(state(), "defaults.chat.effort", row).map((r) => r.tag), ["", "low", "medium", "high", "xhigh", "max"]);
  assert.equal(g.find((r) => r.value === "general.accelerators").detail, "On · o, w, n, #, p, l act on the highlighted paper");
});

test("Models & providers: ready to use first, yours, then ways to add one; a provider's page", () => {
  const rows = S.buildProviders(state(), row);
  assert.deepEqual(rows.map((r) => [r.section, r.rowId, r.value || r.label]), [
    ["Ready to use", "set-quick", "claude"], // detected (ChatGPT isn't signed in: not offered)
    ["Your providers", "set-provider", "openrouter"], ["Your providers", "set-provider", "ollama"], ["Your providers", "set-provider", "lab"],
    ["Add a provider", "set-provider", "chatgpt"], ["Add a provider", "set-provider", "openai"],
    ["Add a provider", "set-endpoint-new", "Add an OpenAI-compatible endpoint…"]]);
  assert.match(rows[0].detail, /Claude Code is installed · Enter turns it on/);
  assert.match(rows[1].detail, /key sk-…abcd/);
  assert.equal(S.buildProviders(state({ info: null }), row)[0].label, "Checking what's installed…");
  const page = S.buildProvider(state({ tests: { openai: { ok: true, detail: "3 models", models: [{ value: "openai:gpt-5.5", displayName: "gpt-5.5", priceIn: 1.25, priceOut: 10 }] } } }), "openai", row);
  assert.deepEqual(page.map((r) => r.rowId), ["set-toggle", "set-test", "set-key", "set-link", "set-info", "set-use", "set-info", "set-info", "set-info"]);
  assert.equal(page[0].value, "providers.openai.enabled");
  assert.match(page[2].label, /Set the API key from the clipboard/);
  assert.match(page[2].detail, /clipboard is cleared/);
  assert.match(page[page.length - 1].detail, /with gpt-5.5, about \$0.07–\$0.14 a run/);
  const lab = S.buildProvider(state(), "lab", row);
  assert.equal(lab[0].value, "endpoint.lab.enabled");
  assert.ok(lab.some((r) => r.value === "endpoint.lab.baseURL") && lab.some((r) => r.rowId === "set-endpoint-remove"));
  const ollama = S.buildProvider(state(), "ollama", row);
  assert.ok(ollama.some((r) => r.value === "providers.ollama.context") && !ollama.some((r) => r.rowId === "set-key"));
  // no keyring: keys can't be stored (the environment still works)
  const nokr = S.buildProvider(state({ info: { keyring: { ok: false, detail: "no Secret Service" }, providers: providers() } }), "openai", row);
  assert.equal(nokr.find((r) => r.rowId === "set-key").available, false);
});

test("onboarding: nothing on, or no runner, means Set up an AI model", () => {
  assert.equal(S.needsSetup(state()), false);
  const none = providers({ ollama: { enabled: false }, lab: { enabled: false } });
  assert.equal(S.needsSetup(state({ info: { keyring: { ok: true }, providers: none } })), true);
  assert.equal(S.needsSetup(state({ runner: { installed: false } })), true);
  assert.equal(S.needsSetup(state({ info: null })), false); // still loading: don't flash the setup row
  const details = { item: { itemType: "journalArticle" }, attachments: [{ exists: true, contentType: "application/pdf" }], notes: [], tags: [], library: { editable: true } };
  const menu = V.buildActions(details, "", [], "", false, true);
  assert.deepEqual(menu.filter((r) => r.section === "Prompts and chat").map((r) => r.rowId), ["setup", "extract"]);
  const noRunner = V.buildActions(details, "", null, "oma-zotero-prompt isn't installed: make prompts-install", false, true);
  assert.match(noRunner.find((r) => r.rowId === "setup").detail, /install the AI features/);
  assert.match(noRunner.find((r) => r.rowId === "extract").detail, /Needs the AI features/);
});

test("Defaults and the model picker: grouped by provider; one provider's for Use for prompts and chat", () => {
  const s = state();
  s.settings = S.withValue(s.settings, "defaults.chat.model", "ollama:qwen3:8b");
  const d = S.buildDefaults(s, row);
  assert.deepEqual(d.map((r) => [r.section, r.label]), [["Prompts", "Model"], ["Prompts", "Effort"], ["Chat", "Model"], ["Chat", "Effort"],
    ["The paper's text", "Extract the text first"], ["When a model fails", "Fallback model"], ["When a model fails", "Prompts can name their own model"]]);
  assert.deepEqual([d[4].rowId, d[4].value, /^Off/.test(d[4].detail)], ["set-toggle", "defaults.autoExtract", true]);
  assert.equal(d[0].detail, "ollama:qwen3:8b (automatic)");
  assert.equal(d[2].detail, "ollama:qwen3:8b");
  const pick = S.buildModelPicker(s, "defaults.chat.model", row);
  assert.deepEqual(pick.map((r) => [r.section, r.tag, r.checked]), [["Ollama", "ollama:qwen3:8b", true]]);
  assert.match(pick[0].detail, /41k context · effort levels/);
  const fb = S.buildModelPicker(s, "defaults.fallback", row);
  assert.deepEqual(fb.map((r) => [r.label, r.checked]), [["None", true], ["qwen3:8b", false]]);
  assert.equal(S.modelDetail({ context: 8192, free: true }), "8k context: partial text · free");
});

test("setup checklist: what's wrong says how to fix it, and Enter does it", () => {
  const base = { settings: C.normalizeSettings(null).settings, defaults: {}, info: { keyring: { ok: true }, providers: providers() }, runner: { installed: true }, reqs: { node: "v26.1.0", pdftotext: true } };
  const items = (setup, bridge, extra) => S.setupItems(Object.assign({}, base, { setup, bridge }, extra || {}));
  const up = { zotero: "/usr/bin/zotero", running: true, bind: "ours", rule: true };
  // the plugin missing: download it, with the steps in Zotero
  let it = items(up, { status: "bridge-missing" });
  const bridge = it.find((x) => x.id === "bridge");
  assert.equal(bridge.action, "bridge-install");
  assert.deepEqual(bridge.steps, ["In Zotero: Tools → Plugins", "The ⚙ menu → Install Plugin From File…", "Pick the .xpi in Downloads (its path is on the clipboard: Ctrl+L, then Ctrl+V)"]);
  // an older plugin than the launcher: update it
  it = items(up, { status: "ready", version: "0.1.0", expected: "0.2.0" });
  assert.deepEqual([it.find((x) => x.id === "bridge").label, it.find((x) => x.id === "bridge").action], ["Update the Zotero plugin", "bridge-install"]);
  assert.ok(S.versionLess("0.9.9", "0.10.0") && !S.versionLess("1.0.0", "0.10.0"));
  // the token rejected: restart Zotero
  assert.equal(items(up, { status: "unauthorized" }).find((x) => x.id === "bridge").action, "zotero-start");
  // Zotero down but installed: start it, with the configured command
  const flat = C.normalizeSettings({ zoteroCommand: ["flatpak", "run", "org.zotero.Zotero"] }).settings;
  const z = items(Object.assign({}, up, { running: false, zotero: "" }), { status: "zotero-down" }, { settings: flat })
  assert.deepEqual(z.filter((x) => x.id.indexOf("zotero-") === 0).map((x) => [x.label, x.ok, x.action]), [["Install Zotero", true, ""], ["Start Zotero", undefined, "zotero-start"]]);
  assert.equal(z.find((x) => x.id === "zotero-start").detail, "Enter starts it (flatpak run org.zotero.Zotero)");
  const missing = items(Object.assign({}, up, { running: false, zotero: "" }), { status: "zotero-down" }).filter((x) => x.id.indexOf("zotero-") === 0);
  assert.deepEqual(missing.map((x) => [x.label, x.ok, x.action]), [["Install Zotero", undefined, "zotero-get"], ["Start Zotero", undefined, ""]]);
  assert.match(missing[0].detail, /^Zotero 10: /);
  // SUPER+SHIFT+Z taken by something else: never overwritten, the README says how
  assert.deepEqual(items(Object.assign({}, up, { bind: "taken:Zoom" }), { status: "ready" }).find((x) => x.id === "bind").action, "readme-keys");
  // no model yet: Models & providers
  const none = providers({ ollama: { enabled: false }, lab: { enabled: false } });
  assert.equal(items(up, { status: "ready" }, { info: { keyring: { ok: true }, providers: none } }).find((x) => x.id === "model").action, "settings-providers");
  // the Zotero command setting: its default shown
  assert.equal(S.valueText(S.generalItem("zoteroCommand"), null), "zotero (default)");
});
