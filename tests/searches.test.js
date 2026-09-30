// Saved searches and the @ picker in the launcher (lib/Views.js): the searches file, edits, the
// badges' order, the rows of the Searches view, its menu and the picker, and inserting a term.
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../lib/Views.js");
const Fuzzy = require("../lib/Fuzzy.js");

const S1 = { id: "s1", name: "Risk", query: "#risk", pinned: true };
const S2 = { id: "s2", name: "Old SCM", query: "c:scm y:..2010", pinned: false };
const S3 = { id: "s3", name: "Methods", query: "t:method OR t:methods", pinned: true };
const LIST = [S1, S2, S3];

test("parseSearches: valid entries in order; bad ids, duplicates and empty queries dropped", () => {
  const text = JSON.stringify({ searches: [
    { id: "s1", name: " Risk ", query: " #risk ", pinned: true },
    { id: "s1", name: "dup", query: "x" },
    { id: "BAD ID", name: "x", query: "x" },
    { id: "s2", name: "", query: "c:scm" },
    { id: "s3", query: "  " },
    null,
  ] });
  assert.deepEqual(V.parseSearches(text), [
    { id: "s1", name: "Risk", query: "#risk", pinned: true },
    { id: "s2", name: "c:scm", query: "c:scm", pinned: false }, // no name: named after its search
  ]);
  assert.deepEqual(V.parseSearches("not json"), []);
  assert.deepEqual(V.parseSearches(""), []);
});

test("add, find, update, remove, move", () => {
  const { list, search } = V.addSearch(LIST, "", "  a:smith  ", true, 36 ** 3);
  assert.equal(list.length, 4);
  assert.deepEqual(search, { id: "s1000", name: "a:smith", query: "a:smith", pinned: true });
  assert.equal(V.newSearchId([{ id: "s1000" }], 36 ** 3), "s1001"); // taken: the next one
  assert.equal(V.findSearch(list, "s1000"), search);
  assert.equal(V.findSearch(list, "nope"), null);
  const renamed = V.updateSearch(LIST, "s2", { name: " New ", query: "", pinned: true });
  assert.deepEqual(V.findSearch(renamed, "s2"), { id: "s2", name: "New", query: "c:scm y:..2010", pinned: true }); // an empty query is kept
  assert.equal(LIST[1].name, "Old SCM"); // not changed in place
  assert.deepEqual(V.removeSearch(LIST, "s2").map((s) => s.id), ["s1", "s3"]);
  assert.deepEqual(V.moveSearch(LIST, "s3", "s1").map((s) => s.id), ["s3", "s1", "s2"]);
  assert.deepEqual(V.moveSearch(LIST, "s3", "zz").map((s) => s.id), ["s1", "s2", "s3"]);
});

test("badges: the pinned searches in order; Alt+→ and Alt+← go round, All first", () => {
  const pinned = V.pinnedSearches(LIST);
  assert.deepEqual(pinned.map((s) => s.id), ["s1", "s3"]);
  assert.equal(V.nextSearch(pinned, "", 1), "s1");
  assert.equal(V.nextSearch(pinned, "s1", 1), "s3");
  assert.equal(V.nextSearch(pinned, "s3", 1), ""); // back to All
  assert.equal(V.nextSearch(pinned, "", -1), "s3");
  assert.equal(V.nextSearch(pinned, "gone", 1), "s1"); // an unknown one counts as All
  assert.equal(V.nextSearch([], "", 1), "");
  assert.deepEqual(V.searchScope(S1), { key: "s1", libraryID: 0, title: "Risk", type: "search", query: "#risk" });
});

test("saving what is shown: the scope's query and what is typed, neither changing the other", () => {
  assert.equal(V.scopeQuery(null), "");
  assert.equal(V.scopeQuery({ type: "collection", key: "AAAAAAAA", title: 'Topics / "SCM"' }), 'c:"Topics / SCM"');
  assert.equal(V.scopeQuery({ type: "tag", key: "supply chain", title: "#supply chain" }), '#"supply chain"');
  assert.equal(V.scopeQuery(V.searchScope(S3)), "t:method OR t:methods");
  assert.equal(V.combinedQuery("#risk", "supply"), "#risk supply");
  assert.equal(V.combinedQuery("t:method OR t:methods", "a OR b"), "(t:method OR t:methods) (a OR b)");
  assert.equal(V.combinedQuery("", " x "), "x");
  assert.equal(V.combinedQuery("#risk", ""), "#risk");
});

