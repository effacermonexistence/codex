import Foundation
import OS1Context

/// Pure checks for the login-identity environment fill. No provider, account
/// or Keychain is touched.
func runLoginIdentityEnvironmentFixtures() throws {
    typealias L = LoginIdentityEnvironment
    var checks = 0
    func check(_ pass: Bool, _ label: String) throws {
        guard pass else { throw NSError(domain: "LoginIdentityEnvironmentFixture", code: 1,
                                        userInfo: [NSLocalizedDescriptionKey: label]) }
        checks += 1
    }
    // The gateway child shape (build 379): PATH and HOME only.
    try check(L.missing(in: ["PATH": "/usr/bin:/bin", "HOME": "/Users/u"], userName: "u") == ["USER": "u", "LOGNAME": "u"],
              "a gateway child without USER/LOGNAME gets both from the account name")
    try check(L.missing(in: ["USER": "u", "LOGNAME": "u"], userName: "u").isEmpty, "present identity is left alone")
    try check(L.missing(in: ["USER": "owner", "LOGNAME": ""], userName: "u") == ["LOGNAME": "u"],
              "an existing USER is never overridden; an empty LOGNAME is filled")
    try check(L.missing(in: [:], userName: "").isEmpty, "an unknown account name adds nothing")
    try check(L.missing(in: [:], userName: "a=b").isEmpty && L.missing(in: [:], userName: "a\0b").isEmpty,
              "a malformed name is never exported")
    try check(!L.effectiveUserName().isEmpty, "the effective user's account name resolves")
    print("Login identity environment: \(checks) checks OK; keychain reads 0")
}
