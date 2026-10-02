import Foundation
import OS1Context

/// `os1 browser-mcp`: the MCP server a backend gets on a purchase turn. Every
/// tool forwards to the OS-1 Checkout helper; nothing here can press a
/// purchase button, type card data or accept terms by itself.
enum BrowserMCP {
    static func schema(_ properties: [String: Any], required: [String] = []) -> [String: Any] {
        var value: [String: Any] = ["type": "object", "properties": properties, "additionalProperties": false]
        if !required.isEmpty { value["required"] = required }
        return value
    }

    static var session: [String: Any] { ["type": "string", "description": "The session id browser_open returned."] }
    static var ref: [String: Any] { ["type": "string", "description": "An element ref from the latest browser_snapshot."] }

    static var tools: [[String: Any]] { [
        ["name": "checkout_status",
         "description": "Which browsers OS-1 can drive, how the owner approves (Touch ID or password), and the one-time setup steps.",
         "inputSchema": schema([:])],
        ["name": "browser_open",
         "description": "Open a page in a new window of the owner's own Safari or Chrome (their logged-in session). Returns a session id.",
         "inputSchema": schema(["url": ["type": "string", "description": "https URL"],
                                "browser": ["type": "string", "enum": ["auto", "safari", "chrome"],
                                            "description": "auto = the owner's default browser"]], required: ["url"])],
        ["name": "browser_snapshot",
         "description": "Page text and interactive elements with refs. gate=owner_only: only the owner types it; gate=approval_required or terms_approval_required: only purchase_request_approval + purchase_confirm press it.",
         "inputSchema": schema(["session": session], required: ["session"])],
        ["name": "browser_click", "description": "Click a link or button that has no gate.",
         "inputSchema": schema(["session": session, "ref": ref], required: ["session", "ref"])],
        ["name": "browser_type",
         "description": "Type into a text field (a search box, a domain name). Card, password and one-time-code fields are refused.",
         "inputSchema": schema(["session": session, "ref": ref, "text": ["type": "string"]], required: ["session", "ref", "text"])],
        ["name": "browser_select", "description": "Choose an option of a dropdown (for example the registration period).",
         "inputSchema": schema(["session": session, "ref": ref, "value": ["type": "string"]], required: ["session", "ref", "value"])],
        ["name": "browser_check", "description": "Set a checkbox or switch that has no gate (add-ons, privacy options).",
         "inputSchema": schema(["session": session, "ref": ref, "checked": ["type": "boolean"]], required: ["session", "ref", "checked"])],
        ["name": "browser_wait", "description": "Wait up to 20 seconds for the page to load or for a text to appear.",
         "inputSchema": schema(["session": session, "seconds": ["type": "number"], "text": ["type": "string"]], required: ["session"])],
        ["name": "purchase_request_approval",
         "description": "On the final review page, ask the owner to approve this exact purchase. macOS shows them the item and amount and they approve with Touch ID or the Mac password. Blocks until they decide (up to 3 minutes). The amount must be the total shown on the page; confirm_ref must be the final purchase button; terms_refs are the terms boxes the purchase needs.",
         "inputSchema": schema(["session": session, "merchant": ["type": "string"], "item": ["type": "string"],
                                "amount": ["type": "string", "description": "Total charged now, as shown (e.g. US$20.00)"],
                                "period": ["type": "string"], "renewal": ["type": "string", "description": "Renewal price, if shown"],
                                "payment_method": ["type": "string", "description": "As shown, e.g. Visa ending 4242"],
                                "confirm_ref": ref, "terms_refs": ["type": "array", "items": ["type": "string"]]],
                               required: ["session", "merchant", "item", "amount", "confirm_ref"])],
        ["name": "purchase_confirm",
         "description": "After the owner approved: check the approved terms boxes and press the approved purchase button once. Returns the receipt and the page after.",
         "inputSchema": schema(["session": session, "approval_id": ["type": "string"]], required: ["session", "approval_id"])],
        ["name": "browser_close", "description": "Close the checkout window.",
         "inputSchema": schema(["session": session], required: ["session"])],
    ] }

    static let operations: [String: String] = [
        "checkout_status": "status", "browser_open": "open", "browser_snapshot": "snapshot", "browser_click": "click",
        "browser_type": "type", "browser_select": "select", "browser_check": "check", "browser_wait": "wait",
        "purchase_request_approval": "request_approval", "purchase_confirm": "confirm", "browser_close": "close",
    ]

    /// MCP tool call → helper request.
    static func brokerRequest(tool: String, arguments: [String: Any], executionID: String?) -> BrowserCheckout.BrokerRequest? {
        guard let op = operations[tool] else { return nil }
        var args: [String: String] = [:]
        var lists: [String: [String]] = [:]
        for (key, value) in arguments {
            switch value {
            case let text as String: args[key] = text
            case let flag as Bool: args[key] = flag ? "true" : "false"
            case let number as NSNumber: args[key] = number.stringValue
            case let items as [Any]: lists[key] = items.compactMap { $0 as? String }
            default: continue
            }
        }
        if tool == "browser_check" { args["value"] = args.removeValue(forKey: "checked") ?? "true" }
        return BrowserCheckout.BrokerRequest(op: op, args: args, list: lists.isEmpty ? nil : lists, executionID: executionID)
    }

