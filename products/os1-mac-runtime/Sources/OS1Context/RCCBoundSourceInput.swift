import Foundation

/// Pure identifiers for sources already carried by the owner's typed handoff.
/// An identifier establishes neither filesystem availability nor factual truth.
/// Only the native source loader may acquire and verify the referenced bytes.
public enum RCCBoundSourceInput {
    public static let prefix = "os1-source:"
    public static let maximumReferences = 128

    public enum Failure: Error, Equatable {
        case invalidReference
        case conflictingReference
        case tooManyReferences
        case unknownSelection
    }

    /// Stable opaque identity, not a path or a lookup instruction.
    public static func id(reference: SourceReference) throws -> String {
        guard reference.sha256.utf8.count == 64,
              reference.sha256.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            throw Failure.invalidReference
        }
        return prefix + reference.kind.rawValue + ":" + reference.id.uuidString.lowercased() + ":" + reference.sha256
    }

    /// Normalize the complete task graph before considering the primary. A
    /// legacy primary remains valid unless it is represented only by retired
    /// task records. Raw prose/provenance fields never create references.
    public static func references(context: String?) throws -> [SourceReference] {
        let handoff = try SessionHandoff.decode(context)
        // Supersession edges belong to TaskSource.id, not SourceReference.id.
        // Keep the full graph until retirement is known; filtering records
        // first could erase an edge and resurrect an obsolete primary.
        let sources = handoff.taskContext?.sources ?? []
        let retiredTaskIDs = Set(sources.compactMap(\.supersedes))
        let activeSources = sources.filter { !retiredTaskIDs.contains($0.id) }
        func exactIdentity(_ reference: SourceReference) -> String {
            reference.kind.rawValue + ":" + reference.id.uuidString.lowercased() + ":" + reference.sha256
        }
        let activeRefIDs = Set(activeSources.compactMap(\.reference).map(exactIdentity))
        let retiredRefIDs = Set(sources.filter { retiredTaskIDs.contains($0.id) }.compactMap(\.reference).map(exactIdentity))
        var result: [SourceReference] = []
        var identities: [String: String] = [:]
        func append(_ reference: SourceReference) throws {
            let opaque = try id(reference: reference)
            let identity = reference.kind.rawValue + ":" + reference.id.uuidString.lowercased()
            if let existing = identities[identity] {
                guard existing == reference.sha256 else { throw Failure.conflictingReference }
                return
            }
            guard result.count < maximumReferences else { throw Failure.tooManyReferences }
            identities[identity] = reference.sha256
            // Validate before adopting, even when callers need the reference
            // rather than its opaque serialization.
            guard opaque.utf8.count <= 1_024 else { throw Failure.invalidReference }
            result.append(reference)
        }
        if let primary = handoff.source {
            let identity = exactIdentity(primary)
            if !retiredRefIDs.contains(identity) || activeRefIDs.contains(identity) { try append(primary) }
        }
        for source in activeSources {
            if let reference = source.reference { try append(reference) }
        }
        return result
    }

    public static func materialRefs(context: String?) throws -> [String] {
        try references(context: context).map { try id(reference: $0) }
    }

    /// Only exact reserved IDs present in this same handoff may be selected.
    /// Ordinary image/material refs remain somebody else's input modality.
    public static func selected(context: String?, contextRefs: [String]) throws -> [SourceReference] {
        guard contextRefs.count <= maximumReferences else { throw Failure.tooManyReferences }
        let available = try references(context: context)
        var byID: [String: SourceReference] = [:]
        for reference in available { byID[try id(reference: reference)] = reference }
        var result: [SourceReference] = []
        var seen = Set<String>()
        for identifier in contextRefs where identifier.hasPrefix(prefix) {
            guard let reference = byID[identifier] else { throw Failure.unknownSelection }
            if seen.insert(identifier).inserted { result.append(reference) }
        }
        return result
    }
}
