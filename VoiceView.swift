import AVFoundation
import SwiftUI

/// Functional start/stop UI. Record -> transcribe natively -> send text to the
/// voice-loop endpoint -> play the spoken reply.
struct VoiceView: View {
    @State private var recorder = VoiceRecorder()
    @State private var player: AVAudioPlayer?
    @State private var isRecording = false
    @State private var status = ""
    @State private var reply = ""
    @State private var micDenied = false
    @State private var typed = ""
    // Temporary debug path: typed text bypasses STT (blocked in simulator).
    @State private var typedText = ""

    // The voice-loop route. Contract: POST {"text": ...} -> {"audioBase64", "text"}.
    private let endpoint = URL(string: "https://velay.vellum.ai/01a137f9-8a00-73b5-85a5-7a1e4726d010/x/voice")!

    // Sent as `x-api-key`. Must match the `voice/workflow_key` credential.
    // In production, load this from the Keychain rather than hardcoding it.
    private let apiKey = Bundle.main.object(forInfoDictionaryKey: "VoiceWorkflowKey") as? String ?? ""

    var body: some View {
        VStack(spacing: 20) {
            Button(isRecording ? "Stop" : "Record") {
                if isRecording { Task { await stopAndSend() } }
                else { requestMicAndRecord() }
            }
            .buttonStyle(.borderedProminent)

            TextField("Type to the assistant", text: $typedText)
                .textFieldStyle(.roundedBorder)
            Button("Send") {
                let text = typedText.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { return }
                typedText = ""
                Task {
                    status = "sending: \(text)"
                    do {
                        let response = try await sendToAssistant(text)
                        reply = response.text
                        status = "done"
                        play(response.audio)
                    } catch {
                        status = "error: \(error)"
                    }
                }
            }
            .buttonStyle(.bordered)
            .disabled(typedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if micDenied {
                Text("Microphone access is off. Enable it in Settings.")
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
            }

            Text(status)
            Text(reply)

            HStack {
                TextField("Type to the assistant", text: $typed)
                    .textFieldStyle(.roundedBorder)
                Button("Send") {
                    let text = typed
                    typed = ""
                    Task { await sendTyped(text) }
                }
                .disabled(typed.isEmpty)
            }
        }
        .padding()
    }

    /// Temporary typed-text path so the AI loop is testable while the
    /// simulator's speech recognizer is unavailable (kLSR 300).
    private func sendTyped(_ text: String) async {
        status = "sending: \(text)"
        do {
            let response = try await sendToAssistant(text)
            reply = response.text
            status = "done"
            play(response.audio)
        } catch {
            status = "error: \(error)"
        }
    }

    private func requestMicAndRecord() {
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            startRecording()
        case .denied, .undetermined where micDenied:
            micDenied = true
        case .undetermined:
            AVAudioApplication.requestRecordPermission { granted in
                Task { @MainActor in
                    if granted { startRecording() } else { micDenied = true }
                }
            }
        @unknown default:
            micDenied = true
        }
    }

    private func startRecording() {
        micDenied = false
        do {
            try recorder.start()
            isRecording = recorder.isRecording
        } catch {
            status = "mic error: \(error)"
        }
    }

    private func stopAndSend() async {
        isRecording = false
        guard let url = recorder.stop() else { return }
        status = "transcribing..."
        do {
            let text = try await NativeTranscriber().transcribe(url: url)
            status = "sending: \(text)"
            let response = try await sendToAssistant(text)
            reply = response.text
            status = "done"
            play(response.audio)
        } catch {
            status = "error: \(error)"
        }
    }

    private struct VoiceResponse {
        let text: String
        let audio: Data?
    }

    private func sendToAssistant(_ text: String) async throws -> VoiceResponse {
        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        req.httpBody = try JSONEncoder().encode(["text": text])

        let (data, http) = try await URLSession.shared.data(for: req)
        guard let code = (http as? HTTPURLResponse)?.statusCode, (200..<300).contains(code) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw NSError(
                domain: "VoiceView",
                code: (http as? HTTPURLResponse)?.statusCode ?? -1,
                userInfo: [NSLocalizedDescriptionKey: "HTTP \(body)"]
            )
        }

        struct Payload: Decodable {
            let text: String
            let audioBase64: String?
        }
        let payload = try JSONDecoder().decode(Payload.self, from: data)
        return VoiceResponse(
            text: payload.text,
            audio: payload.audioBase64.flatMap { Data(base64Encoded: $0) }
        )
    }

    private func play(_ data: Data?) {
        guard let data else { return }
        do {
            let audio = try AVAudioPlayer(data: data)
            player = audio
            audio.play()
        } catch {
            status = "audio error: \(error)"
        }
    }
}
