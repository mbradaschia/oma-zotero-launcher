// OmaCite (zotero-bridge/lib/cite.js): DOI normalisation, BBT-style citekeys and their
// disambiguation, title similarity, and the /lookup and /cite routes against a fake Zotero.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const plain = (x) => JSON.parse(JSON.stringify(x));
const lib = (f) => fs.readFileSync(path.join(__dirname, "../zotero-bridge/lib", f), "utf8");

function omaHttpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

function load(Zotero = {}) {
  const ctx = vm.createContext({ omaHttpError, Zotero, console });
  vm.runInContext(lib("search.js"), ctx);
  vm.runInContext(lib("cite.js"), ctx);
  return ctx;
}

test("normalizeDOI: strips resolver prefixes and trailing punctuation, lowercases; non-DOIs → null", () => {
  const C = load().OmaCite;
  for (const raw of ["10.1007/S13162-021-00213-1", "https://doi.org/10.1007/s13162-021-00213-1", "http://dx.doi.org/10.1007/s13162-021-00213-1.", "doi:10.1007/s13162-021-00213-1", "  DOI: 10.1007/s13162-021-00213-1) "]) {
    assert.equal(C.normalizeDOI(raw), "10.1007/s13162-021-00213-1", raw);
  }
  for (const bad of ["", null, undefined, "not a doi", "11.1000/x", "10.1/x"]) assert.equal(C.normalizeDOI(bad), null, String(bad));
});

test("citekeyBase: <author><year><Word><Word>, skip words left out, first author preferred, ASCII", () => {
  const C = load().OmaCite;
  const authors = [{ lastName: "Ulaga", firstName: "Wolfgang", creatorType: "author" }, { lastName: "Kleinaltenkamp", creatorType: "author" }];
  assert.equal(C.citekeyBase({ creators: authors, year: 2021, title: "Advancing marketing theory and practice: a review" }), "ulaga2021AdvancingMarketing");
  assert.equal(C.citekeyBase({ creators: [{ lastName: "Editor", creatorType: "editor" }, { lastName: "Author", creatorType: "author" }], year: "2020", title: "The complexity and stability of ecosystems" }), "author2020ComplexityStability");
  assert.equal(C.citekeyBase({ creators: [{ name: "WHO" }], year: null, title: "Bare item" }), "whoBareItem");
  assert.equal(C.citekeyBase({ creators: [{ lastName: "Müller-Lüdenscheidt" }], year: 2019, title: "Über die COVID-19 Lage" }), "mullerludenscheidt2019UberCOVID");
  assert.equal(C.citekeyBase({ creators: [], year: 1999, title: "" }), "anon1999");
  assert.equal(C.citekeyBase({ creators: [{ lastName: "李" }], year: 2000, title: "the of and" }), "李2000"); // no ASCII letters: keep the folded name
});

test("suffix: a…z, aa, ab (Better BibTeX order)", () => {
  const C = load().OmaCite;
  assert.deepEqual([0, 1, 25, 26, 27, 52].map(C.suffix), ["a", "b", "z", "aa", "ab", "ba"]);
});

test("assignCitekeys: generated keys get suffixes in dateAdded order; real keys are never touched", () => {
  const C = load().OmaCite;
  const gen = (key, base, dateAdded) => ({ key, citekey: base, citekeyBase: base, citekeySource: "generated", dateAdded });
  const entries = [
    gen("K3", "pimm1984Stability", "2026-03-01 00:00:00"),
    { key: "K1", citekey: "pimm1984Stability", citekeySource: "zotero", citekeyBase: null, dateAdded: "2026-09-01 00:00:00" },
    gen("K2", "pimm1984Stability", "2026-01-01 00:00:00"),
    gen("K4", "other2000Title", "2026-01-01 00:00:00"),
    { key: "K5", citekey: null, citekeySource: null, citekeyBase: null }, // standalone file
  ];
  C.assignCitekeys(entries);
  const by = Object.fromEntries(entries.map((e) => [e.key, e.citekey]));
  assert.deepEqual(by, { K1: "pimm1984Stability", K2: "pimm1984Stabilitya", K3: "pimm1984Stabilityb", K4: "other2000Title", K5: null });
  C.assignCitekeys(entries); // idempotent
  assert.deepEqual(Object.fromEntries(entries.map((e) => [e.key, e.citekey])), by);
});

