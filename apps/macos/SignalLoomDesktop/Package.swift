// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "SignalLoomDesktop",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .executable(
            name: "SignalLoomDesktop",
            targets: ["SignalLoomDesktop"]
        ),
    ],
    targets: [
        .executableTarget(
            name: "SignalLoomDesktop",
            path: "Sources/SignalLoomDesktop"
        ),
        .testTarget(
            name: "SignalLoomDesktopTests",
            dependencies: ["SignalLoomDesktop"],
            path: "Tests/SignalLoomDesktopTests"
        ),
    ]
)
