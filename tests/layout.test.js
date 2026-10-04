// An image's layout, measured in a headless Chromium (daemon/lib/layout.mjs), and how an artifact
// run uses it (daemon/lib/artifacts.mjs produce): faults sent back once, then repaired.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const L = () => import("../daemon/lib/layout.mjs");
const A = () => import("../daemon/lib/artifacts.mjs");

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200"><rect width="400" height="200" fill="#f8fafc"/>${body}</svg>`;

test("layout: the browser is found, or named, or turned off", async () => {
  const { findBrowser } = await L();
  assert.equal(findBrowser({ ...process.env, OMA_ZOTERO_BROWSER: "none" }), "");
  assert.equal(findBrowser({ PATH: "/nonexistent" }), "");
});

test("layout: the audit page runs only its own script and loads nothing", async () => {
  const { auditPage } = await L();
  const page = auditPage(svg(""));
  const nonce = page.match(/'nonce-([^']+)'/)[1];
  assert.match(page, /default-src 'none'/);
  assert.ok(page.includes(`<script nonce="${nonce}">`));
  assert.equal((page.match(/<script/g) || []).length, 1);
  assert.match(page, /width:400px;height:200px/);
});

test("layout: the page's audit is read back; anything else is null", async () => {
  const { readAudit } = await L();
  const r = readAudit('{"width":400,"height":200,"lines":1,"problems":[{"kind":"edge","text":"\\"a & b\\" <x>"}]}');
  assert.equal(r.problems[0].text, '"a & b" <x>');
  assert.equal(readAudit(""), null);
  assert.equal(readAudit('{"error":"no viewBox"}'), null);
  assert.equal(readAudit("not json"), null);
});

test("layout: no browser, no measurement (the estimate is used instead)", async () => {
  const { measureLayout } = await L();
  assert.equal(await measureLayout(svg(""), { browser: "" }), null);
  assert.equal(await measureLayout(svg(""), { browser: "/nonexistent/chromium", timeoutMs: 5000 }), null);
});

