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
  image: `Write one standalone SVG image and nothing else, from <svg to </svg>, no code fence: an editorial infographic, organic rather than boxed, the kind a science magazine or a Nature visual abstract would print. Use xmlns="http://www.w3.org/2000/svg", viewBox="0 0 1200 800", width="1200" height="800". Palette: ${PALETTE}; a pale background wash (a soft radial or linear gradient), never plain white panels.
Composition: build the whole picture around one visual metaphor that carries the paper's logic (the brief's visual concept when there is one): a river or flow that branches, a journey path, an orbit or hub around a core idea, a funnel, a tree, a landscape, overlapping circles, a balance. Draw it with flowing cubic Bézier paths (C/S commands), circles, ellipses and soft blob shapes, translucent overlaps (fill-opacity), gradients, and simple pictograms built from basic shapes. Make scale carry meaning: one or two hero numbers set large (54 to 88px, bold, in an accent color) next to what they measure; everything else smaller. Label things directly, with short text and thin leader lines or curved arrows (<marker> arrowheads), not text inside boxes. No grid of equal rectangles, no border around every element, no tables, no card layout: at most one small rounded tag or two. Leave generous white space and one clear reading path (left to right, or from the centre out).
Text: a title top left (28 to 34px, bold, font-family="Georgia, serif" or system-ui), the paper's citation under it (15px, slate), and a one-line takeaway at the bottom; body labels in font-family="system-ui, sans-serif", 15 to 20px, dark on the light background. Nothing may overlap or run off the canvas: keep a line under about 34 characters and split longer text into <tspan x=… dy="1.25em"> lines. No <script>, no event attributes, no <foreignObject>, no external images, fonts or links.`,
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

// "" when usable, else what is wrong (sent back to the model once, to fix it).
export function validate(format, source) {
  const s = String(source || "").trim();
  if (!s) return "the answer was empty";
  if (format === "markdown") return s.length < 20 ? "the document is too short" : "";
  if (format === "html") return /<\/html>|<\/body>/i.test(s) && /<(h1|h2|p|table|section|main|div)\b/i.test(s) ? "" : "it is not a complete HTML page (from <!doctype html> to </html>)";
  if (format === "image") {
    if (!/^<svg[\s>]/i.test(s) || !/<\/svg>$/i.test(s)) return "it is not one SVG image (from <svg to </svg>)";
    if (!/viewBox=/.test(s)) return "the SVG has no viewBox";
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