test("the Searches view: pinned first, then the rest; typing finds by name or query; a hint when empty", () => {
  const rows = V.buildSearchRows(LIST, "", "#fff", Fuzzy.filter);
  assert.deepEqual(rows.map((r) => [r.section, r.label, r.badge, r.value]), [
    ["Pinned", "Risk", "pinned", "s1"],
    ["Pinned", "Methods", "pinned", "s3"],
    ["Saved searches", "Old SCM", "", "s2"],
  ]);
  assert.equal(rows[2].detail, "c:scm y:..2010");
  const typed = V.buildSearchRows(LIST, "scm", "#fff", Fuzzy.filter);
  assert.deepEqual(typed.map((r) => [r.section, r.value]), [["", "s2"]]);
  assert.ok(V.buildSearchRows(LIST, "meth", "#fff", Fuzzy.filter)[0].labelHtml.includes("<b>"));
  const empty = V.buildSearchRows([], "", "#fff", Fuzzy.filter);
  assert.deepEqual([empty.length, empty[0].rowId, empty[0].available], [1, "search-help", false]);
});

test("a search's menu and the name / search editors", () => {
  assert.deepEqual(V.searchMenuRows(S2).map((r) => r.rowId), ["search-open", "search-pin", "search-rename", "search-query", "search-delete"]);
  assert.equal(V.searchMenuRows(S1)[1].label, "Unpin");
  assert.equal(V.searchMenuRows(S2)[1].label, "Pin above the results");
  const save = V.buildSearchEditRows("save", "", "#risk supply");
  assert.deepEqual(save.map((r) => [r.rowId, r.value]), [["search-save", "#risk supply"], ["search-save-pin", "#risk supply"]]); // no name typed: named after it
  assert.equal(V.buildSearchEditRows("save", "My risk", "#risk")[0].value, "My risk");
  assert.equal(V.buildSearchEditRows("rename", " ", "")[0].available, false);
  assert.deepEqual(V.buildSearchEditRows("query", "#risk y:2020", "#risk").map((r) => [r.rowId, r.value, r.detail]), [["search-query-save", "#risk y:2020", "It was: #risk"]]);
});

test("the @ picker: its filters (saved searches only when you have some), the operators, the syntax; typing narrows", () => {
  const rows = V.buildPickerRows("", false);
  assert.deepEqual(rows.filter((r) => r.rowId === "pick-field").map((r) => r.value), ["tag", "author", "publication", "year", "collection", "type", "has"]);
  assert.deepEqual(rows.filter((r) => r.section === "Operators").map((r) => r.value), ["AND", "OR", "NOT", "(", ")", "|"]);
  assert.deepEqual(rows.filter((r) => r.section === "Syntax").map((r) => r.value), ['"', "!", "t:", "a:", "y:", "p:", "#", "c:", "type:", "has:", "'", "^", "$"]);
  assert.ok(V.buildPickerRows("", true).some((r) => r.value === "search"));
  assert.equal(V.buildPickerRows("auth", false)[0].value, "author");
  // a symbol is found by what it does
  assert.ok(V.buildPickerRows("exclude", false).some((r) => r.value === "!"));
  assert.ok(V.buildPickerRows("phrase", false).some((r) => r.value === '"'));
  assert.equal(V.pickerFieldLabel("collection"), "Collections");
});

test("picker values: ranked, counted, capped; saved searches go in parentheses", () => {
  const values = [
    { value: "risk", label: "risk", count: 1200, token: '#"risk"', detail: "" },
    { value: "resilience", label: "resilience", count: 3, token: '#"resilience"', detail: "Lab" },
  ];
  const rows = V.buildPickerValueRows(values, "", "#fff", Fuzzy.filter);
  assert.deepEqual(rows.map((r) => [r.label, r.trailing, r.value, r.detail]), [["risk", "1,200", '#"risk"', '#"risk"'], ["resilience", "3", '#"resilience"', '#"resilience" · Lab']]);
  assert.deepEqual(V.buildPickerValueRows(values, "resil", "#fff", Fuzzy.filter).map((r) => r.label), ["resilience"]);
  assert.equal(V.buildPickerValueRows(values, "", "#fff", Fuzzy.filter, 1).length, 1);
  assert.deepEqual(V.savedSearchValues([S3]).map((v) => [v.label, v.token]), [["Methods", "(t:method OR t:methods)"]]);
  // ranked by the bridge (no rank function): its order, its highlights
  const fromBridge = V.buildPickerValueRows([Object.assign({}, values[1], { titleRanges: [[0, 5]] }), values[0]], "resil", "#fff", null);
  assert.deepEqual(fromBridge.map((r) => r.label), ["resilience", "risk"]);
  assert.ok(fromBridge[0].labelHtml.startsWith('<font color="#fff"><b>resil</b></font>'));
});

