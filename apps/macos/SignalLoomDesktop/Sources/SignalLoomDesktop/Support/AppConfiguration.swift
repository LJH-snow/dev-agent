import Foundation

enum AppConfigurationError: Error, Equatable, CustomStringConvertible {
    case invalidProjectRoot(String)
    case missingServerBuild(String)
    case missingNode(String)

    var description: String {
        switch self {
        case let .invalidProjectRoot(path):
            return "The Signal Loom project root is unavailable: \(path)"
        case let .missingServerBuild(path):
            return "The Desktop server build is missing: \(path)"
        case let .missingNode(detail):
            return "Node.js could not be resolved. \(detail)"
        }
    }
}

struct AppConfiguration: Equatable {
    let projectRoot: URL
    let serverScript: URL
    let nodeExecutable: URL

    static func resolve(
        resourceDirectory: URL? = Bundle.main.resourceURL,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        currentDirectory: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
        fileManager: FileManager = .default
    ) -> Result<AppConfiguration, AppConfigurationError> {
        let projectRootPath =
            nonEmpty(environment["DEV_AGENT_PROJECT_ROOT"]) ??
            resourceText(named: "project-root.txt", in: resourceDirectory) ??
            currentDirectory.path
        let projectRoot = URL(fileURLWithPath: projectRootPath, relativeTo: currentDirectory)
            .standardizedFileURL

        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: projectRoot.path, isDirectory: &isDirectory),
              isDirectory.boolValue
        else {
            return .failure(.invalidProjectRoot(projectRoot.path))
        }

        let serverScript = projectRoot
            .appendingPathComponent("apps")
            .appendingPathComponent("desktop")
            .appendingPathComponent("dist")
            .appendingPathComponent("index.js")
        guard fileManager.isReadableFile(atPath: serverScript.path) else {
            return .failure(.missingServerBuild(serverScript.path))
        }

        let nodePath =
            nonEmpty(environment["DEV_AGENT_NODE_PATH"]) ??
            resourceText(named: "node-path.txt", in: resourceDirectory)
        let node = resolveNode(
            explicitPath: nodePath,
            currentDirectory: currentDirectory,
            fileManager: fileManager
        )
        guard let node else {
            return .failure(
                .missingNode(
                    "Set DEV_AGENT_NODE_PATH or install Node.js in a standard macOS location."
                )
            )
        }

        return .success(
            AppConfiguration(
                projectRoot: projectRoot,
                serverScript: serverScript,
                nodeExecutable: node
            )
        )
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func resourceText(named name: String, in directory: URL?) -> String? {
        guard let directory else { return nil }
        let url = directory.appendingPathComponent(name)
        guard let value = try? String(contentsOf: url, encoding: .utf8) else {
            return nil
        }
        return nonEmpty(value)
    }

    private static func resolveNode(
        explicitPath: String?,
        currentDirectory: URL,
        fileManager: FileManager
    ) -> URL? {
        var candidates: [URL] = []
        if let explicitPath {
            candidates.append(
                URL(fileURLWithPath: explicitPath, relativeTo: currentDirectory)
                    .standardizedFileURL
            )
        }

        let home = fileManager.homeDirectoryForCurrentUser
        candidates += [
            URL(fileURLWithPath: "/opt/homebrew/bin/node"),
            URL(fileURLWithPath: "/usr/local/bin/node"),
            URL(fileURLWithPath: "/usr/bin/node"),
            home.appendingPathComponent(".volta/bin/node"),
        ]

        for directory in [
            home.appendingPathComponent(".nvm/versions/node"),
            home.appendingPathComponent(".local/share/mise/installs/node"),
            home.appendingPathComponent(".asdf/installs/nodejs"),
        ] {
            guard let entries = try? fileManager.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: [.isDirectoryKey],
                options: [.skipsHiddenFiles]
            ) else {
                continue
            }
            for entry in entries.sorted(by: { $0.path > $1.path }) {
                candidates.append(entry.appendingPathComponent("bin/node"))
            }
        }

        for candidate in candidates {
            if fileManager.isExecutableFile(atPath: candidate.path) {
                return candidate
            }
        }
        return nil
    }
}
