// Taxonomies: predefined labels a paper is classified into (paper type, ontology, epistemology, method,
// theories…), each tagged in Zotero with its prefix ("type/case study", "theory/dynamic capabilities").
// A taxonomy is a JSON file: { name, prefix, kind: "one" | "several", question, labels: [{ name,
// definition }], threshold?, low? }. The bundled ones are in daemon/defaults/taxonomies; a file of the same
// name in ~/.config/omarchy/oma-zotero-launcher/taxonomies replaces one ({ "off": true } turns it off),
// any other there adds one. Classified by Jev (TypeSafe's System One model: calibrated probabilities over
// the labels) when its key is set, else by your prompts model, asked for the same probabilities.
// Everything here but the file and store reading is pure (node-tested).
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const DEFAULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "defaults", "taxonomies");
export const THRESHOLD = 0.6; // tagged from here
export const LOW = 0.3; // suggested (the review list) from here
export const JEV_PRICE_IN = 0.042; // $ per million input tokens; output is free
export const NOT_STATED = "not stated";

export function userDir(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config"), "omarchy", "oma-zotero-launcher", "taxonomies");
}

export function storePath(env = process.env) {
  return join(env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state"), "oma-zotero", "taxonomy.json");
}

// ---------------------------------------------------------------- the files

// A taxonomy file → { taxonomy } or { error }. id: its file name.
export function validate(raw, id) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: `${id}: not a JSON object` };
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 60) : "";
  if (!name) return { error: `${id}: "name" is missing` };
  const prefix = String(raw.prefix || "");
  if (!/^[a-z][a-z0-9-]{0,19}\/$/.test(prefix) || prefix === "s/" || prefix === "t/") return { error: `${id}: "prefix" must be like "theory/" (a-z, ending in /; not s/ or t/, the statuses')` };
  if (raw.kind !== "one" && raw.kind !== "several") return { error: `${id}: "kind" must be "one" or "several"` };
  const seen = new Set();
  const labels = [];
  for (const l of Array.isArray(raw.labels) ? raw.labels : []) {
    const n = l && typeof l.name === "string" ? l.name.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    labels.push({ name: n, definition: typeof l.definition === "string" ? l.definition.trim().slice(0, 400) : "" });
  }
  if (labels.length < (raw.kind === "one" ? 2 : 1)) return { error: `${id}: "labels" needs ${raw.kind === "one" ? "two or more" : "one or more"} ({ "name", "definition" })` };
  if (labels.length > 60) return { error: `${id}: at most 60 labels` };
  const num = (v, d) => (typeof v === "number" && v > 0 && v < 1 ? v : d);
  const threshold = num(raw.threshold, THRESHOLD);
  return { taxonomy: { id, name, prefix, kind: raw.kind, question: typeof raw.question === "string" && raw.question.trim() ? raw.question.trim().slice(0, 300) : "Which of these fits the paper?",
    labels, threshold, low: Math.min(num(raw.low, LOW), threshold), show: raw.show !== false } };
}

function readDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^[a-z0-9][a-z0-9-]{0,40}\.json$/.test(f)).sort().map((f) => ({ id: f.slice(0, -5), path: join(dir, f) }));
}

