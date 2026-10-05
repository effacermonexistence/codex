import SwiftUI
import Charts
import OS1Context

private enum GovernanceMonitorSection: String, CaseIterable, Identifiable {
    case live = "핵심"
    case details = "상세"
    case learning = "학습"
    case accounts = "로그인"
    var id: Self { self }
    /// Segmented-control title. The raw value is the stable key that
    /// `--render-governance-preview` passes in, so it stays untranslated.
    var title: String {
        switch self {
        case .live: return os1Tr("핵심", "Overview")
        case .details: return os1Tr("상세", "Details")
        case .learning: return os1Tr("학습", "Learning")
        case .accounts: return os1Tr("로그인", "Sign-in")
        }
    }
}

struct GovernanceChartPoint: Identifiable {
    let id: Date
    let value: Double
}

// BEGIN GOVERNANCE MONITOR DELTA SAMPLER
/// Observation timestamps describe dashboard calculations, not new trials.
/// An unchanged heartbeat adds no evidence. Missing measurements clear the
/// preceding trace so later points cannot interpolate across an unknown gap.
struct GovernanceMonitorDeltaSampler {
    private(set) var history = GovernanceDeltaHistory()
    private var context = ""
    private var lastEvidence: String?
    static func evidence(_ item: GovernanceComparison?) -> String? {
        guard let item else { return nil }
        return [item.baseline, item.id, String(item.matchedScopes), String(item.measuredScopes),
            String(item.baselineAttempts), String(item.candidateAttempts),
            String(item.measuredBaselineCompletions), String(item.measuredCandidateCompletions),
            String(describing: item.baselineMeanTokens), String(describing: item.candidateMeanTokens),
            String(describing: item.baselineTaskCompletionRate), String(describing: item.candidateTaskCompletionRate),
            String(describing: item.tokenSavings), String(describing: item.taskCompletionDelta),
            String(describing: item.completionEfficiencyDelta), String(describing: item.latencySavings)].joined(separator: "|")
    }
    mutating func observe(context nextContext: String, evidence: String?, at date: Date,
                          tokenSavings: Double?, completionDelta: Double?) {
        guard date.timeIntervalSince1970.isFinite else { return }
        let tokenSavings = tokenSavings.flatMap { $0.isFinite ? $0 : nil }
        let completionDelta = completionDelta.flatMap { $0.isFinite ? $0 : nil }
        if context != nextContext { history = GovernanceDeltaHistory(); lastEvidence = nil; context = nextContext }
        guard let evidence, tokenSavings != nil || completionDelta != nil else {
            history = GovernanceDeltaHistory(); lastEvidence = nil; return
        }
        let identity = evidence + "|" + String(describing: tokenSavings) + "|" + String(describing: completionDelta)
        guard identity != lastEvidence else { return }
        if tokenSavings == nil || completionDelta == nil { history = GovernanceDeltaHistory() }
        history.append(at: date, tokenSavings: tokenSavings, taskCompletionDelta: completionDelta)
        lastEvidence = identity
    }
}
// END GOVERNANCE MONITOR DELTA SAMPLER

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
    @State private var deltaSampler = GovernanceMonitorDeltaSampler()
    @State private var projection: GovernanceDashboardProjection
    @State private var projectionFilterContext = "전체|전체"
    @StateObject private var accounts = BackendAccountsModel()
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
            var sampler = GovernanceMonitorDeltaSampler()
            sampler.observe(context: ["전체", "전체", initialBaseline, initialCandidate].joined(separator: "|"),
                evidence: GovernanceMonitorDeltaSampler.evidence(comparison), at: snapshot.loadedAt,
                tokenSavings: comparison.tokenSavings, completionDelta: comparison.taskCompletionDelta)
            _deltaSampler = State(initialValue: sampler)
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
    private func short(_ route: String) -> String {
        ProviderSurface.displayRouteKey(route).replacingOccurrences(of: " / ", with: " · ")
    }
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
        return value >= 0 ? os1Tr("+\(num(value)) 절약", "+\(num(value)) saved") : os1Tr("\(num(abs(value))) 추가", "\(num(abs(value))) extra")
    }
    private var currentHistoryContext: String { [window, provider, baseline, candidate].joined(separator: "|") }
    private var deltaHistory: GovernanceDeltaHistory { deltaSampler.history }
    /// Cohort label for every token-based figure: matched scopes with usage
    /// measured on both routes, out of all matched scopes. A scope with an
    /// unmeasured attempt is excluded, never priced at zero, so the count is
    /// part of the number.
    private func tokenCohortNote(_ item: GovernanceComparison?) -> String {
        guard let item else { return os1Tr("재시도 묶음 비교 데이터 없음", "No retry-scope comparison data") }
        return item.tokenSavings != nil
            ? os1Tr("실측 \(item.measuredScopes)/\(item.matchedScopes)묶음 · 실패·재시도 포함",
                    "Measured \(item.measuredScopes)/\(item.matchedScopes) scopes · includes failures and retries")
            : (item.measuredScopes == 0 ? os1Tr("matched \(item.matchedScopes)묶음 · 완전 계측 묶음 없음",
                                                "\(item.matchedScopes) matched scopes · no fully metered scope")
                : os1Tr("실측 \(item.measuredScopes)/\(item.matchedScopes)묶음 · 상대 토큰 차이 정의 불가",
                        "Measured \(item.measuredScopes)/\(item.matchedScopes) scopes · relative token difference undefined"))
    }
    private var tokenDeltaEmptyText: String {
        guard let item = selectedComparison else { return os1Tr("재시도 묶음 비교 데이터가 없습니다.", "No retry-scope comparison data.") }
        if item.tokenSavings != nil { return os1Tr("최근 2분 비교 관측 변경 없음 · 현재값은 기존 관측 기반",
                                                   "No comparison observation changes in the last 2 minutes · current value is based on earlier observations") }
        return item.measuredScopes == 0
            ? os1Tr("matched \(item.matchedScopes)묶음 · 모든 시도의 토큰이 측정된 묶음이 없습니다.",
                    "\(item.matchedScopes) matched scopes · no scope has tokens measured for every attempt.")
            : os1Tr("실측 \(item.measuredScopes)묶음 · 기준 토큰이 0이면 상대 차이는 정의되지 않습니다.",
                    "\(item.measuredScopes) measured scopes · the relative difference is undefined when baseline tokens are 0.")
    }
    private func efficiencyCohortNote(_ item: GovernanceComparison?) -> String {
        guard let item else { return os1Tr("채택/1M tok · 실패·재시도 포함", "Adoptions/1M tok · includes failures and retries") }
        if item.completionEfficiencyDelta != nil {
            return os1Tr("채택/1M tok · 실측 \(item.measuredScopes)묶음 · 실패·재시도 포함",
                         "Adoptions/1M tok · \(item.measuredScopes) measured scopes · includes failures and retries")
        }
        if item.measuredScopes == 0 { return os1Tr("채택/1M tok · 완전 계측 묶음 없음", "Adoptions/1M tok · no fully metered scope") }
        return os1Tr("실측 \(item.measuredScopes)묶음 · 0 토큰 분모 또는 기준 채택 0이면 상대 효율 정의 불가",
                     "\(item.measuredScopes) measured scopes · relative efficiency undefined with a 0-token denominator or 0 baseline adoptions")
    }
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
    /// delta charts stay empty until a paired comparison exists; that must not
    /// hide the real-time governance stream. The strip is a fixed window
    /// anchored to the detector tick and zero-filled, so with no task running
    /// the line keeps flowing at zero instead of collapsing to a single dot
    /// (and sparse buckets are never interpolated into a fake ramp).
    /// While a filter change is recomputed off the actor, keep drawing the
    /// last coherent projection under its own window: zeros must never stand
    /// in for data that simply has not been computed yet.
    private var liveActivityWindow: String {
        projectionIsCurrent ? window
            : (projectionFilterContext.split(separator: "|").first.map(String.init) ?? window)
    }
    private var liveActivitySpan: TimeInterval {
        liveActivityWindow == "24시간" ? 86_400 : (liveActivityWindow == "7일" ? 604_800 : 1_800)
    }
    private var liveActivityBucketSeconds: TimeInterval {
        liveActivityWindow == "24시간" ? 900 : (liveActivityWindow == "7일" ? 3_600 : 10)
    }
    /// Display text for a stored period value. The stored value stays the
    /// filter, projection and sampler key; only its label is translated.
    private func windowLabel(_ value: String) -> String {
        switch value {
        case "전체": return os1Tr("전체", "All")
        case "24시간": return os1Tr("24시간", "24 hours")
        case "7일": return os1Tr("7일", "7 days")
        default: return value
        }
    }
    private var liveActivityWindowLabel: String { liveActivityWindow == "전체" ? os1Tr("최근 30분", "Last 30 minutes") : windowLabel(liveActivityWindow) }
    private var liveActivityBucketLabel: String {
        liveActivityWindow == "24시간" ? os1Tr("15분 간격", "15-minute intervals")
            : (liveActivityWindow == "7일" ? os1Tr("1시간 간격", "1-hour intervals") : os1Tr("10초 간격", "10-second intervals"))
    }
    private var liveActivityAxisFormat: Date.FormatStyle {
        liveActivityWindow == "7일" ? .dateTime.month().day() : .dateTime.hour().minute()
    }
    private var liveActivityTickInterval: TimeInterval {
        liveActivityWindow == "24시간" ? 14_400 : (liveActivityWindow == "7일" ? 86_400 : 300)
    }
    private var liveActivityStrip: GovernanceActivityStrip {
        GovernanceActivityStrip.build(tasks: projection.tasks, until: refreshed, span: liveActivitySpan,
                                      bucketSeconds: liveActivityBucketSeconds)
    }
    /// The delta traces are session-local one-second replots; give them the
    /// same rolling window treatment, anchored to the current tick.
    private var deltaWindowSeconds: TimeInterval { TimeInterval(deltaHistory.capacity) }

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
                // Polling updates the clock/activity strip, not trial count.
                // The sampler records only changed comparison evidence.
                if projectionIsCurrent {
                    recordDeltaPoint(at: refreshed)
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
            deltaSampler = GovernanceMonitorDeltaSampler()
            if projectionIsCurrent { recordDeltaPoint(at: refreshed) }
        }
    }
    private func recordDeltaPoint(at date: Date) {
        deltaSampler.observe(context: currentHistoryContext,
            evidence: GovernanceMonitorDeltaSampler.evidence(selectedComparison), at: date,
            tokenSavings: selectedComparison?.tokenSavings, completionDelta: taskCompletionDelta)
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
                Text("ACTIVITY MONITOR  /  OPENAI + ANTHROPIC").font(.system(size: 10, weight: .medium, design: .monospaced)).tracking(1.1).foregroundStyle(muted)
            }
            Spacer()
            if !preview { heartbeatTrace(width: 72, height: 18) }
            Circle().fill(green)
                .frame(width: 6, height: 6)
                .scaleEffect(preview ? 1 : (heartbeatPulse ? 1.45 : 0.8))
                .opacity(preview ? 1 : (heartbeatPulse ? 1 : 0.5))
            Text(preview ? os1Tr("읽기 전용 미리보기", "Read-only preview")
                 : os1Tr("영수증 조회 · 1초 polling · Δ는 관측 변경 시만 기록", "Receipt lookup · 1s polling · Δ recorded only when observations change"))
                .font(.system(size: 11)).foregroundStyle(green)
            Button { if let onClose { onClose() } else { dismiss() } } label: { Image(systemName: "xmark").frame(width: 26, height: 26) }
                .buttonStyle(.plain).accessibilityLabel("Close governance monitor")
        }.padding(24).frame(maxWidth: .infinity)
    }
    private var heartbeatPulse: Bool {
        Int(refreshed.timeIntervalSince1970) % 2 == 0
    }
    /// A detector heartbeat, deliberately separate from task telemetry. It
    /// proves the one-second polling loop is alive without fabricating work.
    private func heartbeatTrace(width: CGFloat, height: CGFloat) -> some View {
        let phase = CGFloat(Int(refreshed.timeIntervalSince1970) % 12) / 11
        return Canvas { context, size in
            let mid = size.height / 2
            let pulseX = max(12, min(size.width - 12, size.width * phase))
            var path = Path()
            path.move(to: CGPoint(x: 0, y: mid))
            path.addLine(to: CGPoint(x: max(0, pulseX - 11), y: mid))
            path.addLine(to: CGPoint(x: max(0, pulseX - 6), y: mid - 3))
            path.addLine(to: CGPoint(x: pulseX - 2, y: size.height - 2))
            path.addLine(to: CGPoint(x: pulseX + 2, y: 2))
            path.addLine(to: CGPoint(x: min(size.width, pulseX + 6), y: mid + 3))
            path.addLine(to: CGPoint(x: min(size.width, pulseX + 11), y: mid))
            path.addLine(to: CGPoint(x: size.width, y: mid))
            context.stroke(path, with: .color(green.opacity(0.88)),
                           style: StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round))
        }
        .frame(width: width, height: height)
        .accessibilityElement()
        .accessibilityLabel(os1Tr("1초 감지 heartbeat", "1-second detection heartbeat"))
        .accessibilityValue(refreshed.formatted(date: .omitted, time: .standard))
    }
    private var controls: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 16) {
                Picker(os1Tr("화면", "View"), selection: $section) {
                    ForEach(GovernanceMonitorSection.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 380)
                Spacer()
                if section != .accounts {
                    Picker(os1Tr("기간", "Period"), selection: $window) { ForEach(["전체", "24시간", "7일"], id: \.self) { Text(windowLabel($0)) } }.frame(width: 155)
                    Picker(os1Tr("제공자", "Provider"), selection: $provider) { Text(os1Tr("전체", "All")).tag("전체"); Text("OpenAI").tag("codex"); Text("Anthropic").tag("claude") }.frame(width: 190)
                }
            }
            if section != .accounts, !rows.isEmpty {
                HStack(spacing: 10) {
                    Text(os1Tr("기준", "Baseline")).font(.system(size: 10, weight: .semibold)).foregroundStyle(muted)
                    Picker(os1Tr("운영 기준 경로", "Operating baseline route"), selection: $baseline) {
                        ForEach(rows.filter { $0.attempts > 0 }) { row in Text(short(row.id)).tag(row.id) }
                    }.labelsHidden().frame(maxWidth: 390)
                    Image(systemName: "arrow.right").foregroundStyle(muted)
                    Text(os1Tr("비교", "Comparison")).font(.system(size: 10, weight: .semibold)).foregroundStyle(muted)
                    Picker(os1Tr("비교 경로", "Comparison route"), selection: $candidate) {
                        if comparisons.isEmpty { Text(os1Tr("matched 기록 없음", "No matched records")).tag("") }
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
            DisclosureGroup(os1Tr("모델 비교 · 과거 matched 관측", "Model comparison · past matched observations")) { comparisonWorkbench; comparePanel }
            tracePanel
            methodology
        case .learning:
            learningLoop
            learningTrend
            learningRoutes
        case .accounts:
            BackendAccountsPanel(model: accounts, dark: true, readOnly: preview)
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
            compactCard(os1Tr("전달 채택률", "Delivery adoption rate"), percent(taskCompletionRate),
                        os1Tr("채택 \(completed) / 종료 \(terminal.count) · 목표 성공과 별개",
                              "Adopted \(completed) / finished \(terminal.count) · separate from goal success"), color: green)
            compactCard(os1Tr("목표 검증 성공률", "Goal verification success rate"), percent(quality.rate),
                        os1Tr("목표 판정 \(quality.eligible - quality.unknown)/\(quality.eligible)건 · 미판정은 —",
                              "Goal verdicts \(quality.eligible - quality.unknown)/\(quality.eligible) · unjudged is —"), color: green)
            compactCard(os1Tr("운영 토큰 차이 Δ", "Operating token difference Δ"), delta(selectedComparison?.tokenSavings),
                        tokenCohortNote(selectedComparison),
                        color: (selectedComparison?.tokenSavings ?? 0) >= 0 ? green : pink)
            compactCard(os1Tr("요청 묶음 채택 Δ", "Request-scope adoption Δ"), percentagePoints(taskCompletionDelta),
                        os1Tr("과거 재시도 묶음 · \(percent(selectedComparison?.baselineTaskCompletionRate)) → \(percent(selectedComparison?.candidateTaskCompletionRate))",
                              "Past retry scopes · \(percent(selectedComparison?.baselineTaskCompletionRate)) → \(percent(selectedComparison?.candidateTaskCompletionRate))"),
                        color: (taskCompletionDelta ?? 0) >= 0 ? green : pink)
            compactCard(os1Tr("운영 채택/토큰 Δ", "Operating adoptions/token Δ"), delta(completionEfficiencyDelta),
                        efficiencyCohortNote(selectedComparison),
                        color: (completionEfficiencyDelta ?? 0) >= 0 ? green : pink)
        }
    }
    private var deltaCharts: some View {
        HStack(alignment: .top, spacing: 12) {
            deltaChart(title: os1Tr("과거 운영 토큰 차이 Δ", "Past operating token difference Δ"), current: delta(selectedComparison?.tokenSavings), unit: "%",
                       note: tokenCohortNote(selectedComparison) + os1Tr(" · 변경 관측 · 인과적 절약 아님", " · changed observations · not causal savings"), points: tokenDeltaPoints,
                       color: (selectedComparison?.tokenSavings ?? 0) >= 0 ? green : pink,
                       emptyText: tokenDeltaEmptyText)
            deltaChart(title: os1Tr("과거 요청 묶음 채택 Δ", "Past request-scope adoption Δ"), current: percentagePoints(taskCompletionDelta), unit: "pp",
                       note: os1Tr("순차 재시도 묶음 · 독립 A/B·정확도 향상 아님",
                                   "Sequential retry scopes · not an independent A/B or accuracy gain"), points: completionDeltaPoints,
                       color: (taskCompletionDelta ?? 0) >= 0 ? green : pink)
        }
    }
    private var liveActivityChart: some View {
        let strip = liveActivityStrip
        let points = strip.points
        let startedEvents = points.filter { $0.started > 0 }
        let finishedEvents = points.filter { $0.finished > 0 }
        let maxValue = max(1, strip.maxValue)
        let axisFormat = liveActivityAxisFormat
        let axisTicks = GovernanceActivityStrip.axisTicks(from: strip.start, to: strip.end, every: liveActivityTickInterval,
                                                          edgeMargin: liveActivitySpan * 0.04)
        return VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(os1Tr("실시간 거버넌스 활동", "Live governance activity")).font(.system(size: 12, weight: .semibold))
                    Text(os1Tr("작업 시작·종료 영수증 · \(liveActivityWindowLabel) · \(liveActivityBucketLabel) · 작업이 없으면 0으로 흐름",
                               "Task start/finish receipts · \(liveActivityWindowLabel) · \(liveActivityBucketLabel) · flows at 0 when there are no tasks"))
                        .font(.system(size: 9)).foregroundStyle(muted)
                }
                Spacer()
                HStack(spacing: 7) {
                    heartbeatTrace(width: 92, height: 18)
                    Text(os1Tr("감지 \(refreshed.formatted(date: .omitted, time: .standard))",
                               "Detected \(refreshed.formatted(date: .omitted, time: .standard))"))
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(green)
                }
                HStack(spacing: 10) {
                    Label(os1Tr("시작", "Started"), systemImage: "circle.fill").foregroundStyle(green)
                    Label(os1Tr("종료", "Finished"), systemImage: "circle.fill").foregroundStyle(pink)
                }.font(.system(size: 9, weight: .medium))
            }
            Chart {
                RuleMark(y: .value(os1Tr("기준", "Baseline"), 0))
                    .foregroundStyle(Color.white.opacity(0.16))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                // Explicit series: without them Swift Charts joined the start
                // and finish values into one zig-zag line.
                ForEach(points) { point in
                    AreaMark(x: .value(os1Tr("시간", "Time"), point.id), y: .value(os1Tr("시작", "Started"), point.started),
                             series: .value(os1Tr("계열", "Series"), os1Tr("시작", "Started")))
                        .foregroundStyle(LinearGradient(colors: [green.opacity(0.2), green.opacity(0.01)],
                                                        startPoint: .top, endPoint: .bottom))
                    LineMark(x: .value(os1Tr("시간", "Time"), point.id), y: .value(os1Tr("시작", "Started"), point.started),
                             series: .value(os1Tr("계열", "Series"), os1Tr("시작", "Started")))
                        .foregroundStyle(green)
                        .lineStyle(StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
                    LineMark(x: .value(os1Tr("시간", "Time"), point.id), y: .value(os1Tr("종료", "Finished"), point.finished),
                             series: .value(os1Tr("계열", "Series"), os1Tr("종료", "Finished")))
                        .foregroundStyle(pink)
                        .lineStyle(StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
                }
                ForEach(startedEvents) { point in
                    PointMark(x: .value(os1Tr("시간", "Time"), point.id), y: .value(os1Tr("시작", "Started"), point.started))
                        .foregroundStyle(green).symbolSize(30)
                }
                ForEach(finishedEvents) { point in
                    PointMark(x: .value(os1Tr("시간", "Time"), point.id), y: .value(os1Tr("종료", "Finished"), point.finished))
                        .foregroundStyle(pink).symbolSize(30)
                }
            }
            .chartXScale(domain: strip.start...strip.end)
            .chartYScale(domain: 0...maxValue + 1)
            .chartXAxis {
                AxisMarks(values: axisTicks) { _ in
                    AxisGridLine().foregroundStyle(Color.white.opacity(0.06))
                    AxisValueLabel(format: axisFormat)
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
            .accessibilityElement()
            .accessibilityLabel(os1Tr("실시간 거버넌스 활동 스트립", "Live governance activity strip"))
            .accessibilityValue(os1Tr("\(liveActivityWindowLabel) · 샘플 \(points.count)개 · 시작 \(Int(strip.startedTotal))건 · 종료 \(Int(strip.finishedTotal))건 · 마지막 \(refreshed.formatted(date: .omitted, time: .standard))",
                                      "\(liveActivityWindowLabel) · \(points.count) samples · \(Int(strip.startedTotal)) started · \(Int(strip.finishedTotal)) finished · last \(refreshed.formatted(date: .omitted, time: .standard))"))
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
                            points: [GovernanceChartPoint], color: Color,
                            emptyText: String = os1Tr("비교 가능한 실측 델타가 없습니다.", "No comparable measured delta.")) -> some View {
        let windowEnd = refreshed
        let windowStart = windowEnd.addingTimeInterval(-deltaWindowSeconds)
        let visible = points.filter { $0.id >= windowStart && $0.id <= windowEnd }
        return VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(size: 12, weight: .semibold))
                    Text(note).font(.system(size: 9)).foregroundStyle(muted)
                }
                Spacer()
                Text(current).font(.system(size: 22, weight: .semibold, design: .rounded))
                    .monospacedDigit().foregroundStyle(color)
            }
            if visible.isEmpty {
                VStack(spacing: 7) {
                    Image(systemName: "chart.xyaxis.line").font(.system(size: 24)).foregroundStyle(muted.opacity(0.55))
                    Text(points.isEmpty ? emptyText : os1Tr("최근 2분에 비교 관측 변경 없음 · 현재값은 마지막 영수증 계산",
                                                            "No comparison observation changes in the last 2 minutes · current value is from the last receipt calculation"))
                        .font(.system(size: 10)).foregroundStyle(muted)
                        .multilineTextAlignment(.center).padding(.horizontal, 24)
                }
                .frame(maxWidth: .infinity, minHeight: 155)
            } else {
                let deltaTicks = GovernanceActivityStrip.axisTicks(from: windowStart, to: windowEnd, every: 30,
                                                                   edgeMargin: deltaWindowSeconds * 0.04)
                Chart {
                    RuleMark(y: .value(os1Tr("기준", "Baseline"), 0))
                        .foregroundStyle(Color.white.opacity(0.16))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    ForEach(visible) { point in
                        LineMark(x: .value(os1Tr("시간", "Time"), point.id), y: .value(os1Tr("델타", "Delta"), point.value))
                            .interpolationMethod(.stepEnd)
                            .foregroundStyle(color)
                            .lineStyle(StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
                        AreaMark(x: .value(os1Tr("시간", "Time"), point.id), yStart: .value(os1Tr("기준", "Baseline"), 0), yEnd: .value(os1Tr("델타", "Delta"), point.value))
                            .interpolationMethod(.stepEnd)
                            .foregroundStyle(LinearGradient(colors: [color.opacity(0.24), color.opacity(0.015)], startPoint: .top, endPoint: .bottom))
                    }
                    if let last = visible.last {
                        PointMark(x: .value(os1Tr("현재 시간", "Current time"), last.id), y: .value(os1Tr("현재 델타", "Current delta"), last.value))
                            .foregroundStyle(color).symbolSize(34)
                    }
                }
                .chartXScale(domain: windowStart...windowEnd)
                .chartYScale(domain: chartDomain(points))
                .chartXAxis {
                    AxisMarks(values: deltaTicks) { _ in
                        AxisGridLine().foregroundStyle(Color.white.opacity(0.06))
                        AxisValueLabel(format: .dateTime.hour().minute().second())
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
            compactCard(os1Tr("전달 채택률", "Delivery adoption rate"), percent(taskCompletionRate),
                        os1Tr("채택 \(completed)/종료 \(terminal.count)건",
                              "Adopted \(completed)/finished \(terminal.count)"), color: green)
            compactCard(os1Tr("채택 · 재질문 미기록", "Adopted · no re-ask recorded"), terminal.isEmpty ? "—" : os1Tr("\(firstPass)건", "\(firstPass)"),
                        os1Tr("목표 성공 판정 아님", "Not a goal-success verdict"))
            compactCard(os1Tr("재질문 기록", "Re-asks recorded"), terminal.isEmpty ? "—" : os1Tr("\(retried)건", "\(retried)"),
                        os1Tr("최종 채택과 별개", "Separate from final adoption"))
            compactCard(os1Tr("관측 시간당 채택", "Adoptions per observed hour"), decimal(observedHours >= 1 ? Double(completed) / observedHours : nil),
                        os1Tr("관측 1시간 이후 · 속도 인과 대조 아님", "After 1 observed hour · not a causal speed comparison"))
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
                Text(os1Tr("실행 중 \(active.count)  ·  실행 큐 대기 \(queued)",
                           "Running \(active.count)  ·  Queued \(queued)")).font(.system(size: 12, weight: .medium))
                Spacer()
                Text(os1Tr("마지막 갱신 \(refreshed.formatted(date: .omitted, time: .standard))",
                           "Last updated \(refreshed.formatted(date: .omitted, time: .standard))")).font(.system(size: 10, design: .monospaced)).foregroundStyle(muted)
            }
            ForEach(Array(active.enumerated()), id: \.offset) { _, label in Text(label).font(.system(size: 11)).foregroundStyle(pink) }
            if tasks.contains(where: { !$0.isTerminal }) {
                Text(os1Tr("미종료 영수증 \(tasks.filter { !$0.isTerminal }.count)건 · 중단·미확정 기록은 완료로 계산하지 않습니다.",
                           "\(tasks.filter { !$0.isTerminal }.count) unfinished receipts · interrupted or unconfirmed records are not counted as complete.")).font(.system(size: 10)).foregroundStyle(muted)
            }
        }.padding(13).background(green.opacity(0.045), in: RoundedRectangle(cornerRadius: 10))
    }
    private var taskMonitorTable: some View {
        panel(os1Tr("실행 프로세스", "Processes"),
              subtitle: os1Tr("최근 작업 · 행을 누르면 실제 시도·토큰 영수증을 확인",
                              "Recent tasks · click a row to see its actual attempt and token receipts")) {
            ScrollView(.horizontal, showsIndicators: false) {
                VStack(spacing: 0) {
                    taskHeader
                    Divider().overlay(Color.white.opacity(0.09))
                    if recentTasks.isEmpty {
                        Text(os1Tr("신규 계측 이후 작업 기록이 없습니다.", "No task records since the new metering was added."))
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
            tableText(os1Tr("시간", "Time"), width: 72)
            tableText(os1Tr("작업", "Task"), width: 105)
            tableText(os1Tr("실행 경로", "Route"), width: 82)
            tableText(os1Tr("모델", "Model"), width: 168)
            tableText(os1Tr("추론", "Reasoning"), width: 70)
            tableText(os1Tr("상태", "Status"), width: 96)
            tableText(os1Tr("토큰", "Tokens"), width: 92, alignment: .trailing)
            tableText(os1Tr("시간", "Duration"), width: 78, alignment: .trailing)
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
                tableText(ProviderSurface.resolveExecuted(rawSurface: attempt?.surface, provider: attempt?.provider)?.displayName ?? "OS-1", width: 82)
                    .help(attempt?.displayRoute ?? task.displayRoute)
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
        if !task.isTerminal { return (os1Tr("영수증 대기", "Awaiting receipt"), .yellow) }
        if task.isFirstPass { return (os1Tr("채택 · 재질문 미기록", "Adopted · no re-ask recorded"), green) }
        if task.isAdopted { return (os1Tr("재질문 후 채택", "Adopted after re-ask"), .yellow) }
        if task.disposition == "cancelled" { return (os1Tr("취소", "Cancelled"), muted) }
        return (os1Tr("미채택", "Not adopted"), .red.opacity(0.85))
    }
    private func taskDuration(_ task: GovernanceTask) -> String {
        guard let end = task.endedAt else { return "—" }
        let seconds = max(0, end.timeIntervalSince(task.startedAt))
        return seconds >= 60 ? String(format: "%.1fm", seconds / 60) : String(format: "%.1fs", seconds)
    }
    private func selectedTaskInspector(_ task: GovernanceTask) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text(os1Tr("선택 작업 · \(task.id)", "Selected task · \(task.id)")).font(.system(size: 11, weight: .semibold, design: .monospaced)).textSelection(.enabled)
                Spacer()
                Text(os1Tr("총 \(task.attempts.count)회 시도 · \(task.tokens.map(num) ?? "미측정") tok",
                           "\(task.attempts.count) attempts total · \(task.tokens.map(num) ?? "unmeasured") tok"))
                    .font(.system(size: 10, design: .monospaced)).foregroundStyle(muted)
            }
            ForEach(task.attempts, id: \.id) { attempt in
                HStack(spacing: 12) {
                    Text(short(attempt.displayRoute)).frame(maxWidth: .infinity, alignment: .leading)
                    Text(attempt.observation?.outcome.rawValue ?? os1Tr("진행 중", "In progress"))
                    Text(attempt.observation.flatMap(GovernanceSnapshot.tokens).map { "\(num($0)) tok" } ?? os1Tr("토큰 미측정", "Tokens unmeasured"))
                    Text(attempt.observation.map { String(format: "%.1fs", Double($0.durationMS) / 1000) } ?? "—")
                }
                .font(.system(size: 9, design: .monospaced)).foregroundStyle(muted)
            }
        }
        .padding(12).background(green.opacity(0.035), in: RoundedRectangle(cornerRadius: 8))
    }
    // MARK: - 학습: what routing learned from every task (route learning v38)

    private var learningLoop: some View {
        panel(os1Tr("경로 선택과 운영 장부", "Route selection and operations ledger"),
              subtitle: os1Tr("운영 관측 · 모델 가중치 학습이나 성능 향상 증명 아님",
                              "Operating observations · not model-weight training or proof of improved performance")) {
            VStack(alignment: .leading, spacing: 6) {
                learningStep("1", os1Tr("선택", "Select"),
                             os1Tr("정책·설정·가용 경로를 기준으로 백엔드·모델·추론 강도를 선택합니다.",
                                   "Chooses the backend, model and reasoning effort based on policy, settings and available routes."))
                learningStep("2", os1Tr("실측", "Measure"),
                             os1Tr("실제 호출의 토큰·기록된 실행시간·종료/채택 영수증을 수집합니다.",
                                   "Collects tokens from actual calls, recorded run times and finish/adoption receipts."))
                learningStep("3", os1Tr("기록", "Record"),
                             os1Tr("실행한 경로의 운영 기록입니다. 전달 채택은 목표 성공·정확도 판정과 다릅니다.",
                                   "The operating record of the routes that ran. Delivery adoption differs from goal-success or accuracy verdicts."))
                learningStep("4", os1Tr("라우터 점수", "Router score"),
                             os1Tr("서버의 가중·감쇠·로그 평균 휴리스틱은 별도 선택 점수이며 이 화면의 원실측량이 아닙니다.",
                                   "The server's weighting, decay and log-mean heuristics are a separate selection score, not the raw measurements on this screen."))
                learningStep("5", os1Tr("성과 검증", "Outcome check"),
                             os1Tr("고정된 off/on 대조와 목표 판정 영수증이 없으면 RCC의 인과적 성과 향상은 미측정입니다.",
                                   "Without a fixed off/on comparison and goal-verdict receipts, RCC's causal performance gain is unmeasured."))
            }
            Text(os1Tr("표시는 실제 입력+출력 토큰입니다. 캐시는 입력에 이미 포함되어 다시 더하지 않고, 미측정은 —입니다. 경로 표본은 채택·품질 실패·타임아웃·가용성 실패만 포함하므로 전체 청구 합계와 분모가 다릅니다. 시간은 영수증의 시도 실행구간이며 GUI·정책·라우팅·큐 전체 지연이 아닙니다.",
                       "Figures are actual input+output tokens. Cache is already included in input and is not added again; unmeasured is —. Route samples include only adoptions, quality failures, timeouts and availability failures, so their denominator differs from the total billed. Time is the attempt run interval from the receipt, not the full GUI, policy, routing and queue latency."))
                .font(.system(size: 10)).foregroundStyle(muted).fixedSize(horizontal: false, vertical: true)
        }
    }
    private func learningStep(_ index: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(index).font(.system(size: 10, weight: .bold, design: .monospaced)).foregroundStyle(green).frame(width: 12)
            Text(title).font(.system(size: 11, weight: .semibold)).frame(width: 64, alignment: .leading)
            Text(detail).font(.system(size: 11)).foregroundStyle(Color(white: 0.8)).fixedSize(horizontal: false, vertical: true)
        }
    }
    private var learningTrendValues: [GovernanceLearningTrend] { GovernanceLearning.trends(snapshot, now: refreshed) }
    /// "previous → recent" coloured by direction, or the recent value alone
    /// when either week is too thin to compare.
    private func trendChange(_ recent: Double?, _ previous: Double?, comparable: Bool,
                             format: (Double) -> String, lowerIsBetter: Bool) -> (String, Color) {
        guard let recent else { return ("—", muted) }
        guard comparable, let previous, previous > 0 else { return (format(recent), .white) }
        let better = lowerIsBetter ? recent < previous : recent > previous
        return ("\(format(previous)) → \(format(recent))", recent == previous ? .white : (better ? green : pink))
    }
    private var learningTrend: some View {
        let trends = learningTrendValues
        return panel(os1Tr("기간별 운영 관측", "Operating observations by period"),
                     subtitle: os1Tr("백엔드별 두 7일 구간 · 작업 구성 미통제 · 독립 성능 대조 아님 · 최소 \(GovernanceLearning.minimumTrendSamples)건",
                                     "Two 7-day windows per backend · task mix not controlled · not an independent performance comparison · at least \(GovernanceLearning.minimumTrendSamples) samples")) {
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 10) {
                GridRow {
                    Text(os1Tr("백엔드", "Backend")); Text(os1Tr("전달 채택률", "Delivery adoption rate")); Text(os1Tr("채택당 실측 토큰", "Measured tokens per adoption")); Text(os1Tr("채택당 시도 시간", "Attempt time per adoption")); Text(os1Tr("시도 (전 → 최근)", "Attempts (previous → recent)"))
                }.font(.system(size: 10)).foregroundStyle(muted)
                ForEach(trends, id: \.provider) { trend in
                    let completion = trendChange(trend.recent.completionRate, trend.previous.completionRate,
                                                 comparable: trend.completionComparable,
                                                 format: { String(format: "%.0f%%", $0 * 100) }, lowerIsBetter: false)
                    let tokens = trendChange(trend.recent.tokensPerCompletion, trend.previous.tokensPerCompletion,
                                             comparable: trend.tokensComparable, format: { tokenLabel($0) }, lowerIsBetter: true)
                    let seconds = trendChange(trend.recent.secondsPerCompletion, trend.previous.secondsPerCompletion,
                                              comparable: trend.secondsComparable,
                                              format: { String(format: "%.0fs", $0) }, lowerIsBetter: true)
                    GridRow {
                        Text(trend.provider == "claude" ? "Anthropic" : "OpenAI")
                            .foregroundStyle(trend.provider == "claude" ? pink : green)
                        Text(completion.0).foregroundStyle(completion.1)
                        Text(tokens.0).foregroundStyle(tokens.1)
                        Text(seconds.0).foregroundStyle(seconds.1)
                        Text("\(trend.previous.attempts) → \(trend.recent.attempts)").foregroundStyle(muted)
                    }.font(.system(size: 11, design: .monospaced)).monospacedDigit()
                }
            }
            if trends.isEmpty { Text(os1Tr("최근 14일에 경로 기록이 없습니다.", "No route records in the last 14 days.")).font(.system(size: 12)).foregroundStyle(muted) }
            Text(os1Tr("같은 제공자의 서술적 기간 비교입니다. 모델·추론 강도·작업·지침·입력 크기와 실패 구성은 통제하지 않았습니다. 초록/분홍은 숫자의 유리/불리 방향일 뿐 RCC 성능 향상이나 원인을 증명하지 않습니다.",
                       "A descriptive period comparison within the same provider. Model, reasoning effort, tasks, instructions, input size and failure mix were not controlled. Green/pink only mark the favorable/unfavorable direction of a number; they do not prove an RCC performance gain or its cause."))
                .font(.system(size: 10)).foregroundStyle(muted).fixedSize(horizontal: false, vertical: true)
        }
    }
    private func tokenLabel(_ value: Double) -> String {
        value >= 1_000_000 ? String(format: "%.2fM", value / 1_000_000)
            : value >= 1_000 ? String(format: "%.0fk", value / 1_000) : String(format: "%.0f", value)
    }
    private var learningRouteRows: [GovernanceLearningRoute] {
        GovernanceLearning.routes(snapshot, since: since, provider: provider == "전체" ? nil : provider)
    }
    private var learningRoutes: some View {
        let rows = learningRouteRows
        let leaders = GovernanceLearning.leaders(rows)
        return panel(os1Tr("경로별 운영 비용", "Operating cost by route"),
                     subtitle: os1Tr("계측된 적격 관측 · ★ 채택당 토큰이 가장 적게 관측된 경로(3회 이상), 최적 경로 증명 아님",
                                     "Metered eligible observations · ★ route with the fewest observed tokens per adoption (3+ attempts), not proof of the best route")) {
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 10) {
                GridRow {
                    Text(os1Tr("경로", "Route")); Text(os1Tr("시도", "Attempts")); Text(os1Tr("전달 채택률", "Delivery adoption rate")); Text(os1Tr("시도당 실측 토큰", "Measured tokens per attempt")); Text(os1Tr("채택당 토큰", "Tokens per adoption")); Text(os1Tr("채택당 시도 시간", "Attempt time per adoption"))
                }.font(.system(size: 10)).foregroundStyle(muted)
                ForEach(rows) { row in
                    GridRow {
                        HStack(spacing: 5) {
                            Text(leaders[row.provider] == row.id ? "★" : " ").foregroundStyle(green).frame(width: 10)
                            Text(short(row.id)).foregroundStyle(row.provider == "claude" ? pink : green)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                        Text("\(row.attempts)")
                        Text(percent(row.completionRate))
                        Text(row.tokensPerAttempt.map(tokenLabel) ?? "—")
                        Text(row.tokensPerCompletion.map(tokenLabel) ?? "—")
                        Text(row.meanSecondsCompleted.map { String(format: "%.0fs", $0) } ?? "—")
                    }.font(.system(size: 11, design: .monospaced)).monospacedDigit()
                }
            }
            if rows.isEmpty { Text(os1Tr("선택한 기간에 경로 기록이 없습니다.", "No route records in the selected period.")).font(.system(size: 12)).foregroundStyle(muted) }
        }
    }

    private func panel<Content: View>(_ title: String, subtitle: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.system(size: 14, weight: .semibold))
            Text(subtitle).font(.system(size: 10)).foregroundStyle(muted)
            content()
        }.padding(16).background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 12))
    }
    private var completionChart: some View {
        panel(os1Tr("운영 채택 관측", "Operating adoption observations"),
              subtitle: os1Tr("종료/채택 영수증 · 목표 정확도나 독립 성능 대조 아님",
                              "Finish/adoption receipts · not goal accuracy or an independent performance comparison")) {
            HStack(spacing: 10) {
                deltaCard(os1Tr("현재 전달 채택률", "Current delivery adoption rate"), percent(taskCompletionRate),
                          os1Tr("채택 \(completed) / 종료 \(terminal.count)",
                                "Adopted \(completed) / finished \(terminal.count)"), green)
                deltaCard(os1Tr("기준→비교", "Baseline→comparison"), percentagePoints(taskCompletionDelta),
                          os1Tr("순차 재시도 묶음의 채택 관측", "Adoption observed in sequential retry scopes"), (taskCompletionDelta ?? 0) >= 0 ? green : pink)
                deltaCard(os1Tr("채택당 토큰", "Tokens per adoption"), tokensPerCompletedTask.map { num(Int($0)) + os1Tr(" tok/채택", " tok/adoption") } ?? "—",
                          os1Tr("실측 토큰·재시도 비용 포함", "Includes measured tokens and retry costs"), green)
            }
        }
    }
    private var routeTable: some View {
        panel(os1Tr("실행 경로 비교", "Route comparison"),
              subtitle: os1Tr("모델명 + reasoning effort · 서로 다른 백엔드로 재시도한 작업은 mixed로 별도 계산",
                              "Model name + reasoning effort · tasks retried on different backends are counted separately as mixed")) {
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 11) {
                GridRow {
                    Text(os1Tr("모델 / 추론 강도", "Model / reasoning effort")); Text(os1Tr("시도", "Attempts")); Text(os1Tr("시도 채택률", "Attempt adoption rate")); Text(os1Tr("평균 실측 토큰", "Mean measured tokens")); Text(os1Tr("시도 실행시간", "Attempt run time")); Text(os1Tr("종료 채택률", "Finished adoption rate")); Text(os1Tr("채택/1M", "Adoptions/1M"))
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
            if rows.isEmpty { Text(os1Tr("선택한 기간의 기록이 없습니다.", "No records in the selected period.")).font(.system(size: 12)).foregroundStyle(muted) }
        }
    }
    private var comparisonWorkbench: some View {
        panel(os1Tr("모델 설정 가정 투영", "Hypothetical model-setting projection"),
              subtitle: os1Tr("과거 재시도 묶음 평균 × 가정 수량 · 미래 실측·LIVE 실행·RCC 인과 향상 아님",
                              "Past retry-scope means × assumed quantity · not a future measurement, a LIVE run or a causal RCC gain")) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    Text(os1Tr("기준", "Baseline")).font(.system(size: 10, weight: .semibold)).foregroundStyle(muted)
                    Picker(os1Tr("기준 경로", "Baseline route"), selection: $baseline) {
                        if baseline.isEmpty { Text(os1Tr("기록 없음", "No records")).tag("") }
                        ForEach(rows.filter { $0.attempts > 0 }) { row in Text(short(row.id)).tag(row.id) }
                    }.labelsHidden().frame(maxWidth: 390)
                    Image(systemName: "arrow.right").foregroundStyle(muted)
                    Text(os1Tr("가정", "Assumed")).font(.system(size: 10, weight: .semibold)).foregroundStyle(muted)
                    Picker(os1Tr("가정 경로", "Assumed route"), selection: $candidate) {
                        Text(os1Tr("비교 기록 없음", "No comparison records")).tag("")
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
                    Text(os1Tr("가정 작업 수", "Assumed task count")).font(.system(size: 10, weight: .semibold)).foregroundStyle(muted)
                    Picker(os1Tr("가정 작업 수", "Assumed task count"), selection: $scenarioTasks) {
                        ForEach([10, 100, 500, 1_000], id: \.self) { Text("\($0)").tag($0) }
                    }
                    .pickerStyle(.segmented).labelsHidden().frame(width: 290)
                    Spacer()
                    Text(os1Tr("과거 관측 기반 가정", "Assumption from past observations"))
                        .font(.system(size: 9, weight: .bold, design: .monospaced)).foregroundStyle(.yellow)
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .background(Color.yellow.opacity(0.09), in: Capsule())
                }
                if let item = selectedComparison {
                    HStack(spacing: 10) {
                        card(os1Tr("가정 토큰 차이", "Assumed token difference"), projectedDeltaText(projectedTokenDifference),
                             os1Tr("\(scenarioTasks)개 요청 가정 · 실측 \(item.measuredScopes)/\(item.matchedScopes)묶음 · \(delta(item.tokenSavings))",
                                   "\(scenarioTasks) requests assumed · measured \(item.measuredScopes)/\(item.matchedScopes) scopes · \(delta(item.tokenSavings))"), color: (projectedTokenDifference ?? 0) >= 0 ? green : pink)
                        card(os1Tr("시도 채택률 변화", "Attempt adoption rate change"), String(format: "%+.1fpp", item.adoptionDelta * 100),
                             os1Tr("\(item.matchedScopes)묶음 · 목표 성공과 구별",
                                   "\(item.matchedScopes) scopes · distinct from goal success"), color: item.adoptionDelta >= 0 ? green : pink)
                        card(os1Tr("관측 시도시간 차이", "Observed attempt time difference"), delta(item.latencySavings),
                             os1Tr("과거 실행구간만 · 미래 GUI 속도 예측 아님",
                                   "Past run intervals only · not a forecast of future GUI speed"), color: (item.latencySavings ?? 0) >= 0 ? green : pink)
                    }
                    HStack(spacing: 18) {
                        Text(os1Tr("기준 \(short(item.baseline)) · \(item.baselineAttempts)회",
                                   "Baseline \(short(item.baseline)) · \(item.baselineAttempts) attempts"))
                        Text(os1Tr("가정 \(short(item.id)) · \(item.candidateAttempts)회",
                                   "Assumed \(short(item.id)) · \(item.candidateAttempts) attempts"))
                        Spacer()
                            Text(os1Tr("재시도 묶음 채택률 \(percent(item.baselineTaskCompletionRate)) → \(percent(item.candidateTaskCompletionRate))",
                                       "Retry-scope adoption rate \(percent(item.baselineTaskCompletionRate)) → \(percent(item.candidateTaskCompletionRate))"))
                    }
                    .font(.system(size: 9, design: .monospaced)).foregroundStyle(muted)
                    Text(os1Tr("가정값은 양쪽 토큰이 모두 실측된 matched scope(\(item.measuredScopes)/\(item.matchedScopes)묶음)의 경로별 절대 평균 토큰을 \(scenarioTasks)배한 단순 투영입니다. 미측정 묶음은 0이 아니라 제외이며, 작업 구성·순서·선택 편향을 제거하지 않고 실행을 자동으로 시작하지 않습니다.",
                               "The assumed values are a simple projection: each route's absolute mean tokens over matched scopes whose tokens were measured on both sides (\(item.measuredScopes)/\(item.matchedScopes) scopes), multiplied by \(scenarioTasks). Unmeasured scopes are excluded, not counted as 0; task mix, order and selection bias are not removed, and no run is started automatically."))
                        .font(.system(size: 9)).foregroundStyle(muted)
                } else {
                    Text(os1Tr("같은 provider의 여러 경로가 동일 요청 묶음에서 관측되면\n모델·reasoning effort를 눌러 토큰·채택률·지연 가정을 볼 수 있습니다.",
                               "When several routes from the same provider are observed in the same request scope,\nclick a model and reasoning effort to see the token, adoption-rate and latency assumptions."))
                        .font(.system(size: 11)).foregroundStyle(muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 8)
                }
            }
        }
    }
    private var comparePanel: some View {
        panel(os1Tr("같은 요청 묶음의 과거 관측", "Past observations in the same request scope"),
              subtitle: os1Tr("순차 재시도 표본 · 독립 paired baseline 아님 · 운영 참고용, off/on 성과에서 제외",
                              "Sequential retry samples · not an independent paired baseline · for operational reference, excluded from off/on results")) {
            HStack {
                Text(os1Tr("기준 경로", "Baseline route")).font(.system(size: 11)).foregroundStyle(muted)
                Picker(os1Tr("기준 경로", "Baseline route"), selection: $baseline) {
                    if baseline.isEmpty { Text(os1Tr("기록 없음", "No records")).tag("") }
                    ForEach(rows.filter { $0.attempts > 0 }) { row in Text(short(row.id)).tag(row.id) }
                }.labelsHidden().frame(maxWidth: 520)
                Spacer()
            }
            if comparisons.isEmpty {
                Text(os1Tr("비교 가능한 동일 요청 기록이 없습니다. 절약률을 추측하거나 비교용 API를 자동 호출하지 않습니다.",
                           "No comparable records for the same request. Savings rates are not guessed, and no comparison API is called automatically."))
                    .font(.system(size: 11)).foregroundStyle(muted).padding(.vertical, 8)
            } else {
                ForEach(comparisons) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(short(item.id)).font(.system(size: 12, weight: .semibold))
                        HStack(spacing: 25) {
                            Text(os1Tr("토큰 차이 추정 \(delta(item.tokenSavings))",
                                       "Estimated token difference \(delta(item.tokenSavings))")).foregroundStyle((item.tokenSavings ?? 0) >= 0 ? green : pink)
                            Text(String(format: os1Tr("시도 채택률 차이 %+.1fpp", "Attempt adoption rate difference %+.1fpp"), item.adoptionDelta * 100)).foregroundStyle(item.adoptionDelta >= 0 ? green : pink)
                            Text(os1Tr("지연 단축 \(delta(item.latencySavings))", "Latency reduction \(delta(item.latencySavings))"))
                            Spacer()
                            Text(os1Tr("\(item.matchedScopes)묶음 · 실측 \(item.measuredScopes) · 기준 \(item.baselineAttempts) / 비교 \(item.candidateAttempts)회",
                                       "\(item.matchedScopes) scopes · \(item.measuredScopes) measured · baseline \(item.baselineAttempts) / comparison \(item.candidateAttempts) attempts")).foregroundStyle(muted)
                        }.font(.system(size: 11)).monospacedDigit()
                    }.padding(12).background(Color.white.opacity(0.025), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            Text(os1Tr("Governance 기여도: off/on 대조 실행 자료가 연결되기 전에는 미측정입니다. 과거 재시도는 입력·순서 차이가 있어 독립 A/B가 아닙니다.",
                       "Governance contribution: unmeasured until off/on comparison run data is connected. Past retries differ in input and order, so they are not an independent A/B."))
                .font(.system(size: 10)).foregroundStyle(muted)
        }
    }
    private var pairedPanel: some View {
        panel(os1Tr("절약과 완료 · 동일 테스크 대조", "Savings and completion · same-task comparison"),
              subtitle: os1Tr("토큰 절약과 실제 완료를 함께 비교 · off/on 대조 영수증 연결 전에는 미측정",
                              "Compares token savings with actual completion · unmeasured until off/on comparison receipts are connected")) {
            HStack(spacing: 10) {
                card(os1Tr("실제 기준 대비 토큰 절약", "Token savings vs actual baseline"), "—", os1Tr("짝지은 대조 실행 없음", "No paired comparison runs"))
                card(os1Tr("실행 완료율 변화 / 회귀", "Completion rate change / regression"), "—", os1Tr("같은 테스크·같은 판정 기준 필요", "Requires the same tasks and the same verdict criteria"))
                card(os1Tr("종합 효율 향상", "Overall efficiency gain"), "—", os1Tr("성공 건수와 총비용을 함께 비교", "Compares successes with total cost"))
            }
            DisclosureGroup(os1Tr("엄밀한 계산 기준", "Strict calculation criteria")) {
                VStack(alignment: .leading, spacing: 9) {
                    Text(os1Tr("사전 고정한 동일 작업 집합: baseline A와 최적화 B를 각각 실행. 입력·환경·검증기·예산·측정 창을 고정하고, 실험에서 바꾸기로 한 경로만 변경합니다. 기준 실행을 추측하거나 자동 유료 호출하지 않습니다.",
                               "A pre-fixed set of identical tasks: run baseline A and optimized B separately. Inputs, environment, verifiers, budget and measurement window stay fixed; only the route the experiment is meant to change is changed. Baseline runs are not guessed, and no paid calls are made automatically."))
                    Text(os1Tr("Tₐ = Σ 모든 호출의 입력+출력 토큰 · 실패·재시도·평가·보조 호출 포함. Eₐ = 검증 성공 건수 Sₐ ÷ Tₐ × 1,000,000",
                               "Tₐ = Σ input+output tokens of all calls · includes failed, retried, evaluation and auxiliary calls. Eₐ = verified successes Sₐ ÷ Tₐ × 1,000,000"))
                    Text(os1Tr("토큰 절약 = 1 − Tᵦ/Tₐ · 실행 완료율 변화 = (Sᵦ−Sₐ)/N · 효율 향상 = Eᵦ/Eₐ − 1. 평균 절약률을 다시 평균하지 않습니다.",
                               "Token savings = 1 − Tᵦ/Tₐ · completion rate change = (Sᵦ−Sₐ)/N · efficiency gain = Eᵦ/Eₐ − 1. Average savings rates are not averaged again."))
                    Text(os1Tr("동일 작업에서 실패→성공 C와 성공→실패 B를 따로 셉니다. 순증 = C−B. 순증이 양수여도 회귀 B를 숨기지 않습니다.",
                               "On identical tasks, failure→success C and success→failure B are counted separately. Net gain = C−B. A positive net gain does not hide regressions B."))
                    Text(os1Tr("N=0, 기준 토큰=0, 기준 효율=0 또는 계측·목표 검증 누락이면 해당 비율은 —. 성공 0건은 측정된 0이며, 미검증은 0이 아닙니다. 진행 중 작업과 종료된 작업의 분모를 섞지 않습니다.",
                               "If N=0, baseline tokens=0, baseline efficiency=0, or metering or goal verification is missing, that ratio is —. Zero successes is a measured 0; unverified is not 0. In-progress and finished tasks are not mixed in one denominator."))
                    Text(os1Tr("관측 Pareto 개선: 토큰 비증가 + 완수 비감소 + 최소 하나 개선. 반대는 회귀, 방향이 엇갈리면 교환관계, 모두 같으면 변화 없음. 표본 분류가 통계적 유의성이나 무회귀를 보증하지 않습니다.",
                               "Observed Pareto improvement: tokens not increased + completions not decreased + at least one improved. The opposite is a regression, mixed directions are a trade-off, and all equal is no change. Sample classification does not guarantee statistical significance or the absence of regressions."))
                    Text(os1Tr("완전 관측 비율에는 Wilson 95% 구간, 짝지은 성공/실패에는 exact McNemar 검정. 실시간 반복 조회·적응적 튜닝 자료로 유의성이나 인과적 향상을 선언하지 않습니다. 비용 효율·지연은 별도 축으로 유지합니다.",
                               "Wilson 95% intervals for fully observed rates; an exact McNemar test for paired successes/failures. Significance or causal gains are not declared from repeated live polling or adaptive-tuning data. Cost efficiency and latency are kept on separate axes."))
                }.font(.system(size: 11)).foregroundStyle(muted).fixedSize(horizontal: false, vertical: true).padding(.top, 8)
            }.font(.system(size: 12))
        }
    }
    private var tracePanel: some View {
        DisclosureGroup(os1Tr("실제 작업 기록 · 최근 20건", "Actual task records · last 20")) {
            VStack(alignment: .leading, spacing: 8) {
                if tasks.isEmpty { Text(os1Tr("이 계측을 도입한 이후의 작업 기록이 없습니다.", "No task records since this metering was introduced.")).foregroundStyle(muted) }
                ForEach(tasks.sorted { $0.startedAt > $1.startedAt }.prefix(20), id: \.id) { task in
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(os1Tr("작업 ID: \(task.id)", "Task ID: \(task.id)"))
                            Text(os1Tr("경로: \(short(task.displayRoute)) · 시도 \(task.attempts.count)회 · 총토큰 \(task.tokens.map(num) ?? "미측정")",
                                       "Route: \(short(task.displayRoute)) · \(task.attempts.count) attempts · total tokens \(task.tokens.map(num) ?? "unmeasured")"))
                            Text(os1Tr("시작 \(task.startedAt.formatted()) · 종료 \(task.endedAt?.formatted() ?? "대기")",
                                       "Started \(task.startedAt.formatted()) · finished \(task.endedAt?.formatted() ?? "pending")"))
                            ForEach(task.attempts, id: \.id) { attempt in
                                Text(os1Tr("\(short(attempt.displayRoute)) · \(attempt.observation?.outcome.rawValue ?? "진행 중") · 토큰 \(attempt.observation.flatMap(GovernanceSnapshot.tokens).map(num) ?? "미측정")",
                                           "\(short(attempt.displayRoute)) · \(attempt.observation?.outcome.rawValue ?? "in progress") · tokens \(attempt.observation.flatMap(GovernanceSnapshot.tokens).map(num) ?? "unmeasured")"))
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
        DisclosureGroup(os1Tr("측정 기준 · 영수증·비교 경계", "Measurement criteria · receipt and comparison boundaries")) {
            VStack(alignment: .leading, spacing: 6) {
                Text(os1Tr("결과 채택 = OS1 실행·출력·저장 게이트 통과. 목표 달성 검증은 별도입니다. 현재 목표별 테스트/사용자 승인 영수증이 연결되지 않아 검증 완료율·검증 효율은 미측정입니다.",
                           "Result adopted = passed the OS1 run, output and save gates. Goal-achievement verification is separate. Per-goal test/user-approval receipts are not connected yet, so verified completion rate and verified efficiency are unmeasured."))
                Text(os1Tr("입력 + 출력 토큰에 재시도·실패 비용을 포함합니다. 캐시는 입력에 포함된 부분이므로 다시 더하지 않습니다. 제공자별 토크나이저가 달라 교차 제공자 토큰 절약 비교는 하지 않습니다.",
                           "Input + output tokens include retry and failure costs. Cache is part of input, so it is not added again. Tokenizers differ by provider, so token savings are not compared across providers."))
                Text(os1Tr("운영 토큰 차이·채택당 토큰·효율은 양쪽 시도가 모두 실측된 과거 요청 묶음만 계산합니다(실측 n/N). 미측정은 0이 아니라 제외입니다. 묶음 채택 Δ는 전체 matched 묶음 기준이며 독립 대조·목표 정확도 향상은 아닙니다.",
                           "Operating token difference, tokens per adoption and efficiency are computed only over past request scopes where attempts on both sides were measured (measured n/N). Unmeasured is excluded, not 0. Scope adoption Δ is based on all matched scopes and is not an independent comparison or a goal-accuracy gain."))
                Text(os1Tr("Δ 곡선은 조회 시점에 계산된 영수증 요약이 변경될 때만 기록합니다. 같은 1초 polling은 새 측정이 아니며, 미측정 구간을 이어 붙이지 않습니다. Wilson 표시는 상관된 운영 표본의 명목 구간으로 일반 성능을 보증하지 않습니다.",
                           "Δ curves record a point only when the receipt summary computed at lookup changes. Repeated 1s polling is not a new measurement, and unmeasured gaps are not joined. Wilson figures are nominal intervals over correlated operating samples and do not guarantee general performance."))
                Text(os1Tr("과거 기록은 요청당 최대 16회 보관된 시도 표본입니다. 시각·테스크 종료가 없으므로 과거 실행 완료율과 실시간 추이는 소급 생성하지 않습니다. 새 테스크는 별도 원자적 기록으로 누적합니다. 확인된 결과 재전송은 기존 테스크에 합쳐 호출을 중복 계산하지 않습니다.",
                           "Past records are attempt samples, up to 16 kept per request. They carry no timestamps or task finish, so past completion rates and live trends are not generated retroactively. New tasks accumulate as separate atomic records. A re-sent confirmed result is merged into its existing task, so calls are not double-counted."))
                Text(os1Tr("새 기록 \(snapshot.tasks.count)건 · 과거 시도 \(snapshot.historical.count)회 · 읽기/검증 거부 \(snapshot.rejectedRecords)건 · 표시 한도 초과 \(snapshot.omittedFiles)건 · 요금표 미연결: 토큰 절약 ≠ 금액 절약",
                           "\(snapshot.tasks.count) new records · \(snapshot.historical.count) past attempts · \(snapshot.rejectedRecords) rejected on read/verification · \(snapshot.omittedFiles) over display limit · no price table connected: token savings ≠ cost savings"))
            }
            .padding(.top, 8)
        }.font(.system(size: 10)).foregroundStyle(muted).fixedSize(horizontal: false, vertical: true)
    }
}
