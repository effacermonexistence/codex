import CryptoKit
import Darwin
import Foundation

/// A pre-admission optimization only. The runtime still acquires and holds
/// its source lease before dispatch, including after this advisory probe.
public enum SourceWriteAdmission {
    public enum Access: Equatable, Sendable { case shared, exclusive }
    public enum Availability: Equatable, Sendable { case available, busy, unknown }

    public static func lockURL(root: String, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        let canonical = LocalProjectWorkspace.executionPath(root)
        let digest = SHA256.hash(data: Data(canonical.utf8)).map { String(format: "%02x", $0) }.joined()
        return home.appendingPathComponent(".os1/self-update/source-write-" + digest.prefix(16) + ".lock")
    }

    /// Do not search stale copies or infer a live root from a touched index.
    /// A successful installation of the currently installed build supplies
    /// its exact root; that root must still be a registered source checkout.
    public static func currentRoot(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> String? {
        let installed = SelfUpdate.installedBuild(home: home)
        guard installed > 0,
              let outcome = SelfUpdate.outcomes(home: home).last(where: { $0.success && $0.intent.build == installed }) else { return nil }
        let root = LocalProjectWorkspace.executionPath(outcome.intent.sourceRoot)
        let registered = LocalProjectWorkspace.candidates(projectID: "os1-clodex", home: home).map(LocalProjectWorkspace.executionPath)
        guard registered.contains(root), LocalProjectWorkspace.root(containing: root, projectID: "os1-clodex") == root else { return nil }
        return root
    }

    /// Which lock mode the known request will need. Unknown source identity
    /// does not invent a queue hold; normal runtime resolution remains active.
    public static func access(request: String, workspace: String, projectID: String?, writeScope: Bool,
                              root: String?, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> Access? {
        guard writeScope, let root else { return nil }
        let folder = LocalProjectWorkspace.executionPath(workspace)
        let canonicalRoot = LocalProjectWorkspace.executionPath(root)
        if folder == canonicalRoot || folder.hasPrefix(canonicalRoot + "/") { return .exclusive }
        let namedProjectID = PreparationIntent.detect(request)?.projectID
        if projectID == "os1-clodex" || namedProjectID == "os1-clodex" { return .exclusive }
        // A real non-OS1 project suppresses OS-1 inference, not the HOME
        // containment guard. Never invent a narrower backend workspace from
        // a project label; only the runtime can resolve that actual target.
        let otherProject = namedProjectID != nil || projectID.map({ ProjectAdapterRegistry.kind(for: $0) != nil }) == true
        if !otherProject {
            let inferred = OS1SelfReference.infer(request: request, projectless: OS1SelfReference.isProjectless(folder, home: home),
                os1Roots: [canonicalRoot], home: home)
            if inferred.bound { return .exclusive }
        }
        // Preserve HOME's source guard. A sibling project outside this tree
        // does not contain the live source and therefore needs no lease.
        return canonicalRoot.hasPrefix(folder == "/" ? "/" : folder + "/") ? .shared : nil
    }

    /// Whether a request needing `access` is parked in the app behind an
    /// admitted OS-1 writer or an announced writer intent. OS-1 writers still
    /// wait for each other here. A HOME request needing shared access that
    /// can run on Claude (`confinable`: not pinned to Codex, Claude capacity
    /// left) is admitted (build 320) and its runtime decides: a Claude attempt
    /// runs confined from OS-1's live source (`OS1SourceConfinement`) with no
    /// lease, beside a repair; an "auto" attempt routed to Codex is re-routed
    /// to Claude rather than wait. Parking those kept them waiting for nothing
    /// ("왜 병렬로 실행이 안 되는데"). A request that can only run on Codex
    /// would only wait for the repair inside the runtime, holding a run slot
    /// that another task could use, so it stays parked here, as before.
    public static func parksBehindSourceWriter(_ access: Access, confinable: Bool) -> Bool {
        access == .exclusive || !confinable
    }

    /// Observe ownership, never a file's age/existence. Open only an existing
    /// regular lock file, never create, truncate, replace or remove one.
    public static func probe(at url: URL, access: Access) -> Availability {
        let descriptor = open(url.path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        guard descriptor >= 0 else { return errno == ENOENT ? .available : .unknown }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG else { return .unknown }
        guard flock(descriptor, (access == .shared ? LOCK_SH : LOCK_EX) | LOCK_NB) == 0 else {
            return errno == EWOULDBLOCK || errno == EAGAIN ? .busy : .unknown
        }
        _ = flock(descriptor, LOCK_UN)
        return .available
    }

    public static func availability(root: String, access: Access,
                                    home: URL = FileManager.default.homeDirectoryForCurrentUser) -> Availability {
        let lock = lockURL(root: root, home: home)
        // An exclusive writer announces intent before waiting for existing
        // HOME readers to leave. A second writer parks here; the runtime's
        // shared lease does the same for an unconfined (Codex) HOME reader, so
        // a stream of new shared holders still cannot starve that repair.
        let intent = probe(at: lock.appendingPathExtension("writer-intent"), access: .shared)
        guard intent == .available else { return intent }
        return probe(at: lock, access: access)
    }

    /// Distinguish an exclusive repair waiting for existing readers from a
    /// repair already owning/awaiting the lock. One admitted repair must be
    /// able to announce writer-intent; parking every writer here would let
    /// a continuous stream of HOME readers starve it before runtime starts.
    public static func heldOnlyByReaders(root: String,
                                         home: URL = FileManager.default.homeDirectoryForCurrentUser) -> Bool {
        let lock = lockURL(root: root, home: home)
        return probe(at: lock.appendingPathExtension("writer-intent"), access: .shared) == .available &&
            probe(at: lock, access: .shared) == .available && probe(at: lock, access: .exclusive) == .busy
    }
}