// The taxonomies in force → { taxonomies (bundled first, in their order, then yours), problems, off (the
// bundled ones you turned off: [{ id, name }]) }.
export function loadTaxonomies({ defaultsDir = DEFAULTS_DIR, dir = userDir() } = {}) {
  const order = ["paper-type", "ontology", "epistemology", "method", "theories"];
  const files = new Map();
  for (const f of readDir(defaultsDir)) files.set(f.id, Object.assign({ bundled: true }, f));
  for (const f of readDir(dir)) files.set(f.id, Object.assign({ bundled: files.has(f.id), own: true }, f));
  const ids = [...files.keys()].sort((a, b) => {
    const x = order.indexOf(a), y = order.indexOf(b);
    return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || a.localeCompare(b);
  });
  const taxonomies = [];
  const problems = [];
  const off = [];
  for (const id of ids) {
    const f = files.get(id);
    let raw;
    try {
      raw = JSON.parse(readFileSync(f.path, "utf8"));
    } catch (e) {
      problems.push(`${id}: ${e.message}`);
      continue;
    }
    if (raw && raw.off === true) {
      let name = id;
      try { name = JSON.parse(readFileSync(join(defaultsDir, id + ".json"), "utf8")).name || id; } catch {}
      off.push({ id, name, bundled: !!f.bundled });
      continue;
    }
    const v = validate(raw, id);
    if (v.error) problems.push(v.error);
    else taxonomies.push(Object.assign(v.taxonomy, { bundled: !!f.bundled, own: !!f.own, path: f.path }));
  }
  return { taxonomies, problems, off };
}

// A taxonomy as its file holds it (what taxonomy-save writes): name, prefix, kind, question, thresholds, labels.
export function toFile(t) {
  const out = { name: t.name, prefix: t.prefix, kind: t.kind, question: t.question, threshold: t.threshold };
  if (t.low !== undefined && t.low !== LOW) out.low = t.low;
  if (t.show === false) out.show = false; // its labels not shown under a paper's status line (still tagged)
  out.labels = t.labels.map((l) => ({ name: l.name, definition: l.definition || "" }));
  return out;
}

// A taxonomy you edited (the launcher's Settings › Taxonomies) checked before it's saved as yours: valid, and its
// prefix not another one's. → { taxonomy } or { error }
export function checkEdit(raw, id, others) {
  const v = validate(raw, id);
  if (v.error) return v;
  const clash = (others || []).find((o) => o.id !== id && o.prefix === v.taxonomy.prefix);
  if (clash) return { error: `${id}: the prefix “${v.taxonomy.prefix}” is ${clash.name}'s` };
  return v;
}

// A taxonomy's fingerprint: what decides how a paper is classified (its prefix, kind, question, thresholds,
// labels and their definitions), not its name or file. Kept with each paper's result: a paper classified
// with another version of a taxonomy is out of date for it (classified again when its menu opens, with
// Settings › Taxonomies › Tag it when you open it on).
export function fingerprint(t) {
  const what = { prefix: t.prefix, kind: t.kind, question: t.question, threshold: t.threshold, low: t.low, labels: (t.labels || []).map((l) => [l.name, l.definition || ""]) };
  return createHash("sha1").update(JSON.stringify(what)).digest("hex").slice(0, 12);
}

// The taxonomies a paper's stored result (the store's papers[id], or undefined) isn't up to date with:
// never classified by it, by another version of it, or before every label's probability was kept (results from
// then read Jev's yes/no answers wrong: several-label taxonomies got nothing). → [taxonomy ids], in order.
export function staleTaxonomies(entry, taxonomies) {
  const done = (entry && entry.taxonomies) || {};
  return taxonomies.filter((t) => !done[t.id] || done[t.id].hash !== fingerprint(t) || !done[t.id].probs).map((t) => t.id);
}

// ---------------------------------------------------------------- what is classified

// The paper as the classifier reads it: its title, abstract and, when it has one, its extracted text,
// cut to `maxChars` (Jev reads at most 32k tokens of state with a question).
export function classificationText({ title, abstract, text }, maxChars = 60000) {
  const parts = [`Title: ${String(title || "").trim()}`];
  if (abstract && String(abstract).trim()) parts.push(`Abstract: ${String(abstract).trim()}`);
  let out = parts.join("\n\n");
  if (text && String(text).trim()) {
    const room = maxChars - out.length - 40;
    if (room > 500) out += "\n\nFull text:\n" + (String(text).length > room ? String(text).slice(0, room) + "\n[… cut]" : String(text));
  }
  return out.slice(0, maxChars);
}

// ---------------------------------------------------------------- Jev

