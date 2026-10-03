import Foundation

/// Owner-approved checkout in the owner's own Safari or Chrome.
///
/// Owner, 2026-10-02: "결제 퍼미션 창을 자기 혼자 띄울 수 있고 … 승인 버튼만
/// 눌러주면 되게 … 사파리나 크롬이나 둘 다 호환되게." The backend drives the
/// seller's site up to the final purchase button through the OS-1 checkout
/// helper; the helper alone may press that button, and only after the owner
/// approves the exact item and amount with Touch ID or the Mac password.
///
/// Trust boundary: the helper ("OS-1 Checkout.app", launched through
/// LaunchServices so it is its own responsible process) holds the Apple Events
/// permission for the browsers. Backends inherit OS-1's permissions, not the
/// helper's, so they reach a page only through the helper's socket, where the
/// gates below apply: owner-only fields are never typed into, final purchase
/// buttons and terms boxes are pressed only by an approved confirmation.
public enum BrowserCheckout {
    public enum Browser: String, Codable, CaseIterable, Sendable {
        case safari, chrome

        public var applicationName: String { self == .safari ? "Safari" : "Google Chrome" }
        public var bundleIdentifier: String { self == .safari ? "com.apple.Safari" : "com.google.Chrome" }
        public var displayName: String { self == .safari ? "Safari" : "Chrome" }
    }

    public static let helperBundleIdentifier = "com.omaragi.os1.checkout"
    public static let helperBundleName = "OS-1 Checkout.app"
    public static let mcpServerName = "os1-checkout"

    public static func directory(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        home.appendingPathComponent("Library/Application Support/OS-1/checkout", isDirectory: true)
    }

    public static func socketURL(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        directory(home: home).appendingPathComponent("broker.sock")
    }

    // MARK: Page model

    public struct Element: Codable, Equatable, Sendable {
        public var ref: String
        public var tag: String
        public var role: String
        public var name: String
        public var type: String
        public var autocomplete: String
        public var field: String
        public var disabled: Bool
        public var submitter: Bool
        public var checked: Bool?
        public var href: String?
        public var hasValue: Bool?

        public init(ref: String, tag: String, role: String, name: String, type: String = "", autocomplete: String = "",
                    field: String = "", disabled: Bool = false, submitter: Bool = false, checked: Bool? = nil,
                    href: String? = nil, hasValue: Bool? = nil) {
            self.ref = ref; self.tag = tag; self.role = role; self.name = name; self.type = type
            self.autocomplete = autocomplete; self.field = field; self.disabled = disabled; self.submitter = submitter
            self.checked = checked; self.href = href; self.hasValue = hasValue
        }
    }

    public struct Snapshot: Codable, Equatable, Sendable {
        public var url: String
        public var title: String
        public var ready: String
        public var text: String
        public var elements: [Element]
        public var frames: [String]

        public init(url: String, title: String = "", ready: String = "complete", text: String, elements: [Element], frames: [String] = []) {
            self.url = url; self.title = title; self.ready = ready; self.text = text; self.elements = elements; self.frames = frames
        }
    }

    /// What pressing or typing into an element needs.
    public enum Gate: String, Codable, Sendable {
        /// The agent may act.
        case none
        /// Card data, security codes, passwords, one-time codes: the owner types them.
        case ownerOnly = "owner_only"
        /// The purchase itself: only `purchase_confirm` after an approval.
        case finalPurchase = "approval_required"
        /// Accepting terms belongs to the approved purchase.
        case termsAgreement = "terms_approval_required"
    }

    static let sensitivePattern =
        #"card|cc-?num|ccnum|cvv|cvc|csc|security\s*code|expir|exp[-_ ]?(date|month|year|mm|yy)|"# +
        #"password|passcode|passwd|one[- ]?time|otp|2fa|two[- ]?factor|verification\s*code|sms\s*code|auth(entication)?\s*code|"# +
        #"\bpin\b|iban|routing\s*number|account\s*number|ssn|social\s*security|"# +
        #"카드|보안\s*코드|유효\s*기간|비밀\s*번호|비번|인증\s*번호|인증\s*코드|일회용|계좌|주민"#

