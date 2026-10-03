import AppKit
import Foundation
import LocalAuthentication
import OS1Context

// OS-1 Checkout: the one process that drives the owner's Safari or Chrome for
// a purchase. It is launched through LaunchServices, so the Apple Events
// permission the owner grants it stays here; backends reach a page only
// through this socket, and only this process can press a purchase button —
// after the owner approves the exact item and amount with Touch ID or the
// Mac password (see BrowserCheckout for the gates).

typealias Browser = BrowserCheckout.Browser
typealias BrokerError = BrowserCheckout.BrokerError

// MARK: - Apple Events

@MainActor
final class BrowserScripts {
    private var compiled: [Browser: NSAppleScript] = [:]

    func call(_ browser: Browser, _ handler: String, _ parameters: [String]) -> Result<String, BrokerError> {
        let script: NSAppleScript
        if let existing = compiled[browser] {
            script = existing
        } else {
            guard let made = NSAppleScript(source: BrowserCheckout.appleScriptSource(browser)) else {
                return .failure(BrokerError(code: "browser_script_failed", message: "The \(browser.displayName) script could not be created."))
            }
            var compileError: NSDictionary?
            guard made.compileAndReturnError(&compileError) else {
                return .failure(Self.failure(browser, compileError))
            }
            compiled[browser] = made
            script = made
        }
        // kASAppleScriptSuite / kASSubroutineEvent, keyASSubroutineName, keyDirectObject.
        let event = NSAppleEventDescriptor(eventClass: 0x6173_6372, eventID: 0x7073_6272,
                                           targetDescriptor: NSAppleEventDescriptor.currentProcess(),
                                           returnID: AEReturnID(-1), transactionID: AETransactionID(0))
        event.setParam(NSAppleEventDescriptor(string: handler.lowercased()), forKeyword: 0x736E_616D)
        let list = NSAppleEventDescriptor.list()
        for (index, value) in parameters.enumerated() {
            list.insert(NSAppleEventDescriptor(string: value), at: index + 1)
        }
        event.setParam(list, forKeyword: 0x2D2D_2D2D)
        var errorInfo: NSDictionary?
        let result = script.executeAppleEvent(event, error: &errorInfo)
        if let errorInfo { return .failure(Self.failure(browser, errorInfo)) }
        return .success(result.stringValue ?? "")
    }

    private static func failure(_ browser: Browser, _ info: NSDictionary?) -> BrokerError {
        let number = (info?[NSAppleScript.errorNumber] as? NSNumber)?.intValue ?? 0
        let message = (info?[NSAppleScript.errorMessage] as? String) ?? (info?[NSAppleScript.errorBriefMessage] as? String) ?? ""
        switch BrowserCheckout.classifyScriptError(number: number, message: message) {
        case .automationDenied:
            return BrokerError(code: "automation_permission_missing",
                               message: "macOS has not allowed OS-1 Checkout to control \(browser.applicationName).",
                               ownerStep: BrowserCheckout.automationSetupStep(browser))
        case .javaScriptDisabled:
            return BrokerError(code: "javascript_from_apple_events_off",
                               message: "\(browser.applicationName) does not accept JavaScript from Apple Events.",
                               ownerStep: BrowserCheckout.javaScriptSetupStep(browser))
        case .browserNotRunning:
            return BrokerError(code: "browser_not_running", message: "\(browser.applicationName) is not running (\(number)).")
        case .windowGone:
            return BrokerError(code: "window_closed", message: "The checkout window was closed.")
        case .other:
            return BrokerError(code: "browser_script_failed", message: "\(browser.applicationName): \(message) (\(number))")
        }
    }
}

// MARK: - Owner approval

enum ApprovalDecision: Sendable { case approved, declined, timedOut, unavailable(String) }

final class DecisionBox: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: ApprovalDecision = .declined
    var value: ApprovalDecision {
        get { lock.withLock { stored } }
        set { lock.withLock { stored = newValue } }
    }
}

