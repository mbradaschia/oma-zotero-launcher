// Copy citation / Copy bibliography entry: the citation style setting (lib/Client.js), its page in
// Settings › General (lib/Settings.js), and the Copy rows in a paper's menu (lib/Views.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../lib/Client.js");
const S = require("../lib/Settings.js");
const V = require("../lib/Views.js");

test("the citation style: APA 7th edition by default; a Zotero style's short name or a URL; else a problem", () => {
  const def = C.normalizeSettings(null).settings
  assert.equal(def.citationStyle, null)
  assert.equal(C.citationStyle(def), "apa")
  assert.equal(C.citationStyle(C.normalizeSettings({ general: { citationStyle: "chicago-author-date" } }).settings), "chicago-author-date")
  assert.equal(C.normalizeSettings({ general: { citationStyle: "https://example.edu/styles/house" } }).settings.citationStyle, "https://example.edu/styles/house")
  for (const bad of ["../apa", "a b", 3]) {
    const r = C.normalizeSettings({ general: { citationStyle: bad } })
    assert.equal(r.settings.citationStyle, null, String(bad))
    assert.match(r.problems[0], /citationStyle must be a Zotero style/)
  }
  // saved only when it isn't the default
  assert.equal(S.toFile(def).general.citationStyle, undefined)
  assert.equal(S.toFile(S.withValue(def, "general.citationStyle", "mla")).general.citationStyle, "mla")
  assert.equal(C.normalizeSettings(S.toFile(S.withValue(def, "general.citationStyle", "mla"))).settings.citationStyle, "mla")
})

test("Settings › General › Citation style: a row that opens the installed styles, yours checked", () => {
  const state = (over) => Object.assign({ settings: C.normalizeSettings(null).settings, styles: null, stylesProblem: "" }, over || {})
  const g = S.buildGeneral(state(), V.listRow).find((r) => r.rowId === "set-styles")
  assert.deepEqual([g.section, g.label, g.value, g.submenu], ["Citations", "Citation style", "general.citationStyle", true])
  assert.match(g.detail, /^American Psychological Association 7th edition \(default\) · Copy citation \(i\)/)
  const styles = [{ id: "apa", title: "American Psychological Association 7th edition" }, { id: "mla", title: "Modern Language Association 9th edition" }]
  const mla = state({ settings: S.withValue(C.normalizeSettings(null).settings, "general.citationStyle", "mla"), styles })
  assert.match(S.buildGeneral(mla, V.listRow).find((r) => r.rowId === "set-styles").detail, /^Modern Language Association 9th edition · /)
  assert.deepEqual(S.buildStylePicker(state(), V.listRow).map((r) => r.label), ["Asking Zotero for its styles…"])
  assert.deepEqual(S.buildStylePicker(state({ stylesProblem: "Zotero's styles aren't loaded yet" }), V.listRow).map((r) => r.label), ["Couldn't list the styles: Zotero's styles aren't loaded yet"])
  const picker = S.buildStylePicker(state({ styles }), V.listRow)
  assert.deepEqual(picker.filter((r) => r.rowId === "set-style-opt").map((r) => [r.value, r.checked, r.detail]), [["apa", true, "apa · the default"], ["mla", false, "mla"]])
  assert.equal(picker[picker.length - 1].section, "More styles")
  assert.deepEqual(S.buildStylePicker(mla, V.listRow).filter((r) => r.checked).map((r) => r.value), ["mla"])
})

test("a paper's menu: Copy citation and Copy bibliography entry, with what they copy and their keys", () => {
  const details = { item: { itemType: "journalArticle" }, attachments: [], notes: [], tags: [], library: { editable: true } }
  const cite = { citation: "(Adner & Helfat, 2003)", bibliography: "Adner, R., & Helfat, C. E. (2003). Corporate effects and dynamic managerial capabilities. SMJ, 24(10), 1011–1025.", error: "", keys: "single" }
  const rows = V.buildActions(details, "", [], "", false, false, { cite: cite }).filter((r) => r.rowId === "cite-copy")
  assert.deepEqual(rows.map((r) => [r.section, r.label, r.value, r.available]), [["This paper", "Copy citation", "citation", true], ["This paper", "Copy bibliography entry", "bibliography", true]])
  assert.equal(rows[0].detail, "(Adner & Helfat, 2003) · i")
  assert.match(rows[1].detail, /^Adner, R\., & Helfat.* · r$/)
  const waiting = V.buildActions(details, "", [], "", false, false, { cite: Object.assign({}, cite, { citation: "", keys: "alt" }) }).filter((r) => r.rowId === "cite-copy")
  assert.equal(waiting[0].detail, "… · alt+i")
  const failed = V.buildActions(details, "", [], "", false, false, { cite: Object.assign({}, cite, { error: "no installed style x" }) }).filter((r) => r.rowId === "cite-copy")
  assert.equal(failed[0].detail, "Couldn't format it: no installed style x · i")
  // a note or a file has none; neither while loading the details
  assert.equal(V.buildActions({ item: { itemType: "note" }, notes: [], attachments: [], tags: [] }, "", [], "", false, false, { cite: cite }).some((r) => r.rowId === "cite-copy"), false)
  assert.equal(V.buildActions(null, "", [], "", false, false, { cite: cite }).filter((r) => r.rowId === "cite-copy").every((r) => !r.available), true)
  assert.ok(V.KEYBINDINGS.some((k) => k[1] === "i  r"))
})
