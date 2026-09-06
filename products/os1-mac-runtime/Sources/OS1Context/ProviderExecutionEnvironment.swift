import Foundation

/// Ownership marker for already-dispatched backend children. Fleet prompt hooks
/// must not enqueue the same work again. This is not a permission or auth grant.
public enum ProviderExecutionEnvironment {
    public static func marked(_ inherited: [String: String]) -> [String: String] {
        var environment = inherited
        environment["OS1_INTERNAL_PROVIDER_EXECUTION"] = "1"
        return environment
    }
}
