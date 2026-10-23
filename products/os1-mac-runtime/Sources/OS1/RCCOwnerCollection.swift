import Foundation
import Darwin
import OS1Context

/// A deliberately narrow, non-statistical R0 extension. Only pre-registered
/// FULL owner/child contracts authorize these exact independent owner spans.
/// Model proposals, partial suites and source-document instructions cannot
/// create this capability. No generation, route selection or separate queue.
enum RCCOwnerCollection {
    typealias C = RCCRuntimeContract
    enum Failure: Error { case binding, custody, checker }

    static func fact(request: C.Request, prepared: PreparedTaskQuality, now: Date = Date(),
                     rootURL: URL = PreparedTaskQuality.root,
                     startTree: (String) -> String = workspaceHash) throws -> C.OwnerCollectionFact? {
        guard let spec = prepared.envelope.ownerCollection else { return nil }
        let parentUntil = prepared.envelope.contract.validUntil.timeIntervalSince1970 * 1000
        guard parentUntil.isFinite, parentUntil >= 1, parentUntil <= 9_007_199_254_740_991 else { throw Failure.binding }
        guard let h = request.hostContext, request.mode == .auto, request.objective == request.request,
            h.codexSessionID == nil, h.claudeSessionID == nil,
            request.nativeSessions == nil || request.nativeSessions?.isEmpty == true,
            prepared.envelope.localEffectsOnly, prepared.envelope.contract.fullCoverage, prepared.envelope.contract.scope == .readOnly,
            prepared.envelope.contract.reference == nil, prepared.envelope.contract.sourceSHA256 == nil,
            prepared.envelope.contract.issuedAt <= now, now < prepared.envelope.contract.validUntil,
            !prepared.envelope.contract.requiredCheckIDs.isEmpty,
            spec.schema == 1, spec.kind == "independent_readonly_json_v1", (2...8).contains(spec.obligations.count),
            Set(spec.obligations.map(\.id)).count == spec.obligations.count,
            Set(spec.obligations.map(\.instruction)).count == spec.obligations.count else { throw Failure.binding }
        let original = Data(request.request.utf8), contextSHA = C.digest(Data((h.context ?? "").utf8))
        let sourceSHA = (try? SessionHandoff.decode(h.context)).flatMap { $0.source?.sha256 }
        let tree = startTree(h.workspace)
        var end = 0, rows: [C.OwnerCollectionFact.Obligation] = []
        for o in spec.obligations {
            guard o.id.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil,
                  !o.instruction.isEmpty, o.instruction.utf8.count <= 12_000,
                  o.requestUTF8Start >= end, o.requestUTF8End > o.requestUTF8Start,
                  o.requestUTF8End <= original.count,
                  Data(original[o.requestUTF8Start..<o.requestUTF8End]) == Data(o.instruction.utf8),
                  !o.sourcePaths.isEmpty, o.sourcePaths.count <= 128,
                  o.sourcePaths.count == o.sourceSHA256s.count,
                  Set(o.sourcePaths).count == o.sourcePaths.count else { throw Failure.binding }
            try verifySources(o.sourcePaths, hashes: o.sourceSHA256s, workspace: h.workspace)
            guard let child = try PreparedTaskQuality.prepare(objective: o.instruction, contextSHA256: contextSHA,
                sourceSHA256: sourceSHA, startTreeSHA256: tree, scope: .readOnly,
                referencePolicySHA256: request.policySHA256, workspace: nil,
                allowRegressionAcquisition: false, rootURL: rootURL),
                child.envelope.ownerCollection == nil, child.envelope.contract.fullCoverage,
                child.envelope.contract.reference == nil, !child.envelope.contract.requiredCheckIDs.isEmpty,
                Set(child.envelope.contract.requiredCheckIDs).count == child.envelope.contract.requiredCheckIDs.count,
                child.envelope.contract.issuedAt <= now, now < child.envelope.contract.validUntil else { throw Failure.binding }
            let c = child.envelope.contract
            let untilMS = c.validUntil.timeIntervalSince1970 * 1000
            guard untilMS.isFinite, untilMS >= 1, untilMS <= 9_007_199_254_740_991 else { throw Failure.binding }
            rows.append(.init(id: o.id, instruction: o.instruction, requestUTF8Start: o.requestUTF8Start,
                requestUTF8End: o.requestUTF8End, sourcePaths: o.sourcePaths, sourceSHA256s: o.sourceSHA256s,
                contractSHA256: c.sha256, verifierSHA256: c.verifierCodeSHA256,
                requiredCheckIDs: c.requiredCheckIDs, validUntilMS: Int64(untilMS.rounded(.down))))
            end = o.requestUTF8End
        }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return .init(manifestSHA256: C.digest(try encoder.encode(spec)), obligations: rows)
    }