    static let finalPattern =
        #"\b(buy|purchase|checkout\s+now|place\s+(your\s+)?order|complete\s+(your\s+|my\s+)?(order|purchase|checkout|payment|registration)|"# +
        #"submit\s+(your\s+)?order|pay(\s+now|\s+[$€£₩]|\s+[0-9])?|confirm\s+(and\s+pay|order|purchase|payment)|subscribe|"# +
        #"start\s+(my\s+|your\s+)?(subscription|trial)|register\s+(now|domain|it)|apple\s*pay|google\s*pay|paypal|shop\s*pay|amazon\s*pay)\b|"# +
        #"구매|결제|주문\s*하기|주문하기|주문\s*완료|주문완료|구독\s*하기|구독하기|구독\s*시작|가입\s*완료|등록\s*완료|"# +
        #"카카오\s*페이|네이버\s*페이|토스\s*페이|삼성\s*페이"#

    static let safePattern =
        #"^(edit|remove|delete|back|go\s+back|cancel|close|apply|change|show|hide|more|less|view|details|learn\s+more|help|"# +
        #"coupon|promo|add\s+promo|수정|삭제|제거|뒤로|이전|취소|닫기|적용|변경|보기|더\s*보기|자세히|도움말|쿠폰|프로모션)\b"#

    static let termsPattern =
        #"agree|terms|conditions|polic(y|ies)|consent|약관|동의|정책|이용\s*규칙"#

    static let checkoutURLPattern =
        #"checkout|payment|purchase|billing|/order|/pay\b|/cart/review|/basket/review|결제|주문"#

    static let totalPattern =
        #"\btotal\b|order\s+total|due\s+today|today's\s+total|합계|총\s*금액|총액|결제\s*금액|최종\s*금액|청구\s*금액"#

    static let paymentPattern =
        #"payment\s+method|card\s+ending|ending\s+in|•{2,}|\*{4}|\bvisa\b|mastercard|\bamex\b|american\s+express|paypal|"# +
        #"결제\s*수단|카드\s*끝|신용\s*카드|체크\s*카드"#

    static func matches(_ pattern: String, _ text: String) -> Bool {
        text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func buttonLike(_ element: Element) -> Bool {
        element.submitter || element.role == "button" || element.tag == "button"
            || (element.tag == "input" && ["submit", "button", "image"].contains(element.type))
    }

    public static func isOwnerOnly(_ element: Element) -> Bool {
        if element.type == "password" { return true }
        let autocomplete = element.autocomplete
        if autocomplete.split(separator: " ").contains(where: { $0.hasPrefix("cc-") })
            || ["current-password", "new-password", "one-time-code"].contains(where: autocomplete.contains) { return true }
        guard ["textbox", "combobox", "searchbox", "spinbutton"].contains(element.role) || element.tag == "select"
            || element.tag == "textarea" || element.tag == "input" else { return false }
        return matches(sensitivePattern, element.field + " " + element.name)
    }

    /// The step of a checkout where the payment method and the total are on
    /// screen: here any submit or primary button may be the purchase.
    public static func isPaymentStep(_ snapshot: Snapshot) -> Bool {
        (matches(checkoutURLPattern, snapshot.url) || matches(totalPattern, snapshot.text))
            && matches(paymentPattern, snapshot.text)
    }

    public static func gate(for element: Element, in snapshot: Snapshot) -> Gate {
        if isOwnerOnly(element) { return .ownerOnly }
        let name = element.name
        if ["checkbox", "switch"].contains(element.role) || (element.tag == "input" && element.type == "checkbox") {
            return matches(termsPattern, name) ? .termsAgreement : .none
        }
        let actionable = buttonLike(element) || element.role == "link" || element.tag == "a"
            || element.role == "menuitem" || element.role == "option"
        if actionable && matches(finalPattern, name) { return .finalPurchase }
        if buttonLike(element) && isPaymentStep(snapshot) && !matches(safePattern, name) { return .finalPurchase }
        return .none
    }

    // MARK: Approval

    public struct ApprovalRequest: Codable, Equatable, Sendable {
        public var merchant: String
        public var item: String
        public var amount: String
        public var period: String?
        public var renewal: String?
        public var paymentMethod: String?
        public var confirmRef: String
        public var termsRefs: [String]

        public init(merchant: String, item: String, amount: String, period: String? = nil, renewal: String? = nil,
                    paymentMethod: String? = nil, confirmRef: String, termsRefs: [String] = []) {
            self.merchant = merchant; self.item = item; self.amount = amount; self.period = period
            self.renewal = renewal; self.paymentMethod = paymentMethod; self.confirmRef = confirmRef; self.termsRefs = termsRefs
        }
    }

    public enum ApprovalProblem: String, Codable, Sendable {
        case missingField = "missing_field"
        case confirmRefNotFound = "confirm_ref_not_found"
        case confirmRefNotPurchase = "confirm_ref_is_not_the_purchase_button"
        case confirmRefDisabled = "confirm_ref_disabled"
        case termsRefInvalid = "terms_ref_is_not_a_terms_box"
        case amountNotOnPage = "amount_not_on_page"
    }

    /// The approval must describe what the page shows: the purchase button,
    /// the terms boxes and the amount the owner will pay.
    public static func validate(_ request: ApprovalRequest, against snapshot: Snapshot) -> ApprovalProblem? {
        for value in [request.merchant, request.item, request.amount, request.confirmRef]
        where value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .missingField }
        guard let confirm = snapshot.elements.first(where: { $0.ref == request.confirmRef }) else { return .confirmRefNotFound }
        guard gate(for: confirm, in: snapshot) == .finalPurchase else { return .confirmRefNotPurchase }
        guard !confirm.disabled else { return .confirmRefDisabled }
        for ref in request.termsRefs {
            guard let box = snapshot.elements.first(where: { $0.ref == ref }),
                  gate(for: box, in: snapshot) == .termsAgreement else { return .termsRefInvalid }
        }
        return amountAppears(request.amount, in: snapshot.text) ? nil : .amountNotOnPage
    }

