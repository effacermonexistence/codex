import Foundation

/// A backup run's object key locates bytes; it is not their content identity.
public struct ResearchBundleIdentity: Equatable, Sendable {
    public let repository: String
    public let commit: String
    public let key: String
    public let digest: String
    public let size: Int?
    public static let maximumBytes = 20_000_000

    public init(repository: String, commit: String, key: String, digest: String, size: Int? = nil) throws {
        guard repository.range(of: #"^[A-Za-z0-9_-][A-Za-z0-9_.-]*$"#, options: .regularExpression) != nil,
              commit.range(of: #"^[0-9a-f]{40}$"#, options: .regularExpression) != nil,
              digest.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil,
              key.hasPrefix("git-bundles/effacermonexistence/\(repository)/\(commit)/"),
              key.hasSuffix(".bundle"),
              key.range(of: #"^[A-Za-z0-9_./-]+$"#, options: .regularExpression) != nil,
              !key.split(separator: "/").contains(".."),
              size.map({ $0 > 0 && $0 <= Self.maximumBytes }) ?? true else {
            throw CocoaError(.fileReadCorruptFile)
        }
        self.repository = repository; self.commit = commit; self.key = key
        self.digest = digest; self.size = size
    }

    public func sameContent(as other: Self) -> Bool {
        repository == other.repository && commit == other.commit && digest == other.digest
            && (size == nil || other.size == nil || size == other.size)
    }

    public func accepts(byteCount: Int, sha256: String) -> Bool {
        byteCount > 0 && byteCount <= Self.maximumBytes && (size == nil || size == byteCount) && sha256 == digest
    }
}
