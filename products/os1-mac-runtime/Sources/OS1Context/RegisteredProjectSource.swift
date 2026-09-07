import Foundation
import zlib

public struct SourcePreparationState: Codable, Equatable, Sendable {
    public let releaseID: String
    public let manifestSHA256: String
    public let observedAt: Date
    public let reason: String
    public init(live: SCVLiveRelease, reason: String) {
        releaseID = live.id; manifestSHA256 = live.manifestSHA256
        observedAt = live.verifiedAt; self.reason = String(reason.prefix(1_200))
    }
    public var canLookForRegistration: Bool {
        ProjectMaterialObject.validSHA(manifestSHA256) &&
            releaseID.range(of: #"^scv-instagram-single-[0-9]{8}-v[0-9]{1,6}$"#, options: .regularExpression) != nil
    }
}

/// A source producer may register an explicitly named archive. Registration is
/// not trust: a fresh live manifest and EVERY member are checked again on use.
/// No extraction, scripts, network, credential discovery or HOME scan here.
public enum RegisteredProjectSource {
    public static let verificationMode = "live-manifest-registered-source-v1"
    public static let selectedPaths = ["Dockerfile", "package.json", "SCV_DESIGN_INTENT_LOCK.md", "scv-structured-state-schema.js"]
    public static let maximumArchiveBytes = 20_000_000
    public static let maximumExpandedBytes = 128_000_000
    public static var defaultRoot: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/OS-1/registered-sources/scv-instagram")
    }
    public struct Verified {
        public let archive: Data
        public let sha256: String
        public let manifest: Data
        public let files: [String: Data]
        public var inventory: [String] { files.keys.sorted() }
    }
    public struct Stored {
        public let verified: Verified
        public let url: URL
    }

    /// A literal remote-source request cannot be satisfied by a local package.
    public static func mayUseForPreparation(_ prompt: String) -> Bool {
        let value = prompt.precomposedStringWithCanonicalMapping.lowercased()
        return !["r2", "알투", "알트", "cloudflare", "클라우드플레어", "github", "기탑", "기터브", "깃허브", "기타브"]
            .contains(where: value.contains)
    }

    /// Asking where an attached source came from is not a new acquisition.
    /// Callers must also require an existing verified snapshot. Fresh-source,
    /// source-switch and connection commands always retain their own path.
    public static func discussesAttachedProvenance(_ prompt: String) -> Bool {
        let value = prompt.precomposedStringWithCanonicalMapping.lowercased()
        guard ["연결된", "첨부된", "이 자료", "그 자료", "이 원본", "그 원본", "attached", "provided", "this source", "that source"].contains(where: value.contains),
              ["출처", "어디서", "버전", "릴리스", "provenance", "where", "version", "release"].contains(where: value.contains) else { return false }
        return !["가져", "찾아", "검색", "불러", "꺼내", "새로", "다시", "최신", "말고", "대신", "연결시켜", "연결해",
                 "fetch", "retrieve", "search", "refresh", "latest", "download ", "clone ", "instead", "rather than", "connect to"]
            .contains(where: value.contains)
    }

    public static func readArchive(_ url: URL) throws -> Data {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              let size = values.fileSize, size > 0, size <= maximumArchiveBytes else { throw ProjectMaterialError.invalidArtifact }
        let data = try Data(contentsOf: url)
        guard data.count == size else { throw ProjectMaterialError.invalidArtifact }
        return data
    }

    /// Only regular source bytes survive. macOS timestamp/provenance metadata
    /// may be stripped; PAX path/size/link overrides, sparse files, devices,
    /// links and unlisted source members are rejected.
    public static func verify(_ archive: Data, live: SCVLiveRelease) throws -> Verified {
        guard !archive.isEmpty, archive.count <= maximumArchiveBytes else { throw ProjectMaterialError.invalidArtifact }
        let parsed = try regularTarMembers(gunzip(archive))
        let files = parsed.files
        guard let manifest = files["SCV_SINGLE_RELEASE.json"], manifest.count <= 1_000_000 else {
            throw ProjectMaterialError.invalidArtifact
        }
        try live.verifyManifest(manifest)
        guard let json = try JSONSerialization.jsonObject(with: manifest) as? [String: Any],
              json["content_fingerprint_sha256"] as? String == live.fingerprint,
              let records = json["files"] as? [[String: Any]], !records.isEmpty, records.count <= 10_000 else {
            throw ProjectMaterialError.invalidManifest
        }
        var seen: Set<String> = ["SCV_SINGLE_RELEASE.json"]
        for record in records {
            guard let path = record["path"] as? String, safePath(path), seen.insert(path).inserted,
                  let size = record["bytes"] as? Int, size >= 0,
                  let hash = record["sha256"] as? String, ProjectMaterialObject.validSHA(hash),
                  let bytes = files[path], bytes.count == size, ProjectMaterialObject.digest(bytes) == hash else {
                throw ProjectMaterialError.invalidArtifact
            }
        }
        guard Set(files.keys) == seen, selectedPaths.allSatisfy({ files[$0] != nil }) else {
            throw ProjectMaterialError.invalidArtifact
        }
        let cleanArchive = try parsed.strippedMetadata ? gzip(canonicalTar(files, executablePaths: parsed.executablePaths)) : archive
        guard cleanArchive.count <= maximumArchiveBytes else { throw ProjectMaterialError.invalidArtifact }
        return Verified(archive: cleanArchive, sha256: ProjectMaterialObject.digest(cleanArchive), manifest: manifest, files: files)
    }