test("entryFields: Better BibTeX key, else Zotero's citationKey, else generated; DOI normalised; files get nothing", () => {
  const item = (fields, id = 1) => Object.assign({ id, getField: (f) => fields[f] || "" }, {});
  const args = { regular: true, creators: [{ lastName: "Pimm" }], year: 1984, title: "The complexity and stability of ecosystems" };
  let C = load().OmaCite;
  assert.deepEqual(plain(C.entryFields(item({ DOI: "https://doi.org/10.1038/307321A0" }), args)), {
    doi: "10.1038/307321a0", citekey: "pimm1984ComplexityStability", citekeySource: "generated", citekeyBase: "pimm1984ComplexityStability",
  });
  assert.deepEqual(plain(C.entryFields(item({ citationKey: " pinned1984 " }), args)), { doi: null, citekey: "pinned1984", citekeySource: "zotero", citekeyBase: null });
  assert.deepEqual(plain(C.entryFields(item({}), { regular: false })), { doi: null, citekey: null, citekeySource: null, citekeyBase: null });
  C = load({ BetterBibTeX: { KeyManager: { get: (id) => (id === 1 ? { citekey: "bbtKey1984" } : null) } } }).OmaCite;
  assert.equal(C.entryFields(item({ citationKey: "field" }), args).citekeySource, "bbt");
  assert.equal(C.entryFields(item({ citationKey: "field" }, 2), args).citekey, "field"); // BBT has no key for item 2
  C = load({ BetterBibTeX: { KeyManager: { get: () => { throw new Error("not ready"); } } } }).OmaCite;
  assert.equal(C.entryFields(item({}), args).citekeySource, "generated"); // a BBT failure is not fatal
});

test("titleSimilarity: 1 for the same title however punctuated; lower the more the words differ", () => {
  const C = load().OmaCite;
  const t = "Supply Chain Coherence: Building Resilience for an Ever‐Changing World";
  assert.equal(C.titleSimilarity(t, "supply chain coherence — building resilience for an ever-changing world."), 1);
  const near = C.titleSimilarity(t, "Supply chain coherence: building resilience in an ever-changing world");
  const far = C.titleSimilarity(t, "Supply chain coherence");
  const none = C.titleSimilarity(t, "The complexity and stability of ecosystems");
  assert.ok(near > 0.9 && near < 1, String(near));
  assert.ok(far < 0.7, String(far));
  assert.ok(none < 0.3, String(none));
  assert.equal(C.titleSimilarity("", t), 0);
});

// A small library for /lookup and /cite: entries as the index prepares them.
function library(ctx) {
  const S = ctx.OmaSearch;
  const mk = (id, key, title, creators, year, extra = {}) =>
    S.prepareEntry(Object.assign({ id, key, libraryID: 1, itemType: "journalArticle", title, creators, year, dateModified: "2026-01-01 00:00:00", dateAdded: "2026-01-01 00:00:00", tags: [], publication: "", doi: null, citekey: null }, extra));
  return [
    mk(1, "KEY00001", "The complexity and stability of ecosystems", ["Pimm, Stuart L."], 1984, { doi: "10.1038/307321a0", citekey: "pimm1984ComplexityStability" }),
    mk(2, "KEY00002", "Supply Chain Coherence: Building Resilience for an Ever‐Changing World", ["Stevenson, Mark"], 2026, { citekey: "stevenson2026SupplyChain" }),
    mk(3, "KEY00003", "Risk management in global supply chains", ["Müller, Jörg"], 2019, { citekey: "muller2019RiskManagement", doi: "10.1000/risk" }),
    mk(4, "KEY00004", "Risk management in global supply chains", ["Müller, Jörg"], 2020, { citekey: "muller2019RiskManagementa", dateModified: "2026-02-01 00:00:00" }), // a duplicate, edited later
    mk(5, "KEY00005", "Resilience engineering: concepts and precepts", ["Hollnagel, Erik"], 2006, { citekey: "hollnagel2006ResilienceEngineering" }),
    mk(6, "KEY00006", "Resilience engineering: concepts and precepts. Second edition", ["Hollnagel, Erik"], 2012, { citekey: "hollnagel2012ResilienceEngineering" }),
  ];
}

