import XCTest
@testable import ZoteroLauncher

// The keystroke budget (macos/PLAN.md phase 10): a search's answer turned into the list, at the most results a
// search returns (General › Results per search: 200), well under 10 ms of the app's own work. Made-up papers.
@MainActor
final class PerformanceTests: XCTestCase {
    private func answer(_ n: Int) -> [String: Any] {
        var a = Fixture.bridge("search-typed")
        let one = (a["results"] as? [[String: Any]])?.first ?? [:]
        a["results"] = (0..<n).map { i -> [String: Any] in
            var r = one
            r["key"] = String(format: "K%07d", i)
            r["title"] = "A made-up paper on resource orchestration, number \(i)"
            r["titleRanges"] = [[0, 6]]
            return r
        }
        a["total"] = n
        return a
    }

    func testTwoHundredResultsBecomeTheListWellInsideTheBudget() throws {
        let core = try JSCore()
        let response = answer(200)
        _ = try core.glue("results", [response, "#7aa2f7", ["have": LauncherModel.goToPlaces], NSNull(), NSNull(), NSNull()], as: [SearchRow].self) // (warm)
        let runs = 20
        let start = Date()
        for _ in 0..<runs {
            let rows = try core.glue("results", [response, "#7aa2f7", ["have": LauncherModel.goToPlaces], NSNull(), NSNull(), NSNull()], as: [SearchRow].self)
            XCTAssertGreaterThanOrEqual(rows.count, 200)
        }
        let each = Date().timeIntervalSince(start) / Double(runs)
        // where it goes: JavaScriptCore (JSON in, the rows, JSON out), then Swift's decoding
        let t0 = Date()
        var json = ""
        for _ in 0..<runs { json = try core.glueJSON("results", [response, "#7aa2f7", ["have": LauncherModel.goToPlaces], NSNull(), NSNull(), NSNull()]) }
        let js = Date().timeIntervalSince(t0) / Double(runs)
        let t1 = Date()
        for _ in 0..<runs { _ = try JSONDecoder().decode([SearchRow].self, from: Data(json.utf8)) }
        let decode = Date().timeIntervalSince(t1) / Double(runs)
        let t2 = Date()
        for _ in 0..<runs { _ = try JSONSerialization.data(withJSONObject: response) }
        let encode = Date().timeIntervalSince(t2) / Double(runs)
        print("split: js \(Int(js * 1000)) ms, decode \(Int(decode * 1000)) ms, encode-in \(Int(encode * 1000)) ms, json \(json.utf8.count / 1024) KB")
        print("results: \(Int(each * 1000)) ms each for 200")
        // The budget is 10 ms in the Release build; the tests run the Debug one on a shared CI machine, so the check has
        // a margin (about 5 ms here in Debug).
        XCTAssertLessThan(each, 0.025, "200 results took \(Int(each * 1000)) ms (the budget: 10 ms in Release)")
    }
}
