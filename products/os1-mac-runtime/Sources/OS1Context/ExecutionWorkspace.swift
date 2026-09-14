import Foundation

/// Resolve once from the actual provider tool contract. The user's project
/// context is not necessarily the provider's working directory. Recovery may
/// not use unrelated home-directory activity as proof this attempt wrote files.
public enum ExecutionWorkspace {
    public static func usesSourceIsolation(provider: String, permission: String,
                                            hasSource: Bool, workspace: String, home: String) -> Bool {
        provider == "claude" && permission == "read_only" &&
            (hasSource || URL(fileURLWithPath: workspace).standardizedFileURL.path ==
                URL(fileURLWithPath: home).standardizedFileURL.path)
    }
}
