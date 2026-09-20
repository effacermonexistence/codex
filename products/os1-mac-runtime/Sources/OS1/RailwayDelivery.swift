import Foundation
import OS1Context

/// Read-only verification outside the producing backend. No provisioning,
/// deployment, credential extraction or automatic retry happens in this gate.
enum RailwayDelivery {
    static func failure(output: String, workspace: String) async -> String? {
        guard let path = WebsiteDelivery.receiptPath(in: output) else { return nil }
        do {
            let root = URL(fileURLWithPath: workspace).resolvingSymlinksInPath().standardizedFileURL.path
            let file = URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL
            guard path.hasPrefix("/"), file.path.hasPrefix(root + "/") else { return "Railway receipt is outside the active workspace" }
            let data = try Data(contentsOf: file)
            guard data.count < 32_768 else { return "Railway receipt is oversized" }
            let receipt = try JSONDecoder().decode(WebsiteDelivery.Receipt.self, from: data)
            let projectRoot = URL(fileURLWithPath: receipt.workspace).resolvingSymlinksInPath().standardizedFileURL.path
            guard file.path.hasPrefix(projectRoot + "/"), receipt.validate(workspace: root), let base = URL(string: receipt.url),
                  let proof = URL(string: receipt.proofPath, relativeTo: base)?.absoluteURL else { return "Railway receipt identity or URL is invalid" }
            let fm = FileManager.default
            let candidates = [fm.homeDirectoryForCurrentUser.appendingPathComponent(".railway/bin/railway").path,
                              "/opt/homebrew/bin/railway", "/usr/local/bin/railway"]
            guard let cli = candidates.first(where: { fm.isExecutableFile(atPath: $0) }) else { return "Railway CLI unavailable for independent verification" }
            let (code, raw, _) = try commandOutput(cli, ["deployment", "list", "--project", receipt.projectID,
                "--service", receipt.serviceID, "--environment", receipt.environmentID, "--limit", "100", "--json"], timeout: 30)
            guard code == 0,
                  let deployments = try JSONSerialization.jsonObject(with: raw) as? [[String: Any]],
                  let match = deployments.first(where: { $0["id"] as? String == receipt.deploymentID }),
                  match["status"] as? String == "SUCCESS" else { return "Exact Railway deployment is not independently confirmed SUCCESS" }
            let (domainCode, domainRaw, _) = try commandOutput(cli, ["domain", "list", "--project", receipt.projectID,
                "--service", receipt.serviceID, "--environment", receipt.environmentID, "--json"], timeout: 30)
            guard domainCode == 0, WebsiteDelivery.assignedDomainMatches(domainRaw, url: base) else {
                return "Public URL is not an active domain of the exact Railway service/environment"
            }
            let config = URLSessionConfiguration.ephemeral
            config.timeoutIntervalForRequest = 10; config.timeoutIntervalForResource = 15
            let session = URLSession(configuration: config, delegate: ManagedPreview.NoRedirect(), delegateQueue: nil)
            defer { session.invalidateAndCancel() }
            let (body, response) = try await session.data(from: proof)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  http.url?.host == base.host, body.count <= 65_536,
                  sha256Hex(body) == receipt.proofSHA256.lowercased() else { return "Public Railway proof bytes do not match this delivery" }
            let (_, pageResponse) = try await session.data(from: base)
            guard let page = pageResponse as? HTTPURLResponse, (200...299).contains(page.statusCode), page.url?.host == base.host else { return "Railway public page is not healthy" }
            return nil
        } catch { return "Railway delivery verification failed: \(error.localizedDescription)" }
    }
}
