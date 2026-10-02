// Markdown from a model, safe to render or to save as a note: nothing in it loads by itself.
// A paper can steer the answer, and an image (![alt](https://…?q=what-the-paper-says)) or a raw
// <img> tag would fetch its URL as soon as it is shown, carrying text out. So images become links
// (the "!" kept as text: a link opens only when clicked) and raw HTML tags show as text; code, fenced
// or inline, is left as written. The launcher's chat window uses the same rules (lib/Views.js).
const OPEN_TAG = /<(?=[A-Za-z!?\/])/g;

// A "![" opens an image unless an odd run of backslashes escapes its "!": an even run (none, or
// "\\" pairs, which are literal backslashes) gets one more, so "\\![" becomes "\\\\![", not an image.
function neutralize(part) {
  return part.replace(/(\\*)!\[/g, (m, bs) => (bs.length % 2 === 0 ? bs + "\\![" : m)).replace(OPEN_TAG, "&lt;");
}

// Outside inline code spans (`…`, ``…``), as Markdown counts them.
function neutralizeLine(line) {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const tick = line.indexOf("`", i);
    if (tick < 0) { out += neutralize(line.slice(i)); break; }
    out += neutralize(line.slice(i, tick));
    let run = tick;
    while (line[run] === "`") run++;
    const fence = line.slice(tick, run);
    const close = line.indexOf(fence, run);
    if (close < 0) { out += neutralize(line.slice(tick)); break; }
    out += line.slice(tick, close + fence.length);
    i = close + fence.length;
  }
  return out;
}

export function safeMarkdown(text) {
  let fence = null;
  return String(text == null ? "" : text).split("\n").map((line) => {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      return line;
    }
    if (f) { fence = f[1]; return line; }
    return neutralizeLine(line);
  }).join("\n");
}
