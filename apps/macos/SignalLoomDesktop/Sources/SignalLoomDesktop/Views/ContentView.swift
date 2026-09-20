import SwiftUI

struct ContentView: View {
    @ObservedObject var serverProcess: DesktopServerProcess

    var body: some View {
        Group {
            switch serverProcess.state {
            case let .ready(url):
                WebView(url: url)
                    .ignoresSafeArea()
            case .idle, .starting:
                StartupView(
                    title: "Starting Signal Loom",
                    detail: "Preparing the local coding workbench…",
                    isLoading: true,
                    action: nil
                )
            case let .failed(message):
                StartupView(
                    title: "Signal Loom could not start",
                    detail: message,
                    isLoading: false,
                    action: serverProcess.start
                )
            case .stopped:
                StartupView(
                    title: "Signal Loom is stopped",
                    detail: "Start the local workbench again to continue.",
                    isLoading: false,
                    action: serverProcess.start
                )
            }
        }
        .frame(minWidth: 960, minHeight: 640)
        .background(AppTheme.background)
        .onAppear {
            serverProcess.start()
        }
    }
}

private struct StartupView: View {
    let title: String
    let detail: String
    let isLoading: Bool
    let action: (() -> Void)?

    var body: some View {
        VStack(spacing: 22) {
            SignalLoomMark()

            VStack(spacing: 8) {
                Text(title)
                    .font(.system(size: 28, weight: .semibold, design: .rounded))
                    .foregroundStyle(AppTheme.text)
                Text(detail)
                    .font(.system(size: 14, design: .monospaced))
                    .foregroundStyle(AppTheme.mutedText)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 680)
            }

            if isLoading {
                ProgressView()
                    .tint(AppTheme.primary)
            } else if let action {
                Button("Retry", action: action)
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.primary)
            }
        }
        .padding(48)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background)
    }
}