// The questions for Jev (one request for every taxonomy): a "choice" per one-label taxonomy (the labels and
// their definitions as its criteria), a yes/no ("noul") per label of a several-label one.
export function jevQuestions(taxonomies) {
  const q = {};
  for (const t of taxonomies) {
    if (t.kind === "one") {
      const criteria = {};
      for (const l of t.labels) criteria[l.name] = l.definition || l.name;
      q[t.id] = { type: "choice", instructions: t.question, criteria };
    } else {
      t.labels.forEach((l, i) => {
        q[`${t.id}__${i}`] = { type: "noul", instructions: `${t.question} ${l.name}${l.definition ? ": " + l.definition : ""}` };
      });
    }
  }
  return q;
}

// Jev's answers → { taxonomyId: { label: probability } }. A choice's probabilities, a noul's probability of yes.
export function fromJev(taxonomies, answers) {
  const out = {};
  const a = answers || {};
  for (const t of taxonomies) {
    const probs = {};
    if (t.kind === "one") {
      const ans = a[t.id] || {};
      const p = ans.probabilities || {};
      for (const l of t.labels) probs[l.name] = clamp(p[l.name]);
      if (!Object.values(probs).some((x) => x > 0) && ans.choice) probs[ans.choice] = clamp(ans.confidence == null ? 1 : ans.confidence);
    } else {
      t.labels.forEach((l, i) => {
        const ans = a[`${t.id}__${i}`] || {};
        // Jev answers a yes/no ("noul") question as { type: "noul", noul: p }
        probs[l.name] = clamp(ans.noul != null ? ans.noul : ans.probability != null ? ans.probability : ans.yes);
      });
    }
    out[t.id] = probs;
  }
  return out;
}

