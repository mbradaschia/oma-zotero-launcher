# Backlog

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
