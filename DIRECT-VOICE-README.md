# Native direct OpenRouter experiment

This branch simplifies the personal iPhone voice client. It **does not use** Vellum's broken HTTP route or ElevenLabs.

- Microphone: native `VoiceRecorder`.
- Speech-to-text: Apple's `SFSpeechRecognizer` via `NativeTranscriber`.
- AI: OpenRouter HTTPS chat completions, with a selectable model ID.
- Spoken reply: Apple's `AVSpeechSynthesizer`.
- API key: entered in the app and stored in the **device Keychain**; never commit a key to GitHub.

## Run

1. Check out branch `chatgpt-native-voice-direct`.
2. Generate the Xcode project: `xcodegen generate`.
3. Open the generated project in Xcode, select the iOS target, build and run.
4. Paste your OpenRouter key **inside the running app** and tap **Save key**.
5. Choose a model ID enabled by the OpenRouter account guardrails; the initial value is `z-ai/glm-5.3-flash`.
6. **First test:** type "Hello" and tap Send. Expect reply text and audible iOS synthesized speech.
7. **Then test on a physical iPhone:** Record → Stop. Allow microphone and speech recognition permissions. Confirm speech is transcribed, answered, and played aloud.

The simulator can test the UI and typed-text AI call. Speech recognition in the simulator may be unavailable.

## Security and limitations

- No credential is present in source or Info.plist. Keychain items use ThisDeviceOnly protection.
- This is a **personal-device prototype**. A key stored on a device can still be extracted from a compromised device, and OpenRouter sees the key when a request is made. For distribution to others, use a properly secured backend instead.
- Model availability, OpenRouter guardrails and usage charges still apply.
- There are **no claims of successful compilation or hardware end-to-end testing** for this branch until tested on a Mac with Xcode and a real device.
