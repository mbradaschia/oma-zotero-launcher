// API-key providers (OpenAI, Anthropic, Google Gemini, OpenRouter) and OpenAI-compatible
// endpoints (LM Studio, vLLM, llama.cpp, institutional gateways), through the AI SDK.
import { streamAnswer, getJson } from "./aisdk.mjs";
import { effortsFor, guessWindow } from "../modelspec.mjs";

const PAPER = "the paper's metadata and text, your highlights and notes, and your questions";

// Models listed as the pickers need them: [{ id, name, description, context, efforts, priceIn, priceOut }]
// (prices per million tokens, when the provider says).

function openaiChat(id) {
  return /^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|image|tts|transcribe|embedding|search|moderation|dall-e|whisper|instruct)/.test(id);
}

const base = {
  kind: "api",
  stateful: false,
  needsKey: true,
  async detect(ctx) {
    const k = ctx.envKey(this.id);
    return k ? { available: true, signedIn: true, detail: `${k.from} is set` } : { available: false, signedIn: false, detail: "" };
  },
  async status(config, ctx) {
    const key = ctx.key(this.id);
    if (this.needsKey && !key) return { ok: false, detail: "no API key: set one here, or " + ctx.envNames(this.id) };
    const models = await this.listModels(config, ctx);
    if (!models.length) return { ok: false, detail: "the key works, but it lists no chat models" };
    return { ok: true, detail: `${models.length} models`, models };
  },
  async stream(o) {
    const { createModel } = this;
    const key = o.ctx.key(this.id);
    if (this.needsKey && !key) throw new Error(`${this.name}: no API key (Settings › Models & providers)`);
    const model = await createModel.call(this, o.config, key ? key.value : "", o.model);
    const messages = this.cacheFirstMessage && o.messages.length ? [Object.assign({}, o.messages[0], { providerOptions: this.cacheFirstMessage })].concat(o.messages.slice(1)) : o.messages;
    return streamAnswer({ model, modelId: o.model, system: o.system, messages, effort: o.effort, onDelta: o.onDelta, signal: o.signal, streamText: o.ctx.streamText });
  },
};

export const openai = Object.assign(Object.create(base), {
  id: "openai",
  name: "OpenAI API",
  keyUrl: "https://platform.openai.com/api-keys",
  privacy: `Sends ${PAPER} to OpenAI.`,
  cost: "Pay per token, billed by OpenAI.",
  async createModel(config, key, id) {
    const { createOpenAI } = await import("@ai-sdk/openai");
    return createOpenAI({ apiKey: key, ...(config.baseURL ? { baseURL: config.baseURL } : {}) })(id);
  },
  async listModels(config, ctx) {
    const key = ctx.key("openai");
    const j = await getJson((config.baseURL || "https://api.openai.com/v1") + "/models", { Authorization: "Bearer " + (key ? key.value : "") }, ctx.fetch);
    return (j.data || []).map((m) => m.id).filter(openaiChat).sort().reverse()
      .map((id) => ({ id, name: id, description: "", context: guessWindow(id), efforts: effortsFor(id) }));
  },
});

export const anthropic = Object.assign(Object.create(base), {
  id: "anthropic",
  name: "Anthropic API",
  keyUrl: "https://console.anthropic.com/settings/keys",
  privacy: `Sends ${PAPER} to Anthropic.`,
  cost: "Pay per token, billed by Anthropic (the paper is cached between chat turns, which costs less).",
  async createModel(config, key, id) {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    return createAnthropic({ apiKey: key })(id);
  },
  // The paper is in the first message: cache it, so a chat's later turns re-read it for less.
  cacheFirstMessage: { anthropic: { cacheControl: { type: "ephemeral" } } },
  async listModels(config, ctx) {
    const key = ctx.key("anthropic");
    const j = await getJson("https://api.anthropic.com/v1/models?limit=100", { "x-api-key": key ? key.value : "", "anthropic-version": "2023-06-01" }, ctx.fetch);
    return (j.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id, description: "", context: m.max_input_tokens || guessWindow(m.id), efforts: effortsFor(m.id) }));
  },
});

