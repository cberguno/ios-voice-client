import Foundation
import XCTest
@testable import VoiceClient

/// No real API key or network dependency: the tests exercise the production
/// OpenRouter request builder and response decoder through a mock URLProtocol.
final class OpenRouterClientTests: XCTestCase {
    override func tearDown() {
        MockURLProtocol.handler = nil
        super.tearDown()
    }

    func testSuccessfulReplyUsesCorrectEndpointAndBearerAuth() async throws {
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.absoluteString,
                           "https://openrouter.ai/api/v1/chat/completions")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-key")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")

            let body = try XCTUnwrap(request.httpBody)
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(json["model"] as? String, "test/model")
            let messages = try XCTUnwrap(json["messages"] as? [[String: String]])
            XCTAssertEqual(messages.last?["content"], "Hello")

            let response = try XCTUnwrap(HTTPURLResponse(url: request.url!,
                statusCode: 200, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]))
            let data = Data(#"{"choices":[{"message":{"content":"Hello, I can help."}}]}"#.utf8)
            return (response, data)
        }

        let result = try await client().complete(
            messages: [ChatMessage(role: "user", content: "Hello")],
            model: "test/model",
            apiKey: "test-key"
        )
        XCTAssertEqual(result, "Hello, I can help.")
    }

    func testUnauthorizedResponseIsReportedClearly() async throws {
        MockURLProtocol.handler = { request in
            let response = try XCTUnwrap(HTTPURLResponse(url: request.url!,
                statusCode: 401, httpVersion: nil, headerFields: nil))
            return (response, Data(#"{"error":{"message":"Bad API key"}}"#.utf8))
        }
        do {
            _ = try await client().complete(
                messages: [ChatMessage(role: "user", content: "Hello")],
                model: "test/model",
                apiKey: "test-key"
            )
            XCTFail("Expected HTTP 401 error")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("401"))
            XCTAssertTrue(error.localizedDescription.contains("Bad API key"))
        }
    }

    func testEmptyModelIsRejectedBeforeRequest() async throws {
        do {
            _ = try await client().complete(
                messages: [ChatMessage(role: "user", content: "Hello")],
                model: "  ",
                apiKey: "test-key"
            )
            XCTFail("Expected missing-model error")
        } catch {
            XCTAssertEqual(error.localizedDescription, "Choose an OpenRouter model.")
        }
    }

    private func client() -> OpenRouterClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return OpenRouterClient(session: URLSession(configuration: config))
    }
}

private final class MockURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: NSError(
                domain: "MockURLProtocol", code: -1))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
