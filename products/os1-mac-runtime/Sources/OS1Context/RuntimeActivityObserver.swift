import Foundation
import Dispatch
import Darwin

/// Observe the private directory, not the activity inode: emit uses atomic
/// replacement. Public output is relayed on filesystem events, not after a
/// polling interval or subprocess exit. This has no execution/adoption authority.
public final class RuntimeActivityObserver: @unchecked Sendable {
    private let queue = DispatchQueue(label: "os1.public-activity-relay", qos: .userInitiated)
    private let url: URL
    private let receive: @Sendable (RuntimeActivity) -> Void
    private var last: RuntimeActivity?
    private var source: DispatchSourceFileSystemObject?

    public init(url: URL, receive: @escaping @Sendable (RuntimeActivity) -> Void) {
        self.url = url; self.receive = receive
    }
    public func start() -> Bool {
        let fd = open(url.deletingLastPathComponent().path, O_EVTONLY | O_CLOEXEC)
        guard fd >= 0 else { return false }
        let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .rename, .delete], queue: queue)
        source.setEventHandler { [weak self] in self?.readLatest() }
        source.setCancelHandler { close(fd) }
        self.source = source
        source.resume()
        queue.sync { readLatest() }
        return true
    }
    public func finish() {
        // Drain the last atomic replacement even if process exit and its event
        // race. Serial reads deduplicate by the complete event, including time.
        queue.sync { readLatest() }
        source?.cancel(); source = nil
    }
    private func readLatest() {
        guard let data = try? Data(contentsOf: url), data.count <= 150_000,
              let activity = try? JSONDecoder().decode(RuntimeActivity.self, from: data), activity != last else { return }
        last = activity; receive(activity)
    }
}
