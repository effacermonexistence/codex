import Foundation

struct EXOConfiguration {
    let apiURL: URL
    let modelID: String
    let minimumNodes: Int
    let startupTimeoutSeconds: Int
    let maximumOutputTokens: Int

    init(runtimeConfig: RuntimeConfig) throws {
        let apiURLString = runtimeConfig.exoAPIURL ?? "http://127.0.0.1:52415"
        guard let apiURL = URL(string: apiURLString),
              apiURL.scheme == "http",
              apiURL.port == 52_415,
              ["127.0.0.1", "localhost", "::1"].contains(apiURL.host?.lowercased() ?? ""),
              apiURL.path.isEmpty || apiURL.path == "/" else {
            throw OS1Error.message("EXO must use the local loopback API on port 52415")
        }

        let modelID = runtimeConfig.exoModelID ?? "mlx-community/Qwen3-0.6B-4bit"
        guard modelID.range(of: "^[A-Za-z0-9._/-]{3,256}$", options: .regularExpression) != nil,
              modelID.contains("/") else {
            throw OS1Error.message("OS-1 EXO model configuration is invalid")
        }

        let minimumNodes = runtimeConfig.exoMinimumNodes ?? 2
        let startupTimeoutSeconds = runtimeConfig.exoStartupTimeoutSeconds ?? 180
        let maximumOutputTokens = runtimeConfig.exoMaximumOutputTokens ?? 1_024
        guard (2...8).contains(minimumNodes),
              (30...1_800).contains(startupTimeoutSeconds),
              (1...4_096).contains(maximumOutputTokens) else {
            throw OS1Error.message("OS-1 EXO limits are invalid")
        }

        self.apiURL = apiURL
        self.modelID = modelID
        self.minimumNodes = minimumNodes
        self.startupTimeoutSeconds = startupTimeoutSeconds
        self.maximumOutputTokens = maximumOutputTokens
    }
}

struct EXOInferenceResult {
    let output: String
    let durationMS: Int64
}

private struct EXOInstance {
    let id: String
    let runnerIDs: Set<String>
}

private enum EXOJSON {
    static func object(_ data: Data) throws -> [String: Any] {
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw OS1Error.message("EXO returned an invalid response")
        }
        return value
    }

    static func dictionary(_ value: Any?, named name: String) throws -> [String: Any] {
        guard let result = value as? [String: Any] else {
            throw OS1Error.message("EXO response is missing \(name)")
        }
        return result
    }

    static func string(_ value: Any?, named name: String) throws -> String {
        guard let result = value as? String, !result.isEmpty else {
            throw OS1Error.message("EXO response is missing \(name)")
        }
        return result
    }

    static func integer(_ value: Any?, named name: String) throws -> Int {
        guard let number = value as? NSNumber else {
            throw OS1Error.message("EXO response is missing \(name)")
        }
        return number.intValue
    }
}

private struct EXOClient {
    let configuration: EXOConfiguration

    private func url(path: String, queryItems: [URLQueryItem] = []) throws -> URL {
        guard var components = URLComponents(url: configuration.apiURL, resolvingAgainstBaseURL: false) else {
            throw OS1Error.message("EXO API URL is invalid")
        }
        components.path = path
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components.url else {
            throw OS1Error.message("EXO request URL is invalid")
        }
        return url
    }