function clamp(x) {
  const n = Number(x);
  return isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

// What a Jev call cost: input tokens at its price (output is free).
export function jevCost(usage) {
  const n = usage && Number(usage.input_tokens);
  return isFinite(n) && n > 0 ? (n * JEV_PRICE_IN) / 1e6 : 0;
}

// ---------------------------------------------------------------- your AI model, as the fallback

export const LLM_SYSTEM = "You classify academic papers into predefined labels and give calibrated probabilities. Answer with one JSON object and nothing else.";

// The question for an AI model: the paper, then each taxonomy with its labels, and the JSON to answer with.
export function llmPrompt(taxonomies, paperText) {
  const lines = ["Classify this paper against each taxonomy below. Judge from the paper itself; when the paper doesn't make something clear, say so with low probabilities (or the \"not stated\" label where there is one) rather than guessing.", "", "<paper>", paperText, "</paper>", ""];
  for (const t of taxonomies) {
    lines.push(`## ${t.id}: ${t.name} (${t.kind === "one" ? "exactly one label: probabilities that sum to 1" : "any number of labels: each label's probability on its own"})`, t.question);
    for (const l of t.labels) lines.push(`- ${l.name}${l.definition ? ": " + l.definition : ""}`);
    lines.push("");
  }
  lines.push('Answer with JSON only, every taxonomy and every label: {"' + (taxonomies[0] ? taxonomies[0].id : "id") + '": {"<label>": 0.0, …}, …}');
  return lines.join("\n");
}

// An AI model's answer → { taxonomyId: { label: probability } } (labels matched without regard to case;
// missing ones 0). Throws when there's no JSON object in it.
export function parseLlm(text, taxonomies) {
  const s = String(text || "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("the model's answer has no JSON");
  let j;
  try {
    j = JSON.parse(s.slice(start, end + 1));
  } catch (e) {
    throw new Error("the model's answer isn't valid JSON: " + e.message);
  }
  const out = {};
  for (const t of taxonomies) {
    const got = j[t.id] && typeof j[t.id] === "object" ? j[t.id] : {};
    const lower = {};
    for (const k of Object.keys(got)) lower[k.toLowerCase()] = got[k];
    const probs = {};
    for (const l of t.labels) probs[l.name] = clamp(lower[l.name.toLowerCase()]);
    out[t.id] = probs;
  }
  return out;
}

// ---------------------------------------------------------------- auditing a paper's result

// A paper's result, label by label (its menu › Audit the taxonomies): each taxonomy (in force) with every label's
// probability (when the result kept them: tagged since probabilities were kept), and what became of it.
// entry: the store's papers[id] (or undefined). → { classified, at, by, taxonomies: [{ id, name, kind, threshold,
// low, stale, kept (probabilities known), labels: [{ name, p (null: not kept), state: "tagged" | "suggested" |
// "confirmed" | "dismissed" | "" }] (likeliest first) }] }
export function auditView(entry, taxonomies) {
  const done = (entry && entry.taxonomies) || {};
  return {
    classified: !!entry, at: (entry && entry.at) || "", by: (entry && entry.by) || "",
    taxonomies: taxonomies.map((t) => {
      const r = done[t.id] || {};
      const lower = (xs) => new Set((xs || []).map((x) => String(x.label || x).toLowerCase()));
      const tagged = lower(r.tagged), suggested = lower(r.suggested), confirmed = lower(r.confirmed), dismissed = lower(r.dismissed);
      const known = {};
      for (const x of (r.tagged || []).concat(r.suggested || [])) known[x.label.toLowerCase()] = x.p;
      const probs = r.probs || null;
      const labels = t.labels.map((l) => {
        const k = l.name.toLowerCase();
        const p = probs && probs[l.name] != null ? probs[l.name] : known[k] != null ? known[k] : null;
        const state = confirmed.has(k) ? "confirmed" : tagged.has(k) ? "tagged" : dismissed.has(k) ? "dismissed" : suggested.has(k) ? "suggested" : "";
        return { name: l.name, p, state };
      }).sort((a, b) => (b.p == null ? -1 : b.p) - (a.p == null ? -1 : a.p));
      return { id: t.id, name: t.name, prefix: t.prefix, kind: t.kind, threshold: t.threshold, low: t.low, stale: !r.hash || r.hash !== fingerprint(t) || !probs, kept: !!probs, classified: !!done[t.id], labels };
    }),
  };
}

// ---------------------------------------------------------------- drafting a taxonomy with AI

// Settings › Taxonomies › New taxonomy with AI… / a taxonomy's Change it with AI…: your prompts model proposes a
// taxonomy (a new one, or this one changed), you accept it, discuss it (another request: it revises its last
// proposal) or discard it. Nothing is saved until you accept.
export const DRAFT_SYSTEM = [
  "You design taxonomies that classify academic papers (management, operations, the social sciences and beyond).",
  "A taxonomy is a set of labels given in advance; a classifier later reads each paper's title, abstract and text and decides which labels fit, from your definitions alone.",
  "Rules for a taxonomy:",
  "- name: short (at most 60 characters), e.g. \"Theories\".",
  "- prefix: the tag prefix in Zotero, lowercase a-z, 0-9 or -, ending in /, at most 20 characters before the /, never s/ or t/ (taken), and not another taxonomy's.",
  "- kind: \"one\" (unique: each paper gets exactly one label, for mutually exclusive categories such as ontology, epistemology or paper type; offer a \"not stated\" label when a paper may not say) or \"several\" (each label is decided on its own, for things a paper can combine, such as theories or methods).",
  "- question: what the classifier is asked, one sentence.",
  "- threshold: how likely a label must be to be tagged, 0.5 to 0.9 (0.6 is usual).",
  "- labels: 2 to 40, each { name, definition }: short lowercase names, distinct; each definition one or two sentences saying what a paper must do or contain to get the label, and how to tell it from its neighbours.",
  "When changing a taxonomy you are given: keep its prefix and the names of the labels you aren't asked to change (renaming a label breaks the tags papers already have), and change only what was asked.",
  "Reply with one JSON object and nothing else: {\"taxonomy\": {\"name\", \"prefix\", \"kind\", \"question\", \"threshold\", \"labels\": [{\"name\", \"definition\"}]}, \"notes\": \"two or three sentences: what you made or changed, and why\"}"
].join("\n");

// The conversation for the model: what exists (the taxonomy being changed, the others' names and prefixes), then
// each request and the proposal it got, then the new request. current: a taxonomy or null (a new one); others:
// [{ name, prefix }]; turns: [{ request, taxonomy, notes }].
export function draftMessages(current, others, turns, request) {
  const context = [
    current ? "The taxonomy to change:\n" + JSON.stringify(toFile(current), null, 2) : "Make a new taxonomy.",
    (others || []).length ? "Other taxonomies (their prefixes are taken): " + others.map((o) => o.name + " (" + o.prefix + ")").join(", ") : "",
  ].filter(Boolean).join("\n\n");
  const messages = [];
  const all = (turns || []).concat([{ request }]);
  all.forEach((t, i) => {
    messages.push({ role: "user", content: (i === 0 ? context + "\n\nWhat I want: " : "") + String(t.request || "").trim() });
    if (t.taxonomy) messages.push({ role: "assistant", content: JSON.stringify({ taxonomy: toFile(t.taxonomy), notes: t.notes || "" }) });
  });
  return messages;
}

// The model's answer → { taxonomy (checked: valid, its prefix not another's), notes } or { error, notes }.
export function parseDraft(text, id, others) {
  const s = String(text || "");
  const start = s.indexOf("{"), end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return { error: "the model's answer has no JSON", notes: "" };
  let j;
  try {
    j = JSON.parse(s.slice(start, end + 1));
  } catch (e) {
    return { error: "the model's answer isn't valid JSON: " + e.message, notes: "" };
  }
  const notes = typeof j.notes === "string" ? j.notes.trim().slice(0, 1200) : "";
  const v = checkEdit(j.taxonomy || j, id, others);
  return v.error ? { error: v.error.replace(/^[^:]*: /, ""), notes } : { taxonomy: v.taxonomy, notes };
}

// ---------------------------------------------------------------- deciding, and the tags

// One taxonomy's probabilities → { tagged: [{ label, p }], suggested: [{ label, p }] }. Confidence decides:
// from the threshold a label is tagged; from `low` it's suggested (the review list). For a one-label
// taxonomy: the likeliest, tagged when sure enough; otherwise "not stated" (if it has one) is tagged rather
// than a guess, and the likeliest suggested. Labels you dismissed are left out.
export function decide(t, probs, dismissed = []) {
  const no = new Set((dismissed || []).map((x) => String(x).toLowerCase()));
  const ranked = t.labels.map((l) => ({ label: l.name, p: round(probs[l.name] || 0) })).filter((x) => !no.has(x.label.toLowerCase())).sort((a, b) => b.p - a.p);
  if (t.kind === "several") {
    return { tagged: ranked.filter((x) => x.p >= t.threshold), suggested: ranked.filter((x) => x.p < t.threshold && x.p >= t.low) };
  }
  const top = ranked[0];
  if (!top) return { tagged: [], suggested: [] };
  if (top.p >= t.threshold) return { tagged: [top], suggested: [] };
  const ns = t.labels.find((l) => l.name.toLowerCase() === NOT_STATED);
  const guess = ranked.find((x) => x.label.toLowerCase() !== NOT_STATED);
  return { tagged: ns && !no.has(NOT_STATED) ? [{ label: ns.name, p: round(probs[ns.name] || 0) }] : [], suggested: guess && guess.p >= t.low ? [guess] : [] };
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}

// The tags one paper gains and loses: what's decided now and what you confirmed are put on; what an earlier
// pass put on that isn't decided now comes off (a tag you added by hand stays). A one-label taxonomy (unique:
// paper type, ontology, epistemology) keeps one: what you confirmed wins over everything, its other labels come
// off; otherwise a label you put on by hand wins over the classifier's, which isn't added (kept: your label;
// the caller suggests its own for Review instead). result: { tagged, suggested, confirmed, dismissed },
// previous: the stored result before (its tagged); existing: the paper's tags. → { add, remove[, kept] }
export function tagChanges(t, result, previous, existing) {
  const tag = (label) => t.prefix + label;
  const has = new Set((existing || []).map((x) => String(x).toLowerCase()));
  const confirmed = result.confirmed && result.confirmed.length ? result.confirmed : [];
  let want = confirmed.concat((result.tagged || []).map((x) => x.label));
  if (t.kind === "one") want = want.slice(0, 1);
  const wantTags = [...new Set(want.map(tag))];
  const wantLower = new Set(wantTags.map((x) => x.toLowerCase()));
  const before = ((previous && previous.tagged) || []).map((x) => tag(x.label)).concat(t.kind === "one" ? ((previous && previous.confirmed) || []).map(tag) : []);
  const beforeLower = new Set(before.map((x) => x.toLowerCase()));
  if (t.kind === "one") {
    const prefix = t.prefix.toLowerCase();
    const mine = (existing || []).map(String).filter((x) => x.toLowerCase().startsWith(prefix) && x.length > prefix.length);
    if (confirmed.length) {
      // you decided: that label, and no other of this taxonomy
      return { add: wantTags.filter((x) => !has.has(x.toLowerCase())), remove: mine.filter((x) => !wantLower.has(x.toLowerCase())) };
    }
    const byHand = mine.filter((x) => !beforeLower.has(x.toLowerCase()) && !wantLower.has(x.toLowerCase()));
    if (byHand.length) {
      // yours stays, alone: the classifier's isn't added, and what an earlier pass put on comes off
      return { add: [], remove: mine.filter((x) => beforeLower.has(x.toLowerCase())), kept: byHand[0] };
    }
  }
  const add = wantTags.filter((x) => !has.has(x.toLowerCase()));
  const remove = [...new Set(before)].filter((x) => !wantLower.has(x.toLowerCase()) && has.has(x.toLowerCase()));
  return { add, remove };
}

// ---------------------------------------------------------------- the store (each paper's results)

// { papers: { "libraryID:key": { at, by, paper, taxonomies: { id: { tagged, suggested, confirmed, dismissed } } } } }
export function loadStore(path = storePath()) {
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    return j && typeof j.papers === "object" ? j : { papers: {} };
  } catch {
    return { papers: {} };
  }
}

export function saveStore(store, path = storePath()) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n");
  renameSync(tmp, path);
}

