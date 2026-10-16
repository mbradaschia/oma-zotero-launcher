import XCTest
@testable import ZoteroLauncher

// The runner reads the PDFs where Zotero keeps them (an external drive, Documents, a network volume), as a child of
// the app: without these strings macOS refuses it silently ("Operation not permitted") instead of asking you once.
final class PrivacyStringsTests: XCTestCase {
    func testTheAppSaysWhyItReadsYourFiles() {
        for key in ["NSRemovableVolumesUsageDescription", "NSNetworkVolumesUsageDescription", "NSDocumentsFolderUsageDescription",
                    "NSDesktopFolderUsageDescription", "NSDownloadsFolderUsageDescription"] {
            let text = Bundle.main.object(forInfoDictionaryKey: key) as? String ?? ""
            XCTAssertTrue(text.contains("PDF"), "\(key): \(text)")
        }
    }
}
