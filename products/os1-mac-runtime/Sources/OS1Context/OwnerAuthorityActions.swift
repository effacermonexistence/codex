import Foundation

/// Steps only the owner completes: buying, paying, subscribing, signing up,
/// accepting terms, sending money. Owner, 2026-10-02, a domain-naming
/// conversation: "스퀘어스페이스나 고데리 닷컴 가서 하나 사자고" and, after
/// choosing, "해라고" — both turns tried to drive Chrome through Computer Use
/// (not approved on this Mac) for 3 and 6 minutes and ended on the missing
/// permission instead of on the checkout. The backend gets this card on such
/// turns, so the answer is the checked price and the one link the owner pays
/// at, as Claude Code stops at the payment confirmation.
public enum OwnerAuthorityActions {
    public static let capabilityCard = """
    OS-1 owner-authority steps: purchases, payments, subscriptions, account sign-ups, accepting terms and sending money are completed by the owner, never by OS-1. When a request reaches one of them, first do everything that needs no owner login (availability, the exact first-year and renewal price, the seller, what is included), then give one direct link that opens the checkout or cart for the chosen item, its price, and the one thing the owner does there. Do not drive a browser, Computer Use or a payment form for these steps, and do not report a missing browser or Computer Use permission as the result. When the owner has already chosen ("이걸로 하자", "해", "사"), go straight to that link and price.
    """

    /// A write turn carries the OS-1 checkout tools (MCP server os1-checkout):
    /// the backend drives the seller's site in the owner's own browser and
    /// stops at the owner's approval. Owner, 2026-10-02: "결제 퍼미션 창을 자기
    /// 혼자 띄울 수 있고 … 승인 버튼만 눌러주면 되게 … 사파리나 크롬 둘 다".
    public static let checkoutToolsCard = """
    OS-1 owner-authority steps: purchases, payments, subscriptions, account sign-ups, accepting terms and sending money need the owner's approval. This turn has the OS-1 checkout tools (MCP server os1-checkout); use them instead of only sending a link. Call checkout_status, then browser_open the seller's site (browser auto unless the owner named Safari or Chrome; the first open on a Mac can wait up to three minutes while the owner answers macOS's prompt to let OS-1 Checkout control the browser) and drive it with browser_snapshot, browser_type, browser_click, browser_select and browser_check: find the exact item, keep the period the owner asked for (one year if they did not say), decline paid add-ons, and go to the final review page. Never type card numbers, security codes, passwords or one-time codes; those fields are owner-only. If the site needs a sign-in, a 2-step code, a CAPTCHA or a new card, stop and tell the owner that one step and that the checkout window is open. On the final review page call purchase_request_approval with the merchant, the item, the total charged now exactly as shown, the renewal price and the payment method as shown, the final purchase button as confirm_ref and the terms boxes as terms_refs; the owner approves on the Mac with Touch ID or the password. Only when it returns approved, call purchase_confirm once, then report the order number, what was bought and the amount. If the owner declines or the approval times out, buy nothing and say so. If checkout_status or a tool reports a setup step (owner_step), give the owner that exact step together with the checked price and one checkout link. Do not use Computer Use or any other browser automation for these steps.
    """

    /// Words that put a purchase, a sign-up or a payment in play.
    static let terms = [
        "구매", "구입", "결제", "결재", "주문", "가입", "구독", "사자", "사줘", "사 줘", "사고 싶", "살래", "사버", "질러",
        "스퀘어스페이스", "고대디", "고데리", "고 대디", "네임칩",
        "godaddy", "squarespace", "namecheap", "checkout", "purchase", "subscribe", "sign up", "payment",
    ]

    /// The card rides on turns whose request is about such a step, and on a
    /// short follow-up ("해라고", "이걸로 하자") of a conversation that is.
    public static func relevant(request: String, context: String?) -> Bool {
        let value = request.precomposedStringWithCanonicalMapping.lowercased()
        if terms.contains(where: value.contains) { return true }
        guard value.count <= 80, let context, !context.isEmpty else { return false }
        let recent = String(context.precomposedStringWithCanonicalMapping.lowercased().suffix(3_000))
        return terms.contains(where: recent.contains)
    }
}

/// What the composer is about to send.
public enum ComposerInput {
    /// Only ASCII punctuation, symbols and spaces ("\\", "\\\\\\", "'''''"): a
    /// stray key, not a request. Each one used to start a full agent turn
    /// (2026-10-02: "\\\\\\" cost 183k input tokens and 25 s to be asked to
    /// resend). Letters, digits, every non-ASCII character (Korean, emoji)
    /// and a "?" or "!" (the owner asking "well?") still send.
    public static func isSymbolsOnly(_ text: String) -> Bool {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !value.contains("?"), !value.contains("!") else { return false }
        return value.unicodeScalars.allSatisfy { scalar in
            scalar.isASCII && !CharacterSet.alphanumerics.contains(scalar)
        }
    }
}
