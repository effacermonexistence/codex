import Foundation
import OS1Context

/// Settings custody and language resolution: English default, tolerant load,
/// the env override fixtures rely on, and the output-language directive.
func runLocalizationFixtures() throws {
    var count = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Localization: " + message); count += 1
    }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-settings-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let url = root.appendingPathComponent("settings.json")

    // Defaults: ship in English, answer in the user's own language, Codex on.
    let defaults = OS1Settings.load(from: url)
    check(defaults == OS1Settings(interfaceLanguage: "en", outputLanguage: "auto", showCodex: true),
          "missing file loads shipping defaults")
    var settings = defaults
    settings.interfaceLanguage = "ko"; settings.outputLanguage = "ja"; settings.showCodex = false
    try settings.save(to: url)
    check((try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? NSNumber)?.intValue == 0o600,
          "settings file is private")
    check(OS1Settings.load(from: url) == settings, "round trip")
    try Data(#"{"interfaceLanguage":"fr","outputLanguage":"","showCodex":true}"#.utf8).write(to: url)
    let repaired = OS1Settings.load(from: url)
    check(repaired.interfaceLanguage == "en" && repaired.outputLanguage == "auto",
          "unknown interface language and empty output language fall back")
    try Data("not json".utf8).write(to: url)
    check(OS1Settings.load(from: url) == OS1Settings(), "garbage falls back to defaults")

    // The test harness pins OS1_INTERFACE_LANGUAGE=ko before fixtures run.
    check(OS1Localization.interfaceLanguage == "ko", "environment override wins")
    check(os1Tr("한국어", "English") == "한국어", "os1Tr follows the resolved language")

    // Output-language directive: silent for auto, explicit otherwise.
    check(OS1Settings(outputLanguage: "auto").outputLanguageDirective.isEmpty, "auto adds no directive")
    check(OS1Settings(outputLanguage: "en").outputLanguageDirective == "Write the answer in English, regardless of the language of the request or the sources.",
          "known code expands to the language name")
    check(OS1Settings(outputLanguage: "Português").outputLanguageDirective.contains("Português"),
          "unknown names pass through verbatim")
    print("Localization: \(count) checks passed; defaults, private custody, tolerant load, env override, output directive")
}
