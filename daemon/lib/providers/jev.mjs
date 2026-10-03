// Jev, TypeSafe's System One model: typed decisions with calibrated probabilities, one request for many
// questions (POST {baseURL}/systemone { state, model, questions } with a Bearer key → { model, answers,
// usage }). Used for taxonomies (daemon/lib/taxonomies.mjs), not for prompts or chat. The key: the keyring
// ("jev"), else JEV_API_KEY or TYPESAFE_API_KEY.
export const JEV_URL = "https://api.typesafe.ai/v1";
export const JEV_MODEL = "jev-latest";

// → { answers, usage, model }. Throws with the API's own message when it refuses.
export async function jevClassify({ apiKey, state, questions, baseURL = JEV_URL, model = JEV_MODEL, fetchImpl = fetch, timeoutMs = 60000 }) {
  if (!apiKey) throw new Error("no Jev API key: Settings › Taxonomies › Set the Jev API key");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(String(baseURL).replace(/\/+$/, "") + "/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state, model, questions }),
      signal: ctl.signal,
    });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "Jev took longer than " + Math.round(timeoutMs / 1000) + " s" : "couldn't reach Jev: " + e.message);
  } finally {
    clearTimeout(timer);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg = body && (body.error && (body.error.message || body.error)) || body && body.message || `HTTP ${res.status}`;
    throw new Error(`Jev refused (${res.status}): ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  if (!body || typeof body.answers !== "object") throw new Error("Jev's answer has no answers");
  return { answers: body.answers, usage: body.usage || null, model: body.model || model };
}