func authenticateOwner(reason: String, timeout: TimeInterval) -> ApprovalDecision {
    let context = LAContext()
    context.localizedCancelTitle = "거절"
    context.touchIDAuthenticationAllowableReuseDuration = 0
    var error: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
        return .unavailable(error?.localizedDescription ?? "Owner authentication is unavailable on this Mac.")
    }
    let box = DecisionBox()
    let done = DispatchSemaphore(value: 0)
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
        box.value = success ? .approved : .declined
        done.signal()
    }
    if done.wait(timeout: .now() + timeout) == .timedOut {
        context.invalidate()
        _ = done.wait(timeout: .now() + 5)
        return .timedOut
    }
    return box.value
}

// MARK: - Broker

final class CheckoutBroker: @unchecked Sendable {
    struct Session { let id: String; let browser: Browser; let windowID: String }
    struct Approval {
        let id: String
        let sessionID: String
        let host: String
        let confirmName: String
        let request: BrowserCheckout.ApprovalRequest
        let executionID: String?
        let approvedAt: Date
        let expiresAt: Date
        var used: Bool
    }

    let queue = DispatchQueue(label: "com.omaragi.os1.checkout.broker")
    private let scripts: BrowserScripts
    private let lock = NSLock()
    private var sessions: [String: Session] = [:]
    private var approvals: [String: Approval] = [:]
    private var receipts: [BrowserCheckout.Receipt] = []
    private var lastActivity = Date()
    private var approving = false
    private let audit: URL
    private let iso = ISO8601DateFormatter()

    init(scripts: BrowserScripts) {
        self.scripts = scripts
        audit = BrowserCheckout.directory().appendingPathComponent("audit.jsonl")
    }

    var idleSeconds: TimeInterval { lock.withLock { approving ? 0 : Date().timeIntervalSince(lastActivity) } }

