import Foundation
import Darwin

// A human-entry helper only. No clipboard reads, networking, authentication-cache
// reads, or model calls. The production build accepts no destination arguments.
private enum StoreFailure: Error {
    case invalidKey, invalidHome, unsafeDirectory, directoryUnavailable
    case keyAlreadyExists, fileUnavailable, unsafeFile, writeFailed, syncFailed

    var explanation: String {
        switch self {
        case .invalidKey:
            return "Enter only the newly created Tunnel control-plane key (sk- prefix, 16–4096 printable ASCII characters, no spaces)."
        case .invalidHome:
            return "The current user's home directory could not be safely opened. Nothing was saved."
        case .unsafeDirectory:
            return "An existing storage directory is a link, has another owner, or is not mode 0700. It was not modified."
        case .directoryUnavailable:
            return "The private storage directory could not be created or safely opened."
        case .keyAlreadyExists:
            return "A key or linked object already exists at the destination. It was not read, replaced, or changed."
        case .fileUnavailable, .unsafeFile:
            return "The new private key file could not be safely created."
        case .writeFailed, .syncFailed:
            return "The key could not be durably saved. This helper did not report success."
        }
    }
}

private struct SaveResult {
    let keyPath: String
    let receiptWritten: Bool
}

private enum SecretStore {
    static let folder = "chatgpt-mcp-transport"
    static let file = "control-plane.key"
    static let receiptFile = "secret-entry-receipt.json"

    static func currentHome() throws -> String {
        guard getuid() == geteuid(), let record = getpwuid(getuid()),
              let directory = record.pointee.pw_dir else { throw StoreFailure.invalidHome }
        return String(cString: directory)
    }

    static func validate(_ value: String) -> Bool {
        let bytes = value.utf8
        return value.hasPrefix("sk-") && (16...4096).contains(bytes.count)
            && bytes.allSatisfy { $0 >= 33 && $0 <= 126 }
    }

    static func directoryMetadataIsPrivate(_ info: stat, owner: uid_t) -> Bool {
        info.st_mode & S_IFMT == S_IFDIR && info.st_uid == owner && info.st_mode & 0o7777 == 0o700
    }

    private static func checkedDirectory(_ fd: Int32, privateMode: Bool) throws {
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFDIR,
              info.st_uid == geteuid(), !privateMode || directoryMetadataIsPrivate(info, owner: geteuid())
        else { throw StoreFailure.unsafeDirectory }
        if privateMode && !hasNoExtendedACL(fd) { throw StoreFailure.unsafeDirectory }
    }

    private static func hasNoExtendedACL(_ fd: Int32) -> Bool {
        errno = 0
        guard let acl = acl_get_fd_np(fd, ACL_TYPE_EXTENDED) else { return errno == ENOENT }
        defer { acl_free(UnsafeMutableRawPointer(acl)) }
        var entry: acl_entry_t?
        return acl_get_entry(acl, Int32(ACL_FIRST_ENTRY.rawValue), &entry) == -1 && errno == EINVAL
    }

