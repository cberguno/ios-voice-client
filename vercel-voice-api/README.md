# Vercel voice backend (separate from Vellum and native OpenRouter branches)

This draft deploys a Next.js route handler at **POST /api/voice**, returning the original iPhone app's JSON contract:

- Input: `{"text":"Hello"}`
- Auth header: `x-api-key: <VOICE_WORKFLOW_KEY>` or `Authorization: Bearer <VOICE_WORKFLOW_KEY>`
- Success: `{"text":"...","audioBase64":"<MP3 in base64>"}`
- Errors: `{"error":{"message":"..."}}`
- GET /api/voice: *liveness only*, no provider calls

The route calls OpenRouter (default `z-ai/glm-5.3-flash`) followed by ElevenLabs (`eleven_turbo_v2_5`, default voice Roger). It caps the answer size and audio payload, returns `Cache-Control: no-store`, and sets a 60-second function limit.

## Setup
1. Create a Vercel project from `cberguno/ios-voice-client` and set **Root Directory** to `vercel-voice-api`. This branch is a draft; do not merge/deploy to production until verified.
2. In Vercel Project Settings > Environment Variables, set `OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY`, and a new random `VOICE_WORKFLOW_KEY`. Optionally set `ELEVENLABS_VOICE_ID` (Roger: `CwhRBWXzGAHq8TQ4Fs17`) and `OPENROUTER_MODEL`.
3. Keep values in the Vercel project and the calling device only. Never put any real key in a repo, `Info.plist`, build log, or URL. On your Mac, create a key with `openssl rand -hex 32`.
4. Verify with `npm install && npm test && npm run build` from this directory.
5. After preview deployment, set `BASE_URL` to its actual HTTPS origin and `VOICE_WORKFLOW_KEY` locally, then run:

```bash
curl -fsS "$BASE_URL/api/voice"  # only a liveness check
curl -fsS -X POST "$BASE_URL/api/voice" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $VOICE_WORKFLOW_KEY" \
  --data '{"text":"Hello"}' > /tmp/voice-response.json
jq -r '.text' /tmp/voice-response.json
jq -r '.audioBase64' /tmp/voice-response.json | base64 --decode > /tmp/voice-reply.mp3
```

6. Only after text and playable MP3 are verified, update the legacy iOS app's endpoint from the old Vellum URL to `$BASE_URL/api/voice` and configure its workflow key **locally** (prefer Keychain). This draft deliberately does **not** modify iOS branches or embed an unknown Vercel deployment URL.

## Limitations
- The generated MP3 is returned as base64 in JSON. Vercel Functions have a 4.5 MB response limit, so this implementation deliberately rejects audio larger than 2.9 MB.
- The route requires a shared secret. This is a personal-use prototype, not a public multi-user authentication system. Production needs rate limiting and user-specific authorization.
- A green build or the unauthenticated GET health check does not prove that OpenRouter and ElevenLabs keys work together.
- The route does **not** provide streaming, speech-to-text, or WebSockets. The native client retains microphone transcription.
