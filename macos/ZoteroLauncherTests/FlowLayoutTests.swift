import SwiftUI
import XCTest
@testable import ZoteroLauncher

// A paper's pills (its taxonomy strip, the footer's) wrap onto more lines instead of running past the panel.
final class FlowLayoutTests: XCTestCase {
    func testEverythingOnOneLineWhenItFits() {
        XCTAssertEqual(FlowLayout.lines(widths: [40, 50, 60], maxWidth: 200, spacing: 6), [[0, 1, 2]])
    }

    func testANewLineWhenTheNextOneDoesNotFit() {
        // 40 + 6 + 50 = 96; + 6 + 60 = 162 > 120
        XCTAssertEqual(FlowLayout.lines(widths: [40, 50, 60, 30], maxWidth: 120, spacing: 6), [[0, 1], [2, 3]])
    }

    func testTheSpacingCounts() {
        // 60 + 6 + 60 = 126 > 120, though the widths alone are 120
        XCTAssertEqual(FlowLayout.lines(widths: [60, 60], maxWidth: 120, spacing: 6), [[0], [1]])
        XCTAssertEqual(FlowLayout.lines(widths: [57, 57], maxWidth: 120, spacing: 6), [[0, 1]])
    }

    func testAnItemWiderThanTheLineGetsOneOfItsOwn() {
        XCTAssertEqual(FlowLayout.lines(widths: [30, 300, 30], maxWidth: 100, spacing: 6), [[0], [1], [2]])
    }

    func testNoWidthIsOneLine() {
        XCTAssertEqual(FlowLayout.lines(widths: [400, 400], maxWidth: .infinity, spacing: 6), [[0, 1]])
        XCTAssertEqual(FlowLayout.lines(widths: [], maxWidth: 100, spacing: 6), [])
    }
}

// The strip itself, drawn at the launcher's width: a paper with many labels takes more lines, none cut off.
@MainActor
final class TaxonomyStripWrapTests: XCTestCase {
    func testManyLabelsWrapOntoMoreLines() throws {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent("strip-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: home) }
        let model = LauncherModel(bridge: FakeBridge(), desktop: FakeDesktop(), env: ["HOME": home.path, "hostname": "mac"], runner: FakeRunner(), fetcher: FakeFetcher())
        let width = LauncherPanel.size.width
        func height(_ items: [[String: Any]]) -> (CGFloat, NSHostingView<AnyView>) {
            let view = NSHostingView(rootView: AnyView(TaxonomyStrip(model: model, strip: ["note": "out of date: Methods"], items: items).frame(width: width).background(Color(nsColor: .windowBackgroundColor))))
            view.frame = NSRect(x: 0, y: 0, width: width, height: 10)
            return (view.fittingSize.height, view)
        }
        let one = height([["name": "Method", "prefix": "m/", "labels": ["Survey"]]]).0
        let many: [[String: Any]] = [
            ["name": "Method", "prefix": "m/", "labels": ["Survey", "Case study", "Experiment", "Archival data", "Interviews"]],
            ["name": "Theory", "prefix": "t/", "labels": ["Institutional theory", "Resource-based view", "Agency theory", "Stakeholder theory"]],
            ["name": "Field", "prefix": "f/", "labels": ["Strategy", "Organization studies", "Entrepreneurship", "Innovation"]],
        ]
        let (tall, view) = height(many)
        XCTAssertGreaterThan(tall, one * 1.8, "the labels should wrap onto a second line, not run past the panel")
        if let dir = ProcessInfo.processInfo.environment["SNAPSHOT_DIR"] {
            view.frame = NSRect(x: 0, y: 0, width: width, height: tall)
            view.layoutSubtreeIfNeeded()
            let rep = try XCTUnwrap(view.bitmapImageRepForCachingDisplay(in: view.bounds))
            view.cacheDisplay(in: view.bounds, to: rep)
            try XCTUnwrap(rep.representation(using: .png, properties: [:])).write(to: URL(fileURLWithPath: dir).appendingPathComponent("17-taxonomy-strip.png"))
        }
    }
}
