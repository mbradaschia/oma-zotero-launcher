/* Pure text helpers for notes shown in the overlay (node-testable): Markdown
 * clean-up after Zotero's "Note Markdown" translator, size cap, list excerpts,
 * and plain display titles. No Zotero APIs here. */

var OmaNoteFormat = {
  // Markdown handed to the overlay. Qt renders it in one Text item, so very long
  // notes are cut (at a paragraph break) and the overlay offers "open in Zotero".
  MAX_CHARS: 60000,
  EXCERPT_CHARS: 140,

  // Translator output → { markdown, truncated, chars }. With opts.linkColor ("#rrggbb"),
  // web links become HTML anchors in that color (Qt draws Markdown links in a fixed blue).
  format(markdown, maxChars, opts) {
    const max = maxChars || OmaNoteFormat.MAX_CHARS;
    let md = String(markdown || "").replace(/\r\n?/g, "\n");
    md = OmaNoteFormat.stripImages(md);
    md = OmaNoteFormat.flattenAppLinks(md);
    md = OmaNoteFormat.neutralizeHtml(md);
    md = md
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/, (m) => (m === "  " ? m : ""))) // keep Markdown's two-space line breaks
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const chars = md.length;
    const truncated = chars > max;
    if (truncated) md = OmaNoteFormat.truncate(md, max);
    if (opts && opts.linkColor) {
      // Display only (the overlay passes its link color): links in color, air between paragraphs.
      md = OmaNoteFormat.colorLinks(md, opts.linkColor);
      md = OmaNoteFormat.spaceParagraphs(md);
    }
    return { markdown: md, truncated, chars };
  },

  // Qt's Markdown renderer puts no space between paragraphs. A small spacer line goes
  // after each paragraph (and after a list, quote, table or code block that a paragraph
  // follows), but never before a heading (it has its own margin), inside code, or
  // between list items, where it would end the list.
  SPACER: '<span style="font-size:6px">&nbsp;</span>',

  spaceParagraphs(md) {
    const blocks = [];
    let cur = [];
    let fence = null;
    for (const line of String(md).split("\n")) {
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        cur.push(line);
        if (f && f[1][0] === fence[0] && /^ {0,3}(`{3,}|~{3,})\s*$/.test(line)) fence = null;
        continue;
      }
      if (f) fence = f[1];
      if (!line.trim() && !fence) {
        if (cur.length) blocks.push(cur.join("\n"));
        cur = [];
        continue;
      }
      cur.push(line);
    }
    if (cur.length) blocks.push(cur.join("\n"));
    const kind = (b) =>
      /^ {0,3}(`{3,}|~{3,})/.test(b) ? "code"
      : /^\s/.test(b) ? "nested" // an indented block belongs to the list item above
      : /^#{1,6}\s/.test(b) ? "heading"
      : /^([-*+]|\d+[.)])\s/.test(b) ? "list"
      : /^\|/.test(b) ? "table"
      : /^>/.test(b) ? "quote"
      : /^(\* \* \*|-{3,}|_{3,})\s*$/.test(b) ? "rule"
      : "para";
    const out = [];
    for (let i = 0; i < blocks.length; i++) {
      if (i > 0) {
        const prev = kind(blocks[i - 1]);
        const next = kind(blocks[i]);
        const afterPara = prev === "para" && next !== "heading" && next !== "nested";
        const paraAfterBlock = next === "para" && ["list", "quote", "table", "code", "nested"].includes(prev);
        if (afterPara || paraAfterBlock) out.push(OmaNoteFormat.SPACER);
      }
      out.push(blocks[i]);
    }
    return out.join("\n\n");
  },

  // Apply fn to the Markdown outside fenced code blocks and inline code spans.
  mapOutsideCode(md, fn) {
    const out = [];
    let buf = [];
    let fence = null;
    const flush = () => {
      if (buf.length) out.push(OmaNoteFormat._mapOutsideInlineCode(buf.join("\n"), fn));
      buf = [];
    };
    for (const line of String(md).split("\n")) {
      if (fence) {
        out.push(line);
        const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
        if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
        continue;
      }
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (open) {
        flush();
        fence = open[1];
        out.push(line);
        continue;
      }
      buf.push(line);
    }
    flush();
    return out.join("\n");
  },

  _mapOutsideInlineCode(text, fn) {
    let out = "";
    let seg = "";
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === "\\" && i + 1 < text.length) {
        seg += c + text[i + 1];
        i += 2;
        continue;
      }
      if (c === "`") {
        let n = 0;
        while (text[i + n] === "`") n++;
        const run = "`".repeat(n);
        let close = -1;
        for (let j = text.indexOf(run, i + n); j >= 0; j = text.indexOf(run, j + 1)) {
          if (text[j + n] !== "`" && text[j - 1] !== "`") {
            close = j;
            break;
          }
        }
        if (close >= 0) {
          out += fn(seg) + text.slice(i, close + n);
          seg = "";
          i = close + n;
        } else {
          seg += run;
          i += n;
        }
        continue;
      }
      seg += c;
      i++;
    }
    return out + fn(seg);
  },

  // Qt renders raw HTML inside Markdown (and would load remote images from an <img>
  // or a background= attribute). Outside code, only a few attribute-free inline tags
  // and <https://…> autolinks are kept; any other tag is shown as text.
  neutralizeHtml(md) {
    const SAFE = /^\/?(?:b|i|u|s|em|strong|sub|sup|br|del)\s*\/?$/i;
    const AUTOLINK = /^(?:https?|mailto):[^\s<>]+$/i;
    return OmaNoteFormat.mapOutsideCode(md, (text) =>
      text.replace(/<([^<>\n]*)(>?)/g, (whole, inner, gt) => {
        if (!/^[a-zA-Z/!?]/.test(inner)) return whole; // "a < b", "<3"
        if (gt && (SAFE.test(inner) || AUTOLINK.test(inner))) return whole;
        return "&lt;" + whole.slice(1);
      })
    );
  },

  // Web and mail links → <a href style="color:…">, which Qt colors (it ignores colors on Markdown links).
  colorLinks(md, color) {
    if (!/^#[0-9a-f]{6}$/i.test(String(color || ""))) return md;
    const anchor = (url, label) => `<a href="${url.replace(/&/g, "&amp;").replace(/"/g, "%22")}" style="color:${color}">${label}</a>`;
    return OmaNoteFormat.mapOutsideCode(md, (text) =>
      text
        .replace(/(?<![!\\])\[([^\]\n]+)\]\(((?:https?|mailto):[^)\s]+)\)/gi, (whole, label, url) => anchor(url, label))
        .replace(/<((?:https?|mailto):[^\s<>]+)>/gi, (whole, url) => anchor(url, url.replace(/&/g, "&amp;")))
    );
  },

  // Images can't be shown in the overlay; keep a visible placeholder instead.
  stripImages(markdown) {
    return String(markdown || "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "[image]")
      .replace(/<img\b[^>]*>/gi, "[image]");
  },

  // Links the overlay can't follow (zotero://select, open-pdf, note links, …) keep their text.
  flattenAppLinks(markdown) {
    return String(markdown || "")
      .replace(/\[([^\]]*)\]\((?!https?:|mailto:)[a-z][a-z0-9+.-]*:[^)\s]*\)/gi, "$1")
      .replace(/<(?!https?:|mailto:)[a-z][a-z0-9+.-]*:\/\/[^>\s]*>/gi, "");
  },

  // Cut at the last paragraph break (or line, or word) before `max`.
  truncate(md, max) {
    const head = md.slice(0, max);
    for (const sep of ["\n\n", "\n", " "]) {
      const at = head.lastIndexOf(sep);
      if (at > max * 0.6) return head.slice(0, at).trimEnd();
    }
    return head.trimEnd();
  },

  // Note HTML with a separator after each block element (paragraph, heading, list item,
  // cell, …) and in place of <br>, so a text conversion doesn't run blocks together.
  separateBlocks(html, sep) {
    return String(html || "")
      .replace(/<br\s*\/?>/gi, sep)
      .replace(/<\/(?:p|div|h[1-6]|li|blockquote|pre|tr|td|th|table|ul|ol)>/gi, (m) => m + sep);
  },

  // One-line preview for the notes list: the text after the note's title.
  excerpt(text, title, max) {
    max = max || OmaNoteFormat.EXCERPT_CHARS;
    let t = String(text || "").replace(/\s+/g, " ").trim();
    const ti = String(title || "").replace(/\s+/g, " ").trim();
    if (ti && t.startsWith(ti)) t = t.slice(ti.length).trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    const at = cut.lastIndexOf(" ");
    return (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.–-]+$/, "") + "…";
  },

  // Zotero titles may carry its rich-text markup (<i>, <b>, <sub>, <sup>, small caps,
  // nocase spans) and stray runs of whitespace; the overlay shows plain text.
  plainTitle(title) {
    return String(title == null ? "" : title)
      .replace(/<\/?(?:i|b|sub|sup|span)(?:\s[^>]*)?>/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  },
};

if (typeof module !== "undefined") module.exports = OmaNoteFormat;
