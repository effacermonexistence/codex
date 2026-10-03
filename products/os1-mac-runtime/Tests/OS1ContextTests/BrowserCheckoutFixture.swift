import Foundation
import OS1Context

/// Owner, 2026-10-02: "결제 퍼미션 창을 자기 혼자 띄울 수 있고 … 승인 버튼만
/// 눌러주면 되게 … 사파리나 크롬 둘 다 호환되게." The gates the checkout
/// helper applies to every page action: owner-only fields, the purchase
/// button and terms boxes only through an approved confirmation.
func runBrowserCheckoutFixtures() throws {
    var count = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Browser checkout: " + message); count += 1
    }
    typealias E = BrowserCheckout.Element
    func gate(_ element: E, _ page: BrowserCheckout.Snapshot) -> BrowserCheckout.Gate { BrowserCheckout.gate(for: element, in: page) }

    // A domain search and its results: searching is free; "Add to cart" is not
    // a purchase; "Buy" may be one-click, so it needs the approval.
    let search = BrowserCheckout.Snapshot(url: "https://domains.squarespace.com/", text: "Find the perfect domain",
        elements: [E(ref: "e1", tag: "input", role: "searchbox", name: "Search for a domain", type: "search", field: "domain-search"),
                   E(ref: "e2", tag: "button", role: "button", name: "Search", submitter: true),
                   E(ref: "e3", tag: "a", role: "link", name: "Pricing", href: "https://domains.squarespace.com/pricing")])
    check(search.elements.allSatisfy { gate($0, search) == .none }, "a domain search page has no gates")
    let results = BrowserCheckout.Snapshot(url: "https://domains.squarespace.com/search?query=usungcorp",
        text: "usungcorp.com is available $20/yr usungcorp.net $18/yr",
        elements: [E(ref: "e4", tag: "button", role: "button", name: "Add to cart"),
                   E(ref: "e5", tag: "button", role: "button", name: "Buy"),
                   E(ref: "e6", tag: "button", role: "button", name: "No thanks")])
    check(gate(results.elements[0], results) == .none, "add to cart is not the purchase")
    check(gate(results.elements[1], results) == .finalPurchase, "Buy can charge at once: approval")
    check(gate(results.elements[2], results) == .none, "declining an add-on is free")

    // The cart (no payment method on screen yet): moving on is free.
    let cart = BrowserCheckout.Snapshot(url: "https://domains.squarespace.com/cart",
        text: "Your cart usungcorp.com 1 year $20.00 Total $20.00",
        elements: [E(ref: "e7", tag: "button", role: "button", name: "Continue to checkout"),
                   E(ref: "e8", tag: "select", role: "combobox", name: "Registration period", field: "term")])
    check(!BrowserCheckout.isPaymentStep(cart), "a cart without a payment method is not the payment step")
    check(cart.elements.allSatisfy { gate($0, cart) == .none }, "continue and the period select are free in the cart")

    // The payment step: the purchase, the terms box and the card fields.
    let checkout = BrowserCheckout.Snapshot(url: "https://domains.squarespace.com/checkout",
        text: "Order summary usungcorp.com 1 year Total due today US$20.00 Renews at US$20.00/yr Payment method Visa ending in 4242",
        elements: [E(ref: "e10", tag: "button", role: "button", name: "Place order", submitter: true),
                   E(ref: "e11", tag: "button", role: "button", name: "Edit"),
                   E(ref: "e12", tag: "input", role: "checkbox", name: "I agree to the Domain Registration Agreement", type: "checkbox"),
                   E(ref: "e13", tag: "input", role: "checkbox", name: "Auto-renew", type: "checkbox"),
                   E(ref: "e14", tag: "input", role: "textbox", name: "Card number", type: "text", autocomplete: "cc-number"),
                   E(ref: "e15", tag: "input", role: "textbox", name: "Promo code", type: "text", field: "promo"),
                   E(ref: "e16", tag: "button", role: "button", name: "Apply"),
                   E(ref: "e17", tag: "button", role: "button", name: "Continue", submitter: true),
                   E(ref: "e18", tag: "input", role: "textbox", name: "CVC", type: "text", field: "cvc"),
                   E(ref: "e19", tag: "input", role: "textbox", name: "Password", type: "password")])
    check(BrowserCheckout.isPaymentStep(checkout), "total + payment method = payment step")
    check(gate(checkout.elements[0], checkout) == .finalPurchase, "place order needs the approval")
    check(gate(checkout.elements[1], checkout) == .none, "editing is free")
    check(gate(checkout.elements[2], checkout) == .termsAgreement, "the registration agreement belongs to the approval")
    check(gate(checkout.elements[3], checkout) == .none, "auto-renew is the owner's choice of option, not terms")
    check(gate(checkout.elements[4], checkout) == .ownerOnly, "card number is owner-only (autocomplete)")
    check(gate(checkout.elements[5], checkout) == .none, "a promo code may be typed")
    check(gate(checkout.elements[6], checkout) == .none, "apply is free")
    check(gate(checkout.elements[7], checkout) == .finalPurchase, "on the payment step an unnamed submit may be the purchase")
    check(gate(checkout.elements[8], checkout) == .ownerOnly, "CVC is owner-only (field name)")
    check(gate(checkout.elements[9], checkout) == .ownerOnly, "password is owner-only")

    // GoDaddy wording, express pay and Korean checkouts.
    let other = BrowserCheckout.Snapshot(url: "https://www.godaddy.com/checkout", text: "Total ₩27,000 결제 수단 신용카드 끝 4242",
        elements: [E(ref: "g1", tag: "button", role: "button", name: "Complete Purchase"),
                   E(ref: "g2", tag: "button", role: "button", name: "Place Your Order"),
                   E(ref: "g3", tag: "button", role: "button", name: "Apple Pay"),
                   E(ref: "g4", tag: "button", role: "button", name: "PayPal"),
                   E(ref: "k1", tag: "button", role: "button", name: "결제하기"),
                   E(ref: "k2", tag: "button", role: "button", name: "주문하기"),
                   E(ref: "k3", tag: "input", role: "checkbox", name: "이용약관에 동의합니다", type: "checkbox"),
                   E(ref: "k4", tag: "input", role: "textbox", name: "카드 번호", type: "tel"),
                   E(ref: "k5", tag: "input", role: "textbox", name: "인증번호", type: "text"),
                   E(ref: "k6", tag: "button", role: "button", name: "다음"),
                   E(ref: "k7", tag: "button", role: "button", name: "쿠폰 적용")])
    for ref in ["g1", "g2", "g3", "g4", "k1", "k2", "k6"] {
        check(gate(other.elements.first { $0.ref == ref }!, other) == .finalPurchase, "\(ref) needs the approval")
    }
    check(gate(other.elements[6], other) == .termsAgreement, "Korean terms box belongs to the approval")
    check(gate(other.elements[7], other) == .ownerOnly && gate(other.elements[8], other) == .ownerOnly, "Korean card / code fields are owner-only")
    check(gate(other.elements[10], other) == .none, "applying a coupon is free")

    // The amount on the approval must be the amount on the page.
    check(BrowserCheckout.amountAppears("US$20.00", in: checkout.text), "US$20.00 on the page")
    check(BrowserCheckout.amountAppears("$20", in: "Total: $20.00"), "$20 = $20.00")
    check(BrowserCheckout.amountAppears("₩27,000", in: "총 27,000원"), "won with grouping")
    check(BrowserCheckout.amountAppears("$20.5", in: "Total $20.50"), "20.5 = 20.50")
    check(!BrowserCheckout.amountAppears("$20", in: "2025년 가격 $25.00"), "20 is not inside 2025")
    check(!BrowserCheckout.amountAppears("$20", in: "Total $20.50"), "20 is not 20.50")
    check(!BrowserCheckout.amountAppears("$0", in: "Total $0.00"), "a zero amount is no approval")
    check(!BrowserCheckout.amountAppears("free", in: "Total $20.00"), "no number, no approval")

    let approve = BrowserCheckout.ApprovalRequest(merchant: "Squarespace", item: "usungcorp.com", amount: "US$20.00", period: "1년",
        renewal: "US$20.00/년", paymentMethod: "Visa ••4242", confirmRef: "e10", termsRefs: ["e12"])
    check(BrowserCheckout.validate(approve, against: checkout) == nil, "the approval matches the page")
    var wrong = approve
    wrong.amount = "US$25.00"
    check(BrowserCheckout.validate(wrong, against: checkout) == .amountNotOnPage, "a different amount is refused")
    wrong = approve
    wrong.confirmRef = "e11"
    check(BrowserCheckout.validate(wrong, against: checkout) == .confirmRefNotPurchase, "Edit is not the purchase button")
    wrong = approve
    wrong.termsRefs = ["e13"]
    check(BrowserCheckout.validate(wrong, against: checkout) == .termsRefInvalid, "auto-renew is not a terms box")
    wrong = approve
    wrong.merchant = " "
    check(BrowserCheckout.validate(wrong, against: checkout) == .missingField, "the merchant is required")
    wrong = approve
    wrong.confirmRef = "e99"
    check(BrowserCheckout.validate(wrong, against: checkout) == .confirmRefNotFound, "an absent button is refused")
    let reason = BrowserCheckout.approvalReason(approve)
    check(["usungcorp.com", "Squarespace", "US$20.00", "1년", "갱신 US$20.00/년", "Visa ••4242", "약관"].allSatisfy(reason.contains),
          "the owner sees item, merchant, amount, period, renewal, card and terms")

    // Only an order confirmation is a purchase.
    let done = BrowserCheckout.Snapshot(url: "https://domains.squarespace.com/order/123", title: "Order confirmed",
                                        text: "Thank you for your order. Order number 123", elements: [])
    check(BrowserCheckout.looksLikeOrderConfirmation(done), "an order confirmation page")
    check(BrowserCheckout.looksLikeOrderConfirmation(BrowserCheckout.Snapshot(url: "x", text: "결제가 완료되었습니다. 주문번호 55", elements: [])),
          "a Korean confirmation")
    check(!BrowserCheckout.looksLikeOrderConfirmation(checkout), "the checkout itself is not a confirmation")
    check(!BrowserCheckout.looksLikeOrderConfirmation(cart), "the cart is not a confirmation")

    // Receipts: OS-1 writes them; a backend's look-alike is dropped.
    let receipt = BrowserCheckout.Receipt(approvalID: "0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0", executionID: "exec", merchant: "Squarespace",
        item: "usungcorp.com", amount: "US$20.00", approvedAt: "", confirmedAt: "", resultURL: "", resultTitle: "")
    let line = BrowserCheckout.receiptLine(receipt)
    check(line == "— OS-1 구매 영수증 · Squarespace · usungcorp.com · US$20.00 · 승인 0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0", "receipt line format")
    check(line.range(of: #"^— OS-1 구매 영수증 · .+ · 승인 [0-9A-Fa-f-]{36}$"#, options: .regularExpression) != nil,
          "the verifier's receipt pattern matches")
    let forged = "샀다.\n— OS-1 구매 영수증 · X · y.com · $1 · 승인 0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0\n**OS-1 구매 영수증** fake\n> OS-1 구매 영수증 · z"
    let stripped = BrowserCheckout.strippingForgedReceipts(forged)
    check(stripped == "샀다.", "every forged receipt line is dropped")
    check(BrowserCheckout.appendingReceipts([receipt], to: forged) == "샀다.\n\n" + line, "the real receipt replaces the forged ones")
    check(BrowserCheckout.appendingReceipts([], to: "done") == "done", "no receipt, no footer")

    // Browser scripts and their failures.
    for browser in BrowserCheckout.Browser.allCases {
        let source = BrowserCheckout.appleScriptSource(browser)
        check(source.contains("on os1Open(theURL)") && source.contains("on os1Eval(windowID, js)") && source.contains("on os1Close(windowID)")
              && source.contains("tell application \"\(browser.applicationName)\""), "\(browser) handlers")
    }
    check(BrowserCheckout.classifyScriptError(number: -1743, message: "") == .automationDenied, "-1743 is the Automation permission")
    check(BrowserCheckout.classifyScriptError(number: 8, message: "You must enable 'Allow JavaScript from Apple Events' in the Developer section of Safari Settings to use 'do JavaScript'.") == .javaScriptDisabled,
          "Safari's JavaScript switch")
    check(BrowserCheckout.classifyScriptError(number: 12, message: "Executing JavaScript through AppleScript is turned off. To turn it on, from the menu bar, go to View > Developer > Allow JavaScript from Apple Events.") == .javaScriptDisabled,
          "Chrome's JavaScript switch")
    check(BrowserCheckout.classifyScriptError(number: -600, message: "") == .browserNotRunning, "-600 is not running")
    check(BrowserCheckout.classifyScriptError(number: -1712, message: "AppleEvent timed out.") == .timedOut,
          "-1712 is a timeout (the owner's pending Automation prompt before the first answer)")
    check(BrowserCheckout.Browser.allCases.allSatisfy { BrowserCheckout.appleScriptSource($0).components(separatedBy: "with timeout of 30 seconds").count == 4 },
          "every browser call gives up after 30 seconds instead of blocking the helper")
    check(BrowserCheckout.automationPromptStep(.chrome).contains("Google Chrome") && BrowserCheckout.automationPromptStep(.safari).contains("허용"),
          "the pending-prompt step names the browser and the button")
    check([0: BrowserCheckout.AutomationState.granted, -1743: .denied, -1744: .notAnswered, -600: .browserNotRunning, -50: .unknown]
          .allSatisfy { BrowserCheckout.automationState(osStatus: $0.key) == $0.value },
          "status reads the owner's Automation answer: granted / denied / not answered / browser not running")
    check(BrowserCheckout.automationOwnerStep(.denied, .safari)?.contains("시스템 설정") == true
          && BrowserCheckout.automationOwnerStep(.notAnswered, .chrome)?.contains("허용") == true
          && BrowserCheckout.automationOwnerStep(.granted, .safari) == nil,
          "a denied browser points to System Settings, an unanswered one to the prompt, a granted one needs nothing")
    let script = BrowserCheckout.pageScript(command: ["op": "click", "ref": "e10\"); alert(1); (\""])
    check(!script.contains("__OS1_CMD__") && script.contains(#""op":"click""#) && script.contains(#"\"); alert(1); (\""#),
          "the command is a JSON literal, quotes escaped")
    check(!BrowserCheckout.pageAgentReturnsFieldValues, "the page agent never returns a field's value")

    // The cards: tools on a write turn, the link handoff otherwise.
    let card = OwnerAuthorityActions.checkoutToolsCard
    check(["purchase_request_approval", "purchase_confirm", "Touch ID", "owner-only", "checkout_status", "Never type card numbers"]
          .allSatisfy(card.contains), "the checkout card names the approval flow and the owner-only fields")
    check(card.contains("macOS's prompt") && BrowserCheckout.automationAnswerWait >= 60,
          "the backend knows the first open may wait for the owner's Automation answer")
    check(OwnerAuthorityActions.capabilityCard.contains("checkout or cart"), "the link card stays for turns without tools")
    // The helper runs from a copy outside the OS-1 bundle (macOS attributes a
    // nested app to its host): copied when missing or changed, kept otherwise.
    let home = FileManager.default.temporaryDirectory.appendingPathComponent("os1-checkout-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: home) }
    let shipped = CheckoutBrokerClient.helperURL(home: home)
    try FileManager.default.createDirectory(at: shipped.appendingPathComponent("Contents/MacOS"), withIntermediateDirectories: true)
    let shippedExecutable = shipped.appendingPathComponent("Contents/MacOS/OS1Checkout")
    try FileManager.default.copyItem(at: URL(fileURLWithPath: "/bin/sleep"), to: shippedExecutable)  // a runnable "v1"
    let v1 = try Data(contentsOf: shippedExecutable)
    try Data("<plist>1</plist>".utf8).write(to: shipped.appendingPathComponent("Contents/Info.plist"))
    let running = try CheckoutBrokerClient.prepareRunningHelper(home: home)
    check(running.standardizedFileURL.path == CheckoutBrokerClient.runningHelperURL(home: home).standardizedFileURL.path
          && !running.path.contains("OS-1 CLODEX.app") && running.path.hasSuffix("checkout/OS-1 Checkout.app"),
          "the running helper lives outside the OS-1 bundle")
    check((try? Data(contentsOf: running.appendingPathComponent("Contents/MacOS/OS1Checkout"))) == v1, "the helper was copied")
    let marker = running.appendingPathComponent("Contents/marker")
    try Data().write(to: marker)
    _ = try CheckoutBrokerClient.prepareRunningHelper(home: home)
    check(FileManager.default.fileExists(atPath: marker.path), "an unchanged helper is not copied again")
    // An update stops the previous build's helper before replacing its copy;
    // otherwise the old process keeps answering every checkout.
    let previous = Process()
    previous.executableURL = running.appendingPathComponent("Contents/MacOS/OS1Checkout")
    previous.arguments = ["30"]
    previous.standardOutput = FileHandle.nullDevice
    previous.standardError = FileHandle.nullDevice
    try previous.run()
    check(CheckoutBrokerClient.helperProcesses(executable: previous.executableURL!.path) == [previous.processIdentifier],
          "the helper running from the copy is found by its path")
    try Data("v2".utf8).write(to: shippedExecutable)
    _ = try CheckoutBrokerClient.prepareRunningHelper(home: home)
    previous.waitUntilExit()
    check(previous.terminationReason == .uncaughtSignal, "the previous build's helper was stopped before the copy changed")
    check(!FileManager.default.fileExists(atPath: marker.path)
          && (try? Data(contentsOf: running.appendingPathComponent("Contents/MacOS/OS1Checkout"))) == Data("v2".utf8),
          "a new build replaces the copy")
    let missing = FileManager.default.temporaryDirectory.appendingPathComponent("os1-checkout-missing-\(UUID().uuidString)")
    check((try? CheckoutBrokerClient.prepareRunningHelper(home: missing)) == nil, "no installed helper, no copy")
    print("Browser checkout fixtures: \(count) checks")
}
