// API keys: in the system keyring through the Secret Service (secret-tool, service
// "oma-zotero-launcher", attribute "provider"), else from the environment. The plugin never
// writes a key to a file; the shell hands one over once, on stdin (`secret set <provider>`).
import { spawnSync } from "node:child_process";

export const SERVICE = "oma-zotero-launcher";

// The environment variables each provider reads when no key is stored.
export const ENV_KEYS = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  jev: ["JEV_API_KEY", "TYPESAFE_API_KEY"], // taxonomies (daemon/lib/providers/jev.mjs)
};

export function envKey(provider, env = process.env) {
  for (const k of ENV_KEYS[provider] || []) if (env[k]) return { value: env[k], from: k };
  return null;
}

function tool(args, input, opts = {}) {
  const r = spawnSync(opts.bin || "secret-tool", args, { input: input == null ? undefined : input, encoding: "utf8", timeout: 10000, env: opts.env || process.env });
  if (r.error) return { ok: false, missing: r.error.code === "ENOENT", stdout: "", stderr: r.error.message };
  return { ok: r.status === 0, stdout: r.stdout || "", stderr: String(r.stderr || "").trim() };
}

// Is a Secret Service there to hold keys? { ok, detail }
export function keyringStatus(opts = {}) {
  // A lookup that finds nothing exits 1 with no error text; no service (or no secret-tool) says why.
  const r = tool(["lookup", "service", SERVICE, "provider", "__probe__"], null, opts);
  if (r.missing) return { ok: false, detail: "secret-tool isn't installed (omarchy pkg add libsecret)" };
  if (!r.ok && r.stderr) return { ok: false, detail: "no Secret Service: " + r.stderr.split("\n")[0] };
  return { ok: true, detail: "system keyring" };
}

export function getSecret(provider, opts = {}) {
  const r = tool(["lookup", "service", SERVICE, "provider", provider], null, opts);
  return r.ok && r.stdout ? r.stdout.replace(/\n$/, "") : null;
}

export function setSecret(provider, value, opts = {}) {
  const v = String(value || "").trim();
  if (!v) throw new Error("the key is empty");
  if (/\s/.test(v)) throw new Error("a key has no spaces or line breaks");
  const r = tool(["store", "--label", `Zotero launcher: ${provider} API key`, "service", SERVICE, "provider", provider], v, opts);
  if (r.missing) throw new Error("secret-tool isn't installed (omarchy pkg add libsecret): set the key in the environment instead");
  if (!r.ok) throw new Error("the keyring refused the key: " + (r.stderr || "no Secret Service"));
}

export function removeSecret(provider, opts = {}) {
  tool(["clear", "service", SERVICE, "provider", provider], null, opts);
}

// The key a provider uses: the keyring's, else the environment's. { value, from } or null.
export function resolveKey(provider, opts = {}) {
  const stored = getSecret(provider, opts);
  if (stored) return { value: stored, from: "keyring" };
  return envKey(provider, opts.env || process.env);
}

// "sk-…abcd" for showing that a key is set, never the key.
export function maskKey(value) {
  const v = String(value || "");
  return v.length > 8 ? v.slice(0, 3) + "…" + v.slice(-4) : v ? "…" : "";
}