function fakeBridge(ctx, entries, items = {}) {
  return {
    index: { ready: Promise.resolve(), entries, byId: { get: (id) => entries.find((e) => e.id === id) } },
    async _item(key, libraryID) {
      const it = items[key];
      if (!/^[A-Z0-9]{8}$/.test(String(key))) throw omaHttpError(400, "bad-key", "bad key");
      if (!it) throw omaHttpError(404, "not-found", "no item");
      if (it.deleted) throw omaHttpError(409, "trashed", "trashed");
      return it;
    },
  };
}

test("lookup: DOIs, citekeys and keys resolve exactly; unknown ones are listed as unmatched", async () => {
  const note = { key: "NOTE0001", libraryID: 1, deleted: false, isNote: () => true, getNoteTitle: () => "A note", getDisplayTitle: () => "" };
  const trashed = { key: "TRASH001", libraryID: 1, deleted: true, isNote: () => false, getDisplayTitle: () => "gone" };
  const ctx = load({
    Libraries: { userLibraryID: 1, exists: (id) => id === 1 },
    Items: { getByLibraryAndKey: (l, k) => ({ NOTE0001: note, TRASH001: trashed })[k] || false },
  });
  const entries = library(ctx);
  const r = plain(await ctx.OmaCite.lookup.call(fakeBridge(ctx, entries), {
    dois: ["https://doi.org/10.1038/307321A0", "10.9999/nope"],
    citekeys: ["pimm1984ComplexityStability", "MULLER2019riskmanagement", "unknownKey"],
    keys: ["KEY00002", "key00003", "NOTE0001", "TRASH001", "ZZZZZZZZ", "bad"],
  }));
  assert.deepEqual(r.matches.map((m) => [m.query, m.method, m.key, m.score]), [
    ["https://doi.org/10.1038/307321A0", "doi", "KEY00001", 1],
    ["pimm1984ComplexityStability", "citekey", "KEY00001", 1],
    ["MULLER2019riskmanagement", "citekey", "KEY00003", 1], // case-insensitive fallback
    ["KEY00002", "key", "KEY00002", 1],
    ["key00003", "key", "KEY00003", 1],
    ["NOTE0001", "key", "NOTE0001", 1], // not indexed: asked Zotero
  ]);
  assert.deepEqual(r.unmatched, ["10.9999/nope", "unknownKey", "TRASH001", "ZZZZZZZZ", "bad"]);
  assert.equal(r.matches[0].title, "The complexity and stability of ecosystems");
  assert.equal(r.matches[5].title, "A note");
});

test("lookup: titles match exactly (folded), else fuzzily when clearly one item; duplicates resolve to the newest edit", async () => {
  const ctx = load({ Libraries: { userLibraryID: 1, exists: (id) => id === 1 }, Items: { getByLibraryAndKey: () => false } });
  const entries = library(ctx);
  const r = plain(await ctx.OmaCite.lookup.call(fakeBridge(ctx, entries), {
    titles: [
      "the COMPLEXITY and stability of ecosystems.",
      "Supply chain coherence: building resilience in an ever-changing world", // one word off
      "Risk management in global supply chains", // two identical titles: the newer edit
      "Resilience engineering: concepts and precepts (2nd ed.)", // 0.93 vs 0.86 for two items: ambiguous
      "Something else entirely",
      "",
    ],
  }));
  assert.deepEqual(r.matches.map((m) => [m.method, m.key]), [
    ["title-exact", "KEY00001"],
    ["title-fuzzy", "KEY00002"],
    ["title-exact", "KEY00004"],
  ]);
  assert.ok(r.matches[1].score >= 0.8 && r.matches[1].score < 1, String(r.matches[1].score));
  assert.deepEqual(r.unmatched, ["Resilience engineering: concepts and precepts (2nd ed.)", "Something else entirely", ""]);
});

