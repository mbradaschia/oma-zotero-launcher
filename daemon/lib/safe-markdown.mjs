// Markdown from a model, safe to render or to save as a note: nothing in it loads by itself.
// A paper can steer the answer, and an image (![alt](https://…?q=what-the-paper-says)) or a raw
// <img> tag would fetch its URL as soon as it is shown, carrying text out.
//
// No Markdown parsing (a parser that disagrees with the renderer, on code spans, fences or escapes,
// is a way around it): an invisible zero-width space goes between "!" and "[" and after a "<" that
// would open a tag. Neither can then form an image or a tag anywhere, whatever surrounds them
// (backslashes, code, lists); "![a](u)" is "!" and a link (it opens only when clicked), "<img …>" is
// text. In code they look the same as before. The launcher's chat window does the same (lib/Views.js).
const ZWSP = "​";

export function safeMarkdown(text) {
  return String(text == null ? "" : text)
    .replace(/!\[/g, "!" + ZWSP + "[")
    .replace(/<(?=[A-Za-z!?\/])/g, "<" + ZWSP);
}
