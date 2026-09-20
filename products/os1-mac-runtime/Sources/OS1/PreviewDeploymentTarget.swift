import Foundation
import OS1Context

/// Resolve a local static preview from the live listener, then prove its source
/// using exact served bytes. No global workspace search, receipt reuse or writes.
struct PreviewDeploymentTarget {
    let workspace: String
    let url: URL
    let htmlSHA256: String
    let requestID: String

    static func resolve(request: String, requestID: String) async throws -> Self? {
        guard PreviewTargetBinding.isRailwayRequest(request) else { return nil }
        let endpoints = PreviewTargetBinding.endpoints(in: request)
        guard !endpoints.isEmpty else { return nil }
        guard endpoints.count == 1, let url = endpoints.first else { throw OS1Error.message("Multiple local deployment targets; select one endpoint. No deployment was started.") }
        let (code, raw, _) = try commandOutput("/usr/sbin/lsof", ["-nP", "-iTCP:\(url.port!)", "-sTCP:LISTEN", "-t"], timeout: 5)
        let pids = Set(String(decoding: raw, as: UTF8.self).split(whereSeparator: \.isNewline).map(String.init))
        guard code == 0, pids.count == 1, let pid = pids.first, Int(pid) != nil else {
            throw OS1Error.message("The requested preview has no unique live listener. Old deployment receipts cannot substitute for this target.")
        }
        let (_, cwdRaw, _) = try commandOutput("/usr/sbin/lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"], timeout: 5)
        guard let cwdLine = String(decoding: cwdRaw, as: UTF8.self).split(whereSeparator: \.isNewline).first(where: { $0.hasPrefix("n/") }) else { throw OS1Error.message("Cannot establish preview process workspace") }
        let root = URL(fileURLWithPath: String(cwdLine.dropFirst())).resolvingSymlinksInPath().standardizedFileURL
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 3; config.timeoutIntervalForResource = 5
        let session = URLSession(configuration: config, delegate: ManagedPreview.NoRedirect(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (body, response) = try await session.data(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200, body.count < 2_000_000 else { throw OS1Error.message("Requested preview is not HTTP-ready") }
        let fingerprint = sha256Hex(body)
        let matched = ["index.html", "dist/index.html", "public/index.html"].contains { relative in
            let file = root.appendingPathComponent(relative).resolvingSymlinksInPath()
            guard file.path.hasPrefix(root.path + "/"), let bytes = try? Data(contentsOf: file), bytes.count < 2_000_000 else { return false }
            return sha256Hex(bytes) == fingerprint
        }
        guard matched else { throw OS1Error.message("Live preview source identity could not be verified from its listener workspace. Preserve it; do not deploy a different project.") }
        return Self(workspace: root.path, url: url, htmlSHA256: fingerprint, requestID: requestID)
    }

    var contract: String {
        """
        CURRENT DEPLOYMENT TARGET — independently verified by OS1 before dispatch:
        Preview: \(url.absoluteString)
        Source workspace: \(workspace)
        Served HTML SHA-256: \(htmlSHA256)
        Request binding: \(requestID)
        Deploy THIS existing site. Do not substitute an earlier demo, old receipt, registered project, or source checkout. Inspect this workspace first. Preserve the existing page/design; only adjust deployment configuration/start for PORT and 0.0.0.0 as needed. Keep the existing local preview usable. The final public HTML must match the verified preview HTML.
        The deployment proof must be a JSON object with exact fields "requestID": "\(requestID)" and "previewHTMLSHA256": "\(htmlSHA256)". Keep credentials and private paths out of this public proof. Write the Railway receipt INSIDE this exact source workspace; its workspace field must equal this directory. A receipt from another task, an unrelated deployment or a merely copied proof file is not delivery.
        """
    }
}
