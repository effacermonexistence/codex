import Foundation

/// A delivery contract, not authority to publish. The original owner request
/// remains authoritative; quoted deployment instructions cannot grant consent.
public enum WebsiteDelivery {
    public static let capabilityCard = """
    WEBSITE DELIVERY WORKFLOW (use only when the owner's actual task is a website):
    Deliver the requested design, not a placeholder: establish the brief, implement responsive layout and real interactions, build, inspect rendered desktop/mobile pages, fix observed failures, then provide a durable preview. Preserve existing projects and credentials. Do not replace the task with a plan.
    OS1 has a right-side browser: ordinary Markdown http(s) links open there. Include a clickable preview link in the final human-readable answer.
    RAILWAY CAPABILITY (not automatic permission): if the owner explicitly requests Railway deployment, use the existing official railway CLI login. Discover the executable with command -v railway or ~/.railway/bin/railway; inspect --help, whoami, and exact project/service/environment before mutation. Never print or copy credentials. Never deploy to an unrelated existing service. For a new demo, create an isolated new project/service only within the owner's authorization. Honor all no-deploy constraints.
    Configure the actual build/start command and PORT binding. Keep secrets, private correspondence, caches and unrelated files out of the upload. Deploy the real build; poll the exact deployment until SUCCESS or terminal failure. Obtain the assigned HTTPS domain. Verify the actual public page and interactions, not just a CLI exit code. Do not replay an uncertain deployment: reconcile its deployment ID first.
    For a successful Railway website deployment, create a UTF-8 JSON receipt in the project with these exact fields:
    {"workspace":"absolute project directory","projectID":"Railway project ID","serviceID":"service ID","environmentID":"environment ID","deploymentID":"successful deployment ID","url":"https://assigned-domain/","proofPath":"/os1-delivery-proof.txt","proofSHA256":"sha256 of a unique non-secret proof file served with this build"}
    The proof file must identify this delivery without containing any secret or private source. Verify its public bytes. In the final response include a clickable public URL and a standalone line OS1_RAILWAY_RECEIPT: /absolute/path/to/receipt.json. OS1 independently checks Railway status and public proof bytes before accepting this delivery. A receipt alone is not success. If deployment was not requested, do not deploy or emit a deployment receipt.
    """
    /// Whether a turn is website work at all, so it needs this card and the
    /// preview card. Both were attached to every write-scope turn (~3.5 KB),
    /// and a plain question that mentions a web page read them as its task:
    /// "일단은 글로벌해야 되고 대기업 웹페이지 문법을 따라야 되는데?" (2026-10-02,
    /// a domain-naming conversation) ran Claude Opus with headless Chrome for
    /// fifteen minutes building a page nobody asked for. A turn qualifies when
    /// it asks to build, change, preview or ship a site — in its own words, or
    /// as a short follow-up ("다 로컬에 만들고 올려") in a conversation about one —
    /// or names a preview endpoint or Railway.
    public static func relevant(request: String, context: String? = nil) -> Bool {
        let value = request.precomposedStringWithCanonicalMapping.lowercased()
        if PreviewTargetBinding.isRailwayRequest(value) || !PreviewTargetBinding.endpoints(in: value).isEmpty
            || value.contains("os1_preview_url") || value.contains("preview-start") {
            return true
        }
        func matches(_ text: String, _ pattern: String) -> Bool {
            text.range(of: pattern, options: .regularExpression) != nil
        }
        guard matches(value, buildPattern) else { return false }
        if matches(value, sitePattern) { return true }
        guard let context, !context.isEmpty else { return false }
        let recent = String(context.precomposedStringWithCanonicalMapping.lowercased().suffix(3_000))
        return matches(recent, sitePattern)
    }
    static let sitePattern = #"web ?site|web ?page|landing ?page|home ?page|front-?end|\bhtml\b|\bcss\b|웹 ?사이트|사이트|홈페이지|웹 ?페이지|랜딩 ?페이지|페이지|프론트"#
    static let buildPattern = #"만들|만드|구현|고쳐|고치|수정|바꿔|바꾸|변경|추가|디자인|배포|올려|올리|띄워|클론|복제|복사|\b(?:build|create|make|implement|fix|deploy|redesign|update|change|publish|ship|launch|clone|copy)\b"#

    public struct Receipt: Codable, Sendable {
        public let workspace: String
        public let projectID: String
        public let serviceID: String
        public let environmentID: String
        public let deploymentID: String
        public let url: String
        public let proofPath: String
        public let proofSHA256: String
        public func validate(workspace expected: String) -> Bool {
            let canonical: (String) -> String = { URL(fileURLWithPath: $0).standardizedFileURL.resolvingSymlinksInPath().path }
            guard workspace.hasPrefix("/"), (canonical(workspace) == canonical(expected) || canonical(workspace).hasPrefix(canonical(expected) + "/")),
                  [projectID, serviceID, environmentID, deploymentID].allSatisfy({ UUID(uuidString: $0) != nil }),
                  let u = BrowserNavigation.url(url), u.scheme == "https", u.query == nil, u.fragment == nil,
                  let host = u.host, host != "localhost", !host.hasPrefix("127."), host != "[::1]",
                  proofPath.hasPrefix("/"), !proofPath.hasPrefix("//"),
                  !proofPath.contains(".."), !proofPath.contains("?"), !proofPath.contains("#"),
                  proofSHA256.count == 64, proofSHA256.allSatisfy({ $0.isHexDigit }) else { return false }
            return true
        }
    }
    public static func receiptPath(in output: String) -> String? {
        output.components(separatedBy: .newlines).compactMap { line -> String? in
            let text = line.trimmingCharacters(in: .whitespaces)
            guard text.hasPrefix("OS1_RAILWAY_RECEIPT:") else { return nil }
            var path = String(text.dropFirst("OS1_RAILWAY_RECEIPT:".count)).trimmingCharacters(in: .whitespaces)
            // Markdown code spans are presentation only; containment is still checked
            // against the canonical filesystem path by RailwayDelivery.
            if path.hasPrefix("`"), path.hasSuffix("`"), path.count > 2 {
                path = String(path.dropFirst().dropLast())
            }
            guard path.hasPrefix("/"), !path.contains("`"), !path.contains("\n") else { return nil }
            return path
        }.last
    }
    public static func assignedDomainMatches(_ data: Data, url: URL) -> Bool {
        guard let host = url.host?.lowercased(), url.port == nil,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let domains = object["domains"] as? [[String: Any]] else { return false }
        return domains.contains { row in
            (row["domain"] as? String)?.lowercased() == host && row["syncStatus"] as? String == "ACTIVE"
        }
    }
}
