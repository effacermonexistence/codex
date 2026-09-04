// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OS1Runtime",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "os1", targets: ["OS1"]),
        .executable(name: "OS1App", targets: ["OS1App"]),
        .executable(name: "os1-hook-tests", targets: ["OS1HookTests"]),
    ],
    targets: [
        .target(name: "OS1HookSupport"),
        .executableTarget(name: "OS1", dependencies: ["OS1HookSupport"]),
        .executableTarget(
            name: "OS1App",
            linkerSettings: [
                .linkedLibrary("sqlite3"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("Speech"),
            ]
        ),
        .executableTarget(
            name: "OS1HookTests",
            dependencies: ["OS1HookSupport"],
            path: "Tests/OS1HookSupportTests"
        ),
    ]
)
