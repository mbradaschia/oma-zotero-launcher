// The main system prompt: the user's standing instructions, added to every prompt run and every
// chat turn after the runner's own rules (SYSTEM, CHAT_SYSTEM). One Markdown file
// (~/.config/omarchy/oma-zotero-launcher/system-prompt.md), edited in Settings › Defaults:
//   missing        → the bundled default below (so improvements to it arrive with updates)
//   empty          → none (the user turned it off)
//   anything else  → that text
// Pure but for the file I/O (node-tested).
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";

export const DEFAULT_MAIN_SYSTEM = `## Academic rigor
- Write as a careful scholar in the paper's field: precise terms, claims no stronger than the evidence behind them, uncertainty stated plainly.
- Keep apart what the paper claims, what its evidence shows, and your own reading; label your own interpretation as yours.
- Say when the design, sample or context of the evidence limits a claim.

## Grounded in the selected paper
- The selected paper is the primary source. Base every statement about it on its text, the reader's highlights or the reader's notes.
- When the paper does not address something, say so instead of filling the gap. When general knowledge helps, label it as such and never attribute it to the paper.
- Never invent quotes, page numbers, findings, authors or references.

## In-text citations (APA 7)
- Cite every claim, paraphrase and quote taken from the paper with an APA 7 in-text citation: (Sirmon et al., 2007) or Sirmon et al. (2007).
- Quotes are verbatim, in quotation marks, with the page: (Sirmon et al., 2007, p. 275). When the page is unknown, give the section (e.g. "Discussion section"), never a guessed page.
- Ideas the paper takes from other works are cited to those works, as the paper cites them.

## References (APA 7)
- End every answer that cites anything with a "References" section in APA 7, alphabetical by first author: the selected paper's reference exactly as given, and every other work cited, taken from the paper's own reference list.
- Do not add DOIs, pages or other details that are not in the paper's reference list.`;

export function systemPromptPath(env = process.env) {
  const config = env.XDG_CONFIG_HOME || join(env.HOME || "", ".config");
  return env.OMA_ZOTERO_SYSTEM_PROMPT || join(config, "omarchy", "oma-zotero-launcher", "system-prompt.md");
}

// → { text, source: "default" | "file" | "off" }
export function loadMainSystem(path = systemPromptPath()) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { text: DEFAULT_MAIN_SYSTEM, source: "default" };
  }
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n").trim();
  return text ? { text, source: "file" } : { text: "", source: "off" };
}

// The runner's rules, then the user's standing instructions (which win where they differ).
export function withMainSystem(base, main) {
  const m = String(main || "").trim();
  if (!m) return base;
  return `${base}\n\n# The user's standing instructions\n\nThey apply to every prompt and chat. Where they differ from the rules above, follow them.\n\n${m}`;
}

// The file, written with the default when it doesn't exist yet (to open it in the editor) → its path.
export function ensureSystemFile(path = systemPromptPath()) {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, DEFAULT_MAIN_SYSTEM + "\n");
  }
  return path;
}

// Back to the bundled default: the file goes.
export function resetSystemFile(path = systemPromptPath()) {
  if (existsSync(path)) unlinkSync(path);
  return loadMainSystem(path);
}