    func handle(_ data: Data) -> Data {
        lock.withLock { lastActivity = Date() }
        let response: BrowserCheckout.BrokerResponse
        if let request = try? JSONDecoder().decode(BrowserCheckout.BrokerRequest.self, from: data) {
            do { response = BrowserCheckout.BrokerResponse(ok: true, result: try perform(request)) }
            catch let error as BrokerError { response = BrowserCheckout.BrokerResponse(ok: false, error: error) }
            catch { response = BrowserCheckout.BrokerResponse(ok: false, error: BrokerError(code: "internal", message: "\(error)")) }
        } else {
            response = BrowserCheckout.BrokerResponse(ok: false, error: BrokerError(code: "bad_request", message: "Unreadable request."))
        }
        lock.withLock { lastActivity = Date() }
        return (try? JSONEncoder().encode(response)) ?? Data(#"{"ok":false}"#.utf8)
    }

    // MARK: Operations

    private func perform(_ request: BrowserCheckout.BrokerRequest) throws -> String {
        let args = request.args
        switch request.op {
        case "status": return try json(status())
        case "open": return try open(url: args["url"] ?? "", browserName: args["browser"] ?? "auto")
        case "snapshot":
            let session = try session(args)
            return try json(present(try snapshot(session)))
        case "click": return try click(try session(args), ref: try required(args, "ref"))
        case "type": return try type(try session(args), ref: try required(args, "ref"), text: args["text"] ?? "")
        case "select": return try select(try session(args), ref: try required(args, "ref"), value: try required(args, "value"))
        case "check": return try check(try session(args), ref: try required(args, "ref"), value: args["value"] ?? "true")
        case "wait":
            return try wait(try session(args), seconds: min(max(Double(args["seconds"] ?? "3") ?? 3, 0.5), 20), text: args["text"])
        case "request_approval": return try requestApproval(try session(args), args: args, terms: request.list?["terms_refs"] ?? [],
                                                             executionID: request.executionID)
        case "confirm": return try confirm(try session(args), approvalID: try required(args, "approval_id"), executionID: request.executionID)
        case "receipts":
            let id = request.executionID
            let matching = lock.withLock { receipts.filter { id == nil || $0.executionID == id } }
            return String(decoding: try JSONEncoder().encode(matching), as: UTF8.self)
        case "close":
            let session = try session(args)
            _ = runScript(session.browser, "os1Close", [session.windowID])
            _ = lock.withLock { sessions.removeValue(forKey: session.id) }
            return try json(["closed": true])
        default:
            throw BrokerError(code: "unknown_op", message: "Unknown operation \(request.op).")
        }
    }

    private func status() -> [String: Any] {
        let installed = Browser.allCases.map { browser -> [String: Any] in
            [
                "browser": browser.rawValue,
                "installed": NSWorkspace.shared.urlForApplication(withBundleIdentifier: browser.bundleIdentifier) != nil,
                "running": !NSRunningApplication.runningApplications(withBundleIdentifier: browser.bundleIdentifier).isEmpty,
            ]
        }
        let biometric = LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        let owner = LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
        return [
            "browsers": installed,
            "default_browser": defaultBrowser()?.rawValue ?? "none",
            "owner_approval": owner ? (biometric ? "touch_id_or_password" : "password") : "unavailable",
            "open_sessions": lock.withLock { sessions.count },
            "setup_once": Browser.allCases.map { BrowserCheckout.javaScriptSetupStep($0) },
        ]
    }

    private func defaultBrowser() -> Browser? {
        guard let url = URL(string: "https://example.com"),
              let app = NSWorkspace.shared.urlForApplication(toOpen: url),
              let identifier = Bundle(url: app)?.bundleIdentifier else { return nil }
        return Browser.allCases.first { $0.bundleIdentifier == identifier }
    }

    private func open(url: String, browserName: String) throws -> String {
        guard let target = URL(string: url), let scheme = target.scheme?.lowercased(), let host = target.host?.lowercased(),
              scheme == "https" || (scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host)) else {
            throw BrokerError(code: "bad_url", message: "Only https pages (or http on localhost) can be opened.")
        }
        let browser: Browser
        switch browserName.lowercased() {
        case "safari": browser = .safari
        case "chrome", "google chrome": browser = .chrome
        default: browser = defaultBrowser() ?? .safari
        }
        guard NSWorkspace.shared.urlForApplication(withBundleIdentifier: browser.bundleIdentifier) != nil else {
            throw BrokerError(code: "browser_not_installed", message: "\(browser.applicationName) is not installed.")
        }
        let windowID = try runScript(browser, "os1Open", [target.absoluteString]).get()
        let session = Session(id: UUID().uuidString, browser: browser, windowID: windowID)
        lock.withLock { sessions[session.id] = session }
        writeAudit(["event": "open", "session": session.id, "browser": browser.rawValue, "host": host])
        let page = try waitForLoad(session, timeout: 20)
        return try json(["session": session.id, "browser": browser.rawValue, "url": page.url, "title": page.title])
    }

    private func click(_ session: Session, ref: String) throws -> String {
        let page = try snapshot(session)
        let element = try element(ref, in: page)
        switch BrowserCheckout.gate(for: element, in: page) {
        case .none: break
        case .ownerOnly: throw ownerOnly(element)
        case .finalPurchase, .termsAgreement: throw approvalRequired(element)
        }
        guard !element.disabled else { throw BrokerError(code: "disabled", message: "That control is disabled.") }
        _ = try evaluate(session, ["op": "click", "ref": ref])
        Thread.sleep(forTimeInterval: 0.6)
        let after = try? waitForLoad(session, timeout: 10)
        return try json(["clicked": ref, "url": after?.url ?? page.url, "title": after?.title ?? page.title])
    }

    private func type(_ session: Session, ref: String, text: String) throws -> String {
        let page = try snapshot(session)
        let element = try element(ref, in: page)
        if BrowserCheckout.gate(for: element, in: page) == .ownerOnly { throw ownerOnly(element) }
        guard ["textbox", "searchbox", "combobox", "spinbutton"].contains(element.role) || element.tag == "textarea" else {
            throw BrokerError(code: "not_a_text_field", message: "\(ref) is not a text field.")
        }
        _ = try evaluate(session, ["op": "type", "ref": ref, "text": text])
        return try json(["typed": ref])
    }

