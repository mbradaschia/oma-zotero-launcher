// Artifacts: the output formats (daemon/lib/formats.mjs), the store and the chat protocol
// (daemon/lib/artifacts.mjs), the pinned drawing libraries (daemon/lib/libs.mjs), and the
// launcher's rows for them (lib/Views.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const V = require("../lib/Views.js");

const F = () => import("../daemon/lib/formats.mjs");
const A = () => import("../daemon/lib/artifacts.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "oma-art-"));

test("formats: the answer taken apart (fences, preambles), per format", async () => {
  const { extract } = await F();
  assert.equal(extract("diagram", "Sure! Here:\n```mermaid\nflowchart TD\n A --> B\n```\nHope it helps"), "flowchart TD\n A --> B");
  assert.equal(extract("diagram", "Here is the diagram:\nflowchart LR\n A --> B"), "flowchart LR\n A --> B");
  assert.equal(extract("mindmap", "Here:\n\n# Centre\n## Branch\n- leaf"), "# Centre\n## Branch\n- leaf");
  assert.equal(extract("image", 'Here: <svg viewBox="0 0 1 1"><rect/></svg> done'), '<svg viewBox="0 0 1 1"><rect/></svg>');
  assert.equal(extract("html", "x <!DOCTYPE html><html><body><p>a</p></body></html> y"), "<!DOCTYPE html><html><body><p>a</p></body></html>");
  assert.equal(extract("markdown", "```md\n# T\n\ntext\n```"), "# T\n\ntext");
});

test("formats: no scripts, event handlers or outside resources", async () => {
  const { sanitize } = await F();
  const svg = sanitize("image", '<svg viewBox="0 0 9 9" onload="x()"><script>alert(1)</script><a href="javascript:x()"><text>t</text></a><image href="https://e.x/p.png"/><image xlink:href="data:image/png;base64,AA"/><use href="#a"/><foreignObject><div/></foreignObject><style>@import url(https://e.x/f.css); .a{fill:url(#g)} .b{background:url(https://e.x/b.png)}</style></svg>');
  assert.doesNotMatch(svg, /onload|<script|javascript:|https:|foreignObject|@import/);
  assert.match(svg, /xlink:href="data:image\/png;base64,AA"/);
  assert.match(svg, /href="#a"/);
  assert.match(svg, /url\(#g\)/);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox/); // added when missing
  assert.equal(sanitize("html", '<p onclick="x">a</p><script src="x.js"></script><script>y()</script>'), "<p>a</p>");
});

test("formats: checked before saving; what is wrong goes back to the model", async () => {
  const { validate } = await F();
  assert.equal(validate("diagram", 'flowchart TD\n A["Theory (RBV)"] --> B>"Asym"]\n C("x") -->|"y"| D'), "");
  assert.match(validate("diagram", "Here it is\nA --> B"), /first line must name the diagram type/);
  assert.match(validate("diagram", 'flowchart TD\n A["x] --> B'), /line 2 has an unmatched double quote/);
  assert.match(validate("diagram", "flowchart TD\n A[Theory (RBV] --> B"), /line 2 has unbalanced brackets/);
  assert.equal(validate("mindmap", "# C\n## A\n- a\n- b"), "");
  assert.match(validate("mindmap", "- a\n- b\n- c\n- d"), /no "# " centre heading/);
  assert.match(validate("mindmap", "# C\n- a"), /too few nodes/);
  assert.equal(validate("image", '<svg viewBox="0 0 1 1"></svg>'), "");
  assert.match(validate("image", "<svg></svg>"), /no viewBox/);
  assert.match(validate("image", "<p>no</p>"), /not one SVG image/);
  assert.match(validate("html", "<p>only a fragment</p>"), /not a complete HTML page/);
  assert.equal(validate("html", "<!doctype html><html><body><h1>T</h1></body></html>"), "");
  assert.match(validate("markdown", " "), /empty/);
});

test("formats: the views: a policy that keeps scripts and the network out; the libraries only where needed", async () => {
  const { renderView } = await F();
  const md = renderView("markdown", "# T\n\n<script>x()</script>\n\n**b**", { title: "Doc", subtitle: "S" });
  assert.match(md, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"/);
  assert.match(md, /<strong>b<\/strong>/);
  assert.doesNotMatch(md, /<script>x/);
  const html = renderView("html", "<!doctype html><html><head><title>x</title></head><body><h1>T</h1></body></html>");
  assert.match(html, /<head>\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'/);
  const d = renderView("diagram", 'flowchart TD\n A["</script><script>alert(1)</script>"]', { title: "D", lib: "../../.lib" });
  assert.match(d, /script-src 'unsafe-inline' file:/);
  assert.match(d, /<script src="..\/..\/.lib\/mermaid.min.js"><\/script>/);
  assert.match(d, /securityLevel:"strict"/);
  assert.doesNotMatch(d, /<\/script><script>alert/); // the source can't close its data element
  assert.match(d, /\\u003c\/script\\u003e/);
  const m = renderView("mindmap", "# C\n- a", { title: "M" });
  for (const lib of ["d3.min.js", "markmap-lib.js", "markmap-view.js"]) assert.match(m, new RegExp(lib.replace(/\./g, "\\.")));
  assert.doesNotMatch(renderView("image", '<svg viewBox="0 0 1 1"></svg>'), /<script/);
});

test("store: a folder per paper, every version kept; the current file and its view", async () => {
  const { saveArtifact, listArtifacts, listAllArtifacts, loadArtifact, readSource, undoArtifact, renameArtifact, deleteArtifact, findPaperDir, artifactsRoot } = await A();
  const root = tmp();
  const t0 = new Date("2026-09-30T10:00:00Z");
  const a = saveArtifact(root, { key: "ABCD1234", libraryID: 1, paper: "Sirmon et al., 2007", title: "Theory Map", format: "mindmap", source: "# C\n## A\n- a\n- b", by: "prompt:theory-map", model: "m", now: t0 });
  assert.equal(path.basename(findPaperDir(root, "ABCD1234", 1)), "sirmon-et-al-2007_1-ABCD1234");
  assert.deepEqual([a.id, a.version, a.isNew, a.formatLabel], ["theory-map", 1, true, "Mind map"]);
  assert.ok(fs.existsSync(a.view) && fs.existsSync(a.file) && a.file.endsWith("theory-map.md"));
  assert.match(fs.readFileSync(a.view, "utf8"), /Sirmon et al., 2007 · Mind map · version 1 of 1 · 2026-09-30/);
  // a new version of the same id; the title can change (not through "edit")
  const b = saveArtifact(root, { key: "ABCD1234", libraryID: 1, id: "theory-map", title: "Theory Map", format: "mindmap", source: "# C\n## A\n- a\n- b\n- c", by: "edit", instruction: "add c", now: new Date("2026-09-30T11:00:00Z") });
  assert.deepEqual([b.id, b.version, b.isNew, b.versions], ["theory-map", 2, false, 2]);
  assert.match(fs.readFileSync(b.file, "utf8"), /- c/);
  // another one with a taken title gets a free id; a format change keeps one current file
  const c = saveArtifact(root, { key: "ABCD1234", title: "Theory Map", format: "diagram", source: "flowchart TD\n A --> B", now: new Date("2026-09-30T12:00:00Z") });
  assert.equal(c.id, "theory-map-2");
  const d = saveArtifact(root, { key: "ABCD1234", id: "theory-map-2", title: "As an image", format: "image", source: '<svg viewBox="0 0 1 1"></svg>', now: new Date("2026-09-30T13:00:00Z") });
  assert.deepEqual([d.format, d.title, path.basename(d.file)], ["image", "As an image", "theory-map-2.svg"]);
  assert.ok(!fs.existsSync(path.join(d.dir, "theory-map-2.mmd")));
  assert.deepEqual(listArtifacts(root, "ABCD1234", 1).map((x) => x.id), ["theory-map-2", "theory-map"]); // the latest changed first
  // undo: back one version (the later ones stay); the format of that version comes back
  const u = undoArtifact(root, "ABCD1234", 1, "theory-map-2");
  assert.deepEqual([u.current, u.versions, u.format], [1, 2, "diagram"]);
  assert.ok(fs.existsSync(path.join(u.dir, "theory-map-2.mmd")) && !fs.existsSync(path.join(u.dir, "theory-map-2.svg")));
  assert.throws(() => undoArtifact(root, "ABCD1234", 1, "theory-map-2"), /first version/);
  const { dir, meta } = loadArtifact(root, "ABCD1234", 1, "theory-map");
  assert.equal(readSource(dir, meta, 1), "# C\n## A\n- a\n- b\n");
  assert.equal(meta.versions[1].instruction, "add c");
  assert.equal(renameArtifact(root, "ABCD1234", 1, "theory-map", "  The map ").title, "The map");
  assert.throws(() => renameArtifact(root, "ABCD1234", 1, "theory-map", " "), /can't be empty/);
  // another paper, another library
  saveArtifact(root, { key: "WXYZ9876", libraryID: 2, paper: "", title: "Doc", format: "markdown", source: "# Doc\n\nSome text here." });
  assert.equal(path.basename(findPaperDir(root, "WXYZ9876", 2)), "2-WXYZ9876");
  assert.deepEqual(listAllArtifacts(root).map((x) => [x.key, x.libraryID, x.id]).sort(), [["ABCD1234", 1, "theory-map"], ["ABCD1234", 1, "theory-map-2"], ["WXYZ9876", 2, "doc"]]);
  deleteArtifact(root, "ABCD1234", 1, "theory-map-2");
  assert.deepEqual(listArtifacts(root, "ABCD1234", 1).map((x) => x.id), ["theory-map"]);
  assert.throws(() => loadArtifact(root, "ABCD1234", 1, "../x"), /bad artifact id/);
  assert.throws(() => saveArtifact(root, { key: "ABCD1234", title: "x", format: "note", source: "x" }), /bad artifact format/);
  assert.equal(artifactsRoot({ artifactsDir: "~/Research/art" }, { HOME: "/h" }), "/h/Research/art");
  assert.equal(artifactsRoot({}, { HOME: "/h" }), "/h/.local/state/oma-zotero/artifacts");
});

test("chat: artifact blocks in an answer saved as links; an unclosed one says it was cut off", async () => {
  const { findArtifactBlocks, replaceArtifactBlocks, artifactLink } = await A();
  const answer = 'I drew it.\n\n<artifact id="Flow" format="diagram" title="The flow">\nflowchart TD\n A --> B\n</artifact>\n\nAnd a map:\n<artifact format="mindmap" title="Map">\n# C\n- a\n</artifact>\nDone.\n<artifact id="x" format="image" title="Cut">\n<svg';
  const { blocks, cut } = findArtifactBlocks(answer);
  assert.deepEqual(blocks.map((b) => [b.id, b.format, b.title, b.content]), [["flow", "diagram", "The flow", "flowchart TD\n A --> B"], ["", "mindmap", "Map", "# C\n- a"]]);
  assert.match(cut, /^<artifact id="x"/);
  const text = replaceArtifactBlocks(answer, blocks, (b) => artifactLink({ id: b.id || "map", title: b.title, format: b.format, version: 1 }), cut);
  assert.equal(text, "I drew it.\n\n[▣ The flow · Diagram, version 1](oma-artifact:flow)\n\nAnd a map:\n\n[▣ Map · Mind map, version 1](oma-artifact:map)\n\nDone.\n\n*(An artifact was cut off before it ended, so it wasn't saved: ask again.)*");
  assert.deepEqual(findArtifactBlocks("no artifacts").blocks, []);
});

test("chat: the system prompt section lists the paper's artifacts with their text, within a budget", async () => {
  const { chatArtifactsSection } = await A();
  assert.match(chatArtifactsSection([], () => ""), /format is one of these[\s\S]*mindmap \(a mind map\)[\s\S]*The paper has no artifacts yet\.$/);
  const list = [{ id: "flow", format: "diagram", title: "Flow", current: 2 }, { id: "big", format: "markdown", title: "Big", current: 1 }];
  const s = chatArtifactsSection(list, (a) => (a.id === "flow" ? "flowchart TD\n A --> B" : "x".repeat(500)), 100);
  assert.match(s, /- id "flow": Diagram "Flow" \(version 2\)\n<current id="flow">\nflowchart TD\n A --> B\n<\/current>/);
  assert.match(s, /- id "big": Markdown file "Big" \(version 1\)\n  \(too long to include here/);
});

test("making one: checked, and asked once more with what was wrong", async () => {
  const { produce } = await A();
  const calls = [];
  const answers = ['flowchart TD\n A["x --> B', 'flowchart TD\n A["x"] --> B["y"]'];
  const r = await produce("diagram", [{ role: "user", content: "draw" }], async (m) => { calls.push(m); return { text: answers[calls.length - 1] }; });
  assert.deepEqual([r.retried, r.error, r.source], [true, "", 'flowchart TD\n A["x"] --> B["y"]']);
  assert.equal(calls[1].length, 3);
  assert.match(calls[1][2].content, /^That can't be used: line 2 has an unmatched double quote/);
  const ok = await produce("mindmap", [{ role: "user", content: "map" }], async () => ({ text: "# C\n## A\n- a\n- b" }));
  assert.deepEqual([ok.retried, ok.error], [false, ""]);
});

test("libraries: fetched once, checked by SHA-256, the second address when the first fails", async () => {
  const { ensureLibs, LIBS, sha256 } = await import("../daemon/lib/libs.mjs");
  const dir = tmp();
  const good = Buffer.from("the library");
  const saved = LIBS["d3.min.js"].sha256;
  LIBS["d3.min.js"].sha256 = sha256(good);
  try {
    const seen = [];
    const fetchImpl = async (url) => {
      seen.push(url);
      if (url.includes("jsdelivr")) throw new Error("offline");
      return { ok: true, arrayBuffer: async () => good };
    };
    assert.deepEqual(await ensureLibs(dir, ["d3.min.js"], fetchImpl), { ok: true, missing: [], error: "" });
    assert.equal(fs.readFileSync(path.join(dir, "d3.min.js"), "utf8"), "the library");
    assert.deepEqual(seen.map((u) => new URL(u).host), ["cdn.jsdelivr.net", "unpkg.com"]);
    assert.deepEqual(await ensureLibs(dir, ["d3.min.js"], async () => { throw new Error("not called"); }), { ok: true, missing: [], error: "" }); // there already
    const bad = await ensureLibs(tmp(), ["d3.min.js"], async () => ({ ok: true, arrayBuffer: async () => Buffer.from("tampered") }));
    assert.deepEqual([bad.ok, bad.missing], [false, ["d3.min.js"]]);
    assert.match(bad.error, /checksum/);
  } finally {
    LIBS["d3.min.js"].sha256 = saved;
  }
  for (const l of Object.values(LIBS)) assert.match(l.sha256, /^[0-9a-f]{64}$/);
  assert.equal(crypto.createHash("sha256").update("").digest("hex").length, 64);
});

test("launcher: a paper's Artifacts, the artifact menu, what to change, Processes opens one", () => {
  const a = { id: "theory-map", title: "Theory Map", format: "mindmap", formatLabel: "Mind map", current: 2, versions: 3, updated: "2026-09-30T11:00:00Z", by: "edit",
    key: "ABCD1234", libraryID: 1, paper: "Sirmon et al., 2007", view: "/a/theory-map.html", file: "/a/theory-map.md", dir: "/a" };
  const details = { item: { itemType: "journalArticle" }, attachments: [], notes: [], tags: [], library: { editable: true } };
  const rows = V.buildActions(details, "", [], "", false, false, { artifacts: [a] });
  const r = rows.find((x) => x.rowId === "artifact");
  assert.deepEqual([r.section, r.label, r.detail, r.path, r.value, r.itemKey], ["Artifacts", "Theory Map", "Mind map · version 2 of 3 · 2026-09-30 · changed with AI", "/a/theory-map.html", "theory-map", "ABCD1234"]);
  const menu = V.buildArtifactMenu(a);
  assert.deepEqual(menu.map((x) => [x.rowId, x.available]), [["art-open", true], ["art-change", true], ["art-source", true], ["art-undo", true], ["art-rename", true], ["art-folder", true], ["art-delete", true]]);
  assert.equal(menu.find((x) => x.rowId === "art-undo").detail, "Back to version 1 of 3");
  assert.equal(menu.find((x) => x.rowId === "art-source").detail, "Opens the outline (Markdown) in your editor");
  assert.equal(V.buildArtifactMenu(Object.assign({}, a, { current: 1 })).find((x) => x.rowId === "art-undo").available, false);
  assert.deepEqual(V.buildArtifactChangeRows(a, " deeper ", true).map((x) => [x.label, x.available, x.value]), [["Change it: “deeper”", true, "deeper"]]);
  assert.equal(V.buildArtifactChangeRows(a, "x", false)[0].available, false);
  assert.equal(V.buildArtifactChangeRows(a, "", true)[0].available, false);
  const tasks = V.buildTaskRows([{ id: "t1", kind: "artifact", title: "Change “Theory Map”", status: "done", started: "2026-09-30T10:00:00Z", finished: "2026-09-30T10:01:00Z", artifactView: "/a/theory-map.html", detail: "version 3" }],
    "", "", (xs) => xs.map((item) => ({ item, positions: [] })), new Date("2026-09-30T10:05:00Z"));
  const t = tasks.find((x) => x.rowId === "task");
  assert.equal(t.path, "/a/theory-map.html");
  assert.match(t.detail, /Enter opens it$/);
});