    static func callTool(_ name: String, _ arguments: [String: Any], executionID: String?) -> (String, Bool) {
        guard let request = brokerRequest(tool: name, arguments: arguments, executionID: executionID) else {
            return (#"{"code":"unknown_tool"}"#, true)
        }
        let timeout: TimeInterval = request.op == "request_approval" ? 210 : 90
        do {
            let response = try CheckoutBrokerClient.send(request, timeout: timeout)
            if response.ok { return (response.result ?? "{}", false) }
            return (encodeError(response.error ?? BrowserCheckout.BrokerError(code: "unknown", message: "")), true)
        } catch let error as BrowserCheckout.BrokerError {
            return (encodeError(error), true)
        } catch {
            return (encodeError(BrowserCheckout.BrokerError(code: "helper_unavailable", message: "\(error)")), true)
        }
    }

    static func encodeError(_ error: BrowserCheckout.BrokerError) -> String {
        var object: [String: String] = ["code": error.code, "message": error.message]
        if let step = error.ownerStep { object["owner_step"] = step }
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
        return String(decoding: data, as: UTF8.self)
    }

    /// One JSON-RPC message in, at most one out.
    static func respond(to message: [String: Any], executionID: String?) -> [String: Any]? {
        guard let id = message["id"] else { return nil }  // a notification
        let method = message["method"] as? String ?? ""
        let params = message["params"] as? [String: Any] ?? [:]
        func result(_ value: Any) -> [String: Any] { ["jsonrpc": "2.0", "id": id, "result": value] }
        switch method {
        case "initialize":
            return result([
                "protocolVersion": (params["protocolVersion"] as? String) ?? "2025-06-18",
                "capabilities": ["tools": ["listChanged": false]],
                "serverInfo": ["name": BrowserCheckout.mcpServerName, "version": "1.0"],
            ])
        case "ping":
            return result([String: Any]())
        case "tools/list":
            return result(["tools": tools])
        case "tools/call":
            let name = params["name"] as? String ?? ""
            let (text, isError) = callTool(name, params["arguments"] as? [String: Any] ?? [:], executionID: executionID)
            return result(["content": [["type": "text", "text": text]], "isError": isError])
        default:
            return ["jsonrpc": "2.0", "id": id, "error": ["code": -32601, "message": "Method not found: \(method)"]]
        }
    }
}

func browserMCPCommand() -> Never {
    let executionID = ProcessInfo.processInfo.environment["OS1_CHECKOUT_EXECUTION_ID"]
    while let line = readLine(strippingNewline: true) {
        guard !line.isEmpty, let data = line.data(using: .utf8),
              let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let reply = BrowserMCP.respond(to: message, executionID: executionID),
              var encoded = try? JSONSerialization.data(withJSONObject: reply, options: []) else { continue }
        encoded.append(0x0A)
        FileHandle.standardOutput.write(encoded)
    }
    exit(0)
}

/// The MCP surface without a helper: protocol shape, tool list, the request
/// mapping and the error path when OS-1 Checkout is absent.
func browserMCPSelfTest() throws {
    guard let initialize = BrowserMCP.respond(to: ["jsonrpc": "2.0", "id": 1, "method": "initialize",
                                                   "params": ["protocolVersion": "2025-06-18"]], executionID: nil),
          let initResult = initialize["result"] as? [String: Any], initResult["protocolVersion"] as? String == "2025-06-18",
          BrowserMCP.respond(to: ["jsonrpc": "2.0", "method": "notifications/initialized"], executionID: nil) == nil,
          let list = BrowserMCP.respond(to: ["jsonrpc": "2.0", "id": 2, "method": "tools/list"], executionID: nil),
          let tools = (list["result"] as? [String: Any])?["tools"] as? [[String: Any]],
          Set(tools.compactMap { $0["name"] as? String }) == Set(BrowserMCP.operations.keys),
          tools.allSatisfy({ JSONSerialization.isValidJSONObject($0) }) else {
        throw OS1Error.message("Browser MCP protocol self-test failed")
    }
    guard let approval = BrowserMCP.brokerRequest(tool: "purchase_request_approval", arguments: [
              "session": "s", "merchant": "Squarespace", "item": "usungcorp.com", "amount": "US$20.00",
              "confirm_ref": "e9", "terms_refs": ["e4", "e5"]], executionID: "x"),
          approval.op == "request_approval", approval.list?["terms_refs"] == ["e4", "e5"], approval.executionID == "x",
          let check = BrowserMCP.brokerRequest(tool: "browser_check", arguments: ["session": "s", "ref": "e1", "checked": false],
                                               executionID: nil),
          check.args["value"] == "false", check.args["checked"] == nil,
          BrowserMCP.brokerRequest(tool: "browser_eval", arguments: [:], executionID: nil) == nil else {
        throw OS1Error.message("Browser MCP request mapping self-test failed")
    }
    let claude = CheckoutTurn.claudeMCPArguments(os1Executable: "/x/os1", executionID: "abc")
    let codex = CheckoutTurn.codexConfigOverrides(os1Executable: "/x/os1", executionID: "abc")
    guard claude.first == "--mcp-config", claude.count == 2, claude[1].contains("\"browser-mcp\""),
          claude[1].contains("OS1_CHECKOUT_EXECUTION_ID"),
          codex.contains("mcp_servers.os1-checkout.command=\"/x/os1\""),
          codex.contains("mcp_servers.os1-checkout.args=[\"browser-mcp\"]"),
          codex.contains("mcp_servers.os1-checkout.tool_timeout_sec=300") else {
        throw OS1Error.message("Browser MCP launch configuration self-test failed")
    }
}