    private func select(_ session: Session, ref: String, value: String) throws -> String {
        let page = try snapshot(session)
        let element = try element(ref, in: page)
        if BrowserCheckout.gate(for: element, in: page) == .ownerOnly { throw ownerOnly(element) }
        let result = try evaluate(session, ["op": "select", "ref": ref, "value": value])
        guard result["ok"] as? Bool == true else { throw BrokerError(code: "option_not_found", message: "No option \(value).") }
        return try json(["selected": value])
    }

    private func check(_ session: Session, ref: String, value: String) throws -> String {
        let page = try snapshot(session)
        let element = try element(ref, in: page)
        switch BrowserCheckout.gate(for: element, in: page) {
        case .none: break
        case .ownerOnly: throw ownerOnly(element)
        case .finalPurchase, .termsAgreement: throw approvalRequired(element)
        }
        let result = try evaluate(session, ["op": "check", "ref": ref, "value": value == "false" ? "false" : "true"])
        return try json(["checked": result["checked"] as? Bool ?? false])
    }

    private func wait(_ session: Session, seconds: Double, text: String?) throws -> String {
        let deadline = Date().addingTimeInterval(seconds)
        var page = try snapshot(session)
        while Date() < deadline {
            if let text, !text.isEmpty, page.text.localizedCaseInsensitiveContains(text) { break }
            if (text ?? "").isEmpty && page.ready == "complete" { break }
            Thread.sleep(forTimeInterval: 0.5)
            page = (try? snapshot(session)) ?? page
        }
        let found = text.map { page.text.localizedCaseInsensitiveContains($0) }
        return try json(["url": page.url, "title": page.title, "ready": page.ready, "found": found as Any])
    }

    private func requestApproval(_ session: Session, args: [String: String], terms: [String], executionID: String?) throws -> String {
        let request = BrowserCheckout.ApprovalRequest(
            merchant: args["merchant"] ?? "", item: args["item"] ?? "", amount: args["amount"] ?? "",
            period: args["period"], renewal: args["renewal"], paymentMethod: args["payment_method"],
            confirmRef: args["confirm_ref"] ?? "", termsRefs: terms)
        let page = try snapshot(session)
        if let problem = BrowserCheckout.validate(request, against: page) {
            throw BrokerError(code: problem.rawValue, message: Self.explain(problem))
        }
        guard let confirm = page.elements.first(where: { $0.ref == request.confirmRef }),
              let host = URL(string: page.url)?.host else {
            throw BrokerError(code: "confirm_ref_not_found", message: Self.explain(.confirmRefNotFound))
        }
        let busy = lock.withLock { () -> Bool in
            if approving { return true }
            approving = true
            return false
        }
        if busy { throw BrokerError(code: "approval_in_progress", message: "Another approval is waiting for the owner.") }
        defer { lock.withLock { approving = false } }
        // The owner-authentication panel is a system panel: it appears over
        // every app without OS-1 bringing anything forward.
        let reason = BrowserCheckout.approvalReason(request)
        writeAudit(["event": "approval_requested", "session": session.id, "host": host, "merchant": request.merchant,
                    "item": request.item, "amount": request.amount])
        let decision = authenticateOwner(reason: reason, timeout: 180)
        switch decision {
        case .approved:
            let approval = Approval(id: UUID().uuidString, sessionID: session.id, host: host, confirmName: confirm.name,
                                    request: request, executionID: executionID, approvedAt: Date(),
                                    expiresAt: Date().addingTimeInterval(300), used: false)
            lock.withLock { approvals[approval.id] = approval }
            writeAudit(["event": "approved", "approval_id": approval.id, "session": session.id, "host": host])
            return try json(["approved": true, "approval_id": approval.id, "expires_in_seconds": 300])
        case .declined:
            writeAudit(["event": "declined", "session": session.id, "host": host])
            return try json(["approved": false, "reason": "owner_declined"])
        case .timedOut:
            writeAudit(["event": "approval_timed_out", "session": session.id, "host": host])
            return try json(["approved": false, "reason": "timed_out"])
        case .unavailable(let message):
            throw BrokerError(code: "approval_unavailable", message: message)
        }
    }

