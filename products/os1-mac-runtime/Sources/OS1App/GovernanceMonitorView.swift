import AppKit
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

/// What the Overview's comparison cards and the Δ charts below them show
/// for the selected pair. One comparison feeds both: the pair over all
/// recorded evidence. The period only decides whether that evidence is fresh
/// enough to be a headline (`freshAfter`); when it is not, the cards collapse
/// into one stale card and the chart headers turn into small gray text.
struct GovernanceMonitorDeltaCards {
    enum Kind: Equatable { case loading, noComparison, stale, values }
    let source: GovernanceComparison?
    let loading: Bool
    let token: GovernanceDeltaHeadline
    let completion: GovernanceDeltaHeadline
    let efficiency: GovernanceDeltaHeadline

    init(comparison: GovernanceComparison?, freshAfter cutoff: Date, loading: Bool = false) {
        let source = loading ? nil : comparison
        self.source = source
        self.loading = loading
        token = GovernanceDeltaHeadline.evaluate(value: source?.tokenSavings, scopes: source?.measuredScopes ?? 0,
                                                 latestEvidence: source?.latestMeasuredEvidenceAt, freshAfter: cutoff)
        completion = GovernanceDeltaHeadline.evaluate(value: source?.taskCompletionDelta, scopes: source?.matchedScopes ?? 0,
                                                      latestEvidence: source?.latestEvidenceAt, freshAfter: cutoff)
        efficiency = GovernanceDeltaHeadline.evaluate(value: source?.completionEfficiencyDelta, scopes: source?.measuredScopes ?? 0,
                                                      latestEvidence: source?.latestMeasuredEvidenceAt, freshAfter: cutoff)
    }
    var kind: Kind {
        if loading { return .loading }
        if source == nil { return .noComparison }
        if case .stale = completion { return .stale }
        return .values
    }
    /// No comparison inside the freshness window: the cards collapse into one.
    var isStale: Bool { kind == .stale }
    var staleSince: Date? { source?.latestEvidenceAt }
    var staleTitle: String { GovernanceMonitorText.staleTitle(since: staleSince) }
    /// The last measured values, kept in the stale card's note only.
    var staleNote: String {
        var parts = [GovernanceMonitorText.staleReason(since: staleSince)]
        if let item = source {
            if item.tokenSavings != nil {
                parts.append(os1Tr("마지막 토큰 \(GovernanceMonitorText.tokenChange(savings: item.tokenSavings)) (\(GovernanceMonitorText.tokenCohort(item)))",
                                   "last tokens \(GovernanceMonitorText.tokenChange(savings: item.tokenSavings)) (\(GovernanceMonitorText.tokenCohort(item)))"))
            }
            parts.append(adoptionSummary(item))
        }
        return parts.joined(separator: " · ")
    }
    func adoptionSummary(_ item: GovernanceComparison) -> String {
        let date = item.latestEvidenceAt.map { " · " + GovernanceMonitorText.shortDate($0) } ?? ""
        if let bias = GovernanceMonitorText.selectionBiasSummary(item) {
            return "\(bias.title): \(bias.value)\(date)"
        }
        return os1Tr("요청 묶음 채택 \(GovernanceMonitorText.percentagePoints(item.taskCompletionDelta)) (n=\(item.matchedScopes)\(date))",
                     "request-scope adoption \(GovernanceMonitorText.percentagePoints(item.taskCompletionDelta)) (n=\(item.matchedScopes)\(date))")
    }
    /// Δ chart headers: the same gate as the cards, so a stale or thin value
    /// is never the big number under a card that withholds it.
    var chartToken: GovernanceHeadlineDisplay {
        GovernanceMonitorText.headlineDisplay(token, lastValue: source?.tokenSavings, lastEvidence: source?.latestMeasuredEvidenceAt) {
            GovernanceMonitorText.tokenChange(savings: $0)
        }
    }
    var chartCompletion: GovernanceHeadlineDisplay {
        GovernanceMonitorText.headlineDisplay(completion, lastValue: source?.taskCompletionDelta, lastEvidence: source?.latestEvidenceAt) {
            GovernanceMonitorText.percentagePoints($0)
        }
    }
}

/// Testable pieces of the monitor that do not need a live view.
extension GovernanceMonitorView {
    /// Cards and charts for the selected pair, from one cohort.
    static func overviewCards(evidence: GovernanceDashboardProjection, baseline: String, candidate: String,
                              freshAfter cutoff: Date, loading: Bool) -> GovernanceMonitorDeltaCards {
        let all = evidence.comparisonsByBaseline[baseline]?.first { $0.id == candidate }
        return GovernanceMonitorDeltaCards(comparison: all, freshAfter: cutoff, loading: loading)
    }
    /// The live strip's window and bucket. Like Activity Monitor it is the
    /// last 30 minutes in 10-second buckets under every period choice.
    static func liveStripLayout(window: String) -> (span: TimeInterval, bucket: TimeInterval) {
        (1_800, 10)
    }
    struct LegendItem: Equatable {
        let label: String
        let isData: Bool
    }
    /// The live chart's legend: only series that are drawn from receipts.
    static var liveLegend: [LegendItem] {
        [LegendItem(label: os1Tr("시작", "Started"), isData: true),
         LegendItem(label: os1Tr("종료", "Finished"), isData: true)]
    }
    /// The token card's note, and the session-resume caveat on its own line.
    static func tokenCardNote(_ item: GovernanceComparison?, headline: GovernanceDeltaHeadline) -> (note: String, caveat: String?) {
        var note = item.map { GovernanceMonitorText.tokenCohort($0) } ?? ""
        if case .value = headline {} else if let savings = item?.tokenSavings {
            note = GovernanceMonitorText.tokenChange(savings: savings) + " · " + note
        }
        return (note, os1Tr("후속 시도가 같은 세션을 이어 쓸 수 있음(경로 효과와 섞임)",
                            "a later attempt may reuse the same session (warm start)"))
    }
    /// Card text width at the monitor's minimum window width (980 pt):
    /// five columns, 10 pt gaps, 24 pt page and 14 pt card padding.
    static let minimumCardTextWidth: CGFloat = (980 - 48 - 40) / 5 - 28
    /// Whether `text` at the cards' 9 pt note size fits in `lines` lines.
    static func noteFits(_ text: String, width: CGFloat = minimumCardTextWidth, lines: Int = 2) -> Bool {
        let font = NSFont.systemFont(ofSize: 9)
        let bounds = (text as NSString).boundingRect(with: NSSize(width: width, height: .greatestFiniteMagnitude),
                                                     options: [.usesLineFragmentOrigin, .usesFontLeading],
                                                     attributes: [.font: font])
        let lineHeight = NSLayoutManager().defaultLineHeight(for: font)
        return bounds.height <= lineHeight * CGFloat(lines) + 0.5
    }
    /// Previews render with an empty account book and never read the
    /// owner's accounts file; the live monitor loads it as before.
    @MainActor
    static func makeAccountsModel(preview: Bool,
                                  load: @escaping () -> BackendAccountBook = { BackendAccounts.load() }) -> BackendAccountsModel {
        preview ? BackendAccountsModel(load: { BackendAccounts.normalized(BackendAccountBook()) }) : BackendAccountsModel(load: load)
    }
}

