import SwiftUI
import Charts
import OS1Context

private enum GovernanceMonitorSection: String, CaseIterable, Identifiable {
    case live = "실시간"
    case tokens = "토큰"
    case performance = "수행률"
    case compare = "모델 비교"
    var id: Self { self }
}

private struct GovernanceActivityPoint: Identifiable {
    let id: Date
    let tokens: Int
    let measured: Int
    let attempts: Int
    let firstPass: Int
    let assisted: Int
    let nonAdopted: Int
}

/// Read-only projection; opening this panel never starts a provider, replay, or benchmark.
struct GovernanceMonitorView: View {
    var active: [String] = []
    var queued: Int = 0
    var onClose: (() -> Void)? = nil
    var preview: Bool = false
    @State var snapshot = GovernanceSnapshot()
    @State private var runtimeSamples: [GovernanceRuntimeSample] = []
    @State private var window = "전체"
    @State private var provider = "전체"
    @State private var baseline = ""
    @State private var candidate = ""
    @State private var section = GovernanceMonitorSection.live
    @State private var scenarioTasks = 100
    @State private var selectedTaskID = ""
    @State private var refreshed = Date()
    @Environment(\.dismiss) private var dismiss
    private let green = Color(red: 0.23, green: 0.9, blue: 0.56)
    private let pink = Color(red: 0.99, green: 0.61, blue: 0.77)
    private let muted = Color(white: 0.59)

