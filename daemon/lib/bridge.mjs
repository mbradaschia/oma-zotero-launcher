// The Zotero bridge from Node: the handshake file Zotero writes on start
// ($XDG_RUNTIME_DIR/oma-zotero/bridge.json: port + token) and JSON POSTs.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function handshakePath(env = process.env) {
  return join(env.XDG_RUNTIME_DIR || "/tmp", "oma-zotero", "bridge.json");
}

export function bridgeClient({ path = handshakePath(), fetchImpl = fetch, timeoutMs = 120000 } = {}) {
  let h;
  try {
    h = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Zotero isn't running (or the bridge isn't installed): no " + path);
  }
  if (!/^[0-9a-f]{64}$/.test(String(h.token || "")) || !(Number(h.port) > 0)) throw new Error("bad bridge handshake in " + path);
  const base = `http://127.0.0.1:${Number(h.port)}/oma-zotero`;
  return {
    async post(route, body) {
      let res;
      try {
        res = await fetchImpl(base + route, {
          method: "POST",
          headers: { "Zotero-Allowed-Request": "1", Authorization: "Bearer " + h.token, "Content-Type": "application/json" },
          body: JSON.stringify(body || {}),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        throw new Error(`Zotero didn't answer ${route}: ${e.message}`);
      }
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { /* plain-text error */ }
      if (res.status === 404 && !(data && data.error)) throw new Error(`the Zotero bridge has no ${route} route: update it (make xpi)`);
      if (!res.ok || !data || !data.ok) {
        const err = data && data.error ? data.error : { code: "http-" + res.status, message: text.slice(0, 200) };
        const e = new Error(`${route}: ${err.message || err.code}`);
        e.code = err.code;
        e.status = res.status;
        throw e;
      }
      return data;
    },
  };
}