test("layout: a browser whose sandbox can't start is named as the reason", async () => {
  const { measureLayout } = await L();
  const dir = fs.mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "oma-fake-browser-"));
  const bin = dir + "/chromium";
  fs.writeFileSync(bin, "#!/bin/sh\necho 'FATAL: content::ZygoteHostImpl::Init() No usable sandbox!' >&2\nexit 134\n", { mode: 0o755 });
  let why = null;
  assert.equal(await measureLayout(svg(""), { browser: bin, onFail: (f) => { why = f; } }), null);
  assert.match(why.reason, /sandbox couldn't start/);
  assert.equal(why.code, 134);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("layout: the message names each fault and caps the list", async () => {
  const { layoutMessage } = await L();
  assert.equal(layoutMessage(null), "");
  assert.equal(layoutMessage({ problems: [] }), "");
  const m = layoutMessage({ problems: Array.from({ length: 12 }, (_, i) => ({ text: "fault " + i })) }, 10);
  assert.match(m, /^its layout has 12 problems, measured by rendering it: fault 0; /);
  assert.match(m, /fault 9; and 2 more like these/);
  assert.doesNotMatch(m, /fault 10/);
});

// A real browser, when there is one (Omarchy ships Chromium; CI images may not). The tests' pages
// are their own, so they run without the sandbox, which Ubuntu 24.04 (CI) blocks.
const browser = (() => {
  const { spawnSync } = require("node:child_process");
  for (const b of ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"]) {
    const r = spawnSync("sh", ["-c", 'command -v "$1"', "sh", b], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : "";
})();

let failed = null;
const onFail = (f) => { failed = f; };

test("layout: measured in a browser: overlaps, lines through labels, shape edges, the canvas", { skip: !browser && "no Chromium-based browser" }, async () => {
  const { measureLayout } = await L();
  const clean = await measureLayout(svg('<text x="40" y="60" font-size="16">Alone</text><circle cx="300" cy="120" r="40" fill="#c7d2fe"/>'), { browser, onFail, sandbox: false, timeoutMs: 90000 });
  assert.ok(clean, "not measured: " + JSON.stringify(failed));
  assert.equal(clean.problems.length, 0, JSON.stringify(clean.problems));
  const r = await measureLayout(svg([
    '<text x="40" y="60" font-size="16">First label</text><text x="70" y="62" font-size="16">Second</text>', // overlap
    '<path d="M 20 120 L 380 120" stroke="#0f766e" stroke-width="3" fill="none"/><text x="150" y="126" font-size="16">On the line</text>', // a line through it
    '<circle cx="330" cy="60" r="30" fill="#fde68a"/><text x="340" y="66" font-size="16">Half in</text>', // across a shape's edge
    '<text x="330" y="190" font-size="16">Off the canvas edge</text>', // off the canvas
  ].join("")), { browser, onFail, sandbox: false, timeoutMs: 90000 });
  assert.ok(r, "not measured: " + JSON.stringify(failed));
  const kinds = r.problems.map((p) => p.kind).sort();
  assert.deepEqual([...new Set(kinds)], ["edge", "line", "shape", "text"], JSON.stringify(r.problems, null, 1));
  assert.match(r.problems.find((p) => p.kind === "text").text, /"First label" \(x \d+–\d+, y \d+–\d+\) and "Second" .* overlap/);
  assert.equal(r.svg, "");
});

test("layout: repair moves a label a little, moves a badge with its label, halos a line it can't escape", { skip: !browser && "no Chromium-based browser" }, async () => {
  const { measureLayout } = await L();
  const r = await measureLayout(svg([
    // overlapping by a few pixels in any sans font ("First label" is about 70–82px wide at 16px): a small move clears it
    '<text x="40" y="60" font-size="16">First label</text><text x="100" y="60" font-size="16">Next</text>',
    '<g><rect x="200" y="40" width="70" height="26" rx="13" fill="#ccfbf1"/><text x="210" y="58" font-size="14">badge</text></g><text x="262" y="58" font-size="14">beside</text>',
    // hatching 8px apart (narrower than a label's ink) over more than the label plus the largest move (28px) each way:
    // no move clears it in any font, so it gets a halo
    Array.from({ length: 14 }, (_, i) => 92 + 8 * i).map((y) => `<path d="M 0 ${y} L 400 ${y}" stroke="#0f766e" stroke-width="2" fill="none"/>`).join("") + '<text x="20" y="156" font-size="16">A long label along the whole line here</text>',
  ].join("")), { browser, repair: true, onFail, sandbox: false, timeoutMs: 90000 });
  assert.ok(r, "not measured: " + JSON.stringify(failed));
  assert.ok(r.found.length >= 3, JSON.stringify(r.found));
  assert.equal(r.problems.length, 0, JSON.stringify(r.problems));
  assert.ok(r.moved >= 1 && r.haloed === 1);
  assert.match(r.svg, /paint-order="stroke"/);
  // the badge's label moved with its badge (the group), or the other label moved: never apart
  const g = r.svg.match(/<g[^>]*>/)[0];
  const t = r.svg.match(/<text[^>]*>badge<\/text>/)[0];
  assert.ok(!/transform/.test(t), "the badge's text isn't moved on its own: " + t + " in " + g);
});

// ---------------------------------------------------------------- the run

const good = svg('<text x="40" y="60">ok</text>');
const measured = (seq) => {
  const calls = [];
  const fn = async (source, { repair }) => {
    calls.push({ source, repair });
    const next = seq.shift();
    return typeof next === "function" ? next(source, repair) : next;
  };
  fn.calls = calls;
  return fn;
};
const audit = (n, extra = {}) => ({ width: 400, height: 200, lines: 3, found: Array.from({ length: n }, (_, i) => ({ kind: "text", text: "f" + i })), problems: Array.from({ length: n }, (_, i) => ({ kind: "text", text: "f" + i })), moved: 0, haloed: 0, svg: "", ...extra });

test("produce: a clean measured image is kept as drawn, with no retry", async () => {
  const { produce } = await A();
  const measure = measured([audit(0)]);
  const r = await produce("image", [{ role: "user", content: "draw" }], async () => ({ text: good }), { measure });
  assert.equal(r.retried, false);
  assert.equal(r.error, "");
  assert.deepEqual(r.layout, { found: 0, moved: 0, haloed: 0, left: 0 });
  assert.equal(measure.calls.length, 1);
});

test("produce: layout faults go back once with their positions; the retry's faults are repaired", async () => {
  const { produce } = await A();
  const sent = [];
  const answers = [good, good.replace("ok", "ok2")];
  const measure = measured([
    audit(3), // first draft, measured
    audit(1), // the retry, measured
    audit(1, { found: [{}], problems: [], moved: 1, svg: good.replace("ok", "fixed") }), // the retry, repaired
    audit(3, { problems: [{}, {}], moved: 1, svg: good }), // the first, repaired: worse
  ]);
  const r = await produce("image", [{ role: "user", content: "draw" }], async (m) => { sent.push(m); return { text: answers[sent.length - 1] }; }, { measure });
  assert.equal(r.retried, true);
  assert.match(sent[1][2].content, /its layout has 3 problems, measured by rendering it: f0; f1; f2/);
  assert.equal(r.error, "");
  assert.match(r.source, />fixed</);
  assert.equal(r.layout.left, 0);
  assert.deepEqual(measure.calls.map((c) => c.repair), [false, false, true, true]);
});

test("produce: a retry that breaks the format leaves the first image, repaired", async () => {
  const { produce } = await A();
  let n = 0;
  const measure = measured([audit(2), audit(2, { problems: [{}], moved: 1, svg: good.replace("ok", "first-fixed") })]);
  const r = await produce("image", [{ role: "user", content: "draw" }], async () => ({ text: n++ ? "sorry, no svg" : good }), { measure });
  assert.equal(r.error, "");
  assert.match(r.source, /first-fixed/);
  assert.deepEqual(r.layout, { found: 2, moved: 1, haloed: 0, left: 1 });
});

test("produce: without a browser the layout is estimated as before", async () => {
  const { produce } = await A();
  const measure = measured([null]);
  const r = await produce("image", [{ role: "user", content: "draw" }], async () => ({ text: good }), { measure });
  assert.equal(r.error, "");
  assert.equal(r.layout, null);
});
