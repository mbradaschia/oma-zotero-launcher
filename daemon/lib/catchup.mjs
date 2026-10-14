// Bringing papers up to date (the launcher's Settings › Defaults › New papers): which papers a prompt ran on with an
// older version of it, which a taxonomy tagged with an older version of it, and what papers added in the last days
// still miss. Pure but for the versions file (node-tested).
//
// A prompt's version: what decides what it writes (its text, what it makes, whether an artifact is planned first),
// not its title, model or effort. Each new text that writes a note gets the next number; a note says both, in its
// title ("Findings v2: …") and its last line ("… prompt, version 2 (findings@3f2a91c0b1d2) …"): the hash, synced with
// the note, is what tells an older version apart on any machine. The notes are where the numbers live (they sync);
// the versions file ({ prompts: { id: [{ n, hash, at, used }] } }, this machine's) only remembers them meanwhile.
// A text only listed, never run (a new prompt's placeholder, an edit saved on the way), takes no number.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { paths } from "./paths.mjs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { staleTaxonomies } from "./taxonomies.mjs";

export function promptFingerprint(p) {
  const what = { body: String(p.body || "").trim(), output: p.output || "note", brief: p.output && p.output !== "note" ? p.brief !== false : true };
  return createHash("sha1").update(JSON.stringify(what)).digest("hex").slice(0, 12);
}

export function versionsPath(env = process.env) {
  return paths(env).promptVersions;
}

export function loadVersions(path = versionsPath()) {
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    return j && typeof j.prompts === "object" && j.prompts ? j : { prompts: {} };
  } catch {
    return { prompts: {} };
  }
}

export function saveVersions(reg, path = versionsPath()) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(reg, null, 2) + "\n");
  renameSync(tmp, path);
}

// The prompt's version number (reg changes; changed says so). seen: the versions its notes say ([{ n, hash }], from
// any machine); seenOk: they were read (else only this machine's file counts). A text they name keeps their number;
// else a text this machine wrote notes with keeps its own (unless a note from elsewhere took that number for another
// text); else the next after every number taken. use: a note was written with it (the number is taken). An entry from
// before `used` was kept counts as used only when the notes couldn't be read (they say which numbers were).
// → { n, hash, changed }
export function versionOf(reg, p, now = new Date(), { seen = [], use = false, seenOk = false } = {}) {
  const hash = promptFingerprint(p);
  const list = reg.prompts[p.id] || (reg.prompts[p.id] = []);
  const used = (v) => v.used === true || (v.used === undefined && !seenOk);
  const known = list.find((v) => v.hash === hash);
  const named = seen.find((v) => v.hash === hash && v.n > 0);
  const taken = Math.max(0, ...seen.filter((v) => v.hash !== hash).map((v) => v.n), ...list.filter((v) => used(v) && v.hash !== hash).map((v) => v.n));
  const n = named ? named.n
    : known && used(known) && !seen.some((v) => v.n === known.n && v.hash !== hash) ? known.n
      : taken + 1;
  if (known && known.n === n && (known.used || !use)) return { n, hash, changed: false };
  if (known) Object.assign(known, { n, used: known.used || use || !!named });
  else list.push({ n, hash, at: now.toISOString(), used: use || !!named });
  return { n, hash, changed: true };
}

// Every prompt's version. opts.save: write the file when one changed (a run, which also passes use and its notes'
// seen: Map id → [{ n, hash }]); listing and counting only read it. → Map id → { n, hash }
export function versionsFor(prompts, path = versionsPath(), { save = false, use = false, seen = new Map(), seenOk = false } = {}) {
  const reg = loadVersions(path);
  const out = new Map();
  let changed = false;
  for (const p of prompts) {
    const v = versionOf(reg, p, new Date(), { seen: seen.get(p.id) || [], use, seenOk });
    changed = changed || v.changed;
    out.set(p.id, { n: v.n, hash: v.hash });
  }
  if (changed && save) saveVersions(reg, path);
  return out;
}

// What a prompt's notes say ([{ parentKey, libraryID, generated }], the bridge's /notes/by-prompt) of one prompt:
// seen, its versions ([{ n, hash }]); and how many notes each paper has of each version. → { seen, runs: Map
// "lib:key@hash" → count }
export function promptNotes(notes, id) {
  const seen = [];
  const runs = new Map();
  for (const x of notes || []) {
    const g = parseGenerated(x.generated);
    if (g.promptId !== id || !g.hash) continue;
    const was = seen.find((v) => v.hash === g.hash);
    if (!was) seen.push({ n: g.n, hash: g.hash });
    else if (g.n > 0 && (g.n < was.n || !was.n)) was.n = g.n; // one text, two numbers (machines apart): the smallest, whatever the order
    const k = (Number(x.libraryID) || 1) + ":" + x.parentKey + "@" + g.hash;
    runs.set(k, (runs.get(k) || 0) + 1);
  }
  return { seen, runs };
}