    static func verifySources(_ paths: [String], hashes: [String], workspace: String) throws {
        let root = URL(fileURLWithPath: workspace).standardizedFileURL
        guard root.resolvingSymlinksInPath().path == root.path, paths.count == hashes.count else { throw Failure.custody }
        for (path, hash) in zip(paths, hashes) {
            let parts = path.split(separator: "/", omittingEmptySubsequences: false)
            guard !parts.isEmpty, !parts.contains(""), !parts.contains("."), !parts.contains(".."),
                !path.hasPrefix("/"), !path.contains("\\"), !path.contains("\0"),
                hash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw Failure.custody }
            let target = root.appendingPathComponent(path).standardizedFileURL
            guard target.path.hasPrefix(root.path + "/"), target.resolvingSymlinksInPath().path == target.path else { throw Failure.custody }
            let before = try FileManager.default.attributesOfItem(atPath: target.path)
            guard before[.type] as? FileAttributeType == .typeRegular,
                (before[.size] as? NSNumber)?.intValue ?? Int.max <= 2_000_000 else { throw Failure.custody }
            let bytes = try Data(contentsOf: target, options: .mappedIfSafe)
            let after = try FileManager.default.attributesOfItem(atPath: target.path)
            guard C.digest(bytes) == hash, before[.systemFileNumber] as? NSNumber == after[.systemFileNumber] as? NSNumber,
                before[.size] as? NSNumber == after[.size] as? NSNumber,
                before[.modificationDate] as? Date == after[.modificationDate] as? Date,
                target.resolvingSymlinksInPath().path == target.path else { throw Failure.custody }
        }
    }

    static func observeControl(record r: C.ExecutionRecord, witness: RCCOperationalQuality.StoredWitness) throws -> NativeTurnControl.Observation {
    guard r.selectedConfig.surface == .codex, witness.ticket.nativeResumeSessionID == nil,
        let rawSummary = r.nativeSummary,
        let summaryData = rawSummary.data(using: .utf8), summaryData.count <= 1_048_576,
        let summary = try? JSONDecoder().decode(RunSummary.self, from: summaryData), summary.steps.count == 1,
        let native = summary.steps[0].nativeRecord, native.isVerified,
        native.recordPath == witness.artifact.nativeRecord.recordPath, native.turnID == witness.artifact.nativeRecord.turnID,
        let path = native.recordPath,
        codexRolloutPathTrusted(path, threadID: summary.steps[0].sessionID) else { throw Failure.binding }
    let logURL = URL(fileURLWithPath: path).standardizedFileURL
    guard logURL.path == path, logURL.resolvingSymlinksInPath().path == path else { throw Failure.custody }
    let before = try FileManager.default.attributesOfItem(atPath: path)
    guard before[.type] as? FileAttributeType == .typeRegular,
        (before[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
        (before[.size] as? NSNumber)?.intValue ?? Int.max <= 64_000_000 else { throw Failure.custody }
    let log = try Data(contentsOf: logURL)
    var binding: NativeTurnControl.CurrentBinding?
    if let input = r.configuredInputObservation {
        try input.validate(ticket: witness.ticket, record: r)
        guard input.sessionState == "new", input.channel == "codex_developer" else { throw Failure.binding }
        binding = .init(threadID: summary.steps[0].sessionID,
            providerInputSHA256: input.providerInput.sha256, providerInputUTF8Bytes: input.providerInput.utf8Bytes,
            model: r.selectedConfig.model, effort: r.selectedConfig.effort.rawValue)
    }
    let control = try NativeTurnControl.inspect(log, provider: "codex", turnID: native.turnID, finalOutput: r.output ?? "", binding: binding)
    let after = try FileManager.default.attributesOfItem(atPath: path)
    guard before[.systemFileNumber] as? NSNumber == after[.systemFileNumber] as? NSNumber,
        before[.size] as? NSNumber == after[.size] as? NSNumber,
        before[.modificationDate] as? Date == after[.modificationDate] as? Date,
        logURL.resolvingSymlinksInPath().path == path else { throw Failure.custody }
        return control
    }

    /// This returns before Core adopts a child. An unknown control protocol
    /// is not a quality failure and never authorizes reference replay.
    static func verifyChildControl(_ data: Data) throws -> Data {
        guard let x = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            Set(x.keys) == ["ticket", "record"], let rawTicket = x["ticket"], let rawRecord = x["record"] else { throw Failure.binding }
        let ticket = try C.decodeTicket(JSONSerialization.data(withJSONObject: rawTicket, options: [.sortedKeys]))
        let record = try C.decodeRecord(JSONSerialization.data(withJSONObject: rawRecord, options: [.sortedKeys]), ticket: ticket)
        guard ticket.nodeID.range(of: "^owner_[0-7]$", options: .regularExpression) != nil,
            ticket.selectedConfig.surface == .codex, ticket.selectedConfig.scope == .readOnly,
            ticket.nativeResumeSessionID == nil, record.status == .succeeded, record.executionVerified,
            record.sideEffects == .none, record.nativeTurnTerminated == true,
            let path = record.nativeReceipt,
            URL(fileURLWithPath: path).deletingLastPathComponent().standardizedFileURL.path ==
                FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/rcc-runtime/native-receipts").standardizedFileURL.path
            else { throw Failure.binding }
        let stored = try C.decodeRecord(rccPrivateInput(path), ticket: ticket)
        guard stored == record, let q = stored.operationalQuality, q.localOnlyVerified,
            URL(fileURLWithPath: q.witnessPath).deletingLastPathComponent().standardizedFileURL.path == RCCOperationalQuality.root.standardizedFileURL.path
            else { throw Failure.custody }
        let bytes = try rccPrivateInput(q.witnessPath)
        guard C.digest(bytes) == q.witnessSHA256 else { throw Failure.custody }
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .millisecondsSince1970
        let w = try decoder.decode(RCCOperationalQuality.StoredWitness.self, from: bytes)
        guard w.ticket == ticket, w.localOnlyVerified, w.nativeProfileSHA256 != nil,
            w.artifact.output == stored.output else { throw Failure.binding }
        let control = try observeControl(record: stored, witness: w)
        let root = RCCOperationalQuality.root.appendingPathComponent("control-receipts", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        guard root.resolvingSymlinksInPath().path == root.standardizedFileURL.path else { throw Failure.custody }
        let reply: [String: Any] = ["schema": 1, "task_id": ticket.taskID, "node_id": ticket.nodeID,
            "attempt_id": ticket.attemptID, "request_sha256": ticket.requestSHA256,
            "output_sha256": C.digest(Data((stored.output ?? "").utf8)), "control_verified": true,
            "observation": try JSONSerialization.jsonObject(with: JSONEncoder().encode(control))]
        let result = try JSONSerialization.data(withJSONObject: reply, options: [.sortedKeys])
        return try persistControlObservation(result, attemptID: ticket.attemptID, root: root)
    }

    static func persistControlObservation(_ result: Data, attemptID: String, root: URL) throws -> Data {
        guard attemptID.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil,
            !result.isEmpty, result.count <= 1_048_576 else { throw Failure.binding }
        try retainedPrivateDirectory(root)
        let file = root.appendingPathComponent(attemptID + ".json")
        let fd = open(file.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        if fd < 0 {
            guard errno == EEXIST, try retainedFile(file.path, parent: root) == result else { throw Failure.custody }
            return result // exact same observation only; never overwrite a conflict
        }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        do { try handle.write(contentsOf: result); try handle.synchronize(); try handle.close() }
        catch { try? handle.close(); throw error }
        guard try retainedFile(file.path, parent: root) == result else { throw Failure.custody }
        return result
    }

    struct HistoricalRuntime: Decodable {
        let app_path: String, bundle_inventory_receipt: String, bundle_inventory_receipt_sha256: String
        let install_receipt: String, install_receipt_sha256: String, cli_sha256: String
    }
    static func historicalRuntime(_ raw: Any) throws -> HistoricalRuntime {
        guard let x = raw as? [String: Any], Set(x.keys) == ["app_path", "bundle_inventory_receipt", "bundle_inventory_receipt_sha256", "install_receipt", "install_receipt_sha256", "cli_sha256"] else { throw Failure.binding }
        let value = try JSONDecoder().decode(HistoricalRuntime.self, from: JSONSerialization.data(withJSONObject: x))
        guard [value.cli_sha256, value.bundle_inventory_receipt_sha256, value.install_receipt_sha256].allSatisfy(C.isHash) else { throw Failure.binding }
        return value
    }
    /// Stable owned evidence read, never execution of the retained artifact.
    static func retainedFile(_ path: String, parent: URL, expected: String? = nil,
                             privateFile: Bool = true, maximum: Int = 8_000_000) throws -> Data {
        let url = URL(fileURLWithPath: path).standardizedFileURL
        guard url.path == path, url.deletingLastPathComponent().path == parent.path,
              url.resolvingSymlinksInPath().path == path, parent.resolvingSymlinksInPath().path == parent.path else { throw Failure.custody }
        let directory = open(parent.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directory >= 0 else { throw Failure.custody }; defer { close(directory) }
        var parentBefore = stat()
        guard fstat(directory, &parentBefore) == 0, parentBefore.st_mode & S_IFMT == S_IFDIR,
            parentBefore.st_mode & (privateFile ? 0o077 : 0o022) == 0,
            parentBefore.st_uid == getuid() || (!privateFile && parentBefore.st_uid == 0) else { throw Failure.custody }
        let fd = openat(directory, url.lastPathComponent, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw Failure.custody }; defer { close(fd) }
        var a = stat(); guard fstat(fd, &a) == 0, a.st_mode & S_IFMT == S_IFREG,
            a.st_uid == getuid() || (!privateFile && a.st_uid == 0), a.st_nlink == 1,
            a.st_size > 0, a.st_size <= maximum, a.st_mode & (privateFile ? 0o077 : 0o022) == 0 else { throw Failure.custody }
        let data = try FileHandle(fileDescriptor: fd, closeOnDealloc: false).read(upToCount: maximum + 1) ?? Data()
        guard data.count <= maximum else { throw Failure.custody }
        var b = stat(), n = stat(), parentNamed = stat()
        guard fstat(fd, &b) == 0, fstatat(directory, url.lastPathComponent, &n, AT_SYMLINK_NOFOLLOW) == 0,
            lstat(parent.path, &parentNamed) == 0, parentBefore.st_dev == parentNamed.st_dev,
            parentBefore.st_ino == parentNamed.st_ino, parent.resolvingSymlinksInPath().path == parent.path,
            a.st_dev == b.st_dev, a.st_ino == b.st_ino,
            a.st_size == b.st_size, a.st_size == data.count, a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec,
            a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec, a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec,
            a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec, b.st_dev == n.st_dev, b.st_ino == n.st_ino, b.st_size == n.st_size,
            b.st_mtimespec.tv_sec == n.st_mtimespec.tv_sec, b.st_mtimespec.tv_nsec == n.st_mtimespec.tv_nsec,
            b.st_ctimespec.tv_sec == n.st_ctimespec.tv_sec, b.st_ctimespec.tv_nsec == n.st_ctimespec.tv_nsec,
            expected.map({ C.digest(data) == $0 }) ?? true else { throw Failure.custody }
        return data
    }
    static func currentPolicyMatches(_ task: C.Request) throws -> Bool {
        let active = try OwnerPolicySnapshot.load(root: OwnerPolicySnapshot.defaultRoot)
        return task.hostContext?.ownerPolicy.map { active?.sourceSHA256 == $0.sourceSHA256 && active?.projectionSHA256 == $0.projectionSHA256 } ?? (active == nil)
    }
    static func currentAccountMatches(_ config: C.ExactConfig) -> Bool {
        BackendAccounts.active(provider: config.surface == .codex ? "codex" : "claude", in: BackendAccounts.load()).id == config.accountID
    }
    static func retainedInteger(_ value: Any?) -> Int? {
        guard let n = value as? NSNumber, String(cString: n.objCType) != "c", n.doubleValue.isFinite,
            n.doubleValue >= 0, n.doubleValue <= 9_007_199_254_740_991, n.doubleValue.rounded(.down) == n.doubleValue else { return nil }
        return n.intValue
    }
    static func retainedPrivateDirectory(_ url: URL) throws {
        var value = stat()
        guard url.path == url.standardizedFileURL.path, url.resolvingSymlinksInPath().path == url.path,
            lstat(url.path, &value) == 0, value.st_mode & S_IFMT == S_IFDIR, value.st_uid == getuid(), value.st_mode & 0o077 == 0 else { throw Failure.custody }
    }
    /// Original artifacts only. This deliberately does not weaken the current
    /// execution profile verifier or make the old CLI executable/dispatchable.
    static func verifyHistoricalRuntime(_ h: HistoricalRuntime, witness w: RCCOperationalQuality.StoredWitness,
                                        record r: C.ExecutionRecord) throws {
        let app = URL(fileURLWithPath: h.app_path).standardizedFileURL, fm = FileManager.default
        guard app.path == h.app_path, app.resolvingSymlinksInPath().path == app.path,
              let input = r.configuredInputObservation, input.harnessSHA256 == h.cli_sha256 else { throw Failure.binding }
        try input.validate(ticket: w.ticket, record: r)
        let manifestURL = URL(fileURLWithPath: h.bundle_inventory_receipt), installURL = URL(fileURLWithPath: h.install_receipt)
        try retainedPrivateDirectory(manifestURL.deletingLastPathComponent())
        try retainedPrivateDirectory(installURL.deletingLastPathComponent())
        guard app.path.hasPrefix(manifestURL.deletingLastPathComponent().path + "/") else { throw Failure.custody }
        let manifestBytes = try retainedFile(manifestURL.path, parent: manifestURL.deletingLastPathComponent(), expected: h.bundle_inventory_receipt_sha256, privateFile: false)
        let installBytes = try retainedFile(installURL.path, parent: installURL.deletingLastPathComponent(), expected: h.install_receipt_sha256)
        guard let manifest = try JSONSerialization.jsonObject(with: manifestBytes) as? [String: Any],
              let installation = try JSONSerialization.jsonObject(with: installBytes) as? [String: Any],
              let rows = manifest["bundle_inventory"] as? [[String: Any]], !rows.isEmpty, rows.count <= 1024,
              let build = retainedInteger(manifest["build"]), build > 0, let version = manifest["version"] as? String,
              let source = manifest["source_commit"] as? String, source.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil,
              retainedInteger(manifest["schema"]) == 1, retainedInteger(manifest["release_exit"]) == 0, retainedInteger(manifest["scanner_findings"]) == 0,
              installation["build"] as? String == String(build), installation["stagedCLIHash"] as? String == h.cli_sha256,
              let checks = installation["checks"] as? [String], checks.count >= 14,
              checks.allSatisfy({ $0.contains(": PASS") && !$0.contains("FAIL") }),
              let completed = installation["completedAt"] as? String else { throw Failure.binding }
        let timestamp = ISO8601DateFormatter(); timestamp.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let installedAt = timestamp.date(from: completed),
            installedAt.timeIntervalSince1970 * 1000 <= Double(input.preparedAtMS),
            w.receipt.map({ $0.observedAt >= installedAt }) == true else { throw Failure.binding }
        let installedApp = SelfUpdate.installedAppURL().resolvingSymlinksInPath().standardizedFileURL
        guard installation["app"] as? String == installedApp.path else { throw Failure.binding }
        var names = Set<String>(), total = 0, hashes: [String: String] = [:]
        for row in rows {
            guard Set(row.keys) == ["path", "kind", "bytes", "sha256"], row["kind"] as? String == "file",
                let name = row["path"] as? String, !name.hasPrefix("/"), !name.contains("\\"), !name.contains("\0"),
                !name.split(separator: "/", omittingEmptySubsequences: false).contains(where: { ["", ".", ".."].contains(String($0)) }),
                names.insert(name).inserted, let bytes = retainedInteger(row["bytes"]), bytes > 0, bytes <= 256_000_000,
                let hash = row["sha256"] as? String, C.isHash(hash) else { throw Failure.custody }
            total += bytes; guard total <= 512_000_000 else { throw Failure.custody }
            let file = app.appendingPathComponent(name).standardizedFileURL
            let data = try retainedFile(file.path, parent: file.deletingLastPathComponent(), expected: hash, privateFile: false, maximum: 256_000_000)
            guard data.count == bytes else { throw Failure.custody }; hashes[name] = hash
        }
        guard hashes["Contents/Resources/os1"] == h.cli_sha256,
              hashes["Contents/MacOS/OS1App"] == installation["stagedAppHash"] as? String,
              let enumerator = fm.enumerator(at: app, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey]) else { throw Failure.custody }
        var actual = Set<String>(), visited = 0
        for case let file as URL in enumerator {
            visited += 1; guard visited <= 4096, file.path.hasPrefix(app.path + "/") else { throw Failure.custody }
            let v = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            guard v.isSymbolicLink != true else { throw Failure.custody }
            if v.isRegularFile == true { actual.insert(String(file.path.dropFirst(app.path.count + 1))); guard actual.count <= 1024 else { throw Failure.custody } }
        }
        guard actual == names,
              let info = try PropertyListSerialization.propertyList(from: retainedFile(app.appendingPathComponent("Contents/Info.plist").path,
                parent: app.appendingPathComponent("Contents"), privateFile: false), format: nil) as? [String: Any],
              info["CFBundleVersion"] as? String == String(build), info["CFBundleShortVersionString"] as? String == version,
              info["OS1SourceCommit"] as? String == source, info["OS1SourceRepository"] as? String == "effacermonexistence/codex" else { throw Failure.binding }
        func requirement(_ url: URL) throws -> String {
            let output = try commandOutput("/usr/bin/codesign", ["--display", "--requirements", "-", url.path], timeout: 30)
            guard output.0 == 0, let line = String(decoding: output.1 + output.2, as: UTF8.self).split(separator: "\n").first(where: { $0.hasPrefix("designated => ") }) else { throw Failure.custody }
            return String(line)
        }
        guard try commandOutput("/usr/bin/codesign", ["--verify", "--deep", "--strict", app.path], timeout: 60).0 == 0,
              try commandOutput("/usr/bin/codesign", ["--verify", "--strict", installedApp.path], timeout: 60).0 == 0 else { throw Failure.custody }
        let designated = try requirement(app)
        guard designated == (try requirement(installedApp)), installation["sourceRequirement"] as? String == designated,
              installation["previousRequirement"] as? String == designated, installation["signerRotation"] as? Bool == false else { throw Failure.binding }
        guard w.localOnlyVerified, let profileSHA = w.nativeProfileSHA256, C.isHash(profileSHA) else { throw Failure.binding }
        let root = RCCOperationalQuality.root.deletingLastPathComponent().appendingPathComponent("local-quality-profiles")
        let profileBytes = try retainedFile(root.appendingPathComponent(w.ticket.attemptID + ".json").path, parent: root, expected: profileSHA)
        guard let profile = try JSONSerialization.jsonObject(with: profileBytes) as? [String: Any],
              retainedInteger(profile["schema"]) == 1, profile["task_id"] as? String == w.ticket.taskID,
              profile["node_id"] as? String == w.ticket.nodeID, profile["attempt_id"] as? String == w.ticket.attemptID,
              profile["configuration_sha256"] as? String == w.ticket.configurationSHA256,
              profile["source_fingerprint"] as? String == w.ticket.sourceFingerprint,
              profile["policy_sha256"] as? String == w.ticket.policySHA256,
              profile["workspace"] as? String == w.ticket.hostContext?.workspace,
              profile["profile"] as? String == RCCNativeLocalQualityProfile.profileID,
              profile["local_only_attestation"] as? Bool == true,
              let sources = profile["source_hashes"] as? [String: String], !sources.isEmpty, sources.count <= 256 else { throw Failure.binding }
        let historicalPaths = Set([installedApp.appendingPathComponent("Contents/Resources/os1").path,
            fm.homeDirectoryForCurrentUser.appendingPathComponent(".local/bin/os1").path])
        guard sources[installedApp.appendingPathComponent("Contents/Resources/os1").path] == h.cli_sha256,
            sources.values.contains(input.launchEntrySHA256) else { throw Failure.binding }
        for (path, hash) in sources {
            guard C.isHash(hash) else { throw Failure.binding }
            if historicalPaths.contains(path) { guard hash == h.cli_sha256 else { throw Failure.binding }; continue }
            let url = URL(fileURLWithPath: path)
            _ = try retainedFile(path, parent: url.deletingLastPathComponent(), expected: hash, privateFile: false, maximum: 256_000_000)
        }
        // Rehash every archived byte after static signature tools; a mutable
        // archive is not made authoritative by a prior successful signature.
        for (name, hash) in hashes {
            let file = app.appendingPathComponent(name)
            _ = try retainedFile(file.path, parent: file.deletingLastPathComponent(), expected: hash, privateFile: false, maximum: 256_000_000)
        }
        // Re-read authority after static signature tools, never execute the archive.
        guard try retainedFile(manifestURL.path, parent: manifestURL.deletingLastPathComponent(), expected: h.bundle_inventory_receipt_sha256, privateFile: false) == manifestBytes,
              try retainedFile(installURL.path, parent: installURL.deletingLastPathComponent(), expected: h.install_receipt_sha256) == installBytes else { throw Failure.custody }
    }

    /// A NEW, current authenticated operator-write adoption scope. This never
    /// renews an old execution contract or permits dispatch. The gateway binds
    /// the exact held snapshot before forwarding this permit to the pinned host.
    struct AdoptionPermit: Decodable {
        struct Child: Decodable {
            let id: String, attempt_id: String, native_receipt_sha256: String, witness_sha256: String
            let contract_sha256: String, verifier_sha256: String
        }
        let schema: Int, kind: String, permit_id: String, task_id: String, request_sha256: String
        let expected_revision: Int, expected_fingerprint: String, expected_snapshot_sha256: String
        let issued_at_ms: Int64, expires_at_ms: Int64
        let parent_contract_sha256: String, parent_checker_sha256: String, context_sha256: String
        let start_tree_sha256: String, reference_policy_sha256: String, source_fingerprint: String
        let owner_policy_source_sha256: String?, owner_policy_projection_sha256: String?
        let collection_manifest_sha256: String, historical_runtime_sha256: String
        let native_generation_calls: Int, dispatch_calls: Int, retry_calls: Int, parity_state: String
        let children: [Child]
        func current(_ now: Date = Date()) throws {
            let ms = now.timeIntervalSince1970 * 1000
            guard ms.isFinite, Double(issued_at_ms) <= ms, ms < Double(expires_at_ms),
                expires_at_ms > issued_at_ms, expires_at_ms - issued_at_ms <= 300_000 else { throw Failure.binding }
        }
    }
    static func adoptionPermit(_ raw: Any) throws -> AdoptionPermit {
        let required: Set<String> = ["schema", "kind", "permit_id", "task_id", "request_sha256", "expected_revision",
            "expected_fingerprint", "expected_snapshot_sha256", "issued_at_ms", "expires_at_ms", "parent_contract_sha256",
            "parent_checker_sha256", "context_sha256", "start_tree_sha256", "reference_policy_sha256", "source_fingerprint",
            "owner_policy_source_sha256", "owner_policy_projection_sha256", "collection_manifest_sha256", "historical_runtime_sha256",
            "native_generation_calls", "dispatch_calls", "retry_calls", "parity_state", "children"]
        guard let x = raw as? [String: Any], Set(x.keys) == required,
            let rows = x["children"] as? [[String: Any]], (2...8).contains(rows.count),
            rows.allSatisfy({ Set($0.keys) == ["id", "attempt_id", "native_receipt_sha256", "witness_sha256", "contract_sha256", "verifier_sha256"] }) else { throw Failure.binding }
        let value = try JSONDecoder().decode(AdoptionPermit.self, from: JSONSerialization.data(withJSONObject: x, options: [.sortedKeys]))
        func id(_ s: String) -> Bool { s.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil }
        guard value.schema == 1, value.kind == "retained_owner_collection_adoption_only", id(value.permit_id), id(value.task_id),
            value.expected_revision > 0, value.issued_at_ms > 0, value.expires_at_ms > 0,
            value.issued_at_ms <= 9_007_199_254_740_991, value.expires_at_ms <= 9_007_199_254_740_991,
            value.native_generation_calls == 0, value.dispatch_calls == 0, value.retry_calls == 0, value.parity_state == "unverified",
            [value.request_sha256, value.expected_fingerprint, value.expected_snapshot_sha256, value.parent_contract_sha256,
             value.parent_checker_sha256, value.context_sha256, value.start_tree_sha256, value.reference_policy_sha256,
             value.source_fingerprint, value.collection_manifest_sha256, value.historical_runtime_sha256].allSatisfy(C.isHash),
            value.owner_policy_source_sha256.map(C.isHash) ?? true,
            value.owner_policy_projection_sha256.map(C.isHash) ?? true,
            Set(value.children.map(\.attempt_id)).count == value.children.count,
            value.children.enumerated().allSatisfy({ i, c in c.id == "owner_\(i)" && id(c.attempt_id) &&
                [c.native_receipt_sha256, c.witness_sha256, c.contract_sha256, c.verifier_sha256].allSatisfy(C.isHash) }) else { throw Failure.binding }
        return value
    }
    static func validateAdoptionPermit(_ permit: AdoptionPermit, task: C.Request, prepared: PreparedTaskQuality,
                                       historical: Any, now: Date = Date()) throws {
        try permit.current(now)
        guard let h = task.hostContext, let spec = prepared.envelope.ownerCollection,
            permit.task_id == task.taskID, permit.request_sha256 == task.requestSHA256,
            permit.source_fingerprint == task.sourceFingerprint,
            permit.parent_contract_sha256 == prepared.envelope.contract.sha256,
            permit.parent_checker_sha256 == prepared.envelope.checkerSHA256,
            permit.context_sha256 == prepared.envelope.contract.contextSHA256,
            permit.start_tree_sha256 == prepared.envelope.contract.startTreeSHA256,
            permit.reference_policy_sha256 == task.policySHA256,
            permit.owner_policy_source_sha256 == h.ownerPolicy?.sourceSHA256,
            permit.owner_policy_projection_sha256 == h.ownerPolicy?.projectionSHA256,
            permit.collection_manifest_sha256 == C.digest(try RCCOperationalQuality.encoded(spec)),
            permit.historical_runtime_sha256 == C.digest(try JSONSerialization.data(withJSONObject: historical, options: [.sortedKeys, .withoutEscapingSlashes])),
            permit.children.count == spec.obligations.count else { throw Failure.binding }
    }
    /// Temporal evidence comes ONLY from the original configured-input witness
    /// and checker receipt, not a caller-supplied historical clock. The current
    /// permit controls adoption now; the old lease controls the original run.
    static func historicalEpoch(_ permit: AdoptionPermit, record: C.ExecutionRecord,
                                witness w: RCCOperationalQuality.StoredWitness,
                                parent: TaskQualityEvidence.Contract, now: Date = Date()) throws -> Date {
        try permit.current(now)
        guard let input = record.configuredInputObservation, let receipt = w.receipt,
            let pin = permit.children.first(where: { $0.id == record.nodeID }),
            pin.attempt_id == record.attemptID, pin.contract_sha256 == w.contract.sha256,
            pin.verifier_sha256 == w.contract.verifierCodeSHA256,
            pin.witness_sha256 == record.operationalQuality?.witnessSHA256 else { throw Failure.binding }
        try input.validate(ticket: w.ticket, record: record)
        let prepared = Date(timeIntervalSince1970: Double(input.preparedAtMS) / 1000), observed = receipt.observedAt
        guard prepared.timeIntervalSince1970.isFinite, observed.timeIntervalSince1970.isFinite,
            parent.issuedAt <= prepared, prepared <= observed, observed < parent.validUntil,
            w.contract.issuedAt <= prepared, observed < w.contract.validUntil, observed <= now,
            TaskQualityEvidence.evaluate(contract: w.contract, receipt: receipt, artifact: w.observedArtifact,
                currentReferencePolicySHA256: permit.reference_policy_sha256, now: observed).taskCompletionVerified else { throw Failure.binding }
        return observed
    }
    /// Only current verification authority is refreshed, in memory. Original
    /// bindings/obligations/checker stay byte-for-byte semantically identical.
    /// This contract is NEVER put in the registry/catalog or used to dispatch.
    static func retrospectiveVerificationContract(_ original: TaskQualityEvidence.Contract,
                                                  permit: AdoptionPermit, now: Date = Date()) throws -> TaskQualityEvidence.Contract {
        try permit.current(now)
        guard original.sha256 == permit.parent_contract_sha256, original.scope == .readOnly,
            original.fullCoverage, original.reference == nil, original.referenceProfiles.isEmpty else { throw Failure.binding }
        var fresh = original
        fresh.issuedAt = Date(timeIntervalSince1970: Double(permit.issued_at_ms) / 1000)
        fresh.validUntil = Date(timeIntervalSince1970: Double(permit.expires_at_ms) / 1000)
        return fresh
    }
    static func retainedCollectionFact(task: C.Request, prepared: PreparedTaskQuality, permit: AdoptionPermit?,
                                       historicalEpoch: Date?, rootURL: URL = PreparedTaskQuality.root,
                                       startTree: (String) -> String = workspaceHash) throws -> C.OwnerCollectionFact? {
        guard let permit else { return try fact(request: task, prepared: prepared, rootURL: rootURL, startTree: startTree) }
        try permit.current()
        guard let historicalEpoch else { throw Failure.binding }
        let result = try fact(request: task, prepared: prepared, now: historicalEpoch, rootURL: rootURL, startTree: startTree)
        guard let result, result.manifestSHA256 == permit.collection_manifest_sha256,
            result.obligations.count == permit.children.count,
            result.obligations.enumerated().allSatisfy({ i, o in o.contractSHA256 == permit.children[i].contract_sha256 &&
                o.verifierSHA256 == permit.children[i].verifier_sha256 }) else { throw Failure.binding }
        return result
    }

    /// Re-read a pre-existing FULL native result. No ticket synthesis, SDK,
    /// planner, adapter, retry, new generation, result rewrite or refund.
    static func retainedChildControl(_ data: Data) throws -> Data {
        guard let x = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            Set(x.keys).subtracting(["adoption_permit"]) == ["task", "child_id", "expected_native_receipt", "expected_native_receipt_sha256", "expected_witness_sha256", "historical_runtime"],
            let taskObject = x["task"], let id = x["child_id"] as? String,
            let path = x["expected_native_receipt"] as? String,
            let receiptSHA = x["expected_native_receipt_sha256"] as? String, C.isHash(receiptSHA),
            let witnessSHA = x["expected_witness_sha256"] as? String, C.isHash(witnessSHA),
            let historical = x["historical_runtime"] else { throw Failure.binding }
        let task = try C.decodeRequest(JSONSerialization.data(withJSONObject: taskObject, options: [.sortedKeys]))
        let archive = try historicalRuntime(historical)
        let permit = try x["adoption_permit"].map(adoptionPermit)
        guard let host = task.hostContext, task.mode == .auto, task.request == task.objective,
            try currentPolicyMatches(task) else { throw Failure.binding }
        try host.ownerPolicy?.verifyOriginal()
        let tree = workspaceHash(host.workspace), context = C.digest(Data((host.context ?? "").utf8))
        let source = (try? SessionHandoff.decode(host.context)).flatMap { $0.source?.sha256 }
        guard let prepared = try PreparedTaskQuality.prepare(objective: task.request, contextSHA256: context, sourceSHA256: source,
            startTreeSHA256: tree, scope: .readOnly, referencePolicySHA256: task.policySHA256, workspace: nil, allowRegressionAcquisition: false) else { throw Failure.binding }
        if let permit { try validateAdoptionPermit(permit, task: task, prepared: prepared, historical: historical) }
        let records = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/rcc-runtime/native-receipts")
        let bytes = try retainedFile(path, parent: records, expected: receiptSHA)
        let record = try C.decodeRecord(bytes)
        guard record.nativeReceipt == path, record.nodeID == id, record.taskID == task.taskID,
            record.status == .succeeded, record.dispatchStage == .dispatched, record.executionVerified,
            record.nativeTurnTerminated == true, record.sideEffects == .none, record.taskVerified,
            record.taskQuality == .taskVerified, record.handback == nil, record.repairSource == nil,
            record.selectedConfig.surface == .codex, record.selectedConfig.transport == .codexAppServer,
            record.selectedConfig.scope == .readOnly, record.selectedConfig == record.acknowledgedConfig,
            currentAccountMatches(record.selectedConfig), let q = record.operationalQuality,
            q.coverage == .full, q.localOnlyVerified, q.assessmentState == .taskContractVerified,
            q.witnessSHA256 == witnessSHA else { throw Failure.binding }
        let witnessBytes = try retainedFile(q.witnessPath, parent: RCCOperationalQuality.root, expected: witnessSHA)
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .millisecondsSince1970
        let w = try decoder.decode(RCCOperationalQuality.StoredWitness.self, from: witnessBytes), ticket = w.ticket
        try C.validate(ticket, request: task); try C.validate(record, ticket: ticket)
        let epoch = try permit.map { try historicalEpoch($0, record: record, witness: w, parent: prepared.envelope.contract) }
        guard let collection = try retainedCollectionFact(task: task, prepared: prepared, permit: permit, historicalEpoch: epoch),
            let index = (0..<collection.obligations.count).first(where: { id == "owner_\($0)" }) else { throw Failure.binding }
        if let pin = permit?.children[index] {
            guard pin.native_receipt_sha256 == receiptSHA, pin.witness_sha256 == witnessSHA else { throw Failure.binding }
        }
        let o = collection.obligations[index]
        guard ticket.nodeID == id, ticket.attemptID == record.attemptID, ticket.candidateID == record.candidateID,
            ticket.instruction == o.instruction, ticket.originalRequest == task.request, ticket.originalObjective == task.objective,
            ticket.contextRefs == task.materialRefs, ticket.ownedPaths.isEmpty, ticket.nativeResumeSessionID == nil,
            ticket.continuation == nil, ticket.qualityContinuation == nil, ticket.allowNativeSubagents != true,
            w.schema == 1, w.localOnlyVerified, w.before != nil, w.after == w.before,
            w.correctiveAttempts == 0, q.correctiveAttempts == w.correctiveAttempts,
            q.contractSHA256 == w.contract.sha256, q.failedCheckIDs == w.assessment.failedCheckIDs,
            q.workspaceAfterSHA256 == w.after?.sha256,
            w.assessment == RCCOperationalQuality.operationalAssessment(TaskQualityEvidence.evaluate(contract: w.contract,
                receipt: w.receipt, artifact: w.observedArtifact, currentReferencePolicySHA256: w.prepared.referencePolicySHA256,
                now: w.receipt?.observedAt ?? w.contract.issuedAt)),
            w.originalInstructionSHA256 == C.digest(Data(ticket.instruction.utf8)), w.originalRequestSHA256 == task.requestSHA256,
            w.originalObjectiveSHA256 == C.digest(Data(task.objective.utf8)),
            w.contract.sha256 == o.contractSHA256, w.contract.verifierCodeSHA256 == o.verifierSHA256,
            w.contract.fullCoverage, w.contract.requiredCheckIDs == o.requiredCheckIDs,
            w.contract.objectiveSHA256 == w.originalInstructionSHA256,
            w.contract.contextSHA256 == RCCOperationalQuality.contextSHA(ticket),
            w.contract.sourceSHA256 == RCCOperationalQuality.sourceSHA(ticket),
            w.contract.startTreeSHA256 == w.artifact.workspaceBeforeHash,
            w.prepared.envelope.contract == w.contract, C.digest(w.prepared.checkerBytes) == o.verifierSHA256,
            w.prepared.referencePolicySHA256 == task.policySHA256,
            w.artifact.output == record.output, w.artifact.model == record.selectedConfig.model,
            w.artifact.effort == record.selectedConfig.effort.rawValue,
            C.digest(try RCCOperationalQuality.encoded(w.artifact)) == q.artifactSHA256,
            w.observedArtifact.binding.artifactSHA256 == q.artifactSHA256,
            w.observedArtifact.binding.outputSHA256 == C.digest(Data((record.output ?? "").utf8)),
            TaskQualityEvidence.evaluate(contract: w.contract, receipt: w.receipt, artifact: w.observedArtifact,
                currentReferencePolicySHA256: task.policySHA256, now: epoch ?? Date()).taskCompletionVerified else { throw Failure.binding }
        try verifyHistoricalRuntime(archive, witness: w, record: record)
        let control = try verifyChildControl(JSONSerialization.data(withJSONObject: ["ticket": try JSONSerialization.jsonObject(with: C.encode(ticket)),
            "record": try JSONSerialization.jsonObject(with: C.encode(record))], options: [.sortedKeys]))
        try verifyHistoricalRuntime(archive, witness: w, record: record)
        guard let reply = try JSONSerialization.jsonObject(with: control) as? [String: Any], let observation = reply["observation"],
            let expectedControl = try? JSONDecoder().decode(NativeTurnControl.Observation.self, from: JSONSerialization.data(withJSONObject: observation)),
            try observeControl(record: record, witness: w) == expectedControl,
            try retainedFile(path, parent: records, expected: receiptSHA) == bytes,
            try retainedFile(q.witnessPath, parent: RCCOperationalQuality.root, expected: witnessSHA) == witnessBytes,
            workspaceHash(host.workspace) == tree, try currentPolicyMatches(task), currentAccountMatches(record.selectedConfig),
            let fresh = try PreparedTaskQuality.prepare(objective: task.request, contextSHA256: context, sourceSHA256: source,
                startTreeSHA256: tree, scope: .readOnly, referencePolicySHA256: task.policySHA256, workspace: nil, allowRegressionAcquisition: false),
            try RCCOperationalQuality.encoded(fresh.envelope) == RCCOperationalQuality.encoded(prepared.envelope), fresh.checkerBytes == prepared.checkerBytes,
            try retainedCollectionFact(task: task, prepared: fresh, permit: permit, historicalEpoch: epoch) == collection else { throw Failure.custody }
        if let permit { try validateAdoptionPermit(permit, task: task, prepared: fresh, historical: historical) }
        return try JSONSerialization.data(withJSONObject: ["schema": 1,
            "record": try JSONSerialization.jsonObject(with: C.encode(record)), "control": try JSONSerialization.jsonObject(with: control)], options: [.sortedKeys])
    }

    /// Parent checker observes a Core collection, NOT a fabricated native turn.
    /// Every child is independently read back from its existing private native
    /// receipt and FULL operational witness before external checker invocation.
    static func verify(_ data: Data, rootURL: URL = PreparedTaskQuality.root,
                       receiptRoot: URL? = nil, startTree: (String) -> String = workspaceHash) throws -> Data {
        guard let x = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            (Set(x.keys).subtracting(["adoption_permit"]) == ["task", "plan", "children"] || Set(x.keys).subtracting(["adoption_permit"]) == ["task", "plan", "children", "historical_runtime"]),
            let taskObject = x["task"], let planObject = x["plan"], let children = x["children"] as? [[String: Any]] else { throw Failure.binding }
        let task = try C.decodeRequest(JSONSerialization.data(withJSONObject: taskObject, options: [.sortedKeys]))
        let historical: HistoricalRuntime?
        if let raw = x["historical_runtime"] { historical = try historicalRuntime(raw) } else { historical = nil }
        let permit = try x["adoption_permit"].map(adoptionPermit)
        guard permit == nil || historical != nil else { throw Failure.binding }
        guard let h = task.hostContext else { throw Failure.binding }
        let activePolicy = try OwnerPolicySnapshot.load(root: OwnerPolicySnapshot.defaultRoot)
        guard h.ownerPolicy.map({ activePolicy?.sourceSHA256 == $0.sourceSHA256 &&
            activePolicy?.projectionSHA256 == $0.projectionSHA256 }) ?? (activePolicy == nil) else { throw Failure.binding }
        guard let planMap = planObject as? [String: Any],
            planMap["final_node_id"] is NSNull else { throw Failure.binding }
        let plan = try C.decodePlan(JSONSerialization.data(withJSONObject: planObject, options: [.sortedKeys]))
        let context = C.digest(Data((h.context ?? "").utf8)), source = (try? SessionHandoff.decode(h.context)).flatMap { $0.source?.sha256 }
        let tree = startTree(h.workspace)
        guard let prepared = try PreparedTaskQuality.prepare(objective: task.request, contextSHA256: context,
            sourceSHA256: source, startTreeSHA256: tree, scope: .readOnly, referencePolicySHA256: task.policySHA256,
            workspace: nil, allowRegressionAcquisition: false, rootURL: rootURL) else { throw Failure.binding }
        var epoch: Date?
        if let permit, let raw = x["historical_runtime"] {
            try validateAdoptionPermit(permit, task: task, prepared: prepared, historical: raw)
            guard let pin = permit.children.first,
                let first = children.first(where: { $0["id"] as? String == pin.id }),
                let path = first["native_receipt"] as? String else { throw Failure.binding }
            let records = (receiptRoot ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/rcc-runtime/native-receipts")).resolvingSymlinksInPath().standardizedFileURL
            let record = try C.decodeRecord(retainedFile(path, parent: records, expected: pin.native_receipt_sha256))
            guard let q = record.operationalQuality, record.taskID == task.taskID, record.nodeID == pin.id,
                record.attemptID == pin.attempt_id, q.witnessSHA256 == pin.witness_sha256 else { throw Failure.binding }
            let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .millisecondsSince1970
            let w = try decoder.decode(RCCOperationalQuality.StoredWitness.self, from: retainedFile(q.witnessPath, parent: RCCOperationalQuality.root, expected: pin.witness_sha256))
            epoch = try historicalEpoch(permit, record: record, witness: w, parent: prepared.envelope.contract)
        }
        guard let collection = try retainedCollectionFact(task: task, prepared: prepared, permit: permit, historicalEpoch: epoch, rootURL: rootURL, startTree: startTree),
            plan.taskID == task.taskID, plan.requestSHA256 == task.requestSHA256,
            plan.nodes.count == collection.obligations.count, children.count == plan.nodes.count,
            Set(children.compactMap { $0["id"] as? String }).count == children.count else { throw Failure.binding }
        let recordsRoot = (receiptRoot ?? FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".os1/rcc-runtime/native-receipts")).resolvingSymlinksInPath().standardizedFileURL
        var objects: [[String: Any]] = [], receiptHashes: [String] = [], controls: [[String: Any]] = [], retainedConfigs: [C.ExactConfig] = []
        var retainedPairs: [(C.ExecutionRecord, RCCOperationalQuality.StoredWitness, String, NativeTurnControl.Observation)] = []
        for (i, o) in collection.obligations.enumerated() {
            let n = plan.nodes[i], id = "owner_\(i)"
            guard n.id == id, n.instruction == o.instruction, n.kind == .agent, n.scope == .readOnly,
                n.dependencies.isEmpty, n.ownedPaths.isEmpty, n.contextRefs == task.materialRefs,
                let child = children.first(where: { $0["id"] as? String == id }),
                child["state"] as? String == "completed", child["candidate_id"] as? String == n.candidateID,
                child["instruction"] as? String == n.instruction,
                let receiptPath = child["native_receipt"] as? String,
                URL(fileURLWithPath: receiptPath).deletingLastPathComponent().path == recordsRoot.path else { throw Failure.binding }
            let bytes = try rccPrivateInput(receiptPath), r = try C.decodeRecord(bytes)
            guard BackendAccounts.active(provider: r.selectedConfig.surface == .codex ? "codex" : "claude",
                in: BackendAccounts.load()).id == r.selectedConfig.accountID else { throw Failure.binding }
            guard r.taskID == task.taskID, r.nodeID == id, r.attemptID == child["attempt_id"] as? String,
                r.candidateID == n.candidateID, r.nativeReceipt == receiptPath,
                r.status == .succeeded, r.dispatchStage == .dispatched, r.executionVerified,
                r.sideEffects == .none, r.taskVerified, r.taskQuality == .taskVerified,
                r.selectedConfig.scope == .readOnly, r.selectedConfig == r.acknowledgedConfig,
                r.operationalQuality?.coverage == .full,
                r.operationalQuality?.assessmentState == .taskContractVerified,
                r.operationalQuality?.contractSHA256 == o.contractSHA256,
                let output = r.output, output == child["output"] as? String,
                let object = try JSONSerialization.jsonObject(with: Data(output.utf8)) as? [String: Any] else { throw Failure.binding }
            guard let q = r.operationalQuality, q.localOnlyVerified,
                URL(fileURLWithPath: q.witnessPath).deletingLastPathComponent().standardizedFileURL.path == RCCOperationalQuality.root.standardizedFileURL.path else { throw Failure.custody }
            let witnessBytes = try rccPrivateInput(q.witnessPath)
            guard C.digest(witnessBytes) == q.witnessSHA256 else { throw Failure.custody }
            let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .millisecondsSince1970
            let w = try decoder.decode(RCCOperationalQuality.StoredWitness.self, from: witnessBytes)
            let childEpoch = try permit.map { p -> Date in
                let pin = p.children[i]
                guard pin.id == id, pin.attempt_id == r.attemptID, pin.native_receipt_sha256 == C.digest(bytes),
                    pin.witness_sha256 == q.witnessSHA256 else { throw Failure.binding }
                return try historicalEpoch(p, record: r, witness: w, parent: prepared.envelope.contract)
            }
            guard w.ticket.taskID == task.taskID, w.ticket.nodeID == id, w.ticket.attemptID == r.attemptID,
                w.ticket.instruction == o.instruction, w.ticket.requestSHA256 == task.requestSHA256,
                w.ticket.sourceFingerprint == task.sourceFingerprint, w.ticket.policySHA256 == task.policySHA256,
                w.ticket.originalRequest == task.request, w.ticket.originalObjective == task.objective,
                w.ticket.selectedConfig == r.selectedConfig, w.contract.sha256 == o.contractSHA256,
                w.contract.verifierCodeSHA256 == o.verifierSHA256, w.contract.fullCoverage,
                w.localOnlyVerified, w.nativeProfileSHA256?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                w.contract.requiredCheckIDs == o.requiredCheckIDs,
                w.artifact.output == output, w.observedArtifact.binding.outputSHA256 == C.digest(Data(output.utf8)),
                TaskQualityEvidence.evaluate(contract: w.contract, receipt: w.receipt,
                    artifact: w.observedArtifact, currentReferencePolicySHA256: task.policySHA256, now: childEpoch ?? Date()).taskCompletionVerified
            else { throw Failure.binding }
            if let historical { try verifyHistoricalRuntime(historical, witness: w, record: r) }
            let control = try observeControl(record: r, witness: w)
            retainedPairs.append((r, w, C.digest(bytes), control))
            controls.append(try JSONSerialization.jsonObject(with: JSONEncoder().encode(control)) as! [String: Any])
            objects.append(object); receiptHashes.append(C.digest(bytes)); retainedConfigs.append(r.selectedConfig)
        }
        let output = String(decoding: try JSONSerialization.data(withJSONObject: objects, options: [.sortedKeys, .withoutEscapingSlashes]), as: UTF8.self)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]; encoder.dateEncodingStrategy = .millisecondsSince1970
        let root = rootURL.appendingPathComponent("collection-runs/" + UUID().uuidString.lowercased(), isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let checker = root.appendingPathComponent("checker.py"), input = root.appendingPathComponent("input.json")
        try prepared.checkerBytes.write(to: checker, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: checker.path)
        // Same existing output/check protocol; this distinct binding truthfully
        // identifies the Core collection and all independently observed receipts.
        let binding: [String: Any] = ["kind": "core_owner_collection_v1", "task_id": task.taskID,
            "request_sha256": task.requestSHA256, "source_fingerprint": task.sourceFingerprint,
            "collection_manifest_sha256": collection.manifestSHA256, "child_receipt_sha256s": receiptHashes, "native_control_observations": controls,
            "output_sha256": C.digest(Data(output.utf8)), "start_tree_sha256": tree]
        let verificationContract = try permit.map { try retrospectiveVerificationContract(prepared.envelope.contract, permit: $0) } ?? prepared.envelope.contract
        let payload: [String: Any] = ["contract": try JSONSerialization.jsonObject(with: encoder.encode(verificationContract)),
            "binding": binding, "workspace": root.path, "output": output]
        try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]).write(to: input, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: input.path)
        let result = try commandOutput("/usr/bin/python3", [checker.path, input.path],
            timeout: prepared.envelope.timeoutSeconds, currentDirectory: root.path,
            environmentOverrides: ["HOME": root.path, "TMPDIR": root.path, "PYTHONNOUSERSITE": "1", "PATH": "/usr/bin:/bin"],
            removingEnvironment: Set(ProcessInfo.processInfo.environment.keys.filter {
                let k = $0.uppercased(); return k.contains("TOKEN") || k.contains("KEY") || k.contains("SECRET") || k.contains("AUTH") || k.contains("PASSWORD")
            }), captureDirectory: root)
        try result.1.write(to: root.appendingPathComponent("stdout.json")); try result.2.write(to: root.appendingPathComponent("stderr.txt"))
        for name in ["stdout.json", "stderr.txt"] {
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: root.appendingPathComponent(name).path)
        }
        let checks = result.0 == 0 && result.1.count <= 128_000 ? try? JSONDecoder().decode([TaskQualityEvidence.Check].self, from: result.1) : nil
        let required = prepared.envelope.contract.requiredCheckIDs
        let passed = checks.map { checks in Set(checks.map(\.checkID)).count == checks.count &&
            Set(checks.map(\.checkID)) == Set(required) && checks.allSatisfy { $0.status == .passed } } ?? false
        // Recovery's archived runtime and current native/hook sources must
        // remain unchanged after the external checker too. No second model or
        // control dispatch occurs; the original raw receipts are only read.
        if let historical {
            for (record, witness, digest, expectedControl) in retainedPairs {
                guard let path = record.nativeReceipt, let quality = record.operationalQuality else { throw Failure.binding }
                _ = try retainedFile(path, parent: recordsRoot, expected: digest)
                _ = try retainedFile(quality.witnessPath, parent: RCCOperationalQuality.root, expected: quality.witnessSHA256)
                try verifyHistoricalRuntime(historical, witness: witness, record: record)
                guard try observeControl(record: record, witness: witness) == expectedControl else { throw Failure.custody }
            }
        }
        // Recheck mutable authority/source after awaited external execution.
        guard startTree(h.workspace) == tree, try currentPolicyMatches(task), retainedConfigs.allSatisfy(currentAccountMatches),
            let fresh = try PreparedTaskQuality.prepare(objective: task.request, contextSHA256: context,
                sourceSHA256: source, startTreeSHA256: tree, scope: .readOnly,
                referencePolicySHA256: task.policySHA256, workspace: nil, allowRegressionAcquisition: false, rootURL: rootURL),
            try encoder.encode(fresh.envelope) == encoder.encode(prepared.envelope),
            fresh.checkerBytes == prepared.checkerBytes,
            try retainedCollectionFact(task: task, prepared: fresh, permit: permit, historicalEpoch: epoch, rootURL: rootURL, startTree: startTree) == collection else { throw Failure.binding }
        let proofObservedAt = Date()
        if let permit, let raw = x["historical_runtime"] {
            try validateAdoptionPermit(permit, task: task, prepared: fresh, historical: raw, now: proofObservedAt)
        }
        var receipt: [String: Any] = ["schema": 1, "kind": "core_owner_collection_checker_v1", "task_id": task.taskID,
            "binding": binding, "checker_sha256": C.digest(prepared.checkerBytes),
            "checker_stdout_sha256": C.digest(result.1), "passed": passed, "native_generation_calls": 0]
        if let permit, let raw = x["adoption_permit"] {
            receipt["retrospective_adoption"] = ["kind": permit.kind, "permit_id": permit.permit_id,
                "adoption_permit_sha256": C.digest(try JSONSerialization.data(withJSONObject: raw, options: [.sortedKeys, .withoutEscapingSlashes])),
                "original_contract_sha256": prepared.envelope.contract.sha256,
                "verification_contract_sha256": verificationContract.sha256,
                "verification_contract": try JSONSerialization.jsonObject(with: encoder.encode(verificationContract)),
                "observed_at_ms": proofObservedAt.timeIntervalSince1970 * 1000, "parity_state": "unverified",
                "dispatch_calls": 0, "retry_calls": 0]
        }
        try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]).write(to: root.appendingPathComponent("receipt.json"))
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: root.appendingPathComponent("receipt.json").path)
        return try JSONSerialization.data(withJSONObject: ["schema": 1, "task_id": task.taskID,
            "task_verified": passed, "output": output, "parity_state": "unverified",
            "reason": passed ? "owner_collection_full_parent_checker_verified" : "owner_collection_parent_checker_failed"], options: [.sortedKeys])
    }
}

