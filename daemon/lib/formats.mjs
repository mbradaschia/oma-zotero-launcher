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

// The output contract, for the system prompt.
const CONTRACTS = {
  markdown: `Write one Markdown document and nothing else: a "# " title line, then "## " sections, lists, tables and > quotes as they help.`,
  html: `Write one complete, self-contained HTML page and nothing else, from <!doctype html> to </html>: CSS in one <style> element; no JavaScript, no external files, fonts, images or links to load (inline SVG is fine). It opens in a browser that blocks scripts and network access. Make it readable in print and on screen: a clear heading, sections, and tables where they help.`,
  diagram: `Write one Mermaid diagram and nothing else, no code fence. The first line names its type: flowchart TD, flowchart LR, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, timeline or quadrantChart (pick the one that fits). Give every node an id and put its label in double quotes, e.g. A["Resource orchestration"] --> B["Value creation"]; edge labels too: A -->|"enables"| B. Never put double quotes inside a label. Short labels (a few words), at most about 30 nodes, no styling or click lines.`,
  mindmap: `Write the mind map as one Markdown outline and nothing else, no code fence: one "# " heading for the centre, "## " headings for the main branches (3 to 7), and nested "- " list items under them, at most three levels deep. Each node is a few words, not a sentence; put the citation, e.g. (Sirmon et al., 2007, p. 275), in the node it supports.`,
  image: `Write one standalone SVG image and nothing else, from <svg to </svg>, no code fence: xmlns="http://www.w3.org/2000/svg", a viewBox and a width and height; shapes, arrows and <text> labels in a generic font (font-family="sans-serif") at legible sizes, with enough contrast on a white background. Lay it out so nothing overlaps. No <script>, no event attributes, no <foreignObject>, no external images, fonts or links.`,
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
const CSP_LIBS = "default-src 'none'; script-src 'unsafe-inline' file:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";

const CSS = `:root{--bg:#fff;--fg:#1d1d1f;--muted:#6e6e73;--line:#d2d2d7;--accent:#2f6fde}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#e8e8ea;--muted:#9a9aa0;--line:#333338;--accent:#7aa7ff}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
header{padding:14px 20px;border-bottom:1px solid var(--line)}header h1{margin:0;font-size:18px}header p{margin:2px 0 0;color:var(--muted);font-size:13px}
main{padding:20px;max-width:980px;margin:0 auto}main.wide{max-width:none;padding:0}
main h1,main h2,main h3{line-height:1.25}main table{border-collapse:collapse}main td,main th{border:1px solid var(--line);padding:4px 8px}
main blockquote{margin:0;padding-left:14px;border-left:3px solid var(--line);color:var(--muted)}pre{white-space:pre-wrap;overflow-x:auto}
#oma-diagram{text-align:center}.oma-error{color:#c0392b}.oma-svg{background:#fff;border-radius:6px;padding:8px}.oma-svg svg{max-width:100%;height:auto}
#mm{width:100vw;height:calc(100vh - 66px);display:block}`;

function page({ title, subtitle, csp, body, wide, scripts = "" }) {
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
<header><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></header>
<main${wide ? ' class="wide"' : ""}>
${body}
</main>
${scripts}</body>
</html>
`;
}

// The page that shows an artifact. `lib`: the relative path to the drawing libraries' folder.
export function renderView(format, source, { title = "", subtitle = "", lib = "../../.lib" } = {}) {
  const src = String(source || "");
  if (format === "html") {
    // the model's own page, with the policy that keeps scripts and the network out
    const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP_STATIC}">`;
    if (/<head[^>]*>/i.test(src)) return src.replace(/<head[^>]*>/i, (h) => h + "\n" + meta);
    if (/<html[^>]*>/i.test(src)) return src.replace(/<html[^>]*>/i, (h) => h + "\n<head>" + meta + "</head>");
    return page({ title, subtitle, csp: CSP_STATIC, body: src });
  }
  if (format === "markdown") return page({ title, subtitle, csp: CSP_STATIC, body: sanitize("markdown", marked.parse(src, { gfm: true })) });
  if (format === "image") return page({ title, subtitle, csp: CSP_STATIC, body: `<div class="oma-svg">${src}</div>` });
  const fallback = `<div id="oma-fallback" hidden><p class="oma-error" id="oma-why"></p><pre>${escapeHtml(src)}</pre></div>`;
  const data = `<script type="application/json" id="oma-src">${jsonData(src)}</script>\n`;
  const fail = `function omaFail(why){document.getElementById("oma-why").textContent=why;document.getElementById("oma-fallback").hidden=false}`;
  if (format === "diagram") {
    return page({ title, subtitle, csp: CSP_LIBS, body: `<div id="oma-diagram"></div>\n${fallback}`,
      scripts: `${data}<script src="${lib}/mermaid.min.js"></script>
<script>${fail}
(async function(){
  var src=JSON.parse(document.getElementById("oma-src").textContent);
  if(!window.mermaid)return omaFail("The diagram library isn't downloaded yet (it needs the internet once): here is the diagram's text.");
  var dark=matchMedia("(prefers-color-scheme: dark)").matches;
  mermaid.initialize({startOnLoad:false,securityLevel:"strict",theme:dark?"dark":"default"});
  try{var r=await mermaid.render("oma-d",src);document.getElementById("oma-diagram").innerHTML=r.svg}
  catch(e){omaFail("The diagram has an error: "+(e&&e.message||e)+" (ask for a change to fix it)")}
})();
</script>
` });
  }
  if (format === "mindmap") {
    return page({ title, subtitle, csp: CSP_LIBS, wide: true, body: `<svg id="mm"></svg>\n${fallback}`,
      scripts: `${data}<script src="${lib}/d3.min.js"></script>
<script src="${lib}/markmap-lib.js"></script>
<script src="${lib}/markmap-view.js"></script>
<script>${fail}
(function(){
  var src=JSON.parse(document.getElementById("oma-src").textContent);
  var mm=window.markmap;
  if(!window.d3||!mm||!mm.Transformer||!mm.Markmap)return omaFail("The mind map library isn't downloaded yet (it needs the internet once): here is its outline.");
  try{var root=new mm.Transformer().transform(src).root;mm.Markmap.create("#mm",{autoFit:true,duration:300},root)}
  catch(e){omaFail("The mind map has an error: "+(e&&e.message||e))}
})();
</script>
` });
  }
  return page({ title, subtitle, csp: CSP_STATIC, body: `<pre>${escapeHtml(src)}</pre>` });
}