// What a prompt's note says made it (its "Generated by …" line): { promptId, hash, n, title }; notes from before
// versions were kept name only the prompt's title (hash "").
export function parseGenerated(line) {
  const s = String(line || "");
  const title = (/with the “([^”]*)” prompt/.exec(s) || [])[1] || "";
  const m = /version (\d+) \(([a-z0-9][a-z0-9-]{0,80})@([0-9a-f]{12})\)/.exec(s);
  return m ? { promptId: m[2], hash: m[3], n: Number(m[1]), title } : { promptId: "", hash: "", n: 0, title };
}

// The latest run of each prompt on each paper, from its notes ([{ libraryID, parentKey, dateAdded, generated }],
// the bridge's /notes/by-prompt) and its artifacts' prompt-made versions ([{ key, libraryID, promptMade: { id,
// hash, at } }]). An older note without a version is matched to a prompt by its title (hash "": unknown).
// → { "lib:key": { promptId: { hash, at } } }
export function promptRuns(notes, artifacts, prompts) {
  const byTitle = new Map(prompts.map((p) => [p.title, p.id]));
  const runs = {};
  const put = (paper, id, hash, at) => {
    if (!id) return;
    const r = runs[paper] || (runs[paper] = {});
    if (!r[id] || String(at) > String(r[id].at)) r[id] = { hash, at: String(at || "") };
  };
  for (const n of notes || []) {
    if (!n.parentKey) continue;
    const g = parseGenerated(n.generated);
    put((Number(n.libraryID) || 1) + ":" + n.parentKey, g.promptId || byTitle.get(g.title) || "", g.hash, n.dateAdded);
  }
  for (const a of artifacts || []) {
    if (a.promptMade) put((Number(a.libraryID) || 1) + ":" + a.key, a.promptMade.id, a.promptMade.hash || "", a.promptMade.at);
  }
  return runs;
}

// The runs of a prompt with an older version of it (unknown: runs from before versions were kept, left alone).
// → { jobs: [{ id: "lib:key", op: "prompt", prompt }], unknown }
export function stalePromptJobs(runs, versions) {
  const jobs = [];
  let unknown = 0;
  for (const [paper, byPrompt] of Object.entries(runs)) {
    for (const [id, r] of Object.entries(byPrompt)) {
      const v = versions.get(id);
      if (!v) continue; // a prompt since deleted
      if (!r.hash) unknown++;
      else if (r.hash !== v.hash) jobs.push({ id: paper, op: "prompt", prompt: id });
    }
  }
  return { jobs, unknown };
}

// The papers a taxonomy tagged with an older version of it (the store's; never-tagged papers aren't here: the
// recent days catch them). → [{ id, op: "classify", only }]
export function staleTaxonomyJobs(store, taxonomies) {
  const jobs = [];
  for (const [id, e] of Object.entries((store && store.papers) || {})) {
    const only = staleTaxonomies(e, taxonomies);
    if (only.length) jobs.push({ id, op: "classify", only });
  }
  return jobs;
}

// What papers added lately (papers: [{ key, libraryID, title }], newest first) still miss, paper by paper: its text
// (textless: the ones with a PDF and no text, when extract), its taxonomies (when tag: never tagged, or by an older
// version), each prompt it never ran on or ran on with an older version. → [{ id, op, prompt?, only?, title }]
export function recentJobs(papers, { textless = [], extract = false, tag = false, store = null, taxonomies = [], prompts = [], runs = {}, versions = new Map() } = {}) {
  const noText = new Set(textless);
  const jobs = [];
  for (const p of papers || []) {
    const id = (Number(p.libraryID) || 1) + ":" + p.key;
    const title = p.title || "";
    if (extract && noText.has(id)) jobs.push({ id, op: "extract", title });
    if (tag && taxonomies.length) {
      const only = staleTaxonomies(store && store.papers ? store.papers[id] : undefined, taxonomies);
      if (only.length) jobs.push(Object.assign({ id, op: "classify", title }, only.length < taxonomies.length ? { only } : {}));
    }
    for (const pid of prompts) {
      const v = versions.get(pid);
      if (!v) continue;
      const r = (runs[id] || {})[pid];
      if (!r || (r.hash && r.hash !== v.hash)) jobs.push({ id, op: "prompt", prompt: pid, title });
    }
  }
  return jobs;
}

// How many papers a job list touches.
export function paperCount(jobs) {
  return new Set((jobs || []).map((j) => j.id)).size;
}