    // Walk from / with O_NOFOLLOW at EVERY component, not just the final name.
    // Ancestors may be system-owned. Only the actual home must have our owner.
    private static func openHome(_ path: String) throws -> Int32 {
        guard path.hasPrefix("/"), path != "/", !path.utf8.contains(0) else {
            throw StoreFailure.invalidHome
        }
        let parts = path.split(separator: "/", omittingEmptySubsequences: true)
        guard !parts.contains(".."), !parts.contains(".") else { throw StoreFailure.invalidHome }
        var cursor = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
        guard cursor >= 0 else { throw StoreFailure.invalidHome }
        for part in parts {
            let next = openat(cursor, String(part), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
            close(cursor)
            guard next >= 0 else { throw StoreFailure.invalidHome }
            cursor = next
        }
        do { try checkedDirectory(cursor, privateMode: false) }
        catch { close(cursor); throw error }
        return cursor
    }

    private static func privateDirectory(parent: Int32, name: String) throws -> Int32 {
        if mkdirat(parent, name, 0o700) != 0 && errno != EEXIST {
            throw StoreFailure.directoryUnavailable
        }
        let fd = openat(parent, name, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
        guard fd >= 0 else { throw StoreFailure.unsafeDirectory }
        do { try checkedDirectory(fd, privateMode: true) }
        catch { close(fd); throw error }
        return fd
    }

    private static func removeOwnIncompleteFile(parent: Int32, name: String, opened: stat) {
        var current = stat()
        if fstatat(parent, name, &current, AT_SYMLINK_NOFOLLOW) == 0,
           current.st_dev == opened.st_dev, current.st_ino == opened.st_ino {
            _ = unlinkat(parent, name, 0)
        }
    }

    private static func writeExclusive(parent: Int32, name: String, data: Data) throws {
        let fd = openat(parent, name, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard fd >= 0 else {
            if errno == EEXIST { throw StoreFailure.keyAlreadyExists }
            throw StoreFailure.fileUnavailable
        }
        defer { close(fd) }
        var opened = stat()
        guard fstat(fd, &opened) == 0 else {
            // No content was written. Without inode identity do not unlink a
            // name that another process might already have replaced.
            throw StoreFailure.unsafeFile
        }
        do {
            guard opened.st_mode & S_IFMT == S_IFREG, opened.st_uid == geteuid(),
                  opened.st_nlink == 1, opened.st_mode & 0o7777 == 0o600,
                  hasNoExtendedACL(fd)
            else { throw StoreFailure.unsafeFile }
            try data.withUnsafeBytes { bytes in
                var offset = 0
                while offset < bytes.count {
                    guard let base = bytes.baseAddress else { throw StoreFailure.writeFailed }
                    let written = Darwin.write(fd, base.advanced(by: offset), bytes.count - offset)
                    if written < 0 && errno == EINTR { continue }
                    guard written > 0 else { throw StoreFailure.writeFailed }
                    offset += written
                }
            }
            guard fsync(fd) == 0 else { throw StoreFailure.syncFailed }
            // On macOS request durable flush as well as POSIX fsync.
            guard fcntl(fd, F_FULLFSYNC) == 0 else { throw StoreFailure.syncFailed }
            guard fsync(parent) == 0 else { throw StoreFailure.syncFailed }
        } catch {
            removeOwnIncompleteFile(parent: parent, name: name, opened: opened)
            throw error
        }
    }

    static func save(_ value: String, homePath: String) throws -> SaveResult {
        // Validate before opening or creating anything. Never trim silently.
        guard validate(value) else { throw StoreFailure.invalidKey }
        let home = try openHome(homePath)
        defer { close(home) }
        let os1 = try privateDirectory(parent: home, name: ".os1")
        defer { close(os1) }
        let root = try privateDirectory(parent: os1, name: folder)
        defer { close(root) }
        guard fsync(home) == 0, fsync(os1) == 0 else { throw StoreFailure.syncFailed }
        let keyPath = homePath + "/.os1/" + folder + "/" + file
        try writeExclusive(parent: root, name: file, data: Data(value.utf8))

        // Receipt contains no key or hash of the key. It is not authentication
        // evidence and does not claim that a ChatGPT round trip has happened.
        let receipt: [String: Any] = [
            "schema": 1, "event": "human_entered_tunnel_key_saved",
            "key_path": keyPath, "owner_uid": geteuid(), "mode": "0600",
            "created_at": ISO8601DateFormatter().string(from: Date()),
            "network_used": false, "clipboard_read": false,
            "authentication_verified": false
        ]
        let receiptWritten: Bool
        do {
            let encoded = try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys])
            try writeExclusive(parent: root, name: receiptFile, data: encoded)
            receiptWritten = true
        } catch {
            // Preserve the already durable key; do not overwrite any receipt.
            receiptWritten = false
        }
        return SaveResult(keyPath: keyPath, receiptWritten: receiptWritten)
    }
}

#if SECRET_ENTRY_TEST
// The test executable has no GUI and never chooses the production home.
@main
private struct SecretEntryTests {
    static func main() throws {
        guard let canonicalTemp = realpath(NSTemporaryDirectory(), nil) else {
            throw StoreFailure.invalidHome
        }
        let tempPath = String(cString: canonicalTemp)
        free(canonicalTemp)
        let base = URL(fileURLWithPath: tempPath, isDirectory: true)
            .appendingPathComponent("os1-secret-entry-tests-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: base) }
        let dummy = "sk-DUMMY_TEST_ONLY_NOT_A_REAL_CREDENTIAL"
        var passed = 0
        func check(_ condition: @autoclosure () throws -> Bool) throws {
            guard try condition() else { throw NSError(domain: "SecretEntryTest", code: passed + 1) }
            passed += 1
        }
        func home(_ name: String) throws -> URL {
            let result = base.appendingPathComponent(name)
            try FileManager.default.createDirectory(at: result, withIntermediateDirectories: false,
                                                    attributes: [.posixPermissions: 0o700])
            return result
        }
        func rejected(_ value: String, at directory: URL) -> Bool {
            do { _ = try SecretStore.save(value, homePath: directory.path); return false }
            catch { return true }
        }
        func mkdir(_ url: URL, mode: Int = 0o700) throws {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false,
                                                    attributes: [.posixPermissions: mode])
        }
        try check(SecretStore.validate(dummy))
        for invalid in ["", "sk-short", "sk-DUMMY TEST_ONLY", dummy + "\n", " " + dummy,
                        "sk-" + String(repeating: "x", count: 4094), "sk-😀invalidinputlong", dummy + "\0"] {
            try check(!SecretStore.validate(invalid))
        }
        let untouched = try home("invalid-input")
        try check(rejected("bad", at: untouched))
        try check(!FileManager.default.fileExists(atPath: untouched.appendingPathComponent(".os1").path))
        let good = try home("good")
        let saved = try SecretStore.save(dummy, homePath: good.path)
        try check(saved.receiptWritten)
        let keyURL = URL(fileURLWithPath: saved.keyPath)
        try check(try String(contentsOf: keyURL, encoding: .utf8) == dummy)
        let attributes = try FileManager.default.attributesOfItem(atPath: keyURL.path)
        try check((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
        try check((attributes[.ownerAccountID] as? NSNumber)?.uint32Value == geteuid())
        try check((attributes[.referenceCount] as? NSNumber)?.intValue == 1)
        let transport = keyURL.deletingLastPathComponent()
        for directory in [transport, transport.deletingLastPathComponent()] {
            let attrs = try FileManager.default.attributesOfItem(atPath: directory.path)
            try check((attrs[.posixPermissions] as? NSNumber)?.intValue == 0o700)
        }
        let receiptText = try String(contentsOf: transport.appendingPathComponent(SecretStore.receiptFile), encoding: .utf8)
        try check(!receiptText.contains(dummy))
        try check(receiptText.contains("human_entered_tunnel_key_saved"))
        try check(rejected("sk-OTHER_DUMMY_NOT_REAL_CREDENTIAL", at: good))
        try check(try String(contentsOf: keyURL, encoding: .utf8) == dummy)

        let unsafe = try home("public-os1")
        try mkdir(unsafe.appendingPathComponent(".os1"), mode: 0o755)
        try check(rejected(dummy, at: unsafe))
        try check(!FileManager.default.fileExists(atPath: unsafe.appendingPathComponent(".os1/" + SecretStore.folder).path))

        let linked = try home("linked-os1")
        let outside = try home("link-target")
        try FileManager.default.createSymbolicLink(at: linked.appendingPathComponent(".os1"), withDestinationURL: outside)
        try check(rejected(dummy, at: linked))
        try check((try FileManager.default.contentsOfDirectory(atPath: outside.path)).isEmpty)

        let linkedTransport = try home("linked-transport")
        try mkdir(linkedTransport.appendingPathComponent(".os1"))
        try FileManager.default.createSymbolicLink(at: linkedTransport.appendingPathComponent(".os1/" + SecretStore.folder), withDestinationURL: outside)
        try check(rejected(dummy, at: linkedTransport))
        let publicTransport = try home("public-transport")
        try mkdir(publicTransport.appendingPathComponent(".os1"))
        try mkdir(publicTransport.appendingPathComponent(".os1/" + SecretStore.folder), mode: 0o755)
        try check(rejected(dummy, at: publicTransport))

        for kind in ["symlink", "hardlink", "publicfile"] {
            let fixture = try home(kind)
            let root = fixture.appendingPathComponent(".os1/" + SecretStore.folder)
            try mkdir(fixture.appendingPathComponent(".os1")); try mkdir(root)
            let existing = root.appendingPathComponent(SecretStore.file)
            let target = outside.appendingPathComponent(kind)
            try Data("safe fixture marker".utf8).write(to: target)
            if kind == "symlink" {
                try FileManager.default.createSymbolicLink(at: existing, withDestinationURL: target)
            } else if kind == "hardlink" {
                try FileManager.default.linkItem(at: target, to: existing)
            } else {
                try Data("safe fixture marker".utf8).write(to: existing)
                try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: existing.path)
            }
            try check(rejected(dummy, at: fixture))
            try check(try String(contentsOf: target, encoding: .utf8) == "safe fixture marker")
        }
        // No save action (the cancel path) has no filesystem side effects.
        let cancelled = try home("cancel")
        try check((try FileManager.default.contentsOfDirectory(atPath: cancelled.path)).isEmpty)

        // Owner checks are tested with synthetic stat metadata, never by
        // changing real ownership or writing anywhere outside this temp root.
        var metadata = stat()
        metadata.st_mode = mode_t(S_IFDIR) | 0o700; metadata.st_uid = geteuid()
        try check(SecretStore.directoryMetadataIsPrivate(metadata, owner: geteuid()))
        metadata.st_uid = geteuid() &+ 1
        try check(!SecretStore.directoryMetadataIsPrivate(metadata, owner: geteuid()))
        metadata.st_uid = geteuid(); metadata.st_mode = mode_t(S_IFDIR) | 0o750
        try check(!SecretStore.directoryMetadataIsPrivate(metadata, owner: geteuid()))

        let symlinkHome = base.appendingPathComponent("symlink-home")
        try FileManager.default.createSymbolicLink(at: symlinkHome, withDestinationURL: good)
        try check(rejected(dummy, at: symlinkHome))
        let aclHome = try home("acl-test")
        let aclRoot = aclHome.appendingPathComponent(".os1")
        try mkdir(aclRoot)
        let aclCommand = Process()
        aclCommand.executableURL = URL(fileURLWithPath: "/bin/chmod")
        aclCommand.arguments = ["+a", "everyone allow list", aclRoot.path]
        aclCommand.standardOutput = FileHandle.nullDevice
        aclCommand.standardError = FileHandle.nullDevice
        try aclCommand.run(); aclCommand.waitUntilExit()
        try check(aclCommand.terminationStatus == 0)
        try check(rejected(dummy, at: aclHome))
        print("SecretEntry isolated dummy tests: \(passed) PASS; production store untouched; no credentials used.")
    }
}
#else
import AppKit

@MainActor
private final class SetupController: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private var field: NSSecureTextField!
    private var status: NSTextField!
    private var saveButton: NSButton!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu; menu.addItem(editItem); NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 650, height: 390),
                          styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "OS1 MCP Setup — manual credential entry"
        window.delegate = self
        window.isReleasedWhenClosed = false
        let stack = NSStackView()
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 15
        stack.translatesAutoresizingMaskIntoConstraints = false
        let title = NSTextField(labelWithString: "OpenAI Tunnel: newly created control-plane key")
        title.font = .boldSystemFont(ofSize: 18)
        stack.addArrangedSubview(title)
        let text = "This connects the local OS1 MCP return service to your approved OpenAI Tunnel. This helper makes no model/API calls and reads no clipboard or existing credentials.\n\nPaste ONLY the new Tunnel key yourself. Save stores it as a plaintext, owner-only (0600) file on this Mac — not encrypted storage:\n~/.os1/chatgpt-mcp-transport/control-plane.key\n\nAn existing key is never read or overwritten. Cancel saves nothing."
        let details = NSTextField(wrappingLabelWithString: text)
        details.font = .systemFont(ofSize: 13)
        stack.addArrangedSubview(details)
        field = NSSecureTextField()
        field.placeholderString = "Paste the newly created sk-… Tunnel key here"
        field.font = .monospacedSystemFont(ofSize: 14, weight: .regular)
        field.isEditable = true
        field.translatesAutoresizingMaskIntoConstraints = false
        field.widthAnchor.constraint(equalToConstant: 590).isActive = true
        stack.addArrangedSubview(field)
        status = NSTextField(wrappingLabelWithString: "Nothing has been saved.")
        status.textColor = .secondaryLabelColor
        stack.addArrangedSubview(status)
        let actions = NSStackView()
        actions.orientation = .horizontal; actions.spacing = 12
        let cancel = NSButton(title: "Cancel", target: self, action: #selector(cancel))
        cancel.keyEquivalent = "\u{1b}"
        saveButton = NSButton(title: "Save on this Mac", target: self, action: #selector(save))
        // No Return key equivalent: saving requires an explicit button action.
        actions.addArrangedSubview(cancel); actions.addArrangedSubview(saveButton)
        stack.addArrangedSubview(actions)
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 30),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -30),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 26)
        ])
        window.center(); window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.makeFirstResponder(field)
    }

    @objc private func save() {
        do {
            let result = try SecretStore.save(field.stringValue, homePath: SecretStore.currentHome())
            field.stringValue = ""
            field.isEditable = false
            saveButton.isEnabled = false
            status.stringValue = result.receiptWritten
                ? "Saved with owner-only file permissions. No connection or authentication test has been run. You may close this window."
                : "The key is saved with owner-only permissions, but the non-secret receipt could not be saved. The key was preserved. You may close this window."
        } catch let failure as StoreFailure {
            field.stringValue = ""
            status.stringValue = failure.explanation
        } catch {
            field.stringValue = ""
            status.stringValue = "Save failed. No credential values were logged."
        }
    }

    @objc private func cancel() { field.stringValue = ""; NSApp.terminate(nil) }
    func windowWillClose(_ notification: Notification) { field.stringValue = ""; NSApp.terminate(nil) }
}

@main
private struct SecretEntryApplication {
    @MainActor static func main() {
        let app = NSApplication.shared
        let controller = SetupController()
        app.setActivationPolicy(.regular)
        app.delegate = controller
        app.run()
        withExtendedLifetime(controller) {}
    }
}
#endif