    private func confirm(_ session: Session, approvalID: String, executionID: String?) throws -> String {
        guard var approval = lock.withLock({ approvals[approvalID] }) else {
            throw BrokerError(code: "approval_not_found", message: "No such approval. Request the owner's approval first.")
        }
        guard approval.sessionID == session.id else { throw BrokerError(code: "approval_other_session", message: "That approval belongs to another window.") }
        guard !approval.used else { throw BrokerError(code: "approval_used", message: "That approval was already used.") }
        guard approval.expiresAt > Date() else { throw BrokerError(code: "approval_expired", message: "The approval expired; ask the owner again.") }
        let page = try snapshot(session)
        guard URL(string: page.url)?.host == approval.host,
              let button = page.elements.first(where: { $0.ref == approval.request.confirmRef }),
              button.name == approval.confirmName, !button.disabled,
              BrowserCheckout.gate(for: button, in: page) == .finalPurchase else {
            throw BrokerError(code: "page_changed", message: "The checkout page changed after the owner approved; ask again.")
        }
        guard BrowserCheckout.amountAppears(approval.request.amount, in: page.text) else {
            throw BrokerError(code: "amount_changed", message: "The approved amount is no longer on the page; ask the owner again.")
        }
        for ref in approval.request.termsRefs {
            let result = try evaluate(session, ["op": "check", "ref": ref, "value": "true"])
            guard result["checked"] as? Bool == true else {
                throw BrokerError(code: "terms_not_checked", message: "A terms box could not be checked.")
            }
        }
        approval.used = true
        lock.withLock { approvals[approvalID] = approval }
        _ = try evaluate(session, ["op": "click", "ref": approval.request.confirmRef])
        let deadline = Date().addingTimeInterval(20)
        var after = page
        while Date() < deadline {
            Thread.sleep(forTimeInterval: 0.8)
            if let next = try? snapshot(session) {
                after = next
                if next.ready == "complete" && (next.url != page.url || BrowserCheckout.looksLikeOrderConfirmation(next)) { break }
            }
        }
        let result: [String: Any] = ["url": after.url, "title": after.title, "text": String(after.text.prefix(900))]
        // A gated press that only moved the checkout on ("Buy" → cart) is no
        // purchase: no receipt, and the final button needs a new approval.
        guard BrowserCheckout.looksLikeOrderConfirmation(after) else {
            writeAudit(["event": "pressed_without_order_confirmation", "approval_id": approval.id, "session": session.id,
                        "host": approval.host])
            return try json(["completed": false, "result": result,
                             "note": "The approved button was pressed but the page does not show an order confirmation. Continue to the final purchase button and ask the owner again if it needs approval."])
        }
        let receipt = BrowserCheckout.Receipt(
            approvalID: approval.id, executionID: executionID ?? approval.executionID, merchant: approval.request.merchant,
            item: approval.request.item, amount: approval.request.amount, approvedAt: iso.string(from: approval.approvedAt),
            confirmedAt: iso.string(from: Date()), resultURL: after.url, resultTitle: after.title)
        lock.withLock { receipts.append(receipt) }
        writeAudit(["event": "confirmed", "approval_id": approval.id, "session": session.id, "host": approval.host,
                    "merchant": receipt.merchant, "item": receipt.item, "amount": receipt.amount])
        return try json([
            "completed": true,
            "receipt": try JSONSerialization.jsonObject(with: JSONEncoder().encode(receipt)),
            "result": result,
        ])
    }

    // MARK: Page helpers

