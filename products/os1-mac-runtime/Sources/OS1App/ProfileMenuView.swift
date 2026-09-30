import AppKit
import Charts
import OS1Context
import SwiftUI

enum ProfileDestination: String, Identifiable, CaseIterable {
    case account, usage, governance, backends, settings
    var id: Self { self }
    var title: String {
        switch self {
        case .account: return os1Tr("내 계정", "My account")
        case .usage: return os1Tr("사용량", "Usage")
        case .governance: return "RCC Governance"
        case .backends: return os1Tr("연결된 백엔드", "Connected backends")
        case .settings: return os1Tr("설정", "Settings")
        }
    }
    var symbol: String {
        switch self {
        case .account: return "person.crop.circle"
        case .usage: return "chart.bar.xaxis"
        case .governance: return "waveform.path.ecg"
        case .backends: return "rectangle.connected.to.line.below"
        case .settings: return "gearshape"
        }
    }
}

/// Navigation-only state. No conversation, queue, login or execution mutation.
struct ProfileNavigationState: Equatable {
    var governanceOpen = false
    var sheet: ProfileDestination?
    mutating func select(_ destination: ProfileDestination) {
        if destination == .governance { sheet = nil; governanceOpen = true }
        else { sheet = destination }
    }
}

enum ProfileStyle {
    static let accent = Color(red: 0.08, green: 0.66, blue: 0.56)
    static let menu = Color(red: 0.15, green: 0.15, blue: 0.16)
    static let surface = Color(red: 0.085, green: 0.085, blue: 0.095)
    static let secondary = Color(white: 0.64)
    static let width: CGFloat = 304
}

struct ProfileAvatar: View {
    var profile: AppIdentityProfile?
    var size: CGFloat = 38
    var body: some View {
        ZStack {
            Circle().fill(profile == nil ? Color.white.opacity(0.10) : ProfileStyle.accent)
            if let profile {
                Text(profile.initials).font(.system(size: size * 0.33, weight: .medium))
            } else {
                Image(systemName: "person.crop.circle").font(.system(size: size * 0.64, weight: .light))
            }
        }
        .foregroundStyle(Color.white).frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

@MainActor
final class ProfileUsageModel: ObservableObject {
    @Published private(set) var snapshot = GovernanceSnapshot()
    @Published private(set) var loaded = false
    private var refreshing = false
    init(snapshot: GovernanceSnapshot? = nil) {
        if let snapshot { self.snapshot = snapshot; self.loaded = true }
    }
    var summary: AppUsageSummary { AppUsageSummary(snapshot: snapshot) }
    func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        let value = await Task.detached(priority: .utility) { GovernanceActivityStore().snapshot() }.value
        guard !Task.isCancelled else { return }
        snapshot = value; loaded = true
    }
}

struct ProfileMenuView: View {
    let profile: AppIdentityProfile?
    var busy = false
    var usage: AppUsageSummary?
    var select: (ProfileDestination) -> Void
    var signOut: () -> Void

    var body: some View {
        VStack(spacing: 3) {
            Button { select(.account) } label: {
                HStack(spacing: 11) {
                    ProfileAvatar(profile: profile, size: 36)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(profile?.displayName ?? os1Tr("OS-1에 로그인", "Sign in to OS-1"))
                            .font(.system(size: 16, weight: .medium)).lineLimit(1)
                        Text(profile.map { "\($0.provider.title) · OS-1" }
                             ?? os1Tr("로컬 워크스페이스", "Local workspace"))
                            .font(.system(size: 12)).foregroundStyle(ProfileStyle.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 10)).foregroundStyle(ProfileStyle.secondary)
                }.padding(.horizontal, 12).padding(.vertical, 11).contentShape(Rectangle())
            }
            .buttonStyle(ProfileMenuButtonStyle()).accessibilityIdentifier("os1.profile.account")
            separator
            row(.usage)
            HStack {
                Text(os1Tr("최근 7일 · 기록된 토큰", "Last 7 days · recorded tokens"))
                Spacer(minLength: 6)
                Text(usage.map { $0.measuredAttempts == 0 ? "—" : $0.tokens.formatted(.number.notation(.compactName)) } ?? "—")
                    .monospacedDigit()
            }
            .font(.system(size: 11)).foregroundStyle(ProfileStyle.secondary)
            .padding(.leading, 42).padding(.trailing, 14).padding(.bottom, 8)
            row(.governance)
            row(.backends)
            separator
            row(.settings, shortcut: "⌘,")
            if profile != nil {
                Button(action: signOut) {
                    HStack(spacing: 12) {
                        Image(systemName: "rectangle.portrait.and.arrow.right").frame(width: 20)
                        Text(os1Tr("OS-1 로그아웃", "Log out of OS-1"))
                        Spacer()
                    }.font(.system(size: 14)).padding(.horizontal, 12).frame(height: 38).contentShape(Rectangle())
                }
                .buttonStyle(ProfileMenuButtonStyle()).disabled(busy)
                .accessibilityIdentifier("os1.profile.signout")
            }
        }
        .padding(9).frame(width: ProfileStyle.width)
        .foregroundStyle(Color(white: 0.95))
        .background(ProfileStyle.menu, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.white.opacity(0.10), lineWidth: 1))
        .preferredColorScheme(.dark)
    }
    private var separator: some View {
        Rectangle().fill(Color.white.opacity(0.09)).frame(height: 1).padding(.horizontal, 7).padding(.vertical, 5)
    }
    private func row(_ destination: ProfileDestination, shortcut: String? = nil) -> some View {
        Button { select(destination) } label: {
            HStack(spacing: 12) {
                Image(systemName: destination.symbol).font(.system(size: 17, weight: .regular))
                    .foregroundStyle(Color(white: 0.76)).frame(width: 20)
                Text(destination.title).font(.system(size: 14))
                Spacer()
                if let shortcut { Text(shortcut).font(.system(size: 12)).foregroundStyle(ProfileStyle.secondary) }
            }.padding(.horizontal, 12).frame(height: 38).contentShape(Rectangle())
        }
        .buttonStyle(ProfileMenuButtonStyle()).accessibilityIdentifier("os1.profile.\(destination.rawValue)")
    }
}

