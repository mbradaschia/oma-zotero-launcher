// The API providers through the Vercel AI SDK: one streamText() for all of them. Stateless:
// every turn sends the whole conversation (the paper in the first message).
import { aiSdkReasoning, reasons } from "../modelspec.mjs";

// The SDK's usage → ours.
export function usageOf(u) {
  const x = u || {};
  return {
    input: x.inputTokens || 0,
    output: x.outputTokens || 0,
    cacheRead: (x.inputTokenDetails && x.inputTokenDetails.cacheReadTokens) || 0,
    cacheWrite: (x.inputTokenDetails && x.inputTokenDetails.cacheWriteTokens) || 0,
  };
}

// A readable reason from an API error (status and the provider's message, never the key).
export function apiError(e) {
  const status = e && (e.statusCode || e.status);
  let msg = String((e && e.message) || e || "failed");
  try {
    const body = e && e.responseBody ? JSON.parse(e.responseBody) : null;
    const m = body && ((body.error && (body.error.message || body.error)) || body.message);
    if (m && typeof m === "string") msg = m;
  } catch { /* not JSON */ }
  if (status === 401 || status === 403) return `the API key was refused (${status}): ${msg}`;
  if (status === 429) return `rate limited or out of credit (429): ${msg}`;
  return status ? `${msg} (HTTP ${status})` : msg;
}

// Stream one answer. `model`: an AI SDK language model. → { text, usage, costUsd }
export async function streamAnswer({ model, modelId, system, messages, effort, onDelta, signal, providerOptions, streamText }) {
  const st = streamText || (await import("ai")).streamText;
  const reasoning = effort && reasons(modelId) ? aiSdkReasoning(effort) : undefined;
  const r = st({
    model,
    instructions: system,
    messages,
    ...(reasoning ? { reasoning } : {}),
    ...(providerOptions ? { providerOptions } : {}),
    maxRetries: 2,
    abortSignal: signal,
    onError: () => {}, // errors come through the stream, below
  });
  let text = "";
  let failed = null;
  let finish = null;
  try {
    for await (const part of r.stream) {
      if (part.type === "text-delta") {
        const d = part.text != null ? part.text : part.delta;
        if (d) {
          text += d;
          if (onDelta) onDelta(d);
        }
      } else if (part.type === "error") failed = part.error;
      else if (part.type === "finish") finish = part;
    }
  } catch (e) {
    failed = failed || e;
  }
  if (failed) throw new Error(apiError(failed));
  const usage = usageOf(finish ? finish.totalUsage : await r.usage.catch(() => null));
  let costUsd = null;
  try {
    const meta = finish && finish.providerMetadata ? finish.providerMetadata : await r.providerMetadata;
    const c = meta && meta.openrouter && meta.openrouter.usage && meta.openrouter.usage.cost;
    if (typeof c === "number") costUsd = c;
  } catch { /* no metadata */ }
  if (!text.trim()) throw new Error("the model sent an empty answer" + (finish && finish.finishReason ? ` (${finish.finishReason})` : ""));
  return { text, usage, costUsd };
}

// GET a JSON list with a timeout and a readable error.
export async function getJson(url, headers = {}, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new Error(`can't reach ${new URL(url).host}: ${e.cause ? e.cause.code || e.cause.message : e.message}`);
  }
  const body = await res.text();
  if (!res.ok) {
    let msg = body.slice(0, 200);
    try {
      const j = JSON.parse(body);
      msg = (j.error && (j.error.message || j.error)) || j.message || msg;
    } catch { /* text */ }
    if (res.status === 401 || res.status === 403) throw new Error(`the API key was refused (${res.status}): ${msg}`);
    throw new Error(`${new URL(url).host} answered ${res.status}: ${msg}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${new URL(url).host} didn't answer JSON`);
  }
}
