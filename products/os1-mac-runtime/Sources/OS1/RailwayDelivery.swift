import Foundation
import OS1Context

/// Read-only verification outside the producing backend. No provisioning,
/// deployment, credential extraction or automatic retry happens in this gate.
enum RailwayDelivery {
    static func failure(output: String, workspace: String, target: PreviewDeploymentTarget? = nil) async -> String? {
        guard let path = WebsiteDelivery.receiptPath(in: output) else {
            let hasMarker = output.components(separatedBy: .newlines).contains {
                $0.trimmingCharacters(in: .whitespaces).hasPrefix("OS1_RAILWAY_RECEIPT:")
            }
            return hasMarker ? "Railway delivery receipt marker is malformed" :
                (target == nil ? nil : "Requested Railway deployment has no delivery receipt")
        }
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
            if let target, !PreviewTargetBinding.sameWorkspace(receipt.workspace, target.workspace) {
                return "Railway receipt does not belong to the requested preview source"
            }
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
            let (pageBody, pageResponse) = try await session.data(from: base)
            guard let page = pageResponse as? HTTPURLResponse, (200...299).contains(page.statusCode), page.url?.host == base.host else { return "Railway public page is not healthy" }
            if let target {
                guard PreviewTargetBinding.matchesDelivery(proof: body, requestID: target.requestID,
                    htmlSHA256: target.htmlSHA256, servedHTMLSHA256: sha256Hex(pageBody)) else {
                    return "Railway delivery does not match the current request and requested preview HTML"
                }
            }
            return nil
        } catch { return "Railway delivery verification failed: \(error.localizedDescription)" }
    }
    /// A recovery verifies the current target, not a cached model answer. Only
    /// inspect receipts in the proven listener workspace; never search global demos.
    static func recoverySummary(request: String) async throws -> RunSummary? {
        guard let target = try? await PreviewDeploymentTarget.resolve(request: request, requestID: "readback") else { return nil }
        let started = Date()
        let root = URL(fileURLWithPath: target.workspace)
        let files = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        let candidates = files.filter { $0.pathExtension == "json" && $0.lastPathComponent.lowercased().contains("receipt") }
        guard candidates.count <= 32 else { return nil }
        var verified: [(WebsiteDelivery.Receipt, VerifiedPreviewDelivery)] = []
        RuntimeActivity.emit(.verifying, publicText: "Railway live deployment and current preview readback · no model or redeployment")
        for file in candidates {
            guard let data = try? Data(contentsOf: file), data.count < 32_768,
                  let receipt = try? JSONDecoder().decode(WebsiteDelivery.Receipt.self, from: data),
                  PreviewTargetBinding.sameWorkspace(receipt.workspace, target.workspace) else { continue }
            let marker = "OS1_RAILWAY_RECEIPT: \(file.path)"
            guard await failure(output: marker, workspace: target.workspace) == nil,
                  let evidence = await recoveredPreview(output: marker, workspace: target.workspace, request: request) else { continue }
            verified.append((receipt, evidence))
        }
        guard verified.count == 1, let (delivery, evidence) = verified.first else { return nil }
        let output = """
        Ben.
        LuaIsHere :3

        Railway 배포를 현재 상태에서 다시 검증했습니다. 재배포하지 않았습니다.
        • 공개 페이지: \(delivery.url)
        • Deployment: \(delivery.deploymentID) · SUCCESS
        • 요청한 로컬 미리보기와 공개 HTML 일치
        • 서비스·환경·도메인과 공개 proof 해시 일치
        • 모델 재실행 없음
        OS1_EFFECTS: applied
        """
        let id = UUID().uuidString.lowercased()
        let directory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1/control-receipts")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let receiptURL = directory.appendingPathComponent("\(id).json")
        let record: [String: Any] = ["schema": 1, "operation": "preview_delivery_readback",
            "operation_id": id, "result_sha256": sha256Hex(Data(output.utf8)),
            "request_sha256": sha256Hex(Data(request.utf8)), "model_invoked": false,
            "deployment_invoked": false, "preview_url": evidence.previewURL,
            "deployment_id": evidence.deploymentID, "verified_at": evidence.verifiedAt,
            "railway_identity_verified": true, "public_content_verified": true]
        try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]).write(to: receiptURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: receiptURL.path)
        return RunSummary(status: "complete", steps: [RunStepSummary(sequence: 1, provider: "local",
            action: "preview_delivery_readback", model: "os1-delivery-verifier", effort: "none",
            revasDisposition: "control_verified", sessionID: id, permissionProfile: "local_control",
            exitCode: 0, output: output, stderr: "", durationMS: Int64(Date().timeIntervalSince(started) * 1000),
            nativeRecord: NativeRecordEvidence(turnID: id, recordPath: receiptURL.path,
                persistence: "verified", desktopVisibility: "control_only"), verifiedPreviewDelivery: evidence)])
    }

    /// Optional completion evidence for recovery, never a new deployment identity.
    /// Requires the full independent gate above plus exact current preview bytes.
    static func recoveredPreview(output: String, workspace: String, request: String) async -> VerifiedPreviewDelivery? {
        guard let path = WebsiteDelivery.receiptPath(in: output),
              let target = try? await PreviewDeploymentTarget.resolve(request: request, requestID: "readback"),
              let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
              let receipt = try? JSONDecoder().decode(WebsiteDelivery.Receipt.self, from: data),
              PreviewTargetBinding.sameWorkspace(receipt.workspace, target.workspace),
              let base = URL(string: receipt.url), let proof = URL(string: receipt.proofPath, relativeTo: base)?.absoluteURL else { return nil }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 5; configuration.timeoutIntervalForResource = 10
        let session = URLSession(configuration: configuration, delegate: ManagedPreview.NoRedirect(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        guard let (proofData, proofResponse) = try? await session.data(from: proof),
              (proofResponse as? HTTPURLResponse)?.statusCode == 200,
              sha256Hex(proofData) == receipt.proofSHA256.lowercased(),
              let fields = (try? JSONSerialization.jsonObject(with: proofData)) as? [String: Any],
              fields["previewHTMLSHA256"] as? String == target.htmlSHA256,
              let (page, response) = try? await session.data(from: base),
              (response as? HTTPURLResponse)?.statusCode == 200,
              sha256Hex(page) == target.htmlSHA256 else { return nil }
        return VerifiedPreviewDelivery(previewURL: target.url.absoluteString,
            deploymentID: receipt.deploymentID, verifiedAt: Date().timeIntervalSince1970)
    }

}
