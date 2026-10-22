import Foundation
import Speech

/// Native on-device STT (per the plan: keep STT on iOS, app sends text).
final class NativeTranscriber {
    /// Full-file transcription of the recorded .caf. For turn-based voice
    /// this is fine; latency is acceptable for short utterances.
    func transcribe(url: URL) async throws -> String {
        guard await Self.hasPermission() else {
            throw TranscribeError.noPermission
        }
        let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
        guard let recognizer else { throw TranscribeError.unavailable }

        let request = SFSpeechURLRecognitionRequest(url: url)
        request.shouldReportPartialResults = false

        return try await withCheckedThrowingContinuation { cont in
            var finished = false
            recognizer.recognitionTask(with: request) { result, error in
                if let error {
                    if !finished { finished = true; cont.resume(throwing: error) }
                    return
                }
                if let result, result.isFinal {
                    if !finished { finished = true; cont.resume(returning: result.bestTranscription.formattedString) }
                }
            }
        }
    }

    static func hasPermission() async -> Bool {
        let speechStatus = await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0) }
        }
        guard speechStatus == .authorized else { return false }
        // Mic permission is requested when the session activates; check it.
        return AVAudioSession.sharedInstance().recordPermission == .granted
    }

    enum TranscribeError: Error {
        case noPermission, unavailable
    }
}