// A search's pieces as [label, role, block], the caret at the end unless given.
const segs = (text, caret, live) => V.querySegments(text, caret, live).map((s) => [s.label, s.role, s.block]);

test("querySegments: operators and finished field terms are blocks, labelled A:, P:, …; the rest is coloured text", () => {
  assert.deepEqual(segs('(#"supply chain" OR a:"Smith, John") NOT risk '), [
    ["(", "paren", false], ["# supply chain", "field", true], [" ", "", false], ["OR", "op", true], [" ", "", false],
    ["A: Smith, John", "field", true], [")", "paren", false], [" ", "", false], ["NOT", "op", true], [" risk ", "", false],
  ]);
  assert.deepEqual(segs('y:2020 p:"JOM" t:resil c:"A / B" type:"journalArticle" has:pdf !#"old" '), [
    ["Y: 2020", "field", true], [" ", "", false], ["P: JOM", "field", true], [" ", "", false], ["T: resil", "field", true], [" ", "", false],
    ["C: A / B", "field", true], [" ", "", false], ["Type: Journal article", "field", true], [" ", "", false], ["Has: PDF", "field", true], [" ", "", false],
    ["NOT # old", "neg", true], [" ", "", false],
  ]);
  // lowercase and/or/not are words; quoted phrases and plain words stay text
  assert.deepEqual(segs('risk and "exact phrase" '), [["risk and ", "", false], ['"exact phrase"', "quote", false], [" ", "", false]]);
  // x|y: terms around an operator
  assert.deepEqual(segs("x|y "), [["x", "", false], ["|", "op", false], ["y ", "", false]]);
  // pieces cover the text exactly
  const text = '(#"a b" OR x) !y';
  assert.equal(V.querySegments(text).map((s) => s.text).join(""), text);
  V.querySegments(text).forEach((s, i, all) => assert.equal(s.start, i ? all[i - 1].end : 0));
});

test("querySegments: a term is still text while it is typed or the caret is in it", () => {
  // typing it (live): text, coloured by its parts
  assert.deepEqual(segs("a:smith", 7, true), [["a:", "field", false], ["smith", "", false]]);
  assert.deepEqual(segs("risk OR", 7, true), [["risk ", "", false], ["OR", "op", false]]);
  // finished (the caret moved on, or a space after it): a block
  assert.deepEqual(segs("a:smith", 7, false), [["A: smith", "field", true]]);
  assert.deepEqual(segs("a:smith ", 8, true), [["A: smith", "field", true], [" ", "", false]]);
  // the caret inside it
  assert.deepEqual(segs("a:smith x", 4, false)[0], ["a:", "field", false]);
  // an unclosed quote or no value yet: text
  assert.deepEqual(segs('p:"Journal of', 5, false), [["p:", "field", false], ['"Journal of', "quote", false]]);
  assert.deepEqual(segs("a: x", 4, false)[0], ["a:", "field", false]);
});

// Edits in a row: [text, caret, live] after each op, from "" with the caret at 0.
function edits(ops, start = ["", 0, false]) {
  let [text, caret, live] = start;
  for (const op of ops) ({ text, caret, live } = V.editQuery(text, caret, op, true, live));
  return [text, caret, live];
}

test("editQuery: ( and \" close themselves with the caret inside; a closer steps over; Backspace in an empty pair deletes both", () => {
  assert.deepEqual(edits([{ insert: "(" }]), ["()", 1, false]);
  assert.deepEqual(edits([{ insert: "(a OR b)" }]), ["(a OR b)", 8, false]); // ")" stepped over
  assert.deepEqual(edits([{ insert: '#"' }]), ['#""', 2, true]);
  assert.deepEqual(edits([{ insert: '#"supply chain"' }]), ['#"supply chain"', 15, true]); // the closing quote stepped over
  assert.deepEqual(edits([{ insert: '"' }, "backspace"]), ["", 0, false]);
  assert.deepEqual(edits([{ insert: "(" }, "backspace"]), ["", 0, false]);
  // no pair inside quotes, or before a word
  assert.deepEqual(edits([{ insert: '"a (b' }]), ['"a (b"', 5, true]);
  assert.deepEqual(edits(["home", { insert: "(" }], ["risk", 4, false]), ["(risk", 1, false]);
  // not after a word character: a quote there is text (don't's apostrophe is ', but "x"y isn't paired)
  assert.deepEqual(edits([{ insert: 'x"' }]), ['x"', 2, true]);
});

