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
    // Rail surface custody: one tile is one account with two ways to spend it,
    // so the stored value must survive a restart and must never be able to move
    // a tile onto the other account.
    try? FileManager.default.removeItem(at: url)
    let fresh = OS1Settings.load(from: url)
    check(fresh.surface(for: .openAI) == .codex && fresh.surface(for: .anthropic) == .claude,
          "a missing settings file routes each tile to its executor")
    check(fresh.openAISurface == nil && fresh.anthropicSurface == nil,
          "the default surface is stored as absent, not written as an override")
    var chosen = fresh
    chosen.setSurface(.chatgpt, for: .openAI)
    chosen.setSurface(.claudeChat, for: .anthropic)
    try chosen.save(to: url)
    let reloaded = OS1Settings.load(from: url)
    check(reloaded.surface(for: .openAI) == .chatgpt && reloaded.surface(for: .anthropic) == .claudeChat,
          "both chosen surfaces survive a restart")
    // Returning to the executor clears the stored override rather than pinning it.
    var cleared = reloaded
    cleared.setSurface(.codex, for: .openAI)
    check(cleared.openAISurface == nil && cleared.surface(for: .openAI) == .codex,
          "choosing the executor again stores nothing")
    // A surface belonging to the other tile is refused at the setter.
    var crossed = fresh
    crossed.setSurface(.claudeChat, for: .openAI)
    check(crossed.openAISurface == nil && crossed.surface(for: .openAI) == .codex,
          "the setter refuses a surface from the other account")
    // A hand-edited file is normalized on load, so the stored value and the
    // routed value can never disagree.
    try Data(#"{"interfaceLanguage":"en","outputLanguage":"auto","showCodex":true,"openAISurface":"claude-chat","anthropicSurface":"chatgpt"}"#.utf8).write(to: url)
    let normalized = OS1Settings.load(from: url)
    check(normalized.surface(for: .openAI) == .codex && normalized.surface(for: .anthropic) == .claude,
          "a hand-edited foreign surface falls back to each tile's executor")
    check(normalized.openAISurface == nil && normalized.anthropicSurface == nil,
          "the foreign value is not carried forward in the stored file")
    try Data(#"{"interfaceLanguage":"en","outputLanguage":"auto","showCodex":true,"openAISurface":"chatgpt"}"#.utf8).write(to: url)
    check(OS1Settings.load(from: url).surface(for: .openAI) == .chatgpt,
          "a valid hand-edited surface is honoured")

    print("Localization: \(count) checks passed; defaults, private custody, tolerant load, env override, output directive")
}
