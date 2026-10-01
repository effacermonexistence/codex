// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "IntentKit",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "IntentKit", targets: ["OS1Context"]),
    ],
    targets: [
        .target(name: "OS1System"),
        .target(name: "OS1Context", dependencies: ["OS1System"]),
        // CLT-only Macs do not ship XCTest. Keep the deterministic regression
        // suite runnable without installing Xcode or fetching dependencies.
        .executableTarget(name: "OS1ContextTests", dependencies: ["OS1Context"], path: "Tests/OS1ContextTests"),
    ]
)
