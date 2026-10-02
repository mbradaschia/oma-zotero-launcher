// What a prompt (or a chat, or a change asked for) can make besides a Zotero note: a Markdown
// document, an HTML page, a diagram (Mermaid), a mind map (a Markdown outline, drawn with markmap)
// or an image (SVG). Each format says what the model must write (its output contract), how its
// answer is taken apart, cleaned (no scripts, no network) and checked, and how it is shown: an HTML
// page that opens in the browser, offline (the drawing libraries come from lib/libs.mjs, cached
// next to the artifacts). Pure (node-tested).
import { marked } from "marked";

export const FORMATS = {
  note: { id: "note", label: "Zotero note", noun: "a note", ext: "" },
  markdown: { id: "markdown", label: "Markdown file", noun: "a Markdown document", ext: "md" },
  html: { id: "html", label: "HTML page", noun: "an HTML page", ext: "html" },
  diagram: { id: "diagram", label: "Diagram", noun: "a diagram", ext: "mmd", libs: ["mermaid.min.js"] },
  mindmap: { id: "mindmap", label: "Mind map", noun: "a mind map", ext: "md", libs: ["d3.min.js", "markmap-lib.js", "markmap-view.js"] },
  image: { id: "image", label: "Image (SVG)", noun: "an image", ext: "svg" },
};
export const ARTIFACT_FORMATS = ["markdown", "html", "diagram", "mindmap", "image"];
export const OUTPUTS = ["note"].concat(ARTIFACT_FORMATS);

export function validOutput(f) {
  return OUTPUTS.includes(f);
}

// One palette for everything a model draws, so artifacts look like a set: soft fills with dark
// text (readable on light and dark pages), strong strokes for emphasis.
export const PALETTE = "ink #0f172a, slate #475569, indigo #4f46e5 (fill #eef2ff), teal #0d9488 (fill #ccfbf1), amber #d97706 (fill #fef3c7), rose #e11d48 (fill #ffe4e6), sky #0284c7 (fill #e0f2fe), violet #7c3aed (fill #ede9fe), background #f8fafc";

