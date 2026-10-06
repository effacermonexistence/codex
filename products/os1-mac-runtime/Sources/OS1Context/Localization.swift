import Foundation

/// User-facing runtime settings, stored like Codex's config: a small JSON
/// file the app edits through its Settings window and every OS-1 process
/// reads. Ships with English as the default interface language; output
/// language follows the user's own message unless pinned.
public struct OS1Settings: Codable, Equatable, Sendable {
    /// "en", "ko", or "system" (Codex's "Auto detect": follow macOS).
    public var interfaceLanguage: String
    /// "auto" (answer in the language of the user's message) or an explicit
    /// language: a catalog code such as "ja-JP", a bare code such as "ko", or
    /// a name typed by hand.
    public var outputLanguage: String
    /// Show the Codex backend in the rail and allow routing to it.
    public var showCodex: Bool
    /// Route automatic work to Codex when its quota window is about to reset
    /// with quota left. Optional so older settings files still decode.
    public var burnCodexBeforeReset: Bool? = nil
    /// Hours before the window reset at which the burn starts (default 12).
    public var codexBurnLeadHours: Int? = nil
    /// Which surface each rail tile routes to. One OpenAI sign-in can send the
    /// turn to Codex (OS-1 executes) or hand it to the ChatGPT app (the owner
    /// runs it); one Anthropic sign-in can use the full Claude Code lane or the
    /// bounded read-only chat lane. Stored raw and resolved through
    /// `ProviderSurface.Backend`, so a hand-edited file cannot move a tile onto
    /// the other account. Optional so older settings files still decode; read
    /// them through `surface(for:)`.
    public var openAISurface: String? = nil
    public var anthropicSurface: String? = nil

    /// The surface a tile actually routes to, with an unknown or foreign value
    /// falling back to that tile's executor.
    public func surface(for backend: ProviderSurface.Backend) -> ProviderSurface {
        switch backend {
        case .openAI: return backend.resolve(openAISurface)
        case .anthropic: return backend.resolve(anthropicSurface)
        }
    }

    /// Record a tile's chosen surface. A surface belonging to another tile is
    /// rejected rather than stored, so the selection cannot be made incoherent.
    public mutating func setSurface(_ surface: ProviderSurface, for backend: ProviderSurface.Backend) {
        guard backend.surfaces.contains(surface) else { return }
        let raw = surface == backend.defaultSurface ? nil : surface.rawValue
        switch backend {
        case .openAI: openAISurface = raw
        case .anthropic: anthropicSurface = raw
        }
    }

    /// Conversations OS-1 may run at the same time. Nil means no slot cap;
    /// admission still applies the runtime's memory-pressure guard. Read this
    /// through `parallelRuns` to normalize an explicitly selected finite cap.
    public var parallelRunLimit: Int? = nil

    /// Explicit finite choices. Unlimited is a separate nil state, never a
    /// large integer sentinel that can accidentally become a slot cap.
    public static let parallelRunRange = 1...64
    public static let defaultParallelRuns: Int? = nil

    /// Preserve unlimited while bounding a hand-edited finite value.
    public static func clampedParallelRuns(_ value: Int?) -> Int? {
        guard let value else { return defaultParallelRuns }
        return min(max(value, parallelRunRange.lowerBound), parallelRunRange.upperBound)
    }

    public var parallelRuns: Int? { OS1Settings.clampedParallelRuns(parallelRunLimit) }

    public init(interfaceLanguage: String = "en", outputLanguage: String = "auto", showCodex: Bool = true) {
        self.interfaceLanguage = interfaceLanguage
        self.outputLanguage = outputLanguage
        self.showCodex = showCodex
    }

