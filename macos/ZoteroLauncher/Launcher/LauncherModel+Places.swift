import Foundation

// A collection's or a tag's papers, searchable within (ZoteroSearch.qml:2380 openCollection, and
// the scoped parts of requestSearch and applyResponse, 448-506).
extension LauncherModel {
    // Enter on a collection or a tag (a result, or a pin): its papers.
    func openCollection(_ row: SearchRow) {
        store.push("search")
        store.scope = Scope(type: row.kind == "tag" ? "tag" : "collection", key: row.key, libraryID: row.libraryID,
                            title: row.kind == "tag" ? "#" + row.title : row.title)
        scopeTotal = ""
        response = nil
        rebuildSearch()
        requestSearch()
    }

    // What the results are searched within: the scope opened, else (at the top level) the badge
    // selected (ZoteroSearch.qml's searchScope).
    var searchScope: Scope? {
        if let s = store.scope { return s }
        guard store.pickFor.isEmpty, !searchState.active.isEmpty,
              let s = pinnedSearches.first(where: { $0["id"] as? String == searchState.active }) else { return nil }
        return Scope(type: "search", key: searchState.active, libraryID: 0, title: s["name"] as? String ?? "", query: s["query"] as? String ?? "")
    }

    var scopeJSON: Any {
        guard let s = searchScope else { return NSNull() }
        var json: [String: Any] = ["type": s.type, "key": s.key, "libraryID": s.libraryID, "title": s.title]
        if s.type == "search" { json["query"] = s.query }
        return json
    }

    // An answer's scope as ZoteroSearch.qml's scopeId names it ("" for none).
    static func scopeId(_ scope: [String: Any]?) -> String {
        guard let scope else { return "" }
        let type = scope["type"] as? String ?? scope["kind"] as? String ?? "collection"
        return "\(type):\(scope["key"] ?? ""):\(scope["libraryID"] ?? 1)"
    }

    // Whether an answer belongs to where you are now (a level you left answers late).
    func answerFitsHere(_ answer: [String: Any]) -> Bool {
        Self.scopeId(answer["scope"] as? [String: Any]) == (searchScope?.id ?? "")
    }

    // The scope's paper count, as last known (the context bar shows it while you type).
    func noteScopeTotal(_ answer: [String: Any]) {
        guard let scope = answer["scope"] as? [String: Any] else { scopeTotal = ""; return }
        let n = scope["itemCount"] ?? (scope["kind"] as? String == "tag" ? scope["count"] : nil) ?? (String(describing: answer["query"] ?? "").trimmingCharacters(in: .whitespaces).isEmpty ? answer["total"] : nil)
        if let n = n as? Int { scopeTotal = n == 1 ? "1 paper" : "\(n) papers" }
    }
}
