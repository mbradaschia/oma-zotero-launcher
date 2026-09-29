// Offline tests for the bridge's request wrapper (auth, origin, size cap,
// lifecycle, error mapping): bridge.js runs in a VM with stubbed Zotero globals.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const TOKEN = "ab".repeat(32);

function loadBridge() {
  const sandbox = {
    Zotero: { debug() {}, logError() {}, Server: { Endpoints: {} } },
    Services: { prefs: { getBoolPref: () => false, getIntPref: (p, d) => d, getStringPref: () => TOKEN } },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../zotero-bridge/lib/bridge.js"), "utf8"), sandbox);
  const bridge = new sandbox.OmaBridge({ id: "test@x", version: "0", rootURI: "file:///" });
  bridge.token = TOKEN;
  bridge.active = true;
  return { bridge, sandbox };
}

const req = (headers = {}, data = {}) => ({ method: "POST", headers: Object.assign({ authorization: `Bearer ${TOKEN}` }, headers), data });
const statusOf = async (bridge, r, handler = async () => ({ hello: 1 })) => (await bridge._handle(r, handler))[0];

test("valid token → 200 with ok body", async () => {
  const { bridge } = loadBridge();
  const [status, headers, body] = await bridge._handle(req(), async (data) => ({ echo: data.x }));
  assert.equal(status, 200);
  assert.match(headers["Content-Type"], /application\/json/);
  const parsed = JSON.parse(body);
  assert.equal(parsed.ok, true);
  assert.equal(typeof parsed.tookMs, "number");
});

test("missing, malformed or wrong token → 401", async () => {
  const { bridge } = loadBridge();
  assert.equal(await statusOf(bridge, req({ authorization: undefined })), 401);
  assert.equal(await statusOf(bridge, req({ authorization: "Bearer short" })), 401);
  assert.equal(await statusOf(bridge, req({ authorization: `Basic ${TOKEN}` })), 401);
  assert.equal(await statusOf(bridge, req({ authorization: `Bearer ${"cd".repeat(32)}` })), 401);
});

test("any Origin header → 403, even with a valid token", async () => {
  const { bridge } = loadBridge();
  assert.equal(await statusOf(bridge, req({ origin: "https://www.zotero.org" })), 403);
  assert.equal(await statusOf(bridge, req({ origin: "null" })), 403);
});

test("oversized body → 413", async () => {
  const { bridge } = loadBridge();
  assert.equal(await statusOf(bridge, req({ "content-length": String(64 * 1024 + 1) })), 413);
});

test("stopped bridge → 503 before any auth work", async () => {
  const { bridge } = loadBridge();
  bridge.active = false;
  assert.equal(await statusOf(bridge, req()), 503);
});

test("handler errors map to their status, unexpected ones to 500", async () => {
  const { bridge, sandbox } = loadBridge();
  const notFound = async () => { throw sandbox.omaHttpError(404, "not-found", "nope"); };
  const [s1, , b1] = await bridge._handle(req(), notFound);
  assert.equal(s1, 404);
  assert.deepEqual(JSON.parse(b1).error, { code: "not-found", message: "nope" });
  const [s2] = await bridge._handle(req(), async () => { throw new Error("boom"); });
  assert.equal(s2, 500);
});

test("non-object JSON bodies reach handlers as {}", async () => {
  const { bridge } = loadBridge();
  for (const data of [null, [1, 2], "str", 42]) {
    const [, , body] = await bridge._handle(req({}, data), async (d) => ({ keys: Object.keys(d).length }));
    assert.equal(JSON.parse(body).keys, 0);
  }
});

test("emptyQueryOptions: settings from the shell, with defaults for anything missing or invalid", () => {
  const { sandbox } = loadBridge();
  const opts = (raw, d) => JSON.parse(JSON.stringify(sandbox.OmaBridge.emptyQueryOptions(raw, d)));
  assert.deepEqual(opts(undefined), { showOpen: true, tabOrder: "mru", recent: "added", recentLimit: 15 });
  assert.deepEqual(opts(null, 7), { showOpen: true, tabOrder: "mru", recent: "added", recentLimit: 7 });
  assert.deepEqual(opts({ showOpen: false, tabOrder: "tabbar", recent: "modified", recentLimit: 5 }),
    { showOpen: false, tabOrder: "tabbar", recent: "modified", recentLimit: 5 });
  assert.deepEqual(opts({ recent: "none", recentLimit: 0 }), { showOpen: true, tabOrder: "mru", recent: "none", recentLimit: 0 });
  assert.deepEqual(opts({ showOpen: "no", tabOrder: "random", recent: "later", recentLimit: 500 }),
    { showOpen: true, tabOrder: "mru", recent: "added", recentLimit: 50 });
  assert.deepEqual(opts({ recentLimit: -3 }).recentLimit, 0);
  assert.deepEqual(opts({ recentLimit: "abc" }, 9).recentLimit, 9);
  assert.deepEqual(opts([1, 2]), opts(undefined));
});

test("pinnedIDs: pinned keys → top-level item IDs in pin order; bad, unknown, trashed and duplicate pins dropped", () => {
  const { sandbox } = loadBridge();
  const items = { 1: { id: 1, parentItemID: null }, 2: { id: 2, parentItemID: 1 }, 3: { id: 3, parentItemID: null, deleted: true }, 4: { id: 4, parentItemID: null } };
  const keys = { "1:AAAAAAAA": 1, "1:BBBBBBBB": 2, "1:CCCCCCCC": 3, "2:DDDDDDDD": 4 };
  sandbox.Zotero.Libraries = { userLibraryID: 1 };
  sandbox.Zotero.Items = { getIDFromLibraryAndKey: (lib, key) => keys[lib + ":" + key] || false, get: (id) => items[id] || null };
  const ids = (pinned) => Array.from(sandbox.OmaBridge.pinnedIDs(pinned));
  assert.deepEqual(ids([{ key: "DDDDDDDD", libraryID: 2 }, { key: "AAAAAAAA" }, { key: "BBBBBBBB", libraryID: 1 }]), [4, 1]); // a child pins its parent once
  assert.deepEqual(ids([{ key: "CCCCCCCC" }, { key: "ZZZZZZZZ" }, { key: "bad" }, null, { key: "AAAAAAAA", libraryID: "x" }]), []);
  assert.deepEqual(ids("nope"), []);
});

test("paperInfo: APA 7 short authors, the year, the title and the publication for the note window", () => {
  const { sandbox } = loadBridge();
  sandbox.Zotero.CreatorTypes = { getName: (id) => (id === 9 ? "reviewedAuthor" : "author") };
  const item = (fields, creators) => ({
    key: "AAAAAAAA",
    getField: (f) => { if (!(f in fields)) throw new Error("no field"); return fields[f]; },
    getCreators: () => creators,
    getDisplayTitle: () => "display",
  });
  const c = (firstName, lastName, extra) => Object.assign({ firstName, lastName, creatorTypeID: 1, fieldMode: 0 }, extra);
  const info = (i) => JSON.parse(JSON.stringify(sandbox.OmaBridge.paperInfo(i)));
  assert.deepEqual(info(item({ title: "Managing Firm Resources", date: "2007-01-01", publicationTitle: "Academy of Management Review" },
    [c("David G.", "Sirmon"), c("Michael A.", "Hitt"), c("R. Duane", "Ireland"), c("X", "Reviewed", { creatorTypeID: 9 })])),
    { key: "AAAAAAAA", title: "Managing Firm Resources", authors: "Sirmon et al.", year: "2007", publication: "Academy of Management Review", rank: null });
  assert.equal(info(item({ title: "T", date: "2019" }, [c("T.", "Tokar"), c("M.", "Swink")])).authors, "Tokar & Swink");
  assert.equal(info(item({ title: "T", date: "2019" }, [c("T.", "Tokar")])).authors, "Tokar");
  assert.deepEqual(info(item({ title: "", date: "circa 1984", bookTitle: "Handbook" }, [c("", "World Bank", { fieldMode: 1 })])),
    { key: "AAAAAAAA", title: "display", authors: "World Bank", year: "1984", publication: "Handbook", rank: null });
  assert.deepEqual(info(item({ title: "T", date: "" }, [])), { key: "AAAAAAAA", title: "T", authors: "", year: "", publication: "", rank: null });
});
