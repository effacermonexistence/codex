import Foundation

/// User-facing runtime settings, stored like Codex's config: a small JSON
/// file the app edits through its Settings window and every OS-1 process
/// reads. Ships with English as the default interface language; output
/// language follows the user's own message unless pinned.
public struct OS1Settings: Codable, Equatable, Sendable {
    /// "en", "ko", or "system" (follow macOS preferred language).
    public var interfaceLanguage: String
    /// "auto" (answer in the language of the user's message) or an explicit
    /// language name/code such as "en", "ko", "ja".
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

    /// Conversations OS-1 may run at the same time. Until this was settable the
    /// cap was a fixed 4: once four runs were active every other conversation
    /// waited, which looked like "OS-1 does not run in parallel". Optional so
    /// older settings files still decode; read it through `parallelRuns`.
    public var parallelRunLimit: Int? = nil

    /// Supported range for `parallelRunLimit`. One conversation at a time is a
    /// deliberate serial mode; the upper bound keeps a raised cap from starting
    /// more backend turns than a desktop machine and its quotas can carry.
    public static let parallelRunRange = 1...12
    public static let defaultParallelRuns = 4

    /// The cap actually applied: an unset or out-of-range value never disables
    /// admission or removes the bound.
    public static func clampedParallelRuns(_ value: Int?) -> Int {
        guard let value else { return defaultParallelRuns }
        return min(max(value, parallelRunRange.lowerBound), parallelRunRange.upperBound)
    }

    public var parallelRuns: Int { OS1Settings.clampedParallelRuns(parallelRunLimit) }

    public init(interfaceLanguage: String = "en", outputLanguage: String = "auto", showCodex: Bool = true) {
        self.interfaceLanguage = interfaceLanguage
        self.outputLanguage = outputLanguage
        self.showCodex = showCodex
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
        if !["en", "ko", "system"].contains(settings.interfaceLanguage) { settings.interfaceLanguage = "en" }
        if settings.outputLanguage.isEmpty || settings.outputLanguage.count > 40 { settings.outputLanguage = "auto" }
        // A hand-edited file must not be able to serialize or flood execution.
        if let limit = settings.parallelRunLimit { settings.parallelRunLimit = clampedParallelRuns(limit) }
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

    /// Instruction appended to a backend dispatch. Empty for "auto": models
    /// already answer in the user's language; pinning is the explicit case.
    public var outputLanguageDirective: String {
        let value = outputLanguage.trimmingCharacters(in: .whitespaces)
        guard !value.isEmpty, value.lowercased() != "auto" else { return "" }
        let names = ["en": "English", "ko": "Korean", "ja": "Japanese", "zh": "Chinese", "es": "Spanish",
                     "fr": "French", "de": "German", "pt": "Portuguese"]
        let name = names[value.lowercased()] ?? value
        return "Write the answer in \(name), regardless of the language of the request or the sources."
    }
}

/// Interface-language resolution with a cheap cache. Order: the
/// OS1_INTERFACE_LANGUAGE environment override (fixtures and tests pin "ko"),
/// then settings.json, then English. "system" follows macOS preferences.
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
        var language = OS1Settings.load().interfaceLanguage
        if language == "system" {
            language = (Locale.preferredLanguages.first ?? "en").hasPrefix("ko") ? "ko" : "en"
        }
        return language == "ko" ? "ko" : "en"
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
