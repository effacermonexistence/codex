import Foundation

/// Explicit current-request endpoints outrank project history and old receipts.
public enum PreviewTargetBinding {
    public static func shouldBindNewDeployment(request: String, readOnly: Bool) -> Bool {
        !readOnly && isRailwayRequest(request) && !endpoints(in: request).isEmpty
    }
    public static func endpoints(in request: String) -> [URL] {
        let pattern = #"(https?)://(?:127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})(?=[/\s)\]}>]|$)"#
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return [] }
        let ns = request as NSString
        return Array(Set(re.matches(in: request, range: NSRange(location: 0, length: ns.length)).compactMap { m -> String? in
            guard let p = Int(ns.substring(with: m.range(at: 2))), (1024...65535).contains(p) else { return nil }
            return "\(ns.substring(with: m.range(at: 1)).lowercased())://127.0.0.1:\(p)/"
        })).sorted().compactMap(URL.init(string:))
    }
    public static func isRailwayRequest(_ request: String) -> Bool {
        let s = request.lowercased()
        return ["railway", "레일웨이", "레일리웨이", "레일리 웨이", "레이웨이"].contains(where: s.contains)
    }
    public static func matchesDelivery(proof: Data, requestID: String, htmlSHA256: String, servedHTMLSHA256: String) -> Bool {
        guard let fields = (try? JSONSerialization.jsonObject(with: proof)) as? [String: Any],
              fields["requestID"] as? String == requestID,
              fields["previewHTMLSHA256"] as? String == htmlSHA256,
              servedHTMLSHA256 == htmlSHA256 else { return false }
        return true
    }
    public static func sameWorkspace(_ a: String, _ b: String) -> Bool {
        func canonical(_ s: String) -> String { URL(fileURLWithPath:s).resolvingSymlinksInPath().standardizedFileURL.path }
        return a.hasPrefix("/") && b.hasPrefix("/") && canonical(a) == canonical(b)
    }
}

/// Issued only by the CLI's independent Railway + live-preview readback.
/// Model text is never decoded into this receipt.
public struct VerifiedPreviewDelivery: Codable, Sendable {
    public let previewURL: String
    public let deploymentID: String
    public let verifiedAt: Double
    public init(previewURL: String, deploymentID: String, verifiedAt: Double) {
        self.previewURL = previewURL; self.deploymentID = deploymentID; self.verifiedAt = verifiedAt
    }
    public func matchesControlReceipt(_ receipt: [String: Any]) -> Bool {
        receipt["operation"] as? String == "preview_delivery_readback" &&
        receipt["model_invoked"] as? Bool == false && receipt["deployment_invoked"] as? Bool == false &&
        receipt["railway_identity_verified"] as? Bool == true && receipt["public_content_verified"] as? Bool == true &&
        receipt["preview_url"] as? String == previewURL && receipt["deployment_id"] as? String == deploymentID &&
        receipt["verified_at"] as? Double == verifiedAt
    }
    public func completes(originalRequest: String, effectsApplied: Bool, nativeAdopted: Bool,
                          now: Double = Date().timeIntervalSince1970) -> Bool {
        let endpoints = PreviewTargetBinding.endpoints(in: originalRequest)
        return effectsApplied && nativeAdopted && PreviewTargetBinding.isRailwayRequest(originalRequest)
            && endpoints.count == 1 && endpoints.first?.absoluteString == previewURL
            && UUID(uuidString: deploymentID) != nil && verifiedAt <= now && now - verifiedAt <= 300
    }
}
