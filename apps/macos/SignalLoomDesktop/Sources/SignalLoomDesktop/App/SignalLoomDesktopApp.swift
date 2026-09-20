import AppKit
import OSLog
import SwiftUI

@main
struct SignalLoomDesktopApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var serverProcess: DesktopServerProcess

    init() {
        let process = DesktopServerProcess()
        _serverProcess = StateObject(wrappedValue: process)
        AppDelegate.serverProcess = process
    }

    var body: some Scene {
        WindowGroup("Signal Loom") {
            ContentView(serverProcess: serverProcess)
        }
        .defaultSize(width: 1440, height: 900)
        .windowResizability(.contentMinSize)
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    static var serverProcess: DesktopServerProcess?
    private let logger = Logger(
        subsystem: "com.signal-loom.desktop",
        category: "lifecycle"
    )

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        logger.info("Application finished launching")
        Self.serverProcess?.start()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        logger.info("Application should terminate")
        Self.serverProcess?.stop()
        return .terminateNow
    }

    func applicationWillTerminate(_ notification: Notification) {
        logger.info("Application will terminate")
        Self.serverProcess?.stop()
    }
}