// The output contract, for the system prompt: what makes each format good, not only valid.
const CONTRACTS = {
  markdown: `Write one Markdown document and nothing else: a "# " title line, a one-paragraph summary under it, then "## " sections; use tables, lists and > quotes where they make it easier to scan.`,
  html: `Write one complete, self-contained HTML page and nothing else, from <!doctype html> to </html>, designed like a polished visual research brief, not a plain document. CSS in one <style> element: CSS variables for the palette (${PALETTE}), a system font stack (system-ui, sans-serif), generous spacing, CSS grid, rounded cards with soft shadows, and a dark version under @media (prefers-color-scheme: dark). Structure: a hero band (title, the paper's citation, a one-sentence takeaway); a row of 3 to 5 stat or key-idea cards (use the paper's real numbers where it has them); the core content as a grid of cards; at least one inline SVG figure (a bar chart of real results, a process, or a framework) drawn with the palette; key quotes styled as pull quotes; a references section. No JavaScript, no external files, fonts, images or links to load: the page opens in a browser that blocks scripts and the network.`,
  diagram: `Write one Mermaid diagram and nothing else, no code fence. The first line names its type: flowchart TD, flowchart LR, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, timeline or quadrantChart (pick the one that shows the idea best; a flowchart for a process, model or framework). Give every node an id and put its label in double quotes, e.g. A["Resource orchestration"] --> B["Value creation"]; edge labels too: A -->|"enables"| B. Never put double quotes inside a label. Labels are a few words; a line break inside a label is <br/>. Make it read at a glance, like a figure in a top journal: one clear story in 3 to 6 groups (subgraphs with quoted titles, subgraph S1["Inputs"] … end), 8 to 22 nodes, and few arrows: connect groups with one arrow between subgraphs (S1 --> S2) and draw node-to-node arrows only for the key mechanism, so most nodes have one arrow or none and no more than about 20 arrows in all; start with flowchart TB so the groups stack as rows and the figure fits a page (flowchart LR only for 3 groups or fewer), with at most 4 nodes side by side in a group. Color the groups with classDef from this palette (${PALETTE}), e.g. classDef input fill:#e0f2fe,stroke:#0284c7,color:#0f172a,stroke-width:2px; then class A,B input; use a stronger stroke for the key result. Use node shapes to mean something (["…"] for steps, {"…"} for decisions, (["…"]) for outcomes). No click lines.`,
  mindmap: `Write the mind map as one Markdown outline and nothing else, no code fence: one "# " heading for the centre (the paper's core idea in 2 to 5 words), "## " headings for 5 or 6 main branches, each starting with one fitting emoji, and "- " list items under them: 3 to 5 per branch, at most one more level, 30 to 45 nodes in all. Every node is a short phrase of 2 to 7 words, never a sentence: a mind map is scanned, not read. Put the paper's own numbers in the nodes that carry them (e.g. "Profit falls 45%"), and **bold** the three or four nodes that matter most. The page shows the paper's reference, so nodes don't repeat its citation; cite another work by author and year only where a node rests on it.`,
  image: `Write one standalone SVG image and nothing else, from <svg to </svg>, no code fence: an editorial infographic, organic rather than boxed, the kind a science magazine or a Nature visual abstract would print. Use xmlns="http://www.w3.org/2000/svg", viewBox="0 0 1200 800", width="1200" height="800". Palette: ${PALETTE}; at most 5 hues, plus slate greys for everything that is context, not the point; a pale background wash (a full-canvas rect with a soft radial or linear gradient), never plain white panels.
Composition: build the whole picture around one visual metaphor that carries the paper's logic (the brief's visual concept when there is one): a river or flow that branches, a journey path, an orbit or hub around a core idea, a funnel, a tree, a landscape, overlapping circles, a balance. Draw it with flowing cubic Bézier paths (C/S commands), circles, ellipses and soft blob shapes, translucent overlaps (fill-opacity), gradients, and simple pictograms built from basic shapes. No grid of equal rectangles, no border around every element, no tables, no card layout: at most one small rounded tag or two. Leave generous white space and one clear reading path (left to right, or from the centre out).
Hierarchy: one hero number, the paper's headline result (64 to 88px, bold, an accent colour), next to what it measures; at most three more key numbers at 36 to 48px; every other number in a label. Text has three sizes besides those: the title (28 to 34px, bold, font-family="Georgia, serif"), labels (16 to 18px, #1e293b) and annotations (14px, #475569), never smaller than 13px, never rotated; body text in font-family="system-ui, sans-serif". Text under 24px is ink or slate, not an accent colour: a small coloured dot or line beside it carries the identity. The paper's citation goes under the title (14px, slate), and a one-line takeaway at the bottom.
Labels: label things directly, beside what they name, 1 to 4 words each, at most about 30 labels in all. A label never sits on a line, curve or arrow and never crosses a shape's edge: put it at least 10px clear of the line (above or below a flow, not on it), or wholly inside a shape with 12px to spare on each side. When a label is more than about 20px from what it names, draw a thin leader line (1px, slate) to it. Keep 12px between labels and 24px from the canvas edges. Wide bands and flows end tapered or rounded into what they reach; arrowheads (<marker>, at most 12px) go on thin lines (4px or less) only.
Plan before drawing: start the SVG with an XML comment listing each block (the title, the metaphor, each label group, the hero numbers, the takeaway) with its box (x, y, width, height), non-overlapping and inside the canvas, and draw to that plan. A label of 16px is about 8px wide per character: keep a line under about 34 characters and split longer text into <tspan x=… dy="1.25em"> lines. The image is laid out in a browser and measured: every label that overlaps another, touches a line or a shape's edge, or leaves the canvas is sent back to you to fix. No <script>, no event attributes, no <foreignObject>, no external images, fonts or links.`,
};

export function contract(format) {
  return CONTRACTS[format] || "";
}

// ---------------------------------------------------------------- taking the answer apart

function unfence(text) {
  const t = String(text || "").replace(/\r\n/g, "\n").trim();
  const m = /^```[\w-]*\n([\s\S]*?)\n```\s*$/.exec(t);
  if (m) return m[1].trim();
  // a fence after some preamble
  const inner = /```[\w-]*\n([\s\S]*?)\n```/.exec(t);
  return inner ? inner[1].trim() : t;
}

