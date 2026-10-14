// Glue's wrappers for search power (phase 5): saved searches, the @ pickers, the search box's
// blocks, Zotero's sync. JSON in, JSON out; dates as epoch milliseconds.
function GlueSearch(V, C, T, F) {
  var at = function (ms) { return new Date(Number(ms) || Date.now()) }

  return {
    // ---- saved searches (searches.json)
    parseSearches: function (text) { return V.parseSearches(text) },
    // The file's text as the Omarchy launcher writes it (Service.qml's saveSearches), before Merge.stamp.
    searchesText: function (list) { return JSON.stringify({ searches: list || [] }, null, 2) + "\n" },
    // The list with the new search last.
    addSearch: function (searches, name, query, pinned, nowMs) { return V.addSearch(searches || [], name, query, !!pinned, at(nowMs)).list },
    updateSearch: function (searches, id, changes) { return V.updateSearch(searches || [], id, changes || {}) },
    removeSearch: function (searches, id) { return V.removeSearch(searches || [], id) },
    moveSearch: function (searches, id, otherId) { return V.moveSearch(searches || [], id, otherId) },
    nextSearch: function (pinned, currentId, delta) { return V.nextSearch(pinned || [], currentId || "", delta) },
    searchScope: function (search) { return search ? V.searchScope(search) : null },
    // What the results show, as one search: the scope's query and what is typed.
    combinedQuery: function (scope, typed) { return V.combinedQuery(V.scopeQuery(scope || null), typed || "") },
    savedSearchRows: function (searches, query, color) { return V.buildSearchRows(searches || [], query || "", color, F.filter) },
    searchMenuRows: function (search) { return V.searchMenuRows(search || null) },
    searchEditRows: function (mode, text, query) { return V.buildSearchEditRows(mode, text || "", query || "") },

    // ---- the @ pickers
    pickerRows: function (query, hasSearches, taxonomies) { return V.buildPickerRows(query || "", !!hasSearches, taxonomies || []) },
    // values: the bridge's /facets (ranked there: rank false) or saved searches (ranked here: rank true).
    pickerValueRows: function (values, query, color, rank) { return V.buildPickerValueRows(values || [], rank ? query || "" : "", color, rank ? F.filter : null) },
    dateValueRows: function (field, nowMs, query) { return V.buildDateValueRows(field, at(nowMs).getFullYear(), query || "") },
    dateField: function (field) { return !!V.DATE_FIELDS[field] },
    savedSearchValues: function (searches) { return V.savedSearchValues(searches || []) },
    pickerFieldLabel: function (field, taxonomies) { return V.pickerFieldLabel(field, taxonomies || []) },
    // A taxonomy's labels as the @ picker's values (tax:<id>), with their papers' counts (tagCounts: the tag facets').
    taxonomyValueRows: function (field, taxonomies, tagCounts, query, color) {
      return V.buildPickerValueRows(V.taxonomyValues(V.taxonomyOfField(field, taxonomies || []), tagCounts || {}), query || "", color, F.filter)
    },
    // The /facets body (Service.qml's facets).
    facetsBody: function (field, query, limit, settings) {
      return { field: field, query: String(query || ""), limit: limit, statusTags: C.statusTags(settings.paperStatuses), statusPrefix: C.PAPER_TAG_PREFIX,
        marks: C.searchMarks([], [], [], T.statusOfTodo) }
    },
    thousands: function (n) { return V.thousands(n) },

    // ---- the search box's blocks: [{ text, label, start, end, role, block }], in UTF-16 units
    querySegments: function (text, caret, live) { return V.querySegments(text, caret, !!live) },
    taskSegments: function (text, caret, settings, nowMs) { return T.taskSegments(text, caret, T.statusesOf(settings), at(nowMs), T.actionsOf(settings)) },

    // ---- Zotero's sync
    syncFooter: function (sync, nowMs) { return V.syncFooter(sync, at(nowMs).getTime()) }
  }
}

if (typeof module !== "undefined") module.exports = GlueSearch