    private enum CodingKeys: String, CodingKey {
        case interfaceLanguage, outputLanguage, showCodex
        case burnCodexBeforeReset, codexBurnLeadHours
        case openAISurface, anthropicSurface
        case parallelRunLimit, parallelRunLimitVersion
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        interfaceLanguage = try values.decodeIfPresent(String.self, forKey: .interfaceLanguage) ?? "en"
        outputLanguage = try values.decodeIfPresent(String.self, forKey: .outputLanguage) ?? "auto"
        showCodex = try values.decodeIfPresent(Bool.self, forKey: .showCodex) ?? true
        burnCodexBeforeReset = try values.decodeIfPresent(Bool.self, forKey: .burnCodexBeforeReset)
        codexBurnLeadHours = try values.decodeIfPresent(Int.self, forKey: .codexBurnLeadHours)
        openAISurface = try values.decodeIfPresent(String.self, forKey: .openAISurface)
        anthropicSurface = try values.decodeIfPresent(String.self, forKey: .anthropicSurface)
        let version = try values.decodeIfPresent(Int.self, forKey: .parallelRunLimitVersion) ?? 1
        let limit = try values.decodeIfPresent(Int.self, forKey: .parallelRunLimit)
        // The old maximum (12) represented "as parallel as possible". Only an
        // old-format 12 migrates; 1...11 were deliberate owner choices. A
        // settings-only format marker distinguishes a newly chosen finite 12.
        parallelRunLimit = version < 2 && limit == 12 ? nil : Self.clampedParallelRuns(limit)
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(interfaceLanguage, forKey: .interfaceLanguage)
        try values.encode(outputLanguage, forKey: .outputLanguage)
        try values.encode(showCodex, forKey: .showCodex)
        try values.encodeIfPresent(burnCodexBeforeReset, forKey: .burnCodexBeforeReset)
        try values.encodeIfPresent(codexBurnLeadHours, forKey: .codexBurnLeadHours)
        try values.encodeIfPresent(openAISurface, forKey: .openAISurface)
        try values.encodeIfPresent(anthropicSurface, forKey: .anthropicSurface)
        try values.encodeIfPresent(parallelRuns, forKey: .parallelRunLimit)
        try values.encode(2, forKey: .parallelRunLimitVersion)
    }

    public var burnPolicy: QuotaWindowPolicy.Settings {
        QuotaWindowPolicy.Settings(enabled: burnCodexBeforeReset ?? true, leadHours: Double(codexBurnLeadHours ?? 12))
    }

    public static var defaultURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1/settings.json")
    }

    public static func load(from url: URL = OS1Settings.defaultURL) -> OS1Settings {
        guard let data = try? Data(contentsOf: url), data.count <= 16_384,
              let value = try? JSONDecoder().decode(OS1Settings.self, from: data) else { return OS1Settings() }
        var settings = value
        settings.interfaceLanguage = normalizedInterfaceLanguage(settings.interfaceLanguage)
        if settings.outputLanguage.isEmpty || settings.outputLanguage.count > 40 { settings.outputLanguage = "auto" }
        // Normalize finite values without replacing the unlimited state.
        settings.parallelRunLimit = clampedParallelRuns(settings.parallelRunLimit)
        // A hand-edited surface must not survive as written: resolve it through
        // its own tile so the stored value and the routed value cannot differ.
        for backend in ProviderSurface.Backend.allCases {
            settings.setSurface(settings.surface(for: backend), for: backend)
        }
        return settings
    }

    public func save(to url: URL = OS1Settings.defaultURL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .prettyPrinted]
        try encoder.encode(self).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        OS1Localization.invalidate()
    }

    /// The stored interface value for a raw setting: "en", "ko" or "system".
    /// Also accepts the locale codes Codex stores ("en-US", "ko-KR") and its
    /// automatic choice, so a file written either way loads; a language the
    /// interface is not written in falls back to the English default.
    public static func normalizedInterfaceLanguage(_ raw: String) -> String {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if ["system", "auto", "auto-detect", "autodetect"].contains(value) { return "system" }
        return OS1LanguageCatalog.language(for: value)?.code == "ko-KR" ? "ko" : "en"
    }

    /// The catalog code the interface picker shows as chosen; nil is "Auto detect".
    public var interfaceLanguageCode: String? {
        switch interfaceLanguage {
        case "system": return nil
        case "ko": return "ko-KR"
        default: return "en-US"
        }
    }

    public mutating func setInterfaceLanguage(code: String?) {
        interfaceLanguage = code.map(OS1Settings.normalizedInterfaceLanguage) ?? "system"
    }

    /// The catalog code the response picker shows as chosen; nil is "Auto".
    /// A hand-typed name outside the catalog is returned as written.
    public var outputLanguageCode: String? {
        let value = outputLanguage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.lowercased() != "auto" else { return nil }
        return OS1LanguageCatalog.language(for: value)?.code ?? value
    }

    public mutating func setOutputLanguage(code: String?) {
        outputLanguage = code ?? "auto"
    }

    /// Instruction appended to a backend dispatch. Empty for "auto": models
    /// already answer in the user's language; pinning is the explicit case.
    public var outputLanguageDirective: String {
        let value = outputLanguage.trimmingCharacters(in: .whitespaces)
        guard !value.isEmpty, value.lowercased() != "auto" else { return "" }
        return "Write the answer in \(OS1Settings.languageName(value)), regardless of the language of the request or the sources."
    }

    /// English name of a stored response language: a catalog code reads as its
    /// English label ("Portuguese (Brazil)"), a bare code as the plain language
    /// ("es" → "Spanish"), and anything else — a name typed by hand — verbatim.
    static func languageName(_ value: String) -> String {
        guard let language = OS1LanguageCatalog.language(for: value) else { return value }
        let regional = value.contains("-") || value.contains("_")
        guard !regional, let plain = language.englishName.components(separatedBy: " (").first else { return language.englishName }
        return plain
    }
}

