// The drawing libraries the diagram and mind map views load: fetched once, pinned by version and
// SHA-256, into the artifacts folder's .lib/ (so views work offline from then on, and moving the
// folder keeps them working). Not bundled: Mermaid alone is 5.5 MB.
import { existsSync, mkdirSync, writeFileSync, renameSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const CDN = (pkg, file) => [`https://cdn.jsdelivr.net/npm/${pkg}/${file}`, `https://unpkg.com/${pkg}/${file}`];

export const LIBS = {
  "mermaid.min.js": { urls: CDN("mermaid@12.0.0", "dist/mermaid.min.js"), sha256: "28fca7ae6ebc7ed7bb63bde63136a74bfef14f296a57e403657eeb8b32836073" },
  "d3.min.js": { urls: CDN("d3@7.9.0", "dist/d3.min.js"), sha256: "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539" },
  "markmap-lib.js": { urls: CDN("markmap-lib@0.18.12", "dist/browser/index.iife.js"), sha256: "edfe321a3fe46e9c0f0af8370145aee180975f243f2242f0f8181ac4273e08e1" },
  "markmap-view.js": { urls: CDN("markmap-view@0.18.12", "dist/browser/index.js"), sha256: "861eb6d20af18aaa300878d46d695722a73625c58b40f49236af027f18b74e07" },
};

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// → { ok, missing: [names not there after trying], error }
export async function ensureLibs(dir, names, fetchImpl = fetch) {
  const missing = [];
  let error = "";
  for (const name of names || []) {
    const lib = LIBS[name];
    const path = join(dir, name);
    if (!lib) continue;
    if (existsSync(path) && sha256(readFileSync(path)) === lib.sha256) continue;
    let got = null;
    for (const url of lib.urls) {
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(60000) });
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (sha256(buf) !== lib.sha256) throw new Error(`${url}: not the expected file (checksum)`);
        got = buf;
        break;
      } catch (e) {
        error = e.message;
      }
    }
    if (!got) {
      missing.push(name);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(path + ".tmp", got);
    renameSync(path + ".tmp", path);
  }
  return { ok: !missing.length, missing, error: missing.length ? error : "" };
}
