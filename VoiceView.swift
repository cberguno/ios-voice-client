import AVFoundation
import SwiftUI

/// Personal iPhone voice assistant: Apple STT + OpenRouter + Apple TTS.
/// No Vellum endpoint, no ElevenLabs dependency, and no key in the repository.
@MainActor
struct VoiceView: View {
    @State private var recorder = VoiceRecorder()
    @State private var synthesizer = AVSpeechSynthesizer()
    @State private var isRecording = false
    @State private var isBusy = false
    @State private var micDenied = false
    @State private var hasKey = false
    @State private var keyInput = ""
    @State private var typedText = ""
    @State private var latestReply = ""
    @State private var status = "Ready"
    @State private var messages: [ChatMessage] = []
    @AppStorage("openrouter.model") private var model = "z-ai/glm-5.3-flash"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Voice Assistant").font(.largeTitle.bold())
                Text("Speech: Apple  ·  AI: OpenRouter").foregroundStyle(.secondary)

                GroupBox("OpenRouter setup") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(hasKey ? "API key saved in this device's Keychain" : "No API key saved")
                            .font(.footnote)
                        SecureField("Paste OpenRouter API key", text: $keyInput)
                            .textContentType(.password)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .textFieldStyle(.roundedBorder)
                        HStack {
                            Button("Save key") { saveKey() }
                                .disabled(keyInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            if hasKey {
                                Button("Remove key", role: .destructive) { removeKey() }
                            }
                        }
                        TextField("OpenRouter model ID", text: $model)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .textFieldStyle(.roundedBorder)
                        Text("Choose a model allowed by your OpenRouter guardrails.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }

                Button(isRecording ? "Stop and send recording" : "Record your voice") {
                    if isRecording {
                        Task { await finishRecording() }
                    } else {
                        requestMicAndRecord()
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isBusy || !hasKey)

                HStack {
                    TextField("Or type a message", text: $typedText)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { sendTyped() }
                    Button("Send") { sendTyped() }
                        .disabled(isBusy || !hasKey ||
                            typedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }

                if micDenied {
                    Text("Microphone access is denied. Enable it in Settings.")
                        .foregroundStyle(.red)
                    Button("Open Settings") {
                        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                        UIApplication.shared.open(url)
                    }
                }
                if isBusy { ProgressView() }
                Text(status).font(.footnote).foregroundStyle(.secondary)
                if !latestReply.isEmpty {
                    Text("Assistant").font(.headline)
                    Text(latestReply).textSelection(.enabled)
                    Button("Speak again") { speak(latestReply) }
                    Button("Clear conversation") {
                        messages.removeAll()
                        latestReply = ""
                        status = "Ready"
                    }
                }
            }
            .padding()
        }
        .onAppear { hasKey = OpenRouterKeychain.load() != nil }
    }

    private func saveKey() {
        do {
            try OpenRouterKeychain.save(keyInput)
            keyInput = ""
            hasKey = true
            status = "API key saved on device."
        } catch {
            status = error.localizedDescription
        }
    }

    private func removeKey() {
        do {
            try OpenRouterKeychain.delete()
            hasKey = false
            keyInput = ""
            status = "API key removed."
        } catch {
            status = error.localizedDescription
        }
    }

    private func sendTyped() {
        let text = typedText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isBusy else { return }
        typedText = ""
        Task { await send(text) }
    }

    private func requestMicAndRecord() {
        synthesizer.stopSpeaking(at: .immediate)
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            startRecording()
        case .denied:
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
        do {
            try recorder.start()
            isRecording = recorder.isRecording
            micDenied = false
            status = "Recording… tap Stop when finished."
        } catch {
            status = "Microphone error: \(error.localizedDescription)"
        }
    }

    private func finishRecording() async {
        isRecording = false
        guard let file = recorder.stop() else {
            status = "No recording found."
            return
        }
        isBusy = true
        status = "Transcribing with Apple Speech…"
        do {
            let text = try await NativeTranscriber().transcribe(url: file)
            isBusy = false
            await send(text)
        } catch {
            isBusy = false
            status = "Transcription error: \(error.localizedDescription). Try typing instead."
        }
    }

    private func send(_ raw: String) async {
        guard !isBusy else { return }
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            status = "Nothing to send."
            return
        }
        guard let key = OpenRouterKeychain.load(), !key.isEmpty else {
            hasKey = false
            status = "Save your OpenRouter API key first."
            return
        }
        isBusy = true
        status = "Asking OpenRouter…"
        defer { isBusy = false }

        let conversation = [ChatMessage(role: "system", content:
            "You are a helpful voice assistant. Answer naturally in one to three brief spoken sentences.")] +
            messages + [ChatMessage(role: "user", content: text)]
        do {
            let answer = try await OpenRouterClient().complete(
                messages: conversation, model: model, apiKey: key
            )
            messages.append(ChatMessage(role: "user", content: text))
            messages.append(ChatMessage(role: "assistant", content: answer))
            latestReply = answer
            status = "AI response received. Speaking…"
            speak(answer)
        } catch {
            status = error.localizedDescription
        }
    }

    private func speak(_ answer: String) {
        synthesizer.stopSpeaking(at: .immediate)
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playback, mode: .default)
            try audio.setActive(true)
        } catch {
            status = "Audio session error: \(error.localizedDescription)"
            return
        }
        let utterance = AVSpeechUtterance(string: answer)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        synthesizer.speak(utterance)
    }
}