/// One language in Codex's Settings → General → Language list (Codex desktop
/// 26.928.31416: en-US plus its 64 locale bundles), labelled the way Codex
/// labels it — in its own name. The English and Korean names are what a
/// search matches in either interface language, as Codex's search does.
public struct OS1Language: Equatable, Hashable, Sendable, Identifiable {
    /// The locale code Codex stores for the choice: "en-US", "ko-KR", "ja-JP".
    public let code: String
    public let nativeName: String
    public let englishName: String
    public let koreanName: String
    public var id: String { code }
}

public enum OS1LanguageCatalog {
    /// Codex's list in Codex's order (sorted by native name).
    public static let all: [OS1Language] = [
        OS1Language(code: "ms-MY", nativeName: "Bahasa Melayu", englishName: "Malay", koreanName: "말레이어"),
        OS1Language(code: "bs-BA", nativeName: "bosanski", englishName: "Bosnian", koreanName: "보스니아어"),
        OS1Language(code: "ca-ES", nativeName: "català", englishName: "Catalan", koreanName: "카탈로니아어"),
        OS1Language(code: "cs-CZ", nativeName: "čeština", englishName: "Czech", koreanName: "체코어"),
        OS1Language(code: "da-DK", nativeName: "dansk", englishName: "Danish", koreanName: "덴마크어"),
        OS1Language(code: "de-DE", nativeName: "Deutsch", englishName: "German", koreanName: "독일어"),
        OS1Language(code: "et-EE", nativeName: "eesti", englishName: "Estonian", koreanName: "에스토니아어"),
        OS1Language(code: "en-US", nativeName: "English", englishName: "English", koreanName: "영어"),
        OS1Language(code: "es-ES", nativeName: "español (España)", englishName: "Spanish (Spain)", koreanName: "스페인어(스페인)"),
        OS1Language(code: "es-419", nativeName: "español (Latinoamérica)", englishName: "Spanish (Latin America)", koreanName: "스페인어(라틴 아메리카)"),
        OS1Language(code: "tl", nativeName: "Filipino", englishName: "Filipino", koreanName: "필리핀어"),
        OS1Language(code: "fr-CA", nativeName: "français (Canada)", englishName: "French (Canada)", koreanName: "프랑스어(캐나다)"),
        OS1Language(code: "fr-FR", nativeName: "français (France)", englishName: "French (France)", koreanName: "프랑스어(프랑스)"),
        OS1Language(code: "hr-HR", nativeName: "hrvatski", englishName: "Croatian", koreanName: "크로아티아어"),
        OS1Language(code: "id-ID", nativeName: "Indonesia", englishName: "Indonesian", koreanName: "인도네시아어"),
        OS1Language(code: "is-IS", nativeName: "íslenska", englishName: "Icelandic", koreanName: "아이슬란드어"),
        OS1Language(code: "it-IT", nativeName: "italiano", englishName: "Italian", koreanName: "이탈리아어"),
        OS1Language(code: "sw-TZ", nativeName: "Kiswahili", englishName: "Swahili", koreanName: "스와힐리어"),
        OS1Language(code: "lv-LV", nativeName: "latviešu", englishName: "Latvian", koreanName: "라트비아어"),
        OS1Language(code: "lt", nativeName: "lietuvių", englishName: "Lithuanian", koreanName: "리투아니아어"),
        OS1Language(code: "hu-HU", nativeName: "magyar", englishName: "Hungarian", koreanName: "헝가리어"),
        OS1Language(code: "nl-NL", nativeName: "Nederlands", englishName: "Dutch", koreanName: "네덜란드어"),
        OS1Language(code: "nb-NO", nativeName: "norsk bokmål", englishName: "Norwegian Bokmål", koreanName: "노르웨이어(보크말)"),
        OS1Language(code: "pl-PL", nativeName: "polski", englishName: "Polish", koreanName: "폴란드어"),
        OS1Language(code: "pt-BR", nativeName: "português (Brasil)", englishName: "Portuguese (Brazil)", koreanName: "포르투갈어(브라질)"),
        OS1Language(code: "pt-PT", nativeName: "português (Portugal)", englishName: "Portuguese (Portugal)", koreanName: "포르투갈어(포르투갈)"),
        OS1Language(code: "ro-RO", nativeName: "română", englishName: "Romanian", koreanName: "루마니아어"),
        OS1Language(code: "sq-AL", nativeName: "shqip", englishName: "Albanian", koreanName: "알바니아어"),
        OS1Language(code: "sk-SK", nativeName: "slovenčina", englishName: "Slovak", koreanName: "슬로바키아어"),
        OS1Language(code: "sl-SI", nativeName: "slovenščina", englishName: "Slovenian", koreanName: "슬로베니아어"),
        OS1Language(code: "so-SO", nativeName: "Soomaali", englishName: "Somali", koreanName: "소말리아어"),
        OS1Language(code: "fi-FI", nativeName: "suomi", englishName: "Finnish", koreanName: "핀란드어"),
        OS1Language(code: "sv-SE", nativeName: "svenska", englishName: "Swedish", koreanName: "스웨덴어"),
        OS1Language(code: "vi-VN", nativeName: "Tiếng Việt", englishName: "Vietnamese", koreanName: "베트남어"),
        OS1Language(code: "tr-TR", nativeName: "Türkçe", englishName: "Turkish", koreanName: "튀르키예어"),
        OS1Language(code: "el-GR", nativeName: "Ελληνικά", englishName: "Greek", koreanName: "그리스어"),
        OS1Language(code: "bg-BG", nativeName: "български", englishName: "Bulgarian", koreanName: "불가리아어"),
        OS1Language(code: "kk", nativeName: "қазақ тілі", englishName: "Kazakh", koreanName: "카자흐어"),
        OS1Language(code: "mk-MK", nativeName: "македонски", englishName: "Macedonian", koreanName: "마케도니아어"),
        OS1Language(code: "mn", nativeName: "монгол", englishName: "Mongolian", koreanName: "몽골어"),
        OS1Language(code: "ru-RU", nativeName: "русский", englishName: "Russian", koreanName: "러시아어"),
        OS1Language(code: "sr-RS", nativeName: "српски", englishName: "Serbian", koreanName: "세르비아어"),
        OS1Language(code: "uk-UA", nativeName: "українська", englishName: "Ukrainian", koreanName: "우크라이나어"),
        OS1Language(code: "ka-GE", nativeName: "ქართული", englishName: "Georgian", koreanName: "조지아어"),
        OS1Language(code: "hy-AM", nativeName: "հայերեն", englishName: "Armenian", koreanName: "아르메니아어"),
        OS1Language(code: "ur", nativeName: "اردو", englishName: "Urdu", koreanName: "우르두어"),
        OS1Language(code: "ar", nativeName: "العربية", englishName: "Arabic", koreanName: "아랍어"),
        OS1Language(code: "fa", nativeName: "فارسی", englishName: "Persian", koreanName: "페르시아어"),
        OS1Language(code: "am", nativeName: "አማርኛ", englishName: "Amharic", koreanName: "암하라어"),
        OS1Language(code: "mr-IN", nativeName: "मराठी", englishName: "Marathi", koreanName: "마라티어"),
        OS1Language(code: "hi-IN", nativeName: "हिन्दी", englishName: "Hindi", koreanName: "힌디어"),
        OS1Language(code: "bn-BD", nativeName: "বাংলা", englishName: "Bangla", koreanName: "벵골어"),
        OS1Language(code: "pa", nativeName: "ਪੰਜਾਬੀ", englishName: "Punjabi", koreanName: "펀자브어"),
        OS1Language(code: "gu-IN", nativeName: "ગુજરાતી", englishName: "Gujarati", koreanName: "구자라트어"),
        OS1Language(code: "ta-IN", nativeName: "தமிழ்", englishName: "Tamil", koreanName: "타밀어"),
        OS1Language(code: "te-IN", nativeName: "తెలుగు", englishName: "Telugu", koreanName: "텔루구어"),
        OS1Language(code: "kn-IN", nativeName: "ಕನ್ನಡ", englishName: "Kannada", koreanName: "칸나다어"),
        OS1Language(code: "ml", nativeName: "മലയാളം", englishName: "Malayalam", koreanName: "말라얄람어"),
        OS1Language(code: "th-TH", nativeName: "ไทย", englishName: "Thai", koreanName: "태국어"),
        OS1Language(code: "my-MM", nativeName: "မြန်မာ", englishName: "Burmese", koreanName: "버마어"),
        OS1Language(code: "ko-KR", nativeName: "한국어", englishName: "Korean", koreanName: "한국어"),
        OS1Language(code: "ja-JP", nativeName: "日本語", englishName: "Japanese", koreanName: "일본어"),
        OS1Language(code: "zh-CN", nativeName: "简体中文", englishName: "Chinese (Simplified)", koreanName: "중국어(간체)"),
        OS1Language(code: "zh-TW", nativeName: "繁體中文（台灣）", englishName: "Chinese (Traditional, Taiwan)", koreanName: "중국어(번체, 대만)"),
        OS1Language(code: "zh-HK", nativeName: "繁體中文（香港）", englishName: "Chinese (Traditional, Hong Kong SAR China)", koreanName: "중국어(번체, 홍콩[중국 특별행정구])"),
    ]

