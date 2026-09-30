# Plan: model providers for everyone, and a settings editor

Status: proposal (September 2026). Today the prompts, the chat and the grounded answers run on Claude only,
through the Claude Agent SDK and a Claude subscription. That works for someone who already pays for Claude;
it shuts out everyone else. This plan opens the AI features to any user of the public plugin, whatever they
have or can get: a subscription they already pay for, an API key (their own or their institution's), a free
option, or a model running on their own computer. It also adds a settings editor in the launcher, organized in
sections, where users choose and configure a provider, and where later settings will live.

## 1. Who it is for, and what they need

Users are researchers on Omarchy with a Zotero library. What they have varies a lot:

| User | Has | Wants |
|---|---|---|
| Already pays for an AI subscription | Claude Pro/Max, or ChatGPT Plus/Pro | to use it, no extra bill |
| Has or can get an API key | OpenAI, Anthropic, Google, or a university/company key | pay per use, choose models |
| Wants one account for everything | OpenRouter | many models behind one key |
| Can't or won't pay | nothing | a free way that still works |
| Must keep papers private | a decent GPU/CPU | everything on their machine |
| Is at an institution with its own gateway | an OpenAI-compatible endpoint | point the plugin at it |

So the plugin must: work with any of these, detect what the user already has, guide them to a working setup in
a minute, keep keys safe, say clearly what leaves the machine and what it costs, and never assume one provider.

Out of scope: tools/agents (the runner stays single-turn, no tools), image input, embeddings.

## 2. Research: providers to support

Criteria: covers the situations above; long context (a paper's text is 20–100k tokens); faithful quoting;
streaming; a way to list models (pickers must not hard-code them); an official, stable way to sign in.

| Provider | For | Sign-in | Runner integration | Models list | Cost to the user |
|---|---|---|---|---|---|
| **Claude subscription** *(today)* | Claude Pro/Max users | Claude Code login | Claude Agent SDK | SDK `supportedModels()` | included in the plan (usage limits) |
| **ChatGPT subscription** | ChatGPT Plus/Pro/Team users | Codex CLI login (`codex login`) | `@openai/codex-sdk` (runs the `codex` CLI, JSONL events), read-only, one turn | fixed list from Codex | included in the plan (usage limits) |
| **OpenAI API** | API-key users | API key | AI SDK `@ai-sdk/openai` | `GET /v1/models` | per token |
| **Anthropic API** | API-key users without a subscription | API key | AI SDK `@ai-sdk/anthropic` | `GET /v1/models` | per token |
| **Google Gemini API** | API-key users; a free tier with limits | API key (Google AI Studio) | AI SDK `@ai-sdk/google` | `GET /v1beta/models` | free tier, then per token |
| **OpenRouter** | one key, 400+ models (DeepSeek, Mistral, Qwen, Llama, xAI…); some free models | API key | `@openrouter/ai-sdk-provider` | `GET /api/v1/models` (with context and prices) | per token; some models free |
| **Ollama** | private and free, on the user's machine | none | AI SDK `@ai-sdk/openai-compatible` → `http://localhost:11434/v1` | `GET /v1/models` | free (their hardware) |
| **OpenAI-compatible endpoint** | LM Studio, vLLM, llama.cpp server, institutional gateways | optional key + base URL | `@ai-sdk/openai-compatible` | `GET {base}/models` | depends |
| Later: Mistral, xAI, DeepSeek direct; Azure OpenAI, Amazon Bedrock, Google Vertex | enterprise and regional needs | key / cloud credentials | AI SDK first-party providers | per provider | per token |

Notes from the research:
- Gemini CLI's personal "Login with Google" was removed in June 2026, so Gemini is supported through an API key,
  not a Google-account login.
- The Codex SDK reuses a ChatGPT login when no API key is set, which is what makes a ChatGPT plan usable without
  an API key; it needs the `codex` CLI installed and signed in.
- OpenRouter's model list includes context length and prices, which the pickers can show as they are.
- Current packages: `ai` 7.0, `@ai-sdk/openai` 4.0, `@ai-sdk/anthropic` 4.0, `@ai-sdk/google` 4.0,
  `@ai-sdk/openai-compatible` 3.0, `@openrouter/ai-sdk-provider` 3.1, `@openai/codex-sdk` 0.159.

**First wave:** OpenAI API, Anthropic API, Gemini API, OpenRouter, Ollama, OpenAI-compatible (with the Claude
subscription kept). This covers paying, API-key, free and private users. **Second:** ChatGPT subscription.
**Later:** the enterprise clouds and direct regional providers, as users ask.

Why the Vercel AI SDK for the API providers: one `streamText()` for all, first-party packages for the big ones,
an OpenAI-compatible package for the rest, typed usage (for costs), and a mock model for tests. Subscriptions go
through their vendors' own SDKs, which is what lets them use the plan instead of a key.

## 3. Onboarding: a working setup in a minute

- **Nothing is assumed.** A fresh install has no provider enabled. The Prompts and Chat rows say *Set up an AI
  model* and open **Settings › Models & providers**.
- **Detection first.** The runner checks what the user already has and the page shows it at the top:
  - `claude` on the PATH and signed in → *Claude (your subscription) is ready*
  - `codex` on the PATH and `codex login status` signed in → *ChatGPT (your subscription) is ready*
  - Ollama answering on `localhost:11434` → *Ollama is running, with N models*
  - `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` in the environment
  One Enter enables a detected provider and makes it the default.
- **Choosing when nothing is detected**, one line each with what it costs and what leaves the machine:
  *Use my subscription* (Claude or ChatGPT: how to sign in) · *Use an API key* (where to get one, a link per
  provider) · *Free, with limits* (Gemini free tier, OpenRouter free models) · *Private, on this computer* (Ollama:
  `omarchy pkg add ollama`, `ollama pull <model>`, with a recommended size for faithful quotes) · *My
  institution's endpoint* (base URL + key).
- **Test before use.** Every provider page has *Test connection*: it lists the models or says exactly what is
  wrong (no key, invalid key, not signed in, not running, no models pulled).
- **Requirements, stated up front:** the AI features need Node.js (`omarchy install dev-env node`) and
  `make prompts-install` (or its successor, §7); text extraction needs `pdftotext` (`omarchy pkg add poppler`).
  Settings says what is missing and how to add it.

## 4. Architecture

### 4.1 A provider layer in the runner

`daemon/lib/providers/`, one module per kind, one interface:

```js
provider.detect()                 // → { available, signedIn, detail } without any configuration
provider.status(config)           // → { ok, detail }: key present and valid? reachable?
provider.listModels(config)       // → [{ id, name, context, efforts, priceIn, priceOut }]
provider.stream({ config, model, effort, system, messages, session })
                                  // async iterator: { type: "delta", text } … { type: "done", text, session, usage }
```

- **claude**: today's Agent SDK code behind the interface (session = the SDK session, resumed per turn).
- **AI SDK providers** (openai, anthropic, google, openrouter, ollama, compatible): `streamText({ model, system,
  messages, providerOptions })`; stateless, so a chat resends its transcript each turn, with the paper in the
  first user message marked for prompt caching where supported.
- **chatgpt**: Codex SDK thread, read-only sandbox, one turn per question, resumed by thread id.

The commands (`run`, `chat`, `extract`, `models`) and the JSON-lines protocol to the chat window stay as they are.

### 4.2 Model names

`provider:model` wherever a model is named: prompt files, chat sessions, settings (`claude:opus[1m]`,
`openai:<model>`, `openrouter:<vendor>/<model>`, `ollama:<model>`). A bare name means `claude:`, so existing
prompt files keep working. The bundled prompts use a `default` model, which resolves to the user's chosen
default, so they work whatever provider a user has.

### 4.3 Effort

One *effort* scale in the pickers (low … max), mapped per provider (Claude effort, OpenAI reasoning effort,
Gemini thinking budget, Anthropic API thinking budget); models without reasoning show none.

### 4.4 Fitting the paper into the model

Each model reports its context (from its provider's list, a built-in table, or set by the user for local models).
Before a run: instructions + highlights + notes + the paper's text ≤ 80% of the context, trimming notes first,
then the text from the end, with a line saying the text is partial. Pickers flag models too small for a whole
paper (`16k: partial text`). A later phase adds summarize-then-answer for small contexts.

### 4.5 Quality across models

Smaller models invent quotes more often. Keep the "never invent" instructions for every provider; show the
model on every note and answer; and add a **quote check**: quotes in an answer are looked up in the extracted
text, and any not found word for word are flagged (in the chat, and in a line at the end of a note). Settings
recommends a minimum model size for local use.

## 5. Settings

### 5.1 The file, in sections

`~/.config/omarchy/oma-zotero-launcher.json`. Today's flat settings are still read, and moved into `general`
the first time the editor saves.

```json
{
  "general": { "enterAction": "reader", "maxResults": 60, "accelerators": true,
               "emptyQuery": { "showOpen": true, "tabOrder": "mru", "recent": "latest", "recentLimit": 15 },
               "externalPdfCommand": null, "port": 23119 },
  "providers": {
    "claude":  { "enabled": true },
    "openai":  { "enabled": false },
    "ollama":  { "enabled": false, "baseURL": "http://localhost:11434/v1" },
    "compatible": [ { "id": "lab", "name": "Lab gateway", "baseURL": "https://…/v1", "enabled": true } ]
  },
  "defaults": {
    "prompts": { "model": "claude:opus[1m]", "effort": "high" },
    "chat":    { "model": "claude:opus[1m]", "effort": "high" },
    "fallback": null
  }
}
```

### 5.2 Secrets

- **API keys go in the system keyring** through the Secret Service (`secret-tool`, service
  `oma-zotero-launcher`, attribute `provider`). Omarchy installs gnome-keyring and libsecret by default, and
  unlocks the keyring at login.
- Environment variables are read when no key is stored (useful for users who manage secrets elsewhere).
- If no Secret Service is available (another setup, a headless session), Settings says so and offers environment
  variables only. **Keys are never written to a file** by the plugin.
- The shell never holds a key: it passes it once to `oma-zotero-prompt secret set <provider>` on stdin.

### 5.3 The Settings view

A **Settings** row at the top of the launcher (next to Tasks and Chats). Same keys as everywhere: `Enter`
opens or changes, `Esc` back, `Alt+1…9` rows.

```
Settings
├── General              what Enter does, results, PDF app, keys, the list before you type, Zotero port
├── Models & providers   detected and configured providers first, then "add a provider"
│   ├── <provider>       status · Enabled · API key (set / replace / remove) · Base URL · Test connection
│   │                    · Default model · Context size (local) · what leaves this computer · cost
│   └── Add an OpenAI-compatible endpoint…
├── Defaults             model and effort for prompts and for chat; a fallback model
└── (later) Appearance, Rankings, Notes and export, Privacy, Advanced
```

- **Row types**, reusing the prompt editor's: toggle, dropdown (options open under the row), text (edited in the
  header), secret (typed in the header, masked, stored in the keyring), action (*Test connection*, *Refresh
  models*).
- **Schema-driven:** `lib/Settings.js` declares sections → rows → type, key, options, validation, help. A new
  setting is one entry; later sections plug in the same way.
- Every change is validated (`normalizeSettings`, extended per section) and saved at once; a refused value
  says why in the footer. *Reset to default* on each row.

### 5.4 Where providers show up

- **Model pickers** (prompt editor, chat window): enabled providers only, grouped, each model with its context
  and, where known, its price per million tokens.
- Prompt rows, tasks, chats, notes and answers show the model and its provider.
- **Tasks** show the tokens and the cost of each run when the provider reports them.

## 6. Privacy and costs, per provider

- Settings and the README say, per provider, what is sent (the paper's metadata and text, the user's highlights
  and notes) and to whom; local providers (Ollama, a local endpoint) keep everything on the machine.
- Before a first run on a paid API, Settings shows the size of a typical request (a paper is often 30–60k
  tokens) and the model's price, so a first bill isn't a surprise.
- Subscriptions (Claude, ChatGPT) are used through their vendors' official SDKs; their plan limits and terms
  apply, and Settings links to them.

## 7. Installation and distribution

- The AI features stay optional: the launcher works without Node.
- One runner package with the AI SDK providers (small, pure JavaScript); the Codex SDK only matters when `codex`
  is installed, and is loaded lazily.
- Replace `make prompts-install` with an **Install AI features** action in Settings (runs the same steps: copy the
  runner, `npm ci`, link the command), with its progress in Tasks; the Makefile target stays for developers.
- Releases: the runner's version stays tied to the plugin's (one version for all three parts).

## 8. Testing

- Unit: the settings schema, migration from flat settings, validation messages; `provider:model` parsing;
  effort mapping; the context budget; the quote check; secrets against a fake `secret-tool`; detection against
  fake CLIs and a fake Ollama server.
- Contract: every provider module passes the same suite (stream order, done and usage, errors, cancellation),
  the AI SDK ones against its mock model. Runs in CI with no keys.
- Live smoke, opt-in (`OMA_LIVE_PROVIDERS=openai,ollama…`): a short grounded answer per provider, checking that
  a quote and a page number come back. For maintainers and contributors with keys; never in CI by default.
- The launcher: the Settings view driven over IPC like the other views; onboarding with no provider, with a
  detected one, and with a failing key.

## 9. Phases

| Phase | What | Done when |
|---|---|---|
| **1. Settings editor** | Sectioned file and migration, the Settings view and its row types, General section, keyring secrets, schema | Every current setting is editable and validated in the launcher; keys land only in the keyring |
| **2. Provider layer + first wave** | Provider interface with detection; Claude behind it; OpenAI, Anthropic, Gemini, OpenRouter, Ollama, OpenAI-compatible; provider pages and Test connection; `provider:model`; grouped pickers; context budget | A new user with any one of these gets a prompt and a chat working from Settings alone |
| **3. Onboarding** | *Set up an AI model* from Prompts/Chat, detection summary, the choose-a-way page, Install AI features action, requirements checks | A fresh Omarchy user reaches a working setup without the README |
| **4. ChatGPT subscription** | Codex SDK provider, read-only, thread resume | A ChatGPT Plus user chats without an API key |
| **5. Trust and costs** | Quote check, cost and tokens in Tasks, privacy lines per provider, fallback model, docs (a "Choosing a provider" README section) | Released as 0.2.0 |
| **6. More** | Mistral, xAI, DeepSeek direct; Azure, Bedrock, Vertex; summarize-then-answer for small contexts | As users ask |

## 10. Risks and open questions

- **Terms of use for subscriptions** can change; the subscription providers are labelled as such, and the API
  and local options always remain.
- **Free tiers change** (limits, models); Settings reads what the provider says instead of promising a quota.
- **Quote faithfulness** varies by model: the quote check and the model shown on every output make it visible.
- **Small local contexts**: the budget trims honestly; summarize-then-answer later.
- **Model lists move fast**: always fetched from the provider (cached a day), never hard-coded.
- **Support load**: each provider page's Test connection gives an exact reason, which is also what an issue
  report should include; the README gets a troubleshooting table per provider.
