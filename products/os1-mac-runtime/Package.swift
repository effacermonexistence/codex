// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OS1Runtime",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "os1", targets: ["OS1"]),
        .executable(name: "OS1App", targets: ["OS1App"]),
    ],
    dependencies: [.package(url: "https://github.com/mgriebling/SwiftMath.git", exact: "1.7.3")],
    targets: [
        .target(name: "OS1System"),
        .target(name: "OS1Context", dependencies: ["OS1System"]),
        .target(name: "OS1HookSupport"),
        .executableTarget(name: "OS1", dependencies: ["OS1Context", "OS1HookSupport"],
                          swiftSettings: [.unsafeFlags(["-parse-as-library"])]),
        .executableTarget(
            name: "OS1App",
            dependencies: ["OS1Context", .product(name: "SwiftMath", package: "SwiftMath")],
            linkerSettings: [
                .linkedLibrary("sqlite3"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("Speech"),
            ]
        ),
        // CLT-only Macs do not ship XCTest. Keep the deterministic regression
        // suite runnable without installing Xcode or fetching dependencies.
        .executableTarget(name: "OS1ContextTests", dependencies: ["OS1Context"], path: "Tests/OS1ContextTests"),
        .executableTarget(name: "FrontierMonitorTests", dependencies: ["OS1Context"], path: "Tests/FrontierMonitorTests"),
        .executableTarget(name: "OS1HookSupportTests", dependencies: ["OS1HookSupport"], path: "Tests/OS1HookSupportTests"),
        .executableTarget(name: "RetrievalRelevanceTests", dependencies: ["OS1Context"],
                          path: "Tests/OS1RetrievalTests"),
    ]
)