const DIAGRAM_TYPES = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|sankey-beta|xychart-beta|block-beta|architecture-beta|kanban)\b/;

// The model's answer → the artifact's source.
export function extract(format, text) {
  const raw = String(text || "").replace(/\r\n/g, "\n");
  if (format === "image") {
    const m = /<svg[\s>][\s\S]*<\/svg>/i.exec(raw);
    return m ? m[0].trim() : unfence(raw);
  }
  if (format === "html") {
    const m = /<!doctype html[\s\S]*<\/html>/i.exec(raw) || /<html[\s>][\s\S]*<\/html>/i.exec(raw);
    return m ? m[0].trim() : unfence(raw);
  }
  const t = unfence(raw);
  if (format === "diagram") {
    const lines = t.split("\n");
    const i = lines.findIndex((l) => DIAGRAM_TYPES.test(l.trim()));
    return (i > 0 ? lines.slice(i) : lines).join("\n").trim();
  }
  if (format === "mindmap") {
    const lines = t.split("\n");
    const i = lines.findIndex((l) => /^#\s/.test(l));
    return (i > 0 ? lines.slice(i) : lines).join("\n").trim();
  }
  return t;
}

// No scripts, event handlers or outside resources: what the model writes can come from a paper it
// read, so nothing it writes gets to run or call out (the view's Content-Security-Policy says so too).
export function sanitize(format, source) {
  let s = String(source || "");
  if (format === "image" || format === "html" || format === "markdown") {
    s = s.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").replace(/<script\b[^>]*\/?>/gi, "");
    s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    s = s.replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "$1=$2#$2");
  }
  if (format === "diagram") s = s.split("\n").filter((l) => !/^\s*click\s/.test(l)).join("\n");
  if (format === "image") {
    s = s.replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, "");
    // outside references (images, fonts, links); in-document ones (#id) and data: images stay
    s = s.replace(/\s(xlink:href|href)\s*=\s*("|')(?!#|data:image\/)[^"']*\2/gi, "");
    s = s.replace(/@import[^;]*;/gi, "").replace(/url\(\s*(['"]?)(?!#|data:)[^)]*\1\s*\)/gi, "none");
    if (!/xmlns=/.test(s)) s = s.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return s.trim();
}

// ---------------------------------------------------------------- an SVG's layout, checked

// A model writing SVG can't see it rendered, so text lands on text or runs off the canvas. This
// estimates each line of text's box (its x, y, font size, anchor and length; translate() on
// groups followed) and reports what collides, what leaves the canvas, and arrowheads on wide
// strokes (a marker scales with the stroke: a 30px band ends in a huge triangle).
const PX = (v, fs) => { const m = /^(-?[\d.]+)(em|px)?$/.exec(String(v || "").trim()); return m ? parseFloat(m[1]) * (m[2] === "em" ? fs : 1) : null; };
const attr = (a, n) => { const m = new RegExp(`(?:^|\\s)${n}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(a); return m ? (m[2] ?? m[3]) : null; };
const styleOf = (a, n) => { const st = attr(a, "style") || ""; const m = new RegExp(`(?:^|;)\\s*${n}\\s*:\\s*([^;]+)`).exec(st); return m ? m[1].trim() : attr(a, n); };

// A line's width in a sans-serif face, by kind of character (em fractions, bold about 7% wider).
export function textWidth(t, fs, bold) {
  let em = 0;
  for (const ch of String(t)) em += /[A-Z]/.test(ch) ? (/[MW]/.test(ch) ? 0.86 : /[IJ]/.test(ch) ? 0.32 : 0.66) : /[a-z]/.test(ch) ? (/[mw]/.test(ch) ? 0.8 : /[ijlft]/.test(ch) ? 0.28 : 0.52) : /[0-9$%]/.test(ch) ? 0.57 : /\s/.test(ch) ? 0.28 : 0.34;
  return em * fs * (bold ? 1.07 : 1);
}

export function svgLines(svg, shapes = []) {
  const lines = [];
  const stack = [{ tx: 0, ty: 0, fs: 16, anchor: "start", weight: "400", family: "" }];
  let text = null; // the <text> being read: { id, x, y, fs, anchor, cur: line }
  let n = 0;
  const re = /<(\/?)([a-zA-Z]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  let m;
  const push = (t, content, st) => {
    const s = content.replace(/&[a-z#0-9]+;/gi, "x").replace(/\s+/g, " ");
    if (!s.trim() || !t.line) return;
    t.line.text += s;
  };
  while ((m = re.exec(svg))) {
    if (m[5] != null) { if (text) push(text, m[5]); continue; }
    const [, close, tag, a, self] = m;
    const top = stack[stack.length - 1];
    if (close) {
      if (tag === "text" && text) { text.lines.forEach((l) => l.text.trim() && lines.push(l)); text = null; }
      if (tag !== "tspan") stack.pop();
      continue;
    }
    const fsv = styleOf(a, "font-size");
    const ctx = Object.assign({}, top, {
      fs: fsv ? PX(fsv, top.fs) || top.fs : top.fs, anchor: styleOf(a, "text-anchor") || top.anchor,
      weight: String(styleOf(a, "font-weight") || top.weight), family: styleOf(a, "font-family") || top.family });
    const tr = attr(a, "transform");
    if (tr) {
      const t = /translate\(\s*(-?[\d.]+)[\s,]*(-?[\d.]+)?\s*\)/.exec(tr);
      if (t) { ctx.tx += parseFloat(t[1]); ctx.ty += parseFloat(t[2] || 0); }
      if (/rotate|scale|matrix|skew/.test(tr)) ctx.skip = true;
    }
    if (!ctx.skip && (tag === "rect" || tag === "ellipse" || tag === "circle")) {
      const num = (n) => parseFloat(attr(a, n) || "0");
      if (tag === "rect" && num("width") > 0 && num("height") > 0) shapes.push({ kind: "rect", x0: ctx.tx + num("x"), y0: ctx.ty + num("y"), x1: ctx.tx + num("x") + num("width"), y1: ctx.ty + num("y") + num("height") });
      const rx = tag === "circle" ? num("r") : num("rx"), ry = tag === "circle" ? num("r") : num("ry");
      if (tag !== "rect" && rx > 0 && ry > 0) shapes.push({ kind: "ellipse", cx: ctx.tx + num("cx"), cy: ctx.ty + num("cy"), rx, ry });
    }
    // a closed, filled path (a blob or a drawn box): its bounding box stands in for it
    if (!ctx.skip && tag === "path") {
      const d = attr(a, "d") || "";
      const fill = styleOf(a, "fill");
      if (/z\s*$/i.test(d.trim()) && fill !== "none" && !/[a-y]/.test(d.replace(/[eE][-+]?\d/g, ""))) {
        const nums = (d.match(/-?\d*\.?\d+/g) || []).map(Number);
        const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
        if (xs.length >= 3 && xs.length === ys.length) shapes.push({ kind: "rect", x0: ctx.tx + Math.min(...xs), y0: ctx.ty + Math.min(...ys), x1: ctx.tx + Math.max(...xs), y1: ctx.ty + Math.max(...ys) });
      }
    }
    if (tag === "text") {
      const x = PX(attr(a, "x"), ctx.fs) || 0, y = PX(attr(a, "y"), ctx.fs) || 0;
      text = { id: ++n, lines: [], skip: ctx.skip };
      text.line = { id: text.id, x: ctx.tx + x, y: ctx.ty + y, fs: ctx.fs, anchor: ctx.anchor, weight: ctx.weight, family: ctx.family, text: "", skip: ctx.skip };
      text.lines.push(text.line);
      if (!self) stack.push(ctx);
      continue;
    }
    if (tag === "tspan" && text) {
      const prev = text.line;
      const fs = ctx.fs;
      const xa = attr(a, "x"), ya = attr(a, "y"), dy = attr(a, "dy");
      const nx = xa != null ? ctx.tx + PX(xa, fs) : prev.x, ny = ya != null ? ctx.ty + PX(ya, fs) : prev.y + (dy != null ? PX(dy, fs) || 0 : 0);
      if (xa != null || ya != null || (dy != null && PX(dy, fs))) {
        text.line = { id: text.id, x: nx, y: ny, fs, anchor: ctx.anchor, weight: ctx.weight, family: ctx.family, text: "", skip: text.skip };
        text.lines.push(text.line);
      }
      continue;
    }
    if (!self && tag !== "tspan") stack.push(ctx);
  }
  return lines.filter((l) => !l.skip).map((l) => {
    const t = l.text.trim();
    const w = textWidth(t, l.fs, /^(bold|[6-9]00)$/.test(l.weight)) * (/serif/i.test(l.family) && !/sans/i.test(l.family) ? 0.93 : 1);
    const x0 = l.anchor === "middle" ? l.x - w / 2 : l.anchor === "end" ? l.x - w : l.x;
    return { id: l.id, text: t, x0, x1: x0 + w, y0: l.y - l.fs * 0.78, y1: l.y + l.fs * 0.22, fs: l.fs };
  });
}

export function svgLayoutProblems(svg) {
  const out = [];
  const vb = /viewBox\s*=\s*["']\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svg);
  const shapes = [];
  const lines = svgLines(svg, shapes);
  const short = (t) => (t.length > 34 ? t.slice(0, 33) + "…" : t);
  if (vb) {
    const [X, Y, W, H] = vb.slice(1).map(Number);
    for (const l of lines) {
      const over = Math.max(X - l.x0, l.x1 - (X + W), Y - l.y0, l.y1 - (Y + H));
      if (over > 10) out.push(`"${short(l.text)}" runs about ${Math.round(over)}px off the canvas`);
    }
  }
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const a = lines[i], b = lines[j];
    if (a.id === b.id) continue;
    const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (w > 8 && h > Math.min(a.fs, b.fs) * 0.35) out.push(`"${short(a.text)}" overlaps "${short(b.text)}" (near x ${Math.round(Math.max(a.x0, b.x0))}, y ${Math.round(Math.max(a.y0, b.y0))})`);
  }
  // a label wider than the shape it sits in (a word spilling out of its oval or box); backgrounds
  // (shapes more than 60% of the canvas wide) aren't its container
  const W = vb ? Number(vb[3]) : 1e9;
  for (const l of lines) {
    const cx = (l.x0 + l.x1) / 2, cy = (l.y0 + l.y1) / 2, w = l.x1 - l.x0;
    let best = null;
    for (const sh of shapes) {
      let inner, height;
      if (sh.kind === "rect") {
        if (cx < sh.x0 || cx > sh.x1 || cy < sh.y0 || cy > sh.y1) continue;
        inner = sh.x1 - sh.x0; height = sh.y1 - sh.y0;
      } else {
        const d = ((cx - sh.cx) / sh.rx) ** 2 + ((cy - sh.cy) / sh.ry) ** 2;
        if (d > 1) continue;
        inner = 2 * sh.rx * Math.sqrt(Math.max(0, 1 - ((cy - sh.cy) / sh.ry) ** 2)); height = 2 * sh.ry;
      }
      if (inner > W * 0.6) continue;
      if (!best || inner < best.inner) best = { inner };
    }
    // fonts differ from machine to machine: a label keeps an eighth of its shape's width free
    if (best && w > best.inner * 0.88) out.push(`"${short(l.text)}" is wider than the shape it sits in (about ${Math.round(w)}px of text in ${Math.round(best.inner)}px): shorten it, break it into lines, or widen the shape`);
  }
  // arrowheads on wide strokes
  for (const m of svg.matchAll(/<(path|line|polyline)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const a = m[2];
    const sw = parseFloat(styleOf(a, "stroke-width") || "1");
    if ((attr(a, "marker-end") || attr(a, "marker-start") || /marker-(end|start)\s*:/.test(attr(a, "style") || "")) && sw > 10) {
      out.push(`an arrowhead sits on a ${sw}px-wide stroke, so it is drawn ${sw} times its size: end wide bands without a marker (taper them) and put arrowheads on thin lines only`);
    }
  }
  return [...new Set(out)];
}

// "" when usable, else what is wrong (sent back to the model once, to fix it).
// `layout: false` leaves an image's layout to be measured in a browser (layout.mjs).
export function validate(format, source, { layout = true } = {}) {
  const s = String(source || "").trim();
  if (!s) return "the answer was empty";
  if (format === "markdown") return s.length < 20 ? "the document is too short" : "";
  if (format === "html") return /<\/html>|<\/body>/i.test(s) && /<(h1|h2|p|table|section|main|div)\b/i.test(s) ? "" : "it is not a complete HTML page (from <!doctype html> to </html>)";
  if (format === "image") {
    if (!/^<svg[\s>]/i.test(s) || !/<\/svg>$/i.test(s)) return "it is not one SVG image (from <svg to </svg>)";
    if (!/viewBox=/.test(s)) return "the SVG has no viewBox";
    const problems = layout ? svgLayoutProblems(s) : [];
    if (problems.length) return `its layout has ${problems.length} problem${problems.length === 1 ? "" : "s"} (estimated from the text's positions and sizes): ${problems.slice(0, 8).join("; ")}. Move or resize these so nothing overlaps and everything stays on the canvas, keeping at least 12px between labels`;
    return "";
  }
  if (format === "mindmap") {
    const nodes = s.split("\n").filter((l) => /^\s*(#{1,6}\s|[-*+]\s|\d+\.\s)/.test(l)).length;
    if (!/^#\s/m.test(s)) return 'the mind map has no "# " centre heading';
    return nodes < 4 ? "the mind map has too few nodes" : "";
  }
  if (format === "diagram") {
    const lines = s.split("\n").filter((l) => l.trim() && !/^\s*%%/.test(l));
    if (!lines.length || !DIAGRAM_TYPES.test(lines[0].trim())) return "the first line must name the diagram type (e.g. flowchart TD)";
    const odd = lines.findIndex((l) => (l.match(/"/g) || []).length % 2);
    if (odd >= 0) return `line ${odd + 1} has an unmatched double quote: ${lines[odd].trim()}`;
    // brackets outside quoted labels (an asymmetric node, A>"x"], opens with ">")
    const open = lines.findIndex((l) => {
      const b = stripQuoted(l);
      return (count(b, "[") !== count(b, "]") && !/\w>"/.test(l)) || count(b, "(") !== count(b, ")") || count(b, "{") !== count(b, "}");
    });
    if (open >= 0 && !/^\s*(timeline|quadrantChart|sequenceDiagram|gantt|pie)/.test(lines[0])) return `line ${open + 1} has unbalanced brackets: ${lines[open].trim()}`;
    return "";
  }
  return "";
}

function count(s, ch) {
  return s.split(ch).length - 1;
}

// A line with its quoted labels emptied: brackets inside a label aren't syntax.
export function stripQuoted(line) {
  return String(line).replace(/"[^"]*"/g, '""');
}

// ---------------------------------------------------------------- the view

export function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// JSON inside a <script type="application/json"> element: nothing in it can close the element.
function jsonData(x) {
  return JSON.stringify(x).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const CSP_STATIC = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";
const CSP_LIBS = "default-src 'none'; script-src 'self' 'unsafe-inline' file:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";

const CSS = `:root{--bg:#f1f5f9;--card:#fff;--fg:#0f172a;--muted:#64748b;--line:#e2e8f0;--accent:#4f46e5;--accent2:#0d9488;--shadow:0 1px 2px rgba(15,23,42,.06),0 12px 32px -12px rgba(15,23,42,.18)}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--card:#131a2e;--fg:#e2e8f0;--muted:#94a3b8;--line:#243049;--accent:#818cf8;--accent2:#2dd4bf;--shadow:0 1px 2px rgba(0,0,0,.4),0 16px 40px -16px rgba(0,0,0,.6)}}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Inter,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
body{background:radial-gradient(1200px 500px at 10% -10%,color-mix(in srgb,var(--accent) 16%,transparent),transparent 60%),radial-gradient(900px 420px at 100% 0%,color-mix(in srgb,var(--accent2) 14%,transparent),transparent 60%),var(--bg)}
header{max-width:1180px;margin:0 auto;padding:28px 28px 8px;display:flex;gap:16px;align-items:flex-start}
.oma-badge{flex:none;width:44px;height:44px;border-radius:12px;display:grid;place-items:center;font-size:22px;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent2));box-shadow:var(--shadow)}
header h1{margin:0;font-size:26px;line-height:1.2;letter-spacing:-.01em}header p{margin:6px 0 0;color:var(--muted);font-size:14px}
.oma-pill{display:inline-block;padding:1px 9px;margin-right:8px;border-radius:999px;font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent)}
main{max-width:1180px;margin:18px auto 40px;padding:0 28px}
.oma-card{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);padding:28px;overflow:auto}
main.full{max-width:none;padding:0 24px}main.wide{max-width:none;margin:12px 0 0;padding:0 16px 16px}main.wide .oma-card{padding:0;height:calc(100vh - 130px)}
.oma-doc{max-width:74ch;margin:0 auto;font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;font-size:18px;line-height:1.7}
.oma-doc h1,.oma-doc h2,.oma-doc h3{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.25;letter-spacing:-.01em}
.oma-doc h2{margin-top:2em;padding-bottom:.3em;border-bottom:1px solid var(--line)}
.oma-doc table{border-collapse:collapse;font-size:15px;font-family:system-ui,sans-serif;margin:1em 0}.oma-doc td,.oma-doc th{border:1px solid var(--line);padding:6px 10px}.oma-doc th{background:color-mix(in srgb,var(--accent) 8%,transparent)}
.oma-doc blockquote{margin:1.2em 0;padding:.6em 1.1em;border-left:4px solid var(--accent);background:color-mix(in srgb,var(--accent) 6%,transparent);border-radius:0 10px 10px 0}
pre{white-space:pre-wrap;overflow-x:auto;font-size:13px}
#oma-diagram{display:flex;justify-content:center}#oma-diagram svg{flex:none;max-width:100%;height:auto}.oma-error{color:#e11d48;font-weight:600}
.oma-svg{display:flex;justify-content:center}.oma-svg svg{max-width:100%;height:auto;border-radius:12px}
#mm{width:100%;height:100%;display:block;--markmap-font:500 17px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;--markmap-text-color:var(--fg)}`;

const BADGE = { markdown: "\u{1F4C4}", html: "\u{1F310}", diagram: "\u{1F500}", mindmap: "\u{1F9E0}", image: "\u{1F5BC}" };

function page({ title, subtitle, csp, body, wide, full, scripts = "", format = "", label = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<header><div class="oma-badge" aria-hidden="true">${BADGE[format] || "\u{2728}"}</div><div><h1>${escapeHtml(title)}</h1><p>${label ? `<span class="oma-pill">${escapeHtml(label)}</span>` : ""}${escapeHtml(subtitle)}</p></div></header>
<main${wide ? ' class="wide"' : full ? ' class="full"' : ""}>
<div class="oma-card">
${body}
</div>
</main>
${scripts}</body>
</html>
`;
}

// The page that shows an artifact. `lib`: the relative path to the drawing libraries' folder.
export function renderView(format, source, { title = "", subtitle = "", lib = "../../.lib" } = {}) {
  const src = String(source || "");
  const meta = { format, label: (FORMATS[format] || {}).label || "" };
  if (format === "html") {
    // the model's own page, with the policy that keeps scripts and the network out
    const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP_STATIC}">`;
    if (/<head[^>]*>/i.test(src)) return src.replace(/<head[^>]*>/i, (h) => h + "\n" + meta);
    if (/<html[^>]*>/i.test(src)) return src.replace(/<html[^>]*>/i, (h) => h + "\n<head>" + meta + "</head>");
    return page({ title, subtitle, csp: CSP_STATIC, body: src, ...meta });
  }
  if (format === "markdown") return page({ title, subtitle, csp: CSP_STATIC, body: `<article class="oma-doc">${sanitize("markdown", marked.parse(src, { gfm: true }))}</article>`, ...meta });
  if (format === "image") return page({ title, subtitle, csp: CSP_STATIC, body: `<div class="oma-svg">${src}</div>`, ...meta });
  const fallback = `<div id="oma-fallback" hidden><p class="oma-error" id="oma-why"></p><pre>${escapeHtml(src)}</pre></div>`;
  const data = `<script type="application/json" id="oma-src">${jsonData(src)}</script>\n`;
  const fail = `function omaFail(why){document.getElementById("oma-why").textContent=why;document.getElementById("oma-fallback").hidden=false}`;
  if (format === "diagram") {
    return page({ title, subtitle, csp: CSP_LIBS, full: true, ...meta, body: `<div id="oma-diagram"></div>\n${fallback}`,
      scripts: `${data}<script src="${lib}/mermaid.min.js"></script>
<script>${fail}
(async function(){
  var src=JSON.parse(document.getElementById("oma-src").textContent);
  if(!window.mermaid)return omaFail("The diagram library isn't downloaded yet (it needs the internet once): here is the diagram's text.");
  var dark=matchMedia("(prefers-color-scheme: dark)").matches;
  var font="system-ui,-apple-system,Segoe UI,Inter,Roboto,sans-serif";
  mermaid.initialize({startOnLoad:false,securityLevel:"strict",theme:"base",
    themeVariables:{fontFamily:font,fontSize:"17px",primaryColor:dark?"#1e1b4b":"#eef2ff",primaryTextColor:dark?"#e0e7ff":"#1e1b4b",primaryBorderColor:dark?"#818cf8":"#6366f1",
      secondaryColor:dark?"#042f2e":"#ccfbf1",tertiaryColor:dark?"#1f2937":"#fef3c7",lineColor:dark?"#94a3b8":"#64748b",textColor:dark?"#e2e8f0":"#0f172a",
      clusterBkg:dark?"#0f172a":"#f8fafc",clusterBorder:dark?"#334155":"#cbd5e1",edgeLabelBackground:dark?"#131a2e":"#ffffff",titleColor:dark?"#e2e8f0":"#0f172a"},
    layout:"dagre",flowchart:{curve:"basis",padding:18,nodeSpacing:40,rankSpacing:64,htmlLabels:true,wrappingWidth:230},timeline:{padding:12},quadrantChart:{chartWidth:720,chartHeight:720}});
  try{var r=await mermaid.render("oma-d",src);var box=document.getElementById("oma-diagram");box.innerHTML=r.svg;
    // fit the page, but never shrink the text below 60%: a wider diagram scrolls instead
    var svg=box.querySelector("svg"),w=svg&&svg.viewBox&&svg.viewBox.baseVal?svg.viewBox.baseVal.width:0;
    if(w&&w*0.6>box.clientWidth){svg.style.maxWidth="none";svg.setAttribute("width",w);box.style.justifyContent="flex-start"}}
  catch(e){omaFail("The diagram has an error: "+(e&&e.message||e)+" (ask for a change to fix it)")}
})();
</script>
` });
  }
  if (format === "mindmap") {
    return page({ title, subtitle, csp: CSP_LIBS, wide: true, ...meta, body: `<svg id="mm"></svg>\n${fallback}`,
      scripts: `${data}<script src="${lib}/d3.min.js"></script>
<script src="${lib}/markmap-lib.js"></script>
<script src="${lib}/markmap-view.js"></script>
<script>${fail}
(function(){
  var src=JSON.parse(document.getElementById("oma-src").textContent);
  var mm=window.markmap;
  if(!window.d3||!mm||!mm.Transformer||!mm.Markmap)return omaFail("The mind map library isn't downloaded yet (it needs the internet once): here is its outline.");
  try{var root=new mm.Transformer().transform(src).root;
    var m=mm.Markmap.create("#mm",{autoFit:true,duration:400,maxWidth:300,spacingVertical:10,spacingHorizontal:90,paddingX:12,colorFreezeLevel:2,initialExpandLevel:3},root);
    addEventListener("resize",function(){m.fit()})}
  catch(e){omaFail("The mind map has an error: "+(e&&e.message||e))}
})();
</script>
` });
  }
  return page({ title, subtitle, csp: CSP_STATIC, body: `<pre>${escapeHtml(src)}</pre>`, ...meta });
}
