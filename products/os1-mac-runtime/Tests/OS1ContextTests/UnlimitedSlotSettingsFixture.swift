import Foundation
import OS1Context

/// No owner settings path is consulted: migration and custody use fixture JSON
/// and one disposable settings file. The new semantics marker prevents a newly
/// chosen finite 12 from migrating again on the next restart.
func runUnlimitedSlotSettingsFixtures() throws {
    var count = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Unlimited slot settings: " + message)
        count += 1
    }
    func decode(_ json: String) throws -> OS1Settings {
        try JSONDecoder().decode(OS1Settings.self, from: Data(json.utf8))
    }
    let originalFields = #""interfaceLanguage":"ko","outputLanguage":"ja","showCodex":false"#
    check(OS1Settings().parallelRunLimit == nil && OS1Settings().parallelRuns == nil,
          "fresh settings default to unlimited")
    check(OS1Settings.defaultParallelRuns == nil, "no hidden default cap")
    check(OS1Settings.parallelRunRange == 1...64, "finite choices span 1 through 64")
    check(OS1Settings.clampedParallelRuns(nil) == nil, "normalization preserves unlimited")
    check(OS1Settings.clampedParallelRuns(0) == 1 && OS1Settings.clampedParallelRuns(99) == 64,
          "hand-edited finite values clamp")

    let oldest = try decode("{\(originalFields)}")
    check(oldest.parallelRuns == nil, "JSON predating the limit loads unlimited")
    check(oldest.interfaceLanguage == "ko" && oldest.outputLanguage == "ja" && !oldest.showCodex,
          "migration preserves the original settings")
    check(try decode("{}").parallelRuns == nil, "missing original fields remain backward compatible")
    check(try decode("{\(originalFields),\"parallelRunLimit\":null}").parallelRuns == nil,
          "legacy null means unlimited")
    check(try decode("{\(originalFields),\"parallelRunLimit\":12}").parallelRunLimit == nil,
          "old maximum 12 migrates to unlimited")
    check(try decode("{\(originalFields),\"parallelRunLimit\":12,\"parallelRunLimitVersion\":1}").parallelRuns == nil,
          "explicit legacy version migrates 12")
    for limit in 1...11 {
        check(try decode("{\(originalFields),\"parallelRunLimit\":\(limit)}").parallelRuns == limit,
              "old deliberate finite choice \(limit) survives")
    }
    for limit in [1, 4, 12, 64] {
        var finite = OS1Settings()
        finite.parallelRunLimit = limit
        let encoded = try JSONEncoder().encode(finite)
        let restored = try JSONDecoder().decode(OS1Settings.self, from: encoded)
        check(restored == finite && restored.parallelRuns == limit,
              "new finite \(limit) round-trips without legacy migration")
        let object = try JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        check(object?["parallelRunLimitVersion"] as? Int == 2,
              "finite \(limit) writes the current settings-semantics version")
    }
    let unlimited = OS1Settings()
    let unlimitedData = try JSONEncoder().encode(unlimited)
    check(try JSONDecoder().decode(OS1Settings.self, from: unlimitedData) == unlimited,
          "unlimited settings round-trip")
    check(try decode("{\(originalFields),\"parallelRunLimit\":12,\"parallelRunLimitVersion\":2}").parallelRuns == 12,
          "a current-format explicit 12 is finite")

    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("os1-unlimited-settings-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let url = root.appendingPathComponent("settings.json")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try Data("{\(originalFields),\"parallelRunLimit\":12}".utf8).write(to: url)
    let migrated = OS1Settings.load(from: url)
    check(migrated.parallelRuns == nil, "fixture file load applies legacy migration")
    try migrated.save(to: url)
    check(OS1Settings.load(from: url).parallelRuns == nil,
          "migrated unlimited survives save and reload")
    var explicit = migrated
    explicit.parallelRunLimit = 12
    try explicit.save(to: url)
    check(OS1Settings.load(from: url).parallelRuns == 12,
          "newly selected 12 survives file save and reload")
    explicit.parallelRunLimit = 4
    try explicit.save(to: url)
    check(OS1Settings.load(from: url).parallelRuns == 4, "owner-selected 4 remains finite")
    explicit.parallelRunLimit = nil
    try explicit.save(to: url)
    check(OS1Settings.load(from: url).parallelRunLimit == nil,
          "returning to unlimited is durable")
    check((try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? NSNumber)?.intValue == 0o600,
          "settings custody stays private")

    print("Unlimited slot settings: \(count) checks passed; old JSON, 12 migration, finite choices, unlimited and finite round trips")
}
