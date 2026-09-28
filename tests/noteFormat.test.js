// OmaNoteFormat (zotero-bridge/lib/noteFormat.js): Markdown clean-up for the
// overlay's note reader, the size cap, list excerpts and plain titles.
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../zotero-bridge/lib/noteFormat.js");

test("images become a visible placeholder (Markdown and raw HTML)", () => {
  assert.equal(F.stripImages("a ![fig 1](data:image/png;base64,AAAA) b"), "a [image] b");
  assert.equal(F.stripImages('x <img src="https://tracker.example/p.gif" width="1"> y'), "x [image] y");
});

test("links the overlay can't follow keep their text; web and mail links stay", () => {
  const md = "[Mauro, 1995](zotero://select/library/items/PHUMIU7V) and [pdf](zotero://open-pdf/library/items/X?page=2) " +
    "[note](zotero://note/u/ZFWA3RSM/) [site](https://example.org/a_b) [mail](mailto:a@b.c) <zotero://select/items/1_X>";
  assert.equal(F.flattenAppLinks(md), "Mauro, 1995 and pdf note [site](https://example.org/a_b) [mail](mailto:a@b.c) ");
});

test("format: collapses blank lines, keeps two-space line breaks, trims", () => {
  const r = F.format("\n\n# Title\n\n\n\nline one  \nline two   \n\n\n![x](y)\n");
  assert.equal(r.markdown, "# Title\n\nline one  \nline two\n\n[image]");
  assert.equal(r.truncated, false);
  assert.equal(r.chars, r.markdown.length);
});

test("format: long notes are cut at a paragraph break and flagged", () => {
  const para = (n) => `Paragraph ${n} ` + "word ".repeat(30).trim();
  const md = Array.from({ length: 40 }, (_, i) => para(i)).join("\n\n");
  const r = F.format(md, 1000);
  assert.equal(r.truncated, true);
  assert.ok(r.markdown.length <= 1000);
  assert.ok(r.markdown.length > 600);
  assert.match(r.markdown, /word$/); // ends at a paragraph end, not mid-word
  assert.equal(r.chars, md.length);
  assert.equal(F.format("short", 1000).truncated, false);
});

test("truncate falls back to a line or word break when there is no paragraph break", () => {
  assert.equal(F.truncate("alpha beta gamma delta", 16), "alpha beta");
  assert.equal(F.truncate("aaaaaaaaaaaaaaaaaaaa", 10), "aaaaaaaaaa");
});

test("excerpt: text after the title, whitespace collapsed, ellipsis at a word break", () => {
  assert.equal(F.excerpt("Scan\n\nABS: 5 | Relevance: 5\n Seminal.", "Scan"), "ABS: 5 | Relevance: 5 Seminal.");
  assert.equal(F.excerpt("Only a title", "Only a title"), "");
  const long = F.excerpt("T " + "lorem ipsum dolor sit amet, ".repeat(20), "T", 60);
  assert.ok(long.length <= 61);
  assert.match(long, /[a-z]…$/);
});

test("plainTitle strips Zotero's rich-text markup and stray whitespace", () => {
  assert.equal(
    F.plainTitle("Mirror, mirror on the screen,                     <i>“Wherein can I find me?”</i>  and the <i>else</i>"),
    "Mirror, mirror on the screen, “Wherein can I find me?” and the else"
  );
  assert.equal(F.plainTitle('H<sub>2</sub>O and <span style="font-variant:small-caps;">Caps</span> <b>b</b> <span class="nocase">iPhone</span>'), "H2O and Caps b iPhone");
  assert.equal(F.plainTitle("a < b > c"), "a < b > c"); // not markup
  assert.equal(F.plainTitle(null), "");
});

test("neutralizeHtml: raw tags outside code are shown as text; safe inline tags and autolinks stay", () => {
  const md = 'a <td background="http://x/p.gif"> <b>b</b> <br> <BR/> <https://a.org> <!-- c --> <span style="x">s</span> 1 < 2 <3';
  assert.equal(
    F.neutralizeHtml(md),
    'a &lt;td background="http://x/p.gif"> <b>b</b> <br> <BR/> <https://a.org> &lt;!-- c --> &lt;span style="x">s&lt;/span> 1 < 2 <3'
  );
  // code is left alone: fenced blocks (``` and ~~~) and inline spans of any backtick count
  const code = "```html\n<div>x</div>\n```\n~~~\n<p>\n~~~\nuse `<div>` or ``a ` <i>`` then <div>";
  assert.equal(F.neutralizeHtml(code), "```html\n<div>x</div>\n```\n~~~\n<p>\n~~~\nuse `<div>` or ``a ` <i>`` then &lt;div>");
});

test("colorLinks: web and mail links (and autolinks) become colored anchors; code, images and bad colors untouched", () => {
  const md = "[a](https://x.org/?q=1&r=\"2\") [m](mailto:a@b.c) <https://y.org/a&b> ![i](https://i.png) `[c](https://c.org)` [app](zotero://s)";
  assert.equal(
    F.colorLinks(md, "#7aa2f7"),
    '<a href="https://x.org/?q=1&amp;r=%222%22" style="color:#7aa2f7">a</a> <a href="mailto:a@b.c" style="color:#7aa2f7">m</a> ' +
      '<a href="https://y.org/a&amp;b" style="color:#7aa2f7">https://y.org/a&amp;b</a> ![i](https://i.png) `[c](https://c.org)` [app](zotero://s)'
  );
  assert.equal(F.colorLinks("[a](https://x.org) [b](https://y.org)", "#123456").match(/<a /g).length, 2); // adjacent links
  assert.equal(F.colorLinks("[a](https://x.org)", "red; background:url(x)"), "[a](https://x.org)");
});

test("format: neutralizes HTML before, and colors links after, truncation", () => {
  const r = F.format("<script>x</script> [a](https://x.org)", 0, { linkColor: "#abcdef" });
  assert.equal(r.markdown, '&lt;script>x&lt;/script> <a href="https://x.org" style="color:#abcdef">a</a>');
  assert.equal(r.chars, "&lt;script>x&lt;/script> [a](https://x.org)".length);
});

test("spaceParagraphs: spacers between paragraphs and around blocks, never inside lists, code or before headings", () => {
  const SP = F.SPACER;
  const md = "# T\n\npara one\n\npara two\n\n- a\n\n- b\n\n    continued\n\n- c\n\nafter list\n\n## H\n\n```\ncode\n\nmore\n```\n\nend";
  assert.equal(
    F.spaceParagraphs(md),
    `# T\n\npara one\n\n${SP}\n\npara two\n\n${SP}\n\n- a\n\n- b\n\n    continued\n\n- c\n\n${SP}\n\nafter list\n\n## H\n\n\`\`\`\ncode\n\nmore\n\`\`\`\n\n${SP}\n\nend`
  );
  assert.equal(F.spaceParagraphs("one"), "one");
  // only the display format (linkColor given) gets spacers; copies and plain output don't
  assert.equal(F.format("a\n\nb").markdown, "a\n\nb");
  assert.equal(F.format("a\n\nb", 0, { linkColor: "#123456" }).markdown, `a\n\n${SP}\n\nb`);
});

test("separateBlocks keeps paragraphs, headings, items and cells apart in plain text", () => {
  const html = "<h1>Summary</h1><p>First.</p><p>Second<br>line</p><ul><li>a</li><li>b</li></ul><table><tr><td><p>A</p></td><td>B</td></tr></table>";
  const text = F.separateBlocks(html, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  assert.equal(text, "Summary First. Second line a b A B");
  assert.equal(F.excerpt(text, "Summary"), "First. Second line a b A B");
});
