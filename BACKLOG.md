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

## Auto-tag papers with Jev, by taxonomies

Classify papers against **predefined taxonomies** with
[Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) (TypeSafe's "System One" model: fast, cheap
structured classification into labels given in advance, with calibrated probabilities; API, early access), and tag
them in Zotero, one tag prefix per taxonomy:

| Taxonomy | Kind | Labels (bundled, editable) | Tags |
|---|---|---|---|
| Paper type | one | conceptual, empirical quantitative, empirical qualitative, mixed methods, systematic literature review, meta-analysis, case study, methodological, editorial | `type/…` |
| Ontology | one | realist, critical realist, relativist / constructionist, pragmatist, not stated | `ont/…` |
| Epistemology | one | positivist, post-positivist, interpretivist, critical, pragmatist, not stated | `epi/…` |
| Method | several | survey, experiment, panel / econometrics, SEM / PLS, case study, interviews, ethnography, grounded theory, Gioia, QCA, simulation, bibliometric, content analysis | `method/…` |
| Theories | several | resource-based view, dynamic capabilities, resource orchestration, institutional theory, transaction cost economics, agency, stakeholder, contingency, network, attention-based view, behavioral theory of the firm… | `theory/…` |

- **Taxonomies are files** (a name, a tag prefix, one or several labels per paper, each label with a short
  definition that guides the classifier): edit the bundled ones, add your own (a field's topics, your own codes),
  in *Settings › Taxonomies*.
- **From the title and abstract**, or the extracted text when there is one (better for ontology and epistemology,
  rarely stated in an abstract). One paper (its menu), a collection, a saved search, or new papers as they arrive.
- **Confidence decides**: labels above a threshold are tagged; below it, suggested in a review list (accept,
  change, skip); "not stated" when nothing is clear rather than a guess. Each tag's probability kept, so a later
  pass can revisit the doubtful ones.
- **Searchable and countable**: `#theory/dynamic capabilities`, `@ › Tags`, and a taxonomy as a grouping of the
  results (with *Group and sort the results* above): papers by theory, by paper type…
- **Provider**: Jev's API key in the keyring (*Settings › Models & providers*), cost per run shown; the AI models
  already set up as a fallback (slower and dearer, same taxonomies).
- **Agrees with the Literature Review prompt**, whose *Paper at a Glance* states type, ontology, epistemology and
  method: the same labels, so the note and the tags say the same.

## Extract text from PDFs automatically

Today text is extracted on request (`x`), or when a chat opens or a prompt runs (*Settings › Defaults › Extract
automatically*). Next: extract it in the background, with no waiting later:

- **New papers**: when a paper with a PDF arrives in Zotero (the bridge sees it), its text is extracted and saved
  as its full-text note, in Processes like any extraction.
- **Catch up**: extract every paper (or a collection, a saved search) that has a PDF and no extracted text yet, a
  few at a time, resumable; Settings shows how many are left.
- **A setting** to turn it on, and to skip large PDFs or scans (no text layer: suggest OCR instead).


## A context bar above the search box in submenus

In a submenu, the search box line holds both what you're in and what you type, so long titles get cut and the
placeholder disappears as you type. Give submenus a slim bar above the search box naming their focus, always shown:

- a paper's menu and its submenus (notes, files, tags, prompts, tasks): the paper as *Authors, Year · Title*,
  with its rankings, as the note window's header does;
- a note: its paper, then the note's title; a task's page: the task, then its paper; a chat: its paper;
- a collection, a tag or a saved search being browsed: its path or name, with how many papers;
- Settings pages: the path (*Settings › Tasks*).

The search box below then shows only what you type (and its placeholder, "Type to filter"), and the status pills
stay under it. One component for all of them, so every menu reads the same.
