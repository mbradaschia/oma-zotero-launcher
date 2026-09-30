// Chat with a paper: the saved sessions (one JSON file each, per paper), the chat's
// instructions, and the first message that grounds a session in the paper. The model's
// own conversation state is the provider's thread (a subscription's session, resumed on every
// turn) or, for the others, the chat itself, sent whole; the file keeps what the chat window shows. Pure but for the store's file I/O (node-tested).
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export function stateDir(env = process.env) {
  return join(env.XDG_STATE_HOME || join(env.HOME || "", ".local", "state"), "oma-zotero");
}

export function chatsDir(key, libraryID, env = process.env) {
  if (!/^[A-Z0-9]{8}$/.test(String(key))) throw new Error("bad item key");
  return join(stateDir(env), "chats", `${Number(libraryID) || 1}-${key}`);
}

export function newSessionId(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "") + "-" + randomBytes(3).toString("hex");
}

export function validSessionId(id) {
  return /^[0-9T-]{19,30}-[0-9a-f]{6}$/.test(String(id || ""));
}

// A session's title: its first question, shortened.
export function titleFor(text, max = 70) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t || "New chat";
}

export function loadSession(dir, id) {
  if (!validSessionId(id)) throw new Error("bad session id");
  const p = join(dir, id + ".json");
  if (!existsSync(p)) throw new Error("no such chat");
  return JSON.parse(readFileSync(p, "utf8"));
}

export function saveSession(dir, session) {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, session.id + ".json");
  writeFileSync(p + ".tmp", JSON.stringify(session, null, 1));
  renameSync(p + ".tmp", p);
}

// Forget a chat (its file; the model's side of it ends with it).
export function deleteSession(dir, id) {
  if (!validSessionId(id)) throw new Error("bad session id");
  const p = join(dir, id + ".json");
  if (!existsSync(p)) throw new Error("no such chat");
  unlinkSync(p);
}

// Newest first: [{ id, title, created, updated, turns, model }].
export function listSessions(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && validSessionId(f.slice(0, -5)))
    .map((f) => {
      try {
        const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
        return { id: s.id, title: s.title, created: s.created, updated: s.updated, turns: (s.messages || []).filter((m) => m.role === "user").length, model: s.model || "" };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
}

export const CHAT_SYSTEM = `You are a research assistant helping the user understand and use one academic paper. The first message gives you the paper: its metadata, its APA 7 reference and in-text citation (formatted by Zotero, exact), the user's highlights and notes, and its text, page by page ("[p. 275]" or "## p. 275" marks where each page starts).

- Answer from the paper. When the answer isn't in it, say so; add general knowledge only when it helps, and label it as yours, not the paper's.
- Quote verbatim, in quotation marks, with an APA 7 in-text citation and the page from the page marks, e.g. (Sirmon et al., 2007, p. 275). Never invent a quote, page or reference.
- Cite works the paper cites as the paper does. When you cite any, end with a short "References" list in APA 7, from the paper's reference list.
- Be concise. Write Markdown: short paragraphs, lists, **bold**, tables when they help; headings only for long answers, and no higher than ###.`;

// The first message of a session: the paper, then the question.
export function groundingMessage(ctx, question) {
  const lines = ["# The paper", ""];
  lines.push(`- Title: ${ctx.title}`);
  if (ctx.reference) lines.push(`- APA 7 reference: ${ctx.reference}`);
  if (ctx.citation) lines.push(`- APA 7 in-text citation: ${ctx.citation}`);
  lines.push("");
  if (ctx.annotations && ctx.annotations.length) {
    lines.push("# The user's highlights and comments", "");
    for (const a of ctx.annotations) lines.push(`- [p. ${a.pageLabel || "?"}] ${a.text ? `"${a.text}"` : ""}${a.comment ? ` — comment: ${a.comment}` : ""}`);
    lines.push("");
  }
  if (ctx.notes && ctx.notes.length) {
    lines.push("# The user's notes", "");
    for (const n of ctx.notes) lines.push(`## ${n.title || "Untitled note"}`, "", n.markdown.trim(), "");
  }
  lines.push(`# The paper's text (${ctx.grounding ? ctx.grounding.label : "not available"})`, "");
  lines.push(ctx.text ? `<paper>\n${ctx.text}\n</paper>` : "(Not available: answer from the metadata, highlights and notes, and say so.)");
  lines.push("", "# The question", "", question);
  return lines.join("\n");
}

// When the SDK session is gone (Claude Code cleared it): the grounding again, then the
// conversation so far, then the new question.
export function replayMessage(ctx, messages, question) {
  const history = messages.map((m) => `**${m.role === "user" ? "User" : "You"}:** ${m.text}`).join("\n\n");
  return groundingMessage(ctx, `(Our conversation so far:)\n\n${history}\n\n(Now:) ${question}`);
}
