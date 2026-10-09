import Foundation
import CryptoKit

/// An intermediate candidate may use a cheaper route; this is not a quality
/// certificate or authority to complete the parent objective.
public struct GovernedDelegation: Codable, Equatable, Sendable {
    public enum Role: String, Codable, Sendable { case planner, worker }
    public enum Scope: String, Codable, Sendable {
        case readOnly = "read_only"
        case isolatedWorkspaceWrite = "isolated_workspace_write"
    }
    public var role: Role
    public var scope: Scope
    public var parentTask: String
    public var parentObjectiveSHA256: String
    public var requiresParentVerification: Bool
    public init(role: Role, scope: Scope, parentTask: String, parentObjectiveSHA256: String,
                requiresParentVerification: Bool = true) {
        self.role = role; self.scope = scope; self.parentTask = parentTask
        self.parentObjectiveSHA256 = parentObjectiveSHA256
        self.requiresParentVerification = requiresParentVerification
    }
    enum CodingKeys: String, CodingKey {
        case role, scope
        case parentTask = "parent_task"
        case parentObjectiveSHA256 = "parent_objective_sha256"
        case requiresParentVerification = "requires_parent_verification"
    }
    public func validate() throws {
        guard requiresParentVerification, !parentTask.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              parentTask.utf8.count <= 24_000,
              parentObjectiveSHA256 == TaskQualityEvidence.digest(Data(parentTask.utf8)),
              role != .planner || scope == .readOnly else {
            throw ValidationError.invalid
        }
    }
    public enum ValidationError: Error { case invalid }
    public init(from decoder: Decoder) throws {
        struct AnyKey: CodingKey {
            var stringValue: String; var intValue: Int? { nil }
            init?(stringValue: String) { self.stringValue = stringValue }
            init?(intValue: Int) { return nil }
        }
        let keys = try decoder.container(keyedBy: AnyKey.self).allKeys.map(\.stringValue)
        guard Set(keys) == Set(["role", "scope", "parent_task", "parent_objective_sha256", "requires_parent_verification"]) else {
            throw ValidationError.invalid
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(role: try c.decode(Role.self, forKey: .role), scope: try c.decode(Scope.self, forKey: .scope),
                  parentTask: try c.decode(String.self, forKey: .parentTask),
                  parentObjectiveSHA256: try c.decode(String.self, forKey: .parentObjectiveSHA256),
                  requiresParentVerification: try c.decode(Bool.self, forKey: .requiresParentVerification))
        try validate()
    }
}
