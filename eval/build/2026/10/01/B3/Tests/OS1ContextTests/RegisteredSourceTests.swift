import Foundation
import OS1Context

func runRegisteredSourceFixtures() throws {
    var count = 0
    func check(_ value: @autoclosure () throws -> Bool) throws { let passed = try value(); precondition(passed); count += 1 }
    func rejects(_ body: () throws -> Void) {
        do { try body(); fatalError("unsafe registered source accepted") } catch { count += 1 }
    }
    func json(_ value: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: value, options: .sortedKeys) }
    let releaseID = "scv-instagram-single-20260907-v161", fingerprint = String(repeating: "a", count: 64)
    let original = Dictionary(uniqueKeysWithValues: RegisteredProjectSource.selectedPaths.map { ($0, Data(("technical original " + $0).utf8)) })
    let records = original.keys.sorted().map { ["path": $0, "bytes": original[$0]!.count, "sha256": ProjectMaterialObject.digest(original[$0]!)] as [String: Any] }
    let manifest = try json(["release_id": releaseID, "content_fingerprint_sha256": fingerprint, "files": records])
    func live(_ bytes: Data = manifest, id: String = releaseID, fp: String = fingerprint) throws -> SCVLiveRelease {
        try SCVLiveRelease(data: json(["ok": true, "release": ["ok": true, "mode": "production", "release_phase": "active", "phase_ready": true,
            "release_id": id, "content_fingerprint_sha256": fp, "release_manifest_sha256": ProjectMaterialObject.digest(bytes)]]))
    }
    func gzip(_ bytes: Data) throws -> Data {
        let process = Process(), input = Pipe(), output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/gzip"); process.arguments = ["-c"]
        process.standardInput = input; process.standardOutput = output; process.standardError = FileHandle.nullDevice
        try process.run(); try input.fileHandleForWriting.write(contentsOf: bytes); try input.fileHandleForWriting.close()
        let result = output.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
        precondition(process.terminationStatus == 0); return result
    }
    func tar(_ entries: [(String, Data)], type: UInt8 = 48, link: String = "", corruptHeader: Bool = false) -> Data {
        var result = Data()
        for (path, data) in entries {
            var header = [UInt8](repeating: 0, count: 512)
            func put(_ value: String, _ position: Int) { for (i, byte) in value.utf8.enumerated() { header[position + i] = byte } }
            put(path, 0); put("0000600", 100); put(String(format: "%011o", data.count), 124)
            header[156] = type; put(link, 157); put("ustar", 257); put("00", 263)
            for i in 148..<156 { header[i] = 32 }
            put(String(format: "%06o", header.reduce(0) { $0 + Int($1) }), 148); header[154] = 0
            if corruptHeader { header[0] ^= 1 }
            result.append(contentsOf: header); result.append(data)
            result.append(Data(repeating: 0, count: (512 - data.count % 512) % 512))
        }
        result.append(Data(repeating: 0, count: 1024)); return result
    }
    let entries = original.keys.sorted().map { ($0, original[$0]!) } + [("SCV_SINGLE_RELEASE.json", manifest)]
    let good = try gzip(tar(entries)), identity = try live()
    let verified = try RegisteredProjectSource.verify(good, live: identity)
    try check(verified.files.count == 5 && verified.manifest == manifest && verified.files["Dockerfile"] == original["Dockerfile"])
    try check(verified.sha256 == ProjectMaterialObject.digest(good))
    rejects { _ = try RegisteredProjectSource.verify(good, live: live(id: "scv-instagram-single-20260907-v162")) }
    rejects { _ = try RegisteredProjectSource.verify(good, live: live(fp: String(repeating: "b", count: 64))) }
    rejects { _ = try RegisteredProjectSource.verify(good, live: live(Data("{}".utf8))) }
    var invalidArchives: [[(String, Data)]] = []
    invalidArchives.append(Array(entries.dropLast()))
    invalidArchives.append(Array(entries.dropFirst()))
    invalidArchives.append(entries + [entries[0]])
    for path in ["unlisted-private.txt", "../escape", "/absolute", "a/./b", "a//b", "-option", "newline\n"] {
        invalidArchives.append(entries + [(path, Data())])
    }
    for invalid in invalidArchives {
        rejects { _ = try RegisteredProjectSource.verify(gzip(tar(invalid)), live: identity) }
    }
    var mutated = entries; mutated[0].1 = Data("different source".utf8)
    rejects { _ = try RegisteredProjectSource.verify(gzip(tar(mutated)), live: identity) }
    for type: UInt8 in [49, 50, 51, 53, 120, 103, 83] {
        rejects { _ = try RegisteredProjectSource.verify(gzip(tar(entries, type: type)), live: identity) }
    }
    rejects { _ = try RegisteredProjectSource.verify(gzip(tar(entries, link: "outside")), live: identity) }
    rejects { _ = try RegisteredProjectSource.verify(gzip(tar(entries, corruptHeader: true)), live: identity) }
    rejects { _ = try RegisteredProjectSource.verify(gzip(tar(entries).dropLast(800)), live: identity) }
    rejects { _ = try RegisteredProjectSource.verify(good.dropLast(4), live: identity) }
    rejects { _ = try RegisteredProjectSource.verify(good + good, live: identity) }
    // Real macOS tar adds AppleDouble + harmless timestamp/provenance PAX.
    // Discard only that bounded metadata, and re-encode verified regular bytes.
    var appleDouble = Data([0, 5, 22, 7, 0, 2, 0, 0]); appleDouble.append(Data(repeating: 0, count: 18))
    let metadataTar = tar([("._Dockerfile", appleDouble)]).dropLast(1024) +
        tar([("PaxHeader/Dockerfile", Data("11 mtime=1\n".utf8))], type: 120).dropLast(1024) +
        tar([entries.first { $0.0 == "Dockerfile" }!] + entries.filter { $0.0 != "Dockerfile" })
    let metadataArchive = try gzip(metadataTar)
    let cleaned = try RegisteredProjectSource.verify(metadataArchive, live: identity)
    try check(cleaned.files == verified.files && cleaned.archive != metadataArchive)
    try check(try RegisteredProjectSource.verify(cleaned.archive, live: identity).files == verified.files)
    for text in ["20 path=../outside\n", "17 linkpath=other\n", "13 size=99999\n", "999 mtime=1\n"] {
        let malicious = tar([("PaxHeader/Dockerfile", Data(text.utf8))], type: 120).dropLast(1024) + tar(entries)
        rejects { _ = try RegisteredProjectSource.verify(gzip(malicious), live: identity) }
    }
    rejects { _ = try RegisteredProjectSource.verify(Data(), live: identity) }
    rejects { _ = try RegisteredProjectSource.verify(Data(repeating: 0, count: RegisteredProjectSource.maximumArchiveBytes + 1), live: identity) }
    for prompt in ["야 인스타그램 오토메이션 수정해야 되니까 준비해라", "인스타그램 손보자", "그 프로젝트 이어서 하자"] {
        try check(RegisteredProjectSource.mayUseForPreparation(prompt))
        try check(RegisteredProjectSource.mayUseForPreparation(prompt.decomposedStringWithCanonicalMapping))
        try check(PreparationIntent.detect(prompt)?.modifies == false)
        try check(PreparationIntent.detect(prompt.decomposedStringWithCanonicalMapping)?.modifies == false)
    }
    for prompt in ["인스타그램 수정해야 하니까 준비해", "인스타그램 변경할 건데 준비해", "인스타그램 수정하려고 준비해"] {
        try check(PreparationIntent.detect(prompt)?.modifies == false)
    }
    for prompt in ["인스타그램 준비하고 가격 로직 수정해", "인스타그램 준비해 그리고 버그 고쳐"] {
        try check(PreparationIntent.detect(prompt)?.modifies == true)
    }
    for prompt in ["R2에서 인스타 자료 가져와", "인스타 준비해 r2만", "GitHub에서 SCV source fetch", "알투 자료 가져와"] {
        try check(!RegisteredProjectSource.mayUseForPreparation(prompt))
    }
    for prompt in ["연결된 자료의 출처가 R2 다운로드인지 등록된 로컬 원본인지 답해 주세요", "첨부된 원본의 릴리스와 Node 버전 설명해", "Where did this source come from, R2 or local?"] {
        try check(RegisteredProjectSource.discussesAttachedProvenance(prompt))
        try check(RegisteredProjectSource.discussesAttachedProvenance(prompt.decomposedStringWithCanonicalMapping))
    }
    for prompt in ["첨부된 자료의 최신 버전을 R2에서 가져와", "그 자료 말고 GitHub 버전 가져와", "연결된 원본 대신 R2의 릴리스 조회해", "R2에서 인스타그램 준비해", "그 자료의 출처인 R2 연결시켜"] {
        try check(!RegisteredProjectSource.discussesAttachedProvenance(prompt))
    }
    let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Caches/registered-source-fixture-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    try check(try RegisteredProjectSource.lookup(live: identity, root: root) == nil)
    let saved = try RegisteredProjectSource.register(good, live: identity, root: root)
    try check(try Data(contentsOf: saved.url) == good)
    try check(try RegisteredProjectSource.lookup(live: identity, root: root)?.verified.sha256 == verified.sha256)
    try check(try RegisteredProjectSource.register(good, live: identity, root: root).url == saved.url)
    try check(try RegisteredProjectSource.lookup(live: live(Data("changed".utf8)), root: root) == nil)
    let attrs = try FileManager.default.attributesOfItem(atPath: saved.url.path)
    try check((attrs[.posixPermissions] as? NSNumber)?.intValue == 0o600)
    try good.dropLast(5).write(to: saved.url)
    rejects { _ = try RegisteredProjectSource.lookup(live: identity, root: root) }
    let linked = root.appendingPathComponent("linked")
    try FileManager.default.createSymbolicLink(at: linked, withDestinationURL: saved.url)
    rejects { _ = try RegisteredProjectSource.readArchive(linked) }
    let linkedDirectory = root.appendingPathComponent("linked-dir")
    try FileManager.default.createSymbolicLink(at: linkedDirectory, withDestinationURL: root)
    rejects { _ = try RegisteredProjectSource.register(good, live: identity, root: linkedDirectory.appendingPathComponent("child")) }

    var context = TaskContext(conversationID: UUID(), objective: .init(requestText: "인스타 준비해", kind: .prepare))
    context.sourcePreparation = SourcePreparationState(live: identity, reason: "publication pending")
    let decoded = try JSONDecoder().decode(TaskContext.self, from: JSONEncoder().encode(context))
    try check(decoded.sourcePreparation == context.sourcePreparation && decoded.objectiveID == context.objectiveID)
    try check(decoded.sourcePreparation!.canLookForRegistration)
    let projection = RetrievedAnswer.fromEvidence(output: "등록 원본에서 Instagram 자동화 수정 준비 자료를 검증해 회수했습니다.\n\n등록 로컬 원본입니다.\n원본 검증 기준: live\n### Dockerfile\nFROM node:20.20.2", sourcePaths: ["Dockerfile", "source-inventory.txt"])
    try check(projection?.overview == "등록 로컬 원본입니다." && projection!.original.contains("FROM node"))
    try check(!projection!.overview.contains("R2"))
    print("OS1 registered project source: \(count) checks passed")
}