    /// "US$20.00", "$20", "₩27,000", "20,000원" against the page text: the
    /// same number, not a digit run inside a longer one ("20" in "2025",
    /// "20.5").
    public static func amountAppears(_ amount: String, in text: String) -> Bool {
        var digits = amount.filter { $0.isASCII && ($0.isNumber || $0 == ".") }
        while digits.hasSuffix(".") { digits.removeLast() }
        guard let number = Decimal(string: digits), number > 0 else { return false }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        var candidates: [String] = []
        if let fixed = formatter.string(from: number as NSDecimalNumber) { candidates.append(fixed) }
        var rounded = Decimal()
        var copy = number
        NSDecimalRound(&rounded, &copy, 0, .plain)
        if rounded == number { candidates.append(NSDecimalNumber(decimal: number).stringValue) }
        let page = Array(text.replacingOccurrences(of: ",", with: ""))
        for candidate in candidates {
            let needle = Array(candidate)
            guard needle.count <= page.count else { continue }
            for start in 0...(page.count - needle.count) where Array(page[start..<(start + needle.count)]) == needle {
                let end = start + needle.count
                let before: Character? = start > 0 ? page[start - 1] : nil
                let after: Character? = end < page.count ? page[end] : nil
                let next: Character? = end + 1 < page.count ? page[end + 1] : nil
                if before?.isNumber == true || before == "." || after?.isNumber == true { continue }
                if after == ".", next?.isNumber == true { continue }
                return true
            }
        }
        return false
    }

    /// The text of the system authentication dialog. macOS shows it as
    /// "‘OS-1 Checkout’이(가) …하려고 합니다."
    public static func approvalReason(_ request: ApprovalRequest) -> String {
        var details = [request.merchant]
        if let period = request.period?.trimmingCharacters(in: .whitespaces), !period.isEmpty { details.append(period) }
        details.append("결제 \(request.amount)")
        if let renewal = request.renewal?.trimmingCharacters(in: .whitespaces), !renewal.isEmpty { details.append("갱신 \(renewal)") }
        if let payment = request.paymentMethod?.trimmingCharacters(in: .whitespaces), !payment.isEmpty { details.append(payment) }
        let terms = request.termsRefs.isEmpty ? "" : " 및 약관 동의"
        return "\(request.item) 구매(\(details.joined(separator: " · ")))\(terms)를 승인"
    }