    private func session(_ args: [String: String]) throws -> Session {
        let id = try required(args, "session")
        guard let session = lock.withLock({ sessions[id] }) else {
            throw BrokerError(code: "session_not_found", message: "No open checkout window \(id). Use browser_open first.")
        }
        return session
    }

    private func required(_ args: [String: String], _ key: String) throws -> String {
        guard let value = args[key]?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            throw BrokerError(code: "missing_argument", message: "\(key) is required.")
        }
        return value
    }

    private func runScript(_ browser: Browser, _ handler: String, _ parameters: [String]) -> Result<String, BrokerError> {
        let scripts = self.scripts
        return DispatchQueue.main.sync { MainActor.assumeIsolated { scripts.call(browser, handler, parameters) } }
    }

    private func evaluate(_ session: Session, _ command: [String: String]) throws -> [String: Any] {
        let text = try runScript(session.browser, "os1Eval", [session.windowID, BrowserCheckout.pageScript(command: command)]).get()
        guard let object = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] else {
            throw BrokerError(code: "page_not_ready", message: "The page did not answer; it may still be loading.")
        }
        if object["ok"] as? Bool == false {
            throw BrokerError(code: (object["error"] as? String) ?? "page_error", message: "The page refused: \(object["error"] ?? "")")
        }
        return object
    }

    private func snapshot(_ session: Session) throws -> BrowserCheckout.Snapshot {
        let text = try runScript(session.browser, "os1Eval", [session.windowID, BrowserCheckout.pageScript(command: ["op": "snapshot"])]).get()
        guard let page = try? JSONDecoder().decode(BrowserCheckout.Snapshot.self, from: Data(text.utf8)) else {
            throw BrokerError(code: "page_not_ready", message: "The page did not answer; it may still be loading.")
        }
        return page
    }

    private func waitForLoad(_ session: Session, timeout: TimeInterval) throws -> BrowserCheckout.Snapshot {
        let deadline = Date().addingTimeInterval(timeout)
        var lastError: Error = BrokerError(code: "page_not_ready", message: "The page did not finish loading.")
        repeat {
            do {
                let page = try snapshot(session)
                if page.ready == "complete" || Date() >= deadline { return page }
            } catch let error as BrokerError where ["automation_permission_missing", "javascript_from_apple_events_off",
                                                     "window_closed", "browser_not_installed"].contains(error.code) {
                throw error
            } catch { lastError = error }
            Thread.sleep(forTimeInterval: 0.5)
        } while Date() < deadline
        throw lastError
    }

    private func element(_ ref: String, in page: BrowserCheckout.Snapshot) throws -> BrowserCheckout.Element {
        guard let element = page.elements.first(where: { $0.ref == ref }) else {
            throw BrokerError(code: "ref_not_found", message: "\(ref) is not on the page now; take a new snapshot.")
        }
        return element
    }

    private func present(_ page: BrowserCheckout.Snapshot) -> [String: Any] {
        let elements = page.elements.map { element -> [String: Any] in
            var row: [String: Any] = ["ref": element.ref, "role": element.role, "name": element.name]
            let gate = BrowserCheckout.gate(for: element, in: page)
            if gate != .none { row["gate"] = gate.rawValue }
            if !element.type.isEmpty, element.tag == "input" { row["type"] = element.type }
            if let checked = element.checked { row["checked"] = checked }
            if element.disabled { row["disabled"] = true }
            if let href = element.href, !href.isEmpty { row["href"] = href }
            if let hasValue = element.hasValue { row["has_value"] = hasValue }
            return row
        }
        return ["url": page.url, "title": page.title, "ready": page.ready, "payment_step": BrowserCheckout.isPaymentStep(page),
                "text": page.text, "elements": elements, "frames": page.frames]
    }

    private func ownerOnly(_ element: BrowserCheckout.Element) -> BrokerError {
        BrokerError(code: "owner_only_field",
                    message: "\(element.ref) (\(element.name)) takes card data, a password or a one-time code: only the owner types it.",
                    ownerStep: "‘\(element.name)’ 칸은 직접 입력해 주세요.")
    }

    private func approvalRequired(_ element: BrowserCheckout.Element) -> BrokerError {
        BrokerError(code: "approval_required",
                    message: "\(element.ref) (\(element.name)) completes the purchase or accepts terms: call purchase_request_approval with it as confirm_ref (or in terms_refs), then purchase_confirm.")
    }

    static func explain(_ problem: BrowserCheckout.ApprovalProblem) -> String {
        switch problem {
        case .missingField: return "merchant, item, amount and confirm_ref are required."
        case .confirmRefNotFound: return "confirm_ref is not on the page; take a new snapshot."
        case .confirmRefNotPurchase: return "confirm_ref is not the final purchase button on this page."
        case .confirmRefDisabled: return "The purchase button is disabled; something on the page still needs the owner or a choice."
        case .termsRefInvalid: return "Every terms_refs entry must be a terms or agreement checkbox on this page."
        case .amountNotOnPage: return "The amount must be the total shown on this page."
        }
    }

    private func json(_ object: Any) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), as: UTF8.self)
    }

    private func writeAudit(_ fields: [String: String]) {
        var record = fields
        record["at"] = iso.string(from: Date())
        guard let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]) else { return }
        if !FileManager.default.fileExists(atPath: audit.path) {
            FileManager.default.createFile(atPath: audit.path, contents: nil, attributes: [.posixPermissions: 0o600])
        }
        if let handle = try? FileHandle(forWritingTo: audit) {
            handle.seekToEndOfFile()
            handle.write(data + Data("\n".utf8))
            try? handle.close()
        }
    }
}