test("editQuery: a block is deleted and stepped over whole; text a character at a time", () => {
  // Backspace right after a block, or after the space the picker put after it: the block goes
  assert.deepEqual(edits(["backspace"], ['risk a:"Smith, J" ', 18, false]), ["risk ", 5, false]);
  assert.deepEqual(edits(["backspace"], ["risk OR ", 8, false]), ["risk ", 5, false]);
  // while typing "OR", Backspace takes a letter
  assert.deepEqual(edits([{ insert: "risk OR" }, "backspace"]), ["risk O", 6, true]);
  // a space typed finishes it: then Backspace takes it and its space
  assert.deepEqual(edits([{ insert: "risk OR " }, "backspace"]), ["risk ", 5, false]);
  // ← and → jump over a block; Delete takes the block after the caret and its space
  assert.deepEqual(edits(["left"], ['a #"x y" b', 8, false]), ['a #"x y" b', 2, false]);
  assert.deepEqual(edits(["right"], ['a #"x y" b', 2, false]), ['a #"x y" b', 8, false]);
  assert.deepEqual(edits(["delete"], ['a #"x y" b', 2, false]), ["a b", 2, false]);
  // ← from the end of a word being typed goes into it, a letter at a time
  assert.deepEqual(edits([{ insert: "a:smith" }, "left"]), ["a:smith", 6, false]);
  // Ctrl+Backspace: a block, else a word; Ctrl+U: all
  assert.deepEqual(edits(["word"], ['x #"a b"', 8, false]), ["x ", 2, false]);
  assert.deepEqual(edits(["word"], ["risk resil", 10, true]), ["risk ", 5, false]);
  assert.deepEqual(edits(["clear"], ["risk", 4, false]), ["", 0, false]);
  assert.deepEqual(edits(["home", "right", "end"], ["risk", 4, false]), ["risk", 4, false]);
});

test("insertAt: a term picked with @ goes in at the caret, spaced; prefixes stay open; pairs as typed", () => {
  const at = (text, caret, token) => { const r = V.insertAt(text, caret, token); return [r.text, r.caret]; };
  assert.deepEqual(at("", 0, '#"risk"'), ['#"risk" ', 8]);
  assert.deepEqual(at("supply", 6, '#"risk"'), ['supply #"risk" ', 15]);
  assert.deepEqual(at("supply ", 7, "OR"), ["supply OR ", 10]);
  assert.deepEqual(at("supply ", 7, "("), ["supply ()", 8]); // the caret inside the group
  assert.deepEqual(at("supply ()", 8, 'a:"Smith, J"'), ['supply (a:"Smith, J")', 20]); // no space before ")"
  assert.deepEqual(at("supply (a OR b)", 14, ")"), ["supply (a OR b)", 15]); // steps over
  assert.deepEqual(at("x", 1, "a:"), ["x a:", 4]); // open for its value
  assert.deepEqual(at("x ", 2, "!"), ["x !", 3]);
  assert.deepEqual(at("x ", 2, '"'), ['x ""', 3]);
  assert.deepEqual(at("chain", 5, "$"), ["chain$", 6]);
  assert.deepEqual(at("a b", 1, "OR"), ["a OR b", 4]); // in the middle
});

test("parseThemeColors: the theme's named colours", () => {
  const toml = 'mode = "dark"\naccent = "#7d82d9"\n\nred = "#ED5B5A"\nyellow = "#E9BB4Fcc"\nbad = "red"\n';
  assert.deepEqual(V.parseThemeColors(toml), { accent: "#7d82d9", red: "#ED5B5A", yellow: "#E9BB4Fcc" });
  assert.deepEqual(V.parseThemeColors(""), {});
});

test("Go to finds Searches; a pinned search's badge keeps Go to, an opened scope doesn't", () => {
  const extras = { tasks: [], chats: 0, keys: "single" };
  const go = V.commandRows("searches", extras);
  assert.deepEqual(go.map((r) => [r.kind, r.title]), [["searches", "Searches"]]);
  assert.ok(go[0].subtitle.endsWith("· f"));
  const badge = V.buildRows({ query: "searches", scope: { kind: "search", key: "s1" }, results: [] }, "#fff", extras);
  assert.equal(badge[0].kind, "searches");
  const collection = V.buildRows({ query: "searches", scope: { kind: "collection", key: "X" }, results: [] }, "#fff", extras);
  assert.equal(collection.length, 0);
});