test("lookup: request validation", async () => {
  const ctx = load({ Libraries: { userLibraryID: 1, exists: (id) => id === 1 }, Items: { getByLibraryAndKey: () => false } });
  const L = (data) => ctx.OmaCite.lookup.call(fakeBridge(ctx, library(ctx)), data);
  await assert.rejects(L({}), (e) => e.status === 400 && e.code === "bad-request");
  await assert.rejects(L({ dois: "10.1/x" }), (e) => e.status === 400);
  await assert.rejects(L({ keys: [42] }), (e) => e.status === 400);
  await assert.rejects(L({ keys: Array(201).fill("KEY00001") }), (e) => e.status === 400 && e.code === "too-many");
  await assert.rejects(L({ keys: ["KEY00001"], libraryID: 7 }), (e) => e.status === 400 && e.code === "bad-library");
  assert.equal((await L({ keys: ["KEY00001"], libraryID: "1" })).matches.length, 1);
});

test("styleID: short names map to zotero.org styles, URLs pass through, junk is refused", () => {
  const C = load().OmaCite;
  assert.equal(C.styleID("apa"), "http://www.zotero.org/styles/apa");
  assert.equal(C.styleID("Chicago-Author-Date"), "http://www.zotero.org/styles/chicago-author-date");
  assert.equal(C.styleID("http://www.zotero.org/styles/ieee"), "http://www.zotero.org/styles/ieee");
  assert.equal(C.styleID(undefined), C.DEFAULT_STYLE);
  assert.equal(C.styleID("../etc"), null);
});

// A fake CSL engine: bibliography entries are "<creator> (<year>). <title>.", citations "(<creator>, <year>)".
function citeSetup() {
  const items = {};
  const mk = (id, key, itemType, creator, year, title) => (items[key] = { id, key, libraryID: 1, itemType, creator, year, title, isRegularItem: () => itemType !== "note" && itemType !== "attachment" });
  mk(1, "KEY00001", "journalArticle", "Pimm", 1984, "The complexity and stability of ecosystems");
  mk(2, "KEY00002", "book", "Stevenson", 2026, "Supply Chain Coherence");
  mk(9, "NOTE0009", "note", "", "", "");
  const byId = (id) => Object.values(items).find((i) => i.id === id);
  const freed = [];
  const engine = (format) => ({
    format,
    setOutputFormat(f) { this.format = f; },
    updateItems() {},
    previewCitationCluster(citation, pre, post, fmt) {
      return `(${citation.citationItems.map((c) => `${byId(c.id).creator}, ${byId(c.id).year}`).join("; ")})`;
    },
    free() { freed.push(this.format); },
  });
  const Zotero = {
    logError() {},
    Styles: { get: (id) => (id === "http://www.zotero.org/styles/apa" ? { title: "American Psychological Association 7th edition", getCiteProc: (locale, format) => engine(format) } : false) },
    Cite: {
      makeFormattedBibliographyOrCitationList(eng, list, format, asCitation) {
        const entry = (i) => (asCitation ? `(${i.creator}, ${i.year})` : `${i.creator} (${i.year}). ${i.title}.`);
        const wrap = (s) => (format === "html" ? `<div class="csl-entry">${s}</div>` : s);
        return list.map((i) => wrap(entry(i))).join("\r\n") + "\r\n";
      },
    },
  };
  const ctx = load(Zotero);
  const entries = [ctx.OmaSearch.prepareEntry({ id: 1, key: "KEY00001", libraryID: 1, title: items.KEY00001.title, creators: ["Pimm"], year: 1984, citekey: "pimm1984ComplexityStability" })];
  return { ctx, bridge: fakeBridge(ctx, entries, items), freed };
}