// MARK: - Socket

enum SocketServer {
    static func canConnect(_ path: String) -> Bool {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { close(fd) }
        var address = socketAddress(path)
        return withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        } == 0
    }

    static func socketAddress(_ path: String) -> sockaddr_un {
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8.prefix(MemoryLayout.size(ofValue: address.sun_path) - 1))
        withUnsafeMutableBytes(of: &address.sun_path) { raw in
            raw.copyBytes(from: bytes)
            raw[bytes.count] = 0
        }
        return address
    }

    static func start(path: String, handler: @escaping @Sendable (Data) -> Data) throws {
        let directory = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        chmod(directory, 0o700)
        if canConnect(path) { exit(0) }  // Another helper already serves this Mac user.
        unlink(path)
        let listener = socket(AF_UNIX, SOCK_STREAM, 0)
        guard listener >= 0 else { throw BrokerError(code: "socket", message: "socket() failed: \(errno)") }
        var address = socketAddress(path)
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(listener, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        guard bound == 0 else { throw BrokerError(code: "socket", message: "bind() failed: \(errno)") }
        chmod(path, 0o600)
        guard listen(listener, 16) == 0 else { throw BrokerError(code: "socket", message: "listen() failed: \(errno)") }
        Thread.detachNewThread {
            while true {
                let client = accept(listener, nil, nil)
                if client < 0 {
                    if errno == EINTR { continue }
                    break
                }
                var uid: uid_t = 0
                var gid: gid_t = 0
                guard getpeereid(client, &uid, &gid) == 0, uid == getuid() else { close(client); continue }
                DispatchQueue.global().async { serve(client, handler) }
            }
        }
    }

    static func serve(_ client: Int32, _ handler: @Sendable (Data) -> Data) {
        defer { close(client) }
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 65_536)
        while !buffer.contains(0x0A) {
            let count = read(client, &chunk, chunk.count)
            if count <= 0 { break }
            buffer.append(contentsOf: chunk[0..<count])
            if buffer.count > 4_000_000 { return }
        }
        guard let newline = buffer.firstIndex(of: 0x0A) else { return }
        var response = handler(Data(buffer[buffer.startIndex..<newline]))
        response.append(0x0A)
        response.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else { return }
            var offset = 0
            while offset < raw.count {
                let written = write(client, base + offset, raw.count - offset)
                if written <= 0 { break }
                offset += written
            }
        }
    }
}

