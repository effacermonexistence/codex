import CryptoKit
import Foundation

/// Acquisition is a deliverable distinct from permission to edit/deploy/restore.
public struct ProjectMaterialIntent: Equatable, Sendable {
    public let requiresTransformation: Bool

    public static func scv(_ prompt: String) -> Self? {
        let value = prompt.precomposedStringWithCanonicalMapping.lowercased()
        guard ["인스타", "instagram", "scv"].contains(where: value.contains),
              ["자료", "데이터", "소스", "파일", "원문", "코드", "materials", "source", "data"].contains(where: value.contains) ||
                (value.contains("데이트") && ["오토매이션", "오토메이션", "자동화", "automation"].contains(where: value.contains)),
              ["가져", "불러", "꺼내", "fetch", "retrieve", "gather", "download"].contains(where: value.contains) else { return nil }
        // Do not turn source text, another service selection or a refusal into
        // a private R2 operation. Unhandled requests retain normal execution.
        guard !["가져오지", "불러오지", "꺼내지", "do not", "don't", "never ",
                "로컬에서", "로컬만", "로컬 파일", "local only", "local files", "github에서", "기타브에서", "기탑에서", "from github", "from s3",
                "실제 고객 데이터", "고객 대화", "고객 예약 데이터", "customer data", "customer records",
                "구글", "google drive", "dropbox", "s3에서", "복원", "restore", "rollback", "되돌려",
                "연결 기능", "조회 기능", "검색 기능", "가져오기 기능", "가져오는 로직", "fetch feature"]
            .contains(where: value.contains) else { return nil }
        if ["번역", "translate", "비판", "critique", "프롬프트", "prompt"].contains(where: value.contains),
           ["\"", "“", "`", "'"].contains(where: value.contains) { return nil }
        // “수정 좀 보자, 자료 다 가져와” is preparation, not “fetch and edit”.
        var operation = value
        for preparation in ["수정 좀 보자", "수정좀 보자", "수정할 건데", "수정하려고", "수정 준비", "수정 좀 하려고"] {
            operation = operation.replacingOccurrences(of: preparation, with: "")
        }
        let transform = ["분석", "설명", "요약", "비교", "수정", "고쳐", "구현", "분류", "정리", "번역",
                         "analyze", "explain", "summarize", "compare", "edit", "implement", "fix"]
            .contains(where: operation.contains)
        return Self(requiresTransformation: transform)
    }
}

public enum ProjectMaterialError: LocalizedError {
    case invalidIdentity, invalidArtifact, invalidManifest
    public var errorDescription: String? {
        switch self {
        case .invalidIdentity: return "프로젝트 자료의 출처 또는 접근 범위가 일치하지 않습니다. 복원이나 모델 실행 없이 중단했습니다."
        case .invalidArtifact: return "프로젝트 자료의 파일 해시·크기 또는 압축파일 구성이 일치하지 않습니다. 검증되지 않은 자료를 채택하지 않았습니다."
        case .invalidManifest: return "프로젝트 자료 목록과 복구 기록이 일치하지 않습니다. 현재 배포 버전으로 추정하지 않았습니다."
        }
    }
}

public struct ProjectMaterialObject: Codable, Equatable, Sendable {
    public let name: String
    public let key: String
    public let sha256: String
    public let bytes: Int