    /// Languages OS-1's own interface is written in. Codex lists exactly the
    /// languages it ships a translation for, and the interface picker does the
    /// same, so every entry it offers really changes the interface. Every
    /// catalog language stays available as a response language.
    public static let interfaceCodes: Set<String> = ["en-US", "ko-KR"]

    public static var interface: [OS1Language] { all.filter { interfaceCodes.contains($0.code) } }

    /// The catalog entry a stored or system language tag stands for, matched as
    /// Codex matches: case and `_`/`-` do not matter, every English variant is
    /// English, a script or region picks the regional entry when there is one,
    /// and a bare language picks its main regional form.
    public static func language(for tag: String) -> OS1Language? {
        let parts = tag.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "_", with: "-").lowercased()
            .split(separator: "-").map(String.init)
        guard let base = parts.first else { return nil }
        let family = all.filter { $0.code.lowercased().split(separator: "-").first.map(String.init) == base }
        guard !family.isEmpty else { return nil }
        if let exact = family.first(where: { $0.code.lowercased() == parts.joined(separator: "-") }) { return exact }
        func entry(_ code: String) -> OS1Language? { family.first { $0.code == code } }
        if base == "zh" {
            if parts.contains("hk") || parts.contains("mo") { return entry("zh-HK") }
            return entry(parts.contains("hant") || parts.contains("tw") ? "zh-TW" : "zh-CN")
        }
        // A region the catalog has ("pt-BR", "fr-CA", "es-419"), also behind a script.
        if parts.count > 1, let regional = family.first(where: { $0.code.lowercased() == base + "-" + parts[parts.count - 1] }) {
            return regional
        }
        return entry(["es": "es-ES", "fr": "fr-FR", "pt": "pt-BR"][base] ?? "") ?? family[0]
    }

    /// Codex's search: a language matches when the query occurs in its own
    /// name, its English name, or its name in the current interface language.
    public static func filter(_ languages: [OS1Language], query: String,
                              interfaceLanguage: String = OS1Localization.interfaceLanguage) -> [OS1Language] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return languages }
        return languages.filter { language in
            [language.nativeName, language.englishName, interfaceLanguage == "ko" ? language.koreanName : language.englishName]
                .contains { $0.lowercased().contains(needle) }
        }
    }
}

