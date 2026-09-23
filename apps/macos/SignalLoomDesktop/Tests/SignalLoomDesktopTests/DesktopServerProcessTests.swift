import XCTest
@testable import SignalLoomDesktop

final class DesktopServerProcessTests: XCTestCase {
    func testChildEnvironmentRemovesGUIXPCOverrides() {
        let environment = desktopServerChildEnvironment(
            from: [
                "PATH": "/opt/homebrew/bin",
                "DEV_AGENT_MODEL": "qwen3:4b-instruct",
                "XPC_SERVICE_NAME": "0",
                "XPC_FLAGS": "0",
            ]
        )

        XCTAssertEqual(environment["PATH"], "/opt/homebrew/bin")
        XCTAssertEqual(environment["DEV_AGENT_MODEL"], "qwen3:4b-instruct")
        XCTAssertNil(environment["XPC_SERVICE_NAME"])
        XCTAssertNil(environment["XPC_FLAGS"])
    }

    func testLaunchCommandGuardsNodeWhenTheAppExits() {
        let command = desktopServerLaunchCommand(
            nodePath: "/opt/homebrew/bin/node",
            serverScriptPath: "/workspace/apps/desktop/dist/index.js",
            logPath: "/tmp/signal-loom.log",
            pidPath: "/tmp/signal-loom.pid"
        )

        XCTAssertTrue(command.contains("DEV_AGENT_DESKTOP_PARENT_PID"))
        XCTAssertTrue(command.contains("watchdog_pid"))
        XCTAssertTrue(command.contains("kill -0"))
        XCTAssertTrue(command.contains("trap cleanup TERM INT"))
    }
}
