# Voice Loop — Full Spec

Everything needed to build against the voice endpoint, in one place. Written so
nobody has to ask for specifics twice.

---

## 1. Architecture

```
iOS app (SwiftUI)
  ├─ AVAudioEngine        capture mic
  ├─ SFSpeechRecognizer   transcribe ON-DEVICE  -> plain text
  └─ URLSession POST      text + auth header
                              |
                              v
                    POST /x/voice  (this spec)
                              |
                    ├─ OpenRouter      z-ai/glm-5.3-flash   -> reply text
                    └─ ElevenLabs      eleven_turbo_v2_5    -> mp3 audio
                              |
                              v
                    { "audioBase64": "...", "text": "..." }
                              |
                              v
  AVAudioPlayer           play the mp3
```

STT stays native on the device (lower latency, no server load). The server never
sees audio, only text. TTS is server-side so the app stays thin.

---

## 2. Endpoint

| | |
|---|---|
| **Method** | `POST` (also `GET` for a liveness ping) |
| **Path** | `/x/voice` |
| **Public URL** | `https://velay.vellum.ai/01a137f9-8a00-73b5-85a5-7a1e4726d010/x/voice` |
| **Handler file** | `/workspace/routes/voice.ts` |
| **Content-Type** | `application/json` |

### Auth

Required on every request. Either header form is accepted:

```
Authorization: Bearer <voice/workflow_key>
```
```
x-api-key: <voice/workflow_key>
```

The key is the vault credential `voice/workflow_key` (alias "voice loop"). The
server compares it exactly; a wrong or missing key is a `401`. The value is not
readable back out of the vault, so copy it from wherever it was recorded when it
was created.

### Request body

```json
{
  "text": "what's the weather looking like today",
  "sessionId": "optional-opaque-string"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `text` | string | yes | The transcribed user utterance. Whitespace-only is rejected. |
| `sessionId` | string | no | Accepted and ignored today; reserved for conversation continuity later. |

### Success response — `200`

```json
{
  "audioBase64": "<base64-encoded mp3>",
  "text": "<the assistant's spoken reply, plain text>"
}
```

`audioBase64` is a complete MP3 (decodable directly by `AVAudioPlayer`), 44.1 kHz,
128 kbps. `text` is the same string that was synthesized, sent back so the app
can log it cheaply without decoding audio. It is **not** wrapped in a data URL,
no `data:audio/mpeg;base64,` prefix — raw base64 only.

### Error responses

All errors share one shape: `{"error": {"message": "<reason>"}}`.

| Status | Meaning | Cause |
|---|---|---|
| `400` | Bad request | Body wasn't JSON, or `text` missing/empty |
| `401` | Unauthorized | Missing or wrong auth key |
| `502` | Upstream failure | OpenRouter or ElevenLabs returned non-OK / empty |
| `503` | Not configured | Server-side auth key not present in the vault |

### `GET /x/voice`

Liveness probe, no auth, returns:

```json
{ "ok": true, "service": "voice-loop" }
```

---

## 3. Server-side legs

| Leg | Provider | Model / ID | Credential |
|---|---|---|---|
| LLM | OpenRouter | `z-ai/glm-5.3-flash` | `openrouter/api_key` |
| TTS | ElevenLabs | model `eleven_turbo_v2_5`, voice `21m00Tcm4TlvDq8ikWAM`, output `mp3_44100_128` | `elevenlabs/api_key` |

Notes worth not re-litigating:

- `z-ai/glm-5.3-flash` is a **real** current OpenRouter model. It is not a typo
  for "4 Flash". Verified against OpenRouter's live model list.
- The system prompt tells the model to answer in one to three short spoken
  sentences, no markdown, no lists, no emoji. The handler additionally strips
  `*_`#>` and any `<think>...</think>` block before synthesis, because those
  would be read aloud literally.

---

## 4. iOS side

### Files

| File | Role |
|---|---|
| `VoiceRecorder.swift` | `AVAudioEngine` capture. Uses a tap, not `AVAudioRecorder`, so real-time streaming is possible later. |
| `NativeTranscriber.swift` | On-device `SFSpeechRecognizer`. Emits final transcribed text. |
| `VoiceView.swift` | SwiftUI. Record button -> transcribe -> `POST /x/voice` -> decode `audioBase64` -> play via `AVAudioPlayer`. |
| `Info.plist` | Permission usage strings + the workflow key entry. |

### Required Info.plist entries

```
NSMicrophoneUsageDescription          <why the app wants the mic>
NSSpeechRecognitionUsageDescription   <why the app wants speech recognition>
VoiceWorkflowKey                      <the voice/workflow_key value>
```

`VoiceView.swift` reads `VoiceWorkflowKey` from the bundle and sends it as the
`x-api-key` header.

> **Outstanding on the app side:** `VoiceWorkflowKey` still needs to be added to
> the Xcode project's Info.plist. **Keychain is the correct long-term home** for
> this value; the plist entry is the expedient path to get the first end-to-end
> run working.

### Auth header the app sends

```
x-api-key: <VoiceWorkflowKey from Info.plist>
```

---

## 5. Known blocker

The public edge `https://velay.vellum.ai/<assistant-id>/...` currently returns
`{"detail":"not found"}` for **every** `/x/*` path — including the platform's own
built-in routes and the bare base URL. This is an environment condition in front
of the tunnel, not a defect in the handler.

The Velay tunnel is only wired to carry Twilio webhooks and live voice/audio
WebSockets; plain HTTP `/x/*` is not forwarded by it. The route itself is
verified healthy locally: registered as `GET,POST`, route host running, handler
loads cleanly.

**Direction to unblock:** front the route with a tunnel we control (ngrok or
cloudflared) rather than expecting the platform edge to serve `/x/*`.

---

## 6. Contract summary, for copying

```
POST /x/voice
x-api-key: <voice/workflow_key>
{"text": "..."}

200 -> {"audioBase64": "<raw base64 mp3>", "text": "<reply>"}
400 -> {"error":{"message":"..."}}   bad body / missing text
401 -> {"error":{"message":"..."}}   bad key
502 -> {"error":{"message":"..."}}   upstream failure
503 -> {"error":{"message":"..."}}   key not configured
```
