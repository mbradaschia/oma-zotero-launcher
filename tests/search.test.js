const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../zotero-bridge/lib/search.js");

function entry(id, title, creators, year, extra = {}) {
  return S.prepareEntry(Object.assign({}, extra, { id, key: "K" + id, title, creators, year, dateModified: extra.dateModified || "2026-01-01 00:00:00", tags: extra.tags || [], publication: extra.publication || "" }));
}

const LIB = [
  entry(1, "The complexity and stability of ecosystems", ["Pimm, Stuart L."], 1984, { tags: ["ecology"] }),
  entry(2, "Supply Chain Coherence: Building Resilience for an Ever‐Changing World", ["Stevenson, Mark", "Rivera, Lina"], 2026, { tags: ["resilience", "sc"] }),
  entry(3, "Risk management in global supply chains", ["Müller, Jörg"], 2019, { tags: ["risk"] }),
  entry(4, "Über die Gölgeci-Methode der Netzwerkanalyse", ["Gölgeci, Ismail"], 2021),
  entry(5, "Resilience engineering: concepts and precepts", ["Hollnagel, Erik", "Woods, David D."], 2006, { tags: ["resilience"] }),
  entry(6, "COVID-19 and 2020 supply disruptions", ["Ivanov, Dmitry"], 2021, { tags: ["risk", "covid"] }),
];

const top = (q, opts) => S.search(LIB, q, opts).results.map((r) => r.entry.id);

test("fold strips diacritics and lowercases", () => {
  assert.equal(S.fold("Müller Ångström Gölgeci"), "muller angstrom golgeci");
  assert.equal(S.fold("ASCII Only"), "ascii only");
});

test("foldWithMap keeps offsets aligned with the original string", () => {
  const { text, map } = S.foldWithMap("Café Ölé");
  assert.equal(text, "cafe ole");
  assert.equal(map.length, text.length);
  assert.equal(map[3], 3); // é → e
  assert.equal(map[5], 5); // Ö → o
  assert.equal(S.foldWithMap("plain").map, null);
});

test("parseQuery: kinds, fields, years, OR groups", () => {
  const q = S.parseQuery("'exact ^pre suf$ !neg a:smith t:chain y:2019..2021 #risk 2020 foo | bar x|y");
  const flat = q.groups.map((g) => g.map((t) => [t.field, t.kind, t.negate, t.value ?? ""].join(":")));
  assert.deepEqual(flat, [
    [":exact:false:exact"],
    [":prefix:false:pre"],
    [":suffix:false:suf"],
    [":exact:true:neg"],
    ["creators:fuzzy:false:smith"],
    ["title:fuzzy:false:chain"],
    ["year:year:false:2019..2021"],
    ["tag:fuzzy:false:risk"],
    ["year:year:false:2020"],
    [":fuzzy:false:foo", ":fuzzy:false:bar"],
    [":fuzzy:false:x", ":fuzzy:false:y"],
  ]);
  const yr = q.groups[6][0];
  assert.equal(yr.from, 2019);
  assert.equal(yr.to, 2021);
  assert.equal(S.parseQuery("   ").groups.length, 0);
});

test("fuzzy ranking by title, author and year", () => {
  assert.equal(top("pimm 1984")[0], 1);
  assert.equal(top("stev resil")[0], 2);
  assert.equal(top("complexity ecosys")[0], 1);
  assert.equal(top("muller")[0], 3);
  assert.equal(top("golgeci")[0], 4);
  assert.equal(top("hollnagel resilience")[0], 5);
  assert.equal(top("rslnc")[0] === 2 || top("rslnc")[0] === 5, true);
});

