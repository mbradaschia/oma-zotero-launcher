// The providers behind one interface (PLAN-providers.md §4.1):
//
//   provider.detect(ctx)                 → { available, signedIn, detail }, without configuration
//   provider.status(config, ctx)         → { ok, detail, models? }: the Test connection
//   provider.listModels(config, ctx)     → [{ id, name, description, context, efforts, priceIn?, priceOut? }]
//   provider.stream({ config, model, effort, system, messages | message, resume, onDelta, signal, ctx })
//                                        → { text, usage: { input, output, cacheRead, cacheWrite }, costUsd, session?, window? }
//
// Stateful providers (the subscriptions) keep the conversation themselves: they get the new
// `message` and the `resume` id. The others get the whole conversation as `messages`.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { claude } from "./claude.mjs";
import { chatgpt } from "./chatgpt.mjs";
import { openai, anthropic, google, openrouter, compatible } from "./api.mjs";
import { ollama } from "./ollama.mjs";
import { parseModel } from "../modelspec.mjs";
import { resolveKey, envKey, ENV_KEYS, maskKey, getSecret } from "../secrets.mjs";

export const BUILTIN_PROVIDERS = [claude, chatgpt, openai, anthropic, google, openrouter, ollama];

// Suggested first picks (the pickers list everything the provider offers).
export const SUGGESTED = { claude: "opus[1m]" };

export function endpointIds(settings) {
  return (settings.endpoints || []).map((e) => e.id);
}

export function allProviders(settings) {
  return BUILTIN_PROVIDERS.concat((settings.endpoints || []).map(compatible));
}

export function providerById(id, settings) {
  return allProviders(settings).find((p) => p.id === id) || null;
}

export function configFor(id, settings) {
  return (settings.providers || {})[id] || (settings.endpoints || []).find((e) => e.id === id) || { enabled: false };
}

export function isEnabled(id, settings) {
  return !!configFor(id, settings).enabled;
}

export function enabledProviders(settings) {
  return allProviders(settings).filter((p) => isEnabled(p.id, settings));
}

// What the providers need from the outside world; tests pass fakes.
export function makeCtx(o = {}) {
  const env = o.env || process.env;
  return {
    env,
    fetch: o.fetch || globalThis.fetch,
    stateDir: o.stateDir || join(env.XDG_STATE_HOME || join(env.HOME || "", ".local", "state"), "oma-zotero"),
    learned: o.learned || {},
    key: o.key || ((id) => resolveKey(id, { env })),
    envKey: (id) => envKey(id, env),
    envNames: (id) => (ENV_KEYS[id] ? "set " + ENV_KEYS[id].join(" or ") : "none needed"),
    streamText: o.streamText,
    agentSdk: o.agentSdk,
    codexSdk: o.codexSdk,
    codexBin: o.codexBin || env.OMA_CODEX_BIN || "",
  };
}

// The model a run or a chat uses: `spec` ("provider:model", a bare Claude name, "default" or
// "") → { provider, model, spec, note? }. A default comes from the settings; a model whose
// provider is off falls back to the default, with a note saying so.
export function resolveModel(spec, settings, purpose = "prompts") {
  const eps = endpointIds(settings);
  const pick = (s) => {
    const m = parseModel(s, eps);
    return { provider: m.provider, model: m.model, spec: m.provider + ":" + m.model };
  };
  const fallbackDefault = () => {
    const d = settings.defaults && settings.defaults[purpose] && settings.defaults[purpose].model;
    if (d && isEnabled(pick(d).provider, settings)) return pick(d);
    if (isEnabled("claude", settings)) return pick("claude:" + SUGGESTED.claude);
    return null;
  };
  if (!spec || spec === "default") {
    const d = fallbackDefault();
    if (!d) throw new Error(enabledProviders(settings).length ? "no default model yet: choose one in Settings › Defaults" : "no AI model is set up: open Settings › Models & providers in the launcher");
    return d;
  }
  const m = pick(spec);
  if (isEnabled(m.provider, settings)) return m;
  const d = fallbackDefault();
  const name = (providerById(m.provider, settings) || { name: m.provider }).name;
  if (!d) throw new Error(`${name} is off, and there is no default model: open Settings › Models & providers in the launcher`);
  return Object.assign(d, { note: `${name} is off: using the default model, ${d.spec}` });
}

