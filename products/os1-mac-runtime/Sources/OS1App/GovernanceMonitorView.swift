import SwiftUI
import Charts
import OS1Context

private enum GovernanceMonitorSection: String, CaseIterable, Identifiable {
    case live = "핵심"
    case details = "상세"
    var id: Self { self }
}

private struct GovernanceChartPoint: Identifiable {
    let id: Date
    let value: Double
}

private struct GovernanceActivityChartPoint: Identifiable {
    let id: Date
    let started: Double
    let finished: Double
}

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
    @State private var candidate = ""
    @State private var section = GovernanceMonitorSection.live
    @State private var scenarioTasks = 100
    @State private var selectedTaskID = ""
    @State private var refreshed = Date()
    @State private var deltaHistory = GovernanceDeltaHistory()
    @State private var deltaHistoryContext = ""
    @State private var projection: GovernanceDashboardProjection
    @State private var projectionFilterContext = "전체|전체"
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
        _refreshed = State(initialValue: snapshot.loadedAt)
        let initialProjection = snapshot.dashboardProjection(provider: nil, since: nil,
                                                             includeHistorical: true, now: snapshot.loadedAt)
        _projection = State(initialValue: initialProjection)
        let available = initialProjection.rows.filter { $0.attempts > 0 }
        let initialBaseline = available.first(where: {
            initialProjection.comparisonsByBaseline[$0.id]?.contains { $0.tokenSavings != nil } == true
        })?.id ?? available.first(where: {
            !(initialProjection.comparisonsByBaseline[$0.id] ?? []).isEmpty
        })?.id ?? available.first?.id ?? ""
        _baseline = State(initialValue: initialBaseline)
        let initialComparisons = initialProjection.comparisonsByBaseline[initialBaseline] ?? []
        let initialCandidate = initialComparisons.first(where: { $0.tokenSavings != nil })?.id
            ?? initialComparisons.first?.id ?? ""
        _candidate = State(initialValue: initialCandidate)
        if let comparison = initialComparisons.first(where: { $0.id == initialCandidate }) {
            var history = GovernanceDeltaHistory()
            history.append(at: snapshot.loadedAt, tokenSavings: comparison.tokenSavings,
                           taskCompletionDelta: comparison.taskCompletionDelta)
            _deltaHistory = State(initialValue: history)
            _deltaHistoryContext = State(initialValue: ["전체", "전체", initialBaseline, initialCandidate]
                .joined(separator: "|"))
        }
    }
    private var since: Date? {
        window == "전체" ? nil : refreshed.addingTimeInterval(window == "24시간" ? -86_400 : -604_800)
    }
    private var filterContext: String { [window, provider].joined(separator: "|") }
    private var projectionIsCurrent: Bool { projectionFilterContext == filterContext }
    private var projectionRequestID: String {
        let rollingWindowTick = window == "전체" ? "all" : String(Int(refreshed.timeIntervalSince1970))
        return [String(snapshot.loadedAt.timeIntervalSince1970), filterContext, rollingWindowTick]
            .joined(separator: "|")
    }
    private var filtered: GovernanceSnapshot { projection.snapshot }
    private var tasks: [GovernanceTask] { projectionIsCurrent ? projection.tasks : [] }
    private var terminal: [GovernanceTask] { projectionIsCurrent ? projection.terminalTasks : [] }
    private var rows: [GovernanceRoute] { projectionIsCurrent ? projection.rows : [] }
    private var measuredRows: [GovernanceRoute] { rows.filter { $0.measuredAttempts > 0 }.prefix(8).map { $0 } }
    private var baselineRow: GovernanceRoute? { rows.first { $0.id == baseline } }
    private var maxMeanTokens: Double { max(1, measuredRows.compactMap(\.meanTokens).max() ?? 1) }
    private var samples: [(String, CompletionFeedbackObservation)] { projectionIsCurrent ? projection.samples : [] }
    private var usage: [Int] { samples.compactMap { GovernanceSnapshot.tokens($0.1) } }
    private var completed: Int { terminal.filter(\.isAdopted).count }
    private var taskCompletionRate: Double? {
        terminal.isEmpty ? nil : Double(completed) / Double(terminal.count)
    }
    /// Completed in one click: adopted and never re-asked. The objective function.
    private var firstPass: Int { terminal.filter(\.isFirstPass).count }
    private var retried: Int { terminal.filter { $0.ownerRetryAt != nil }.count }
    private var tokensPerCompletedTask: Double? {
        let tokens = meteredTasks.compactMap(\.tokens).reduce(0,+)
        guard !terminal.isEmpty, terminal.count == meteredTasks.count, tokens > 0, completed > 0 else { return nil }
        return Double(tokens) / Double(completed)
    }
    private var comparisons: [GovernanceComparison] {
        projectionIsCurrent ? (projection.comparisonsByBaseline[baseline] ?? []) : []
    }
    private var selectedComparison: GovernanceComparison? { comparisons.first { $0.id == candidate } }
    private var candidateRow: GovernanceRoute? { rows.first { $0.id == candidate } }
    private var taskCompletionDelta: Double? { selectedComparison?.taskCompletionDelta }
    private var completionEfficiencyDelta: Double? { selectedComparison?.completionEfficiencyDelta }
    private var meteredTasks: [GovernanceTask] { terminal.filter { $0.tokens != nil } }
    private var quality: GovernanceQualitySummary {
        projectionIsCurrent ? projection.quality : GovernanceQualitySummary(outcomes: [], tokens: [])
    }
    private var adoptionEfficiency: Double? {
        let tokens = meteredTasks.compactMap(\.tokens).reduce(0,+)
        guard !terminal.isEmpty, terminal.count == meteredTasks.count, tokens > 0 else { return nil }
        return Double(completed) * 1_000_000 / Double(tokens)
    }
    private var observedHours: Double {
        projectionIsCurrent ? projection.observedTaskHours : 0
    }
    private var recentTasks: [GovernanceTask] { Array(tasks.sorted { $0.startedAt > $1.startedAt }.prefix(12)) }
    private var selectedTask: GovernanceTask? {
        tasks.first { $0.id == selectedTaskID } ?? recentTasks.first
    }
    private var selectedSavedTokensPerTask: Int? {
        guard let baseline = selectedComparison?.baselineMeanTokens,
              let candidate = selectedComparison?.candidateMeanTokens else { return nil }
        return Int((baseline - candidate).rounded())
    }
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
    private func percentagePoints(_ n: Double?) -> String { n.map { String(format: "%+.1fpp", $0 * 100) } ?? "—" }
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
    private var currentHistoryContext: String { [window, provider, baseline, candidate].joined(separator: "|") }
    private var tokenDeltaPoints: [GovernanceChartPoint] {
        deltaHistory.points.compactMap { point in
            point.tokenSavings.map { GovernanceChartPoint(id: point.id, value: $0 * 100) }
        }
    }
    private var completionDeltaPoints: [GovernanceChartPoint] {
        deltaHistory.points.compactMap { point in
            point.taskCompletionDelta.map { GovernanceChartPoint(id: point.id, value: $0 * 100) }
        }
    }
    /// Live activity is independent of matched baseline/candidate data. The
    /// old delta charts are intentionally empty until a paired comparison
    /// exists; that must not hide the real-time governance stream.
    private var liveActivityPoints: [GovernanceActivityChartPoint] {
        guard projectionIsCurrent else { return [] }
        let end = refreshed
        let span: TimeInterval = window == "24시간" ? 86_400 : (window == "7일" ? 604_800 : 1_800)
        let bucketSeconds: TimeInterval = window == "전체" ? 60 : (window == "24시간" ? 900 : 3_600)
        let start = end.addingTimeInterval(-span)
        var buckets: [Date: (started: Double, finished: Double)] = [:]
        func key(_ date: Date) -> Date {
            Date(timeIntervalSince1970: floor(date.timeIntervalSince1970 / bucketSeconds) * bucketSeconds)
        }
        for task in tasks {
            if task.startedAt >= start, task.startedAt <= end {
                let bucket = key(task.startedAt)
                var value = buckets[bucket] ?? (started: 0, finished: 0)
                value.started += 1
                buckets[bucket] = value
            }
            if let endedAt = task.endedAt, endedAt >= start, endedAt <= end {
                let bucket = key(endedAt)
                var value = buckets[bucket] ?? (started: 0, finished: 0)
                value.finished += 1
                buckets[bucket] = value
            }
        }
        // Keep a live zero/current point so the chart remains visible before
        // the first receipt and continues to show its current time window.
        let currentBucket = key(end)
        if buckets[currentBucket] == nil { buckets[currentBucket] = (started: 0, finished: 0) }
        return buckets.keys.sorted().map { date in
            let value = buckets[date] ?? (started: 0, finished: 0)
            return GovernanceActivityChartPoint(id: date, started: value.started, finished: value.finished)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Color.white.opacity(0.12))
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    controls
                    sectionContent
                }.padding(24)
            }
        }
        .frame(minWidth: 980, idealWidth: 1180, maxWidth: .infinity, minHeight: 700, maxHeight: .infinity)
        .background(Color(red: 0.025, green: 0.026, blue: 0.029))
        .foregroundStyle(Color(white: 0.94))
        .preferredColorScheme(.dark)
        .task {
            if preview { return }
            let cache = GovernanceActivityIncrementalCache()
            while !Task.isCancelled {
                let tick = ContinuousClock.now
                let update = await Task.detached(priority: .utility) {
                    cache.snapshotIfChanged()
                }.value
                guard !Task.isCancelled else { return }
                refreshed = Date()
                if let update {
                    snapshot = update.snapshot
                }
                try? await Task.sleep(until: tick.advanced(by: .seconds(1)), clock: .continuous)
            }
        }
        .task(id: projectionRequestID) {
            let source = snapshot
            let selectedProvider = provider == "전체" ? nil : provider
            let selectedSince = since
            let includeHistorical = selectedSince == nil
            let now = refreshed
            let context = filterContext
            let next = await Task.detached(priority: .utility) {
                source.dashboardProjection(provider: selectedProvider, since: selectedSince,
                                           includeHistorical: includeHistorical, now: now)
            }.value
            guard !Task.isCancelled else { return }
            projection = next
            projectionFilterContext = context
            setBaseline()
            await Task.yield()
            recordDeltaPoint(at: now)
        }
        .onChange(of: baseline) { _ in setCandidate() }
        .onChange(of: currentHistoryContext) { _ in
            deltaHistory = GovernanceDeltaHistory()
            deltaHistoryContext = ""
            if projectionIsCurrent { recordDeltaPoint(at: refreshed) }
        }
    }
    private func recordDeltaPoint(at date: Date) {
        let context = currentHistoryContext
        if deltaHistoryContext != context {
            deltaHistory = GovernanceDeltaHistory()
            deltaHistoryContext = context
        }
        let token = selectedComparison?.tokenSavings
        let completion = taskCompletionDelta
        if let last = deltaHistory.points.last,
           abs(last.id.timeIntervalSince(date)) < 0.1,
           last.tokenSavings == token,
           last.taskCompletionDelta == completion { return }
        deltaHistory.append(at: date, tokenSavings: token, taskCompletionDelta: completion)
    }
    private func setBaseline() {
        guard projectionIsCurrent else { return }
        let available = rows.filter { $0.attempts > 0 }
        if !available.contains(where: { $0.id == baseline }) {
            baseline = available.first(where: {
                projection.comparisonsByBaseline[$0.id]?.contains { $0.tokenSavings != nil } == true
            })?.id
                ?? available.first(where: { !(projection.comparisonsByBaseline[$0.id] ?? []).isEmpty })?.id
                ?? available.first?.id
                ?? ""
        }
        setCandidate()
    }
    private func setCandidate() {
        let ids = comparisons.map(\.id)
        if !ids.contains(candidate) {
            candidate = comparisons.first(where: { $0.tokenSavings != nil })?.id ?? ids.first ?? ""
        }
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
            Text(preview ? "읽기 전용 미리보기" : "LIVE · 1초 감지 · 변경 시 집계").font(.system(size: 11)).foregroundStyle(green)
            Button { if let onClose { onClose() } else { dismiss() } } label: { Image(systemName: "xmark").frame(width: 26, height: 26) }
                .buttonStyle(.plain).accessibilityLabel("Close governance monitor")
        }.padding(24).frame(maxWidth: .infinity)
    }
    private var controls: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 16) {
                Picker("화면", selection: $section) {
                    ForEach(GovernanceMonitorSection.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 220)
                Spacer()
                Picker("기간", selection: $window) { ForEach(["전체", "24시간", "7일"], id: \.self) { Text($0) } }.frame(width: 155)
                Picker("백엔드", selection: $provider) { Text("전체").tag("전체"); Text("Codex").tag("codex"); Text("Claude Code").tag("claude") }.frame(width: 190)
            }
            if !rows.isEmpty {
                HStack(spacing: 10) {
                    Text("기준").font(.system(size: 10, weight: .semibold)).foregroundStyle(muted)
                    Picker("기준 경로", selection: $baseline) {
                        ForEach(rows.filter { $0.attempts > 0 }) { row in Text(short(row.id)).tag(row.id) }
                    }.labelsHidden().frame(maxWidth: 390)
                    Image(systemName: "arrow.right").foregroundStyle(muted)
                    Text("비교").font(.system(size: 10, weight: .semibold)).foregroundStyle(muted)
                    Picker("비교 경로", selection: $candidate) {
                        if comparisons.isEmpty { Text("matched 기록 없음").tag("") }
                        ForEach(comparisons) { item in Text(short(item.id)).tag(item.id) }
                    }.labelsHidden().frame(maxWidth: 390)
                    Spacer()
                }
            }
        }
    }
    @ViewBuilder private var sectionContent: some View {
        switch section {
        case .live:
            compactMetrics
            liveActivityChart
            deltaCharts
            liveRow
        case .details:
            taskMonitorTable
            routeTable
            DisclosureGroup("모델 비교 · 과거 matched 관측") { comparisonWorkbench; comparePanel }
            tracePanel
            methodology
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
            compactCard("테스크 완료율", percent(taskCompletionRate),
                        "완료 \(completed) / 종료 \(terminal.count)", color: green)
            compactCard("토큰 감소율 Δ", delta(selectedComparison?.tokenSavings),
                        selectedComparison.map { "matched \($0.matchedScopes)묶음 · 실패 포함" } ?? "동일 요청 비교 데이터 없음",
                        color: (selectedComparison?.tokenSavings ?? 0) >= 0 ? green : pink)
            compactCard("테스크 완료율 Δ", percentagePoints(taskCompletionDelta),
                        "matched \(percent(selectedComparison?.baselineTaskCompletionRate)) → \(percent(selectedComparison?.candidateTaskCompletionRate))",
                        color: (taskCompletionDelta ?? 0) >= 0 ? green : pink)
            compactCard("종합 효율 Δ", delta(completionEfficiencyDelta),
                        "완료/1M tok · 실패·재시도 포함",
                        color: (completionEfficiencyDelta ?? 0) >= 0 ? green : pink)
        }
    }
    private var deltaCharts: some View {
        HStack(alignment: .top, spacing: 12) {
            deltaChart(title: "토큰 감소율 Δ", current: delta(selectedComparison?.tokenSavings), unit: "%",
                       note: "matched 요청 · 실패·재시도 비용 포함", points: tokenDeltaPoints,
                       color: (selectedComparison?.tokenSavings ?? 0) >= 0 ? green : pink)
            deltaChart(title: "테스크 완료율 Δ", current: percentagePoints(taskCompletionDelta), unit: "pp",
                       note: "비교 − 기준 · 같은 matched 요청", points: completionDeltaPoints,
                       color: (taskCompletionDelta ?? 0) >= 0 ? green : pink)
        }
    }
    private var liveActivityChart: some View {
        let points = liveActivityPoints
        let maxValue = max(1, points.flatMap { [$0.started, $0.finished] }.max() ?? 1)
        let windowLabel = window == "전체" ? "최근 30분" : window
        return VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("실시간 거버넌스 활동").font(.system(size: 12, weight: .semibold))
                    Text("작업 시작·종료 영수증 · \(windowLabel)")
                        .font(.system(size: 9)).foregroundStyle(muted)
                }
                Spacer()
                HStack(spacing: 10) {
                    Label("시작", systemImage: "circle.fill").foregroundStyle(green)
                    Label("종료", systemImage: "circle.fill").foregroundStyle(pink)
                }.font(.system(size: 9, weight: .medium))
            }
            Chart {
                RuleMark(y: .value("기준", 0))
                    .foregroundStyle(Color.white.opacity(0.16))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                ForEach(points) { point in
                    LineMark(x: .value("시간", point.id), y: .value("시작", point.started))
                        .foregroundStyle(green)
                        .lineStyle(StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
                        .symbol(Circle())
                    LineMark(x: .value("시간", point.id), y: .value("종료", point.finished))
                        .foregroundStyle(pink)
                        .lineStyle(StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
                        .symbol(Circle())
                }
            }
            .chartYScale(domain: 0...maxValue + 1)
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 5)) { _ in
                    AxisGridLine().foregroundStyle(Color.white.opacity(0.06))
                    AxisValueLabel(format: .dateTime.hour().minute())
                        .font(.system(size: 8)).foregroundStyle(muted)
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
                    AxisGridLine().foregroundStyle(Color.white.opacity(0.06))
                    AxisValueLabel {
                        if let number = value.as(Double.self) {
                            Text(String(Int(number.rounded())))
                                .font(.system(size: 8, design: .monospaced)).foregroundStyle(muted)
                        }
                    }
                }
            }
            .frame(height: 170)
            Text(points.count == 1 && points[0].started == 0 && points[0].finished == 0
                 ? "실시간 작업 영수증을 기다리는 중입니다."
                 : "새 영수증이 저장되면 다음 폴링 주기에 그래프가 갱신됩니다.")
                .font(.system(size: 9)).foregroundStyle(muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(15)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
    }
    private func chartDomain(_ points: [GovernanceChartPoint]) -> ClosedRange<Double> {
        let values = points.map(\.value) + [0]
        let low = values.min() ?? -1
        let high = values.max() ?? 1
        let span = max(1, high - low)
        return (low - span * 0.16)...(high + span * 0.16)
    }
    private func deltaChart(title: String, current: String, unit: String, note: String,
                            points: [GovernanceChartPoint], color: Color) -> some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(size: 12, weight: .semibold))
                    Text(note).font(.system(size: 9)).foregroundStyle(muted)
                }
                Spacer()
                Text(current).font(.system(size: 22, weight: .semibold, design: .rounded))
                    .monospacedDigit().foregroundStyle(color)
            }
            if points.isEmpty {
                VStack(spacing: 7) {
                    Image(systemName: "chart.xyaxis.line").font(.system(size: 24)).foregroundStyle(muted.opacity(0.55))
                    Text("비교 가능한 실측 델타가 없습니다.").font(.system(size: 10)).foregroundStyle(muted)
                }
                .frame(maxWidth: .infinity, minHeight: 155)
            } else {
                Chart {
                    RuleMark(y: .value("기준", 0))
                        .foregroundStyle(Color.white.opacity(0.16))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    ForEach(points) { point in
                        LineMark(x: .value("시간", point.id), y: .value("델타", point.value))
                            .foregroundStyle(color)
                            .lineStyle(StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
                        AreaMark(x: .value("시간", point.id), yStart: .value("기준", 0), yEnd: .value("델타", point.value))
                            .foregroundStyle(LinearGradient(colors: [color.opacity(0.24), color.opacity(0.015)], startPoint: .top, endPoint: .bottom))
                    }
                    if let last = points.last {
                        PointMark(x: .value("현재 시간", last.id), y: .value("현재 델타", last.value))
                            .foregroundStyle(color).symbolSize(34)
                    }
                }
                .chartYScale(domain: chartDomain(points))
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                        AxisGridLine().foregroundStyle(Color.white.opacity(0.06))
                        AxisValueLabel(format: .dateTime.hour().minute())
                            .font(.system(size: 8)).foregroundStyle(muted)
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
                        AxisGridLine().foregroundStyle(Color.white.opacity(0.06))
                        AxisValueLabel {
                            if let number = value.as(Double.self) {
                                Text(String(format: "%+.0f%@", number, unit))
                                    .font(.system(size: 8, design: .monospaced)).foregroundStyle(muted)
                            }
                        }
                    }
                }
                .frame(height: 155)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(15)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
    }
    private var performanceMetrics: some View {
        HStack(spacing: 10) {
            compactCard("테스크 완료율", percent(taskCompletionRate),
                        "완료 \(completed)/종료 \(terminal.count)건", color: green)
            compactCard("바로 완료", terminal.isEmpty ? "—" : "\(firstPass)건",
                        "추가 수정 요청 없음")
            compactCard("수정 후 완료", terminal.isEmpty ? "—" : "\(retried)건",
                        "추가 요청 뒤 완료")
            compactCard("시간당 완료", decimal(observedHours >= 1 ? Double(completed) / observedHours : nil),
                        "관측 1시간 이후 표시")
        }
    }
    private func deltaCard(_ title: String, _ value: String, _ note: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 10, weight: .medium)).foregroundStyle(muted)
            Text(value).font(.system(size: 24, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(color)
            Text(note).font(.system(size: 9)).foregroundStyle(muted).lineLimit(1)
        }
        .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
        .padding(.horizontal, 14).padding(.vertical, 11)
        .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 10))
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
                Text("미종료 영수증 \(tasks.filter { !$0.isTerminal }.count)건 · 중단·미확정 기록은 완료로 계산하지 않습니다.").font(.system(size: 10)).foregroundStyle(muted)
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
        if task.isFirstPass { return ("바로 완료", green) }
        if task.isAdopted { return ("수정 후 완료", .yellow) }
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
    private func panel<Content: View>(_ title: String, subtitle: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.system(size: 14, weight: .semibold))
            Text(subtitle).font(.system(size: 10)).foregroundStyle(muted)
            content()
        }.padding(16).background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 12))
    }
    private var completionChart: some View {
        panel("테스크 완료율 델타", subtitle: "그래프 대신 종료 영수증과 기준→비교 차이를 직접 표시") {
            HStack(spacing: 10) {
                deltaCard("현재 완료율", percent(taskCompletionRate),
                          "완료 \(completed) / 종료 \(terminal.count)", green)
                deltaCard("기준→비교", percentagePoints(taskCompletionDelta),
                          "동일 matched 요청 묶음", (taskCompletionDelta ?? 0) >= 0 ? green : pink)
                deltaCard("완료 토큰", tokensPerCompletedTask.map { num(Int($0)) + " tok/완료" } ?? "—",
                          "실측 토큰·재시도 비용 포함", green)
            }
        }
    }
    private var routeTable: some View {
        panel("실행 경로 비교", subtitle: "모델명 + reasoning effort · 서로 다른 백엔드로 재시도한 작업은 mixed로 별도 계산") {
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 11) {
                GridRow {
                    Text("모델 / 추론 강도"); Text("시도"); Text("채택률"); Text("평균 토큰"); Text("평균 지연"); Text("테스크 완료율"); Text("완료/1M")
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
                             "\(item.matchedScopes)묶음 · 테스크 완료율과 구별", color: item.adoptionDelta >= 0 ? green : pink)
                        card("지연 차이", delta(item.latencySavings),
                             "양수면 가정 경로가 더 빠름", color: (item.latencySavings ?? 0) >= 0 ? green : pink)
                    }
                    HStack(spacing: 18) {
                        Text("기준 \(short(item.baseline)) · \(item.baselineAttempts)회")
                        Text("가정 \(short(item.id)) · \(item.candidateAttempts)회")
                        Spacer()
                        Text("matched 완료율 \(percent(item.baselineTaskCompletionRate)) → \(percent(item.candidateTaskCompletionRate))")
                    }
                    .font(.system(size: 9, design: .monospaced)).foregroundStyle(muted)
                    Text("가정값은 matched scope의 경로별 절대 평균 토큰을 \(scenarioTasks)배한 단순 투영입니다. 작업 구성·순서·선택 편향을 제거하지 않으며 실행을 자동으로 시작하지 않습니다.")
                        .font(.system(size: 9)).foregroundStyle(muted)
                } else {
                    Text("같은 provider의 여러 경로가 동일 요청 묶음에서 관측되면\n모델·reasoning effort를 눌러 토큰·채택률·지연 가정을 볼 수 있습니다.")
                        .font(.system(size: 11)).foregroundStyle(muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 8)
                }
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
                Text("비교 가능한 동일 요청 기록이 없습니다. 절약률을 추측하거나 비교용 API를 자동 호출하지 않습니다.")
                    .font(.system(size: 11)).foregroundStyle(muted).padding(.vertical, 8)
            } else {
                ForEach(comparisons) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(short(item.id)).font(.system(size: 12, weight: .semibold))
                        HStack(spacing: 25) {
                            Text("토큰 차이 추정 \(delta(item.tokenSavings))").foregroundStyle((item.tokenSavings ?? 0) >= 0 ? green : pink)
                            Text(String(format: "시도 채택률 차이 %+.1fpp", item.adoptionDelta * 100)).foregroundStyle(item.adoptionDelta >= 0 ? green : pink)
                            Text("지연 단축 \(delta(item.latencySavings))")
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
        panel("절약과 완료 · 동일 테스크 대조", subtitle: "토큰 절약과 실제 완료를 함께 비교 · off/on 대조 영수증 연결 전에는 미측정") {
            HStack(spacing: 10) {
                card("실제 기준 대비 토큰 절약", "—", "짝지은 대조 실행 없음")
                card("테스크 완료율 변화 / 회귀", "—", "같은 테스크·같은 판정 기준 필요")
                card("종합 효율 향상", "—", "성공 건수와 총비용을 함께 비교")
            }
            DisclosureGroup("엄밀한 계산 기준") {
                VStack(alignment: .leading, spacing: 9) {
                    Text("사전 고정한 동일 작업 집합: baseline A와 최적화 B를 각각 실행. 입력·환경·검증기·예산·측정 창을 고정하고, 실험에서 바꾸기로 한 경로만 변경합니다. 기준 실행을 추측하거나 자동 유료 호출하지 않습니다.")
                    Text("Tₐ = Σ 모든 호출의 입력+출력 토큰 · 실패·재시도·평가·보조 호출 포함. Eₐ = 검증 성공 건수 Sₐ ÷ Tₐ × 1,000,000")
                    Text("토큰 절약 = 1 − Tᵦ/Tₐ · 테스크 완료율 변화 = (Sᵦ−Sₐ)/N · 효율 향상 = Eᵦ/Eₐ − 1. 평균 절약률을 다시 평균하지 않습니다.")
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
                Text("결과 채택 = OS1 실행·출력·저장 게이트 통과. 목표 달성 검증은 별도입니다. 현재 목표별 테스트/사용자 승인 영수증이 연결되지 않아 검증 완료율·검증 효율은 미측정입니다.")
                Text("입력 + 출력 토큰에 재시도·실패 비용을 포함합니다. 캐시는 입력에 포함된 부분이므로 다시 더하지 않습니다. 제공자별 토크나이저가 달라 교차 제공자 토큰 절약 비교는 하지 않습니다.")
                Text("과거 기록은 요청당 최대 16회 보관된 시도 표본입니다. 시각·테스크 종료가 없으므로 과거 테스크 완료율과 실시간 추이는 소급 생성하지 않습니다. 새 테스크는 별도 원자적 기록으로 누적합니다. 확인된 결과 재전송은 기존 테스크에 합쳐 호출을 중복 계산하지 않습니다.")
                Text("새 기록 \(snapshot.tasks.count)건 · 과거 시도 \(snapshot.historical.count)회 · 읽기/검증 거부 \(snapshot.rejectedRecords)건 · 표시 한도 초과 \(snapshot.omittedFiles)건 · 요금표 미연결: 토큰 절약 ≠ 금액 절약")
            }
            .padding(.top, 8)
        }.font(.system(size: 10)).foregroundStyle(muted).fixedSize(horizontal: false, vertical: true)
    }
}