test("field qualifiers, tags, negation, year ranges", () => {
  assert.deepEqual(top("a:pimm"), [1]);
  assert.deepEqual(top("t:pimm"), []);
  assert.deepEqual(top("#resilience").sort(), [2, 5]);
  assert.deepEqual(top("supply !risk").sort(), [2, 6]); // #3 has "risk" in its title; #6 is only tagged risk
  assert.deepEqual(top("supply !#risk"), [2]);
  assert.deepEqual(top("y:2019..2021").sort(), [3, 4, 6]);
  assert.deepEqual(top("y:..1990"), [1]);
  // compared: >, <, =, >=, <= are ranges too
  for (const [op, range] of [["y:>=2019", "y:2019.."], ["y:>2018", "y:2019.."], ["y:<1991", "y:..1990"], ["y:<=1990", "y:..1990"], ["y:=2020", "y:2020"]]) {
    assert.deepEqual(top(op).sort(), top(range).sort(), op);
  }
  assert.deepEqual(top("y:<=1990"), [1]);
  assert.equal(S.parseTerm("y:>=x"), null);
  assert.deepEqual(top("'supply chain").sort(), [2, 3]);
  assert.deepEqual(top("^risk"), [3]);
  assert.deepEqual(top("pimm | hollnagel").sort(), [1, 5]);
});

test("bare year matches year strongly, title weakly", () => {
  const ids = top("2020");
  assert.deepEqual(ids, [6]); // only in title of #6; no item has year 2020
  assert.equal(top("2021")[0] === 4 || top("2021")[0] === 6, true);
});

test("first author outranks co-authors for the same match", () => {
  const lib = [
    entry(20, "Thinking differently about supply chain resilience", ["Wieland, Andreas", "Stevenson, Mark"], 2023, { dateModified: "2026-09-01 00:00:00" }),
    entry(21, "Supply chain coherence: building resilience", ["Stevenson, Mark", "Rivera, Lina"], 2026, { dateModified: "2020-01-01 00:00:00" }),
  ];
  assert.equal(S.search(lib, "stev resil").results[0].entry.id, 21);
  assert.equal(S.search(lib, "a:stevenson").results[0].entry.id, 21);
  assert.equal(S.search(lib, "a:^stevenson").results[0].entry.id, 21);
  // a later co-author still matches
  assert.deepEqual(S.search(lib, "a:wieland").results.map((r) => r.entry.id), [20]);
});

test("open items win ties", () => {
  const twins = [entry(10, "Same title", ["A, B"], 2000), entry(11, "Same title", ["A, B"], 2000)];
  const r = S.search(twins, "same", { openRank: new Map([[11, 0]]) }).results;
  assert.equal(r[0].entry.id, 11);
  assert.equal(r[0].openRank, 0);
});

test("title ranges map back to the original (accented) title", () => {
  const [hit] = S.search(LIB, "golg").results;
  assert.equal(hit.entry.id, 4);
  const [s, e] = hit.titleRanges[0];
  assert.equal(hit.entry.title.slice(s, e), "Gölg");
  const [h2] = S.search(LIB, "resil").results;
  const [s2, e2] = h2.titleRanges[0];
  assert.equal(h2.entry.title.slice(s2, e2).toLowerCase(), "resil");
});

function synthetic(n) {
  const words = ["supply", "chain", "resilience", "risk", "complexity", "ecosystem", "network", "global", "stability", "disruption", "adaptive", "theory"];
  const names = ["Stevenson, Mark", "Pimm, Stuart", "Hollnagel, Erik", "Müller, Jörg", "Ivanov, Dmitry", "Sheffi, Yossi", "Resilio, Ana"];
  const tagPool = ["resilience", "risk", "sc", "ecology", "method"];
  const out = [];
  for (let i = 0; i < n; i++) {
    const title = Array.from({ length: 4 + (i % 7) }, (_, k) => words[(i * 5 + k * 7) % words.length]).join(" ");
    const creators = [names[i % names.length], names[(i * 3 + 1) % names.length]];
    const tags = [tagPool[i % tagPool.length]];
    out.push(entry(1000 + i, title, creators, 1970 + (i % 55), { tags, dateModified: `2025-01-${String(1 + (i % 28)).padStart(2, "0")} 00:00:00` }));
  }
  return out;
}

