// The context bar above the search box (lib/Views.js): what it names, and what the empty search box says.
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../lib/Views.js");

test("the bar names the level; the search box keeps only the hint to type", () => {
  assert.equal(V.contextLabel("‹ Tasks · type one to add it (#status !priority @due), or to find one"), "Tasks");
  assert.equal(V.contextLabel("‹ Settings › Models & providers"), "Settings › Models & providers");
  assert.equal(V.typeHint("‹ Tasks · type one to add it, or to find one", false), "Type one to add it, or to find one");
  assert.equal(V.typeHint("‹ Tags · type to find or create one", false), "Type to find or create one");
  assert.equal(V.typeHint("‹ Settings › General", false), "Type to filter");
  assert.equal(V.typeHint("‹ Notes · Managing Firm Resources", false), "Type to filter"); // a title, not a hint
  assert.equal(V.typeHint("‹ Rename the prompt", true), "Type it");
  assert.equal(V.typeHint("‹ Name it (↵ names it after the search)", true), "Type it");
  assert.equal(V.scopeCount(12), "12 papers");
  assert.equal(V.scopeCount(1), "1 paper");
  assert.equal(V.scopeCount(1234), "1,234 papers");
  assert.equal(V.scopeCount(undefined), "");
});
