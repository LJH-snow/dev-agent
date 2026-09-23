import Foundation

struct ServerReadinessParser {
    static let listeningPrefix = "dev-agent desktop listening on "
    static let diagnosticLimit = 4096

    private var pendingLine = ""
    private(set) var diagnostic = ""

    mutating func consume(_ data: Data) -> URL? {
        guard let text = String(data: data, encoding: .utf8) else {
            return nil
        }

        pendingLine.append(text)
        var lines = pendingLine.split(separator: "\n", omittingEmptySubsequences: false)
        if !pendingLine.hasSuffix("\n"), let last = lines.popLast() {
            pendingLine = String(last)
        } else {
            pendingLine = ""
        }

        for line in lines {
            let value = String(line).trimmingCharacters(in: .whitespacesAndNewlines)
            if let url = Self.parseListeningLine(value) {
                return url
            }
            appendDiagnostic(value)
        }
        return nil
    }

    mutating func appendDiagnostic(_ value: String) {
        let sanitized = value
            .unicodeScalars
            .filter { scalar in
                scalar == "\t" ||
                    scalar == " " ||
                    scalar.isASCII && scalar.value >= 0x20 && scalar.value != 0x7f
            }
            .map(String.init)
            .joined()
        guard !sanitized.isEmpty else { return }

        let remaining = Self.diagnosticLimit - diagnostic.utf8.count
        guard remaining > 0 else { return }
        let bounded = String(sanitized.prefix(remaining))
        diagnostic.append(bounded)
        diagnostic.append("\n")
        if diagnostic.utf8.count > Self.diagnosticLimit {
            diagnostic = String(diagnostic.prefix(Self.diagnosticLimit))
        }
    }

    static func parseListeningLine(_ line: String) -> URL? {
        guard line.hasPrefix(listeningPrefix) else { return nil }
        let rawURL = String(line.dropFirst(listeningPrefix.count))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: rawURL),
              url.scheme == "http",
              let host = url.host,
              host == "127.0.0.1" || host == "localhost",
              let port = url.port,
              (1...65_535).contains(port)
        else {
            return nil
        }
        return url
    }
}
