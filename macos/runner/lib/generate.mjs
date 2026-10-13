// One answer from whichever provider a model belongs to, with the fallback model when the
// provider fails. Stateful providers get one message (the conversation folded into it when
// their thread can't be resumed); the others get the conversation.
import { providerById, configFor, resolveModel, findModelInfo } from "./providers/index.mjs";

// The conversation as one message: the first (the paper and the first question), then what
// followed, then the question now.
export function foldMessages(messages) {
  if (messages.length === 1) return messages[0].content;
  const [first, ...rest] = messages;
  const last = rest.pop();
  const lines = [first.content, "", "(Our conversation since then:)", ""];
  for (const m of rest) lines.push(`**${m.role === "user" ? "User" : "You"}:** ${m.content}`, "");
  lines.push("(Now:) " + last.content);
  return lines.join("\n");
}

// A reason that no other model would fix: nothing to fall back for.
function final(e) {
  return /aborted|stopped|took longer|prompt is too long|too long for the model|context (window|length)|maximum context|too many tokens/i.test(String(e && e.message));
}

// → { text, usage, costUsd, session, window, spec, provider, model, effort, fellBack? }
// `target`: a resolved model ({ provider, model, spec }). `resume`: the thread to continue (stateful).
export async function generate({ settings, ctx, target, effort = "", system, messages, resume = null, persist = false, onDelta, onStatus, signal, onFallback }) {
  const attempt = async (t, withResume) => {
    const p = providerById(t.provider, settings);
    if (!p) throw new Error(`no provider "${t.provider}"`);
    const info = await findModelInfo(settings, ctx, t.provider, t.model);
    const e = info && Array.isArray(info.efforts) && !info.efforts.length ? "" : effort && info && info.efforts && !info.efforts.includes(effort) ? info.efforts[info.efforts.length - 1] : effort;
    const common = { config: configFor(p.id, settings), model: t.model, effort: e, system, onDelta, onStatus, signal, ctx, persist };
    const r = p.stateful
      ? await p.stream(Object.assign(common, withResume ? { message: messages[messages.length - 1].content, resume: withResume } : { message: foldMessages(messages), resume: null }))
      : await p.stream(Object.assign(common, { messages }));
    return Object.assign(r, { spec: t.spec, provider: t.provider, model: t.model, effort: e, window: r.window || (info && info.context) || 0, stateful: !!p.stateful, price: info ? { in: info.priceIn, out: info.priceOut } : null });
  };
  try {
    return await attempt(target, resume);
  } catch (e) {
    const fb = settings.defaults && settings.defaults.fallback;
    if (!fb || final(e) || (signal && signal.aborted)) throw e;
    let t;
    try {
      t = resolveModel(fb, settings, "chat");
    } catch {
      throw e;
    }
    if (t.spec === target.spec) throw e;
    if (onFallback) onFallback(`${target.spec} failed (${e.message}): answering with the fallback, ${t.spec}`);
    const r = await attempt(t, null);
    return Object.assign(r, { fellBack: { from: target.spec, error: e.message } });
  }
}

// What an answer cost: the provider's figure, else the model's list price, else unknown (null).
// Subscriptions are covered by the plan: 0.
export function costOf(r) {
  if (!r) return null;
  if (r.subscription) return 0;
  if (typeof r.costUsd === "number") return r.costUsd;
  if (r.price && typeof r.price.in === "number" && typeof r.price.out === "number" && r.usage) {
    return (r.usage.input * r.price.in + r.usage.output * r.price.out) / 1e6;
  }
  return null;
}
