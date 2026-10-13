// lib/Fuzzy.js: fzf-style matching for the overlay's local lists (tags, notes).
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../lib/Fuzzy.js");

const rank = (items, q) => F.filter(items, q, [{ get: (t) => t }]).map((r) => r.item);

test("subsequence match, case- and accent-insensitive; no match → null", () => {
  assert.ok(F.match("rsk", "Risk"));
  assert.ok(F.match("mull", "Müller"));
  assert.ok(F.match("MULLER", "müller"));
  assert.equal(F.match("rks", "risk"), null); // order matters
  assert.equal(F.match("zzz", "risk"), null);
});

test("positions index the original string (accents and emoji included)", () => {
  assert.deepEqual(F.match("mu", "Müller").positions, [0, 1]);
  const scan = "⚡ Scan";
  const m = F.match("scan", scan);
  assert.deepEqual(m.positions.map((i) => scan[i]).join(""), "Scan");
});

test("terms are ANDed in any order", () => {
  assert.ok(F.match("keep work", "▶︎ Keep Working"));
  assert.ok(F.match("work keep", "▶︎ Keep Working"));
  assert.equal(F.match("keep zzz", "▶︎ Keep Working"), null);
});

test("ranking: exact and prefix beat word starts, which beat scattered matches; shorter wins ties", () => {
  const tags = ["supply-chain risk management", "risk", "Resilience of risky systems", "brisk walk"];
  assert.deepEqual(rank(tags, "risk").slice(0, 2), ["risk", "supply-chain risk management"]);
  assert.deepEqual(rank(["Scan later", "👓 Skim", "ZotMeta: Skipped"], "sk")[0], "👓 Skim");
  assert.deepEqual(rank(["a big corruption", "corruption"], "corr"), ["corruption", "a big corruption"]);
});

test("a contiguous occurrence at a word start is preferred over an earlier mid-word one", () => {
  const m = F.match("ai", "chain ai");
  assert.deepEqual(m.positions, [6, 7]);
});

test("filter: empty query keeps everything in order; secondary fields match with a lower weight", () => {
  const notes = [{ t: "Scan", x: "resilience" }, { t: "Resilience notes", x: "" }, { t: "Other", x: "nothing" }];
  const fields = [{ get: (n) => n.t }, { get: (n) => n.x, weight: 0.5 }];
  assert.deepEqual(F.filter(notes, "", fields).map((r) => r.item.t), ["Scan", "Resilience notes", "Other"]);
  const r = F.filter(notes, "resil", fields);
  assert.deepEqual(r.map((x) => x.item.t), ["Resilience notes", "Scan"]);
  assert.deepEqual(r[1].positions, []); // matched the excerpt: nothing to highlight in the title
});

test("ranges merge consecutive positions", () => {
  assert.deepEqual(F.ranges([0, 1, 2, 5, 7, 8]), [[0, 3], [5, 6], [7, 9]]);
  assert.deepEqual(F.ranges([]), []);
});
