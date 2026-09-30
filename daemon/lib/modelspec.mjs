// Model names across providers: "provider:model" wherever a model is named (prompt files, chat
// sessions, settings). A bare name is a Claude model ("opus[1m]" = "claude:opus[1m]"), so the
// prompt files written before providers existed keep working; "default" is the user's default
// for prompts or for chat. Pure (node-tested).

export const BUILTIN = ["claude", "chatgpt", "openai", "anthropic", "google", "openrouter", "ollama"];

// One effort scale in every picker; each provider maps it (lib/providers/*).
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

// An OpenAI-compatible endpoint's id: short, and never a built-in provider's.
export function validEndpointId(id) {
  return /^[a-z][a-z0-9-]{1,30}$/.test(String(id || "")) && !BUILTIN.includes(id) && id !== "default";
}

// "openai:gpt-5.5" → { provider: "openai", model: "gpt-5.5" }; "opus[1m]" → claude;
// "ollama:qwen3:4b" → { provider: "ollama", model: "qwen3:4b" } (only the first colon splits,
// and only before a known provider or an endpoint id). `endpoints`: the compatible ids.
export function parseModel(spec, endpoints = []) {
  const s = String(spec || "").trim();
  if (!s || s === "default") return { provider: "", model: s };
  const i = s.indexOf(":");
  if (i > 0) {
    const p = s.slice(0, i);
    if (BUILTIN.includes(p) || endpoints.includes(p)) return { provider: p, model: s.slice(i + 1) };
  }
  return { provider: "claude", model: s };
}

// The canonical spelling: always with its provider ("claude:opus[1m]").
export function canonModel(spec, endpoints = []) {
  const { provider, model } = parseModel(spec, endpoints);
  return provider ? provider + ":" + model : model;
}

// What a prompt file or a chat may name: "default", or [provider:]model with the characters
// model ids use (vendor/model, tags, dots, a context suffix).
export function validModel(spec) {
  const s = String(spec || "");
  if (s === "default") return true;
  return /^([a-z][a-z0-9-]{0,30}:)?[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,160}(\[[0-9a-z]{1,8}\])?$/.test(s);
}

export function sameModel(a, b, endpoints = []) {
  return canonModel(a, endpoints) === canonModel(b, endpoints);
}

// The plugin's effort → the AI SDK's `reasoning` (it has no "max": xhigh is its top).
export function aiSdkReasoning(effort) {
  if (!effort) return undefined;
  return effort === "max" ? "xhigh" : EFFORTS.includes(effort) ? effort : undefined;
}

// Whether an API model reasons (and so takes an effort), from its id: a list for the known
// families; anything else gets no effort picker rather than a setting it ignores.
export function reasons(modelId) {
  const id = String(modelId || "").toLowerCase().replace(/^.*\//, "");
  return /^(o\d|gpt-5|gpt-6|claude-(opus|sonnet|haiku)-[4-9]|claude-[4-9]|gemini-(2\.5|[3-9])|deepseek-r|deepseek-reasoner|qwen3|qwq|magistral|grok-[3-9])/.test(id);
}

export function effortsFor(modelId) {
  return reasons(modelId) ? ["low", "medium", "high", "xhigh"] : [];
}

// Context windows for models whose list doesn't say (OpenAI's /v1/models, local servers).
// A rough table by family; the model's own report, a provider's list, or the user's setting wins.
const WINDOWS = [
  [/^gpt-(5|6)/, 272000], [/^gpt-4\.1/, 1047576], [/^gpt-4o/, 128000], [/^o\d/, 200000],
  [/^claude-/, 200000], [/^gemini-/, 1048576],
  [/^(qwen3|qwen2\.5)/, 32768], [/^(llama3\.[1-3]|llama-3\.[1-3])/, 131072], [/^(mistral|mixtral)/, 32768],
  [/^(gemma3|gemma-3)/, 131072], [/^deepseek/, 131072], [/^phi[34]/, 131072],
];

export function guessWindow(modelId) {
  const id = String(modelId || "").toLowerCase().replace(/^.*\//, "");
  for (const [re, n] of WINDOWS) if (re.test(id)) return n;
  return 0;
}
