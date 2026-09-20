import Foundation
import XCTest
@testable import SignalLoomDesktop

final class AppConfigurationTests: XCTestCase {
    func testEnvironmentRootAndNodeOverridesAreUsed() throws {
        let root = try makeProjectRoot()
        defer { try? FileManager.default.removeItem(at: root) }

        let node = URL(fileURLWithPath: "/bin/sh")
        let result = AppConfiguration.resolve(
            resourceDirectory: nil,
            environment: [
                "DEV_AGENT_PROJECT_ROOT": root.path,
                "DEV_AGENT_NODE_PATH": node.path,
            ],
            currentDirectory: FileManager.default.temporaryDirectory
        )

        let configuration = try result.get()
        XCTAssertEqual(configuration.projectRoot, root.standardizedFileURL)
        XCTAssertEqual(configuration.serverScript.lastPathComponent, "index.js")
        XCTAssertEqual(configuration.nodeExecutable, node)
    }

    func testBundledResourcesAreUsedWhenEnvironmentIsUnset() throws {
        let root = try makeProjectRoot()
        let resources = root.appendingPathComponent("resources")
        try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
        try rootPathFile(root, resources: resources, name: "project-root.txt")
        try Data("/bin/sh\n".utf8).write(to: resources.appendingPathComponent("node-path.txt"))
        defer { try? FileManager.default.removeItem(at: root) }

        let result = AppConfiguration.resolve(
            resourceDirectory: resources,
            environment: [:],
            currentDirectory: URL(fileURLWithPath: "/tmp")
        )

        let configuration = try result.get()
        XCTAssertEqual(configuration.projectRoot, root.standardizedFileURL)
        XCTAssertEqual(configuration.nodeExecutable.path, "/bin/sh")
    }

    func testMissingDesktopBuildIsReported() throws {
        let root = try FileManager.default.createTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }

        let result = AppConfiguration.resolve(
            resourceDirectory: nil,
            environment: [
                "DEV_AGENT_PROJECT_ROOT": root.path,
                "DEV_AGENT_NODE_PATH": "/bin/sh",
            ],
            currentDirectory: root
        )

        guard case let .failure(error) = result else {
            return XCTFail("Expected a missing build failure")
        }
        guard case .missingServerBuild = error else {
            return XCTFail("Unexpected error: \(error)")
        }
    }

    private func makeProjectRoot() throws -> URL {
        let root = try FileManager.default.createTemporaryDirectory()
        let dist = root.appendingPathComponent("apps/desktop/dist")
        try FileManager.default.createDirectory(at: dist, withIntermediateDirectories: true)
        try Data("console.log('test')\n".utf8).write(to: dist.appendingPathComponent("index.js"))
        return root
    }

    private func rootPathFile(_ root: URL, resources: URL, name: String) throws {
        try Data("\(root.path)\n".utf8).write(to: resources.appendingPathComponent(name))
    }
}

private extension FileManager {
    func createTemporaryDirectory() throws -> URL {
        let url = temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}
