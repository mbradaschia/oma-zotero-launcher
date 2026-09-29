// The models Claude Code offers this account, with the effort levels each takes,
// straight from the Agent SDK (Query.supportedModels()), cached for a day.
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function cachePath(env = process.env) {
  return join(env.XDG_CACHE_HOME || join(env.HOME || "", ".cache"), "oma-zotero-launcher", "models.json");
}

// SDK ModelInfo rows → what the overlay needs.
export function normalizeModels(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r.value === "string" && r.value)
    .map((r) => ({
      value: r.value,
      displayName: String(r.displayName || r.value),
      description: String(r.description || ""),
      resolvedModel: String(r.resolvedModel || ""),
      efforts: r.supportsEffort && Array.isArray(r.supportedEffortLevels) ? r.supportedEffortLevels.map(String) : [],
    }));
}

export async function fetchModels(queryImpl) {
  const query = queryImpl || (await import("@anthropic-ai/claude-agent-sdk")).query;
  // Streaming input that never sends a message: the CLI starts, answers the
  // control request, and is closed without a model call.
  const idle = (async function* () { await new Promise(() => {}); })();
  const q = query({ prompt: idle, options: { settingSources: [], tools: [], persistSession: false } });
  try {
    return normalizeModels(await q.supportedModels());
  } finally {
    try { q.close?.(); } catch { /* closed */ }
  }
}

// { models, fetchedAt, stale } from the cache when it is fresh, else from the SDK
// (falling back to a stale cache when that fails).
export async function getModels({ refresh = false, path = cachePath(), queryImpl, now = Date.now() } = {}) {
  let cached = null;
  try {
    cached = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(cached.models)) cached = null;
  } catch { /* none yet */ }
  const age = cached ? now - (Date.parse(cached.fetchedAt) || statSync(path).mtimeMs) : Infinity;
  if (cached && !refresh && age < MAX_AGE_MS) return { ...cached, stale: false };
  try {
    const models = await fetchModels(queryImpl);
    if (!models.length) throw new Error("the SDK listed no models");
    const out = { models, fetchedAt: new Date(now).toISOString() };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(out));
    return { ...out, stale: false };
  } catch (e) {
    if (cached) return { ...cached, stale: true, error: e.message };
    throw e;
  }
}
