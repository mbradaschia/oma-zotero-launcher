// Keeping a chat inside its model's context window. After each turn the runner records how
// much of the window the conversation uses; before a question that would push it past
// COMPACT_AT, the earlier exchanges are summarized (quotes and their pages kept) and the chat
// continues in a fresh session: the paper, whole, then the summary, then the last exchanges
// verbatim. The paper is never summarized: it is what the answers quote. Pure (node-tested).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { groundingMessage } from "./chat.mjs";

export const COMPACT_AT = Number(process.env.OMA_COMPACT_AT) || 0.75; // of the window, room for the answer included (OMA_COMPACT_AT: tests)
export const ANSWER_RESERVE = 16000; // tokens kept free for the next answer
export const KEEP_EXCHANGES = 2; // the last questions and answers kept verbatim
export const PAPER_SHARE = 0.6; // the most of the window the paper's text may take
export const DEFAULT_WINDOW = 200000;
// Known before the first answer reports it; afterwards the model's own figure is remembered.
export const KNOWN_WINDOWS = { "opus[1m]": 1000000, "sonnet[1m]": 1000000, default: 1000000 };

// A rough count: about 3.6 characters per token for English prose and Markdown.
export function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 3.6);
}

// How full a turn left the window: its input (cached or not) and its output, from the SDK's
// usage and per-model usage (which carries the model's context window).
export function measure(usage, modelUsage) {
  const u = usage || {};
  const used = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
  let window = 0;
  for (const k of Object.keys(modelUsage || {})) window = Math.max(window, Number(modelUsage[k].contextWindow) || 0);
  return { used, window };
}

export function windowFor(model, learned) {
  return (learned && learned[model]) || KNOWN_WINDOWS[model] || DEFAULT_WINDOW;
}

// Would this question (and its answer) push the chat past the threshold?
export function needsCompaction(context, question, { at = COMPACT_AT, reserve = ANSWER_RESERVE } = {}) {
  if (!context || !context.window || !context.used) return false;
  return context.used + estimateTokens(question) + reserve > context.window * at;
}

// The exchanges to summarize and the ones kept verbatim. Notes (compaction markers) are skipped.
export function splitHistory(messages, keep = KEEP_EXCHANGES) {
  const turns = (messages || []).filter((m) => m.role === "user" || m.role === "assistant");
  let users = 0;
  let cut = turns.length;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === "user" && ++users === keep) {
      cut = i;
      break;
    }
  }
  if (users < keep) cut = 0;
  return { older: turns.slice(0, cut), recent: turns.slice(cut) };
}

const transcript = (msgs) => msgs.map((m) => `**${m.role === "user" ? "User" : "Assistant"}:** ${m.text}`).join("\n\n");

export const COMPACT_SYSTEM = "You condense a research conversation about one academic paper so it can continue in less space. Output only the summary.";

// The request for a summary of the earlier exchanges (and of an earlier summary, if any).
export function compactionPrompt(older, previousSummary) {
  return [
    "Summarize the conversation below between a user and an assistant about an academic paper, so the conversation can continue without it.",
    "",
    "Keep, as a compact Markdown list:",
    "- every question the user asked, in a few words, and the answer's substance;",
    "- every verbatim quote with its citation and page, exactly as written (e.g. \"…\" (Sirmon et al., 2007, p. 275));",
    "- conclusions reached, definitions agreed on, and what the user seems to be working towards;",
    "- open questions and anything the user asked to come back to.",
    "Drop pleasantries and repetition. Do not add anything that is not in the conversation.",
    "",
    previousSummary ? `# Summary of the conversation before this part\n\n${previousSummary}\n` : "",
    "# The conversation",
    "",
    transcript(older),
  ].filter((l) => l !== "").join("\n");
}

// The first message of the session that continues a compacted chat.
export function compactedMessage(ctx, summary, recent, question) {
  const parts = ["(Our conversation so far, summarized:)", "", summary];
  if (recent.length) parts.push("", "(The last questions and answers, verbatim:)", "", transcript(recent));
  parts.push("", "(Now:) " + question);
  return groundingMessage(ctx, parts.join("\n"));
}

// The paper's text, cut so the whole grounding message leaves room in the window.
export function fitPaper(text, window, share = PAPER_SHARE) {
  const max = Math.floor(window * share * 3.6);
  if (!text || text.length <= max) return { text, cut: false };
  return { text: text.slice(0, max) + "\n\n[… the text is cut here to fit this model's context window]", cut: true };
}

// Context windows learned from the models' own reports, remembered across chats.
export function loadWindows(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export function saveWindow(path, model, window) {
  if (!model || !window) return;
  const all = loadWindows(path);
  if (all[model] === window) return;
  all[model] = window;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(all));
  } catch { /* a cache */ }
}
