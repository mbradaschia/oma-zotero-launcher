// An image's layout, measured where it will be seen: the SVG is laid out by a headless Chromium
// (the browser Omarchy ships, or another Chromium-based one) with this machine's fonts, and every
// line of text is checked against the others, the canvas, the lines and the shapes. The findings
// are written for the model, with positions in the SVG's own coordinates, so its one retry can
// fix them. Without such a browser the caller falls back to formats.mjs's estimate.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const BROWSERS = ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome", "brave-browser", "brave", "microsoft-edge-stable", "vivaldi-stable"];

// The path of a Chromium-based browser, or "". OMA_ZOTERO_BROWSER picks one (or "none" for none).
export function findBrowser(env = process.env) {
  const pick = env.OMA_ZOTERO_BROWSER;
  if (pick === "none") return "";
  for (const b of pick ? [pick] : BROWSERS) {
    const r = spawnSync("sh", ["-c", 'command -v "$1"', "sh", b], { encoding: "utf8", env });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return "";
}

// The rules, in pixels of the SVG's viewBox.
export const RULES = { gap: 6, edge: 12, radii: [4, 8, 12, 16, 22, 28] };

// Runs in the page: measures, repairs what a small move can, and reports. Kept free of outside
// names: it is sent as source.
function audit(rules) {
  const svg = document.querySelector("svg");
  const out = document.getElementById("out");
  if (!svg || !svg.viewBox.baseVal || !svg.viewBox.baseVal.width) { out.textContent = JSON.stringify({ error: "no viewBox" }); return; }
  const vb = svg.viewBox.baseVal, W = vb.width, H = vb.height;
  const sr = svg.getBoundingClientRect(), k = sr.width / W;
  const toVB = (r) => ({ x: (r.left - sr.left) / k + vb.x, y: (r.top - sr.top) / k + vb.y, w: r.width / k, h: r.height / k });
  const skip = (e) => e.closest("defs,marker,clipPath,mask,pattern,symbol");
  const texts = [...svg.querySelectorAll("text")].filter((t) => !skip(t));
  // One box per line on the canvas: a tspan that starts its own line, else the whole text.
  const linesOf = (t) => {
    const own = [...t.querySelectorAll("tspan")].filter((s) => s.hasAttribute("x") || s.hasAttribute("y") || s.hasAttribute("dy"));
    const r = [];
    for (const e of own.length ? own : [t]) {
      const bb = e.getBoundingClientRect();
      const s = (e.textContent || "").replace(/\s+/g, " ").trim();
      if (bb.width < 1 || !s) continue;
      const b = toVB(bb);
      // the line box includes the font's ascent and descent; the ink is its middle band
      r.push({ text: t, s: s.length > 36 ? s.slice(0, 34) + "…" : s, b, ink: { x: b.x + 1, y: b.y + b.h * 0.15, w: Math.max(0, b.w - 2), h: b.h * 0.67 } });
    }
    return r;
  };
  const geo = [...svg.querySelectorAll("path,line,polyline,polygon,rect,circle,ellipse")].filter((g) => !skip(g)).map((g) => {
    const st = getComputedStyle(g), op = parseFloat(st.opacity);
    const b = toVB(g.getBoundingClientRect());
    return { g, get b() { return toVB(g.getBoundingClientRect()); }, st, stroked: st.stroke !== "none" && parseFloat(st.strokeWidth) > 0 && parseFloat(st.strokeOpacity) * op > 0.2,
      filled: st.fill !== "none" && parseFloat(st.fillOpacity) * op > 0.2 && g.tagName !== "line" && g.tagName !== "polyline",
      background: b.w > W * 0.6 && b.h > H * 0.6 };
  }).filter((x) => !x.background && (x.stroked || x.filled));
  const at = (b) => `x ${Math.round(b.x)}–${Math.round(b.x + b.w)}, y ${Math.round(b.y)}–${Math.round(b.y + b.h)}`;
  const q = (l) => `"${l.s}"`;
  const grow = (b, d) => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
  const meets = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const name = (g) => ({ path: "a curve", line: "a line", polyline: "a line", polygon: "a shape", rect: "a rectangle", circle: "a circle", ellipse: "an ellipse" })[g.tagName] || "a shape";
  const pt = svg.createSVGPoint();
  // The problems of every line (against the others, the canvas and the shapes); `only`: just
  // those that involve an element (a text, or a group being moved).
  const check = (only) => {
    const lines = texts.flatMap(linesOf);
    const found = [];
    const mine = (l) => !only || only.contains(l.text);
    for (let i = 0; i < lines.length; i++) {
      const a = lines[i];
      if (mine(a)) {
        const e = rules.edge;
        if (a.ink.x < vb.x + e || a.ink.y < vb.y + e || a.ink.x + a.ink.w > vb.x + W - e || a.ink.y + a.ink.h > vb.y + H - e)
          found.push({ kind: "edge", texts: [a.text], boxes: [a.b], text: `${q(a)} (${at(a.b)}) ${a.ink.x + a.ink.w > vb.x + W || a.ink.x < vb.x ? "runs off" : "touches the edge of"} the ${W}×${H} canvas: keep ${e}px clear` });
      }
      for (let j = i + 1; j < lines.length; j++) {
        const c = lines[j];
        if (c.text === a.text || !(mine(a) || mine(c))) continue;
        if (meets(grow(a.ink, rules.gap / 2), grow(c.ink, rules.gap / 2)))
          found.push({ kind: "text", texts: [a.text, c.text], boxes: [a.b, c.b], text: `${q(a)} (${at(a.b)}) and ${q(c)} (${at(c.b)}) ${meets(a.ink, c.ink) ? "overlap" : "touch"}: keep ${rules.gap}px between labels` });
      }
      const shapes = mine(a) ? geo : geo.filter((x) => only.contains(x.g));
      if (!shapes.length) continue;
      const A = a.ink, pts = [];
      const nx = Math.max(2, Math.ceil(A.w / 3)), ny = Math.max(3, Math.ceil(A.h / 1.5)); // denser than the thinnest line
      for (let ix = 0; ix <= nx; ix++) for (let iy = 0; iy <= ny; iy++) pts.push([A.x + (A.w * ix) / nx, A.y + (A.h * iy) / ny]);
      for (const x of shapes) {
        const xb = x.b;
        if (!meets(xb, A)) continue;
        const m = x.g.getScreenCTM().inverse();
        const count = (f) => pts.filter(([px, py]) => { pt.x = sr.left + (px - vb.x) * k; pt.y = sr.top + (py - vb.y) * k; return f(pt.matrixTransform(m)); }).length;
        if (x.stroked && count((p) => x.g.isPointInStroke(p)) > 0) {
          found.push({ kind: "line", texts: [a.text], boxes: [a.b], text: `${name(x.g)} (${at(xb)}, stroke ${x.st.stroke}) runs through ${q(a)} (${at(a.b)}): move the label clear of it, or route it around the label` });
          continue;
        }
        if (x.filled) {
          const f = count((p) => x.g.isPointInFill(p)) / pts.length;
          if (f > 0.08 && f < 0.92)
            found.push({ kind: "shape", texts: [a.text], boxes: [a.b], text: `${q(a)} (${at(a.b)}) sits across the edge of ${name(x.g)} (${at(xb)}, fill ${x.st.fill}): put it wholly inside with room to spare, or wholly outside` });
        }
      }
    }
    return found;
  };
  const before = check(null);
  // Repair: move a label that has problems a little (the nearest spot that clears all of them),
  // smallest labels first; a label that runs off the canvas may also shrink a little.
  let moved = 0;
  if (rules.repair && before.length) {
    const size = (t) => parseFloat(getComputedStyle(t).fontSize) || 16;
    const bad = [...new Set(before.flatMap((p) => p.texts))].sort((a, b) => size(a) - size(b));
    // What moves with a label: the small group it is drawn in with its badge or bubble, if it is.
    const small = (b) => b.w < W * 0.3 && b.h < H * 0.2;
    const mover = (t) => {
      const g = t.parentElement;
      if (g && g !== svg && g.tagName === "g" && g.children.length <= 4 && small(toVB(g.getBoundingClientRect()))) return g;
      // a label inside a shape drawn apart from it stays put (moving it would leave the shape)
      const tb = toVB(t.getBoundingClientRect());
      const inside = geo.some((x) => x.filled && !x.g.contains(t) && small(x.b) && x.b.x <= tb.x && x.b.y <= tb.y && x.b.x + x.b.w >= tb.x + tb.w && x.b.y + x.b.h >= tb.y + tb.h);
      return inside ? null : t;
    };
    const done = new Set();
    for (const t of bad) {
      const m = mover(t);
      if (!m || done.has(m)) continue;
      done.add(m);
      const now = check(m);
      if (!now.length) continue;
      const base = m.getAttribute("transform") || "";
      const fs = t.style.fontSize;
      const scales = now.some((p) => p.kind === "edge") ? [1, 0.92, 0.85] : [1];
      let ok = false;
      search: for (const s of scales) {
        if (s !== 1) t.style.fontSize = size(t) * s + "px";
        for (const r of rules.radii) for (let d = 0; d < 360; d += 45) {
          const dx = Math.round(r * Math.cos((d * Math.PI) / 180)), dy = Math.round(r * Math.sin((d * Math.PI) / 180));
          m.setAttribute("transform", `translate(${dx} ${dy})${base ? " " + base : ""}`);
          if (!check(m).length) { ok = true; break search; }
        }
        t.style.fontSize = fs;
      }
      if (ok) moved++;
      else { if (base) m.setAttribute("transform", base); else m.removeAttribute("transform"); t.style.fontSize = fs; }
    }
  }
  let after = moved ? check(null) : before;
  // A line that still runs through a label passes behind it: the label gets a halo of the
  // background's colour (as maps do), unless it sits on a coloured shape.
  let haloed = 0;
  if (rules.repair) {
    const bg = (() => {
      const first = [...svg.querySelectorAll("rect")].find((x) => { const b = toVB(x.getBoundingClientRect()); return b.w >= W * 0.95 && b.h >= H * 0.95; });
      const f = first && getComputedStyle(first).fill;
      return f && /^rgb/.test(f) ? f : "#ffffff";
    })();
    const onShape = (t) => { const tb = toVB(t.getBoundingClientRect()); return geo.some((x) => x.filled && !x.g.contains(t) && meets(x.b, tb)); };
    for (const t of new Set(after.filter((p) => p.kind === "line").flatMap((p) => p.texts))) {
      if (onShape(t) || after.some((p) => p.kind !== "line" && p.texts.includes(t))) continue;
      t.setAttribute("paint-order", "stroke");
      t.setAttribute("stroke", bg);
      t.setAttribute("stroke-width", "5");
      t.setAttribute("stroke-linejoin", "round");
      haloed++;
    }
    if (haloed) after = after.filter((p) => !(p.kind === "line" && p.texts.every((t) => t.getAttribute("paint-order") === "stroke")));
  }
  const clean = (ps) => ps.map((p) => ({ kind: p.kind, text: p.text, boxes: p.boxes }));
  out.textContent = JSON.stringify({ width: W, height: H, lines: texts.flatMap(linesOf).length, found: clean(before), problems: clean(after), moved, haloed,
    svg: moved || haloed ? new XMLSerializer().serializeToString(svg) : "" });
}

// A page that lays the SVG out at its own size and runs the audit (only that script may run, and
// nothing may load).
export function auditPage(svg, rules = RULES) {
  const nonce = randomBytes(12).toString("base64");
  const vb = (String(svg).match(/viewBox="([^"]+)"/) || [])[1] || "0 0 1200 800";
  const [, , w, h] = vb.split(/[\s,]+/).map(Number);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; font-src data:">
<style>html,body{margin:0;background:#fff}svg{display:block;width:${w || 1200}px;height:${h || 800}px;font-family:system-ui,sans-serif}</style></head>
<body>${svg}<pre id="out"></pre>
<script nonce="${nonce}">(${audit.toString()})(${JSON.stringify(rules)})</script></body></html>`;
}

// Parse the audit the page wrote (its #out text). → { width, height, lines, found, problems:
// [{ kind, text, boxes }], moved, haloed, svg } or null.
export function readAudit(text) {
  try {
    const r = JSON.parse(String(text || ""));
    return r && Array.isArray(r.problems) ? r : null;
  } catch {
    return null;
  }
}

// Measure an SVG in the browser. → the audit, or null when it can't be measured (no browser, a
// crash, a timeout): the caller then uses the estimate.
// `repair`: also move labels a little and halo those lines still cross (the result's svg, when
// anything changed). `onFail({ reason, code, stderr })`: why it couldn't be measured. `sandbox`:
// false only for trusted pages (the tests' own); an image a model wrote is always sandboxed, except
// as root, where Chromium won't run with one.
// The page's result is read over the DevTools protocol on a pipe (fds 3 and 4), as Puppeteer and
// Playwright do: --dump-dom behaves differently across Chrome versions (some never exit, some print
// nothing to a pipe).
export function measureLayout(svg, { browser, env = process.env, timeoutMs = 45000, repair = false, onFail = null, sandbox = true } = {}) {
  const bin = browser === undefined ? findBrowser(env) : browser;
  if (!bin) return Promise.resolve(null);
  const dir = mkdtempSync(join(tmpdir(), "oma-zotero-layout-"));
  const html = auditPage(svg, { ...RULES, repair });
  const args = ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    // nothing of Chrome's own that calls out (updates, sync, safe browsing, field trials, pings)
    "--disable-background-networking", "--disable-sync", "--disable-component-update", "--disable-domain-reliability",
    "--disable-client-side-phishing-detection", "--disable-default-apps", "--no-pings", "--metrics-recording-only",
    "--disable-field-trial-config", "--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider", "--mute-audio",
    "--user-data-dir=" + join(dir, "profile"), "--remote-debugging-pipe", "about:blank"];
  if (!sandbox || (typeof process.getuid === "function" && process.getuid() === 0)) args.unshift("--no-sandbox");
  return new Promise((resolve) => {
    let err = "";
    let done = false;
    let timer = null;
    let child = null;
    let code;
    const finish = (r, why) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child && child.kill("SIGKILL"); } catch {}
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
      if (!r && /ZygoteHost|No usable sandbox|setuid sandbox/i.test(err))
        why = "the browser's sandbox couldn't start (Ubuntu 23.10 and later block it unless the browser has an AppArmor profile)";
      if (!r && onFail) onFail({ reason: why || "no audit in the page", code, stderr: err.slice(-2000) });
      resolve(r);
    };
    try {
      child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], env });
    } catch (e) {
      return finish(null, e.message);
    }
    let stage = "starting the browser"; // where it stalled, if it does
    timer = setTimeout(() => finish(null, "timed out " + stage), timeoutMs);
    child.on("error", (e) => finish(null, e.message));
    child.on("exit", (c) => { code = c; setTimeout(() => finish(null, `the browser quit (${c})`), 50); });
    child.stderr.on("data", (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    // the protocol: JSON messages ended by a NUL byte, each way
    const pending = new Map();
    let seq = 0;
    let buf = "";
    const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
      const id = ++seq;
      pending.set(id, { ok, no });
      try { child.stdio[3].write(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }) + "\0"); } catch (e) { no(e); }
    });
    child.stdio[3].on("error", () => {});
    child.stdio[4].on("data", (d) => {
      buf += d;
      let k;
      while ((k = buf.indexOf("\0")) >= 0) {
        let m = null;
        try { m = JSON.parse(buf.slice(0, k)); } catch {}
        buf = buf.slice(k + 1);
        const p = m && m.id && pending.get(m.id);
        if (!p) continue;
        pending.delete(m.id);
        if (m.error) p.no(new Error(m.error.message)); else p.ok(m.result || {});
      }
    });
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    // The page is written into the blank tab (no file to load: some Chrome builds stall on file://
    // pages under the protocol); its CSP still lets only its own script run.
    (async () => {
      stage = "waiting for the tab";
      // the tab Chrome opens; if it hasn't one after a moment, open one (a cold first start, which
      // builds the font cache, can take many seconds either way)
      let target = null;
      const since = Date.now();
      let opened = false;
      while (!done && !target) {
        const { targetInfos = [] } = await send("Target.getTargets");
        target = targetInfos.find((t) => t.type === "page");
        if (!target && !opened && Date.now() - since > 2000) {
          opened = true;
          const { targetId } = await send("Target.createTarget", { url: "about:blank" });
          target = { targetId };
        }
        if (!target) await pause(50);
      }
      if (done) return;
      stage = "attaching to the tab";
      const { sessionId } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
      stage = "writing the page";
      await send("Runtime.evaluate", { expression: `document.open(); document.write(${JSON.stringify(html)}); document.close(); 1`, returnByValue: true }, sessionId);
      stage = "waiting for the page's audit";
      while (!done) {
        const r = await send("Runtime.evaluate", { expression: "(document.getElementById('out') || {}).textContent || ''", returnByValue: true }, sessionId);
        const text = r.result && r.result.value;
        if (text) {
          const audit = readAudit(text);
          send("Browser.close").catch(() => {});
          return finish(audit, audit ? "" : "the page's audit failed: " + String(text).slice(0, 200));
        }
        await pause(50);
      }
    })().catch((e) => finish(null, "the browser's protocol: " + e.message));
  });
}

// The audit as the retry's message ("" when clean).
export function layoutMessage(result, max = 10) {
  if (!result || !result.problems.length) return "";
  const n = result.problems.length;
  const list = result.problems.slice(0, max).map((p) => p.text).join("; ");
  return `its layout has ${n} problem${n === 1 ? "" : "s"}, measured by rendering it: ${list}${n > max ? `; and ${n - max} more like these` : ""}. Fix every one: move, shorten or re-wrap labels, or move the shapes, so no label overlaps another label, a line or a shape's edge, and everything stays ${RULES.edge}px inside the canvas`;
}