/// Interface-language resolution with a cheap cache. Order: the
/// OS1_INTERFACE_LANGUAGE environment override (fixtures and tests pin "ko"),
/// then settings.json, then English. "system" (Auto detect) follows macOS.
public enum OS1Localization {
    private struct Cache { var language: String; var checkedAt: Date }
    private static let lock = NSLock()
    nonisolated(unsafe) private static var cache: Cache?

    public static func invalidate() {
        lock.lock(); cache = nil; lock.unlock()
    }

    private static func resolve() -> String {
        if let forced = ProcessInfo.processInfo.environment["OS1_INTERFACE_LANGUAGE"],
           ["ko", "en"].contains(forced) { return forced }
        let language = OS1Settings.load().interfaceLanguage
        if language == "system" { return systemInterfaceLanguage() }
        return language == "ko" ? "ko" : "en"
    }

    /// What "Auto detect" resolves to: the first macOS preferred language the
    /// interface is written in, the way a native app picks its localization;
    /// English when there is none.
    public static func systemInterfaceLanguage(preferred: [String] = Locale.preferredLanguages) -> String {
        for tag in preferred {
            switch OS1LanguageCatalog.language(for: tag)?.code {
            case "ko-KR": return "ko"
            case "en-US": return "en"
            default: continue
            }
        }
        return "en"
    }

    public static var interfaceLanguage: String {
        lock.lock(); defer { lock.unlock() }
        if let cache, Date().timeIntervalSince(cache.checkedAt) < 1 { return cache.language }
        let language = resolve()
        cache = Cache(language: language, checkedAt: Date())
        return language
    }
}

/// Pick the interface-language variant of a user-visible string. Call sites
/// keep both texts inline so the wording stays reviewable next to the code.
public func os1Tr(_ korean: String, _ english: String) -> String {
    OS1Localization.interfaceLanguage == "ko" ? korean : english
}
