import Foundation
import Darwin
import OS1System


/// OS-1 repairing OS-1, end to end. A write-scope task edits the source
/// checkout and runs `os1 self-update stage`, which builds the signed release,
/// verifies it and leaves an intent next to the staged app. The running app
/// installs that build by itself as soon as no task is in flight, restarts
/// into it with every conversation and queue preserved, and posts the install
/// receipt into the conversation that asked for the change. Public state only;
/// the installer's own signature, self-test and idle checks still apply.
public enum SelfUpdate {
    /// Installation identity is independent of whichever staged executable is running.
    public static func installedAppURL(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        home.appendingPathComponent("Applications/OS-1 CLODEX.app")
    }
    public static func isInstalledApp(_ bundleURL: URL, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> Bool {
        bundleURL.resolvingSymlinksInPath().standardizedFileURL == installedAppURL(home: home).resolvingSymlinksInPath().standardizedFileURL
    }
    public static func installedBuild(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> Int {
        let info = installedAppURL(home: home).appendingPathComponent("Contents/Info.plist")
        guard let data = try? Data(contentsOf: info),
              let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] else { return 0 }
        if let value = plist["CFBundleVersion"] as? String { return Int(value) ?? 0 }
        return (plist["CFBundleVersion"] as? NSNumber)?.intValue ?? 0
    }
    public static func isTransientInstallFailure(_ text: String) -> Bool {
        ["leave the installation unchanged", "leave installation unchanged", "Fleet work/claim unresolved",
         "queue changed during installation", "another installer owns maintenance lease", "non-installed OS1 writer is running"]
            .contains(where: text.contains)
    }

    /// Match credential tokens, not an embedded suffix in `task-...` filenames.
    public static func secretPatternHit(_ text: String) -> String? {
        let patterns = [
            #"(?<![A-Za-z0-9_])sk-[A-Za-z0-9_-]{20,}"#, #"ghp_[A-Za-z0-9]{30,}"#, #"github_pat_[A-Za-z0-9_]{30,}"#, #"AKIA[0-9A-Z]{16}"#,
            #"-----BEGIN [A-Z ]*PRIVATE KEY-----"#, #"xox[abpr]-[A-Za-z0-9-]{10,}"#, #"AIza[0-9A-Za-z_-]{30,}"#,
        ]
        return patterns.first { text.range(of: $0, options: .regularExpression) != nil }
    }

    public static let runtimeRelativePath = "products/os1-mac-runtime"
    public static let intentRelativePath = "products/os1-mac-runtime/release/self-update-intent.json"
    public static let stagedAppRelativePath = "products/os1-mac-runtime/release/stage/Applications/OS-1 CLODEX.app"
    public static let installerRelativePath = "products/os1-mac-runtime/scripts/install-local-verified.mjs"
    public static let intentMaxAge: TimeInterval = 24 * 3600
    public static let applyingStaleAfter: TimeInterval = 15 * 60
    public static let maximumApplyAttempts = 3

    public struct Intent: Codable, Equatable, Sendable {
        public var schema = 1
        public let build: Int
        public let version: String
        public let sourceRoot: String
        public let sourceCommit: String?
        public let stagedAppSHA256: String
        public let stagedCLISHA256: String
        public let stagedAt: Date
        public let conversationID: String?
        public let submissionID: String?
        public let checks: [String]
        public var state = "pending"
        public var applyAttempts = 0
        public var lastAttemptAt: Date? = nil
        public var lastError: String? = nil

        public init(build: Int, version: String, sourceRoot: String, sourceCommit: String?, stagedAppSHA256: String,
                    stagedCLISHA256: String, stagedAt: Date = Date(), conversationID: String?, submissionID: String?,
                    checks: [String]) {
            self.build = build; self.version = version; self.sourceRoot = sourceRoot; self.sourceCommit = sourceCommit
            self.stagedAppSHA256 = stagedAppSHA256; self.stagedCLISHA256 = stagedCLISHA256; self.stagedAt = stagedAt
            self.conversationID = conversationID.flatMap { UUID(uuidString: $0)?.uuidString }
            self.submissionID = submissionID.flatMap { UUID(uuidString: $0)?.uuidString }
            self.checks = checks
        }
    }

    public struct Outcome: Codable, Equatable, Sendable {
        public let id: String
        public let intent: Intent
        public let success: Bool
        public let receiptPath: String?
        public let error: String?
        public let summary: String
        public let completedAt: Date
        public var reported = false
        /// How many times posting this receipt has been attempted. A receipt
        /// that cannot be confirmed on disk is consumed after a small number
        /// of tries instead of being re-posted forever.
        ///
        /// Optional on purpose: synthesized decoding does NOT fall back to a
        /// property's default value, so a non-optional field added later makes
        /// every previously written record undecodable — which silently hid
        /// all 15 existing receipts the moment this field was introduced.
        /// Every field added to a persisted record from now on must be
        /// optional for the same reason.
        public var postAttempts: Int? = nil

        public init(id: String = UUID().uuidString.lowercased(), intent: Intent, success: Bool, receiptPath: String?,
                    error: String?, summary: String, completedAt: Date = Date()) {
            self.id = id; self.intent = intent; self.success = success; self.receiptPath = receiptPath
            self.error = error.map { String($0.suffix(2_000)) }; self.summary = summary; self.completedAt = completedAt
        }
    }

    public enum ApplyDecision: Equatable, Sendable {
        case apply
        case waitBusy
        case applying
        case notNewer
        case stale
        case exhausted
    }

    // MARK: paths

    public static func intentURL(root: String) -> URL {
        URL(fileURLWithPath: root).appendingPathComponent(intentRelativePath)
    }

    public static func stagedAppURL(root: String) -> URL {
        URL(fileURLWithPath: root).appendingPathComponent(stagedAppRelativePath)
    }

    public static func outcomesDirectory(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        home.appendingPathComponent(".os1/self-update/outcomes", isDirectory: true)
    }

    private static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys, .prettyPrinted]
        return encoder
    }

    private static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    // MARK: intents

    public static func loadIntent(root: String) -> Intent? {
        let url = intentURL(root: root)
        guard let data = try? Data(contentsOf: url), data.count <= 32_768,
              let intent = try? decoder.decode(Intent.self, from: data), intent.schema == 1, intent.build > 0 else { return nil }
        return intent
    }

    public static func save(_ intent: Intent, root: String) throws {
        let url = intentURL(root: root)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try encoder.encode(intent).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    public static func removeIntent(root: String) {
        try? FileManager.default.removeItem(at: intentURL(root: root))
    }

    /// Newest build first; a root without an intent is skipped.
    public static func pendingIntents(roots: [String]) -> [(root: String, intent: Intent)] {
        roots.compactMap { root in loadIntent(root: root).map { (root, $0) } }
            .sorted { $0.intent.build > $1.intent.build }
    }

    /// The app's decision. Only a newer, fresh, not-yet-exhausted intent is
    /// applied, and only while no task is in flight; an "applying" mark that
    /// never produced an outcome is retried after `applyingStaleAfter`.
    public static func decision(intent: Intent, installedBuild: Int, busy: Bool, now: Date = Date()) -> ApplyDecision {
        if intent.build <= installedBuild { return .notNewer }
        if now.timeIntervalSince(intent.stagedAt) > intentMaxAge { return .stale }
        if intent.applyAttempts >= maximumApplyAttempts { return .exhausted }
        if intent.state == "applying", let at = intent.lastAttemptAt, now.timeIntervalSince(at) < applyingStaleAfter { return .applying }
        if busy { return .waitBusy }
        return .apply
    }

    // MARK: outcomes

    public static func saveOutcome(_ outcome: Outcome, home: URL = FileManager.default.homeDirectoryForCurrentUser) throws {
        let directory = outcomesDirectory(home: home)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let url = directory.appendingPathComponent(outcome.id + ".json")
        try encoder.encode(outcome).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    public static func outcomes(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> [Outcome] {
        let directory = outcomesDirectory(home: home)
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path) else { return [] }
        return names.filter { $0.hasSuffix(".json") }.compactMap { name -> Outcome? in
            guard let data = try? Data(contentsOf: directory.appendingPathComponent(name)), data.count <= 65_536 else { return nil }
            return try? decoder.decode(Outcome.self, from: data)
        }.sorted { $0.completedAt < $1.completedAt }
    }

    public static func unreportedOutcomes(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> [Outcome] {
        outcomes(home: home).filter { !$0.reported }
    }

    public static func markReported(_ outcome: Outcome, home: URL = FileManager.default.homeDirectoryForCurrentUser) throws {
        var reported = outcome
        reported.reported = true
        try saveOutcome(reported, home: home)
    }

    /// Posting was attempted but could not be confirmed. After
    /// `maximumPostAttempts` the receipt is consumed anyway: an unconfirmable
    /// receipt must never re-post on every tick (it filled the owner's
    /// conversations with thousands of duplicates on 2026-09-15).
    public static let maximumPostAttempts = 3
    public static func recordPostAttempt(_ outcome: Outcome, home: URL = FileManager.default.homeDirectoryForCurrentUser) throws {
        var value = outcome
        value.postAttempts = (value.postAttempts ?? 0) + 1
        if (value.postAttempts ?? 0) >= maximumPostAttempts { value.reported = true }
        try saveOutcome(value, home: home)
    }

    // MARK: wording

    /// Contract handed to the backend whenever the task's workspace is OS-1's
    /// own source tree. It tells a write task how to finish (stage, never
    /// install by hand) and lets a read-only task answer capability questions
    /// truthfully.
    public static func capabilityCard(root: String, installedVersion: String, installedBuild: Int, sourceCommit: String?,
                                      scope: String, os1Executable: String) -> String {
        let head = sourceCommit.map { String($0.prefix(12)) } ?? "unknown"
        let lines = [
            "--- OS-1 SELF-REPAIR CONTRACT ---",
            "This conversation targets OS-1's own source tree: \(root)",
            "Installed runtime: \(installedVersion) (build \(installedBuild)). Source HEAD: \(head). Task scope: \(scope).",
            "OS-1 repairs itself end to end: diagnose -> edit -> build -> test -> [OS-1: version bump -> signed release -> self-tests -> stage -> commit -> push -> self-install -> receipt]. The only steps that need the owner are browser logins (OAuth) and GitHub pull-request merges.",
            "In a write-scope task your job ends when the source is changed and green:",
            "1. Change the source under \(root)/\(runtimeRelativePath). Make the exact change the owner asked for; when the request is visual, measure (render or pixel-check) instead of estimating.",
            "2. Build and verify: `swift build` (all products) in that directory, then run `.build/debug/OS1ContextTests`, `OS1_CONFIG=\"$HOME/Applications/OS-1 CLODEX.app/Contents/Resources/config.json\" .build/debug/os1 self-test`, `OS1_CONFIG=\"$HOME/Applications/OS-1 CLODEX.app/Contents/Resources/config.json\" .build/debug/os1 fleet-self-test`, and `.build/debug/OS1App` with each of `--self-test`, `--self-test-shell`, `--self-test-composer`, `--self-test-steering`, `--self-test-sidebar-queue`, `--self-test-queue-fork`, `--self-test-parallel`; fix failures before finishing. A tree that does not build or fails a self-test makes this task FAIL with the diagnostic.",
            "3. Do NOT bump versions, do NOT run `self-update stage`, do NOT run scripts/install-local-verified.mjs, and do not kill, relaunch or reinstall OS-1. After independent workflow verification passes (or a verified single-step task finishes), OS-1 itself bumps the build past \(installedBuild), builds the signed release, runs the release self-tests, stages it, commits the change on the current branch, pushes it, installs the build by itself as soon as no task is running, restarts with every conversation and queue preserved, and posts the install receipt into this conversation.",
            "4. Report what you changed and how you verified it. Never claim the build is installed: OS-1 reports that itself in the receipt.",
            "In a read-only task, answer capability questions from this contract and never say OS-1 can only be partially self-repaired; describe the pipeline above and what a write-scope request would do.",
            "--- END OS-1 SELF-REPAIR CONTRACT ---",
        ]
        return lines.joined(separator: "\n")
    }

    public static func summary(success: Bool, intent: Intent, checks: [String], sessionsBefore: Int?, sessionsAfter: Int?,
                               receiptPath: String?, error: String?) -> String {
        let commit = intent.sourceCommit.map { " · 소스 커밋 \(String($0.prefix(7)))" } ?? ""
        if success {
            let sessions = (sessionsBefore != nil && sessionsAfter != nil) ? " · 세션 \(sessionsBefore!)→\(sessionsAfter!)" : ""
            return "OS-1이 자기 자신을 build \(intent.build) (\(intent.version))로 교체했습니다 · 설치기 검사 \(checks.count)개 PASS\(sessions)\(commit)"
                + (receiptPath.map { " · 영수증 \($0)" } ?? "")
        }
        return "OS-1 자체 업데이트 build \(intent.build) (\(intent.version)) 설치 실패 · 이전 빌드를 유지합니다\(commit)"
            + (error.map { " · 원인: \(String($0.suffix(300)))" } ?? "")
    }
}

/// Exactly one installed GUI may open the live store. Diagnostic modes exit before acquiring this lease.
public final class OS1LiveStoreLease {
    private let descriptor: Int32
    public init(home: URL = FileManager.default.homeDirectoryForCurrentUser) throws {
        let root = home.appendingPathComponent("Library/Application Support/OS-1")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        descriptor = Darwin.open(root.appendingPathComponent("live-gui.lock").path, O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw CocoaError(.fileWriteUnknown) }
    }
    public func tryAcquire() -> Bool { os1_flock(descriptor, LOCK_EX | LOCK_NB) == 0 }
    deinit { _ = os1_flock(descriptor, LOCK_UN); Darwin.close(descriptor) }
}
