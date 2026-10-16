// R13: a catch-up runs prompts and taxonomies only where they're missing (the default) or replaces what's there,
// each its own choice (Settings › Defaults › Bring papers up to date).
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../lib/Client.js");
const S = require("../lib/Settings.js");
const V = require("../lib/Views.js");

test("the two choices: missing by default, replace when chosen, anything else a problem", () => {
  const d = (raw) => C.normalizeSettings({ defaults: raw });
  assert.equal(d({}).settings.defaults.catchUpPrompts, "missing");
  assert.equal(d({}).settings.defaults.catchUpTaxonomies, "missing");
  assert.equal(d({ catchUpPrompts: "replace", catchUpTaxonomies: "replace" }).settings.defaults.catchUpPrompts, "replace");
  assert.match(d({ catchUpPrompts: "always" }).problems.join(" "), /defaults\.catchUpPrompts must be missing or replace/);
  // written only when not the default
  assert.equal(S.toFile(d({}).settings).defaults && S.toFile(d({}).settings).defaults.catchUpPrompts, undefined);
  assert.equal(S.toFile(d({ catchUpTaxonomies: "replace" }).settings).defaults.catchUpTaxonomies, "replace");
});

test("their rows: a choice each under Bring papers up to date, with its two options", () => {
  const settings = C.normalizeSettings({ defaults: { catchUpPrompts: "replace" } }).settings;
  const rows = S.buildDefaults({ settings, defaults: { prompts: "", chat: "" }, extract: { pending: 0, catchup: null, skipped: 0 }, catchUp: { plan: {} } }, V.listRow).filter((r) => r.section === "Bring papers up to date");
  const prompts = rows.find((r) => r.value === "defaults.catchUpPrompts");
  const tax = rows.find((r) => r.value === "defaults.catchUpTaxonomies");
  assert.equal(prompts.rowId, "set-choice");
  assert.match(prompts.detail, /^Replace them/);
  assert.match(tax.detail, /^Only where missing/);
  const opts = S.buildChoice({ settings }, "defaults.catchUpPrompts", V.listRow);
  assert.deepEqual(opts.map((o) => [o.tag, o.checked]), [["missing", false], ["replace", true]]);
});