// The review list: every suggestion not yet confirmed or dismissed, the likeliest first.
// → [{ id: "lib:key", paper, taxonomy, name, label, p }]
export function reviewList(store, taxonomies) {
  const byId = new Map(taxonomies.map((t) => [t.id, t]));
  const out = [];
  for (const [id, r] of Object.entries((store && store.papers) || {})) {
    for (const [tid, x] of Object.entries(r.taxonomies || {})) {
      const t = byId.get(tid);
      if (!t) continue;
      const done = new Set([...(x.confirmed || []), ...(x.dismissed || [])].map((l) => l.toLowerCase()));
      for (const s of x.suggested || []) if (!done.has(s.label.toLowerCase())) out.push({ id, paper: r.paper || id, taxonomy: tid, name: t.name, prefix: t.prefix, label: s.label, p: s.p });
    }
  }
  return out.sort((a, b) => b.p - a.p);
}

// A new taxonomy file for your own labels (Settings › Taxonomies › New taxonomy…).
export function template(name) {
  const prefix = String(name || "topic").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 19) || "topic";
  return { name: String(name || "Topics").trim() || "Topics", prefix: (/^[a-z]/.test(prefix) ? prefix : "x" + prefix).slice(0, 19) + "/", kind: "several",
    question: "Is this paper about this topic?", threshold: THRESHOLD,
    labels: [{ name: "first label", definition: "What a paper with this label is about: a sentence the classifier reads." }, { name: "second label", definition: "…" }] };
}
