import AppKit
import Foundation
import SwiftUI
import WebKit

/// Presentation only. UUID and title are copied from the existing OS1 store;
/// this surface does not own a second session database or provider process.
struct OS1GardenSession: Codable, Equatable {
    let id: String
    let name: String
    let engine: String
    let status: String
    let activity: String
}

struct OS1GardenSnapshot: Codable, Equatable {
    let sessions: [OS1GardenSession]
    let selectedID: String?
    let selectedOutput: String
    let notice: String
    let visible: Bool
}

struct OS1SimulationGarden: NSViewRepresentable {
    let snapshot: OS1GardenSnapshot
    let onAction: @MainActor (String, String?, String?) -> Void

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
        var onAction: @MainActor (String, String?, String?) -> Void
        private var lastJSON = ""

        init(snapshot: OS1GardenSnapshot, onAction: @escaping @MainActor (String, String?, String?) -> Void) {
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
                  ["ready", "select", "open", "new", "close", "order", "stop"].contains(action) else { return }
            if action == "ready" { ready = true; lastJSON = ""; publish(); return }
            let id = body["id"] as? String
            if ["select", "open", "order", "stop"].contains(action) {
                guard let id, UUID(uuidString: id) != nil, snapshot.sessions.contains(where: { $0.id == id }) else { return }
            }
            let text = body["text"] as? String
            if action == "order" { guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.utf8.count <= 128_000 else { return } }
            onAction(action, id, text)
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
