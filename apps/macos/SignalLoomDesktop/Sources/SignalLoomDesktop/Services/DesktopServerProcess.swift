import Combine
import Darwin
import Foundation
import OSLog

enum DesktopServerState: Equatable {
    case idle
    case starting
    case ready(URL)
    case failed(String)
    case stopped
}

func desktopServerChildEnvironment(
    from environment: [String: String]
) -> [String: String] {
    var childEnvironment = environment
    childEnvironment.removeValue(forKey: "XPC_SERVICE_NAME")
    childEnvironment.removeValue(forKey: "XPC_FLAGS")
    return childEnvironment
}

func desktopServerLaunchCommand(
    nodePath: String,
    serverScriptPath: String,
    logPath: String,
    pidPath: String
) -> String {
    func shellQuote(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }

    return """
    parent_pid="${DEV_AGENT_DESKTOP_PARENT_PID:-}"
    \(shellQuote(nodePath)) \(shellQuote(serverScriptPath)) >\(shellQuote(logPath)) 2>&1 </dev/null &
    node_pid=$!
    echo "$node_pid" >\(shellQuote(pidPath))
    cleanup() { kill "$node_pid" 2>/dev/null || true; }
    trap cleanup TERM INT
    watchdog_pid=""
    if [ -n "$parent_pid" ]; then
      (
        while kill -0 "$parent_pid" 2>/dev/null; do
          sleep 1
        done
        kill "$node_pid" 2>/dev/null || true
      ) &
      watchdog_pid=$!
    fi
    node_status=0
    wait "$node_pid" || node_status=$?
    if [ -n "$watchdog_pid" ]; then
      kill "$watchdog_pid" 2>/dev/null || true
    fi
    exit "$node_status"
    """
}

@MainActor
final class DesktopServerProcess: ObservableObject {
    @Published private(set) var state: DesktopServerState = .idle

    private let logger = Logger(
        subsystem: "com.signal-loom.desktop",
        category: "server"
    )
    private var launcherProcess: Process?
    private var serverPID: Int32?
    private var serverLogURL: URL?
    private var serverPIDURL: URL?
    private var startupTask: Task<Void, Never>?
    private var readinessParser = ServerReadinessParser()

    func start() {
        guard launcherProcess == nil, serverPID == nil else { return }
        guard case .idle = state else {
            if case .failed = state {
                state = .idle
            } else if case .stopped = state {
                state = .idle
            } else {
                return
            }
            start()
            return
        }

        state = .starting
        logger.info("Starting local Desktop server")
        readinessParser = ServerReadinessParser()

        let configuration: AppConfiguration
        switch AppConfiguration.resolve() {
        case let .success(value):
            configuration = value
        case let .failure(error):
            state = .failed(error.description)
            return
        }

        let identifier = UUID().uuidString
        let temporaryDirectory = FileManager.default.temporaryDirectory
        let logURL = temporaryDirectory
            .appendingPathComponent("signal-loom-desktop-\(identifier).log")
        let pidURL = temporaryDirectory
            .appendingPathComponent("signal-loom-desktop-\(identifier).pid")
        serverLogURL = logURL
        serverPIDURL = pidURL
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        FileManager.default.createFile(atPath: pidURL.path, contents: nil)

        let command = desktopServerLaunchCommand(
            nodePath: configuration.nodeExecutable.path,
            serverScriptPath: configuration.serverScript.path,
            logPath: logURL.path,
            pidPath: pidURL.path
        )

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", command]
        process.currentDirectoryURL = configuration.projectRoot
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        var environment = desktopServerChildEnvironment(
            from: ProcessInfo.processInfo.environment
        )
        environment["DEV_AGENT_DESKTOP_HOST"] = "127.0.0.1"
        environment["DEV_AGENT_DESKTOP_PORT"] = "0"
        environment["DEV_AGENT_PROJECT_ROOT"] = configuration.projectRoot.path
        environment["DEV_AGENT_DESKTOP_NATIVE"] = "1"
        environment["DEV_AGENT_DESKTOP_PARENT_PID"] = String(getpid())
        process.environment = environment
        process.terminationHandler = { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.launcherProcess = nil
            }
        }

        do {
            try process.run()
        } catch {
            cleanupServerResources()
            state = .failed(
                "The local Desktop server could not launch: \(error.localizedDescription)"
            )
            return
        }

        launcherProcess = process
        startupTask = Task { @MainActor [weak self] in
            await self?.waitForServer()
        }
    }

    func stop() {
        logger.info("Stopping local Desktop server")
        startupTask?.cancel()
        startupTask = nil
        terminateServer()
        launcherProcess?.terminate()
        launcherProcess = nil
        cleanupServerResources()
        state = .stopped
    }

    private func waitForServer() async {
        for _ in 0..<80 {
            guard !Task.isCancelled else { return }

            refreshServerPID()
            let readyURL = refreshReadiness()
            if let readyURL, await serverIsHealthy(at: readyURL) {
                startupTask = nil
                state = .ready(readyURL)
                logger.info(
                    "Local Desktop server is ready at \(readyURL.absoluteString, privacy: .public)"
                )
                return
            }

            if let pid = serverPID, !isProcessAlive(pid) {
                let detail = readinessParser.diagnostic.trimmingCharacters(
                    in: .whitespacesAndNewlines
                )
                fail(
                    detail.isEmpty
                        ? "The local Desktop server stopped before becoming ready."
                        : detail
                )
                return
            }

            try? await Task.sleep(nanoseconds: 250_000_000)
        }

        guard !Task.isCancelled else { return }
        let detail = readinessParser.diagnostic.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        fail(
            detail.isEmpty
                ? "The local Desktop server did not become ready."
                : detail
        )
    }

    private func refreshServerPID() {
        guard let serverPIDURL,
              let contents = try? String(contentsOf: serverPIDURL, encoding: .utf8),
              let value = Int32(contents.trimmingCharacters(in: .whitespacesAndNewlines)),
              value > 0
        else {
            return
        }
        serverPID = value
    }

    private func refreshReadiness() -> URL? {
        guard let serverLogURL,
              let data = try? Data(contentsOf: serverLogURL)
        else {
            return nil
        }

        var parser = ServerReadinessParser()
        let url = parser.consume(data)
        readinessParser = parser
        return url
    }

    private func serverIsHealthy(at url: URL) async -> Bool {
        let healthURL = url.appendingPathComponent("health")
        do {
            let (_, response) = try await URLSession.shared.data(from: healthURL)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    private func fail(_ message: String) {
        startupTask = nil
        terminateServer()
        launcherProcess?.terminate()
        launcherProcess = nil
        cleanupServerResources()
        state = .failed(message)
    }

    private func terminateServer() {
        guard let pid = serverPID else { return }
        logger.info("Sending SIGTERM to local Desktop server pid \(pid)")
        if isProcessAlive(pid) {
            _ = Darwin.kill(pid, SIGTERM)
        }
        serverPID = nil
    }

    private func isProcessAlive(_ pid: Int32) -> Bool {
        if Darwin.kill(pid, 0) == 0 {
            return true
        }
        return errno == EPERM
    }

    private func cleanupServerResources() {
        if let serverLogURL {
            try? FileManager.default.removeItem(at: serverLogURL)
        }
        if let serverPIDURL {
            try? FileManager.default.removeItem(at: serverPIDURL)
        }
        serverLogURL = nil
        serverPIDURL = nil
    }

    deinit {
        if let serverPID, Darwin.kill(serverPID, 0) == 0 {
            _ = Darwin.kill(serverPID, SIGTERM)
        }
        launcherProcess?.terminate()
    }
}
