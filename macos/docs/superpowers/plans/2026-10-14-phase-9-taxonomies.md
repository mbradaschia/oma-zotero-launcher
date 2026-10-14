# Phase 9: taxonomies, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Each task is test first.

**Goal:** the 23 ids of phase 9, the paper's taxonomies, Settings › Taxonomies.

**Spec:** `macos/docs/superpowers/specs/2026-10-14-phase-9-taxonomies-design.md`.

**Constraints:** the same as phase 8's. Taxonomies are synced: writes are refused while the folder is away.

## Tasks

1. **Glue:**
   - GlueSettings' `page()` gets taxonomies, taxonomy, tax-label, tax-ai and tax-review, and the settings index
     too.
   - `GlueTaxonomies.js` gets `editTaxonomy`, `taxonomyValue`, `paperTaxonomies`, `taxonomyAudit`,
     `taxonomyStrip`, `taxonomyDraftInput`, and the footer with taxonomies.
   - Goldens.
2. **State:**
   - `TaxonomyState`, with `refreshTaxonomies`, `refreshTaxonomyReview` and `refreshTaxStatus`.
   - `taxJob` (a serial queue, stdin) and the draft's run.
   - The classify queue reads the report and the paper again after each run.
3. **Settings:**
   - The pages and the 18 settings ids.
   - The form's typing page (`settings-tax-field`); the pills, Tab, ⇧↑↓ and the review's Delete.
   - The confirmations.
4. **On a paper:**
   - Menu extras; `classify`, `classify-audit`, `tax-paper`, `tax-label-papers` and `tax-audit`.
   - The header strip and the footer pills; tagOnOpen with tagAfterText.
   - Go to's `classify-all`; the @ picker's and grouping's taxonomies.
5. **Omarchy:** tax-off asks when you have changes; an accepted draft keeps `show` and `low`. Tests in both trees.
6. **Verify and review:**
   - Every suite, goldens `--check`, parity `--phase 9`.
   - A code review and a UX consistency review, then a fix pass.
   - Push, and a PR stacked on #15.
