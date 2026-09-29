// OmaNotes companion additions (zotero-bridge/lib/notes.js) against a fake Zotero:
// the HTML sanitizer, the schema wrapper, createChild's parent/library checks,
// the trash ownership check and the note search.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const lib = (f) => fs.readFileSync(path.join(__dirname, "../zotero-bridge/lib", f), "utf8");
const plain = (x) => JSON.parse(JSON.stringify(x));

function omaHttpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

function load({ editable = true, rows = [] } = {}) {
  const saved = [];
  const trashed = [];
  const items = new Map();
  class FakeItem {
    constructor(type) {
      this.itemType = type;
      this.tags = [];
      this.key = null;
      this.id = null;
      this.libraryID = null;
      this.parentID = null;
      this.note = null;
    }
    setNote(html) { this.note = html; }
    addTag(name, type = 0) {
      if (this.tags.some((t) => t.tag === name)) return false;
      this.tags.push({ tag: name, type });
      return true;
    }
    getTags() { return this.tags.slice(); }
    isNote() { return this.itemType === "note"; }
    async saveTx(opts) {
      this.id = 500 + saved.length;
      this.key = "NEWNOTE" + saved.length;
      saved.push({ item: this, opts });
      return this.id;
    }
  }
  const Zotero = {
    debug() {},
    logError(e) { throw e; },
    Item: FakeItem,
    Libraries: { userLibraryID: 1, exists: (id) => id === 1, get: (id) => (id === 1 ? { libraryID: 1, name: "My Library", editable } : id === 2 ? { libraryID: 2, name: "HBR.org", editable: false } : null) },
    Items: { trashTx: async (ids) => { trashed.push(ids); }, get: (id) => items.get(id) || false },
    ItemTypes: { getID: (name) => (name === "note" ? 28 : 0) },
    DB: { calls: [], queryAsync: async (sql, params) => { Zotero.DB.calls.push({ sql, params }); return rows; } },
    Utilities: { unescapeHTML: (s) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ") },
  };
  const ctx = vm.createContext({ Zotero, omaHttpError, setTimeout, clearTimeout, console });
  vm.runInContext(lib("noteFormat.js"), ctx);
  vm.runInContext(lib("tags.js"), ctx);
  vm.runInContext(lib("notes.js"), ctx);
  return { N: ctx.OmaNotes, Zotero, saved, trashed, items };
}

const parent = (over = {}) => Object.assign({ id: 7, key: "PARENT01", libraryID: 1, isRegularItem: () => true, isEditable: () => true }, over);

test("sanitizer: script/style go with their content, event handlers and other attributes are dropped, allowed tags stay", () => {
  const { N } = load();
  const html =
    '<p onclick="steal()" style="color:red">Hi <script>alert(1)</script><b class="x">bold</b> <STRONG>loud</STRONG><br/>' +
    '<img src="x" onerror="alert(2)"><a href="javascript:alert(3)">bad</a> ' +
    '<a href="https://e.org/x?a=1&amp;b=2" target="_blank" onmouseover="x()">ok</a></p>' +
    "<style>p{display:none}</style><!-- comment --><div><span>text</span></div><hr><iframe src=\"https://evil\">inner</iframe>" +
    "<ul><li>one</li><li>two</li></ul><h3>H</h3><blockquote>q</blockquote><pre><code>c &lt; d</code></pre>" +
    "<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table><u>u</u><em>e</em><i>i</i><ol><li>1</li></ol><h1>1</h1><h2>2</h2><h4>4</h4>";
  const out = N.sanitizeHTML(html);
  assert.equal(
    out,
    "<p>Hi <b>bold</b> <strong>loud</strong><br>bad " + // the javascript: anchor is gone, its text stays
      '<a href="https://e.org/x?a=1&amp;b=2">ok</a></p>text<hr>' +
      "<ul><li>one</li><li>two</li></ul><h3>H</h3><blockquote>q</blockquote><pre><code>c &lt; d</code></pre>" +
      "<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table><u>u</u><em>e</em><i>i</i><ol><li>1</li></ol><h1>1</h1><h2>2</h2><h4>4</h4>"
  );
  assert.doesNotMatch(out, /script|onerror|onclick|style|iframe|javascript/i);
});

test("sanitizer: href must be http(s) — also after entity/whitespace tricks; other schemes lose the attribute", () => {
  const { N } = load();
  assert.equal(N.sanitizeHTML('<a href="http://a.b/c">x</a>'), '<a href="http://a.b/c">x</a>');
  assert.equal(N.sanitizeHTML("<a href='HTTPS://A.B/'>x</a>"), '<a href="HTTPS://A.B/">x</a>');
  assert.equal(N.sanitizeHTML("<a href=https://a.b/c?d=1 title=t>x</a>"), '<a href="https://a.b/c?d=1">x</a>');
  for (const bad of ["javascript:alert(1)", " java\tscript:alert(1)", "jav&#x09;ascript:alert(1)", "data:text/html;base64,AAAA", "zotero://select/items/1", "ftp://x", "//evil.org", "/relative"]) {
    assert.equal(N.sanitizeHTML(`<a href="${bad}">x</a>`), "x", bad);
  }
  assert.equal(N.sanitizeHTML('<a href="https://a.b/?q=&quot;x&quot;">x</a>'), '<a href="https://a.b/?q=&quot;x&quot;">x</a>');
  assert.equal(N.sanitizeHTML("<a name=x>x</a> <a href=https://ok/>y</a>"), 'x <a href="https://ok/">y</a>'); // only the matching </a> is dropped
});

test("sanitizer: text is rebuilt (no tag can be assembled from fragments), entities are kept, malformed tags become text", () => {
  const { N } = load();
  assert.equal(N.sanitizeHTML("<scr<script>ipt>alert(1)</script>"), "&lt;scr");
  assert.equal(N.sanitizeHTML("a < b & c > d &amp; &nbsp; &#8212; &#x2014; &bogus"), "a &lt; b &amp; c &gt; d &amp; &nbsp; &#8212; &#x2014; &amp;bogus");
  assert.equal(N.sanitizeHTML('<p title="a>b">x</p>'), "<p>x</p>"); // '>' inside a quoted attribute
  assert.equal(N.sanitizeHTML('<p title="unclosed>x'), "&lt;p title=\"unclosed&gt;x");
  assert.equal(N.sanitizeHTML("<!DOCTYPE html><?xml version='1'?><P>X</P>"), "<p>X</p>");
  assert.equal(N.sanitizeHTML("<script>never</script>"), "");
  assert.equal(N.sanitizeHTML("<script>unterminated"), "");
  assert.equal(N.sanitizeHTML("<svg><circle onload=x/></svg>after<math><mi>y</mi></math>"), "after");
  assert.equal(N.sanitizeHTML("<br></br><hr/>"), "<br><hr>");
  assert.equal(N.sanitizeHTML(""), "");
  assert.equal(N.sanitizeHTML(null), "");
});

test("prepareHTML: wraps in the note editor's schema container, keeps an existing one (and its version), rejects empty/oversized/hollow input", () => {
  const { N } = load();
  assert.equal(N.prepareHTML("<p>x</p>"), '<div data-schema-version="9"><p>x</p></div>');
  assert.equal(N.prepareHTML('  <div data-schema-version="8" class="zotero-note"><p onclick="x">y</p></div>\n'), '<div data-schema-version="8"><p>y</p></div>');
  assert.equal(N.prepareHTML("<div><p>inner</p></div>"), '<div data-schema-version="9"><p>inner</p></div>'); // a plain div is not the wrapper
  assert.equal(N.prepareHTML("plain text"), '<div data-schema-version="9">plain text</div>');
  const bad = (html) => assert.throws(() => N.prepareHTML(html), (e) => e.status === 400 && e.code === "bad-html", JSON.stringify(html).slice(0, 40));
  bad("");
  bad("   ");
  bad(null);
  bad(42);
  bad("<script>x</script>");
  bad("<p>&nbsp;</p><hr><br>");
  bad("<p>" + "x".repeat(60 * 1024) + "</p>");
  assert.equal(N.prepareHTML("x".repeat(60 * 1024)).length, 60 * 1024 + '<div data-schema-version="9"></div>'.length); // exactly the limit is fine
});

test("createChild: a tagged child note under a regular item in an editable library", async () => {
  const { N, saved } = load();
  const r = plain(await N.createChild(parent(), "<p>Hello <script>x</script><b>there</b></p>", ["todo", "oma-companion"]));
  assert.deepEqual(r, { key: "NEWNOTE0", parentKey: "PARENT01", libraryID: 1 });
  assert.equal(saved.length, 1);
  const { item, opts } = saved[0];
  assert.equal(item.itemType, "note");
  assert.equal(item.libraryID, 1);
  assert.equal(item.parentID, 7);
  assert.equal(item.note, '<div data-schema-version="9"><p>Hello <b>there</b></p></div>');
  assert.deepEqual(plain(item.tags), [{ tag: "oma-companion", type: 0 }, { tag: "todo", type: 0 }]);
  assert.deepEqual(plain(opts), { skipSelect: true });
  const r2 = plain(await N.createChild(parent(), "just text"));
  assert.equal(r2.key, "NEWNOTE1");
  assert.deepEqual(plain(saved[1].item.tags), [{ tag: "oma-companion", type: 0 }]);
});

test("createChild: attachment/note/missing parents → 400 bad-parent; read-only library → 409; bad html → 400; nothing saved", async () => {
  const { N, saved } = load();
  const rejects = (p, code, status) => assert.rejects(p, (e) => e.status === status && e.code === code, code);
  await rejects(N.createChild(parent({ isRegularItem: () => false }), "<p>x</p>"), "bad-parent", 400);
  await rejects(N.createChild(null, "<p>x</p>"), "bad-parent", 400);
  await rejects(N.createChild(parent({ libraryID: 2 }), "<p>x</p>"), "read-only", 409); // library flag wins over isEditable()
  await rejects(N.createChild(parent({ isEditable: () => false }), "<p>x</p>"), "read-only", 409);
  await rejects(N.createChild(parent(), "<script>x</script>"), "bad-html", 400);
  await rejects(N.createChild(parent(), ""), "bad-html", 400);
  assert.equal(saved.length, 0);
  const ro = load({ editable: false });
  await rejects(ro.N.createChild(parent(), "<p>x</p>"), "read-only", 409);
  assert.equal(ro.saved.length, 0);
});

test("trash: only notes carrying the companion tag; others → 403 not-ours, non-notes → 400, read-only → 409", async () => {
  const { N, trashed } = load();
  const note = (tags, over = {}) => Object.assign({ id: 42, key: "NOTE0042", libraryID: 1, isNote: () => true, isEditable: () => true, getTags: () => tags.map((tag) => ({ tag, type: 0 })) }, over);
  assert.deepEqual(plain(await N.trash(note(["oma-companion", "todo"]))), { trashed: true, key: "NOTE0042", libraryID: 1 });
  assert.deepEqual(plain(trashed), [[42]]);
  await assert.rejects(N.trash(note(["todo"])), (e) => e.status === 403 && e.code === "not-ours");
  await assert.rejects(N.trash(note([])), (e) => e.code === "not-ours");
  await assert.rejects(N.trash(note(["oma-companion"], { isNote: () => false })), (e) => e.status === 400 && e.code === "not-a-note");
  await assert.rejects(N.trash(note(["oma-companion"], { libraryID: 2 })), (e) => e.status === 409 && e.code === "read-only");
  assert.equal(trashed.length, 1);
});

test("search: bound INSTR query over note items, results as list summaries with the parent key; query length validated", async () => {
  const { N, Zotero, items } = load({ rows: [{ itemID: 12 }, { itemID: 13 }, { itemID: 99 }] });
  const mk = (id, key, html, parentItemID) => items.set(id, { id, key, libraryID: 1, parentItemID, isNote: () => true, getNoteTitle: () => "Scan", getNote: () => html, dateModified: "2026-09-2" + id % 10 + " 00:00:00" });
  mk(12, "NOTE0012", "<h1>Scan</h1><p>Resilience is the <b>key</b> theme.</p>", 1);
  mk(13, "NOTE0013", "<p>Scan</p><p>standalone resilience</p>", null);
  items.set(1, { id: 1, key: "TOP00001", isNote: () => false });
  const out = plain(await N.search(1, "  Resil ", 5));
  assert.deepEqual(plain(Zotero.DB.calls[0].params), [1, 28, "Resil", 5]);
  assert.match(Zotero.DB.calls[0].sql, /INSTR\(LOWER\(N\.note\), LOWER\(\?\)\) > 0/);
  assert.match(Zotero.DB.calls[0].sql, /NOT IN \(SELECT itemID FROM deletedItems\)/);
  assert.deepEqual(out, [
    { key: "NOTE0012", libraryID: 1, title: "Scan", dateModified: "2026-09-22 00:00:00", excerpt: "Resilience is the key theme.", parentKey: "TOP00001" },
    { key: "NOTE0013", libraryID: 1, title: "Scan", dateModified: "2026-09-23 00:00:00", excerpt: "standalone resilience", parentKey: null },
  ]); // itemID 99 is unknown and skipped
  for (const bad of ["a", " x ", "", null, "q".repeat(101)]) {
    await assert.rejects(N.search(1, bad, 5), (e) => e.status === 400 && e.code === "bad-query", JSON.stringify(bad));
  }
  await N.search(1, "ok", 999);
  assert.equal(Zotero.DB.calls.at(-1).params[3], 50); // capped
  await N.search(1, "ok");
  assert.equal(Zotero.DB.calls.at(-1).params[3], 20); // default
});

test("routes: registerRoutes adds the three note routes; routeSearch validates the library and trims the query", async () => {
  const { N } = load();
  const bridge = { routes: [], route(method, path) { this.routes.push(method + " " + path); } };
  N.registerRoutes(bridge);
  assert.deepEqual(bridge.routes, ["POST /notes/create", "POST /notes/trash", "POST /notes/search"]);
  const r = plain(await N.routeSearch.call(bridge, { query: " resil " }));
  assert.deepEqual(r, { libraryID: 1, query: "resil", notes: [] });
  await assert.rejects(N.routeSearch.call(bridge, { query: "resil", libraryID: 5 }), (e) => e.status === 400 && e.code === "bad-library");
  // routeCreate/routeTrash resolve the parent through the bridge's own _item()
  const seen = [];
  const b2 = { _item: async (key, libraryID) => { seen.push([key, libraryID]); return parent(); } };
  const created = plain(await N.routeCreate.call(b2, { parentKey: "PARENT01", libraryID: 1, html: "<p>x</p>" }));
  assert.equal(created.parentKey, "PARENT01");
  assert.deepEqual(seen, [["PARENT01", 1]]);
  await assert.rejects(N.routeCreate.call(b2, { parentKey: "PARENT01", html: "<p>x</p>", tags: "nope" }), (e) => e.code === "bad-tags");
});
