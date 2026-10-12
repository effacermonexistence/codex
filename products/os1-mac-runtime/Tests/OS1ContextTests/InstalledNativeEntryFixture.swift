import CryptoKit
import Darwin
import Foundation
import OS1Context

private enum InstalledNativeEntryFixture {
    static func require(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
        guard try condition() else { throw NSError(domain: "InstalledNativeEntryFixture", code: 1,
                                                  userInfo: [NSLocalizedDescriptionKey: message]) }
    }
    static func run() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.resolvingSymlinksInPath()
            .appendingPathComponent("os1-native-alias-fixture-" + UUID().uuidString)
        try fm.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? fm.removeItem(at: root) }
        let home = root.appendingPathComponent("home")
        let resources = home.appendingPathComponent("Applications/OS-1 CLODEX.app/Contents/Resources")
        let copied = home.appendingPathComponent(".local/bin/os1")
        let bundled = resources.appendingPathComponent("os1")
        let staged = root.appendingPathComponent("source/.build/debug/os1")
        let systemApplications = root.appendingPathComponent("system/Applications")
        let systemCLI = root.appendingPathComponent("system/usr/local/bin/os1")
        for dir in [resources, copied.deletingLastPathComponent(), staged.deletingLastPathComponent(), systemApplications,
                    systemCLI.deletingLastPathComponent()] {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        }
        let bytes = Data("offline-same-installed-binary\n".utf8)
        func write(_ path: URL, _ bytes: Data) throws {
            try bytes.write(to: path)
            try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: path.path)
        }
        for file in [copied, bundled, staged] { try write(file, bytes) }
        var seals = 0
        func resolve(_ exe: URL, _ res: URL? = nil, validSeal: Bool = true,
                     mutation: (() throws -> Void)? = nil) throws -> InstalledNativeEntry.Identity {
            try InstalledNativeEntry.resolve(executable: exe, resources: res ?? resources, home: home,
                systemApplications: systemApplications, systemCLI: systemCLI, verifyResourceSeal: { target in
                    seals += 1; try require(target.path == (res ?? resources).path, "seal checked another resource tree")
                    try mutation?(); return validSeal
                })
        }
        func fails(_ expected: InstalledNativeEntry.Failure, _ body: () throws -> Void) throws {
            do { try body(); throw NSError(domain: "fixture", code: 1,
                                          userInfo: [NSLocalizedDescriptionKey: "invalid alias accepted"]) }
            catch let error as InstalledNativeEntry.Failure { try require(error == expected, "wrong alias failure: expected \(expected), received \(error)") }
        }
        let bundle = try resolve(bundled)
        let copy = try resolve(copied)
        try require(bundle == copy && copy.executable == bundled && copy.canonicalized,
            "same installed bytes became different native identities")
        func identityDigest(_ identity: InstalledNativeEntry.Identity) throws -> String {
            let data = try JSONSerialization.data(withJSONObject: ["native": identity.executable.path,
                "native_sha256": identity.sha256], options: [.sortedKeys])
            return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        }
        try require(try identityDigest(bundle) == identityDigest(copy), "owner/config native digest drifted across installed aliases")
        let sealsBeforeStage = seals
        let stage = try resolve(staged)
        try require(!stage.canonicalized && stage.executable == staged && seals == sealsBeforeStage,
            "staged source impersonated installed entry or acquired app seal authority")
        try require(try identityDigest(stage) != identityDigest(bundle), "staged candidate can retire old owner")
        try write(copied, Data("new-staged-generation".utf8))
        try fails(.bytesDiffer) { _ = try resolve(copied) }
        try write(copied, bytes)
        try fails(.invalidSeal) { _ = try resolve(copied, validSeal: false) }
        try fails(.bytesDiffer) { _ = try resolve(copied, mutation: { try write(bundled, Data("changed-during-seal".utf8)) }) }
        try write(bundled, bytes)
        try fails(.bytesDiffer) { _ = try resolve(copied, mutation: { try write(copied, bytes) }) }
        try fails(.invalidResources) { _ = try resolve(copied, mutation: {
            try fm.setAttributes([.posixPermissions: 0o777], ofItemAtPath: resources.path)
        }) }
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: resources.path)
        try fails(.invalidResources) { _ = try resolve(copied, mutation: {
            try fm.setAttributes([.posixPermissions: 0o777], ofItemAtPath: resources.path)
            try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: resources.path)
        }) }
        try fails(.invalidFile) { _ = try resolve(copied, mutation: {
            try fm.setAttributes([.posixPermissions: 0o775], ofItemAtPath: copied.path)
        }) }
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: copied.path)
        let sealMovedResources = resources.deletingLastPathComponent().appendingPathComponent("seal-moved-resources")
        try fails(.invalidResources) { _ = try resolve(copied, mutation: {
            try fm.moveItem(at: resources, to: sealMovedResources)
            try fm.createSymbolicLink(at: resources, withDestinationURL: sealMovedResources)
        }) }
        try fm.removeItem(at: resources); try fm.moveItem(at: sealMovedResources, to: resources)
        try fails(.invalidResources) { _ = try resolve(copied, mutation: {
            try fm.removeItem(at: copied); try fm.createSymbolicLink(at: copied, withDestinationURL: bundled)
        }) }
        try fm.removeItem(at: copied); try write(copied, bytes)
        try fails(.invalidResources) { _ = try resolve(copied, mutation: {
            // Equal bytes do not excuse inode replacement during signature
            // verification: it was not the measured entry point.
            let replacement = copied.appendingPathExtension("replacement")
            try write(replacement, bytes); try fm.removeItem(at: copied)
            try fm.moveItem(at: replacement, to: copied)
        }) }
        let outside = root.appendingPathComponent("impostor/Contents/Resources")
        try fm.createDirectory(at: outside, withIntermediateDirectories: true)
        try write(outside.appendingPathComponent("os1"), bytes)
        try fails(.invalidResources) { _ = try resolve(copied, outside) }
        try fm.removeItem(at: copied)
        try fm.createSymbolicLink(at: copied, withDestinationURL: bundled)
        try fails(.invalidFile) { _ = try resolve(copied) }
        try fm.removeItem(at: copied); try write(copied, bytes)
        try fm.setAttributes([.posixPermissions: 0o775], ofItemAtPath: copied.path)
        try fails(.invalidFile) { _ = try resolve(copied) }
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: copied.path)
        try fm.setAttributes([.posixPermissions: 0o644], ofItemAtPath: copied.path)
        try fails(.invalidFile) { _ = try resolve(copied) }
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: copied.path)
        try fm.setAttributes([.posixPermissions: 0o777], ofItemAtPath: resources.path)
        try fails(.invalidResources) { _ = try resolve(copied) }
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: resources.path)
        let realResources = resources.deletingLastPathComponent().appendingPathComponent("real-resources")
        try fm.moveItem(at: resources, to: realResources)
        try fm.createSymbolicLink(at: resources, withDestinationURL: realResources)
        try fails(.invalidResources) { _ = try resolve(copied) }
        try fm.removeItem(at: resources); try fm.moveItem(at: realResources, to: resources)
        let otherCopy = root.appendingPathComponent("other-bin/os1")
        try fm.createDirectory(at: otherCopy.deletingLastPathComponent(), withIntermediateDirectories: true)
        try write(otherCopy, bytes)
        try require(try !resolve(otherCopy).canonicalized, "arbitrary byte-identical path became installed alias")
        // The existing resource resolver explicitly supports the system app
        // and /usr/local/bin copy too. Use fixture paths, never /Applications.
        let publicResources = systemApplications.appendingPathComponent("OS-1 CLODEX.app/Contents/Resources")
        try fm.createDirectory(at: publicResources, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try write(publicResources.appendingPathComponent("os1"), bytes); try write(systemCLI, bytes)
        let publicIdentity = try resolve(systemCLI, publicResources)
        try require(publicIdentity.canonicalized && publicIdentity.executable.path == publicResources.appendingPathComponent("os1").path,
            "explicit system installed copy did not canonicalize to its sealed bundle")
        try fails(.invalidSeal) { _ = try resolve(systemCLI, publicResources, validSeal: false) }
        print("Installed native entry: bundle/copy identity PASS; staged separation PASS; bytes/seal/race/permissions/symlink/resource gates PASS; offline temporary files only; owner/process/provider calls 0")
    }
}

func runInstalledNativeEntryFixtures() throws { try InstalledNativeEntryFixture.run() }