    private func request(
        path: String,
        method: String = "GET",
        queryItems: [URLQueryItem] = [],
        body: Data? = nil,
        deadline: Date? = nil,
        maximumTimeoutSeconds: TimeInterval = 30
    ) async throws -> Data {
        let timeout: TimeInterval
        if let deadline {
            let remaining = deadline.timeIntervalSinceNow
            guard remaining > 0 else {
                throw OS1Error.message("EXO operation exceeded its deadline")
            }
            timeout = max(0.25, min(maximumTimeoutSeconds, remaining))
        } else {
            timeout = maximumTimeoutSeconds
        }
        var request = URLRequest(url: try url(path: path, queryItems: queryItems))
        request.httpMethod = method
        request.httpBody = body
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "accept")
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode),
              data.count <= 1_048_576 else {
            throw OS1Error.message("EXO local service rejected the request")
        }
        return data
    }

    private func topology(deadline: Date? = nil) async throws -> [String] {
        let response = try await request(path: "/state/topology", deadline: deadline)
        let body = try EXOJSON.object(response)
        guard let nodes = body["nodes"] as? [String], nodes.count >= configuration.minimumNodes,
              Set(nodes).count == nodes.count else {
            throw OS1Error.message("EXO needs \(configuration.minimumNodes) connected nodes")
        }
        return nodes
    }

    private func placement(deadline: Date? = nil) async throws -> EXOInstance {
        let response = try await request(
            path: "/instance/placement",
            queryItems: [
                URLQueryItem(name: "model_id", value: configuration.modelID),
                URLQueryItem(name: "sharding", value: "Pipeline"),
                URLQueryItem(name: "instance_meta", value: "MlxRing"),
                URLQueryItem(name: "min_nodes", value: String(configuration.minimumNodes)),
            ],
            deadline: deadline
        )
        let root = try EXOJSON.object(response)
        guard root.keys.count == 1,
              let instanceValue = root["MlxRingInstance"] else {
            throw OS1Error.message("EXO did not create a Pipeline/MlxRing placement")
        }
        let instance = try EXOJSON.dictionary(instanceValue, named: "MlxRingInstance")
        let instanceID = try EXOJSON.string(instance["instanceId"], named: "instanceId")
        guard UUID(uuidString: instanceID) != nil else {
            throw OS1Error.message("EXO instance identifier is invalid")
        }
        let assignments = try EXOJSON.dictionary(instance["shardAssignments"], named: "shardAssignments")
        guard try EXOJSON.string(assignments["modelId"], named: "modelId") == configuration.modelID else {
            throw OS1Error.message("EXO placement selected the wrong model")
        }
        let nodeToRunner = try EXOJSON.dictionary(assignments["nodeToRunner"], named: "nodeToRunner")
        let runnerToShard = try EXOJSON.dictionary(assignments["runnerToShard"], named: "runnerToShard")
        let runnerIDs = Set(nodeToRunner.values.compactMap { $0 as? String })
        guard nodeToRunner.count >= configuration.minimumNodes,
              runnerIDs.count >= configuration.minimumNodes,
              runnerIDs.count == runnerToShard.count else {
            throw OS1Error.message("EXO placement did not use every required node")
        }
        for runnerID in runnerIDs {
            let runner = try EXOJSON.dictionary(runnerToShard[runnerID], named: "runner shard")
            let metadata = try EXOJSON.dictionary(runner["PipelineShardMetadata"], named: "PipelineShardMetadata")
            guard try EXOJSON.integer(metadata["worldSize"], named: "worldSize") == runnerIDs.count else {
                throw OS1Error.message("EXO placement is not a shared inference group")
            }
        }

        let placedInstance = EXOInstance(id: instanceID, runnerIDs: runnerIDs)
        let createBody = try JSONSerialization.data(withJSONObject: ["instance": root])
        do {
            _ = try await request(path: "/instance", method: "POST", body: createBody, deadline: deadline)
            return placedInstance
        } catch {
            // The service may have accepted the placement even when its response
            // missed the hook deadline. Always attempt bounded cleanup.
            await remove(placedInstance)
            throw error
        }
    }

    private func waitUntilReady(_ instance: EXOInstance, deadline requestedDeadline: Date? = nil) async throws {
        let startupDeadline = Date().addingTimeInterval(TimeInterval(configuration.startupTimeoutSeconds))
        let deadline = requestedDeadline.map { min($0, startupDeadline) } ?? startupDeadline
        while Date() < deadline {
            let response = try await request(path: "/state", deadline: deadline)
            let state = try EXOJSON.object(response)
            let instances = try EXOJSON.dictionary(state["instances"], named: "instances")
            let runners = try EXOJSON.dictionary(state["runners"], named: "runners")
            let ready = instance.runnerIDs.filter { runnerID in
                guard instances[instance.id] != nil,
                      let status = runners[runnerID] as? [String: Any] else {
                    return false
                }
                return status["RunnerReady"] != nil || status["RunnerRunning"] != nil
            }
            if ready.count == instance.runnerIDs.count {
                return
            }
            let remaining = deadline.timeIntervalSinceNow
            guard remaining > 0 else { break }
            try await Task.sleep(for: .seconds(min(1, remaining)))
        }
        throw OS1Error.message("EXO runners did not become ready before timeout")
    }

    private func chat(prompt: String, deadline: Date? = nil) async throws -> String {
        let body: [String: Any] = [
            "model": configuration.modelID,
            "messages": [["role": "user", "content": prompt]],
            "max_tokens": configuration.maximumOutputTokens,
            "temperature": 0,
            "stream": false,
            "enable_thinking": false,
            "reasoning_effort": "none",
        ]
        let data = try JSONSerialization.data(withJSONObject: body)
        let responseData = try await request(
            path: "/v1/chat/completions",
            method: "POST",
            body: data,
            deadline: deadline
        )
        let response = try EXOJSON.object(responseData)
        guard let choices = response["choices"] as? [[String: Any]],
              let first = choices.first,
              let message = first["message"] as? [String: Any] else {
            throw OS1Error.message("EXO returned no inference result")
        }
        let content = try EXOJSON.string(message["content"], named: "completion content")
        guard content.utf8.count <= 800_000 else {
            throw OS1Error.message("EXO completion exceeded the result limit")
        }
        return content
    }

    private func remove(_ instance: EXOInstance) async {
        _ = try? await request(
            path: "/instance/\(instance.id)",
            method: "DELETE",
            maximumTimeoutSeconds: 2
        )
    }

    func doctor() async throws -> [String] {
        try await topology()
    }

    func infer(prompt: String, deadline: Date? = nil) async throws -> EXOInferenceResult {
        guard !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              prompt.utf8.count <= 48_000 else {
            throw OS1Error.message("EXO prompt is invalid")
        }
        _ = try await topology(deadline: deadline)
        let instance = try await placement(deadline: deadline)
        do {
            try await waitUntilReady(instance, deadline: deadline)
            let started = Date()
            let output = try await chat(prompt: prompt, deadline: deadline)
            await remove(instance)
            return EXOInferenceResult(
                output: output,
                durationMS: Int64(Date().timeIntervalSince(started) * 1_000)
            )
        } catch {
            await remove(instance)
            throw error
        }
    }
}

func exoDoctor(config: RuntimeConfig) async throws {
    let configuration = try EXOConfiguration(runtimeConfig: config)
    let nodes = try await EXOClient(configuration: configuration).doctor()
    print("EXO cluster: OK (\(nodes.count) nodes, min \(configuration.minimumNodes))")
    print("EXO model: \(configuration.modelID)")
}

func executeEXO(prompt: String, config: RuntimeConfig, deadline: Date? = nil) async throws -> EXOInferenceResult {
    try await EXOClient(configuration: try EXOConfiguration(runtimeConfig: config)).infer(
        prompt: prompt,
        deadline: deadline
    )
}
