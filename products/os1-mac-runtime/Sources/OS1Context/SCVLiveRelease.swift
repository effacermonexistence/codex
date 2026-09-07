import Foundation

/// Live identity is a read-only observation, never an authorization to deploy.
/// Neither branch recency nor a model's answer can replace these comparisons.
public struct SCVLiveRelease: Equatable, Sendable {
    public static let readinessURL = "https://scv-dm-cloud-survival-production.up.railway.app/readyz"
    public let id: String
    public let version: Int
    public let fingerprint: String
    public let manifestSHA256: String
    public let verifiedAt: Date

    public init(data: Data, now: Date = Date()) throws {
        guard data.count <= 256_000,
              let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              body["ok"] as? Bool == true,
              let release = body["release"] as? [String: Any], release["ok"] as? Bool == true,
              release["mode"] as? String == "production", release["release_phase"] as? String == "active",
              release["phase_ready"] as? Bool == true,
              let id = release["release_id"] as? String,
              id.range(of: #"^scv-instagram-single-[0-9]{8}-v[0-9]{1,6}$"#, options: .regularExpression) != nil,
              let version = id.split(separator: "v").last.flatMap({ Int($0) }),
              let fingerprint = release["content_fingerprint_sha256"] as? String,
              let manifest = release["release_manifest_sha256"] as? String,
              ProjectMaterialObject.validSHA(fingerprint), ProjectMaterialObject.validSHA(manifest) else {
            throw ProjectMaterialError.invalidManifest
        }
        self.id = id; self.version = version; self.fingerprint = fingerprint
        self.manifestSHA256 = manifest; verifiedAt = now
    }

    public func matches(custody: String, record: TaskContext.BaselineRecord) -> Bool {
        func cell(_ field: String) -> String? {
            SCVCustodyRecord.firstCapture("(?m)^\\|\\s*" + NSRegularExpression.escapedPattern(for: field) +
                "\\s*\\|\\s*`([a-f0-9]{64})`", in: custody)
        }
        return record.id == id && cell("content fingerprint") == fingerprint &&
            cell("release manifest sha256") == manifestSHA256
    }

    public func verifyManifest(_ data: Data) throws {
        guard ProjectMaterialObject.digest(data) == manifestSHA256,
              let manifest = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              manifest["release_id"] as? String == id else { throw ProjectMaterialError.invalidArtifact }
    }

    public func verifiedRecord(from record: TaskContext.BaselineRecord) -> TaskContext.BaselineRecord {
        var value = record; value.verifiedAt = verifiedAt; return value
    }
}
