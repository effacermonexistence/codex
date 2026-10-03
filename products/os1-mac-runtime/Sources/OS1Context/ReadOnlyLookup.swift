import Foundation

/// Domain lookups an answer needs and the read-only lane's shell can make.
/// Owner, 2026-10-02, a domain-naming conversation: "다른 거 좀 줘봐. 짧고
/// 단순한 거. 근데 무조건 닷컴이어야 돼." Build 301 moved such turns to the
/// read-only lane, whose sandboxed shell then refused every registry check
/// (`curl: (56) CONNECT tunnel failed, response 403`), so the answer could not
/// say which names were free and the agent spent minutes mining old
/// transcripts for earlier checks instead.
public enum ReadOnlyLookup {
    /// Public RDAP registries named by IANA's bootstrap
    /// (data.iana.org/rdap/dns.json, read 2026-10-02): registration records
    /// over HTTPS GET, no account. The read-only lane's sandbox lets its shell
    /// reach these hosts and no others.
    public static let registryHosts = [
        "rdap.verisign.com",                // .com, .net
        "rdap.publicinterestregistry.org",  // .org
        "rdap.identitydigital.services",    // .ai, .info
        "pubapi.registry.google",           // .app, .dev
        "rdap.centralnic.com",              // .xyz
        "rdap.nic.or.kr",                   // .kr
        "data.iana.org",                    // the bootstrap naming other TLDs' registries
    ]

    /// Owner, the same day: "유성 도메인 하나 만들어라" got a free
    /// usung.up.railway.app address; the conversation then went to buying
    /// usung.com — a domain for a company is a name the owner registers.
    public static let capabilityCard = """
    OS-1 domain lookups: a domain for a company or site is a registrable name such as example.com that the owner buys; use the native agent's existing tools to propose names, check availability and prepare the registrar checkout, respecting the task's permission profile and owner approval. A free platform subdomain such as *.up.railway.app or *.vercel.app is not that unless the owner asks for one. Preserve existing working URLs, platform domains, DNS and deployments. Never rename, remove or replace an existing platform address as a substitute for registering a new domain. Adding a custom domain and changing an existing service URL are different actions; the latter requires an explicit owner request. If the requested domain action is materially ambiguous, clarify rather than changing existing infrastructure. Whether a domain is registered is its registry's RDAP record. For .com run `curl -s -o /dev/null -w '%{http_code}' https://rdap.verisign.com/com/v1/domain/NAME.com` (.net: /net/v1/); 404 means no registration record, so the name can be registered, and 200 means it is taken. https://data.iana.org/rdap/dns.json names the registry for other TLDs. When you propose or compare domain names, check each one this way and say when you checked. Read web pages with the web fetch tool and search with web search; a sandboxed shell may not reach other hosts.
    """

    static let terms = ["도메인", "닷컴", "닷넷", "domain", "rdap", "whois"]
    /// A name ending in a common TLD ("usungcorp.com", "theusung.co.kr");
    /// file names such as README.md or main.swift do not match.
    static let domainName = #"[a-z0-9-]+\.(?:com|net|org|io|co|ai|kr|app|dev|xyz|me|info|biz)(?![a-z0-9])"#

    /// The card rides on turns about domain names, and on a short follow-up
    /// ("다른 거 줘봐", "이걸로 하자") of a conversation that is.
    public static func relevant(request: String, context: String?) -> Bool {
        if mentionsDomains(request) { return true }
        guard request.count <= 120, let context, !context.isEmpty else { return false }
        return mentionsDomains(String(context.suffix(3_000)))
    }

    static func mentionsDomains(_ text: String) -> Bool {
        let value = text.precomposedStringWithCanonicalMapping.lowercased()
        return terms.contains(where: value.contains)
            || value.range(of: domainName, options: .regularExpression) != nil
    }
}