    static let orderConfirmationPattern =
        #"order\s*(number|no\.|#|confirmation|confirmed|complete|completed|placed|is\s+confirmed)|thank\s*you\s+for\s+your\s+(order|purchase)|"# +
        #"thanks\s+for\s+your\s+(order|purchase)|purchase\s+(complete|completed|successful|confirmed)|payment\s+(successful|complete|received)|"# +
        #"registration\s+(complete|successful)|you('re|\s+are)\s+all\s+set|주문\s*번호|주문(이|가)?\s*완료|결제(가|이)?\s*완료|구매(가|이)?\s*완료|"# +
        #"등록(이)?\s*완료|구매해\s*주셔서\s*감사|주문해\s*주셔서\s*감사"#

    /// The page after the purchase button: an order confirmation, not the
    /// next step of the checkout. Only then is there a receipt.
    public static func looksLikeOrderConfirmation(_ snapshot: Snapshot) -> Bool {
        matches(orderConfirmationPattern, snapshot.title + " " + snapshot.text)
    }

    // MARK: Receipts

    public struct Receipt: Codable, Equatable, Sendable {
        public var approvalID: String
        public var executionID: String?
        public var merchant: String
        public var item: String
        public var amount: String
        public var approvedAt: String
        public var confirmedAt: String
        public var resultURL: String
        public var resultTitle: String

        public init(approvalID: String, executionID: String?, merchant: String, item: String, amount: String,
                    approvedAt: String, confirmedAt: String, resultURL: String, resultTitle: String) {
            self.approvalID = approvalID; self.executionID = executionID; self.merchant = merchant; self.item = item
            self.amount = amount; self.approvedAt = approvedAt; self.confirmedAt = confirmedAt
            self.resultURL = resultURL; self.resultTitle = resultTitle
        }
    }

    static let receiptPrefix = "— OS-1 구매 영수증 · "

