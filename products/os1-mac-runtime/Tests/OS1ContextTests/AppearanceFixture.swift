import Foundation
import OS1Context

func runAppearanceFixtures() throws {
    var n = 0
    func check(_ condition: Bool, _ label: String) { precondition(condition, "Appearance: " + label); n += 1 }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-appearance-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let url = root.appendingPathComponent("settings.json")
    let defaults = OS1Settings.load(from: url)
    check(defaults.resolvedAccentColor == "#EDB3CC", "existing native pink is the default")
    check(OS1AccentPalette.presets.count == 8, "eight swatches")
    check(Set(OS1AccentPalette.presets.map(\.hex)).count == 8, "unique swatches")
    for p in OS1AccentPalette.presets {
        var value = defaults; value.accentColor = p.hex; value.parallelRunLimit = 3
        value.interfaceLanguage = "ko"; value.outputLanguage = "ja"; value.showCodex = false
        try value.save(to: url)
        let restored = OS1Settings.load(from: url)
        check(restored == value, p.id + " survives restart and preserves unrelated settings")
        check(restored.resolvedAccentColor == p.hex, p.id + " effective color")
    }
    try Data(#"{"interfaceLanguage":"ko","showCodex":true,"parallelRunLimit":3,"parallelRunLimitVersion":2}"#.utf8).write(to: url)
    check(OS1Settings.load(from: url).resolvedAccentColor == OS1AccentPalette.pink, "old settings decode without migration write")
    for bad in ["pink", "#fff", "url(https://bad)", "#000000;alert(1)", "#GG0000", ""] {
        check(OS1AccentPalette.normalized(bad) == OS1AccentPalette.pink, "invalid color cannot inject CSS")
    }
    check(OS1AccentPalette.normalized(" #edb3cc ") == "#EDB3CC", "hex normalization")
    var custom = defaults; custom.accentColor = "#123456"; try custom.save(to: url)
    check(OS1Settings.load(from: url).resolvedAccentColor == "#123456", "custom color persists")
    let rgb = OS1AccentPalette.rgb("#123456")
    check(abs(rgb.0 - 18.0 / 255) < 0.00001 && abs(rgb.1 - 52.0 / 255) < 0.00001, "color components exact")
    check((try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? NSNumber)?.intValue == 0o600, "settings remain private")
    print("Appearance: \(n) checks PASS; temporary fixtures only; provider calls 0")
}
