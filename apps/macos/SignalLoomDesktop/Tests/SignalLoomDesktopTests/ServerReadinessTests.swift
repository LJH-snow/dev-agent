import Foundation
import XCTest
@testable import SignalLoomDesktop

final class ServerReadinessTests: XCTestCase {
    func testListeningLineCanArriveAcrossMultipleDataChunks() {
        var parser = ServerReadinessParser()

        XCTAssertNil(parser.consume(Data("dev-agent desktop listen".utf8)))
        let url = parser.consume(Data("ing on http://127.0.0.1:45678/\n".utf8))

        XCTAssertEqual(url?.absoluteString, "http://127.0.0.1:45678/")
    }

    func testNonListeningOutputDoesNotBecomeReady() {
        var parser = ServerReadinessParser()

        XCTAssertNil(parser.consume(Data("provider failed\n".utf8)))
        XCTAssertTrue(parser.diagnostic.contains("provider failed"))
        XCTAssertNil(
            ServerReadinessParser.parseListeningLine(
                "dev-agent desktop listening on http://0.0.0.0:4317/"
            )
        )
    }

    func testDiagnosticIsBounded() {
        var parser = ServerReadinessParser()
        parser.appendDiagnostic(String(repeating: "x", count: 20_000))

        XCTAssertLessThanOrEqual(parser.diagnostic.utf8.count, ServerReadinessParser.diagnosticLimit)
    }
}
