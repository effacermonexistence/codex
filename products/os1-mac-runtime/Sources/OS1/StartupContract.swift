import Foundation

/// Critical transport contract, acknowledged and signed by the issuer after
/// source-bound capability/model validation. Not a local permission grant.
struct StartupContract: Codable, Equatable {
    let schema: Int
    let completionFeedbackSchema: Int
    let modelAvailabilitySchema: Int
    let executorContractSHA256: String
    let model: String
    let effort: String
    let stateStorage: String

    enum CodingKeys: String, CodingKey {
        case schema, model, effort
        case completionFeedbackSchema = "completion_feedback_schema"
        case modelAvailabilitySchema = "model_availability_schema"
        case executorContractSHA256 = "executor_contract_sha256"
        case stateStorage = "state_storage"
    }
    var isValid: Bool {
        schema == 1 && completionFeedbackSchema == 1 && modelAvailabilitySchema == 1 &&
        executorContractSHA256.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil &&
        model.range(of: #"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"#, options: .regularExpression) != nil &&
        ["none", "low", "medium", "high", "xhigh", "max", "ultra"].contains(effort) && stateStorage == "pool_v1"
    }
    var canonicalFields: [String] {
        [String(schema), String(completionFeedbackSchema), String(modelAvailabilitySchema),
         executorContractSHA256, model, effort, stateStorage]
    }
}
