// What the model is told besides the paper: the runner's short description of its job (SYSTEM,
// CHAT_SYSTEM: no rules), then the rules picked in Settings › Rules (rules.json, the settings
// file's "rules" section: { id: true|false } over each rule's default), then the user's own
// instructions (~/.config/omarchy/oma-zotero-launcher/instructions.md; missing or empty: none;
// <!-- comments --> are left out). Pure but for the file I/O (node-tested).
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const RULES_PATH = join(dirname(fileURLToPath(import.meta.url)), "rules.json");

export function loadRules(path = RULES_PATH) {
  return JSON.parse(readFileSync(path, "utf8")).rules;
}

// A rule's text for "prompt" or "chat" ("" when it doesn't apply there).
export function ruleText(rule, context) {
  return String(rule[context] || rule.text || "").trim();
}

// The rules on for `context`, in order: the default unless the settings say otherwise.
export function activeRules(rules, overrides = {}, context = "prompt") {
  return rules.filter((r) => (typeof overrides[r.id] === "boolean" ? overrides[r.id] : r.on !== false) && ruleText(r, context));
}

// "## Section\n- rule\n- rule\n\n## Section…"
export function rulesMarkdown(active, context) {
  const out = [];
  let section = null;
  for (const r of active) {
    if (r.section !== section) {
      if (section !== null) out.push("");
      out.push(`## ${r.section}`);
      section = r.section;
    }
    out.push(`- ${ruleText(r, context)}`);
  }
  return out.join("\n");
}

export function instructionsPath(env = process.env) {
  const config = env.XDG_CONFIG_HOME || join(env.HOME || "", ".config");
  return env.OMA_ZOTERO_INSTRUCTIONS || join(config, "omarchy", "oma-zotero-launcher", "instructions.md");
}

export const INSTRUCTIONS_TEMPLATE = `<!--
Your own instructions for every prompt run and chat, added after the rules you pick in
Settings › Rules. Where they differ from those rules, these win. Write them below, in Markdown;
anything inside these comment marks is left out. An empty file: no instructions of your own.
-->
`;

// The user's own instructions ("" when none).
export function loadInstructions(path = instructionsPath()) {
  try {
    return readFileSync(path, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "").trim();
  } catch {
    return "";
  }
}

// The file, with the template when it doesn't exist yet (to open it in the editor) → its path.
export function ensureInstructionsFile(path = instructionsPath()) {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, INSTRUCTIONS_TEMPLATE + "\n");
  }
  return path;
}

export function clearInstructions(path = instructionsPath()) {
  if (existsSync(path)) unlinkSync(path);
}

// The rules and the user's own instructions, as Markdown ("" when neither): what the meta prompt
// is told every prompt already gets.
export function standingText({ rules, overrides, instructions = "", context = "prompt" }) {
  const parts = [];
  const md = rulesMarkdown(activeRules(rules, overrides, context), context);
  if (md) parts.push(md);
  if (instructions) parts.push(`## The user's own instructions\n\n${instructions}`);
  return parts.join("\n\n");
}

// The system prompt: the runner's description of the job, the rules, the user's own instructions.
export function systemFor(base, { rules, overrides = {}, instructions = "", context = "prompt" }) {
  const out = [base];
  const md = rulesMarkdown(activeRules(rules, overrides, context), context);
  if (md) out.push(`# Rules\n\n${md}`);
  if (instructions) out.push(`# The user's own instructions\n\nWhere they differ from the rules above, follow them.\n\n${instructions}`);
  return out.join("\n\n");
}
