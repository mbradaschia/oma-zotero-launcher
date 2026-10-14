// Note titles Zotero takes as they are (daemon/lib/titles.mjs): plain, printable, within its length.
const test = require("node:test");
const assert = require("node:assert/strict");

const T = () => import("../daemon/lib/titles.mjs");

test("a title's text: Zotero's rich text as its words, no control or invisible characters", async () => {
  const { cleanTitle } = await T();
  assert.equal(cleanTitle("The <i>Homo economicus</i> and H<sub>2</sub>O <span class=\"nocase\">eBay</span>"), "The Homo economicus and H2O eBay");
  assert.equal(cleanTitle("Line one\nline two\tand more"), "Line one line two and more");
  assert.equal(cleanTitle("zero​width ‮bidi‬ soft­hyphen ﻿bom"), "zerowidth bidi softhyphen bom");
  assert.equal(cleanTitle("bell\u0007 nul\u0000 del\u007F"), "bell nul del");
  assert.equal(cleanTitle("lone \uD800 surrogate \uDFFF and a pair 📚"), "lone surrogate and a pair 📚");
  assert.equal(cleanTitle("non￾char﷐"), "nonchar");
  assert.equal(cleanTitle("Ação, “quotes”, é, 中文, 5 < 6 & 7"), "Ação, “quotes”, é, 中文, 5 < 6 & 7"); // what Zotero takes stays
  assert.equal(cleanTitle(null), "");
});

test("a title within Zotero's 120 characters: the paper shortened, the prompt and version kept", async () => {
  const { fitTitle, TITLE_MAX } = await T();
  assert.equal(fitTitle("Findings v2: ", "Sirmon et al., 2007 · Short"), "Findings v2: Sirmon et al., 2007 · Short");
  const long = fitTitle("Findings v12 (3): ", "Sirmon et al., 2007 · " + "A very long title about resource orchestration ".repeat(5));
  assert.ok(long.length <= TITLE_MAX, long.length);
  assert.ok(long.startsWith("Findings v12 (3): Sirmon et al., 2007 · A very long"));
  assert.ok(long.endsWith("…") && !/\s…$/.test(long));
  assert.ok(fitTitle("", "📚".repeat(100)).length <= TITLE_MAX); // a character never cut in two
  assert.equal(fitTitle("", "  Chat: what  is\nit?  "), "Chat: what is it?");
});