// MARK: - Self-test

func checkoutSelfTest() -> Bool {
    var checks = 0
    func check(_ condition: Bool, _ label: String) -> Bool {
        if !condition { FileHandle.standardError.write(Data("OS-1 Checkout self-test failed: \(label)\n".utf8)); return false }
        checks += 1
        return true
    }
    let script = BrowserCheckout.pageScript(command: ["op": "snapshot"])
    let page = BrowserCheckout.Snapshot(url: "https://domains.example/checkout", text: "Order summary usungcorp.com Total US$20.00 Payment method Visa ending in 4242",
        elements: [BrowserCheckout.Element(ref: "e1", tag: "button", role: "button", name: "Place order", submitter: true),
                   BrowserCheckout.Element(ref: "e2", tag: "input", role: "checkbox", name: "I agree to the Terms of Service", type: "checkbox"),
                   BrowserCheckout.Element(ref: "e3", tag: "input", role: "textbox", name: "Card number", type: "text", autocomplete: "cc-number")])
    let request = BrowserCheckout.ApprovalRequest(merchant: "Squarespace", item: "usungcorp.com", amount: "US$20.00", confirmRef: "e1", termsRefs: ["e2"])
    let receipt = BrowserCheckout.Receipt(approvalID: UUID().uuidString, executionID: "x", merchant: "Squarespace", item: "usungcorp.com",
        amount: "US$20.00", approvedAt: "", confirmedAt: "", resultURL: "", resultTitle: "")
    let ok = check(!script.contains("__OS1_CMD__") && script.contains("\"op\":\"snapshot\""), "page script command")
        && check(BrowserCheckout.gate(for: page.elements[0], in: page) == .finalPurchase, "place order is the purchase")
        && check(BrowserCheckout.gate(for: page.elements[1], in: page) == .termsAgreement, "terms box needs the approval")
        && check(BrowserCheckout.gate(for: page.elements[2], in: page) == .ownerOnly, "card number is owner-only")
        && check(BrowserCheckout.validate(request, against: page) == nil, "approval matches the page")
        && check(BrowserCheckout.approvalReason(request).contains("US$20.00"), "approval text names the amount")
        && check(BrowserCheckout.appendingReceipts([receipt], to: "done\n— OS-1 구매 영수증 · fake").components(separatedBy: "OS-1 구매 영수증").count == 2,
                 "a forged receipt line is replaced by the real one")
        && check(Browser.allCases.allSatisfy { BrowserCheckout.appleScriptSource($0).contains("on os1Eval") }, "both browsers have scripts")
    if ok { print("OS-1 Checkout self-test: \(checks) checks passed; no browser touched") }
    return ok
}

// MARK: - Main

if CommandLine.arguments.contains("--self-test") { exit(checkoutSelfTest() ? 0 : 1) }

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
// A windowless accessory app is fair game for AppKit's automatic and sudden
// termination; the helper waits on the owner's Automation and Touch ID
// prompts, so it ends only through its own idle timer (2026-10-02: it was
// terminated while the first Automation prompt was on screen).
ProcessInfo.processInfo.disableAutomaticTermination("OS-1 Checkout serves purchase approvals")
ProcessInfo.processInfo.disableSuddenTermination()
let broker = CheckoutBroker(scripts: BrowserScripts())
do {
    try SocketServer.start(path: BrowserCheckout.socketURL().path) { data in broker.queue.sync { broker.handle(data) } }
} catch {
    FileHandle.standardError.write(Data("OS-1 Checkout could not start: \(error)\n".utf8))
    exit(1)
}
// Quit after 30 idle minutes; the next checkout launches it again.
Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { _ in
    // Scheduled on the main run loop.
    if broker.idleSeconds > 1_800 { MainActor.assumeIsolated { NSApp.terminate(nil) } }
}
application.run()