    /// One line per approved and confirmed purchase. The remote verifier reads
    /// it; only OS-1 writes it, from the helper's own records.
    public static func receiptLine(_ receipt: Receipt) -> String {
        func clean(_ value: String) -> String {
            value.replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: " · ", with: " ").trimmingCharacters(in: .whitespaces)
        }
        return receiptPrefix + [clean(receipt.merchant), clean(receipt.item), clean(receipt.amount)].joined(separator: " · ")
            + " · 승인 " + receipt.approvalID
    }

    /// A backend never writes a receipt line itself; drop any it did.
    public static func strippingForgedReceipts(_ output: String) -> String {
        guard output.contains("OS-1 구매 영수증") else { return output }
        return output.components(separatedBy: "\n")
            .filter { !$0.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "—-–*_ >"))
                .hasPrefix("OS-1 구매 영수증") }
            .joined(separator: "\n")
    }

    public static func appendingReceipts(_ receipts: [Receipt], to output: String) -> String {
        let clean = strippingForgedReceipts(output)
        guard !receipts.isEmpty else { return clean }
        return clean.trimmingCharacters(in: .whitespacesAndNewlines) + "\n\n" + receipts.map(receiptLine).joined(separator: "\n")
    }

    // MARK: Setup guidance

    public static func javaScriptSetupStep(_ browser: Browser) -> String {
        switch browser {
        case .safari:
            return "Safari 설정 → 고급에서 ‘웹 개발자용 기능 보기’를 켠 다음, 설정의 ‘개발자’ 탭(또는 메뉴 막대 ‘개발자용’)에서 ‘Apple 이벤트의 JavaScript 허용’을 켜 주세요."
        case .chrome:
            return "Chrome 메뉴 막대 보기 → 개발자 → ‘Apple 이벤트의 JavaScript 허용’을 켜 주세요."
        }
    }

    public static func automationPromptStep(_ browser: Browser) -> String {
        "화면의 ‘OS-1 Checkout이(가) \(browser.applicationName)을(를) 제어하려고 합니다’ 창에서 허용을 눌러 주세요. 안 보이면 시스템 설정 → 개인정보 보호 및 보안 → 자동화 → OS-1 Checkout에서 \(browser.applicationName)을(를) 켜 주세요."
    }

    public static func automationSetupStep(_ browser: Browser) -> String {
        "시스템 설정 → 개인정보 보호 및 보안 → 자동화에서 ‘OS-1 Checkout’ 아래 ‘\(browser.applicationName)’을 켜 주세요."
    }

    /// How long a browser's open event waits for the owner to answer macOS's
    /// Automation alert. macOS shows that alert only while the asking app is in
    /// front and withdraws it when the event gives up (2026-10-02: the alert
    /// stayed hidden behind the background helper, then vanished at 30 s), so
    /// the event itself waits and the client brings the helper forward.
    public static let automationAnswerWait: TimeInterval = 150

    /// The owner's Automation answer for one browser, as the helper reads it
    /// from AEDeterminePermissionToAutomateTarget without asking (no prompt).
    public enum AutomationState: String, Codable, Sendable {
        case granted, denied
        case notAnswered = "not_answered"
        case browserNotRunning = "browser_not_running"
        case unknown
    }

    public static func automationState(osStatus: Int) -> AutomationState {
        switch osStatus {
        case 0: return .granted
        case -1743: return .denied  // errAEEventNotPermitted
        case -1744: return .notAnswered  // errAEEventWouldRequireUserConsent
        case -600: return .browserNotRunning  // procNotFound
        default: return .unknown
        }
    }

    /// What the owner does for that state; nil when nothing is needed yet.
    public static func automationOwnerStep(_ state: AutomationState, _ browser: Browser) -> String? {
        switch state {
        case .denied: return automationSetupStep(browser)
        case .notAnswered: return automationPromptStep(browser)
        case .granted, .browserNotRunning, .unknown: return nil
        }
    }

    // MARK: Browser scripts

    /// Handlers called through Apple Events with the URL or the JavaScript as
    /// parameters, so page scripts never need AppleScript quoting.
    public static func appleScriptSource(_ browser: Browser) -> String {
        switch browser {
        case .safari:
            return """
            on os1Open(theURL)
                with timeout of \(Int(automationAnswerWait)) seconds
                    tell application "Safari"
                        make new document with properties {URL:theURL}
                        return (id of front window) as text
                    end tell
                end timeout
            end os1Open
            on os1Eval(windowID, js)
                with timeout of 30 seconds
                    tell application "Safari"
                        return do JavaScript js in current tab of (first window whose id is (windowID as integer))
                    end tell
                end timeout
            end os1Eval
            on os1Close(windowID)
                with timeout of 30 seconds
                    tell application "Safari"
                        close (first window whose id is (windowID as integer))
                    end tell
                end timeout
                return "closed"
            end os1Close
            """
        case .chrome:
            return """
            on os1Open(theURL)
                with timeout of \(Int(automationAnswerWait)) seconds
                    tell application "Google Chrome"
                        set w to make new window
                        set URL of active tab of w to theURL
                        return ((id of w) as text)
                    end tell
                end timeout
            end os1Open
            on os1Eval(windowID, js)
                with timeout of 30 seconds
                    tell application "Google Chrome"
                        return execute (active tab of (first window whose id is (windowID as integer))) javascript js
                    end tell
                end timeout
            end os1Eval
            on os1Close(windowID)
                with timeout of 30 seconds
                    tell application "Google Chrome"
                        close (first window whose id is (windowID as integer))
                    end tell
                end timeout
                return "closed"
            end os1Close
            """
        }
    }

    public enum ScriptFailure: String, Codable, Sendable {
        case automationDenied = "automation_permission_missing"
        case javaScriptDisabled = "javascript_from_apple_events_off"
        case browserNotRunning = "browser_not_running"
        case windowGone = "window_closed"
        /// errAETimeout: before the first success this is the Automation
        /// prompt waiting for the owner.
        case timedOut = "apple_event_timeout"
        case other = "browser_script_failed"
    }

    public static func classifyScriptError(number: Int, message: String) -> ScriptFailure {
        let lower = message.lowercased()
        if number == -1743 || lower.contains("not authorized to send apple events") || lower.contains("not allowed to send apple events") {
            return .automationDenied
        }
        if lower.contains("allow javascript from apple events") || lower.contains("javascript through applescript is turned off")
            || lower.contains("apple 이벤트의 javascript") || lower.contains("apple 이벤트의 자바스크립트") {
            return .javaScriptDisabled
        }
        if number == -600 || number == -609 { return .browserNotRunning }
        if number == -1728 || number == -1719 { return .windowGone }
        if number == -1712 { return .timedOut }
        return .other
    }

    /// The page agent, evaluated with `CMD` replaced by one JSON command. It
    /// never returns a field's value: only whether a field has one.
    public static func pageScript(command: [String: String]) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: command, options: [.sortedKeys])) ?? Data("{}".utf8)
        return pageAgent.replacingOccurrences(of: "__OS1_CMD__", with: String(decoding: data, as: UTF8.self))
    }

    /// The page agent reports whether a field has a value, never the value.
    public static var pageAgentReturnsFieldValues: Bool {
        pageAgent.contains("rec.value") || pageAgent.contains("value: el.value") || pageAgent.contains("value: String(el.value")
    }

    static let pageAgent = #"""
    (function (cmd) {
      "use strict";
      var MAX_TEXT = 6000, MAX_ELEMENTS = 220;
      function norm(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
      function visible(el) {
        if (!el.isConnected) return false;
        var s = window.getComputedStyle(el);
        if (s.visibility === "hidden" || s.display === "none") return false;
        var r = el.getBoundingClientRect();
        if (r.width >= 1 && r.height >= 1) return true;
        return el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio");
      }
      function labelOf(el) {
        var t = norm(el.getAttribute("aria-label"));
        if (!t && el.getAttribute("aria-labelledby")) {
          t = norm(el.getAttribute("aria-labelledby").split(/\s+/).map(function (id) {
            var n = document.getElementById(id); return n ? n.innerText : ""; }).join(" "));
        }
        if (!t && el.labels && el.labels.length) t = norm(Array.prototype.map.call(el.labels, function (l) { return l.innerText; }).join(" "));
        if (!t && el.tagName === "INPUT" && /^(submit|button|reset)$/i.test(el.type)) t = norm(el.value);
        if (!t && el.tagName !== "INPUT" && el.tagName !== "SELECT" && el.tagName !== "TEXTAREA") t = norm(el.innerText);
        if (!t) t = norm(el.getAttribute("title") || el.getAttribute("placeholder") || el.getAttribute("alt") || el.getAttribute("name"));
        return t.slice(0, 160);
      }
      function roleOf(el) {
        var r = el.getAttribute("role"); if (r) return r.toLowerCase();
        var tag = el.tagName.toLowerCase();
        if (tag === "a") return "link";
        if (tag === "button" || tag === "summary") return "button";
        if (tag === "select") return "combobox";
        if (tag === "textarea") return "textbox";
        if (tag === "input") {
          var ty = (el.type || "text").toLowerCase();
          if (ty === "checkbox") return "checkbox";
          if (ty === "radio") return "radio";
          if (/^(submit|button|reset|image)$/.test(ty)) return "button";
          if (ty === "search") return "searchbox";
          if (ty === "number") return "spinbutton";
          return "textbox";
        }
        if (el.isContentEditable) return "textbox";
        return tag;
      }
      function isSubmitter(el) {
        var tag = el.tagName.toLowerCase();
        if (tag === "button") return (el.getAttribute("type") || "submit").toLowerCase() === "submit" && !!el.form;
        if (tag === "input") return /^(submit|image)$/i.test(el.type || "") && !!el.form;
        return false;
      }
      function refOf(el) {
        if (!el.dataset.os1Ref) { window.__os1Seq = (window.__os1Seq || 0) + 1; el.dataset.os1Ref = "e" + window.__os1Seq; }
        return el.dataset.os1Ref;
      }
      var SELECTOR = "a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=option],[role=combobox],[contenteditable=true]";
      function snapshot() {
        var out = [], all = document.querySelectorAll(SELECTOR);
        for (var i = 0; i < all.length && out.length < MAX_ELEMENTS; i++) {
          var el = all[i]; if (!visible(el)) continue;
          var tag = el.tagName.toLowerCase(), role = roleOf(el);
          var rec = { ref: refOf(el), tag: tag, role: role, name: labelOf(el),
            type: tag === "input" ? (el.type || "text").toLowerCase() : "",
            autocomplete: norm(el.getAttribute("autocomplete")).toLowerCase(),
            field: norm((el.getAttribute("name") || "") + " " + (el.id || "") + " " + (el.getAttribute("data-testid") || "")).toLowerCase().slice(0, 120),
            disabled: !!(el.disabled || el.getAttribute("aria-disabled") === "true"), submitter: isSubmitter(el) };
          if (role === "checkbox" || role === "radio" || role === "switch") rec.checked = !!(el.checked || el.getAttribute("aria-checked") === "true");
          if (tag === "a") rec.href = String(el.href || "").slice(0, 240);
          if (role === "textbox" || role === "searchbox" || role === "combobox" || role === "spinbutton") rec.hasValue = !!(el.value || el.textContent);
          out.push(rec);
        }
        var frames = Array.prototype.map.call(document.querySelectorAll("iframe"), function (f) {
          try { return new URL(f.src, location.href).host; } catch (e) { return ""; } }).filter(Boolean).slice(0, 20);
        return { ok: true, url: location.href, title: document.title, ready: document.readyState,
          text: norm(document.body ? document.body.innerText : "").slice(0, MAX_TEXT), elements: out, frames: frames };
      }
      function find(ref) { return document.querySelector('[data-os1-ref="' + String(ref).replace(/[^A-Za-z0-9]/g, "") + '"]'); }
      if (cmd.op === "probe") return JSON.stringify({ ok: true, url: location.href, ready: document.readyState });
      if (cmd.op === "snapshot") return JSON.stringify(snapshot());
      var el = find(cmd.ref);
      if (!el) return JSON.stringify({ ok: false, error: "ref_not_found" });
      if (cmd.op === "click") { el.scrollIntoView({ block: "center" }); el.click(); return JSON.stringify({ ok: true }); }
      if (cmd.op === "check") { if (!!el.checked !== (cmd.value === "true")) el.click(); return JSON.stringify({ ok: true, checked: !!el.checked }); }
      if (cmd.op === "type") {
        el.focus();
        if (el.isContentEditable) { el.textContent = String(cmd.text); }
        else {
          var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          var desc = Object.getOwnPropertyDescriptor(proto, "value");
          if (desc && desc.set) desc.set.call(el, String(cmd.text)); else el.value = String(cmd.text);
        }
        el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
        return JSON.stringify({ ok: true });
      }
      if (cmd.op === "select") {
        var opt = Array.prototype.find.call(el.options || [], function (o) { return o.value === cmd.value || norm(o.text) === norm(cmd.value); });
        if (!opt) return JSON.stringify({ ok: false, error: "option_not_found" });
        el.value = opt.value;
        el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
        return JSON.stringify({ ok: true });
      }
      return JSON.stringify({ ok: false, error: "unknown_op" });
    })(__OS1_CMD__)
    """#

    // MARK: Broker protocol

    public struct BrokerRequest: Codable, Sendable {
        public var op: String
        public var args: [String: String]
        public var list: [String: [String]]?
        public var executionID: String?

        public init(op: String, args: [String: String] = [:], list: [String: [String]]? = nil, executionID: String? = nil) {
            self.op = op; self.args = args; self.list = list; self.executionID = executionID
        }
    }

    public struct BrokerError: Codable, Error, Sendable {
        public var code: String
        public var message: String
        public var ownerStep: String?

        public init(code: String, message: String, ownerStep: String? = nil) {
            self.code = code; self.message = message; self.ownerStep = ownerStep
        }
    }

    public struct BrokerResponse: Codable, Sendable {
        public var ok: Bool
        public var result: String?
        public var error: BrokerError?

        public init(ok: Bool, result: String? = nil, error: BrokerError? = nil) {
            self.ok = ok; self.result = result; self.error = error
        }
    }
}