/// Synthetic custody/coverage regressions only. No live contract, provider,
/// generation or quality-comparison claim is produced by these fixtures.
func rccOwnerCollectionSelfTest() throws {
    typealias C = RCCRuntimeContract
    let fm = FileManager.default
    let root = fm.temporaryDirectory.appendingPathComponent("os1-owner-collection-fixture-" + UUID().uuidString).resolvingSymlinksInPath()
    let workspace = root.appendingPathComponent("sources"), contracts = root.appendingPathComponent("contracts")
    for p in [root, workspace, contracts, root.appendingPathComponent("checkers")] {
        try fm.createDirectory(at: p, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    }
    defer { try? fm.removeItem(at: root) }
    let sourceA = Data("SOURCE_A: awaiting a recorded written approval.\n".utf8)
    let sourceB = Data("SOURCE_B: visible notification at T; internal change time unspecified.\n".utf8)
    try sourceA.write(to: workspace.appendingPathComponent("a.txt")); try sourceB.write(to: workspace.appendingPathComponent("b.txt"))
    let instructions = ["Return the declared state and source of a.txt as one JSON object.", "Return the visible time and unknown internal time of b.txt as one JSON object."]
    let requestText = "Return these independent obligations as a JSON array, in this exact order.\n\n" + instructions.joined(separator: "\n\n")
    let h = C.HostContext(workspace: workspace.path, context: nil, providerPreference: "auto", codexSessionID: nil,
        claudeSessionID: nil, requireReadOnly: true, ownerPolicy: nil)
    let policy = C.digest(Data("synthetic fixed policy".utf8)), tree = C.digest(Data("synthetic start tree".utf8))
    let request = C.Request(taskID: "fixture-owner-collection", request: requestText, requestSHA256: C.digest(Data(requestText.utf8)),
        objective: requestText, policySHA256: policy, sourceFingerprint: C.digest(try C.encode(h)), mode: .auto,
        materialRefs: [], budget: .init(maxAttempts: 2, maxParallel: 4, maxCostUnits: nil, maxDurationMS: 30_000), hostContext: h)
    let checker = Data("import json\nprint(json.dumps([]))\n".utf8), checkerSHA = C.digest(checker)
    try checker.write(to: root.appendingPathComponent("checkers/" + checkerSHA + ".py"))
    let now = Date(), context = C.digest(Data()), hashes = [C.digest(sourceA), C.digest(sourceB)]
    func prepared(_ text: String, full: Bool = true, collection: TaskQualityEvidence.OwnerCollection? = nil,
                  issued: Date? = nil, until: Date? = nil) throws -> PreparedTaskQuality {
        let contract = TaskQualityEvidence.Contract(basis: .declaredTrustedContract,
            objectiveSHA256: C.digest(Data(text.utf8)), contextSHA256: context, sourceSHA256: nil, startTreeSHA256: tree,
            scope: .readOnly, verifierCodeSHA256: checkerSHA, referencePolicySHA256: policy,
            requiredCheckIDs: ["synthetic.required"], fullCoverage: full, referenceProfiles: [], reference: nil,
            issuedAt: issued ?? now.addingTimeInterval(-10), validUntil: until ?? now.addingTimeInterval(600))
        let envelope = PreparedTaskQuality.Envelope(contract: contract, checkerSHA256: checkerSHA, timeoutSeconds: 10,
            workspacePaths: [], localEffectsOnly: collection != nil, ownerCollection: collection)
        return .init(envelope: envelope, checkerBytes: checker, referencePolicySHA256: policy)
    }
    func saveChild(_ text: String, full: Bool = true, until: Date? = nil) throws {
        let p = try prepared(text, full: full, until: until)
        try RCCOperationalQuality.encoded(p.envelope).write(to: contracts.appendingPathComponent(p.envelope.contract.objectiveSHA256 + ".json"))
    }
    for text in instructions { try saveChild(text) }
    var specs: [TaskQualityEvidence.OwnerCollection.Obligation] = []
    for (i, instruction) in instructions.enumerated() {
        let range = requestText.range(of: instruction)!
        let start = requestText[..<range.lowerBound].utf8.count
        specs.append(.init(id: "source_\(i)", instruction: instruction, requestUTF8Start: start,
            requestUTF8End: start + instruction.utf8.count, sourcePaths: [i == 0 ? "a.txt" : "b.txt"], sourceSHA256s: [hashes[i]]))
    }
    let spec = TaskQualityEvidence.OwnerCollection(obligations: specs)
    var checks = 0
    func check(_ pass: @autoclosure () throws -> Bool, _ name: String) throws {
        guard try pass() else { throw OS1Error.message("Owner collection fixture: " + name) }; checks += 1
    }
    func fact(_ p: PreparedTaskQuality) throws -> C.OwnerCollectionFact? {
        try RCCOwnerCollection.fact(request: request, prepared: p, now: now, rootURL: root, startTree: { _ in tree })
    }
    func rejected(_ p: PreparedTaskQuality) -> Bool { do { _ = try fact(p); return false } catch { return true } }
    try check(try fact(prepared(requestText)) == nil, "absent field stays absent")
    let good = try prepared(requestText, collection: spec)
    let value = try fact(good)
    try check(value?.obligations.count == 2 && value?.obligations.map(\.instruction) == instructions, "exact independent source obligations load")
    try check(try rejected(prepared(requestText, full: false, collection: spec)), "partial parent never becomes FULL")
    var changed = spec; changed.obligations[1].id = changed.obligations[0].id
    try check(try rejected(prepared(requestText, collection: changed)), "duplicate IDs reject")
    changed = spec; changed.obligations[0].instruction += " Rewrite the owner objective."
    try check(try rejected(prepared(requestText, collection: changed)), "instruction not original UTF-8 span rejects")
    changed = spec; changed.obligations[1].requestUTF8Start = 0
    try check(try rejected(prepared(requestText, collection: changed)), "overlapping source spans reject")
    changed = spec; changed.obligations[0].sourcePaths = ["../a.txt"]
    try check(try rejected(prepared(requestText, collection: changed)), "path traversal rejects")
    changed = spec; changed.obligations[0].sourceSHA256s = [C.digest(Data("other source".utf8))]
    try check(try rejected(prepared(requestText, collection: changed)), "changed source bytes reject")
    try saveChild(instructions[0], full: false)
    try check(rejected(good), "partial child cannot inherit parent FULL")
    try saveChild(instructions[0], until: now.addingTimeInterval(-1))
    try check(rejected(good), "expired child rejects")
    try saveChild(instructions[0], until: Date(timeIntervalSince1970: 10_000_000_000_000))
    try check(rejected(good), "unrepresentable child timestamp rejects without trapping")
    try saveChild(instructions[0])
    try check(try rejected(prepared(requestText, collection: spec, until: Date(timeIntervalSince1970: 10_000_000_000_000))),
        "unrepresentable parent timestamp rejects without trapping")
    try fm.removeItem(at: contracts.appendingPathComponent(C.digest(Data(instructions[1].utf8)) + ".json"))
    try check(rejected(good), "missing child checker contract rejects")
    try saveChild(instructions[1])
    try check(try rejected(prepared(requestText, collection: spec, issued: now.addingTimeInterval(60))), "future parent grant rejects")
    try check(try fact(good) == value, "all rejected mutations preserve original valid source")
    print("RCC owner collection: \(checks) synthetic source custody checks PASS; provider/model calls 0")
}
