// What the runner reads from the launcher's settings file (~/.config/omarchy/oma-zotero-launcher.json):
// the providers section and the default models. The launcher's Settings view writes the file
// (lib/Settings.js validates it there); here it is read leniently, and a file from before
// sections (flat, no "providers") means what it did then: Claude, through Claude Code.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validEndpointId, validModel, EFFORTS } from "./modelspec.mjs";

export function settingsPath(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(env.HOME || "", ".config"), "omarchy", "oma-zotero-launcher.json");
}

export const DEFAULT_OLLAMA_URL = "http://localhost:11434/v1";

function obj(x) {
  return x && typeof x === "object" && !Array.isArray(x) ? x : {};
}

function modelChoice(x) {
  const o = obj(x);
  return {
    model: validModel(o.model) && o.model !== "default" ? String(o.model) : "",
    effort: o.effort === "" || EFFORTS.includes(o.effort) ? o.effort : "high",
  };
}

// raw JSON (or null) → { providers: { id: config }, endpoints: [config], defaults, rules, configured }
// `rules`: the rules turned on or off in Settings › Rules ({ id: true|false }; lib/system.mjs).
// `configured`: the file has a providers section (else the 0.1 behaviour: Claude only).
export function readSettings(raw) {
  const r = obj(raw);
  const configured = !!(raw && Object.prototype.hasOwnProperty.call(r, "providers"));
  const p = obj(r.providers);
  const providers = {};
  for (const id of ["claude", "chatgpt", "openai", "anthropic", "google", "openrouter", "ollama"]) {
    const c = obj(p[id]);
    providers[id] = { enabled: configured ? c.enabled === true : id === "claude" };
    if (typeof c.baseURL === "string" && /^https?:\/\//.test(c.baseURL)) providers[id].baseURL = c.baseURL;
    if (Number.isInteger(c.context) && c.context >= 1024) providers[id].context = c.context;
  }
  if (!providers.ollama.baseURL) providers.ollama.baseURL = DEFAULT_OLLAMA_URL;
  const endpoints = (Array.isArray(p.compatible) ? p.compatible : [])
    .map(obj)
    .filter((e) => validEndpointId(e.id) && typeof e.baseURL === "string" && /^https?:\/\//.test(e.baseURL))
    .map((e) => ({ id: e.id, name: String(e.name || e.id), baseURL: e.baseURL, enabled: e.enabled !== false, ...(Number.isInteger(e.context) && e.context >= 1024 ? { context: e.context } : {}) }));
  const d = obj(r.defaults);
  return {
    configured,
    providers,
    endpoints,
    defaults: { prompts: modelChoice(d.prompts), chat: modelChoice(d.chat), fallback: validModel(d.fallback) && d.fallback !== "default" ? String(d.fallback) : "",
      autoExtract: d.autoExtract === true },
    // Settings › General › Artifacts folder (the flat file of 0.1 had general keys at the top).
    artifactsDir: typeof (obj(r.general).artifactsDir ?? r.artifactsDir) === "string" ? String(obj(r.general).artifactsDir ?? r.artifactsDir) : "",
    rules: Object.fromEntries(Object.entries(obj(r.rules)).filter(([k, v]) => /^[a-z][a-z0-9-]{1,40}$/.test(k) && typeof v === "boolean")),
  };
}

export function loadSettings(path = settingsPath()) {
  try {
    return readSettings(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return readSettings(null);
  }
}