test("canNarrow: extensions narrow, structural changes don't", () => {
  const n = (a, b) => S.canNarrow(S.parseQuery(a), S.parseQuery(b));
  assert.equal(n("stev", "steve"), true);
  assert.equal(n("stev", "stev res"), true);
  assert.equal(n("stev res", "stev resil"), true);
  assert.equal(n("stev ", "stev r"), true);
  assert.equal(n("'sup", "'supp"), true);
  assert.equal(n("#res", "#resil"), true);
  assert.equal(n("stev", "stev !x"), true); // an added AND group (even negated) narrows
  assert.equal(n("!ris", "!risk"), false); // extending a negation widens
  assert.equal(n("a", "a:iv"), false); // qualifier changes the field
  assert.equal(n("201", "2019"), false); // becomes a year term
  assert.equal(n("ab", "ab$"), false); // becomes a suffix term
  assert.equal(n("pimm", "pimm | holl"), false); // OR widens
  assert.equal(n("stev resil", "stev"), false); // deleting widens
  assert.equal(n("stev", "stav"), false);
  assert.equal(n("", "a"), false);
});

test("narrowed search returns exactly the full-search results while typing", () => {
  const corpus = [...LIB, ...synthetic(800)];
  for (const q of ["stev resil", "supply chain risk", "complexity ecosys", "#resil sup", "a:holl res", "muller !risk", "y:1990..2000 sta"]) {
    let prev = null;
    for (let i = 1; i <= q.length; i++) {
      const query = q.slice(0, i);
      const parsed = S.parseQuery(query);
      const full = S.search(corpus, parsed, { limit: 20 });
      const candidates = prev && S.canNarrow(prev.parsed, parsed) ? prev.matched : corpus;
      const narrowed = S.search(candidates, parsed, { limit: 20, collectMatches: true });
      assert.deepEqual(narrowed.results.map((r) => r.entry.id), full.results.map((r) => r.entry.id), `results for "${query}"`);
      assert.equal(narrowed.total, full.total, `total for "${query}"`);
      prev = parsed.groups.length ? narrowed : null;
    }
  }
});