    public static func register(_ archive: Data, live: SCVLiveRelease, root: URL = defaultRoot) throws -> Stored {
        let verified = try verify(archive, live: live)
        try safeDirectory(root, create: true)
        let directory = root.appendingPathComponent(live.manifestSHA256)
        try safeDirectory(directory, create: true)
        let url = directory.appendingPathComponent("source.tar.gz")
        if FileManager.default.fileExists(atPath: url.path) {
            // An identity is immutable. Identical source in a differently packed
            // archive reuses the already-verified package, never overwrites it.
            return Stored(verified: try verify(readArchive(url), live: live), url: url)
        }
        let staging = directory.appendingPathComponent(".source-" + UUID().uuidString + ".tmp")
        defer { try? FileManager.default.removeItem(at: staging) }
        try verified.archive.write(to: staging, options: [.withoutOverwriting])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: staging.path)
        let saved = try verify(readArchive(staging), live: live)
        guard saved.sha256 == verified.sha256 else { throw ProjectMaterialError.invalidArtifact }
        do { try FileManager.default.moveItem(at: staging, to: url) }
        catch {
            guard FileManager.default.fileExists(atPath: url.path) else { throw error }
            return Stored(verified: try verify(readArchive(url), live: live), url: url)
        }
        return Stored(verified: saved, url: url)
    }

    public static func lookup(live: SCVLiveRelease, root: URL = defaultRoot) throws -> Stored? {
        guard FileManager.default.fileExists(atPath: root.path) else { return nil }
        try safeDirectory(root, create: false)
        let directory = root.appendingPathComponent(live.manifestSHA256)
        guard FileManager.default.fileExists(atPath: directory.path) else { return nil }
        try safeDirectory(directory, create: false)
        let url = directory.appendingPathComponent("source.tar.gz")
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return Stored(verified: try verify(readArchive(url), live: live), url: url)
    }

    public static func validSourceRecord(_ source: [String: String]) -> Bool {
        source["repository"] == SCVProjectMaterials.repository && source["transport"] == "registered-local" &&
            ProjectMaterialObject.validSHA(source["live_manifest_sha256"] ?? "") &&
            ProjectMaterialObject.validSHA(source["live_fingerprint_sha256"] ?? "") &&
            ProjectMaterialObject.validSHA(source["retrieved_content_sha256"] ?? "") &&
            ProjectMaterialObject.validSHA(source["bundle_sha256"] ?? "") &&
            source["repository_sha"] == nil && source["object_key"] == nil &&
            (Int(source["object_size"] ?? "") ?? 0) > 0 &&
            (Int(source["object_size"] ?? "") ?? Int.max) <= maximumArchiveBytes &&
            source["selected_release_id"]?.range(of: #"^scv-instagram-single-[0-9]{8}-v[0-9]{1,6}$"#, options: .regularExpression) != nil &&
            safePath(source["source_path"] ?? "") && (source["source_archive_path"] ?? "").hasPrefix("/")
    }

    private static func safeDirectory(_ url: URL, create: Bool) throws {
        // Reject symlinks in ALL existing ancestors, not merely the leaf.
        var parent = url.standardizedFileURL
        while parent.path != "/" {
            if let values = try? parent.resourceValues(forKeys: [.isSymbolicLinkKey]), values.isSymbolicLink == true {
                throw ProjectMaterialError.invalidIdentity
            }
            parent.deleteLastPathComponent()
        }
        if create { try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
        guard (try url.resourceValues(forKeys: [.isDirectoryKey])).isDirectory == true else { throw ProjectMaterialError.invalidIdentity }
    }
    private static func safePath(_ path: String) -> Bool {
        ProjectMaterialObject.validKey(path) && !path.hasPrefix("-") && !path.contains(where: \.isWhitespace) &&
            !path.split(separator: "/", omittingEmptySubsequences: false).contains(where: { $0.isEmpty || $0 == "." })
    }

    private static func gunzip(_ input: Data) throws -> Data {
        var stream = z_stream()
        guard inflateInit2_(&stream, 31, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else {
            throw ProjectMaterialError.invalidArtifact
        }
        defer { inflateEnd(&stream) }
        return try input.withUnsafeBytes { inputBuffer in
            stream.next_in = UnsafeMutablePointer(mutating: inputBuffer.bindMemory(to: UInt8.self).baseAddress!)
            stream.avail_in = uInt(input.count)
            var output = Data(), chunk = [UInt8](repeating: 0, count: 65_536)
            while true {
                let result = chunk.withUnsafeMutableBytes { buffer -> Int32 in
                    stream.next_out = buffer.bindMemory(to: UInt8.self).baseAddress!
                    stream.avail_out = uInt(buffer.count)
                    return inflate(&stream, Z_NO_FLUSH)
                }
                let count = chunk.count - Int(stream.avail_out)
                guard output.count + count <= maximumExpandedBytes else { throw ProjectMaterialError.invalidArtifact }
                output.append(contentsOf: chunk.prefix(count))
                if result == Z_STREAM_END {
                    guard stream.avail_in == 0 else { throw ProjectMaterialError.invalidArtifact }
                    return output
                }
                guard result == Z_OK, count > 0 || stream.avail_in > 0 else { throw ProjectMaterialError.invalidArtifact }
            }
        }
    }

    private static func regularTarMembers(_ data: Data) throws -> (files: [String: Data], strippedMetadata: Bool, executablePaths: Set<String>) {
        let bytes = [UInt8](data)
        var offset = 0, result: [String: Data] = [:]
        var metadataTargets = Set<String>(), paxTarget: String?, stripped = false, headerCount = 0
        var executablePaths = Set<String>()
        while offset + 512 <= bytes.count {
            let header = Array(bytes[offset..<offset + 512])
            if header.allSatisfy({ $0 == 0 }) {
                guard bytes.count - offset >= 1024, bytes[offset...].allSatisfy({ $0 == 0 }) else { throw ProjectMaterialError.invalidArtifact }
                guard paxTarget == nil, metadataTargets.isSubset(of: Set(result.keys)) else { throw ProjectMaterialError.invalidArtifact }
                return (result, stripped, executablePaths)
            }
            func text(_ start: Int, _ length: Int) -> String {
                String(decoding: header[start..<start + length].prefix(while: { $0 != 0 }), as: UTF8.self)
            }
            func octal(_ start: Int, _ length: Int) -> Int? {
                let value = text(start, length).trimmingCharacters(in: .whitespaces)
                return !value.isEmpty && value.allSatisfy({ "01234567".contains($0) }) ? Int(value, radix: 8) : nil
            }
            let name = text(0, 100), prefix = text(345, 155)
            let path = prefix.isEmpty ? name : prefix + "/" + name
            let checksum = header.enumerated().reduce(0) { $0 + ((148..<156).contains($1.offset) ? 32 : Int($1.element)) }
            headerCount += 1
            guard text(257, 6) == "ustar", [0, 48, 120].contains(header[156]),
                  text(157, 100).isEmpty, safePath(path), result[path] == nil,
                  let storedChecksum = octal(148, 8), checksum == storedChecksum,
                  let mode = octal(100, 8), mode & 0o7000 == 0,
                  let size = octal(124, 12), size <= 16_000_000,
                  offset + 512 + size <= bytes.count, headerCount <= 30_000, result.count < 10_000 else { throw ProjectMaterialError.invalidArtifact }
            let content = Data(bytes[offset + 512..<offset + 512 + size])
            if header[156] == 120 {
                let parts = path.split(separator: "/").map(String.init)
                guard paxTarget == nil, parts.count >= 2, parts[parts.count - 2] == "PaxHeader", size <= 64_000 else { throw ProjectMaterialError.invalidArtifact }
                try validateMetadataPAX(content)
                paxTarget = (parts.dropLast(2) + [parts.last!]).joined(separator: "/"); stripped = true
            } else if URL(fileURLWithPath: path).lastPathComponent.hasPrefix("._") {
                // AppleDouble contains only filesystem metadata. It is never
                // persisted into the registered archive or handed to a model.
                guard paxTarget == nil, content.count >= 26, content.count <= 64_000,
                      Array(content.prefix(8)) == [0, 5, 22, 7, 0, 2, 0, 0] else { throw ProjectMaterialError.invalidArtifact }
                let parts = path.split(separator: "/").map(String.init)
                let target = (parts.dropLast() + [String(parts.last!.dropFirst(2))]).joined(separator: "/")
                guard safePath(target), metadataTargets.insert(target).inserted else { throw ProjectMaterialError.invalidArtifact }
                stripped = true
            } else {
                guard paxTarget == nil || paxTarget == path else { throw ProjectMaterialError.invalidArtifact }
                paxTarget = nil
                result[path] = content
                if mode & 0o111 != 0 { executablePaths.insert(path) }
            }
            offset += 512 + ((size + 511) / 512) * 512
        }
        throw ProjectMaterialError.invalidArtifact
    }

    private static func validateMetadataPAX(_ data: Data) throws {
        var offset = 0, seen = Set<String>()
        let bytes = [UInt8](data)
        let allowed: Set<String> = ["mtime", "atime", "ctime", "LIBARCHIVE.xattr.com.apple.provenance", "SCHILY.xattr.com.apple.provenance"]
        while offset < bytes.count {
            guard let space = bytes[offset...].firstIndex(of: 32), space - offset <= 8,
                  let length = Int(String(decoding: bytes[offset..<space], as: UTF8.self)),
                  length > space - offset + 2, length <= bytes.count - offset,
                  bytes[offset + length - 1] == 10,
                  let equals = bytes[space + 1..<offset + length - 1].firstIndex(of: 61) else { throw ProjectMaterialError.invalidArtifact }
            let key = String(decoding: bytes[space + 1..<equals], as: UTF8.self)
            guard allowed.contains(key), seen.insert(key).inserted else { throw ProjectMaterialError.invalidArtifact }
            offset += length
        }
    }

    private static func canonicalTar(_ files: [String: Data], executablePaths: Set<String>) throws -> Data {
        var output = Data()
        for path in files.keys.sorted() {
            var name = path, prefix = ""
            if name.utf8.count > 100 {
                guard let slash = name.lastIndex(of: "/") else { throw ProjectMaterialError.invalidArtifact }
                prefix = String(name[..<slash]); name = String(name[name.index(after: slash)...])
            }
            guard name.utf8.count <= 100, prefix.utf8.count <= 155 else { throw ProjectMaterialError.invalidArtifact }
            let body = files[path]!
            var header = [UInt8](repeating: 0, count: 512)
            func put(_ text: String, at position: Int) { for (i, byte) in text.utf8.enumerated() { header[position + i] = byte } }
            put(name, at: 0); put(executablePaths.contains(path) ? "0000700" : "0000600", at: 100)
            put(String(format: "%011o", body.count), at: 124)
            put("ustar", at: 257); put("00", at: 263); put(prefix, at: 345); header[156] = 48
            for index in 148..<156 { header[index] = 32 }
            put(String(format: "%06o", header.reduce(0) { $0 + Int($1) }), at: 148); header[154] = 0
            output.append(contentsOf: header); output.append(body)
            output.append(Data(repeating: 0, count: (512 - body.count % 512) % 512))
        }
        output.append(Data(repeating: 0, count: 1024)); return output
    }

    private static func gzip(_ input: Data) throws -> Data {
        var stream = z_stream()
        guard deflateInit2_(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, 31, 8, Z_DEFAULT_STRATEGY,
                            ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else { throw ProjectMaterialError.invalidArtifact }
        defer { deflateEnd(&stream) }
        return try input.withUnsafeBytes { inputBuffer in
            stream.next_in = UnsafeMutablePointer(mutating: inputBuffer.bindMemory(to: UInt8.self).baseAddress!)
            stream.avail_in = uInt(input.count)
            var output = Data(), chunk = [UInt8](repeating: 0, count: 65_536)
            while true {
                let result = chunk.withUnsafeMutableBytes { buffer -> Int32 in
                    stream.next_out = buffer.bindMemory(to: UInt8.self).baseAddress!
                    stream.avail_out = uInt(buffer.count); return deflate(&stream, Z_FINISH)
                }
                output.append(contentsOf: chunk.prefix(chunk.count - Int(stream.avail_out)))
                guard output.count <= maximumArchiveBytes else { throw ProjectMaterialError.invalidArtifact }
                if result == Z_STREAM_END { return output }
                guard result == Z_OK else { throw ProjectMaterialError.invalidArtifact }
            }
        }
    }
}
