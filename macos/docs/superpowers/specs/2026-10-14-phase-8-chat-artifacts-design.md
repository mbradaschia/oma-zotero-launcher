# Phase 8: chat and artifacts (design)

Phase 8 of [`macos/PLAN.md`](../../../PLAN.md) covers `ChatWindow.qml` and the launcher's chat and
artifact rows. It ports these 19 row ids:

- **Chats:** `chat chat-new chat-session chat-menu-open chat-menu-rename chat-rename-save
  chat-menu-delete chat-open`
- **Artifacts:** `artifact art-open art-change art-change-go art-brief art-source art-folder art-undo
  art-rename art-rename-save art-delete`

Conventions: `macos/docs/ux-conventions.md`. Source map: the phase 8 explorer's report (scratchpad
`phase8-map.md`).

## 1. The runner, streamed

- `Runner.stream(argv, stdin, onLine, completion) -> RunnerStream?`:
  - stdin is written, then closed.
  - stdout is read line by line on the main actor.
  - stderr is collected.
  - `stop()` sends SIGTERM (the runner's `chat` has no handler, so it ends at once).
  - The completion gets the exit status and stderr.
- `ProcessRunner` does it with its own queue entry: clean environment, explicit PATH, one hour at
  most.
- `FakeRunner.stream` answers by subcommand with lines. `hold` keeps a stream open, so tests can emit
  lines, stop it, or finish it.

## 2. The chat window (one per paper, `ChatWindows`)

### Opening

- `chat` on a paper's menu or `c` opens the paper's chat window. If one is already open, it is
  focused. The launcher closes.
- `chat-session`, `chat-open`, or a task row with a session open that chat in it.
- The window title is `Chat · <cite>` (the QML's em dash written as the app writes titles).
- The window is 1100×900, at least 520×420.
- ⌘W closes it; a running answer is stopped first.

### Top bar

- ☰ (the sidebar).
- The flash, or `cite · title`.
- Menu (⌥M): the launcher, on the paper's menu.
- New chat: About this paper, or About another paper…
  - "Another paper" is the launcher's `chat-new` pick (the same pick as everywhere).
  - The QML window searches inside itself instead; this difference is written down.
- Copy chat, Save chat to Zotero, Download chat, Keys (?).

### Banner

- A pill: `✓ Text extracted` or `Text not extracted`, and an Extract text button (`extract --json
  --quiet`).
- Ground in `.md (extracted)` | `PDF` (the .md half is unavailable without a note). Switching it while
  the chat has messages starts a new chat, as the QML does.
- An info line: `this chat: <grounding> · <model> · <effort> · context 12k / 200k (6%)`. It is accented
  above 60 %.

### Sidebar

- **Past chats:**
  - Each row: the title and `date · N questions`.
  - A click opens one.
  - Rename: ✎ or a double click gives an inline field. Enter saves (`chat-rename`); Esc or losing
    focus cancels.
  - No delete here (the launcher's chat menu has it).
- **Artifacts:**
  - Each row: `▣ title` and `format · version c of n · date`.
  - A click opens it in the browser.
  - ✎ fills the box with `Change the “T” <format>: ` (the change goes through the chat).

### Conversation

- One web view: JavaScript off, a CSP, as `NoteView`.
- Messages:
  - The user's: a bubble on the right.
  - The assistant's: Markdown, through `Views.safeMarkdown`, then the vendored `marked`.
  - Notes: centred, in italics.
  - Each answer's info line: model, cost, quote check.
  - Each answer's links: Copy, Save to Zotero, Download. They are `oma-answer:<verb>/<index>` links
    the app handles, since JavaScript is off.
- While an answer streams:
  - It shows `streamView(text)`, with artifact blocks folded to `▣ Writing “T”…`.
  - Before any text, it shows the status, else `Reading the paper…`.
  - It is re-rendered at most every 150 ms, scrolled to the end while you are at the end.
- Links: `oma-artifact:` opens the artifact; `http(s)` opens in the browser.
- The empty state is the QML's sentence.

### Composer

- A text view that grows to 8 lines. Enter sends; ⇧↵ is a new line.
- Esc, in order: hides the keys, else stops a running answer, else closes a pop-up. It never
  closes the window.
- ⌥M is the launcher's menu; ? / F1 are the keys (outside the box).
- The model button, `<label> · effort ▾`, opens a menu:
  - Default (the chat default), then the models by provider.
  - Picking a model sets its effort (`Views.effortFor`).
  - Then the efforts: the model's, else low … max.
- Prompts ▾ appends a prompt's body to the box.
- Send / Stop.

### Events

The `chat` events as the map lists them:

| Event | What it does |
|---|---|
| `session` | sets the id, grounding and model |
| `context` | the meter; `compacted` flashes |
| `status` | the status line |
| `note` | inserted before the question |
| `delta` | appended to the answer |
| `artifact` | the sidebar is shown, a flash, the list read again |
| `quotes` | the quote check, held for the answer's info line |
| `done` | the final text and its info line |
| `error` | `Couldn't answer: …` |

- A stopped turn shows `*(stopped)*`, or `*(stopped: <stderr>)*` when nothing came.
- The QML's "first turn stopped" bug isn't carried over: a session id that never saved isn't
  resumed. The next send starts a new chat.

### Outputs

- The transcript: `# Chat: <title>`, then `*cite · title*`, then `**You:**` / `**<provider's
  name>:**`. The QML's hard-coded "Claude" becomes the answer's model label.
- Copy uses NSPasteboard.
- Download goes to `~/Downloads/<name>.md` without overwriting (`saveMarkdown`).
- Save to Zotero: `note --title "Chat: …" --tag oma-chat`, one save at a time. Titles are cleaned by
  the runner (lib/titles.mjs).

## 3. The launcher

- **Chats** (`openChats`, `c` outside a paper; Go to › Chats):
  - `Views.buildChatRows` lists them, the first row being New chat… (`chat-new`: pick the paper).
  - `chat-open` opens one.
  - ⇧↵ opens its menu.
  - The count reads `N chats`.
- **A paper's menu:**
  - Chats rows (`chat-session`, ⇧↵ its menu) and the Artifacts section (`artifact`, ⇧↵ its menu).
  - `chat` reads "Chat with the paper", grounded as `Views.chatRow` says.
- **The chat menu:** `chat-menu-open`, `chat-menu-rename` (the text-entry page, then
  `chat-rename-save`), and `chat-menu-delete`.
  - The delete asks first (the conventions' delete question, in both launchers):
    - The question: `Delete the chat “T”?`
    - The answers: `Delete it`, and `Keep it`.
    - The detail: `Its answers saved as notes stay in Zotero`.
    - Afterwards: `Chat deleted`.
- **The artifact menu** (`Views.buildArtifactMenu`):
  - `art-open` (the browser).
  - `art-change`, then `art-change-go` (`artifact-edit`, launched; it's in Processes).
  - `art-source` and `art-brief` (your editor: `open -t`).
  - `art-undo`, `art-rename` (then `art-rename-save`), `art-folder` (Finder).
  - `art-delete` asks first: `Delete the artifact “T”?`, with `Delete it (all its versions)` and
    `Keep it`, in both launchers.
- **The lists:**
  - `chats --all` and `artifacts --all` are read when the launcher opens and after a chat window
    closes.
  - The paper's menu filters them by key and library.
  - The root's Chats row and `has:chat` come from them (`searchBody`'s chats).
- **Keys:**
  - `c`: on a paper, its chat; elsewhere, Chats (the QML's `chatKey`).
  - The note window's `c`: chat about its paper.
  - A task's context chat (`todo-context` kind chat) opens it.
- **Not ported:** `artifact-libs`. Nothing in either launcher calls it; the runner fetches the
  drawing libraries during a run.

## Testing

- **RunnerClient:**
  - A real `/bin/sh` streaming three lines with a pause: they arrive in order before the exit.
  - stop() ends it.
  - stdin is written, then closed.
- **XCTest with the fake runner and bridge:**
  - The window's events to messages, stop, and an error.
  - Resuming a session; switching the source starts a new chat.
  - The model and effort argv; Save to Zotero's argv and stdin; the transcript.
  - The launcher's 19 ids: chats, the chat menu with rename and delete (asked first), the artifact
    menu (open, change, undo, rename, delete asked first), `c` routing.
- **Goldens** for the new wrappers (chat rows, the artifact menu, the change rows, `chatHtml`).
- **Consistency tests** over the new pages; parity `--phase 8` complete.
- **The QML:** the confirm on chat and artifact deletes; Settings and views tests in both trees.
