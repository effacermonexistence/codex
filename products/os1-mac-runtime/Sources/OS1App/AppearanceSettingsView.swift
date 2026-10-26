import AppKit
import SwiftUI
import OS1Context

/// Small locked cache: fixtures do not mutate it and drawing never reads disk.
final class OS1AppearanceState: @unchecked Sendable {
    static let shared = OS1AppearanceState()
    private let lock = NSLock()
    private var value = OS1AccentPalette.pink
    var accent: String { lock.lock(); defer { lock.unlock() }; return value }
    func set(_ hex: String) { lock.lock(); defer { lock.unlock() }; value = OS1AccentPalette.normalized(hex) }
}

func os1AccentColor(_ hex: String) -> Color {
    let (r, g, b) = OS1AccentPalette.rgb(hex)
    return Color(red: r, green: g, blue: b)
}

struct OS1AppearanceSettingsRow: View {
    let accent: String
    let select: (String) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(os1Tr("강조 색상", "Accent color"))
                Spacer()
                Text(accent).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary)
            }
            HStack(spacing: 14) {
                ForEach(OS1AccentPalette.presets, id: \.id) { item in
                    Button { select(item.hex) } label: {
                        Circle().fill(os1AccentColor(item.hex)).frame(width: 28, height: 28)
                            .overlay(Circle().strokeBorder(Color.white, lineWidth: accent == item.hex ? 2 : 0).padding(-4))
                            .overlay { if accent == item.hex { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.black) } }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(os1Tr(item.korean, item.english))
                    .accessibilityValue(accent == item.hex ? os1Tr("선택됨", "Selected") : os1Tr("선택 안 됨", "Not selected"))
                    .accessibilityIdentifier("os1.appearance." + item.id)
                    .help(os1Tr(item.korean, item.english))
                }
            }.padding(4)
            ColorPicker(os1Tr("사용자 지정 색상", "Custom color"), selection: Binding(
                get: { os1AccentColor(accent) },
                set: { color in
                    guard let c = NSColor(color).usingColorSpace(.sRGB) else { return }
                    select(String(format: "#%02X%02X%02X", Int((c.redComponent * 255).rounded()), Int((c.greenComponent * 255).rounded()), Int((c.blueComponent * 255).rounded())))
                }), supportsOpacity: false)
                .accessibilityIdentifier("os1.appearance.custom")
            HStack(spacing: 10) {
                Image(systemName: "sparkles").foregroundStyle(os1AccentColor(accent))
                Text(os1Tr("OS1과 클래식 SCV 화면에 바로 적용됩니다.", "Applies immediately to OS1 and the classic SCV surface."))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                Image(systemName: "command").foregroundStyle(os1AccentColor(accent))
                Text("OS1 · CLASSIC").font(.system(size: 12, weight: .semibold, design: .monospaced))
                Spacer()
                Text(os1Tr("미리보기", "Preview")).font(.caption).foregroundStyle(os1AccentColor(accent))
            }.padding(14).background(os1AccentColor(accent).opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(os1AccentColor(accent).opacity(0.35)))
        }.padding(.vertical, 5)
    }
}