// ---------------------------------------------------------------- model lists, cached a day

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function cacheDir(env = process.env) {
  return join(env.XDG_CACHE_HOME || join(env.HOME || "", ".cache"), "oma-zotero-launcher");
}

function cacheKey(p, config) {
  return createHash("sha1").update(JSON.stringify([p.id, config.baseURL || "", config.context || 0])).digest("hex").slice(0, 10);
}

export async function modelsOf(p, settings, ctx, { refresh = false, now = Date.now() } = {}) {
  const config = configFor(p.id, settings);
  const path = join(cacheDir(ctx.env), `models-${p.id}.json`);
  let cached = null;
  try {
    cached = JSON.parse(readFileSync(path, "utf8"));
    if (cached.key !== cacheKey(p, config)) cached = null;
  } catch { /* none yet */ }
  if (cached && !refresh && now - Date.parse(cached.fetchedAt) < MAX_AGE_MS) return cached.models;
  try {
    const models = await p.listModels(config, ctx, { refresh });
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({ key: cacheKey(p, config), fetchedAt: new Date(now).toISOString(), models }));
    } catch { /* a cache */ }
    return models;
  } catch (e) {
    if (cached) return cached.models;
    throw e;
  }
}

// Every enabled provider's models, grouped: [{ id, name, kind, ok, detail, models: [{ value, … }] }]
// (value = "provider:model").
export async function listAll(settings, ctx, { refresh = false } = {}) {
  const out = [];
  await Promise.all(enabledProviders(settings).map(async (p, i) => {
    let g;
    try {
      const models = await modelsOf(p, settings, ctx, { refresh });
      g = { id: p.id, name: p.name, kind: p.kind, ok: true, detail: "", models: models.map((m) => Object.assign({ value: p.id + ":" + m.id, displayName: m.name, group: p.name }, m)) };
    } catch (e) {
      g = { id: p.id, name: p.name, kind: p.kind, ok: false, detail: e.message, models: [] };
    }
    out[i] = g;
  }));
  return out.filter(Boolean);
}

export async function findModelInfo(settings, ctx, provider, model) {
  const p = providerById(provider, settings);
  if (!p) return null;
  try {
    return (await modelsOf(p, settings, ctx)).find((m) => m.id === model) || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the Settings pages

// What Settings › Models & providers shows for each provider.
export async function describeAll(settings, ctx, { keyringOk = true } = {}) {
  return Promise.all(allProviders(settings).map(async (p) => {
    const config = configFor(p.id, settings);
    let detected = { available: false, signedIn: false, detail: "" };
    try { detected = await p.detect(ctx, config); } catch { /* not there */ }
    const stored = keyringOk && (p.needsKey || p.endpoint) ? getSecret(p.id, { env: ctx.env }) : null;
    const fromEnv = ctx.envKey(p.id);
    return {
      id: p.id, name: p.name, kind: p.kind, enabled: !!config.enabled, endpoint: !!p.endpoint,
      needsKey: !!p.needsKey, takesKey: !!(p.needsKey || p.endpoint),
      key: stored ? { set: true, from: "keyring", masked: maskKey(stored) } : fromEnv ? { set: true, from: fromEnv.from, masked: maskKey(fromEnv.value) } : { set: false, from: "", masked: "" },
      envNames: ENV_KEYS[p.id] || [],
      detected, baseURL: config.baseURL || "", context: config.context || 0,
      privacy: p.privacy, cost: p.cost, keyUrl: p.keyUrl || "", signIn: p.signIn || "",
    };
  }));
}
