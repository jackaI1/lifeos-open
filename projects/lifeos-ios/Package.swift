// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LifeOSCompanion",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "LifeOSCore", targets: ["LifeOSCore"]),
               .executable(name: "LifeOSDemoCheck", targets: ["LifeOSDemoCheck"])],
    targets: [
        .target(name: "LifeOSCore"),
        .executableTarget(name: "LifeOSDemoCheck", dependencies: ["LifeOSCore"]),
        .testTarget(name: "LifeOSCoreTests", dependencies: ["LifeOSCore"],
                    resources: [.copy("Fixtures")])
    ]
)
