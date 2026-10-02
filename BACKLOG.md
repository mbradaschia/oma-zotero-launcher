# Backlog

## Group and sort the results (papers)

In the item picker (*All*, and within a saved search), a choice of how papers are grouped or sorted, for paper
rows only (collections, tags and Go to stay as they are):

- by paper status (Settings › Paper status), *no status* last;
- by task status (or group: backlog, next, active, waiting, completed), papers without tasks last;
- by date (added, modified, published year), newest first;
- and back to relevance.

A key to cycle the grouping (and its name in the header), remembered for the next opening.

## Status tags (s/ and t/)

- **Convert or merge an existing tag into a status**: from the tag editor or Settings, turn a tag you already use
  (say "to read") into a paper status (`s/to read`) or a task status (`t/To read`), or merge it into an existing
  one: the tag renamed on every paper, the status added to its list.
- **Status and task tags in the tag editor (`#`)**: hide `s/…` and `t/…` there, or show them as a row that takes
  you to *Settings › Paper status* / *Settings › Tasks*, so they're managed in one place (renaming or deleting one
  from the tag editor would bypass the status lists).

## Auto-tag papers with Jev

Classify papers with [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) (TypeSafe's "System One"
model: fast, cheap structured classification into labels you define, with calibrated probabilities; API, early
access) and tag them in Zotero:

- **Label sets you define**, each a tag prefix: paper type (`type/conceptual`, `type/empirical`, `type/slr`…),
  method, theories or topics, or your own paper statuses; Jev picks from them only, so nothing is made up.
- **From the title and abstract** (or the extracted text when there is one), one paper or many: its menu, a
  collection, a saved search, or new papers as they arrive.
- **Confidence decides**: tags above a threshold are applied; the rest are suggested in a review list to accept,
  change or skip. Each tag's probability kept, so a later pass can revisit the doubtful ones.
- A provider like the others (API key in the keyring, Settings › Models & providers), with its cost per run shown.

## Extract text from PDFs automatically

Today text is extracted on request (`x`), or when a chat opens or a prompt runs (*Settings › Defaults › Extract
automatically*). Next: extract it in the background, with no waiting later:

- **New papers**: when a paper with a PDF arrives in Zotero (the bridge sees it), its text is extracted and saved
  as its full-text note, in Processes like any extraction.
- **Catch up**: extract every paper (or a collection, a saved search) that has a PDF and no extracted text yet, a
  few at a time, resumable; Settings shows how many are left.
- **A setting** to turn it on, and to skip large PDFs or scans (no text layer: suggest OCR instead).

