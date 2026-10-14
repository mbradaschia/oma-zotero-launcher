# Phase 9: taxonomies (design)

Phase 9 of [`macos/PLAN.md`](../../../PLAN.md): tagging papers by taxonomies, the audit, a paper's Taxonomies
page, Settings › Taxonomies with a taxonomy's form, its labels, AI drafts, and the review of unsure labels.

The 23 row ids, in four groups:
- **On a paper:** `classify classify-audit tax-paper tax-label-papers tax-audit`
- **Settings › Taxonomies, the list:** `tax-open tax-on tax-new tax-review tax-suggestion`
- **A taxonomy's page and its labels:** `tax-show tax-kind tax-label tax-label-add tax-label-delete tax-editor
  tax-reset tax-off tax-delete`
- **AI drafts:** `tax-ai-new tax-ai-edit tax-ai-accept tax-ai-discard`

Source map: the phase 9 explorer's report (scratchpad `phase9-map.md`). Conventions: `macos/docs/ux-conventions.md`.

## 1. State and the runner

`TaxonomyState` holds:
- the report (`taxonomies --json`) and the review list (`classify-review --json`);
- the taxonomy open (`taxonomy-show`), its label, the AI draft;
- the paper's audit (`classify-show`) and its status (`classify-status --json --items`, with a serial);
- the papers waiting for their text before they're tagged.

The report is read:
- when the launcher opens, and when Settings opens;
- after classifying;
- after every save, remove, new or decide;
- after a Jev key is set, removed or tested.

Each change rebuilds Settings, the taxonomy pages and a paper's menu.

The runner's jobs:
- `taxonomy-save` (stdin), `taxonomy-remove`, `taxonomy-new`, `taxonomy-show`, `classify-show` and
  `classify-decide` go through one serial queue (`taxJob`). It refuses writes while the sync folder is away
  (taxonomies are synced).
- `taxonomy-draft` runs alone, one at a time.
- `classify` is phase 7's queue, extended: after each run the report and the paper are read again, and the
  views rebuild when `classifying` changes.

## 2. Settings › Taxonomies

- **The pages:**
  - `settings-taxonomies` (`Settings.buildTaxonomies`), `settings-taxonomy` (`buildTaxonomy`),
    `settings-tax-label` (`buildTaxonomyLabel`), `settings-tax-ai` (`buildTaxonomyDraft`) and
    `settings-tax-review` (`buildTaxonomyReview`).
  - All of them come through GlueSettings' `page()`, with the Mac's words.
  - Each is in the settings index.
- **The form's fields** (name, prefix, question, threshold, low; a label's name and definition; Ask the AI):
  - The QML edits them in place. The Mac has no in-place fields: Enter on one opens a typing page,
    `settings-tax-field`, filled with its value.
  - Enter there keeps it: checked by `Settings.taxonomyValue`, saved through `editTaxonomy`, then back to the row.
    Esc goes back without saving.
  - A label or prefix renamed offers to rename the tags on papers (the QML's `offerTagRename`, counted).
  - Ask the AI sends the request.
  - Multi-line fields (the question, a definition) are one line here: the box takes one, and ⌥↵ isn't needed,
    since the runner keeps line breaks out of both.
- **Pills and keys:**
  - The pills (kind unique|several, shown|hidden) change with Enter, or with Tab and ⇧Tab (KeyRouter already
    routes those).
  - ⇧↑↓ moves a label.
  - Delete dismisses a suggestion in the review.
- **The QML's flashes and confirmations, word for word:**
  - Deleting a label asks with three ways out: the label and its tag on every paper, the label only, or Esc
    to keep it. The detail is counted.
  - Back to the bundled one asks first, and so does deleting a taxonomy.
  - Turning off a bundled one doesn't ask in the QML, though it drops your changes to it. The Mac asks when you
    have changes ("Turn off “T”? Your changes to it go"). The QML gets the same question.
- **AI drafts:**
  - Need a model; they keep the base's `show` and `low` unless the proposal sets them. That fixes the QML's
    silent reset; the QML gets the same.

## 3. On a paper

- **Its menu:**
  - The menu gets `taxonomies`, `taxStatus`, `jev` and `classifying`.
  - That shows Tag by taxonomies (`classify`), Audit the taxonomies (`classify-audit`), and the Taxonomies row
    (`tax-paper`).
  - `classify-status` is read after the paper's details.
- **The pages:**
  - `tax-paper` (`Views.buildPaperTaxonomies`): each label opens its papers (`tax-label-papers`: the tag as a
    scope).
  - `tax-audit` (`Views.buildTaxonomyAudit`): Enter cycles a label auto → on → off → auto (`classify-decide`).
  - Both are paper views (the context bar names the paper).
  - Their classify rows are unavailable while the paper is being tagged (the QML queued it twice).
- **The pills:**
  - The header strip (`Views.taxonomyStrip`) shows under the context bar on a paper's views; a click opens that
    tag's papers.
  - The footer's pills come from `Views.paperFooter` with the taxonomies.
- **Tag a paper when you open it** (`defaults.tagOnOpen`):
  - It tags the taxonomies the paper is out of date with (`classify-status`'s `stale`).
  - It waits while the paper's text is being extracted (checked every 15 s, at most a minute after it ends).
- **Go to › Tag “…”'s papers by taxonomies** (`classify-all`, in a collection, a tag or a saved search):
  - Counts the scope's papers (`/papers/select`, 200 at most), asks with the price, then queues them.
  - Flashes `Tagged X of N`.
- **The @ picker and grouping:** `tax:<id>` fields with their labels' counts, and `g` by a taxonomy's prefix,
  get the report's taxonomies where `[]` was passed.

## Testing

- Goldens for the new wrappers (the five pages, `editTaxonomy`, `taxonomyValue`, `paperTaxonomies`,
  `taxonomyAudit`, `taxonomyStrip`, the footer with taxonomies).
- **XCTest with the fake runner and bridge:**
  - Every one of the 23 ids: argv, stdin, flashes, the confirmations.
  - The form's fields saved, refused and renamed (with the tag rename offered).
  - The draft: sent, accepted, discarded.
  - The review's Delete.
  - tagOnOpen, now and after the text.
  - `classify-all`'s count and confirmation.
- The consistency tests over the new pages; parity `--phase 9` complete.
- **The QML:** the tax-off question and the draft keeping `show` and `low`, with tests in both trees.
