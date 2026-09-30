# Plan: more model providers, and a settings editor

Status: proposal (September 2026). Today the prompts and the chat run on Claude only, through the Claude
Agent SDK and the user's Claude subscription. This plan adds other providers behind the same prompts, chat
and extraction features, and a settings editor in the launcher, organized in sections, where providers are
configured (and where later settings will go).

## 1. Goals

- Run any prompt and any chat on a model from another provider: a subscription the user already has, an API
  key, or a model running locally.
- Keep what works: the prompt files, the grounding (extracted text, highlights, notes, APA 7 reference), the
  task queue, the chat window and its streaming protocol, the Claude subscription path.
- Configure it all inside the launcher: a **Settings** view in sections (General, Models & providers, Defaults,
  and later more), editing the settings file and storing secrets in the keyring.
- Never put an API key in a plain file.

Out of scope for now: tools/agents (the runner stays single-turn, no tools), image input, embeddings.

## 2. Research: which providers

What matters here: long context (a paper's text is 20–100k tokens), faithful quoting, streaming, a way to
list models (for the pickers), and how the user signs in.

| Provider | Sign-in | How the runner talks to it | Models list | Notes |
|---|---|---|---|---|
| **Claude (subscription)** | Claude Code login (Pro/Max) | Claude Agent SDK *(today)* | SDK `supportedModels()` *(today)* | Keeps session resume for chat. |
| **Anthropic API** | API key | AI SDK `@ai-sdk/anthropic` | `GET /v1/models` | Same models, pay per token; for users without a subscription. |
| **OpenAI API** | API key | AI SDK `@ai-sdk/openai` (Responses API) | `GET /v1/models` | Reasoning effort maps directly. |
| **ChatGPT (subscription)** | Codex CLI login (Plus/Pro/Team…) | `@openai/codex-sdk` (spawns the `codex` CLI, JSONL events) | a fixed list from Codex | The parallel of the Claude path: no API key. Codex is agent-first; run it read-only, no tools, one turn. **Experimental.** |
| **Google Gemini API** | API key (AI Studio) | AI SDK `@ai-sdk/google` | `GET /v1beta/models` | Very long context. The personal "Login with Google" in Gemini CLI was removed in June 2026, so API key only. |
| **OpenRouter** | API key | `@openrouter/ai-sdk-provider` (OpenAI-compatible) | `GET /api/v1/models` (with context length and prices) | One key, 400+ models (DeepSeek, Mistral, Qwen, Llama, xAI…); the easiest way to cover the long tail. |
| **Ollama (local)** | none | AI SDK `@ai-sdk/openai-compatible` → `http://localhost:11434/v1` | `GET /v1/models` | Private: nothing leaves the machine. Small contexts on most local models: see §4.4. Installed on this machine. |
| **OpenAI-compatible (custom)** | optional key + base URL | `@ai-sdk/openai-compatible` | `GET {base}/models` | LM Studio, vLLM, llama.cpp server, LocalAI, a company gateway. |
| Later: Mistral, xAI, DeepSeek direct, Azure OpenAI, Amazon Bedrock, Google Vertex | API key / cloud credentials | AI SDK first-party providers | per provider | Reachable through OpenRouter meanwhile. |

Package versions today: `ai` 7.0, `@ai-sdk/openai` 4.0, `@ai-sdk/anthropic` 4.0, `@ai-sdk/google` 4.0,
`@ai-sdk/mistral` 4.0, `@ai-sdk/openai-compatible` 3.0, `@openrouter/ai-sdk-provider` 3.1,
`@openai/codex-sdk` 0.159.

**First wave:** Anthropic API, OpenAI API, Gemini API, OpenRouter, Ollama, custom OpenAI-compatible. **Second:**
ChatGPT subscription (Codex SDK). **Later:** the enterprise clouds and direct second-tier providers.

Why the Vercel AI SDK for the API providers: one `streamText()` call for all of them, first-party packages for
the big ones, an OpenAI-compatible package for everything else, typed usage and finish reasons, and a mock
model for tests. The Claude subscription stays on the Agent SDK (that is what uses the subscription), and the
ChatGPT subscription goes through the Codex SDK for the same reason.

## 3. Architecture

### 3.1 A provider layer in the runner

`daemon/lib/providers/`, one module per kind, all with the same shape:

```js
// providers/index.mjs
export const PROVIDERS = { claude, anthropic, openai, chatgpt, google, openrouter, ollama, compatible };
provider.status(config)        // → { ok, detail }: configured? key present? reachable?
provider.listModels(config)    // → [{ id, name, context, efforts, costIn, costOut }]
provider.stream({ config, model, effort, system, messages, session }) // async iterator:
                               //   { type: "delta", text } … { type: "done", text, session, usage }
```

- **claude**: today's `askClaude` / `chatTurn`, moved behind the interface (session = the SDK session id).
- **ai-sdk** (anthropic, openai, google, openrouter, ollama, compatible): `streamText({ model, system, messages,
  providerOptions })`. Stateless: the chat sends its transcript each turn (the paper in the first user message,
  marked for prompt caching where the provider supports it).
- **chatgpt**: `new Codex().startThread({ sandbox: "read-only" })`, `thread.runStreamed(message)`; session =
  the Codex thread id, resumed with `resumeThread`.

The runner's commands stay the same (`run`, `chat`, `extract`, `models`…); the JSON-lines protocol to the
chat window does not change.

### 3.2 Model names

`provider:model` everywhere a model is named (prompt files, chat sessions, settings):
`claude:opus[1m]`, `openai:<model>`, `openrouter:deepseek/<model>`, `ollama:qwen3:32b`. A bare name
(`opus[1m]`, as in today's prompt files) means `claude:` so nothing breaks.

### 3.3 Effort

The pickers keep one *effort* scale (low … max) and each provider maps it: Claude `effort`, OpenAI
`reasoningEffort`, Gemini `thinkingBudget`, Anthropic API thinking budget; models without reasoning show no
effort, as Haiku does today.

### 3.4 Fitting the paper into the context

Each model reports its context (listed, or from a built-in table, or set by hand for local models). Before a
run, the runner budgets: instructions + highlights + notes + the paper's text ≤ 80% of the context, trimming
the notes first, then the text (from the end, with a line saying so). For small local models (8–32k), the
prompt says the text is partial; a later phase can add map-reduce (summarize sections, then answer).

### 3.5 What each provider receives

Unchanged content (paper metadata, APA 7 reference, highlights, notes, text), sent to the chosen provider.
The privacy section of the README gets a line per provider; Ollama and local endpoints keep everything on the
machine, and the settings say so.

## 4. Settings

### 4.1 Where things live

- `~/.config/omarchy/oma-zotero-launcher.json`, in sections (older flat keys are still read, and moved into
  `general` the first time the editor saves):

```json
{
  "general": { "enterAction": "reader", "externalPdfCommand": null, "maxResults": 60, "accelerators": true,
               "emptyQuery": { "showOpen": true, "tabOrder": "mru", "recent": "latest", "recentLimit": 15 }, "port": 23119 },
  "providers": {
    "claude":     { "enabled": true },
    "openai":     { "enabled": true },
    "openrouter": { "enabled": false },
    "ollama":     { "enabled": true, "baseURL": "http://localhost:11434/v1" },
    "compatible": { "enabled": false, "name": "LM Studio", "baseURL": "http://localhost:1234/v1" }
  },
  "defaults": {
    "prompts": { "model": "claude:opus[1m]", "effort": "high" },
    "chat":    { "model": "claude:opus[1m]", "effort": "high" },
    "fallback": null
  }
}
```

- **API keys in the keyring**, never in the file: `secret-tool store service oma-zotero-launcher provider openai`
  (the GNOME keyring is running here). Environment variables (`OPENAI_API_KEY`, `GEMINI_API_KEY`,
  `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`) are used when no key is stored. The runner reads keys; the shell
  never holds them.

### 4.2 The Settings view

A **Settings** row at the top of the launcher, next to Tasks and Chats. Keys follow the rest of the launcher:
`Enter` opens or changes, `Esc` back, `Alt+1…9` rows.

```
Settings
├── General            Enter behavior, results, PDF app, keys, the list before you type, Zotero port
├── Models & providers
│   ├── Claude (subscription)   ✓ signed in · Opus, Sonnet, Haiku
│   ├── OpenAI                  key set · 42 models            → provider page
│   ├── Google Gemini           no key                         → provider page
│   ├── OpenRouter              off
│   ├── Ollama (local)          ✓ running · 6 models
│   ├── ChatGPT (subscription)  codex not signed in
│   └── Add an OpenAI-compatible endpoint…
├── Defaults           the model and effort for prompts and for chat
└── (later) Appearance, Rankings, Notes and export, Advanced
```

- **Row types**, reusing what the prompt editor already has: a **toggle** (Enter flips), a **dropdown** (Enter
  opens the options under the row, as the model picker does), a **text** field (edited in the header, like a
  prompt's title), a **secret** (typed in the header, shown masked, saved to the keyring; *Remove key*), and an
  **action** (*Test connection*, *Refresh models*).
- **A provider page:** Enabled · API key (set / replace / remove) · Base URL (local and custom) · Test connection
  (lists models, or says why not) · Default model · Context size (local models, when not reported).
- Every change is validated (`lib/Client.js` `normalizeSettings`, extended per section) and written at once;
  an invalid value is refused with the reason in the footer.

### 4.3 Where providers show up

- The **model pickers** (prompt editor, chat window) list models grouped by provider, enabled providers only,
  each with its context and, for API providers, its price per million tokens.
- Prompt rows, tasks and chats show the model with its provider (`OpenAI · <model>`).
- A model that can't take the paper whole says so in the picker (`16k: partial text`).

## 5. Runner changes

- `daemon/lib/providers/*.mjs` (§3.1); `askClaude` / `chatTurn` move into `providers/claude.mjs`.
- `daemon/lib/secrets.mjs`: `secret-tool` lookup/store/clear, env fallback.
- `daemon/lib/budget.mjs`: the context budget (§3.4), pure and tested.
- Commands: `providers [--json]` (status per provider), `models --provider P [--refresh]`, `secret set P`
  (key on stdin) / `secret clear P`, `test P`; `run` and `chat` take `--model provider:model`.
- Chat sessions store the provider; AI SDK chats keep the transcript and resend it; a session can switch
  model (the next answer comes from the new one).
- Dependencies: `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`,
  `@openrouter/ai-sdk-provider`; `@openai/codex-sdk` in phase 3.

## 6. Launcher changes

- `SettingsView` in `ZoteroSearch.qml` (views `settings`, `settings-section`, `provider`), built from a
  declarative schema in `lib/Settings.js` (sections → rows → type, key, options, validation), so a new setting is
  one schema entry.
- `Service.qml`: read and write the sectioned settings file; ask the runner for provider status and models;
  pass secrets to `oma-zotero-prompt secret set` on stdin.
- Pickers take `provider:model` and group by provider.

## 7. Testing

- Unit: the settings schema and migration of flat settings; `provider:model` parsing; effort mapping; the
  context budget; each AI SDK provider against the AI SDK's mock model; secrets with a fake `secret-tool`.
- Contract tests: every provider module passes the same suite (stream order, done/usage, errors).
- Live smoke (skipped without credentials): one short grounded answer per configured provider, checking a
  quote and a page number come back.
- The launcher: the Settings view driven over IPC like the other views.

## 8. Phases

| Phase | What | Done when |
|---|---|---|
| **1. Settings editor** | Sectioned settings file (with migration), Settings view, General section editing today's settings, keyring secrets, schema-driven rows | Every current setting can be changed from the launcher and is validated; keys land in the keyring |
| **2. Provider layer + API providers** | Provider interface, Claude moved behind it, AI SDK providers: OpenAI, Anthropic API, Gemini, OpenRouter, Ollama, custom compatible; Models & providers section with provider pages and test connection; `provider:model` in prompts and chat; pickers grouped by provider; context budget | A prompt and a chat run end to end on OpenAI, Gemini, OpenRouter and Ollama, with quotes and pages; secrets never on disk in clear |
| **3. ChatGPT subscription** | Codex SDK provider, read-only single turn, thread resume for chat | A chat runs on a ChatGPT plan without an API key |
| **4. Defaults and polish** | Defaults section; fallback model when a provider fails; cost and usage in Tasks; README, CHANGELOG, privacy per provider | Documented, tested, released as 0.2.0 |
| **5. More** | Mistral, xAI, DeepSeek direct; Azure, Bedrock, Vertex; map-reduce for small contexts | As needed |

## 9. Risks and open questions

- **Subscription use in apps.** The Claude path uses Claude Code's own SDK; the ChatGPT path uses Codex's. Both
  are official SDKs, but plan limits apply and terms can change; mark them as such in Settings.
- **Quote faithfulness varies by model.** Smaller and local models invent quotes more often. Keep the "never
  invent" instructions, show the model on every note, and consider a quote check against the extracted text
  (flag quotes not found verbatim).
- **Small local contexts.** The budget trims honestly; map-reduce is phase 5.
- **Model lists change fast.** Lists come from each provider at run time (cached a day), never hard-coded.
- **Keyring availability.** Without a Secret Service (a headless session), fall back to environment variables
  and say so in Settings; never write keys to a file.