/// Read-only projection; opening this panel never starts a provider, replay, or benchmark.
struct GovernanceMonitorView: View {
    var active: [String] = []
    var queued: Int = 0
    var onClose: (() -> Void)? = nil
    var preview: Bool = false
    @State var snapshot = GovernanceSnapshot()
    /// The monitor opens on the last 7 days: an all-time rate over weeks of
    /// receipts barely moves, which read as a frozen number. The all-time
    /// figure stays in the adoption card's note.
    static let defaultWindow = "7일"
    @State private var window = GovernanceMonitorView.defaultWindow
    @State private var provider = "전체"
    @State private var baseline = ""
    @State private var candidate = ""
    @State private var section = GovernanceMonitorSection.live
    @State private var scenarioTasks = 100
    @State private var selectedTaskID = ""
    @State private var refreshed = Date()
    @State private var projection: GovernanceDashboardProjection
    @State private var projectionFilterContext: String
    /// All-time projection (same provider filter) for route comparisons.
    /// Matched retry scopes are historical evidence; the period decides only
    /// whether that evidence is fresh enough for a headline.
    @State private var evidence: GovernanceDashboardProjection
    @State private var evidenceProvider = "전체"
    @StateObject private var accounts: BackendAccountsModel
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
        _accounts = StateObject(wrappedValue: Self.makeAccountsModel(preview: preview))
        _refreshed = State(initialValue: snapshot.loadedAt)
        let window = Self.defaultWindow
        let allTime = snapshot.dashboardProjection(provider: nil, since: nil, includeHistorical: true, now: snapshot.loadedAt)
        let period = Self.since(window: window, now: snapshot.loadedAt).map {
            snapshot.dashboardProjection(provider: nil, since: $0, includeHistorical: false, now: snapshot.loadedAt)
        } ?? allTime
        _projection = State(initialValue: period)
        _projectionFilterContext = State(initialValue: [window, "전체"].joined(separator: "|"))
        _evidence = State(initialValue: allTime)
        let pair = allTime.defaultComparison()
        let fallback = allTime.rows.first { $0.attempts > 0 }?.id ?? ""
        _baseline = State(initialValue: pair?.baseline ?? fallback)
        _candidate = State(initialValue: pair?.id ?? (allTime.comparisonsByBaseline[fallback]?.first?.id ?? ""))
    }
    private static func since(window: String, now: Date) -> Date? {
        window == "전체" ? nil : now.addingTimeInterval(window == "24시간" ? -86_400 : -604_800)
    }
    private var since: Date? { Self.since(window: window, now: refreshed) }
    private var filterContext: String { [window, provider].joined(separator: "|") }
    private var projectionIsCurrent: Bool { projectionFilterContext == filterContext }
    private var evidenceIsCurrent: Bool { evidenceProvider == provider }
    private var projectionRequestID: String {
        let rollingWindowTick = window == "전체" ? "all" : String(Int(refreshed.timeIntervalSince1970))
        return [String(snapshot.loadedAt.timeIntervalSince1970), filterContext, rollingWindowTick]
            .joined(separator: "|")
    }
    /// Recomputed when the receipts or the provider change, not every tick.
    /// Under All the period projection already is the all-time one.
    private var evidenceRequestID: String {
        [String(snapshot.loadedAt.timeIntervalSince1970), provider, window == "전체" ? "all" : "period"].joined(separator: "|")
    }
    private var filtered: GovernanceSnapshot { projection.snapshot }
    private var tasks: [GovernanceTask] { projectionIsCurrent ? projection.tasks : [] }
    private var terminal: [GovernanceTask] { projectionIsCurrent ? projection.terminalTasks : [] }
    private var rows: [GovernanceRoute] { projectionIsCurrent ? projection.rows : [] }
    private var measuredRows: [GovernanceRoute] { rows.filter { $0.measuredAttempts > 0 }.prefix(8).map { $0 } }
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
    /// Route rows and comparisons for the baseline/comparison pickers come
    /// from the all-time evidence projection (see `evidence`).
    private var evidenceRows: [GovernanceRoute] { evidenceIsCurrent ? evidence.rows.filter { $0.attempts > 0 } : [] }
    private var comparisons: [GovernanceComparison] {
        evidenceIsCurrent ? (evidence.comparisonsByBaseline[baseline] ?? []) : []
    }
    /// The selected pair over all recorded evidence (charts, Details).
    private var selectedComparison: GovernanceComparison? { comparisons.first { $0.id == candidate } }
    /// Evidence older than this is not a current number: the period start,
    /// or seven days back under All.
    private var freshnessCutoff: Date { since ?? refreshed.addingTimeInterval(-604_800) }
    /// Cards and charts read the same comparison (all recorded evidence);
    /// while a provider change is still being computed they say so.
    private var deltaCards: GovernanceMonitorDeltaCards {
        Self.overviewCards(evidence: evidence, baseline: baseline, candidate: candidate,
                           freshAfter: freshnessCutoff, loading: !evidenceIsCurrent)
    }
    private var taskCompletionDelta: Double? { selectedComparison?.taskCompletionDelta }
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
    private func efficiencyCohortNote(_ item: GovernanceComparison?) -> String {
        guard let item else { return os1Tr("채택/1M tok · 실패·재시도 포함", "Adoptions/1M tok · includes failures and retries") }
        let date = item.latestMeasuredEvidenceAt.map { " · " + GovernanceMonitorText.shortDate($0) } ?? ""
        if item.completionEfficiencyDelta != nil {
            return os1Tr("채택/1M tok · n=\(item.measuredScopes)\(date) · 실패·재시도 포함",
                         "Adoptions/1M tok · n=\(item.measuredScopes)\(date) · includes failures and retries")
        }
        if item.measuredScopes == 0 { return os1Tr("채택/1M tok · 완전 계측 묶음 없음", "Adoptions/1M tok · no fully metered scope") }
        return os1Tr("n=\(item.measuredScopes)\(date) · 기준 채택 0 또는 0 토큰이면 정의 불가",
                     "n=\(item.measuredScopes)\(date) · undefined with 0 baseline adoptions or a 0-token denominator")
    }
    private func evidenceStamp(_ date: Date?) -> String {
        guard let date else { return os1Tr("근거 시각 미기록(과거 원장)", "evidence time unrecorded (legacy ledger)") }
        return date.formatted(.dateTime.month(.defaultDigits).day().hour().minute())
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
    /// Like Activity Monitor the strip always shows the last 30 minutes in
    /// 10-second buckets, moving every second; the Period picker applies to
    /// the cards, not to this strip.
    private var liveActivityLayout: (span: TimeInterval, bucket: TimeInterval) { Self.liveStripLayout(window: window) }
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
    private var liveActivityWindowLabel: String {
        liveActivityLayout.span == 1_800 ? os1Tr("최근 30분", "Last 30 minutes") : os1Tr("기간 \(windowLabel(window))", "Period \(windowLabel(window))")
    }
    private var liveActivityBucketLabel: String {
        let bucket = Int(liveActivityLayout.bucket)
        return bucket < 60 ? os1Tr("\(bucket)초 간격", "\(bucket)-second intervals")
            : (bucket < 3_600 ? os1Tr("\(bucket / 60)분 간격", "\(bucket / 60)-minute intervals") : os1Tr("1시간 간격", "1-hour intervals"))
    }
    /// All-time tasks of the current provider filter: a long task that
    /// started before a period still shows when it finishes.
    private var liveActivityStrip: GovernanceActivityStrip {
        let layout = liveActivityLayout
        return GovernanceActivityStrip.build(tasks: evidence.tasks, until: refreshed, span: layout.span, bucketSeconds: layout.bucket)
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
            if selectedSince == nil {
                evidence = next
                evidenceProvider = provider
            }
            setBaseline()
        }
        .task(id: evidenceRequestID) {
            guard window != "전체" else { return }
            let source = snapshot
            let selectedProvider = provider == "전체" ? nil : provider
            let context = provider
            let now = refreshed
            let next = await Task.detached(priority: .utility) {
                source.dashboardProjection(provider: selectedProvider, since: nil, includeHistorical: true, now: now)
            }.value
            guard !Task.isCancelled else { return }
            evidence = next
            evidenceProvider = context
            setBaseline()
        }
        .onChange(of: baseline) { _ in setCandidate() }
    }
    /// Keeps the owner's choice while it exists; otherwise opens on the
    /// comparison with the newest evidence (`defaultComparison`).
    private func setBaseline() {
        guard evidenceIsCurrent else { return }
        let available = evidenceRows
        if !available.contains(where: { $0.id == baseline }) {
            if let pair = evidence.defaultComparison() {
                baseline = pair.baseline
                candidate = pair.id
            } else {
                baseline = available.first?.id ?? ""
            }
        }
        setCandidate()
    }
    private func setCandidate() {
        let ids = comparisons.map(\.id)
        if !ids.contains(candidate) {
            let newest = evidence.defaultComparison()
            candidate = newest?.baseline == baseline ? newest!.id
                : (comparisons.max { ($0.latestEvidenceAt ?? .distantPast, $0.measuredScopes) < ($1.latestEvidenceAt ?? .distantPast, $1.measuredScopes) }?.id ?? "")
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
            // The only place the clock-driven pulse is drawn, with its
            // visible label: it is a liveness indicator, never data.
            VStack(alignment: .trailing, spacing: 1) {
                heartbeatTrace(width: 72, height: 14)
                Text(os1Tr("모니터 동작 표시 · 데이터 아님", "monitor running · not data"))
                    .font(.system(size: 8)).foregroundStyle(muted)
            }
            Circle().fill(green)
                .frame(width: 6, height: 6)
                .scaleEffect(preview ? 1 : (heartbeatPulse ? 1.45 : 0.8))
                .opacity(preview ? 1 : (heartbeatPulse ? 1 : 0.5))
            Text(preview ? os1Tr("읽기 전용 미리보기", "Read-only preview")
                 : os1Tr("영수증 폴더 1초마다 확인 · Δ 그래프는 영수증 시각 기준", "Receipt folder checked every second · Δ charts use receipt time"))
                .font(.system(size: 11)).foregroundStyle(green)
            Button { if let onClose { onClose() } else { dismiss() } } label: { Image(systemName: "xmark").frame(width: 26, height: 26) }
                .buttonStyle(.plain).accessibilityLabel("Close governance monitor")
        }.padding(24).frame(maxWidth: .infinity)
    }
    private var heartbeatPulse: Bool {
        Int(refreshed.timeIntervalSince1970) % 2 == 0
    }
    /// Liveness indicator for the one-second check, deliberately separate
    /// from task telemetry: the pulse moves with the clock, not with data.
    /// Its label says so, so it is never read as a chart.
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
        .help(os1Tr("모니터 동작 표시 · 데이터 아님", "Monitor is running · not data"))
        .accessibilityLabel(os1Tr("모니터 동작 표시(데이터 아님)", "Monitor liveness indicator (not data)"))
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
            if section != .accounts, !evidenceRows.isEmpty {
                HStack(spacing: 10) {
                    Text(os1Tr("기준", "Baseline")).font(.system(size: 10, weight: .semibold)).foregroundStyle(muted)
                    Picker(os1Tr("운영 기준 경로", "Operating baseline route"), selection: $baseline) {
                        ForEach(evidenceRows) { row in Text(short(row.id)).tag(row.id) }
                    }.labelsHidden().frame(maxWidth: 390)
                    Image(systemName: "arrow.right").foregroundStyle(muted)
                    Text(os1Tr("비교", "Comparison")).font(.system(size: 10, weight: .semibold)).foregroundStyle(muted)
                    Picker(os1Tr("비교 경로", "Comparison route"), selection: $candidate) {
                        if comparisons.isEmpty { Text(os1Tr("matched 기록 없음", "No matched records")).tag("") }
                        ForEach(comparisons) { item in Text(short(item.id)).tag(item.id) }
                    }.labelsHidden().frame(maxWidth: 390)
                    Spacer()
                    Text(os1Tr("경로 비교(카드·그래프)는 기록된 전체 근거 · 기간은 최신 여부와 채택률 카드만 정함",
                               "Route comparison (cards and charts) uses all recorded evidence · the period decides freshness and the adoption card"))
                        .font(.system(size: 9)).foregroundStyle(muted)
                }
            }
        }
    }
    @ViewBuilder private var sectionContent: some View {
        switch section {
        case .live:
            compactMetrics
            liveActivityChart
            evidenceCharts(stacked: false)
            liveRow
        case .details:
            panel(os1Tr("경로 비교 근거 · 영수증 시각", "Route comparison evidence · receipt time"),
                  subtitle: os1Tr("각 matched 묶음의 마지막 시도가 끝난 시각에 누적 값을 찍고 선으로 잇습니다 · 점선은 마지막 근거 이후 지금까지",
                                  "Each point is the cumulative value when a matched scope's last attempt ended, joined by a line · dashed from the last evidence to now")) {
                evidenceCharts(stacked: true)
            }
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
    private func compactCard(_ title: String, _ value: String, _ note: String, color: Color = .white,
                             valueSize: CGFloat = 22, caveat: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.system(size: 10, weight: .medium)).foregroundStyle(muted).lineLimit(1)
            Text(value).font(.system(size: valueSize, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(color)
                .lineLimit(1).minimumScaleFactor(0.7)
            Text(note).font(.system(size: 9)).foregroundStyle(muted).lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            if let caveat {
                Text(caveat).font(.system(size: 9)).foregroundStyle(muted.opacity(0.85)).italic().lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 70, alignment: .topLeading)
        .padding(.horizontal, 14).padding(.vertical, 11)
        .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 10))
    }
    /// The rate covers every receipt in the period; over the whole history one
    /// more task moves it by hundredths of a percent, so the scope is named.
    private var periodScope: String {
        switch window {
        case "24시간": return os1Tr("최근 24시간", "last 24h")
        case "7일": return os1Tr("최근 7일", "last 7d")
        default: return os1Tr("전체 누적", "all-time")
        }
    }
    private var allTimeAdoptionNote: String {
        let rate = evidence.allTimeTerminal > 0 ? Double(evidence.allTimeAdopted) / Double(evidence.allTimeTerminal) : nil
        return os1Tr("전체 누적 \(percent(rate)) (\(evidence.allTimeAdopted)/\(evidence.allTimeTerminal))",
                     "all-time \(percent(rate)) (\(evidence.allTimeAdopted)/\(evidence.allTimeTerminal))")
    }
    private var compactMetrics: some View {
        let cards = deltaCards
        // A Grid keeps five equal columns; the stale card spans the three
        // comparison columns so the first two cards keep their width.
        return Grid(alignment: .topLeading, horizontalSpacing: 10) { GridRow {
            compactCard(os1Tr("전달 채택률 · \(periodScope)", "Delivery adoption · \(periodScope)"), percent(taskCompletionRate),
                        window == "전체"
                            ? os1Tr("채택 \(completed) / 종료 \(terminal.count) · 목표 성공과 별개",
                                    "Adopted \(completed) / finished \(terminal.count) · separate from goal success")
                            : os1Tr("채택 \(completed) / 종료 \(terminal.count) · \(allTimeAdoptionNote)",
                                    "Adopted \(completed) / finished \(terminal.count) · \(allTimeAdoptionNote)"), color: green)
            compactCard(os1Tr("목표 검증", "Goal verification"), GovernanceMonitorText.goalValue(quality),
                        quality.rate == nil
                            ? os1Tr("목표 판정 영수증 아직 없음 · 채택 ≠ 목표 성공",
                                    "No goal-verdict receipts yet · adoption ≠ goal success")
                            : os1Tr("판정 \(quality.verifiedSuccesses + quality.verifiedFailures)건", "\(quality.verifiedSuccesses + quality.verifiedFailures) verdicts"),
                        color: quality.rate == nil ? muted : green, valueSize: quality.rate == nil ? 18 : 22)
            switch cards.kind {
            case .loading:
                compactCard(os1Tr("경로 비교 Δ", "Route comparison Δ"), os1Tr("불러오는 중…", "Loading…"),
                            GovernanceMonitorText.evidenceEmptyText(nil, series: .completion, loading: true),
                            color: muted, valueSize: 18)
                    .gridCellColumns(3)
            case .noComparison:
                compactCard(os1Tr("경로 비교 Δ", "Route comparison Δ"), "—",
                            GovernanceMonitorText.evidenceEmptyText(nil, series: .completion, loading: false),
                            color: muted, valueSize: 18)
                    .gridCellColumns(3)
            case .stale:
                compactCard(os1Tr("경로 비교 Δ · \(pairLabel)", "Route comparison Δ · \(pairLabel)"), cards.staleTitle,
                            cards.staleNote, color: .yellow, valueSize: 18)
                    .gridCellColumns(3)
            case .values:
                tokenCard(cards)
                adoptionCard(cards)
                efficiencyCard(cards)
            }
        } }
    }
    private var pairLabel: String {
        guard let item = selectedComparison else { return "" }
        let (base, cand) = GovernanceMonitorText.sideNames(baseline: item.baseline, candidate: item.id)
        return "\(base) → \(cand)"
    }
    private func headlineText(_ headline: GovernanceDeltaHeadline, _ value: (Double) -> String) -> (String, CGFloat) {
        switch headline {
        case .unavailable: return ("—", 22)
        case .stale(let since): return (GovernanceMonitorText.staleTitle(since: since), 15)
        case .tooFew(let scopes): return (GovernanceMonitorText.tooFew(scopes: scopes), 15)
        case .value(let number): return (value(number), 22)
        }
    }
    private func tokenCard(_ cards: GovernanceMonitorDeltaCards) -> some View {
        let (text, size) = headlineText(cards.token) { GovernanceMonitorText.tokenChange(savings: $0) }
        let note = Self.tokenCardNote(cards.source, headline: cards.token)
        let color: Color = { if case .value(let v) = cards.token { return v >= 0 ? green : pink }; return muted }()
        return compactCard(os1Tr("토큰 변화 Δ · 전체 누적", "Token change Δ · all-time"), text, note.note,
                           color: color, valueSize: size, caveat: note.caveat)
    }
    private func adoptionCard(_ cards: GovernanceMonitorDeltaCards) -> some View {
        let item = cards.source
        let date = item?.latestEvidenceAt.map { " · " + GovernanceMonitorText.shortDate($0) } ?? ""
        if let item, let bias = GovernanceMonitorText.selectionBiasSummary(item) {
            return compactCard(bias.title, bias.value, bias.note + date, color: .white, valueSize: 20)
        }
        let (text, size) = headlineText(cards.completion) { GovernanceMonitorText.percentagePoints($0) }
        let color: Color = { if case .value(let v) = cards.completion { return v >= 0 ? green : pink }; return muted }()
        return compactCard(os1Tr("묶음 채택 Δ · 전체 누적", "Scope adoption Δ · all-time"), text,
                           os1Tr("\(percent(item?.baselineTaskCompletionRate)) → \(percent(item?.candidateTaskCompletionRate)) · n=\(item?.matchedScopes ?? 0)\(date)",
                                 "\(percent(item?.baselineTaskCompletionRate)) → \(percent(item?.candidateTaskCompletionRate)) · n=\(item?.matchedScopes ?? 0)\(date)"),
                           color: color, valueSize: size)
    }
    private func efficiencyCard(_ cards: GovernanceMonitorDeltaCards) -> some View {
        let (text, size) = headlineText(cards.efficiency) { delta($0) }
        let color: Color = { if case .value(let v) = cards.efficiency { return v >= 0 ? green : pink }; return muted }()
        return compactCard(os1Tr("채택/토큰 Δ · 전체 누적", "Adoptions/token Δ · all-time"), text, efficiencyCohortNote(cards.source),
                           color: color, valueSize: size)
    }
    /// Δ over evidence time for the selected pair: a connected line through
    /// the cumulative value after each matched scope's receipt, then a dashed
    /// line at the last value from that receipt to now. Header values go
    /// through the same stale / too-few gate as the cards above.
    @ViewBuilder private func evidenceCharts(stacked: Bool) -> some View {
        let cards = deltaCards
        let item = cards.source
        let bias = item.flatMap { GovernanceMonitorText.selectionBiasSummary($0) }
        let token = evidenceChart(
            title: os1Tr("토큰 변화 Δ · \(pairLabel)", "Token change Δ · \(pairLabel)"),
            headline: cards.chartToken,
            note: (item.map { GovernanceMonitorText.tokenCohort($0) } ?? "") + " · " + os1Tr("인과적 절약 아님", "not causal savings"),
            points: (item?.tokenEvidence ?? []).compactMap { point in point.value.map { GovernanceChartPoint(id: point.id, value: -$0 * 100) } },
            unit: "%", color: (item?.tokenSavings ?? 0) >= 0 ? green : pink,
            emptyText: GovernanceMonitorText.evidenceEmptyText(item, series: .token, loading: cards.loading),
            stacked: stacked)
        let completion = evidenceChart(
            title: bias.map { os1Tr("누적 채택 Δ · \($0.title)", "Cumulative adoption Δ · \($0.title)") }
                ?? os1Tr("요청 묶음 채택 Δ · \(pairLabel)", "Request-scope adoption Δ · \(pairLabel)"),
            headline: cards.chartCompletion,
            note: "n=\(item?.matchedScopes ?? 0) · " + (bias != nil ? os1Tr("선택 편향 · A/B 아님", "selection-biased · not an A/B")
                                                        : os1Tr("순차 재시도 묶음 · 독립 A/B 아님", "sequential retry scopes · not an independent A/B")),
            points: (item?.completionEvidence ?? []).compactMap { point in point.value.map { GovernanceChartPoint(id: point.id, value: $0 * 100) } },
            unit: "pp", color: bias != nil ? Color(white: 0.85) : ((item?.taskCompletionDelta ?? 0) >= 0 ? green : pink),
            emptyText: GovernanceMonitorText.evidenceEmptyText(item, series: .completion, loading: cards.loading),
            stacked: stacked)
        if stacked {
            VStack(alignment: .leading, spacing: 12) { completion; token }
        } else {
            HStack(alignment: .top, spacing: 12) { token; completion }
        }
    }
    private var liveActivityChart: some View {
        let strip = liveActivityStrip
        let points = strip.points
        let startedEvents = points.filter { $0.started > 0 }
        let finishedEvents = points.filter { $0.finished > 0 }
        let maxValue = max(1, strip.maxValue)
        let span = liveActivityLayout.span
        let axisFormat: Date.FormatStyle = span > 86_400 ? .dateTime.month().day() : .dateTime.hour().minute()
        let tickInterval: TimeInterval = span > 86_400 ? 86_400 : (span > 1_800 ? 14_400 : 300)
        let axisTicks = GovernanceActivityStrip.axisTicks(from: strip.start, to: strip.end, every: tickInterval,
                                                          edgeMargin: span * 0.04)
        return VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(os1Tr("실시간 거버넌스 활동", "Live governance activity")).font(.system(size: 12, weight: .semibold))
                    Text(os1Tr("작업 시작·종료 영수증 · \(liveActivityWindowLabel) · \(liveActivityBucketLabel) · 작업이 없으면 0으로 흐름",
                               "Task start/finish receipts · \(liveActivityWindowLabel) · \(liveActivityBucketLabel) · flows at 0 when there are no tasks"))
                        .font(.system(size: 9)).foregroundStyle(muted)
                }
                Spacer()
                HStack(spacing: 10) {
                    ForEach(Self.liveLegend, id: \.label) { item in
                        if item.isData {
                            Label(item.label, systemImage: "circle.fill")
                                .foregroundStyle(item.label == os1Tr("시작", "Started") ? green : pink)
                        } else {
                            Text(item.label).foregroundStyle(muted)
                        }
                    }
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
    /// `points` are evidence points on receipt time, joined by a line (each
    /// value holds until the next scope's receipt changes it). The dashed
    /// segment holds the last value from the last receipt to now: no point
    /// is drawn where no receipt exists. When that stretch is long it is
    /// compressed behind a labelled break, so the evidence keeps the width.
    private func evidenceChart(title: String, headline: GovernanceHeadlineDisplay, note: String, points: [GovernanceChartPoint],
                               unit: String, color: Color, emptyText: String, stacked: Bool) -> some View {
        let now = refreshed
        let last = points.last
        let axis = GovernanceEvidenceTimeAxis(evidence: points.map(\.id), now: now)
        let tail: [GovernanceChartPoint] = last.flatMap { last in
            now > last.id ? [last, GovernanceChartPoint(id: now, value: last.value)] : nil
        } ?? []
        let ageDays = last.map { now.timeIntervalSince($0.id) / 86_400 } ?? 0
        let tailLabel = last.map { last in
            os1Tr("\(evidenceStamp(last.id)) 이후 새 근거 없음", "No new evidence since \(evidenceStamp(last.id))")
        } ?? ""
        let domain = chartDomain(points)
        let symbol: CGFloat = points.count > 20 ? 10 : 28
        let tickLabels = Dictionary(axis.ticks.map { ($0.position, $0.label) }, uniquingKeysWith: { first, _ in first })
        return VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                    Text(note).font(.system(size: 9)).foregroundStyle(muted).lineLimit(2)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    // Only a fresh value over enough scopes is the big number.
                    Text(headline.text)
                        .font(headline.prominent ? .system(size: 22, weight: .semibold, design: .rounded) : .system(size: 11, weight: .medium))
                        .monospacedDigit().foregroundStyle(headline.prominent ? color : muted)
                    if let last {
                        Text(os1Tr("근거 \(points.count)점 · 마지막 \(evidenceStamp(last.id))",
                                   "\(points.count) evidence points · last \(evidenceStamp(last.id))"))
                            .font(.system(size: 9)).foregroundStyle(ageDays > 7 ? .yellow : muted)
                    }
                }
            }
            if points.isEmpty {
                VStack(spacing: 7) {
                    Image(systemName: "chart.xyaxis.line").font(.system(size: 24)).foregroundStyle(muted.opacity(0.55))
                    Text(emptyText)
                        .font(.system(size: 10)).foregroundStyle(muted)
                        .multilineTextAlignment(.center).padding(.horizontal, 24)
                }
                .frame(maxWidth: .infinity, minHeight: stacked ? 190 : 155)
            } else {
                Chart {
                    RuleMark(y: .value(os1Tr("기준", "Baseline"), 0))
                        .foregroundStyle(Color.white.opacity(0.16))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    if let gap = axis.breakRange {
                        RectangleMark(xStart: .value(os1Tr("시간", "Time"), gap.lowerBound),
                                      xEnd: .value(os1Tr("시간", "Time"), gap.upperBound))
                            .foregroundStyle(Color.white.opacity(0.06))
                            .annotation(position: .overlay, alignment: .bottom, spacing: 0) {
                                Text("≈ " + (axis.gapLabel ?? "")).font(.system(size: 8, weight: .medium)).foregroundStyle(muted)
                                    .fixedSize().padding(.bottom, 2)
                            }
                    }
                    ForEach(points) { point in
                        AreaMark(x: .value(os1Tr("시간", "Time"), axis.position(point.id)),
                                 yStart: .value(os1Tr("기준", "Baseline"), 0), yEnd: .value(os1Tr("델타", "Delta"), point.value),
                                 series: .value(os1Tr("계열", "Series"), "evidence"))
                            .interpolationMethod(.stepEnd)
                            .foregroundStyle(LinearGradient(colors: [color.opacity(0.24), color.opacity(0.015)], startPoint: .top, endPoint: .bottom))
                        LineMark(x: .value(os1Tr("시간", "Time"), axis.position(point.id)), y: .value(os1Tr("델타", "Delta"), point.value),
                                 series: .value(os1Tr("계열", "Series"), "evidence"))
                            .interpolationMethod(.stepEnd)
                            .foregroundStyle(color)
                            .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                        PointMark(x: .value(os1Tr("시간", "Time"), axis.position(point.id)), y: .value(os1Tr("델타", "Delta"), point.value))
                            .foregroundStyle(color).symbolSize(symbol)
                    }
                    ForEach(tail) { point in
                        LineMark(x: .value(os1Tr("시간", "Time"), axis.position(point.id)), y: .value(os1Tr("델타", "Delta"), point.value),
                                 series: .value(os1Tr("계열", "Series"), "no-new-evidence"))
                            .foregroundStyle(color.opacity(0.55))
                            .lineStyle(StrokeStyle(lineWidth: 1.4, dash: [5, 4]))
                    }
                    if let end = tail.last {
                        PointMark(x: .value(os1Tr("시간", "Time"), axis.position(end.id)), y: .value(os1Tr("델타", "Delta"), end.value))
                            .symbol(.circle).symbolSize(16).foregroundStyle(color.opacity(0.55))
                            .annotation(position: .top, alignment: .trailing, spacing: 4) {
                                Text(tailLabel).font(.system(size: 9, weight: .medium)).foregroundStyle(.yellow)
                            }
                    }
                }
                .chartXScale(domain: 0...1)
                .chartYScale(domain: domain)
                .chartXAxis {
                    AxisMarks(values: axis.ticks.map(\.position)) { value in
                        AxisGridLine().foregroundStyle(Color.white.opacity(0.06))
                        AxisValueLabel(anchor: (value.as(Double.self) ?? 0) > 0.97 ? .topTrailing : .top) {
                            if let position = value.as(Double.self), let label = tickLabels[position] {
                                Text(label).font(.system(size: 8)).foregroundStyle(muted)
                            }
                        }
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
                .frame(height: stacked ? 190 : 155)
                .accessibilityElement()
                .accessibilityLabel(title)
                .accessibilityValue(os1Tr("근거 \(points.count)점 · 현재 \(headline.text) · \(tailLabel)",
                                          "\(points.count) evidence points · current \(headline.text) · \(tailLabel)"))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(15)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
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
            let unfinished = tasks.filter { !$0.isTerminal }
            if !unfinished.isEmpty {
                let orphaned = GovernanceProcessLiveness.orphaned(unfinished).count
                Text(os1Tr("미종료 영수증 \(unfinished.count)건 · 그중 실행 프로세스 없음 \(orphaned)건(중단됨) · 완료로 계산하지 않습니다.",
                           "\(unfinished.count) unfinished receipts · \(orphaned) with no live process (interrupted) · not counted as complete.")).font(.system(size: 10)).foregroundStyle(muted)
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
        if !task.isTerminal {
            // Display only: a "running" receipt whose process is gone (or
            // whose PID now belongs to a later process) never finishes.
            return GovernanceProcessLiveness.isAlive(pid: task.pid, taskStartedAt: task.startedAt)
                ? (os1Tr("영수증 대기", "Awaiting receipt"), .yellow)
                : (os1Tr("프로세스 없음", "No process"), muted)
        }
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
                        ForEach(evidenceRows) { row in Text(short(row.id)).tag(row.id) }
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
                             os1Tr("\(scenarioTasks)개 요청 가정 · 실측 \(item.measuredScopes)/\(item.matchedScopes)묶음 · 토큰 \(GovernanceMonitorText.tokenChange(savings: item.tokenSavings))",
                                   "\(scenarioTasks) requests assumed · measured \(item.measuredScopes)/\(item.matchedScopes) scopes · tokens \(GovernanceMonitorText.tokenChange(savings: item.tokenSavings))"), color: (projectedTokenDifference ?? 0) >= 0 ? green : pink)
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
                    ForEach(evidenceRows) { row in Text(short(row.id)).tag(row.id) }
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
                            Text(os1Tr("토큰 변화 \(GovernanceMonitorText.tokenChange(savings: item.tokenSavings))",
                                       "Token change \(GovernanceMonitorText.tokenChange(savings: item.tokenSavings))")).foregroundStyle((item.tokenSavings ?? 0) >= 0 ? green : pink)
                            Text(String(format: os1Tr("시도 채택률 차이 %+.1fpp", "Attempt adoption rate difference %+.1fpp"), item.adoptionDelta * 100)).foregroundStyle(item.adoptionDelta >= 0 ? green : pink)
                            Text(os1Tr("지연 단축 \(delta(item.latencySavings))", "Latency reduction \(delta(item.latencySavings))"))
                            Spacer()
                            Text(os1Tr("\(item.matchedScopes)묶음 · 실측 \(item.measuredScopes) · 기준 \(item.baselineAttempts) / 비교 \(item.candidateAttempts)회 · 마지막 \(evidenceStamp(item.latestEvidenceAt))",
                                       "\(item.matchedScopes) scopes · \(item.measuredScopes) measured · baseline \(item.baselineAttempts) / comparison \(item.candidateAttempts) attempts · last \(evidenceStamp(item.latestEvidenceAt))")).foregroundStyle(muted)
                        }.font(.system(size: 11)).monospacedDigit()
                    }.padding(12).background(Color.white.opacity(0.025), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            Text(os1Tr("Governance 기여도: off/on 대조 실행 자료가 연결되기 전에는 미측정입니다. 과거 재시도는 입력·순서 차이가 있어 독립 A/B가 아닙니다.",
                       "Governance contribution: unmeasured until off/on comparison run data is connected. Past retries differ in input and order, so they are not an independent A/B."))
                .font(.system(size: 10)).foregroundStyle(muted)
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
                Text(os1Tr("토큰 변화·채택당 토큰·효율은 양쪽 시도가 모두 실측된 과거 요청 묶음만 계산합니다(n). 토큰 변화는 비교 경로가 기준보다 쓴 토큰의 증감이며 −는 감소입니다. 미측정은 0이 아니라 제외입니다. 후속 시도가 같은 세션을 이어 쓰는 경우가 많아 경로 효과와 세션 재개 효과가 섞입니다. 모든 묶음에서 기준 경로가 먼저 실패한 뒤에만 비교 경로가 실행됐다면 채택 Δ는 선택 편향이며 'B가 A 실패 후 성공' 비율로 표시합니다.",
                           "Token change, tokens per adoption and efficiency are computed only over past request scopes where attempts on both sides were measured (n). Token change is how many more or fewer tokens the comparison route used than the baseline; − means fewer. Unmeasured is excluded, not 0. A later attempt often resumes the same session, so the route effect is mixed with a warm start. When the comparison route ran only after the baseline failed in every scope, the adoption Δ is selection-biased and shown as 'B after A failed' successes."))
                Text(os1Tr("Δ 그래프는 영수증 시각 기준입니다. 각 점은 matched 묶음의 마지막 시도가 끝난 시각의 누적 값이며 선으로 잇고, 마지막 근거부터 지금까지는 마지막 값을 점선으로만 이어 '새 근거 없음'을 표시합니다. 마지막 근거부터 지금까지가 근거 구간보다 길면 그 구간을 오른쪽 1/5로 압축하고 '≈ 14일'처럼 표시합니다. 카드와 그래프는 같은 비교(기록된 전체 근거)를 씁니다. 근거가 기간 시작(전체에서는 7일)보다 오래되면 카드는 값 대신 '경로 비교 없음'을, 그래프 머리글은 작은 회색 '마지막 값 · 날짜'를 표시하고, 묶음이 \(GovernanceDeltaHeadline.minimumScopes)개 미만이면 둘 다 'n이 너무 적음'으로 표시합니다. 실시간 활동 스트립은 기간과 무관하게 최근 30분을 10초 간격으로 보여 줍니다. 모니터는 1초마다 영수증 폴더의 변경 시각을 확인하고 바뀐 파일만 다시 읽습니다. 헤더의 맥박 선은 모니터 동작 표시이며 데이터가 아닙니다. Wilson 표시는 상관된 운영 표본의 명목 구간으로 일반 성능을 보증하지 않습니다.",
                           "Δ charts use receipt time. Each point is the cumulative value when a matched scope's last attempt ended, joined by a line; from the last evidence to now the last value continues only as a dashed line marked 'no new evidence'. When the stretch from the last evidence to now is longer than the evidence itself, it is compressed into the right fifth of the axis and labelled (for example '≈ 14 days'). Cards and charts read the same comparison (all recorded evidence). When the newest evidence is older than the period start (7 days under All), the cards show 'no route comparison' instead of a value and the chart headers show a small gray 'last value · date'; with fewer than \(GovernanceDeltaHeadline.minimumScopes) scopes both show 'too few to compare'. The live activity strip always shows the last 30 minutes in 10-second buckets, whatever the period. The monitor checks the receipt folders' modification times every second and re-reads only changed files. The pulse in the header shows the monitor is running; it is not data. Wilson figures are nominal intervals over correlated operating samples and do not guarantee general performance."))
                Text(os1Tr("과거 기록은 요청당 최대 16회 보관된 시도 표본입니다. 시각·테스크 종료가 없으므로 과거 실행 완료율과 실시간 추이는 소급 생성하지 않습니다. 새 테스크는 별도 원자적 기록으로 누적합니다. 확인된 결과 재전송은 기존 테스크에 합쳐 호출을 중복 계산하지 않습니다.",
                           "Past records are attempt samples, up to 16 kept per request. They carry no timestamps or task finish, so past completion rates and live trends are not generated retroactively. New tasks accumulate as separate atomic records. A re-sent confirmed result is merged into its existing task, so calls are not double-counted."))
                Text(os1Tr("새 기록 \(snapshot.tasks.count)건 · 과거 시도 \(snapshot.historical.count)회 · 읽기/검증 거부 \(snapshot.rejectedRecords)건 · 표시 한도 초과 \(snapshot.omittedFiles)건 · 요금표 미연결: 토큰 절약 ≠ 금액 절약",
                           "\(snapshot.tasks.count) new records · \(snapshot.historical.count) past attempts · \(snapshot.rejectedRecords) rejected on read/verification · \(snapshot.omittedFiles) over display limit · no price table connected: token savings ≠ cost savings"))
            }
            .padding(.top, 8)
        }.font(.system(size: 10)).foregroundStyle(muted).fixedSize(horizontal: false, vertical: true)
    }
}
