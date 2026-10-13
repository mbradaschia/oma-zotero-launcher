import CoreServices
import Foundation

// Changes under a folder, as FSEvents reports them (writers replace files by rename, which a
// descriptor watch on a file would lose). The callback comes on the main queue, a moment after a
// burst of changes.
final class FolderWatcher {
    private var stream: FSEventStreamRef?
    private let callback: () -> Void

    init?(_ folder: URL, latency: TimeInterval = 1, callback: @escaping () -> Void) {
        self.callback = callback
        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil)
        let handler: FSEventStreamCallback = { _, info, _, _, _, _ in
            guard let info else { return }
            Unmanaged<FolderWatcher>.fromOpaque(info).takeUnretainedValue().callback()
        }
        guard let stream = FSEventStreamCreate(nil, handler, &context, [folder.path] as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow), latency,
                                               FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer))
        else { return nil }
        self.stream = stream
        FSEventStreamSetDispatchQueue(stream, .main)
        FSEventStreamStart(stream)
    }

    deinit {
        if let stream {
            FSEventStreamStop(stream)
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
        }
    }
}
