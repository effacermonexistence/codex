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

    // Codex's language list: en-US plus its 64 locale bundles, one row each,
    // labelled in the language's own name and sorted the way Codex sorts.
    let catalog = OS1LanguageCatalog.all
    check(catalog.count == 65 && Set(catalog.map(\.code)).count == 65, "the catalog is Codex's 65 languages, no duplicates")
    check(catalog.first { $0.code == "ko-KR" }?.nativeName == "한국어" && catalog.first { $0.code == "ja-JP" }?.nativeName == "日本語"
          && catalog.first { $0.code == "zh-TW" }?.nativeName == "繁體中文（台灣）", "rows are labelled in their own language")
    check(catalog.first?.code == "ms-MY" && catalog.last?.code == "zh-HK", "Codex's order is kept")
    // The interface picker offers exactly the languages the interface is
    // written in, the same rule Codex uses for its own list.
    check(OS1LanguageCatalog.interface.map(\.code) == ["en-US", "ko-KR"], "interface languages are English and Korean")

    // Tags resolve the way Codex resolves them.
    let resolved = ["en": "en-US", "EN_gb": "en-US", "ko": "ko-KR", "ko-KR": "ko-KR", "zh": "zh-CN", "zh-Hans": "zh-CN",
                    "zh-Hant": "zh-TW", "zh-Hant-HK": "zh-HK", "pt": "pt-BR", "pt-PT": "pt-PT", "es": "es-ES",
                    "es-419": "es-419", "fr-CA": "fr-CA", "ja": "ja-JP"]
    for (tag, code) in resolved {
        check(OS1LanguageCatalog.language(for: tag)?.code == code, "\(tag) resolves to \(code)")
    }
    check(OS1LanguageCatalog.language(for: "xx") == nil && OS1LanguageCatalog.language(for: "Português") == nil
          && OS1LanguageCatalog.language(for: " ") == nil, "unknown tags and typed names resolve to nothing")

    // Codex's search: own name, English name, and the name in the interface language.
    func found(_ query: String, _ ui: String, _ languages: [OS1Language] = catalog) -> [String] {
        OS1LanguageCatalog.filter(languages, query: query, interfaceLanguage: ui).map(\.code)
    }
    check(found("kor", "en") == ["ko-KR"] && found("한국", "en") == ["ko-KR"], "English and native names match")
    check(found("일본", "ko") == ["ja-JP"] && found("일본", "en").isEmpty, "the interface-language name matches only in that interface")
    check(found("DEUTSCH", "en") == ["de-DE"] && found("  ", "en").count == 65, "case is ignored; an empty query lists everything")
    check(found("chinese", "en") == ["zh-CN", "zh-TW", "zh-HK"], "every match is listed in catalog order")

    // English is the default; the picker maps the stored value both ways.
    check(OS1Settings().interfaceLanguage == "en" && OS1Settings().interfaceLanguageCode == "en-US",
          "a fresh install shows English")
    var picked = OS1Settings()
    picked.setInterfaceLanguage(code: "ko-KR")
    check(picked.interfaceLanguage == "ko" && picked.interfaceLanguageCode == "ko-KR", "choosing 한국어 stores ko")
    picked.setInterfaceLanguage(code: nil)
    check(picked.interfaceLanguage == "system" && picked.interfaceLanguageCode == nil, "Auto detect stores system")
    picked.setInterfaceLanguage(code: "en-US")
    check(picked.interfaceLanguage == "en", "choosing English stores en")
    check(OS1Settings.normalizedInterfaceLanguage("ko-KR") == "ko" && OS1Settings.normalizedInterfaceLanguage("en_GB") == "en"
          && OS1Settings.normalizedInterfaceLanguage("Auto") == "system" && OS1Settings.normalizedInterfaceLanguage("ja-JP") == "en",
          "Codex-style codes normalize; untranslated languages fall back to English")
    try Data(#"{"interfaceLanguage":"ko-KR","outputLanguage":"auto","showCodex":true}"#.utf8).write(to: url)
    check(OS1Settings.load(from: url).interfaceLanguage == "ko", "a Codex-style interface code loads")

    // Auto detect follows macOS's language order to the first interface language.
    check(OS1Localization.systemInterfaceLanguage(preferred: ["fr-FR", "ko-KR", "en-US"]) == "ko"
          && OS1Localization.systemInterfaceLanguage(preferred: ["en-US", "ko"]) == "en"
          && OS1Localization.systemInterfaceLanguage(preferred: ["fr-FR", "de"]) == "en"
          && OS1Localization.systemInterfaceLanguage(preferred: []) == "en", "Auto detect resolution")

    // Response language: every catalog language, with legacy values kept.
    picked.setOutputLanguage(code: "ja-JP")
    check(picked.outputLanguage == "ja-JP" && picked.outputLanguageCode == "ja-JP", "a catalog response language is stored as its code")
    check(OS1Settings(outputLanguage: "ja").outputLanguageCode == "ja-JP" && OS1Settings(outputLanguage: "auto").outputLanguageCode == nil
          && OS1Settings(outputLanguage: "Português").outputLanguageCode == "Português", "legacy and typed values still select")
    picked.setOutputLanguage(code: nil)
    check(picked.outputLanguage == "auto", "Auto stores auto")
    check(OS1Settings(outputLanguage: "ja-JP").outputLanguageDirective.hasPrefix("Write the answer in Japanese,")
          && OS1Settings(outputLanguage: "pt-BR").outputLanguageDirective.hasPrefix("Write the answer in Portuguese (Brazil),")
          && OS1Settings(outputLanguage: "zh").outputLanguageDirective.hasPrefix("Write the answer in Chinese,")
          && OS1Settings(outputLanguage: "ko").outputLanguageDirective.hasPrefix("Write the answer in Korean,"),
          "the directive names the language in English")

    print("Localization: \(count) checks passed; defaults, private custody, tolerant load, env override, output directive")
}
