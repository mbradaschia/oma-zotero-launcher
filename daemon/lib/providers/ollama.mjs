// Ollama, on this computer: private and free. Through its own API (/api/chat), not the
// OpenAI-compatible one, so each request sets the context it needs (num_ctx): Ollama's default
// is a few thousand tokens and it cuts longer prompts silently, which would drop most of a paper.
import http from "node:http";
import https from "node:https";
import { getJson } from "./aisdk.mjs";
import { estimateTokens } from "../context.mjs";

// A POST without the header timeout of Node's fetch (5 minutes): on a CPU, a local model can
// read a paper for longer than that before its first word. → a fetch-like response.
export function postLong(url, { body, signal } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === "https:" ? https : http).request(u, { method: "POST", headers: { "Content-Type": "application/json" }, signal }, (res) => {
      const text = async () => {
        let s = "";
        for await (const c of res) s += c;
        return s;
      };
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: res, text });
    });
    req.on("error", reject);
    req.end(body);
  });
}

const ANSWER_ROOM = 8192; // tokens left for the answer (and its thinking)

function root(config) {
  return String(config.baseURL || "http://localhost:11434/v1").replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

// The context a request needs: its size plus room for the answer, in steps of 4k, within the
// model's own limit and the user's cap (a large context takes memory).
export function numCtx(messages, system, { max = 0, cap = 0 } = {}) {
  const need = estimateTokens(system) + messages.reduce((n, m) => n + estimateTokens(m.content), 0) + ANSWER_ROOM;
  let n = Math.ceil(need / 4096) * 4096;
  if (cap) n = Math.min(n, cap);
  if (max) n = Math.min(n, max);
  return Math.max(n, 4096);
}

async function show(config, model, fetchImpl) {
  const res = await fetchImpl(root(config) + "/api/show", { method: "POST", body: JSON.stringify({ model }), signal: AbortSignal.timeout(10000) });
  if (!res.ok) return {};
  const j = await res.json();
  const info = j.model_info || {};
  const key = Object.keys(info).find((k) => k.endsWith(".context_length"));
  return { context: key ? Number(info[key]) : 0, thinking: (j.capabilities || []).includes("thinking"), completion: (j.capabilities || []).includes("completion"), size: j.details && j.details.parameter_size };
}

export const ollama = {
  id: "ollama",
  name: "Ollama",
  kind: "local",
  stateful: false,
  needsKey: false,
  privacy: "Nothing leaves this computer: the model runs here.",
  cost: "Free: it runs on your hardware (a model of 8B or more quotes more faithfully).",
  async detect(ctx, config = { baseURL: "" }) {
    try {
      const j = await getJson(root(config) + "/api/tags", {}, ctx.fetch);
      const n = (j.models || []).length;
      return { available: true, signedIn: true, detail: n ? `running, with ${n} model${n === 1 ? "" : "s"}` : "running, but no models pulled yet (ollama pull <model>)" };
    } catch {
      return { available: false, signedIn: false, detail: "" };
    }
  },
  async status(config, ctx) {
    let models;
    try {
      models = await this.listModels(config, ctx);
    } catch (e) {
      return { ok: false, detail: `Ollama isn't answering at ${root(config)} (omarchy pkg add ollama, then start it): ${e.message}` };
    }
    if (!models.length) return { ok: false, detail: "Ollama runs, but has no models: ollama pull qwen3:8b (or another)" };
    return { ok: true, detail: `${models.length} model${models.length === 1 ? "" : "s"}`, models };
  },
  async listModels(config, ctx) {
    const j = await getJson(root(config) + "/api/tags", {}, ctx.fetch);
    const out = [];
    for (const m of j.models || []) {
      let s = {};
      try { s = await show(config, m.name, ctx.fetch); } catch { /* keep the name */ }
      if (s.completion === false) continue; // embedding models
      const context = config.context ? Math.min(config.context, s.context || config.context) : s.context || 0;
      out.push({ id: m.name, name: m.name, description: [s.size || (m.details && m.details.parameter_size), "on this computer"].filter(Boolean).join(" · "), context, efforts: s.thinking ? ["low", "medium", "high"] : [], priceIn: 0, priceOut: 0 });
    }
    return out;
  },
  async stream({ config, model, system, messages, effort, onDelta, onStatus, signal, ctx }) {
    const fetchImpl = ctx.fetch || fetch;
    const post = ctx.fetch ? (url, o) => ctx.fetch(url, Object.assign({ method: "POST" }, o)) : postLong;
    let info = {};
    try { info = await show(config, model, fetchImpl); } catch { /* defaults */ }
    const body = {
      model,
      stream: true,
      messages: [{ role: "system", content: system }].concat(messages.map((m) => ({ role: m.role, content: m.content }))),
      options: { num_ctx: numCtx(messages, system, { max: info.context, cap: config.context }) },
      // Thinking stays apart from the answer (message.thinking); "think: false" makes some models
      // (qwen3) think in the answer itself, so no effort leaves it to the model. Levels are for
      // gpt-oss; the others think or not.
      ...(info.thinking && effort ? { think: /gpt-oss/.test(model) ? (["low", "medium", "high"].includes(effort) ? effort : "high") : true } : {}),
    };
    let res;
    try {
      if (onStatus) onStatus(`Reading the paper with ${model} on this computer (a first question can take minutes)…`);
      res = await post(root(config) + "/api/chat", { body: JSON.stringify(body), signal });
    } catch (e) {
      throw new Error(`Ollama isn't answering at ${root(config)}: ${e.cause ? e.cause.code || e.cause.message : e.message}`);
    }
    if (!res.ok) {
      let msg = await res.text();
      try { msg = JSON.parse(msg).error || msg; } catch { /* text */ }
      // A model that doesn't take "think": ask again without it.
      if (body.think !== undefined && /think/i.test(msg)) {
        delete body.think;
        res = await post(root(config) + "/api/chat", { body: JSON.stringify(body), signal });
        if (!res.ok) throw new Error("Ollama: " + (await res.text()).slice(0, 200));
      } else throw new Error("Ollama: " + String(msg).slice(0, 200));
    }
    let text = "";
    let last = null;
    let buf = "";
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const j = JSON.parse(line);
        if (j.error) throw new Error("Ollama: " + j.error);
        const d = j.message && j.message.content;
        if (d) {
          text += d;
          if (onDelta) onDelta(d);
        }
        if (j.done) last = j;
      }
    }
    if (!text.trim()) throw new Error("the model sent an empty answer");
    return { text, usage: { input: (last && last.prompt_eval_count) || 0, output: (last && last.eval_count) || 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, window: config.context ? Math.min(config.context, info.context || config.context) : info.context || 0 };
  },
};
