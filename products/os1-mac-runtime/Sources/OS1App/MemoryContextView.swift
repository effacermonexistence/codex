import AppKit
import SwiftUI
import OS1Context

/// Metering is deliberately separate from the usage/cost totals monitor.
struct MemoryContextView: View {
    let conversationID: String
    @State private var opened = false
    @State private var status: MemoryContextStatus?
    @State private var soft = "240000"
    @State private var hard = "272000"
    @State private var retrieval = "24000"
    @State private var active = "8000"
    @State private var notice = ""
    private let timer = Timer.publish(every: 3, on: .main, in: .common).autoconnect()
    var body: some View {
        Button { opened.toggle(); refresh() } label: {
            Label(os1Tr("맥락", "Context"), systemImage: "memorychip")
                .font(.system(size: 11)).foregroundStyle(.secondary)
        }.buttonStyle(.plain)
            .help(status?.publicLine ?? os1Tr("원문 보존 · 필요할 때 memory paging", "Original evidence preserved · memory paging on demand"))
            .popover(isPresented: $opened) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(os1Tr("컨텍스트 · Memory paging", "Context · Memory paging")).font(.headline)
                    Text(status?.publicLine ?? os1Tr("아직 실제 입력 사용량을 관측하지 않았습니다.", "No request-input measurement observed yet."))
                        .font(.caption).textSelection(.enabled)
                    if status?.rotated == true {
                        Text(os1Tr("새 백엔드 컨텍스트로 이어졌습니다. OS-1 대화·원문·대기열은 그대로 유지됩니다.",
                            "Continued in a fresh backend context. OS-1 conversation, original evidence and queue are unchanged.")).font(.caption)
                    }
                    Text(os1Tr("이 값들은 OS-1 작업 예산입니다. API 가격표와 구독 실제 청구는 별개입니다. 이미지·도구 결과는 정확한 사전 토큰 수를 알 수 없으면 추정/미확인으로 남습니다.",
                        "These are OS-1 working budgets, not your subscription bill. Image/tool input is estimated or unknown unless the provider reports its actual size.")).font(.caption).foregroundStyle(.secondary)
                    field(os1Tr("Soft limit", "Soft limit"), $soft)
                    field(os1Tr("Hard limit", "Hard limit"), $hard)
                    field(os1Tr("검색 페이지 총예산", "Retrieved pages budget"), $retrieval)
                    field(os1Tr("필수 작업 상태 예산", "Active state budget"), $active)
                    HStack {
                        Button(os1Tr("저장", "Save")) { save() }
                        Button(os1Tr("다음 요청은 새 맥락에서", "Fresh context on next request")) {
                            do { try MemoryContextMeter.requestFresh(conversationID: conversationID); notice = os1Tr("다음 요청에 적용합니다. 현재 작업은 중단하지 않습니다.", "Applies on the next request; the current run is not interrupted.") }
                            catch { notice = error.localizedDescription }
                        }
                    }
                    if !notice.isEmpty { Text(notice).font(.caption) }
                }.padding(18).frame(width: 450)
            }
            .onAppear { refresh() }
            .onChange(of: conversationID) { _ in refresh() }
            .onReceive(timer) { _ in if opened { status = MemoryContextMeter.readStatus(conversationID: conversationID) } }
    }
    private func field(_ title: String, _ text: Binding<String>) -> some View {
        HStack { Text(title).font(.caption); Spacer(); TextField(title, text: text).frame(width: 100) }
    }
    private func refresh() {
        status = MemoryContextMeter.readStatus(conversationID: conversationID)
        if let config = try? MemoryPaging.configuration() {
            soft = String(config.softContextLimitTokens); hard = String(config.hardContextLimitTokens)
            retrieval = String(config.retrievalBudgetTokens); active = String(config.activeStateBudgetTokens)
        }
    }
    private func save() {
        do {
            guard let softValue = Int(soft), let hardValue = Int(hard), let pageValue = Int(retrieval), let activeValue = Int(active) else { throw MemoryPagingError.invalidCapability }
            var config = try MemoryPaging.configuration()
            config.softContextLimitTokens = softValue; config.hardContextLimitTokens = hardValue
            config.retrievalBudgetTokens = pageValue; config.activeStateBudgetTokens = activeValue
            try config.validate()
            let root = MemoryPaging.defaultRoot
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let target = root.appendingPathComponent("context-budget.json")
            guard target.resolvingSymlinksInPath() == target.standardizedFileURL else { throw MemoryPagingError.invalidCapability }
            try JSONEncoder().encode(config).write(to: target, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
            notice = os1Tr("다음 요청부터 적용합니다. 원문과 현재 실행은 변경하지 않았습니다.", "Applies from the next request. Original evidence and the current run are unchanged.")
        } catch { notice = error.localizedDescription }
    }
}
