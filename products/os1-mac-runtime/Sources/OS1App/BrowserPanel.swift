import AppKit
import SwiftUI
import WebKit
import OS1Context

/// Kept mounted in memory across panel toggles; one history per OS1 conversation.
@MainActor final class OS1BrowserPage: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    let webView: WKWebView
    @Published var address = ""
    @Published var error: String?
    @Published var loading = false
    @Published var canBack = false
    @Published var canForward = false
    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default() // This device only. Never import provider sessions.
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
    }
    func open(_ text: String) {
        guard let url = BrowserNavigation.url(text) else {
            error = os1Tr("http:// 또는 https:// 주소를 입력하세요. 파일·스크립트 주소는 실행하지 않습니다.",
                          "Enter an http:// or https:// address. File and script addresses are not run.")
            return
        }
        address = url.absoluteString; error = nil
        webView.load(URLRequest(url: url))
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, BrowserNavigation.url(url.absoluteString) != nil else {
            error = os1Tr("이 탐색은 웹 주소가 아닙니다.", "This navigation target is not a web address."); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { open(url.absoluteString) }
        return nil
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        loading = true; error = nil
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading = false; address = webView.url?.absoluteString ?? address
        canBack = webView.canGoBack; canForward = webView.canGoForward
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }
    private func failed(_ failure: Error) {
        loading = false
        if (failure as NSError).code != NSURLErrorCancelled { error = failure.localizedDescription }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loading = false; error = os1Tr("브라우저 프로세스가 종료됐습니다. 새로고침으로 다시 열 수 있습니다.",
                                       "The browser process ended. Reload to open it again.")
    }
}

@MainActor final class OS1BrowserWorkspace: ObservableObject {
    @Published var visible = false
    private var pages: [String: OS1BrowserPage] = [:]
    func page(_ key: String) -> OS1BrowserPage {
        if let page = pages[key] { return page }
        let page = OS1BrowserPage(); pages[key] = page; return page
    }
    func open(_ url: URL, key: String) { page(key).open(url.absoluteString); visible = true }
}

private struct EmbeddedWebContent: NSViewRepresentable {
    let page: OS1BrowserPage
    func makeNSView(context: Context) -> WKWebView { page.webView }
    func updateNSView(_ view: WKWebView, context: Context) {}
}

struct OS1BrowserPanel: View {
    @ObservedObject var page: OS1BrowserPage
    let close: () -> Void
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button { page.webView.goBack() } label: { Image(systemName: "chevron.left") }
                    .disabled(!page.canBack).accessibilityLabel(os1Tr("브라우저 뒤로", "Browser back"))
                Button { page.webView.goForward() } label: { Image(systemName: "chevron.right") }
                    .disabled(!page.canForward).accessibilityLabel(os1Tr("브라우저 앞으로", "Browser forward"))
                TextField(os1Tr("https://… 또는 http://127.0.0.1:포트", "https://… or http://127.0.0.1:port"), text: $page.address)
                    .textFieldStyle(.roundedBorder).onSubmit { page.open(page.address) }
                    .accessibilityLabel(os1Tr("OS1 브라우저 주소", "OS1 browser address"))
                Button { page.open(page.address) } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel(os1Tr("브라우저 새로고침", "Reload browser"))
                Button { if let url = BrowserNavigation.url(page.address) { NSWorkspace.shared.open(url) } }
                    label: { Image(systemName: "arrow.up.right.square") }
                    .help(os1Tr("기본 브라우저에서 열기", "Open in default browser"))
                Button(action: close) { Image(systemName: "xmark") }.accessibilityLabel(os1Tr("브라우저 닫기", "Close browser"))
            }
            .buttonStyle(.plain)
            .padding(10)
            .padding(.top, RootChromeLayout.titlebarBand)
            if page.loading { ProgressView().controlSize(.small).padding(4) }
            if let error = page.error { Text(error).font(.caption).foregroundStyle(.red).padding(8) }
            if page.address.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "globe").font(.largeTitle)
                    Text(os1Tr("작업 옆에서 결과를 확인하세요", "Check results alongside your work"))
                    Text(os1Tr("답변의 웹 링크를 누르거나 위에 주소를 입력하세요.", "Click a web link in an answer or enter an address above.")).font(.caption)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else { EmbeddedWebContent(page: page) }
        }.frame(minWidth: 360, idealWidth: 540, maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black).accessibilityIdentifier("os1-browser-panel")
    }
}