test("performance sanity: 3k entries under 50 ms per query in V8", () => {
  const words = ["supply", "chain", "resilience", "complexity", "network", "risk", "global", "model", "theory", "evidence"];
  const big = [];
  for (let i = 0; i < 3000; i++) {
    const t = Array.from({ length: 10 }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(" ");
    big.push(entry(i, t, ["Author" + (i % 97) + ", X."], 1950 + (i % 77)));
  }
  for (const q of ["s", "sup res", "author12 2001", "zzqx"]) {
    const t0 = performance.now();
    S.search(big, q);
    assert.ok(performance.now() - t0 < 50, `query ${q} too slow`);
  }
});

test("typing a title: the title holding the words as a phrase ranks first, the whole title highest", () => {
  const lib = [
    entry(1, "Understanding and overcoming barriers to digital health adoption: a study of clinicians", ["Aa, A."], 2024, { dateModified: "2026-09-01 00:00:00" }),
    entry(2, "Bridging digital health gaps in South Africa: a qualitative study", ["Bb, B."], 2025, { dateModified: "2026-09-02 00:00:00" }),
    entry(3, "Digital Health Study", ["Cc, C."], 2020, { dateModified: "2020-01-01 00:00:00" }),
    entry(4, "A digital health study of rural clinics", ["Dd, D."], 2022, { dateModified: "2021-01-01 00:00:00" }),
  ];
  const ids = (q) => S.search(lib, q).results.map((r) => r.entry.id);
  assert.deepEqual(ids("digital health study").slice(0, 2), [3, 4]); // exact title, then the title containing the phrase
  assert.deepEqual(ids("Digital Health Study"), ids("digital health study"));
  assert.equal(S.titlePhrase(S.parseQuery("a:smith digital 2020 !x health")), "digital health");
  assert.equal(S.titlePhrase(S.parseQuery("digital | health")), "");
  // one- and two-letter queries rank on term scores alone
  assert.equal(S.titlePhrase(S.parseQuery("su")), "su");
});

// ---------------------------------------------------------------- boolean queries, quotes, filters

const idsOf = (q, lib = LIB) => S.search(lib, q).results.map((r) => r.entry.id).sort((a, b) => a - b);

test("tokenize: quoted strings keep their spaces, parentheses stand alone", () => {
  assert.deepEqual(S.tokenize('(#"supply chain" OR a:"Smith, J") NOT risk'), ["(", '#"supply chain"', "OR", 'a:"Smith, J"', ")", "NOT", "risk"]);
  assert.deepEqual(S.tokenize('t:"unclosed quote'), ['t:"unclosed quote']);
});

test("AND, OR, NOT and parentheses", () => {
  assert.deepEqual(idsOf("pimm OR hollnagel"), [1, 5]);
  assert.deepEqual(idsOf("supply AND #risk"), [3, 6]);
  assert.deepEqual(idsOf("supply NOT #risk"), [2]);
  assert.deepEqual(idsOf("(#resilience OR #ecology) NOT y:2006"), [1, 2]);
  assert.deepEqual(idsOf("NOT (#risk OR #resilience)"), [1, 4]);
  // OR binds loosest: a OR b c = a OR (b AND c)
  assert.deepEqual(idsOf("pimm OR supply #covid"), [1, 6]);
  // | binds tightest: a | b c = (a OR b) AND c
  assert.deepEqual(idsOf("pimm | supply #covid"), [6]);
  // lowercase and/or/not are words to search for
  assert.equal(S.parseQuery("risk and management").groups.length, 3);
});

test("simple queries keep the AND-groups fast path; boolean ones become a tree", () => {
  const simple = S.parseQuery("foo | bar !x");
  assert.equal(simple.expr, null);
  assert.equal(simple.groups.length, 2);
  // NOT on one term is !term (an exact negation)
  const not = S.parseQuery("supply NOT risk");
  assert.equal(not.expr, null);
  assert.deepEqual([not.groups[1][0].negate, not.groups[1][0].kind], [true, "exact"]);
  // a plain AND is the same as juxtaposition
  assert.equal(S.parseQuery("supply AND risk").groups.length, 2);
  // OR across ANDs, NOT over a group: a tree
  assert.ok(S.parseQuery("a OR b c").expr);
  assert.ok(S.parseQuery("NOT (a b)").expr);
  assert.equal(S.titlePhrase(S.parseQuery("a OR b c")), "");
});

test("half-typed queries parse leniently", () => {
  assert.deepEqual(idsOf("(pimm OR hollnagel"), [1, 5]); // no ")"
  assert.deepEqual(idsOf("pimm)"), [1]); // a stray ")"
  assert.deepEqual(idsOf("pimm OR"), [1]); // an operator with nothing after it
  assert.deepEqual(idsOf("pimm NOT"), [1]);
  assert.deepEqual(idsOf("AND pimm"), [1]);
  assert.ok(S.isEmpty(S.parseQuery("( )")));
  assert.ok(S.isEmpty(S.parseQuery("NOT")));
});

test("quotes: an exact phrase; a whole tag, author or publication name", () => {
  const lib = [
    entry(1, "Supply chain risk", ["Smith, John"], 2020, { tags: ["supply chain", "risk"], publication: "Journal of Operations Management" }),
    entry(2, "Chain supply", ["Smith, Johnny"], 2021, { tags: ["supply chain management"], publication: "Journal of Operations" }),
  ];
  assert.deepEqual(idsOf('"supply chain"', lib), [1]);
  assert.deepEqual(idsOf('#"supply chain"', lib), [1]); // not "supply chain management"
  assert.deepEqual(idsOf('tag:"supply chain"', lib), [1]);
  assert.deepEqual(idsOf("#supply", lib), [1, 2]);
  assert.deepEqual(idsOf('a:"Smith, John"', lib), [1]);
  assert.deepEqual(idsOf('p:"journal of operations"', lib), [2]);
  assert.deepEqual(idsOf("journal:operations", lib), [1, 2]);
  assert.deepEqual(idsOf('!#"supply chain"', lib), [2]);
  // a quoted year is text, not a year
  assert.equal(S.parseQuery('"2020"').groups[0][0].kind, "exact");
});

test("type: and has: filters", () => {
  const lib = [
    entry(1, "A book", ["A, A"], 2000, { itemType: "book", pdfCount: 1, noteCount: 0 }),
    entry(2, "A chapter", ["B, B"], 2001, { itemType: "bookSection", pdfCount: 0, noteCount: 2, attachmentCount: 1 }),
    entry(3, "An article", ["C, C"], 2002, { itemType: "journalArticle", pdfCount: 0, noteCount: 0, attachmentCount: 0 }),
  ];
  assert.deepEqual(idsOf("type:book", lib), [1, 2]); // a prefix
  assert.deepEqual(idsOf('type:"book"', lib), [1]); // the type
  assert.deepEqual(idsOf("type:journal", lib), [3]);
  assert.deepEqual(idsOf("has:pdf", lib), [1]);
  assert.deepEqual(idsOf("has:n", lib), [2]); // a prefix of notes
  assert.deepEqual(idsOf("has:files", lib), [1, 2]);
  assert.deepEqual(idsOf("!has:pdf", lib), [2, 3]);
  assert.equal(S.parseTerm("has:xyz"), null);
});

test("c: matches the papers the bridge resolved (term.ids); never narrowed", () => {
  const parsed = S.parseQuery("c:scm supply");
  const [col] = S.terms(parsed).filter((t) => t.field === "collection");
  assert.equal(S.search(LIB, parsed).total, 0); // not resolved: nothing
  col.ids = new Set([2, 3]);
  assert.deepEqual(idsOf(parsed), [2, 3]);
  assert.equal(S.canNarrow(S.parseQuery("c:scm"), S.parseQuery("c:scm s")), false);
  // a collection entry matches on its path: words anywhere, or quoted the whole path or name
  const colEntry = S.prepareEntry({ kind: "collection", id: 9, name: "SCM", title: "_Topics / SCM", creators: [], tags: [] });
  assert.ok(S.collectionMatch(colEntry, S.parseTerm("c:topics")));
  assert.ok(S.collectionMatch(colEntry, S.parseTerm('c:"_Topics / SCM"')));
  assert.ok(S.collectionMatch(colEntry, S.parseTerm('c:"scm"')));
  assert.equal(S.collectionMatch(colEntry, S.parseTerm('c:"topics"')), null);
});

test("combine: a saved search and what is typed within it", () => {
  const both = S.combine(S.parseQuery("#resilience OR #ecology"), S.parseQuery("hollnagel"));
  assert.deepEqual(idsOf(both), [5]);
  const flat = S.combine(S.parseQuery("#risk"), S.parseQuery("supply"));
  assert.equal(flat.expr, null); // still the fast path
  assert.deepEqual(idsOf(flat), [3, 6]);
  assert.deepEqual(idsOf(S.combine(S.parseQuery("#risk"), S.parseQuery(""))), [3, 6]);
  // what is typed can't escape the saved search with parentheses
  assert.deepEqual(idsOf(S.combine(S.parseQuery("#ecology"), S.parseQuery("x) OR (pimm"))), [1]);
});

test("highlights come from positive terms only, in trees too", () => {
  const [hit] = S.search(LIB, "(ecosys OR zzz) NOT risk").results;
  assert.equal(hit.entry.id, 1);
  assert.ok(hit.titleRanges.length > 0);
  assert.equal(S.search(LIB, "pimm NOT (complexity OR x)").total, 0);
});

test("ab: and ta: search abstracts (as written, not fuzzy), ta: titles too", () => {
  const lib = [
    entry(1, "Dynamic capabilities", ["Teece, David"], 1997, { abstract: "How firms achieve competitive advantage in rapidly changing environments." }),
    entry(2, "Competitive advantage", ["Porter, Michael"], 1985, { abstract: "Value chain analysis." }),
    entry(3, "Resource slack", ["Essuman, Dominic"], 2020, { abstract: "" }),
  ];
  const ids = (q) => S.search(lib, q).results.map((r) => r.entry.id).sort();
  assert.deepEqual(ids("ab:environments"), [1]);
  assert.deepEqual(ids("ab:competitive"), [1]); // not #2's title
  assert.deepEqual(ids('ta:"competitive advantage"'), [1, 2]); // #1's abstract, #2's title
  assert.deepEqual(ids("ab:vca"), []); // scattered letters don't match in an abstract
  assert.deepEqual(ids('ta:""'), []); // nothing typed yet: no term
  assert.equal(lib[0].abstract, undefined); // only the folded text is kept
});


test("inside a saved search, only what you typed is highlighted (not the saved search's own terms)", () => {
  const lib = [entry(30, "Supply chain resilience and risk", ["A, B"], 2020), entry(31, "Supply chain finance", ["C, D"], 2021)];
  const both = S.combine(S.parseQuery("supply"), S.parseQuery("resil"));
  const [hit] = S.search(lib, both, { highlight: S.parseQuery("resil") }).results;
  assert.equal(hit.entry.id, 30);
  assert.deepEqual(hit.titleRanges.map(([s, e]) => hit.entry.title.slice(s, e).toLowerCase()), ["resil"]);
  // nothing typed: nothing highlighted
  assert.ok(S.search(lib, S.parseQuery("supply"), { highlight: "" }).results.every((h) => h.titleRanges.length === 0));
  // no highlight option: the query searched, as before
  assert.ok(S.search(lib, "supply").results.every((h) => h.titleRanges.length > 0));
});

test("added:, modified:, recent:: the last N days, after, before, between, a year or a month", () => {
  S.setNow(() => new Date("2026-10-03T12:00:00Z"));
  try {
    const lib = [
      entry(40, "Fresh", ["A"], 2026, { dateAdded: "2026-10-01 09:00:00", dateModified: "2026-10-02 09:00:00" }),
      entry(41, "Spring", ["B"], 2026, { dateAdded: "2026-04-15 09:00:00", dateModified: "2026-09-30 09:00:00" }),
      entry(42, "Old", ["C"], 2019, { dateAdded: "2019-03-01 09:00:00", dateModified: "2020-01-01 09:00:00" })];
    const ids = (q) => S.search(lib, q).results.map((r) => r.entry.id).sort();
    assert.deepEqual(ids("added:7d"), [40]);
    assert.deepEqual(ids("modified:7d"), [40, 41]); // changed lately, though added in the spring
    assert.deepEqual(ids("recent:7d"), [40, 41]);
    assert.deepEqual(ids("added:>2026-01-01"), [40, 41]);
    assert.deepEqual(ids("added:<2026"), [42]);
    assert.deepEqual(ids("added:2026-04"), [41]);
    assert.deepEqual(ids("added:2026-04-01..2026-06-30"), [41]);
    assert.deepEqual(ids("added:..2020"), [42]);
    assert.deepEqual(ids("added:today"), []);
    assert.deepEqual(ids("!added:1y"), [42]);
    assert.deepEqual(ids("spring added:2026"), [41]); // with words
    assert.equal(S.parseTerm("added:soon"), null); // not a date: nothing
    assert.deepEqual(S.search(lib, "added:7d").results[0].titleRanges, []); // nothing in the title
    assert.deepEqual(S.parseDate("2w"), { from: "2026-09-20", to: "2026-10-03" });
    assert.deepEqual(S.parseDate(">2026-02"), { from: "2026-03-01", to: "" });
  } finally {
    S.setNow(null);
  }
});
