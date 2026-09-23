import SwiftUI

enum AppTheme {
    static let background = Color(red: 0.055, green: 0.063, blue: 0.09)
    static let surface = Color(red: 0.09, green: 0.105, blue: 0.145)
    static let border = Color(red: 0.2, green: 0.24, blue: 0.32)
    static let primary = Color(red: 0.35, green: 0.72, blue: 1.0)
    static let secondary = Color(red: 0.72, green: 0.47, blue: 1.0)
    static let text = Color(red: 0.92, green: 0.94, blue: 0.98)
    static let mutedText = Color(red: 0.58, green: 0.63, blue: 0.72)
    static let error = Color(red: 1.0, green: 0.38, blue: 0.42)
}

struct SignalLoomMark: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(
                    LinearGradient(
                        colors: [AppTheme.primary, AppTheme.secondary],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 3
                )

            HStack(spacing: 4) {
                Rectangle()
                    .fill(AppTheme.primary)
                    .frame(width: 24, height: 3)
                    .rotationEffect(.degrees(36))
                Text("<>")
                    .font(.system(size: 22, weight: .bold, design: .monospaced))
                    .foregroundStyle(AppTheme.secondary)
                Rectangle()
                    .fill(AppTheme.primary)
                    .frame(width: 24, height: 3)
                    .rotationEffect(.degrees(-36))
            }
        }
        .frame(width: 92, height: 68)
        .accessibilityHidden(true)
    }
}
