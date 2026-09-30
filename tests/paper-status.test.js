// Paper statuses: tags such as "to read" / "reading" / "read" (Settings › Paper status), shown as a
// badge on each result and in a paper's menu; Tab / Shift+Tab cycles them. The bridge says which
// one a result has (search's statusTags); the launcher cycles and saves (lib/Client.js, Views.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const C = require("../lib/Client.js");
const S = require("../lib/Settings.js");
const V = require("../lib/Views.js");

test("settings: the defaults, your list (validated, no duplicates), written only when changed", () => {
  assert.deepEqual(C.normalizeSettings(null).settings.paperStatuses, ["to read", "reading", "read"]);
  const r = C.normalizeSettings({ status: { tags: ["To read", " skimmed ", "to read", "", "a\nb"] } });
  assert.deepEqual(r.settings.paperStatuses, ["To read", "skimmed"]);
  assert.deepEqual(r.problems, ["status.tags[3] must be a tag name", "status.tags[4] must be a tag name"]);
  assert.deepEqual(C.normalizeSettings({ status: { tags: [] } }).settings.paperStatuses, []); // none: Tab does nothing
  assert.equal(S.toFile(C.normalizeSettings(null).settings).status, undefined);
  const mine = S.withValue(C.normalizeSettings(null).settings, "paperStatuses", ["to read", "reading", "read", "cited"]);
  assert.deepEqual(S.toFile(mine).status, { tags: ["to read", "reading", "read", "cited"] });
  assert.deepEqual(C.normalizeSettings(S.toFile(mine)).settings.paperStatuses, ["to read", "reading", "read", "cited"]);
  const page = S.buildPaperStatusSettings(["to read", "reading"], V.listRow);
  assert.deepEqual(page.map((x) => x.rowId), ["pstatus", "pstatus", "pstatus-add", "set-info"]);
});

test("cycling: none → each status → none (Shift+Tab backwards); the status a paper has, as it spells it", () => {
  const st = ["to read", "reading", "read"];
  assert.equal(C.nextPaperStatus(st, "", 1), "to read");
  assert.equal(C.nextPaperStatus(st, "to read", 1), "reading");
  assert.equal(C.nextPaperStatus(st, "read", 1), "");
  assert.equal(C.nextPaperStatus(st, "", -1), "read");
  assert.equal(C.nextPaperStatus(st, "Reading", 1), "read"); // case doesn't matter
  assert.equal(C.nextPaperStatus(st, "gone", 1), "to read"); // not a status (any more): from none
  assert.equal(C.paperStatusOf([{ tag: "notion" }, { tag: "Reading" }], st), "Reading");
  assert.equal(C.paperStatusOf(["read", "to read"], st), "to read"); // two of them: the first in your order
  assert.equal(C.paperStatusOf([], st), "");
});

test("bridge: each result says its status (the first of the asked tags it carries); an old bridge says nothing", () => {
  const ctx = vm.createContext({ console, Zotero: {}, Services: {}, IOUtils: {}, PathUtils: {}, Components: {}, crypto: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../zotero-bridge/lib/bridge.js"), "utf8") + "\nthis.OmaBridge = OmaBridge;", ctx);
  const B = ctx.OmaBridge;
  assert.deepEqual(Array.from(B.statusTagList([" to read ", "", 3, "reading"])), ["to read", "reading"]);
  assert.equal(B.statusOf(["notion", "Reading"], ["to read", "reading"]), "Reading");
  assert.equal(B.statusOf(["notion"], ["to read"]), "");
  assert.equal(B.statusOf(["reading"], []), "");
  // the launcher's rows: the status, or "\u0000" when the bridge didn't say
  const row = V.buildRows({ query: "x", results: [{ key: "K", libraryID: 1, title: "T", itemType: "journalArticle", status: "reading" }] }, "#fff")[0];
  assert.equal(row.status, "reading");
  assert.equal(V.buildRows({ query: "x", results: [{ key: "K", libraryID: 1, title: "T", itemType: "journalArticle" }] }, "#fff")[0].status, "\u0000");
});

test("a paper's menu: a Status row in This paper (Enter or Tab changes it)", () => {
  const details = { item: { itemType: "journalArticle" }, attachments: [], notes: [], tags: [], library: { editable: true } };
  const rows = V.buildActions(details, "", [], "", false, false, { paperStatus: "reading", statusTags: ["to read", "reading", "read"] });
  const st = rows.find((r) => r.rowId === "paper-status");
  assert.deepEqual([st.section, st.label, st.badge], ["This paper", "Status: reading", "reading"]);
  assert.match(st.detail, /none → to read → reading → read/);
  assert.equal(V.buildActions(details, "", [], "", false, false, { paperStatus: "" }).find((r) => r.rowId === "paper-status").label, "No status");
  assert.equal(V.buildActions(details, "", [], "", false, false, {}).some((r) => r.rowId === "paper-status"), false); // not known yet
});
