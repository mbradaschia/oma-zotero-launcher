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
    // An accepted AI draft as it's saved: the proposal, keeping the base's show and low unless it sets them
    // (the QML dropped show, and the runner reset low to 30%).
    acceptedDraft: function (proposal, base) {
      var p = proposal || {}
      var b = base || {}
      return { name: p.name, prefix: p.prefix, kind: p.kind, question: p.question, threshold: p.threshold,
        low: p.low !== undefined && p.low !== null ? p.low : b.low, show: p.show !== undefined ? p.show : b.show !== false, labels: p.labels }
    }
  }
}

if (typeof module !== "undefined") module.exports = GlueTaxonomies
