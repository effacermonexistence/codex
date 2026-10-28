import AppKit
import Foundation
import SwiftUI
import WebKit
import OS1Context

/// Presentation only. UUID and title are copied from the existing OS1 store;
/// this surface does not own a second session database or provider process.
struct OS1GardenSession: Codable, Equatable {
    let id: String
    let name: String
    let engine: String
    let status: String
    let activity: String
    var tokensUsed: Int? = nil
    var usageLabel: String? = nil
    var resultRevision: String? = nil
    var reviewed: Bool = false
    var hasResult: Bool = false
    var featured: Bool = false
    var resultPending: Bool = false
    var queueCount: Int = 0
    var queuePaused: Bool = false
    var canStop: Bool = false
    var canResume: Bool = false
}

struct OS1GardenSnapshot: Codable, Equatable {
    let sessions: [OS1GardenSession]
    let selectedID: String?
    let selectedOutput: String
    let notice: String
    let visible: Bool
    let accentHex: String
    var selectedOutputID: String? = nil
    var selectedResultRevision: String? = nil
    var tokenPool: OS1GardenTokenPool = .unavailable
    var tokenPools: [String: OS1GardenTokenPool] = [:]
}

struct OS1SimulationGarden: NSViewRepresentable {
    let snapshot: OS1GardenSnapshot
    let onAction: @MainActor (String, String?, String?) -> SimulationSessionControl.ControlOutcome

    func makeCoordinator() -> Coordinator { Coordinator(snapshot: snapshot, onAction: onAction) }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.userContentController.add(context.coordinator, name: "os1Simulation")
        let view = WKWebView(frame: .zero, configuration: config)
        view.setValue(false, forKey: "drawsBackground")
        view.navigationDelegate = context.coordinator
        view.setAccessibilityIdentifier("os1.simulation.garden")
        context.coordinator.webView = view
        if let resource = Bundle.main.resourceURL?.appendingPathComponent("SimulationGarden/index.html"),
           FileManager.default.fileExists(atPath: resource.path) {
            context.coordinator.entry = resource.standardizedFileURL
            view.loadFileURL(resource, allowingReadAccessTo: resource.deletingLastPathComponent())
        } else {
            // Missing assets are never replaced by a remote website.
            view.loadHTMLString("<html><body style='background:#203e2b;color:#e5eaca;font:16px -apple-system;padding:70px'>OS1 시뮬레이션 리소스를 찾을 수 없습니다. 채팅과 기존 작업은 그대로 보존됩니다.</body></html>", baseURL: nil)
        }
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        context.coordinator.snapshot = snapshot
        context.coordinator.onAction = onAction
        context.coordinator.publish()
    }

    @MainActor final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        weak var webView: WKWebView?
        var entry: URL?
        var ready = false
        var snapshot: OS1GardenSnapshot
        var onAction: @MainActor (String, String?, String?) -> SimulationSessionControl.ControlOutcome
        private var lastJSON = ""
        private var commands = SimulationSessionControl.Deduplicator()

        init(snapshot: OS1GardenSnapshot, onAction: @escaping @MainActor (String, String?, String?) -> SimulationSessionControl.ControlOutcome) {
            self.snapshot = snapshot; self.onAction = onAction
        }

        func publish() {
            guard ready, let bytes = try? JSONEncoder().encode(snapshot),
                  let json = String(data: bytes, encoding: .utf8), json != lastJSON else { return }
            lastJSON = json
            webView?.evaluateJavaScript("window.os1SimulationUpdate && window.os1SimulationUpdate(\(json));") { [weak self] _, error in
                if error != nil { self?.lastJSON = "" }
            }
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "os1Simulation", message.frameInfo.isMainFrame,
                  let entry, webView?.url?.standardizedFileURL == entry,
                  let body = message.body as? [String: Any], let action = body["action"] as? String,
                  ["ready", "select", "open", "new", "close", "order", "stop", "resume", "settings", "inspect", "review"].contains(action) else { return }
            if action == "ready" { ready = true; lastJSON = ""; publish(); return }
            let id = body["id"] as? String
            if ["select", "open", "order", "stop", "resume", "inspect", "review"].contains(action) {
                guard let id, UUID(uuidString: id) != nil, snapshot.sessions.contains(where: { UUID(uuidString: $0.id) == UUID(uuidString: id) }) else { return }
            }
            let text = body["text"] as? String
            if action == "order" { guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.utf8.count <= 128_000 else { return } }
            if ["inspect", "review"].contains(action) {
                guard snapshot.visible, let id, snapshot.selectedID.flatMap(UUID.init(uuidString:)) == UUID(uuidString: id), let text, text.utf8.count <= 512,
                      snapshot.sessions.first(where: { UUID(uuidString: $0.id) == UUID(uuidString: id) })?.resultRevision == text else { return }
            }
            if ["order", "stop", "resume", "new"].contains(action) {
                guard Set(body.keys).isSubset(of: ["action", "id", "text", "commandID"]),
                      let commandID = body["commandID"] as? String,
                      let command = SimulationSessionControl.Command.parse(commandID: commandID,
                        action: action, sessionID: id, text: text) else { return }
                switch commands.begin(command) {
                case .execute:
                    let outcome = onAction(action, id, text)
                    deliver(commands.record(command, outcome: outcome))
                case .replay(let receipt), .reject(let receipt): deliver(receipt)
                }
            } else { _ = onAction(action, id, text) }
        }

        private func deliver(_ receipt: SimulationSessionControl.CommandReceipt) {
            guard let bytes = try? JSONEncoder().encode(receipt),
                  let json = String(data: bytes, encoding: .utf8) else { return }
            // Echo host acceptance, not inferred phase. A lost UI callback does
            // not replay a prompt; an identical command reuses its receipt.
            webView?.evaluateJavaScript("window.os1SimulationReceipt && window.os1SimulationReceipt(\(json));")
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // The module's explicit ready handshake, not didFinish alone,
            // establishes that the state receiver has actually been installed.
            publish()
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url, let entry, url.isFileURL,
                  url.standardizedFileURL == entry else { decisionHandler(.cancel); return }
            decisionHandler(.allow)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            ready = false; lastJSON = ""
            // Never replay a prompt on WebKit recovery. Only the snapshot returns.
            if let entry { webView.loadFileURL(entry, allowingReadAccessTo: entry.deletingLastPathComponent()) }
        }
    }
}