private struct ProfileMenuButtonStyle: ButtonStyle {
    @State private var hovering = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(Color.white.opacity(configuration.isPressed ? 0.13 : (hovering ? 0.07 : 0)),
                        in: RoundedRectangle(cornerRadius: 8))
            .onHover { hovering = $0 }
    }
}

struct OS1IdentityPanel: View {
    @ObservedObject var model: OS1IdentityModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack(spacing: 14) {
                    ProfileAvatar(profile: model.profile, size: 56)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(model.profile?.displayName ?? os1Tr("나의 OS-1", "Your OS-1"))
                            .font(.system(size: 23, weight: .semibold)).textSelection(.enabled)
                        Text(model.profile?.email ?? os1Tr("Google 또는 Apple 계정으로 로그인", "Sign in with Google or Apple"))
                            .font(.system(size: 13)).foregroundStyle(ProfileStyle.secondary).textSelection(.enabled)
                    }
                }
                if let profile = model.profile {
                    Label(os1Tr("\(profile.provider.title)에서 확인한 계정", "Account verified by \(profile.provider.title)"), systemImage: "checkmark.shield")
                        .foregroundStyle(ProfileStyle.accent).font(.system(size: 12))
                    Text(os1Tr("다른 계정으로 로그인", "Sign in with another account")).font(.headline)
                }
                VStack(spacing: 12) {
                    provider(.google, symbol: "g.circle.fill")
                    provider(.apple, symbol: "apple.logo")
                }
                if model.busy {
                    HStack {
                        ProgressView().controlSize(.small)
                        Text(os1Tr("계정 확인 중…", "Verifying account…")).font(.system(size: 12))
                        Spacer()
                        Button(os1Tr("취소", "Cancel")) { model.cancel() }
                    }
                }
                if let notice = model.notice {
                    Text(notice).font(.system(size: 12)).foregroundStyle(Color.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Divider()
                Label(os1Tr("이 Mac의 워크스페이스", "This Mac's workspace"), systemImage: "desktopcomputer").font(.headline)
                Text(os1Tr("OS-1 프로필과 Codex·Claude 로그인은 별개입니다. 이 버전의 대화·큐·파일·사용량은 macOS 사용자 로컬 데이터이며 OS-1 계정 전환으로 이동하거나 분리되지 않습니다. 클라우드 동기화는 연결되어 있지 않습니다.",
                           "Your OS-1 profile is separate from Codex and Claude sign-ins. Conversations, queues, files and usage belong to this macOS user's local workspace; switching OS-1 profiles does not move or isolate that data. Cloud sync is not connected."))
                    .font(.system(size: 12)).foregroundStyle(ProfileStyle.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if model.profile != nil {
                    Button(os1Tr("OS-1 로그아웃", "Log out of OS-1")) { model.signOut() }.disabled(model.busy)
                }
            }.padding(28)
        }.background(ProfileStyle.surface).foregroundStyle(Color.white)
    }
    private func provider(_ provider: AppIdentityProvider, symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Button { model.beginSignIn(provider) } label: {
                HStack(spacing: 9) {
                    Image(systemName: symbol).font(.system(size: 19))
                    Text(os1Tr("\(provider.title)로 계속하기", "Continue with \(provider.title)")).font(.system(size: 14, weight: .medium))
                }.frame(maxWidth: .infinity).frame(height: 44)
                    .foregroundStyle(provider == .apple ? Color.black : Color.white)
                    .background(provider == .apple ? Color.white : Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.13)))
            }
            .buttonStyle(.plain).disabled(model.busy || !model.configuration.available(provider))
            .accessibilityIdentifier("os1.signin.\(provider.rawValue)")
            if !model.configuration.available(provider) {
                Text(model.setupMessage(provider)).font(.system(size: 11)).foregroundStyle(ProfileStyle.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct ProfileUsageView: View {
    @ObservedObject var model: ProfileUsageModel
    var preview = false
    @State private var provider = "all"
    private var summary: AppUsageSummary { AppUsageSummary(snapshot: model.snapshot, provider: provider == "all" ? nil : provider) }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(os1Tr("최근 7일", "Last 7 days")).font(.system(size: 23, weight: .semibold))
                        Text(os1Tr("이 Mac · OS-1 실행 기록", "This Mac · OS-1 execution records"))
                            .font(.system(size: 12)).foregroundStyle(ProfileStyle.secondary)
                    }
                    Spacer()
                    Picker(os1Tr("백엔드", "Backend"), selection: $provider) {
                        Text(os1Tr("전체", "All")).tag("all")
                        Text("Codex").tag("codex")
                        Text("Claude").tag("claude")
                    }.pickerStyle(.segmented).frame(width: 230)
                }
                HStack(spacing: 40) {
                    metric(os1Tr("기록된 토큰", "Recorded tokens"), value: summary.measuredAttempts == 0 ? "—" : summary.tokens.formatted())
                    metric(os1Tr("작업", "Tasks"), value: summary.tasks.formatted())
                    metric(os1Tr("계측 누락 작업", "Unmetered tasks"), value: summary.unmeteredTasks.formatted())
                }
                if summary.measuredAttempts == 0 {
                    VStack(spacing: 10) {
                        Image(systemName: "chart.bar.xaxis").font(.system(size: 32, weight: .light))
                        Text(os1Tr("아직 기록된 사용량이 없습니다", "No recorded usage yet")).font(.headline)
                        Text(os1Tr("작업의 토큰 계측이 도착하면 여기에 표시됩니다.", "Token measurements appear here as tasks report them."))
                            .font(.system(size: 12)).foregroundStyle(ProfileStyle.secondary)
                    }.frame(maxWidth: .infinity).frame(height: 200)
                } else {
                    Chart(summary.days) { day in
                        BarMark(x: .value("Day", day.id, unit: .day), y: .value("Tokens", day.tokens))
                            .foregroundStyle(ProfileStyle.accent.gradient).cornerRadius(4)
                    }
                    .chartXAxis { AxisMarks(values: .stride(by: .day)) { _ in AxisValueLabel(format: .dateTime.weekday(.abbreviated)) } }
                    .frame(height: 200)
                    .accessibilityLabel(os1Tr("날짜별 기록된 토큰 사용량", "Recorded tokens by day"))
                }
                Text(os1Tr("작업 시작일 기준으로 기록된 토큰만 합산합니다. 공급자 전체 사용량·구독 잔여 한도·청구액은 이 기록으로 계산하지 않습니다. 계정별 클라우드 통계가 아닙니다.",
                           "Recorded tokens are grouped by task start date. These records do not determine provider-wide usage, remaining subscription limits or billing. This is not account-scoped cloud analytics."))
                    .font(.system(size: 12)).foregroundStyle(ProfileStyle.secondary).fixedSize(horizontal: false, vertical: true)
                if model.snapshot.rejectedRecords > 0 || model.snapshot.omittedFiles > 0 {
                    Text(os1Tr("일부 기록을 읽지 못해 집계가 불완전할 수 있습니다.", "Some records could not be read; totals may be incomplete."))
                        .font(.system(size: 12)).foregroundStyle(Color.orange)
                }
            }.padding(28)
        }
        .background(ProfileStyle.surface).foregroundStyle(Color.white)
        .task {
            guard !preview else { return }
            while !Task.isCancelled { await model.refresh(); try? await Task.sleep(for: .seconds(10)) }
        }
    }
    private func metric(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 11)).foregroundStyle(ProfileStyle.secondary)
            Text(value).font(.system(size: 25, weight: .medium, design: .rounded)).monospacedDigit()
        }
    }
}
