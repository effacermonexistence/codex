import Foundation

public enum OS1RuntimeBuild {
    public static let identity = "0.9.22/72-air-fleet-repair-20260906-v2"
}

public struct FleetRunProvenance: Codable, Sendable {
    public let objective: String
    public let mode: String
    public let executorDeviceID: String?
    public let jobID: String?
    public let resultSHA256: String?
    public let localReason: String?
    public init(objective: String = "os1-fleet-objective-v1", mode: String = "single_node",
                executorDeviceID: String? = nil, jobID: String? = nil,
                resultSHA256: String? = nil, localReason: String? = nil) {
        self.objective = objective; self.mode = mode; self.executorDeviceID = executorDeviceID
        self.jobID = jobID; self.resultSHA256 = resultSHA256; self.localReason = localReason
    }
}
