// OmaRankings (zotero-bridge/lib/rankings.js) against the shipped AJG 2024 / FT50 / UTD24 data.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const lib = (f) => fs.readFileSync(path.join(__dirname, "../zotero-bridge/lib", f), "utf8");
const ctx = vm.createContext({});
vm.runInContext(lib("rankingsData.js"), ctx);
vm.runInContext(lib("rankings.js") + "\nthis.OmaRankings = OmaRankings;", ctx);
const R = ctx.OmaRankings;
const plain = (x) => JSON.parse(JSON.stringify(x));

test("the data: AJG 2024 ratings, 50 FT50 and 24 UTD24 journals", () => {
  const d = ctx.OMA_RANKINGS_DATA;
  assert.ok(d.ajg.length > 1700);
  assert.equal(d.ft50.length, 50);
  assert.equal(d.utd24.length, 24);
  for (const r of d.ajg) assert.match(r[4], /^(1|2|3|4|4\*)$/, r[2]);
});

test("lookup: by ISSN, by title, FT50/UTD24 through the AJG's ISSNs", () => {
  // Academy of Management Review: ISSN only, then title only, then a variant title with its ISSN
  const amr = { ajg: "4*", field: "ETHICS-CSR-MAN", ft50: true, utd24: true };
  const amrRank = plain(R.lookup({ publication: "Academy of Management Review" }));
  assert.equal(amrRank.ajg, "4*");
  assert.deepEqual([amrRank.ft50, amrRank.utd24], [true, true]);
  const issn = ctx.OMA_RANKINGS_DATA.ajg.find((r) => r[2] === "Academy of Management Review")[0];
  assert.deepEqual(plain(R.lookup({ issn, publication: "Acad. Manage. Rev." })), plain(R.lookup({ publication: "Academy of Management Review" })));
  assert.deepEqual(plain(R.labels(amrRank)), ["ABS 4*", "FT50", "UTD24"]);
  void amr;
  // "&" vs "and", a leading "The", case and punctuation
  const smj = plain(R.lookup({ publication: "strategic management journal" }));
  assert.equal(smj.ajg, "4*");
  assert.equal(plain(R.lookup({ publication: "The Accounting Review" })).ajg, "4*");
  assert.equal(R.lookup({ publication: "Journal of Nothing In Particular" }), null);
  assert.equal(R.lookup({}), null);
});

test("normISSN / issns / normTitle", () => {
  assert.equal(R.normISSN("00014826"), "0001-4826");
  assert.equal(R.normISSN("0001-482x"), "0001-482X");
  assert.equal(R.normISSN("12345"), "");
  assert.deepEqual(plain(R.issns("0001-4826, 1558-7967")), ["0001-4826", "1558-7967"]);
  assert.equal(R.normTitle("The Journal of Finance & Économie:"), "journal of finance and economie");
  assert.deepEqual(plain(R.labels(null)), []);
  assert.deepEqual(plain(R.labels({ ajg: "3", ft50: false, utd24: false })), ["ABS 3"]);
});
