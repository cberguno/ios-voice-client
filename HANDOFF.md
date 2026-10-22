# Handoff — iOS voice client state (for Dot / ChatGPT), Oct 22

Repo: cberguno/ios-voice-client (SwiftUI voice app + XcodeGen project.yml)

## Proven live
- LLM leg GREEN: OpenRouter `z-ai/glm-5.3-flash` returns HTTP 200 with real replies.
- TTS leg GREEN: ElevenLabs free tier, premade voice "Roger" `CwhRBWXzGAHq8TQ4Fs17`,
  model eleven_turbo_v2_5, output mp3_44100_128 → HTTP 200, real mp3 bytes.
- App builds (Xcode 26.6, BUILD SUCCEEDED, exit 0) and runs in the simulator.

## Blockers (exact errors)
1. Endpoint: authenticated POST with the real workflow key to
   https://velay.vellum.ai/01a137f9-8a00-73b5-85a5-7a1e4726d010/x/voice
   → HTTP 404 {"detail":"not found"} — the edge does not forward /x/voice.
2. Simulator STT: kLSRErrorDomain Code=300 "Failed to initialize recognizer" —
   SFSpeechRecognizer does not work in the simulator at all.

## Agreed plan (Chris, Oct 22)
Simpler path, owned by Dot: Apple handles speech in and out on device,
OpenRouter supplies the reply, the API key stays in the device Keychain —
never committed. Test on a physical iPhone; the simulator can still show UI.