export const google = Object.assign(Object.create(base), {
  id: "google",
  name: "Google Gemini API",
  keyUrl: "https://aistudio.google.com/apikey",
  privacy: `Sends ${PAPER} to Google. On the free tier, Google may use it to improve its products.`,
  cost: "A free tier with limits, then pay per token, billed by Google.",
  async createModel(config, key, id) {
    const { createGoogle, createGoogleGenerativeAI } = await import("@ai-sdk/google");
    return (createGoogle || createGoogleGenerativeAI)({ apiKey: key })(id);
  },
  async listModels(config, ctx) {
    const key = ctx.key("google");
    const j = await getJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { "x-goog-api-key": key ? key.value : "" }, ctx.fetch);
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent") && /gemini|gemma/.test(m.name) && !/(embedding|image|tts|audio|live)/.test(m.name))
      .map((m) => {
        const id = String(m.name).replace(/^models\//, "");
        return { id, name: m.displayName || id, description: String(m.description || "").split(/\.\s/)[0].slice(0, 90), context: m.inputTokenLimit || guessWindow(id), efforts: m.thinking ? ["low", "medium", "high"] : effortsFor(id) };
      });
  },
});

export const openrouter = Object.assign(Object.create(base), {
  id: "openrouter",
  name: "OpenRouter",
  keyUrl: "https://openrouter.ai/settings/keys",
  privacy: `Sends ${PAPER} to OpenRouter and the model's provider (their policies differ; free models may log prompts).`,
  cost: "Pay per token with OpenRouter credit; models marked free cost nothing, with limits.",
  async createModel(config, key, id) {
    const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
    return createOpenRouter({ apiKey: key, headers: { "HTTP-Referer": "https://github.com/mbradaschia/oma-zotero-launcher", "X-Title": "Omarchy Zotero launcher" } }).chat(id, { usage: { include: true } });
  },
  async listModels(config, ctx) {
    const j = await getJson("https://openrouter.ai/api/v1/models", {}, ctx.fetch);
    return (j.data || [])
      .filter((m) => !m.architecture || !m.architecture.output_modalities || m.architecture.output_modalities.includes("text"))
      .map((m) => {
        const pin = Number(m.pricing && m.pricing.prompt) * 1e6;
        const pout = Number(m.pricing && m.pricing.completion) * 1e6;
        const takesEffort = (m.supported_parameters || []).includes("reasoning");
        return { id: m.id, name: m.name || m.id, description: "", context: m.context_length || 0, efforts: takesEffort ? ["low", "medium", "high"] : [],
          priceIn: Number.isFinite(pin) ? pin : null, priceOut: Number.isFinite(pout) ? pout : null, free: pin === 0 && pout === 0 };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  },
});

// An OpenAI-compatible endpoint from the settings ({ id, name, baseURL, context? }); its key
// (optional) is in the keyring under its id.
export function compatible(endpoint) {
  return Object.assign(Object.create(base), {
    id: endpoint.id,
    name: endpoint.name,
    kind: "endpoint",
    needsKey: false,
    endpoint: true,
    privacy: `Sends ${PAPER} to ${new URL(endpoint.baseURL).host}${/^(localhost|127\.|\[::1\])/.test(new URL(endpoint.baseURL).host) ? " (this computer)" : ""}.`,
    cost: "Whatever the endpoint's owner charges.",
    async detect() {
      return { available: false, signedIn: false, detail: "" };
    },
    async createModel(config, key, id) {
      const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
      return createOpenAICompatible({ name: endpoint.id, baseURL: endpoint.baseURL, ...(key ? { apiKey: key } : {}), includeUsage: true }).chatModel(id);
    },
    async listModels(config, ctx) {
      const key = ctx.key(endpoint.id);
      const j = await getJson(endpoint.baseURL.replace(/\/$/, "") + "/models", key ? { Authorization: "Bearer " + key.value } : {}, ctx.fetch);
      return (j.data || []).map((m) => ({ id: m.id, name: m.id, description: "", context: endpoint.context || m.context_length || m.max_model_len || guessWindow(m.id), efforts: effortsFor(m.id) }));
    },
  });
}