    init(active: [String] = [], queued: Int = 0, onClose: (() -> Void)? = nil,
         preview: Bool = false, snapshot: GovernanceSnapshot = GovernanceSnapshot(),
         previewSection: String = GovernanceMonitorSection.live.rawValue) {
        self.active = active
        self.queued = queued
        self.onClose = onClose
        self.preview = preview
        _snapshot = State(initialValue: snapshot)
        _section = State(initialValue: GovernanceMonitorSection(rawValue: previewSection) ?? .live)
        let available = snapshot.routes(since: nil, includeHistorical: true).filter { $0.attempts > 0 }
        let initialBaseline = available.first(where: {
            !snapshot.comparisons(baseline: $0.id, since: nil, includeHistorical: true).isEmpty
        })?.id ?? available.first?.id ?? ""
        _baseline = State(initialValue: initialBaseline)
        _candidate = State(initialValue: snapshot.comparisons(
            baseline: initialBaseline, since: nil, includeHistorical: true
        ).first?.id ?? "")
    }
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
    private var measuredRows: [GovernanceRoute] { rows.filter { $0.measuredAttempts > 0 }.prefix(8).map { $0 } }
    private var baselineRow: GovernanceRoute? { rows.first { $0.id == baseline } }
    private var maxMeanTokens: Double { max(1, measuredRows.compactMap(\.meanTokens).max() ?? 1) }
    private var samples: [(String, CompletionFeedbackObservation)] { filtered.samples(since: since, includeHistorical: since == nil) }
    private var usage: [Int] { samples.compactMap { GovernanceSnapshot.tokens($0.1) } }
    private var completed: Int { terminal.filter(\.isAdopted).count }
    /// Completed in one click: adopted and never re-asked. The objective function.
    private var firstPass: Int { terminal.filter(\.isFirstPass).count }
    private var retried: Int { terminal.filter { $0.ownerRetryAt != nil }.count }
    private var tokensPerCompletedTask: Double? {
        let tokens = meteredTasks.compactMap(\.tokens).reduce(0,+)
        guard !terminal.isEmpty, terminal.count == meteredTasks.count, tokens > 0, firstPass > 0 else { return nil }
        return Double(tokens) / Double(firstPass)
    }
    private var comparisons: [GovernanceComparison] {
        filtered.comparisons(baseline: baseline, since: since, includeHistorical: since == nil)
    }
    private var selectedComparison: GovernanceComparison? { comparisons.first { $0.id == candidate } }
    private var candidateRow: GovernanceRoute? { rows.first { $0.id == candidate } }
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
    private var activityPoints: [GovernanceActivityPoint] {
        let bucketMap = Dictionary(uniqueKeysWithValues: buckets.map { ($0.id, $0) })
        let end = Date(timeIntervalSince1970: floor(refreshed.timeIntervalSince1970 / 60) * 60)
        return (0..<60).map { offset in
            let date = end.addingTimeInterval(Double(offset - 59) * 60)
            let bucket = bucketMap[date]
            return GovernanceActivityPoint(id: date,
                tokens: bucket?.tokens ?? 0,
                measured: bucket?.measured ?? 0,
                attempts: bucket?.attempts ?? 0,
                firstPass: bucket?.firstPassCompletions ?? 0,
                assisted: bucket?.ownerAssistedCompletions ?? 0,
                nonAdopted: bucket?.nonAdopted ?? 0)
        }
    }
    private var recentTasks: [GovernanceTask] { Array(tasks.sorted { $0.startedAt > $1.startedAt }.prefix(12)) }
    private var selectedTask: GovernanceTask? {
        tasks.first { $0.id == selectedTaskID } ?? recentTasks.first
    }
    private var recentTokenTotal: Int { activityPoints.reduce(0) { $0 + $1.tokens } }
    private var recentTokenPeak: Int { activityPoints.map(\.tokens).max() ?? 0 }
    private var recentTokenPeakPoint: GovernanceActivityPoint? {
        activityPoints.filter { $0.tokens > 0 }.max { $0.tokens < $1.tokens }
    }
    private var currentMinuteTokens: Int { activityPoints.last?.tokens ?? 0 }
    private var observedTotalTokens: Int? { usage.isEmpty ? nil : usage.reduce(0,+) }
    private var projectedBaselineTokens: Int? {
        selectedComparison?.baselineMeanTokens.map { Int(($0 * Double(scenarioTasks)).rounded()) }
    }
    private var projectedCandidateTokens: Int? {
        selectedComparison?.candidateMeanTokens.map { Int(($0 * Double(scenarioTasks)).rounded()) }
    }
    private var projectedTokenDifference: Int? {
        guard let baseline = projectedBaselineTokens, let candidate = projectedCandidateTokens else { return nil }
        return baseline - candidate
    }
    private func num(_ n: Int) -> String { n.formatted(.number) }
    private func percent(_ n: Double?) -> String { n.map { String(format: "%.1f%%", $0 * 100) } ?? "—" }
    private func decimal(_ n: Double?) -> String { n.map { String(format: "%.2f", $0) } ?? "—" }
    private func delta(_ n: Double?) -> String { n.map { String(format: "%+.1f%%", $0 * 100) } ?? "—" }
    private func short(_ route: String) -> String { route.replacingOccurrences(of: " / ", with: " · ") }
    private func compactTokenAxis(_ value: Double) -> String {
        let magnitude = abs(value)
        let scaled: Double
        let suffix: String
        if magnitude >= 1_000_000_000 {
            scaled = value / 1_000_000_000; suffix = "B"
        } else if magnitude >= 1_000_000 {
            scaled = value / 1_000_000; suffix = "M"
        } else if magnitude >= 1_000 {
            scaled = value / 1_000; suffix = "K"
        } else {
            return String(Int(value.rounded()))
        }
        let format = abs(scaled) >= 10 ? "%.0f" : "%.1f"
        return String(format: format, scaled).replacingOccurrences(of: ".0", with: "") + suffix
    }
    private func projectedDeltaText(_ value: Int?) -> String {
        guard let value else { return "—" }
        return value >= 0 ? "+\(num(value)) 절약" : "\(num(abs(value))) 추가"
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Color.white.opacity(0.12))
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    controls
                    sectionContent
                    methodology
                }.padding(24)
            }
        }
        .frame(minWidth: 980, idealWidth: 1180, maxWidth: .infinity, minHeight: 700, maxHeight: .infinity)
        .background(Color(red: 0.025, green: 0.026, blue: 0.029))
        .foregroundStyle(Color(white: 0.94))
        .preferredColorScheme(.dark)
        .task {
            guard !preview else { setBaseline(); return }
            while !Task.isCancelled {
                let tick = ContinuousClock.now
                let value = await Task.detached(priority: .utility) {
                    GovernanceActivityStore().snapshot()
                }.value
                guard !Task.isCancelled else { return }
                snapshot = value; setBaseline()
                try? await Task.sleep(until: tick.advanced(by: .seconds(1)), clock: .continuous)
            }
        }
        .task {
            guard !preview else { return }
            while !Task.isCancelled {
                let tick = ContinuousClock.now
                var roots = Set(snapshot.tasks.filter { !$0.isTerminal }.map(\.pid))
                roots.insert(ProcessInfo.processInfo.processIdentifier)
                let sample = await Task.detached(priority: .utility) {
                    GovernanceRuntime.sample(roots: roots)
                }.value
                guard !Task.isCancelled else { return }
                refreshed = sample.id
                runtimeSamples.append(sample)
                if runtimeSamples.count > 120 { runtimeSamples.removeFirst(runtimeSamples.count - 120) }
                try? await Task.sleep(until: tick.advanced(by: .seconds(1)), clock: .continuous)
            }
        }
        .onChange(of: provider) { _ in setBaseline() }
        .onChange(of: window) { _ in setBaseline() }
        .onChange(of: baseline) { _ in setCandidate() }
    }
    private func setBaseline() {
        let available = rows.filter { $0.attempts > 0 }
        if !available.contains(where: { $0.id == baseline }) {
            baseline = available.first(where: { !filtered.comparisons(baseline: $0.id, since: since, includeHistorical: since == nil).isEmpty })?.id
                ?? available.first?.id
                ?? ""
        }
        setCandidate()
    }
    private func setCandidate() {
        let ids = comparisons.map(\.id)
        if !ids.contains(candidate) { candidate = ids.first ?? "" }
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
            Text(preview ? "읽기 전용 미리보기" : "LIVE · 1초 갱신").font(.system(size: 11)).foregroundStyle(green)
            Button { if let onClose { onClose() } else { dismiss() } } label: { Image(systemName: "xmark").frame(width: 26, height: 26) }
                .buttonStyle(.plain).accessibilityLabel("Close governance monitor")
        }.padding(24).frame(maxWidth: .infinity)
    }
    private var controls: some View {
        HStack(spacing: 16) {
            Picker("화면", selection: $section) {
                ForEach(GovernanceMonitorSection.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(maxWidth: 500)
            Spacer()
            Picker("기간", selection: $window) { ForEach(["전체", "24시간", "7일"], id: \.self) { Text($0) } }.frame(width: 155)
            Picker("백엔드", selection: $provider) { Text("전체").tag("전체"); Text("Codex").tag("codex"); Text("Claude Code").tag("claude") }.frame(width: 190)
        }
    }
    @ViewBuilder private var sectionContent: some View {
        switch section {
        case .live:
            compactMetrics
            runtimeActivityPanel
            activityMonitorPanel
            liveRow
            taskMonitorTable
        case .tokens:
            compactMetrics
            tokenActivityPanel
            tokenChart
            routeTable
            pairedPanel
        case .performance:
            performanceMetrics
            completionChart
            routeTable
            tracePanel
        case .compare:
            comparisonWorkbench
            pairedPanel
            DisclosureGroup("과거 matched 관측 · 인과 비교 아님") { comparePanel }
        }
    }
    private func card(_ title: String, _ value: String, _ note: String, color: Color = .white) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(title).font(.system(size: 11)).foregroundStyle(muted)
            Text(value).font(.system(size: 26, weight: .semibold)).monospacedDigit().foregroundStyle(color)
            Text(note).font(.system(size: 10)).foregroundStyle(muted).lineLimit(2).frame(minHeight: 25, alignment: .top)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(15)
            .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 12))
    }
    private var metrics: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                card("한 방 완료율", percent(terminal.isEmpty ? nil : Double(firstPass)/Double(terminal.count)),
                     "\(firstPass)/\(terminal.count)건 · 채택됐고 되묻지 않음 · 되물음 \(retried)건 · 이것이 완료의 정의", color: green)
                card("완료 작업당 토큰", tokensPerCompletedTask.map { num(Int($0)) } ?? "—",
                     "전 작업 토큰 ÷ 한 방 완료 건수 · 재시도·실패 비용 포함 · 낮을수록 좋음", color: green)
                card("측정 토큰 · 입력 + 출력", usage.isEmpty ? "—" : num(usage.reduce(0,+)), "계측 \(usage.count)/\(samples.count)회 · 절약은 완료가 있을 때만 의미", color: pink)
            }
            HStack(spacing: 10) {
                card("작업 결과 채택률", percent(terminal.isEmpty ? nil : Double(completed)/Double(terminal.count)), "\(completed)/\(terminal.count)건 · 실패·취소 포함")
                card("시도 채택률", percent(samples.isEmpty ? nil : Double(samples.filter { $0.1.outcome == .adopted }.count)/Double(samples.count)), "\(samples.count)회 관측 · 작업 완수율과 구별")
                card("채택 처리량", decimal(observedHours >= 1 ? Double(completed)/observedHours : nil), "채택 건/관측 시간 · 1시간부터")
            }
        }
    }
    private func compactCard(_ title: String, _ value: String, _ note: String, color: Color = .white) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.system(size: 10, weight: .medium)).foregroundStyle(muted)
            Text(value).font(.system(size: 22, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(color)
            Text(note).font(.system(size: 9)).foregroundStyle(muted).lineLimit(1)
        }
        .frame(maxWidth: .infinity, minHeight: 70, alignment: .leading)
        .padding(.horizontal, 14).padding(.vertical, 11)
        .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 10))
    }
    private var compactMetrics: some View {
        HStack(spacing: 10) {
            compactCard("한 번에 완료", percent(terminal.isEmpty ? nil : Double(firstPass) / Double(terminal.count)),
                        "\(firstPass)/\(terminal.count)건 · 오너 재요청 없음", color: green)
            compactCard("현재 분 반영 토큰", recentTokenTotal == 0 ? "—" : num(currentMinuteTokens),
                        "호출 종료 영수증 반영", color: pink)
            compactCard("선택 경로 토큰 절감", delta(selectedComparison?.tokenSavings),
                        "matched 관측 · 모델 비교 선택값", color: (selectedComparison?.tokenSavings ?? 0) >= 0 ? green : pink)
            compactCard("한 방 완료당 토큰", tokensPerCompletedTask.map { num(Int($0)) } ?? "—",
                        "재시도·실패 비용 포함", color: green)
            compactCard("실행 / 큐 대기", "\(active.count) / \(queued)",
                        "미종료 영수증 \(tasks.filter { !$0.isTerminal }.count)건")
        }
    }
    private var performanceMetrics: some View {
        HStack(spacing: 10) {
            compactCard("한 방 완료율", percent(terminal.isEmpty ? nil : Double(firstPass) / Double(terminal.count)),
                        "\(firstPass)/\(terminal.count)건", color: green)
            compactCard("결과 채택률", percent(terminal.isEmpty ? nil : Double(completed) / Double(terminal.count)),
                        "\(completed)/\(terminal.count)건 · 재요청 포함")
            compactCard("오너 재요청", terminal.isEmpty ? "—" : "\(retried)건",
                        "처음 응답 후 다시 요청")
            compactCard("채택 처리량", decimal(observedHours >= 1 ? Double(completed) / observedHours : nil),
                        "채택 건/관측 시간 · 1시간부터")
        }
    }
    private var runtimeActivityPanel: some View {
        panel("LIVE · OS1 프로세스", subtitle: "1초 샘플 · 로컬 OS1 및 실행 자식 프로세스 · 원격 모델 사용률과 토큰 추정 아님") {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(runtimeSamples.last?.cpuPercent.map { String(format: "CPU %.1f%%", $0) } ?? "CPU —")
                    Text(runtimeSamples.last?.residentBytes.map { String(format: "메모리 %.1f MB", Double($0) / 1_048_576) } ?? "메모리 —")
                    Spacer()
                    Text(runtimeSamples.last?.processes.map { "프로세스 \($0)개" } ?? "관측 대기")
                    Text((runtimeSamples.last?.id ?? refreshed).formatted(.dateTime.hour().minute().second()))
                }.font(.system(size: 11, design: .monospaced))
                Chart(runtimeSamples) { point in
                    if let cpu = point.cpuPercent {
                        LineMark(x: .value("시간", point.id), y: .value("프로세스 평균 CPU %", cpu))
                            .foregroundStyle(pink)
                        PointMark(x: .value("시간", point.id), y: .value("프로세스 평균 CPU %", cpu)).symbolSize(8).foregroundStyle(pink)
                    }
                }
                .chartXScale(domain: refreshed.addingTimeInterval(-120)...refreshed)
                .chartYScale(domain: 0...max(1, (runtimeSamples.compactMap(\.cpuPercent).max() ?? 0) * 1.1))
                .frame(height: 135)
                Text("CPU: macOS ps 프로세스 평균 합계 · 여러 코어 사용 시 100% 초과 가능 · 관측 실패는 0으로 채우지 않음")
                    .font(.system(size: 10)).foregroundStyle(muted)
            }
        }
    }
    private var activityMonitorPanel: some View {
        panel("Token Activity · 최근 60분", subtitle: "1초 조회 · 토큰은 호출 종료 영수증에서만 반영 · 빈 분은 0으로 표시") {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 18) {
                    legend(pink, "실측 토큰")
                    legend(green, "한 방 완료")
                    legend(.yellow, "오너 재요청 후 완료")
                    legend(.red.opacity(0.8), "미채택")
                    Spacer()
                    Text(preview ? "스냅샷" : "실시간 관측").font(.system(size: 9, weight: .semibold, design: .monospaced)).foregroundStyle(green)
                }
                ZStack {
                    Chart(activityPoints) { point in
                        AreaMark(x: .value("시간", point.id), y: .value("토큰", point.tokens))
                            .foregroundStyle(LinearGradient(colors: [pink.opacity(0.34), pink.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                        LineMark(x: .value("시간", point.id), y: .value("토큰", point.tokens))
                            .lineStyle(StrokeStyle(lineWidth: 2))
                            .foregroundStyle(pink)
                        if point.id == recentTokenPeakPoint?.id, point.tokens > 0 {
                            PointMark(x: .value("peak 시간", point.id), y: .value("peak 토큰", point.tokens))
                                .symbolSize(42)
                                .foregroundStyle(pink)
                                .annotation(position: .top, alignment: .trailing) {
                                    Text("peak \(num(point.tokens)) tok")
                                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                        .foregroundStyle(pink)
                                }
                        }
                    }
                    .chartXAxis { AxisMarks(values: .stride(by: .minute, count: 15)) }
                    .chartYAxis {
                        AxisMarks(position: .leading) { value in
                            AxisGridLine()
                            AxisTick()
                            AxisValueLabel {
                                if let amount = value.as(Int.self) {
                                    Text(compactTokenAxis(Double(amount)))
                                } else if let amount = value.as(Double.self) {
                                    Text(compactTokenAxis(amount))
                                }
                            }
                        }
                    }
                    .chartYScale(domain: 0...max(1, recentTokenPeak + max(1, recentTokenPeak / 8)))
                    if recentTokenTotal == 0 {
                        Text("최근 60분 실측 토큰 영수증이 없습니다.")
                            .font(.system(size: 11)).foregroundStyle(muted)
                    }
                }
                .frame(height: 225)
                Chart(activityPoints) { point in
                    BarMark(x: .value("시간", point.id), y: .value("한 방", point.firstPass)).foregroundStyle(green)
                    BarMark(x: .value("시간", point.id), y: .value("재요청", point.assisted)).foregroundStyle(Color.yellow)
                    BarMark(x: .value("시간", point.id), y: .value("미채택", point.nonAdopted)).foregroundStyle(Color.red.opacity(0.8))
                }
                .chartXAxis(.hidden)
                .chartYAxis { AxisMarks(position: .leading, values: .automatic(desiredCount: 2)) }
                .frame(height: 58)
                HStack(spacing: 10) {
                    metricPill("현재 분", recentTokenTotal == 0 ? "—" : "\(num(currentMinuteTokens)) tok", pink)
                    metricPill("60분 peak", recentTokenTotal == 0 ? "—" : "\(num(recentTokenPeak)) tok", pink)
                    metricPill("60분 누적", recentTokenTotal == 0 ? "—" : "\(num(recentTokenTotal)) tok", .white)
                    metricPill("실측 호출", num(activityPoints.reduce(0) { $0 + $1.measured }), green)
                    Spacer()
                    Text("마지막 조회 \(refreshed.formatted(date: .omitted, time: .standard))")
                        .font(.system(size: 9, design: .monospaced)).foregroundStyle(muted)
                }
            }
        }
    }
    private func legend(_ color: Color, _ text: String) -> some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 12, height: 3)
            Text(text).font(.system(size: 9)).foregroundStyle(muted)
        }
    }
    private var liveRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Circle().fill(active.isEmpty ? muted : green).frame(width: 6, height: 6)
                Text("실행 중 \(active.count)  ·  실행 큐 대기 \(queued)").font(.system(size: 12, weight: .medium))
                Spacer()
                Text("마지막 갱신 \(refreshed.formatted(date: .omitted, time: .standard))").font(.system(size: 10, design: .monospaced)).foregroundStyle(muted)
            }
            ForEach(Array(active.enumerated()), id: \.offset) { _, label in Text(label).font(.system(size: 11)).foregroundStyle(pink) }
            if tasks.contains(where: { !$0.isTerminal }) {
                Text("미종료 영수증 \(tasks.filter { !$0.isTerminal }.count)건 · 중단·미확정 기록은 완수로 계산하지 않습니다.").font(.system(size: 10)).foregroundStyle(muted)
            }
        }.padding(13).background(green.opacity(0.045), in: RoundedRectangle(cornerRadius: 10))
    }
    private var taskMonitorTable: some View {
        panel("실행 프로세스", subtitle: "최근 작업 · 행을 누르면 실제 시도·토큰 영수증을 확인") {
            ScrollView(.horizontal, showsIndicators: false) {
                VStack(spacing: 0) {
                    taskHeader
                    Divider().overlay(Color.white.opacity(0.09))
                    if recentTasks.isEmpty {
                        Text("신규 계측 이후 작업 기록이 없습니다.")
                            .font(.system(size: 11)).foregroundStyle(muted).frame(maxWidth: .infinity).padding(28)
                    } else {
                        ForEach(recentTasks, id: \.id) { task in
                            taskMonitorRow(task)
                            Divider().overlay(Color.white.opacity(0.055))
                        }
                    }
                }
                .frame(minWidth: 920, alignment: .leading)
                .background(Color.black.opacity(0.18), in: RoundedRectangle(cornerRadius: 8))
            }
            if let selectedTask { selectedTaskInspector(selectedTask) }
        }
    }
    private var taskHeader: some View {
        HStack(spacing: 12) {
            tableText("시간", width: 72)
            tableText("작업", width: 105)
            tableText("백엔드", width: 82)
            tableText("모델", width: 168)
            tableText("추론", width: 70)
            tableText("상태", width: 96)
            tableText("토큰", width: 92, alignment: .trailing)
            tableText("시간", width: 78, alignment: .trailing)
            Spacer(minLength: 0)
        }
        .font(.system(size: 9, weight: .semibold)).foregroundStyle(muted)
        .padding(.horizontal, 12).padding(.vertical, 8)
    }
    private func taskMonitorRow(_ task: GovernanceTask) -> some View {
        let attempt = task.attempts.last
        let status = taskStatus(task)
        return Button {
            selectedTaskID = task.id
        } label: {
            HStack(spacing: 12) {
                tableText(task.startedAt.formatted(date: .omitted, time: .shortened), width: 72)
                tableText(String(task.id.prefix(8)), width: 105)
                tableText(attempt?.provider == "claude" ? "Claude" : (attempt?.provider == "codex" ? "Codex" : "Local"), width: 82)
                tableText(attempt?.model ?? "—", width: 168)
                tableText(attempt?.effort ?? "—", width: 70)
                HStack(spacing: 5) {
                    Circle().fill(status.1).frame(width: 6, height: 6)
                    Text(status.0).lineLimit(1)
                }.frame(width: 96, alignment: .leading)
                tableText(task.tokens.map(num) ?? "—", width: 92, alignment: .trailing)
                tableText(taskDuration(task), width: 78, alignment: .trailing)
                Spacer(minLength: 0)
            }
            .font(.system(size: 10, design: .monospaced)).monospacedDigit()
            .foregroundStyle(Color(white: 0.9))
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(selectedTask?.id == task.id ? green.opacity(0.09) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
    private func tableText(_ text: String, width: CGFloat, alignment: Alignment = .leading) -> some View {
        Text(text).lineLimit(1).truncationMode(.middle).frame(width: width, alignment: alignment)
    }
    private func taskStatus(_ task: GovernanceTask) -> (String, Color) {
        if !task.isTerminal { return ("영수증 대기", .yellow) }
        if task.isFirstPass { return ("한 방 완료", green) }
        if task.isAdopted { return ("재요청 완료", .yellow) }
        if task.disposition == "cancelled" { return ("취소", muted) }
        return ("미채택", .red.opacity(0.85))
    }
    private func taskDuration(_ task: GovernanceTask) -> String {
        guard let end = task.endedAt else { return "—" }
        let seconds = max(0, end.timeIntervalSince(task.startedAt))
        return seconds >= 60 ? String(format: "%.1fm", seconds / 60) : String(format: "%.1fs", seconds)
    }
    private func selectedTaskInspector(_ task: GovernanceTask) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text("선택 작업 · \(task.id)").font(.system(size: 11, weight: .semibold, design: .monospaced)).textSelection(.enabled)
                Spacer()
                Text("총 \(task.attempts.count)회 시도 · \(task.tokens.map(num) ?? "미측정") tok")
                    .font(.system(size: 10, design: .monospaced)).foregroundStyle(muted)
            }
            ForEach(task.attempts, id: \.id) { attempt in
                HStack(spacing: 12) {
                    Text(short(attempt.route)).frame(maxWidth: .infinity, alignment: .leading)
                    Text(attempt.observation?.outcome.rawValue ?? "진행 중")
                    Text(attempt.observation.flatMap(GovernanceSnapshot.tokens).map { "\(num($0)) tok" } ?? "토큰 미측정")
                    Text(attempt.observation.map { String(format: "%.1fs", Double($0.durationMS) / 1000) } ?? "—")
                }
                .font(.system(size: 9, design: .monospaced)).foregroundStyle(muted)
            }
        }
        .padding(12).background(green.opacity(0.035), in: RoundedRectangle(cornerRadius: 8))
    }
    private var tokenActivityPanel: some View {
        panel("Token Activity · 실시간", subtitle: "Activity Monitor처럼 1초마다 갱신 · 입력+출력 실측 토큰 · 기준 경로: \(baseline.isEmpty ? "미선택" : short(baseline))") {
            if measuredRows.isEmpty {
                HStack(spacing: 10) {
                    Image(systemName: "chart.bar.xaxis").foregroundStyle(pink)
                    Text("실측 토큰이 들어오면 모델별 막대와 완료율이 여기에 표시됩니다. 추정 토큰은 넣지 않습니다.")
                        .font(.system(size: 11)).foregroundStyle(muted)
                }.padding(.vertical, 8)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 10) {
                        metricPill("측정 호출", num(measuredRows.reduce(0) { $0 + $1.measuredAttempts }), green)
                        metricPill("총 실측 토큰", num(measuredRows.reduce(0) { $0 + $1.tokens }), pink)
                        metricPill("기준 완료율", percent(baselineRow?.completionRate), .white)
                        Spacer()
                        Text("paired 절감은 동일 요청 묶음이 있을 때만 표시")
                            .font(.system(size: 10)).foregroundStyle(muted)
                    }
                    ForEach(measuredRows) { row in
                        tokenActivityRow(row)
                    }
                }
            }
        }
    }
    private func metricPill(_ title: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.system(size: 9)).foregroundStyle(muted)
            Text(value).font(.system(size: 13, weight: .semibold, design: .monospaced)).foregroundStyle(color)
        }.padding(.horizontal, 10).padding(.vertical, 7)
            .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
    }
    private func tokenActivityRow(_ row: GovernanceRoute) -> some View {
        let mean = row.meanTokens ?? 0
        let comparison = comparisons.first { $0.id == row.id }
        let bar = min(1, max(0.02, mean / maxMeanTokens))
        let isBaseline = row.id == baseline
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Circle().fill(isBaseline ? .white : (row.id.hasPrefix("claude") ? pink : green)).frame(width: 7, height: 7)
                Text(short(row.id)).font(.system(size: 11, weight: .medium)).lineLimit(1)
                if isBaseline { Text("BASELINE").font(.system(size: 8, weight: .bold, design: .monospaced)).foregroundStyle(.white.opacity(0.7)) }
                Spacer()
                Text("평균 \(num(Int(mean))) tok").font(.system(size: 11, design: .monospaced)).monospacedDigit()
                Text("완료 \(percent(row.completionRate))").font(.system(size: 10, design: .monospaced)).foregroundStyle(muted)
                Text(comparison.map { "절감 \(delta($0.tokenSavings))" } ?? "paired —")
                    .font(.system(size: 10, design: .monospaced)).foregroundStyle(comparison?.tokenSavings.map { $0 >= 0 ? green : pink } ?? muted)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.07))
                    Capsule().fill(isBaseline ? Color.white.opacity(0.55) : (row.id.hasPrefix("claude") ? pink : green))
                        .frame(width: max(8, proxy.size.width * bar))
                }
            }.frame(height: 7)
        }.padding(.vertical, 2)
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
        panel("한 방 완료 흐름 · 최근 60분", subtitle: "1분 간격 · 작업 종료 영수증 기준 · 한 방=채택+오너 재요청 없음") {
            if activityPoints.contains(where: { $0.firstPass + $0.assisted + $0.nonAdopted > 0 }) {
                HStack(spacing: 18) {
                    legend(green, "한 방 완료")
                    legend(.yellow, "재요청 후 완료")
                    legend(.red.opacity(0.8), "미채택")
                    Spacer()
                }
                Chart(activityPoints) { point in
                    BarMark(x: .value("시간", point.id, unit: .minute), y: .value("한 방", point.firstPass)).foregroundStyle(green)
                    BarMark(x: .value("시간", point.id, unit: .minute), y: .value("재요청", point.assisted)).foregroundStyle(Color.yellow)
                    BarMark(x: .value("시간", point.id, unit: .minute), y: .value("미채택", point.nonAdopted)).foregroundStyle(Color.red.opacity(0.8))
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
                    Text("모델 / 추론 강도"); Text("시도"); Text("채택률"); Text("평균 토큰"); Text("평균 지연"); Text("한방완료율"); Text("채택/1M")
                }.font(.system(size: 10)).foregroundStyle(muted)
                ForEach(rows) { row in
                    GridRow {
                        Text(short(row.id)).frame(maxWidth: .infinity, alignment: .leading).foregroundStyle(row.id.hasPrefix("claude") ? pink : green)
                        Text("\(row.attempts)")
                        Text(percent(row.adoptionRate))
                        Text(row.meanTokens.map { num(Int($0)) } ?? "—")
                        Text(row.attempts > 0 ? String(format: "%.1fs", Double(row.durationMS) / Double(row.attempts) / 1000) : "—")
                        Text(percent(row.firstPassRate))
                        Text(decimal(row.completionsPerMillionTokens))
                    }.font(.system(size: 11, design: .monospaced)).monospacedDigit()
                }
            }
            if rows.isEmpty { Text("선택한 기간의 기록이 없습니다.").font(.system(size: 12)).foregroundStyle(muted) }
        }
    }
    private var comparisonWorkbench: some View {
        panel("모델 설정 What-if", subtitle: "과거 동일 요청 묶음의 matched 관측 기반 · LIVE 실행 아님 · RCC 인과적 향상 주장 아님") {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    Text("기준").font(.system(size: 10, weight: .semibold)).foregroundStyle(muted)
                    Picker("기준 경로", selection: $baseline) {
                        if baseline.isEmpty { Text("기록 없음").tag("") }
                        ForEach(rows.filter { $0.attempts > 0 }) { row in Text(short(row.id)).tag(row.id) }
                    }.labelsHidden().frame(maxWidth: 390)
                    Image(systemName: "arrow.right").foregroundStyle(muted)
                    Text("가정").font(.system(size: 10, weight: .semibold)).foregroundStyle(muted)
                    Picker("가정 경로", selection: $candidate) {
                        Text("비교 기록 없음").tag("")
                        ForEach(comparisons) { item in Text(short(item.id)).tag(item.id) }
                    }.labelsHidden().frame(maxWidth: 390)
                }
                if !comparisons.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(comparisons) { item in
                                Button { candidate = item.id } label: {
                                    HStack(spacing: 6) {
                                        Circle().fill(item.id.hasPrefix("claude") ? pink : green).frame(width: 6, height: 6)
                                        Text(short(item.id)).lineLimit(1)
                                    }
                                    .font(.system(size: 10, weight: candidate == item.id ? .semibold : .regular))
                                    .padding(.horizontal, 10).padding(.vertical, 7)
                                    .background(candidate == item.id ? green.opacity(0.14) : Color.white.opacity(0.045), in: Capsule())
                                    .overlay(Capsule().stroke(candidate == item.id ? green.opacity(0.55) : Color.white.opacity(0.08)))
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                }
                Divider().overlay(Color.white.opacity(0.08))
                HStack(spacing: 12) {
                    Text("가정 작업 수").font(.system(size: 10, weight: .semibold)).foregroundStyle(muted)
                    Picker("가정 작업 수", selection: $scenarioTasks) {
                        ForEach([10, 100, 500, 1_000], id: \.self) { Text("\($0)").tag($0) }
                    }
                    .pickerStyle(.segmented).labelsHidden().frame(width: 290)
                    Spacer()
                    Text("과거 관측 기반 가정")
                        .font(.system(size: 9, weight: .bold, design: .monospaced)).foregroundStyle(.yellow)
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .background(Color.yellow.opacity(0.09), in: Capsule())
                }
                if let item = selectedComparison {
                    HStack(spacing: 10) {
                        card("가정 토큰 차이", projectedDeltaText(projectedTokenDifference),
                             "\(scenarioTasks)개 matched 요청 · \(delta(item.tokenSavings))", color: (projectedTokenDifference ?? 0) >= 0 ? green : pink)
                        card("시도 채택률 변화", String(format: "%+.1fpp", item.adoptionDelta * 100),
                             "\(item.matchedScopes)묶음 · 작업 완수율과 구별", color: item.adoptionDelta >= 0 ? green : pink)
                        card("지연 차이", delta(item.latencySavings),
                             "양수면 가정 경로가 더 빠름", color: (item.latencySavings ?? 0) >= 0 ? green : pink)
                    }
                    scenarioBars(item)
                    HStack(spacing: 18) {
                        Text("기준 \(short(item.baseline)) · \(item.baselineAttempts)회")
                        Text("가정 \(short(item.id)) · \(item.candidateAttempts)회")
                        Spacer()
                        Text("한 방 완료 관측 \(percent(baselineRow?.firstPassRate)) → \(percent(candidateRow?.firstPassRate))")
                    }
                    .font(.system(size: 9, design: .monospaced)).foregroundStyle(muted)
                    Text("가정값은 matched scope의 경로별 절대 평균 토큰을 \(scenarioTasks)배한 단순 투영입니다. 작업 구성·순서·선택 편향을 제거하지 않으며 실행을 자동으로 시작하지 않습니다.")
                        .font(.system(size: 9)).foregroundStyle(muted)
                } else {
                    empty("같은 provider의 여러 경로가 동일 요청 묶음에서 관측되면\n모델·reasoning effort를 눌러 토큰·채택률·지연 가정을 볼 수 있습니다.")
                }
            }
        }
    }
    private func scenarioBars(_ item: GovernanceComparison) -> some View {
        Group {
            if let baseline = projectedBaselineTokens, let candidate = projectedCandidateTokens {
                Chart {
                    BarMark(x: .value("토큰", baseline), y: .value("경로", "기준"))
                        .foregroundStyle(Color.white.opacity(0.65))
                        .annotation(position: .trailing) { Text(num(baseline)).font(.system(size: 10, design: .monospaced)) }
                    BarMark(x: .value("토큰", candidate), y: .value("경로", "가정"))
                        .foregroundStyle(item.id.hasPrefix("claude") ? pink : green)
                        .annotation(position: .trailing) { Text(num(candidate)).font(.system(size: 10, design: .monospaced)) }
                }
                .chartXAxisLabel("가정 총 토큰")
                .frame(height: 112)
                .padding(.trailing, 54)
            } else {
                Text("맞춘 요청 묶음의 양쪽 토큰 계측이 완전하지 않아 절대 가정값은 — 입니다.")
                    .font(.system(size: 11)).foregroundStyle(muted).frame(maxWidth: .infinity, minHeight: 92)
            }
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
        DisclosureGroup("측정 기준 · 영수증·비교 경계") {
            VStack(alignment: .leading, spacing: 6) {
                Text("결과 채택 = OS1 실행·출력·저장 게이트 통과. 목표 달성 검증은 별도입니다. 현재 목표별 테스트/사용자 승인 영수증이 연결되지 않아 검증 완수율·검증 효율은 미측정입니다.")
                Text("입력 + 출력 토큰에 재시도·실패 비용을 포함합니다. 캐시는 입력에 포함된 부분이므로 다시 더하지 않습니다. 제공자별 토크나이저가 달라 교차 제공자 절감 비교는 하지 않습니다.")
                Text("과거 기록은 요청당 최대 16회 보관된 시도 표본입니다. 시각·작업 종료가 없으므로 과거 작업 완수율과 실시간 추이는 소급 생성하지 않습니다. 새 작업은 별도 원자적 기록으로 누적합니다. 확인된 결과 재전송은 기존 작업에 합쳐 호출을 중복 계산하지 않습니다.")
                Text("새 기록 \(snapshot.tasks.count)건 · 과거 시도 \(snapshot.historical.count)회 · 읽기/검증 거부 \(snapshot.rejectedRecords)건 · 표시 한도 초과 \(snapshot.omittedFiles)건 · 요금표 미연결: 토큰 절감 ≠ 금액 절감")
            }
            .padding(.top, 8)
        }.font(.system(size: 10)).foregroundStyle(muted).fixedSize(horizontal: false, vertical: true)
    }
}
