import AVFoundation

/// Minimal AVAudioEngine-based recorder. Engine (not AVAudioRecorder) so we
/// can later tap the buffer for live streaming without re-architecting.
final class VoiceRecorder: NSObject, AVAudioRecorderDelegate {
    private let engine = AVAudioEngine()
    private var audioFile: AVAudioFile?
    private(set) var outputFileURL: URL?

    var isRecording: Bool { engine.isRunning }

    func start() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker])
        try session.setActive(true)

        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("rec-\(Int(Date().timeIntervalSince1970)).caf")
        outputFileURL = url
        audioFile = try AVAudioFile(forWriting: url, settings: inputFormat.settings)

        // bufferSize 0 = system default; here so later we can swap in a
        // fixed-size buffer for streaming chunks.
        input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
            guard let file = self?.audioFile else { return }
            try? file.write(from: buffer) // production: handle error
        }
        engine.prepare()
        try engine.start()
    }

    func stop() -> URL? {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        audioFile = nil
        return outputFileURL
    }
}
