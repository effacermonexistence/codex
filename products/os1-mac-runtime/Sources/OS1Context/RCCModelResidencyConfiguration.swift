import Foundation

/// Finite residency for the private tools-free RCC router only. This changes
/// neither global Ollama defaults nor model selection, tools or permissions.
public enum RCCModelResidencyConfiguration {
    public enum Failure: Error { case malformedConfiguration, routerModelMissingOrAmbiguous }
    /// Build 446: the machine's one local model (`LocalModelSelection.active`).
    public static var modelID: String { LocalModelSelection.active.name }
    public static let keepAlive = "30m"

    public static func applying(to config: [String: Any]) throws -> [String: Any] {
        func object(_ value: Any?) throws -> [String: Any] {
            guard let value = value as? [String: Any] else { throw Failure.malformedConfiguration }
            return value
        }
        var result = config
        var models = try object(config["models"])
        var providers = try object(models["providers"])
        var ollama = try object(providers["ollama"])
        guard var rows = ollama["models"] as? [[String: Any]] else { throw Failure.malformedConfiguration }
        let matches = rows.indices.filter { rows[$0]["id"] as? String == modelID }
        guard matches.count == 1, let index = matches.first else { throw Failure.routerModelMissingOrAmbiguous }
        var params = try object(rows[index]["params"])
        params["keep_alive"] = keepAlive
        rows[index]["params"] = params
        ollama["models"] = rows; providers["ollama"] = ollama
        models["providers"] = providers; result["models"] = models

        // The actual native constructor has no agents.defaults.models. A
        // missing optional override is valid; never manufacture that map/row.
        guard let rawAgents = config["agents"] else { return result }
        var agents = try object(rawAgents)
        guard let rawDefaults = agents["defaults"] else { return result }
        var defaults = try object(rawDefaults)
        guard let rawOverrides = defaults["models"] else { return result }
        var overrides = try object(rawOverrides)
        let key = "ollama/" + modelID
        guard let rawModel = overrides[key] else { return result }
        var model = try object(rawModel)
        var overrideParams = try model["params"].map { try object($0) } ?? [:]
        overrideParams["keep_alive"] = keepAlive
        model["params"] = overrideParams; overrides[key] = model
        defaults["models"] = overrides; agents["defaults"] = defaults; result["agents"] = agents
        return result
    }
}
