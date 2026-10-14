// Glue's wrappers for phase 9: a paper's taxonomies (its page, the audit, the strip under its status, the
// footer's pills), a taxonomy changed and its fields checked (Settings › Taxonomies' pages are GlueSettings'
// page()). Merged into Glue (Glue.js); JSON in, JSON out. `taxonomies`: the report's (`taxonomies --json`'s
// taxonomies), [] none.
function GlueTaxonomies(V, S) {
  return {
    editTaxonomy: function (t, change) { return t ? S.editTaxonomy(t, change) : null },
    taxonomyValue: function (field, text, t) { return S.taxonomyValue(field, text, t || null) },
    paperTaxonomies: function (details, taxonomies, classified) { return V.buildPaperTaxonomies(details || null, taxonomies || [], !!classified) },
    taxonomyAudit: function (audit, tags) { return V.buildTaxonomyAudit(audit || null, tags || []) },
    taxonomyStrip: function (tags, taxonomies, taxStatus, classifying) { return V.taxonomyStrip(tags || [], taxonomies || [], taxStatus || null, !!classifying) },
    // An accepted AI draft as it's saved: the proposal, with the base's show and low (the model is never asked for
    // either, and the runner's validate fills them in: 30%, shown; the QML dropped show and low with it).
    acceptedDraft: function (proposal, base) {
      var p = proposal || {}
      var b = base || null
      return { name: p.name, prefix: p.prefix, kind: p.kind, question: p.question, threshold: p.threshold,
        low: b && b.low !== undefined && b.low !== null ? b.low : p.low, show: b ? b.show !== false : p.show !== false, labels: p.labels }
    }
  }
}

if (typeof module !== "undefined") module.exports = GlueTaxonomies
