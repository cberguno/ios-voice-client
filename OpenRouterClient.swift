import Foundation

struct ChatMessage: Codable {
    let role: String
    let content: String
}

/// Direct personal-device connection. Never prints or persists the API key.
/// A URLSession can be injected for deterministic tests of the real request code.
struct OpenRouterClient {
    private let session: URLSession
    private let url = URL(string: "https://openrouter.ai/api/v1/chat/completions")!

    init(session: URLSession = .shared) {
        self.session = session
    }

    func complete(messages: [ChatMessage], model: String, apiKey: String) async throws -> String {
        let selectedModel = model.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !selectedModel.isEmpty else { throw ClientError.invalidModel }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(RequestBody(model: selectedModel, messages: messages))

        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw ClientError.invalidResponse
        }
        guard (200..<300).contains(response.statusCode) else {
            let serverError = try? JSONDecoder().decode(ErrorBody.self, from: data)
            let message = serverError?.error.message ?? "No detail returned by OpenRouter"
            throw ClientError.http(response.statusCode, String(message.prefix(350)))
        }
        let decoded = try JSONDecoder().decode(ResponseBody.self, from: data)
        guard let answer = decoded.choices.first?.message.content?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !answer.isEmpty else {
            throw ClientError.emptyReply
        }
        return answer
    }

    private struct RequestBody: Encodable {
        let model: String
        let messages: [ChatMessage]
    }

    private struct ResponseBody: Decodable {
        struct Choice: Decodable {
            struct Message: Decodable {
                let content: String?
            }
            let message: Message
        }
        let choices: [Choice]
    }

    private struct ErrorBody: Decodable {
        struct Detail: Decodable {
            let message: String
        }
        let error: Detail
    }

    enum ClientError: LocalizedError {
        case invalidModel
        case invalidResponse
        case emptyReply
        case http(Int, String)

        var errorDescription: String? {
            switch self {
            case .invalidModel: return "Choose an OpenRouter model."
            case .invalidResponse: return "OpenRouter returned an invalid response."
            case .emptyReply: return "OpenRouter returned no text."
            case let .http(code, detail): return "OpenRouter HTTP \(code): \(detail)"
            }
        }
    }
}
