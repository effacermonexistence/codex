import Foundation
import OS1Context

func runResearchBundleFixtures() throws {
    let repo = "orthogonal-projection-term-benchmarks"
    let commit = String(repeating: "a", count: 40), digest = String(repeating: "b", count: 64)
    func make(_ run: String, sha: String? = nil, hash: String? = nil, size: Int? = nil) throws -> ResearchBundleIdentity {
        let sha = sha ?? commit
        return try .init(repository: repo, commit: sha,
            key: "git-bundles/effacermonexistence/\(repo)/\(sha)/\(run).bundle", digest: hash ?? digest, size: size)
    }
    let pinned = try make("old"), latest = try make("new", size: 532387)
    precondition(pinned.sameContent(as: latest))
    let advanced = try make("new", sha: String(repeating: "c", count: 40))
    let changed = try make("new", hash: String(repeating: "d", count: 64))
    let resized = try make("new", size: 532388)
    precondition(!pinned.sameContent(as: advanced))
    precondition(!pinned.sameContent(as: changed))
    precondition(!latest.sameContent(as: resized))
    precondition(latest.accepts(byteCount: 532387, sha256: digest))
    precondition(!latest.accepts(byteCount: 532388, sha256: digest))
    precondition(!pinned.accepts(byteCount: 0, sha256: digest))
    precondition(!pinned.accepts(byteCount: 20_000_001, sha256: digest))
    precondition(!pinned.accepts(byteCount: 532387, sha256: "wrong"))
    for key in [latest.key.replacingOccurrences(of: repo, with: "wrong-repo"),
                latest.key.replacingOccurrences(of: commit, with: String(repeating: "c", count: 40)),
                latest.key.replacingOccurrences(of: "new.bundle", with: "../new.bundle"), latest.key + "?token=x"] {
        do { _ = try ResearchBundleIdentity(repository: repo, commit: commit, key: key, digest: digest)
            fatalError("Invalid bundle identity accepted")
        } catch {}
    }
    for size in [-1, 0, 20_000_001] {
        do { _ = try make("new", size: size); fatalError("Invalid size accepted") } catch {}
    }
    print("OS-1 research bundle identity: 16 fixtures passed")
}