test("cite: bibliography mode gives per-item entries (with citekeys) and the whole list; the engine is freed", async () => {
  const { ctx, bridge, freed } = citeSetup();
  const r = plain(await ctx.OmaCite.cite.call(bridge, { keys: ["KEY00001", "KEY00002", "KEY00001"] }));
  assert.equal(r.style, "http://www.zotero.org/styles/apa");
  assert.equal(r.styleTitle, "American Psychological Association 7th edition");
  assert.deepEqual([r.locale, r.mode, r.format, r.citation], ["en-US", "bibliography", "text", null]);
  assert.deepEqual(r.entries, [
    { key: "KEY00001", libraryID: 1, citekey: "pimm1984ComplexityStability", text: "Pimm (1984). The complexity and stability of ecosystems." },
    { key: "KEY00002", libraryID: 1, citekey: null, text: "Stevenson (2026). Supply Chain Coherence." },
  ]);
  assert.equal(r.bibliography, "Pimm (1984). The complexity and stability of ecosystems.\nStevenson (2026). Supply Chain Coherence.");
  assert.deepEqual(freed, ["text"]);
});

test("cite: citation mode gives in-text citations and one cluster for all items; html format", async () => {
  const { ctx, bridge } = citeSetup();
  const r = plain(await ctx.OmaCite.cite.call(bridge, { keys: ["KEY00001", "KEY00002"], style: "apa", mode: "citation", format: "html", locale: "de-DE" }));
  assert.deepEqual(r.entries.map((e) => e.text), ['<div class="csl-entry">(Pimm, 1984)</div>', '<div class="csl-entry">(Stevenson, 2026)</div>']);
  assert.equal(r.citation, "(Pimm, 1984; Stevenson, 2026)");
  assert.equal(r.bibliography, null);
  assert.equal(r.locale, "de-DE");
});

test("cite: bad requests → 400 with a code; item errors pass through; the engine is freed after a failure too", async () => {
  const { ctx, bridge, freed } = citeSetup();
  const cite = (data) => ctx.OmaCite.cite.call(bridge, data);
  const code = async (data, status, c) => assert.rejects(cite(data), (e) => e.status === status && e.code === c, `${c}: ${JSON.stringify(data)}`);
  await code({}, 400, "bad-keys");
  await code({ keys: [] }, 400, "bad-keys");
  await code({ keys: Array(51).fill("KEY00001") }, 400, "bad-keys");
  await code({ keys: ["KEY00001"], mode: "footnote" }, 400, "bad-mode");
  await code({ keys: ["KEY00001"], format: "rtf" }, 400, "bad-format");
  await code({ keys: ["KEY00001"], locale: "en_US!" }, 400, "bad-locale");
  await code({ keys: ["KEY00001"], style: "nature" }, 400, "bad-style");
  await code({ keys: ["KEY00001"], style: "../x" }, 400, "bad-style");
  await code({ keys: ["NOTE0009"] }, 400, "not-citable");
  await code({ keys: ["ZZZZZZZZ"] }, 404, "not-found");
  await code({ keys: ["nope"] }, 400, "bad-key");
  assert.deepEqual(freed, []); // nothing formatted so far
  ctx.Zotero.Cite.makeFormattedBibliographyOrCitationList = () => { throw new Error("csl exploded"); };
  await assert.rejects(cite({ keys: ["KEY00001"] }), /csl exploded/);
  assert.deepEqual(freed, ["text"]);
});

test("styles: the installed styles by title, Zotero's own by their short name; not ready → 503", async () => {
  const visible = [
    { styleID: "http://www.zotero.org/styles/chicago-author-date", title: "Chicago Manual of Style 17th edition (author-date)" },
    { styleID: "http://www.zotero.org/styles/apa", title: "American Psychological Association 7th edition" },
    { styleID: "https://example.edu/styles/house", title: "Our house style" },
    { title: "No ID" },
  ];
  const ctx = load({ Styles: { getVisible: () => visible } });
  const r = plain(await ctx.OmaCite.styles());
  assert.deepEqual(r.styles, [
    { id: "apa", title: "American Psychological Association 7th edition" },
    { id: "chicago-author-date", title: "Chicago Manual of Style 17th edition (author-date)" },
    { id: "https://example.edu/styles/house", title: "Our house style" },
  ]);
  assert.equal(r.default, "apa");
  const down = load({ Styles: { getVisible: () => { throw new Error("not initialized"); } } });
  await assert.rejects(down.OmaCite.styles(), (e) => e.status === 503 && e.code === "styles-not-ready");
});