    public func verify(_ data: Data) throws {
        guard data.count == bytes, Self.digest(data) == sha256 else { throw ProjectMaterialError.invalidArtifact }
    }
    public static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    public static func validKey(_ key: String) -> Bool {
        !key.hasPrefix("/") && !key.split(separator: "/").contains("..") &&
            key.range(of: #"^[A-Za-z0-9_./-]+$"#, options: .regularExpression) != nil
    }
    public static func validSHA(_ value: String, count: Int = 64) -> Bool {
        value.count == count && value.range(of: #"^[a-f0-9]+$"#, options: .regularExpression) != nil
    }
}

/// The current recovery pointer is not an active deployment or an approved
/// rollback command. Only the source/runtime and its release manifest are read.
public struct SCVProjectMaterials: Sendable {
    public static let repository = "effacermonexistence/codex"
    public static let pointerPath = "products/scv-instagram/recovery/LATEST.json"
    public static let verificationMode = "live-r2-project-source-package-v1"
    public static func isVerificationMode(_ mode: String?) -> Bool {
        mode == verificationMode || mode == RegisteredProjectSource.verificationMode
    }
    public let recoveryID: String
    public let capturedAt: String
    public let releaseID: String
    public let runtime: ProjectMaterialObject
    public let release: ProjectMaterialObject

    public static func pointer(_ data: Data) throws -> (id: String, object: ProjectMaterialObject) {
        guard data.count <= 64_000,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["private_bucket"] as? String == "omar-private-archive",
              let point = json["current_recovery_point"] as? [String: String],
              let id = point["recovery_point_id"], id.hasPrefix("scv-instagram-"),
              let key = point["key"], key.hasPrefix("scv-instagram-automation/recovery-points/"),
              key.hasSuffix("/SCV_RECOVERY_POINT.json"), ProjectMaterialObject.validKey(key),
              let digest = point["sha256"], ProjectMaterialObject.validSHA(digest) else { throw ProjectMaterialError.invalidManifest }
        // Pointer v1 does not carry a byte count: enforce a separate read bound
        // and digest before decoding the descriptor, not a fabricated length.
        return (id, ProjectMaterialObject(name: "recovery_descriptor", key: key, sha256: digest, bytes: 0))
    }

    public init(pointer: Data, descriptor: Data) throws {
        let identity = try Self.pointer(pointer)
        guard descriptor.count > 0, descriptor.count <= 64_000,
              ProjectMaterialObject.digest(descriptor) == identity.object.sha256,
              let json = try JSONSerialization.jsonObject(with: descriptor) as? [String: Any],
              (json["schema"] as? String)?.hasPrefix("scv-instagram-recovery-point-") == true,
              json["recovery_point_id"] as? String == identity.id,
              let captured = json["captured_at_utc"] as? String, ISO8601DateFormatter().date(from: captured) != nil,
              let release = json["release"] as? [String: String], let releaseID = release["release_id"],
              releaseID.hasPrefix("scv-instagram-"),
              let components = json["components"] as? [[String: Any]] else { throw ProjectMaterialError.invalidManifest }
        func component(_ name: String) throws -> ProjectMaterialObject {
            let matches = components.filter { $0["name"] as? String == name }
            guard matches.count == 1, let item = matches.first,
                  let key = item["key"] as? String, ProjectMaterialObject.validKey(key),
                  let digest = item["sha256"] as? String, ProjectMaterialObject.validSHA(digest),
                  let size = item["bytes"] as? Int, size > 0,
                  size <= (name == "runtime" ? 20_000_000 : 1_000_000) else { throw ProjectMaterialError.invalidManifest }
            let source = name == "runtime" && key.hasPrefix("scv-instagram-automation/release-ready/") && key.hasSuffix(".tar.gz")
            let manifest = name == "release_manifest" && key.hasPrefix("scv-instagram-automation/recovery-points/") && key.hasSuffix("/SCV_SINGLE_RELEASE.json")
            guard source || manifest else { throw ProjectMaterialError.invalidIdentity }
            return ProjectMaterialObject(name: name, key: key, sha256: digest, bytes: size)
        }
        self.recoveryID = identity.id; self.capturedAt = captured; self.releaseID = releaseID
        runtime = try component("runtime"); self.release = try component("release_manifest")
        guard self.release.sha256 == release["release_manifest_sha256"] else { throw ProjectMaterialError.invalidManifest }
    }

    public static func archiveInventory(_ text: String) throws -> [String] {
        let paths = text.split(separator: "\n").map(String.init)
        guard !paths.isEmpty, paths.count <= 10_000, Set(paths).count == paths.count,
              paths.allSatisfy({ ProjectMaterialObject.validKey($0) && !$0.hasPrefix("-") }),
              paths.contains("package.json"), paths.contains("SCV_SINGLE_RELEASE.json") else { throw ProjectMaterialError.invalidArtifact }
        return paths
    }

    /// Preparation selects bytes, not just a display label. An incomplete
    /// operating record cannot silently fall back to a different source.
    public func preparationArchive(operating: TaskContext.BaselineRecord?) throws -> ProjectMaterialObject {
        guard let operating else { return runtime }
        guard let key = operating.key, ProjectMaterialObject.validKey(key),
              key.hasPrefix("scv-instagram-automation/release-ready/"), key.hasSuffix(".tar.gz"),
              let digest = operating.sha256, ProjectMaterialObject.validSHA(digest),
              let bytes = operating.bytes, bytes > 0, bytes <= 20_000_000 else {
            throw ProjectMaterialError.invalidManifest
        }
        return ProjectMaterialObject(name: "runtime", key: key, sha256: digest, bytes: bytes)
    }

    public static func validSourceRecord(_ source: [String: String]) -> Bool {
        source["repository"] == repository && ProjectMaterialObject.validSHA(source["repository_sha"] ?? "", count: 40) &&
            source["pointer_path"] == pointerPath && ProjectMaterialObject.validSHA(source["descriptor_sha256"] ?? "") &&
            ProjectMaterialObject.validSHA(source["retrieved_content_sha256"] ?? "") &&
            ProjectMaterialObject.validSHA(source["bundle_sha256"] ?? "") &&
            (Int(source["object_size"] ?? "") ?? 0) > 0 &&
            (source["object_key"] ?? "").hasPrefix("scv-instagram-automation/release-ready/") &&
            ProjectMaterialObject.validKey(source["object_key"] ?? "") &&
            ProjectMaterialObject.validKey(source["source_path"] ?? "")
    }
}


/// The newest `docs/scv-instagram-v<N>-custody.md` on the trusted main
/// revision is the *recorded* operating release. Reading it is not a live
/// production check and never moves the recovery pointer.
public enum SCVCustodyRecord {
    static let fileNamePattern = #"^scv-instagram-v([0-9]+)-custody\.md$"#

    public static func version(ofFileName name: String) -> Int? {
        guard name.range(of: fileNamePattern, options: .regularExpression) != nil else { return nil }
        return Int(name.dropFirst("scv-instagram-v".count).prefix(while: \.isNumber))
    }

    static func firstCapture(_ pattern: String, in text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              match.numberOfRanges > 1, let range = Range(match.range(at: 1), in: text) else { return nil }
        return String(text[range])
    }

    static func backticked(_ value: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: "`([^`]+)`") else { return [] }
        return regex.matches(in: value, range: NSRange(value.startIndex..., in: value)).compactMap {
            Range($0.range(at: 1), in: value).map { String(value[$0]) }
        }
    }

    /// Parses the "Active release" table. Returns nil rather than a partial
    /// record when the release id is absent or malformed.
    public static func parse(_ markdown: String, path: String, commit: String) -> TaskContext.BaselineRecord? {
        guard markdown.utf8.count <= 400_000 else { return nil }
        func cell(_ field: String) -> String? {
            firstCapture("(?m)^\\|\\s*" + NSRegularExpression.escapedPattern(for: field) + "\\s*\\|\\s*(.+?)\\s*\\|\\s*$", in: markdown)
        }
        guard let releaseCell = cell("release id"), let releaseID = backticked(releaseCell).first,
              releaseID.hasPrefix("scv-instagram-"), releaseID.count <= 120,
              releaseID.range(of: #"^[A-Za-z0-9._-]+$"#, options: .regularExpression) != nil else { return nil }
        var record = TaskContext.BaselineRecord(id: releaseID)
        if let archiveCell = cell("runtime archive (R2)") {
            let ticks = backticked(archiveCell)
            if let key = ticks.first, ProjectMaterialObject.validKey(key), key.hasPrefix("scv-instagram-automation/") { record.key = key }
            if let sha = ticks.dropFirst().first(where: { ProjectMaterialObject.validSHA($0) }) { record.sha256 = sha }
            if let bytes = firstCapture(#"\(([0-9]{1,12}) bytes"#, in: archiveCell).flatMap({ Int($0) }), bytes > 0 { record.bytes = bytes }
        }
        let date = firstCapture(#"(?m)^# .*\((\d{4}-\d{2}-\d{2})\)\s*$"#, in: markdown)
        record.recordedAt = (date.map { $0 + " " } ?? "") + "\(path)@\(commit.prefix(12))"
        return record
    }
}
