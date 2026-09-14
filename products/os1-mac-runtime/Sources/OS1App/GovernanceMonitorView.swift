import SwiftUI
import Charts
import OS1Context

/// Read-only projection; opening this panel never starts a provider, replay, or benchmark.
struct GovernanceMonitorView: View {
    var active: [String] = []
    var queued: Int = 0
    var onClose: (() -> Void)? = nil
    var preview: Bool = false
    @State var snapshot = GovernanceSnapshot()
    @State private var window = "전체"
    @State private var provider = "전체"
    @State private var baseline = ""
    @State private var refreshed = Date()
    @Environment(\.dismiss) private var dismiss
    private let green = Color(red: 0.23, green: 0.9, blue: 0.56)
    private let pink = Color(red: 0.99, green: 0.61, blue: 0.77)
    private let muted = Color(white: 0.59)
    private var since: Date? {
        window == "전체" ? nil : refreshed.addingTimeInterval(window == "24시간" ? -86_400 : -604_800)
    }
    private var filtered: GovernanceSnapshot {
        var value = snapshot
        if provider != "전체" {
            // Mixed-backend tasks stay intact; do not discard their retry costs.
            value.tasks = value.tasks.filter { $0.attempts.contains { $0.provider == provider } }
            value.historical = value.historical.filter { $0.observation.provider == provider }
        }
        return value
    }
    private var tasks: [GovernanceTask] { filtered.selectedTasks(since: since) }
    private var terminal: [GovernanceTask] { tasks.filter(\.isTerminal) }
    private var rows: [GovernanceRoute] { filtered.routes(since: since, includeHistorical: since == nil) }
    private var samples: [(String, CompletionFeedbackObservation)] { filtered.samples(since: since, includeHistorical: since == nil) }
    private var usage: [Int] { samples.compactMap { GovernanceSnapshot.tokens($0.1) } }
    private var completed: Int { terminal.filter(\.isAdopted).count }
    private var comparisons: [GovernanceComparison] {
        filtered.comparisons(baseline: baseline, since: since, includeHistorical: since == nil)
    }
    private var meteredTasks: [GovernanceTask] { terminal.filter { $0.tokens != nil } }
    private var quality: GovernanceQualitySummary { filtered.quality(since: since) }
    private var adoptionEfficiency: Double? {
        let tokens = meteredTasks.compactMap(\.tokens).reduce(0,+)
        guard !terminal.isEmpty, terminal.count == meteredTasks.count, tokens > 0 else { return nil }
        return Double(completed) * 1_000_000 / Double(tokens)
    }
    private var observedHours: Double {
        filtered.observedTaskHours(now: refreshed, since: since)
    }
    private var buckets: [GovernanceBucket] {
        filtered.timeline(since: refreshed.addingTimeInterval(-3600), until: refreshed, bucketSeconds: 60)
    }
    private func num(_ n: Int) -> String { n.formatted(.number) }
    private func percent(_ n: Double?) -> String { n.map { String(format: "%.1f%%", $0 * 100) } ?? "—" }
    private func decimal(_ n: Double?) -> String { n.map { String(format: "%.2f", $0) } ?? "—" }
    private func delta(_ n: Double?) -> String { n.map { String(format: "%+.1f%%", $0 * 100) } ?? "—" }
    private func short(_ route: String) -> String { route.replacingOccurrences(of: " / ", with: " · ") }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Color.white.opacity(0.12))
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    controls
                    metrics
                    liveRow
                    HStack(alignment: .top, spacing: 14) {
                        tokenChart.frame(maxWidth: .infinity)
                        completionChart.frame(maxWidth: .infinity)
                    }
                    routeTable
                    pairedPanel
                    DisclosureGroup("과거 경로 관측 · 인과 비교 아님") { comparePanel }
                    tracePanel
                    methodology
                }.padding(24)
            }
        }
        .frame(minWidth: 880, idealWidth: 1080, maxWidth: .infinity, minHeight: 650, maxHeight: .infinity)
        .background(Color(red: 0.025, green: 0.026, blue: 0.029))
        .foregroundStyle(Color(white: 0.94))
        .preferredColorScheme(.dark)
        .task {
            guard !preview else { setBaseline(); return }
            while !Task.isCancelled {
                let value = await Task.detached(priority: .utility) { GovernanceActivityStore().snapshot() }.value
                guard !Task.isCancelled else { return }
                snapshot = value; refreshed = value.loadedAt; setBaseline()
                try? await Task.sleep(for: .seconds(2))
            }
        }
        .onChange(of: provider) { _ in setBaseline() }
        .onChange(of: window) { _ in setBaseline() }
    }
    private func setBaseline() {
        if !rows.contains(where: { $0.id == baseline }) { baseline = rows.first(where: { $0.attempts > 0 })?.id ?? "" }
    }
    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "waveform.path.ecg").font(.system(size: 24)).foregroundStyle(green)
            VStack(alignment: .leading, spacing: 4) {
                Text("RCC Governance").font(.system(size: 24, weight: .semibold))
                Text("ACTIVITY MONITOR  /  CODEX + CLAUDE CODE").font(.system(size: 10, weight: .medium, design: .monospaced)).tracking(1.1).foregroundStyle(muted)
            }
            Spacer()
            Circle().fill(green).frame(width: 6, height: 6)
            Text(preview ? "읽기 전용 미리보기" : "LIVE · 2초 갱신").font(.system(size: 11)).foregroundStyle(green)
            Button { if let onClose { onClose() } else { dismiss() } } label: { Image(systemName: "xmark").frame(width: 26, height: 26) }
                .buttonStyle(.plain).accessibilityLabel("Close governance monitor")
        }.padding(24)
    }
    private var controls: some View {
        HStack {
            Text("실행 관측").font(.system(size: 17, weight: .semibold))
            Spacer()
            Picker("기간", selection: $window) { ForEach(["전체", "24시간", "7일"], id: \.self) { Text($0) } }.frame(width: 155)
            Picker("백엔드", selection: $provider) { Text("전체").tag("전체"); Text("Codex").tag("codex"); Text("Claude Code").tag("claude") }.frame(width: 190)
        }
    }
    private func card(_ title: String, _ value: String, _ note: String, color: Color = .white) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(title).font(.system(size: 11)).foregroundStyle(muted)
            Text(value).font(.system(size: 26, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(color)
            Text(note).font(.system(size: 10)).foregroundStyle(muted).lineLimit(2).frame(minHeight: 25, alignment: .top)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(15)
            .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 12))
    }
    private var metrics: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                card("측정 토큰 · 입력 + 출력", usage.isEmpty ? "—" : num(usage.reduce(0,+)), "계측 \(usage.count)/\(samples.count)회 · 재시도 포함", color: pink)
                card("검증된 작업 완수율", percent(quality.rate), "목표 검증 미연결 \(quality.unknown)건 · 채택 ≠ 완수", color: green)
                card("검증 완수 / 100만 토큰", decimal(quality.successesPerMillion), "전 작업 비용·목표 검증이 있을 때 계산", color: green)
            }
            HStack(spacing: 10) {
                card("작업 결과 채택률", percent(terminal.isEmpty ? nil : Double(completed)/Double(terminal.count)), "\(completed)/\(terminal.count)건 · 실패·취소 포함")
                card("시도 채택률", percent(samples.isEmpty ? nil : Double(samples.filter { $0.1.outcome == .adopted }.count)/Double(samples.count)), "\(samples.count)회 관측 · 작업 완수율과 구별")
                card("채택 처리량", decimal(observedHours >= 1 ? Double(completed)/observedHours : nil), "채택 건/관측 시간 · 1시간부터")
            }
        }
    }
    private var liveRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Circle().fill(active.isEmpty ? muted : green).frame(width: 6, height: 6)
                Text("실행 중 \(active.count)  ·  대기 \(queued)").font(.system(size: 12, weight: .medium))
                Spacer()
                Text("마지막 갱신 \(refreshed.formatted(date: .omitted, time: .standard))").font(.system(size: 10, design: .monospaced)).foregroundStyle(muted)
            }
            ForEach(Array(active.enumerated()), id: \.offset) { _, label in Text(label).font(.system(size: 11)).foregroundStyle(pink) }
            if tasks.contains(where: { !$0.isTerminal }) {
                Text("종료 영수증 대기 \(tasks.filter { !$0.isTerminal }.count)건 · 중단·미확정 기록은 완수로 계산하지 않습니다.").font(.system(size: 10)).foregroundStyle(muted)
            }
        }.padding(13).background(green.opacity(0.045), in: RoundedRectangle(cornerRadius: 10))
    }
    private func panel<Content: View>(_ title: String, subtitle: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.system(size: 14, weight: .semibold))
            Text(subtitle).font(.system(size: 10)).foregroundStyle(muted)
            content()
        }.padding(16).background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 12))
    }
    private var tokenChart: some View {
        panel("모델·추론 강도별 토큰", subtitle: "보관된 관측 합계 · 호출 수가 다르므로 순위 자체는 성능 비교가 아닙니다") {
            if rows.contains(where: { $0.measuredAttempts > 0 }) {
                Chart(rows.filter { $0.measuredAttempts > 0 }.prefix(8)) { row in
                    BarMark(x: .value("토큰", row.tokens), y: .value("모델", short(row.id))).foregroundStyle(row.id.hasPrefix("claude") ? pink : green)
                }.chartXAxis { AxisMarks(position: .bottom) }.frame(height: 205)
            } else { empty("아직 토큰 계측 기록이 없습니다.") }
        }
    }
    private var completionChart: some View {
        panel("결과 채택 흐름 · 최근 60분", subtitle: "1분 간격 · 작업 종료 영수증 기준 · 목표 달성 판정과 별개") {
            if buckets.contains(where: { $0.completions + $0.nonAdopted > 0 }) {
                Chart(buckets) { b in
                    BarMark(x: .value("시간", b.id, unit: .minute), y: .value("채택", b.completions)).foregroundStyle(green)
                    BarMark(x: .value("시간", b.id, unit: .minute), y: .value("미채택", b.nonAdopted)).foregroundStyle(pink.opacity(0.6))
                }.chartXAxis { AxisMarks(values: .stride(by: .minute, count: 15)) }.frame(height: 205)
            } else { empty("새 작업의 종료 기록부터 그래프가 시작됩니다.\n과거 기록의 파일 수정 시각을 실행 시각으로 쓰지 않습니다.") }
        }
    }
    private func empty(_ text: String) -> some View {
        VStack(spacing: 12) { Image(systemName: "chart.xyaxis.line").font(.system(size: 30)).foregroundStyle(muted); Text(text).font(.system(size: 11)).multilineTextAlignment(.center).foregroundStyle(muted) }.frame(maxWidth: .infinity).frame(height: 205)
    }
    private var routeTable: some View {
        panel("실행 경로 비교", subtitle: "모델명 + reasoning effort · 서로 다른 백엔드로 재시도한 작업은 mixed로 별도 계산") {
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 11) {
                GridRow {
                    Text("모델 / 추론 강도"); Text("시도"); Text("채택률"); Text("평균 토큰"); Text("평균 지연"); Text("작업채택률"); Text("채택/1M")
                }.font(.system(size: 10)).foregroundStyle(muted)
                ForEach(rows) { row in
                    GridRow {
                        Text(short(row.id)).frame(maxWidth: .infinity, alignment: .leading).foregroundStyle(row.id.hasPrefix("claude") ? pink : green)
                        Text("\(row.attempts)")
                        Text(percent(row.adoptionRate))
                        Text(row.meanTokens.map { num(Int($0)) } ?? "—")
                        Text(row.attempts > 0 ? String(format: "%.1fs", Double(row.durationMS) / Double(row.attempts) / 1000) : "—")
                        Text(percent(row.completionRate))
                        Text(decimal(row.completionsPerMillionTokens))
                    }.font(.system(size: 11, design: .monospaced)).monospacedDigit()
                }
            }
            if rows.isEmpty { Text("선택한 기간의 기록이 없습니다.").font(.system(size: 12)).foregroundStyle(muted) }
        }
    }
    private var comparePanel: some View {
        panel("같은 요청 묶음의 과거 관측", subtitle: "순차 재시도 표본 · 독립 paired baseline 아님 · 운영 참고용, off/on 성과에서 제외") {
            HStack {
                Text("기준 경로").font(.system(size: 11)).foregroundStyle(muted)
                Picker("기준 경로", selection: $baseline) {
                    if baseline.isEmpty { Text("기록 없음").tag("") }
                    ForEach(rows.filter { $0.attempts > 0 }) { row in Text(short(row.id)).tag(row.id) }
                }.labelsHidden().frame(maxWidth: 520)
                Spacer()
            }
            if comparisons.isEmpty {
                Text("비교 가능한 동일 요청 기록이 없습니다. 절감률을 추측하거나 비교용 API를 자동 호출하지 않습니다.")
                    .font(.system(size: 11)).foregroundStyle(muted).padding(.vertical, 8)
            } else {
                if comparisons.contains(where: { $0.tokenSavings != nil }) {
                    Text("요청별 평균 비용의 합계 비율 × 시도 채택률 차이").font(.system(size: 11)).foregroundStyle(muted)
                    Chart(comparisons.filter { $0.tokenSavings != nil }) { item in
                        PointMark(x: .value("토큰 차이 추정 (%)", item.tokenSavings! * 100),
                                  y: .value("시도 채택률 차이 (pp)", item.adoptionDelta * 100))
                            .symbolSize(90)
                            .foregroundStyle(item.tokenSavings! >= 0 && item.adoptionDelta >= 0 ? green : pink)
                            .annotation(position: .top) { Text(short(item.id)).font(.system(size: 9)).foregroundStyle(muted) }
                        RuleMark(x: .value("기준 토큰", 0)).foregroundStyle(Color.white.opacity(0.15))
                        RuleMark(y: .value("기준 채택률", 0)).foregroundStyle(Color.white.opacity(0.15))
                    }.chartXAxisLabel("토큰 차이 추정 (%)").chartYAxisLabel("시도 채택률 차이 (pp)").frame(height: 210).padding(.vertical, 12)
                }
                ForEach(comparisons) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(short(item.id)).font(.system(size: 12, weight: .semibold))
                        HStack(spacing: 25) {
                            Text("토큰 차이 추정 \(delta(item.tokenSavings))").foregroundStyle((item.tokenSavings ?? 0) >= 0 ? green : pink)
                            Text(String(format: "시도 채택률 차이 %+.1fpp", item.adoptionDelta * 100)).foregroundStyle(item.adoptionDelta >= 0 ? green : pink)
                            Text("지연 절감 \(delta(item.latencySavings))")
                            Spacer()
                            Text("\(item.matchedScopes)묶음 · 기준 \(item.baselineAttempts) / 비교 \(item.candidateAttempts)회").foregroundStyle(muted)
                        }.font(.system(size: 11)).monospacedDigit()
                    }.padding(12).background(Color.white.opacity(0.025), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            Text("Governance 기여도: off/on 대조 실행 자료가 연결되기 전에는 미측정입니다. 과거 재시도는 입력·순서 차이가 있어 독립 A/B가 아닙니다.")
                .font(.system(size: 10)).foregroundStyle(muted)
        }
    }
    private var pairedPanel: some View {
        panel("절감과 완수 · 동일 작업 대조", subtitle: "예쁜 절감률보다 실제 완수 · off/on 대조 영수증 연결 전에는 미측정") {
            HStack(spacing: 10) {
                card("실제 baseline 대비 토큰 절감", "—", "짝지은 대조 실행 없음")
                card("완수율 변화 / 회귀", "—", "같은 작업·같은 판정 기준 필요")
                card("종합 효율 향상", "—", "성공 건수와 총비용을 함께 비교")
            }
            DisclosureGroup("엄밀한 계산 기준") {
                VStack(alignment: .leading, spacing: 9) {
                    Text("사전 고정한 동일 작업 집합: baseline A와 최적화 B를 각각 실행. 입력·환경·검증기·예산·측정 창을 고정하고, 실험에서 바꾸기로 한 경로만 변경합니다. 기준 실행을 추측하거나 자동 유료 호출하지 않습니다.")
                    Text("Tₐ = Σ 모든 호출의 입력+출력 토큰 · 실패·재시도·평가·보조 호출 포함. Eₐ = 검증 성공 건수 Sₐ ÷ Tₐ × 1,000,000")
                    Text("토큰 절감 = 1 − Tᵦ/Tₐ · 완수율 변화 = (Sᵦ−Sₐ)/N · 효율 향상 = Eᵦ/Eₐ − 1. 평균 절감률을 다시 평균하지 않습니다.")
                    Text("동일 작업에서 실패→성공 C와 성공→실패 B를 따로 셉니다. 순증 = C−B. 순증이 양수여도 회귀 B를 숨기지 않습니다.")
                    Text("N=0, 기준 토큰=0, 기준 효율=0 또는 계측·목표 검증 누락이면 해당 비율은 —. 성공 0건은 측정된 0이며, 미검증은 0이 아닙니다. 진행 중 작업과 종료된 작업의 분모를 섞지 않습니다.")
                    Text("관측 Pareto 개선: 토큰 비증가 + 완수 비감소 + 최소 하나 개선. 반대는 회귀, 방향이 엇갈리면 교환관계, 모두 같으면 변화 없음. 표본 분류가 통계적 유의성이나 무회귀를 보증하지 않습니다.")
                    Text("완전 관측 비율에는 Wilson 95% 구간, 짝지은 성공/실패에는 exact McNemar 검정. 실시간 반복 조회·적응적 튜닝 자료로 유의성이나 인과적 향상을 선언하지 않습니다. 비용 효율·지연은 별도 축으로 유지합니다.")
                }.font(.system(size: 11)).foregroundStyle(muted).fixedSize(horizontal: false, vertical: true).padding(.top, 8)
            }.font(.system(size: 12))
        }
    }
    private var tracePanel: some View {
        DisclosureGroup("실제 작업 기록 · 최근 20건") {
            VStack(alignment: .leading, spacing: 8) {
                if tasks.isEmpty { Text("이 계측을 도입한 이후의 작업 기록이 없습니다.").foregroundStyle(muted) }
                ForEach(tasks.sorted { $0.startedAt > $1.startedAt }.prefix(20), id: \.id) { task in
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("작업 ID: \(task.id)")
                            Text("경로: \(short(task.route)) · 시도 \(task.attempts.count)회 · 총토큰 \(task.tokens.map(num) ?? "미측정")")
                            Text("시작 \(task.startedAt.formatted()) · 종료 \(task.endedAt?.formatted() ?? "대기")")
                            ForEach(task.attempts, id: \.id) { attempt in
                                Text("\(short(attempt.route)) · \(attempt.observation?.outcome.rawValue ?? "진행 중") · 토큰 \(attempt.observation.flatMap(GovernanceSnapshot.tokens).map(num) ?? "미측정")")
                            }
                        }.font(.system(size: 10, design: .monospaced)).foregroundStyle(muted).textSelection(.enabled)
                    } label: {
                        Text("\(task.startedAt.formatted(date: .abbreviated, time: .shortened)) · \(task.disposition) · \(task.id.prefix(8))")
                    }
                }
            }.font(.system(size: 11)).padding(.top, 8)
        }.font(.system(size: 12))
    }
    private var methodology: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("측정 기준").font(.system(size: 12, weight: .semibold))
            Text("결과 채택 = OS1 실행·출력·저장 게이트 통과. 목표 달성 검증은 별도입니다. 현재 목표별 테스트/사용자 승인 영수증이 연결되지 않아 검증 완수율·검증 효율은 미측정입니다.")
            Text("입력 + 출력 토큰에 재시도·실패 비용을 포함합니다. 캐시는 입력에 포함된 부분이므로 다시 더하지 않습니다. 제공자별 토크나이저가 달라 교차 제공자 절감 비교는 하지 않습니다.")
            Text("과거 기록은 요청당 최대 16회 보관된 시도 표본입니다. 시각·작업 종료가 없으므로 과거 작업 완수율과 실시간 추이는 소급 생성하지 않습니다. 새 작업은 별도 원자적 기록으로 누적합니다. 확인된 결과 재전송은 기존 작업에 합쳐 호출을 중복 계산하지 않습니다.")
            Text("새 기록 \(snapshot.tasks.count)건 · 과거 시도 \(snapshot.historical.count)회 · 읽기/검증 거부 \(snapshot.rejectedRecords)건 · 표시 한도 초과 \(snapshot.omittedFiles)건 · 요금표 미연결: 토큰 절감 ≠ 금액 절감")
        }.font(.system(size: 10)).foregroundStyle(muted).fixedSize(horizontal: false, vertical: true)
    }
}
