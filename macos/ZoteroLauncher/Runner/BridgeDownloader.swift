import CryptoKit
import Foundation

// Something that gets a URL's bytes (URLSession here; the tests answer for it).
@MainActor
protocol Fetcher: AnyObject {
    func fetch(_ url: URL, completion: @escaping @MainActor (Result<Data, Error>) -> Void)
}

final class URLSessionFetcher: Fetcher {
    func fetch(_ url: URL, completion: @escaping @MainActor (Result<Data, Error>) -> Void) {
        var request = URLRequest(url: url, timeoutInterval: 30)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: request) { data, response, error in
            let result: Result<Data, Error>
            if let error { result = .failure(error) } else if let code = (response as? HTTPURLResponse)?.statusCode, !(200..<300).contains(code) {
                result = .failure(BridgeDownloader.Failure("HTTP \(code)"))
            } else { result = .success(data ?? Data()) }
            DispatchQueue.main.async { MainActor.assumeIsolated { completion(result) } }
        }.resume()
    }
}

// The Zotero plugin (the bridge) for a Mac, as scripts/install-bridge.sh gets it on Omarchy (which
// needs jq, sha256sum, wl-copy): this repository's newest vX.Y.Z release that has an .xpi (not the
// Mac app's macos-v* releases), downloaded to Downloads and checked against its .sha256. Zotero
// installs it from its own window; nothing here touches the Zotero profile.
@MainActor
final class BridgeDownloader {
    struct Failure: Error, CustomStringConvertible {
        let description: String
        init(_ d: String) { description = d }
    }

    static let repo = "mbradaschia/zotero-companion-launcher"
    let fetcher: Fetcher
    let downloads: URL

    init(fetcher: Fetcher, downloads: URL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Downloads")) {
        self.fetcher = fetcher
        self.downloads = downloads
    }

    // The release's .xpi and its checksum's URLs, from GitHub's list of releases: the version this
    // app expects (its bundled manifest's) when it is there, else the newest. Only github.com's
    // https links, and only a release that has its .sha256.
    static func pick(_ releases: Any, expected: String? = RunnerKit.bundledBridgeVersion) -> (xpi: URL, sha: URL)? {
        guard let list = releases as? [[String: Any]] else { return nil }
        var found: [(tag: String, xpi: URL, sha: URL)] = []
        for r in list {
            guard let tag = r["tag_name"] as? String, tag.range(of: #"^v[0-9]"#, options: .regularExpression) != nil,
                  r["draft"] as? Bool != true, r["prerelease"] as? Bool != true else { continue }
            let assets = (r["assets"] as? [[String: Any]] ?? []).compactMap { a -> (String, URL)? in
                guard let name = a["name"] as? String, let s = a["browser_download_url"] as? String, let u = URL(string: s),
                      u.scheme == "https", u.host == "github.com" else { return nil }
                return (name, u)
            }
            guard let xpi = assets.first(where: { $0.0.hasSuffix(".xpi") })?.1, let sha = assets.first(where: { $0.0.hasSuffix(".xpi.sha256") })?.1 else { continue }
            found.append((tag, xpi, sha))
        }
        let pick = found.first { expected != nil && $0.tag == "v" + (expected ?? "") } ?? found.first
        return pick.map { ($0.xpi, $0.sha) }
    }

    // → the saved file, or why not.
    func download(completion: @escaping @MainActor (Result<URL, Failure>) -> Void) {
        let list = URL(string: "https://api.github.com/repos/\(Self.repo)/releases?per_page=30")!
        fetcher.fetch(list) { [self] result in
            guard case .success(let data) = result, let json = try? JSONSerialization.jsonObject(with: data) else {
                return completion(.failure(Failure("can't reach GitHub's releases for \(Self.repo)")))
            }
            guard let pick = Self.pick(json) else { return completion(.failure(Failure("no release of the bridge (a vX.Y.Z release with an .xpi and its .sha256) in \(Self.repo)"))) }
            fetcher.fetch(pick.xpi) { [self] got in
                guard case .success(let xpi) = got, !xpi.isEmpty else { return completion(.failure(Failure("the download failed"))) }
                fetcher.fetch(pick.sha) { [self] sum in
                    let want = (try? sum.get()).map { String(decoding: $0, as: UTF8.self).split(whereSeparator: \.isWhitespace).first.map(String.init) ?? "" } ?? ""
                    let have = SHA256.hash(data: xpi).map { String(format: "%02x", $0) }.joined()
                    guard !want.isEmpty, want.lowercased() == have else { return completion(.failure(Failure("the download doesn't match its SHA-256: not installing it"))) }
                    completion(save(xpi, pick.xpi))
                }
            }
        }
    }

    private func save(_ data: Data, _ from: URL) -> Result<URL, Failure> {
        let name = from.lastPathComponent
        guard name.hasSuffix(".xpi"), !name.hasPrefix("."), !name.contains("/") else { return .failure(Failure("the release's file has an odd name")) }
        do {
            try FileManager.default.createDirectory(at: downloads, withIntermediateDirectories: true)
            let out = downloads.appendingPathComponent(name)
            try data.write(to: out, options: .atomic)
            return .success(out)
        } catch {
            return .failure(Failure("couldn't save it: \(error.localizedDescription)"))
        }
    }
}
