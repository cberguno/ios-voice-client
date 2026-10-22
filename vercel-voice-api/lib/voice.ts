import { timingSafeEqual } from "node:crypto";

type Env = {
  OPENROUTER_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
  VOICE_WORKFLOW_KEY?: string;
  OPENROUTER_MODEL?: string;
};

type Fetcher = typeof fetch;

const MAX_BODY_BYTES = 8_192;
const MAX_INPUT_LENGTH = 1_500;
const MAX_AUDIO_BYTES = 2_900_000; // Base64 response stays under Vercel's 4.5 MB limit.

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

function failure(status: number, message: string): Response {
  return json({ error: { message } }, status);
}

function matchesSecret(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function getBearerOrKey(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : (request.headers.get("x-api-key") ?? "");
}

/** Personal-use voice endpoint: text -> OpenRouter -> ElevenLabs -> text + MP3 base64. */
export async function handleVoice(
  request: Request,
  env: Env = process.env,
  fetcher: Fetcher = fetch,
): Promise<Response> {
  if (!env.VOICE_WORKFLOW_KEY || !env.OPENROUTER_API_KEY || !env.ELEVENLABS_API_KEY) {
    return failure(503, "Voice service is not configured.");
  }
  if (!matchesSecret(getBearerOrKey(request), env.VOICE_WORKFLOW_KEY)) {
    return failure(401, "Unauthorized.");
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return failure(400, "Content-Type must be application/json.");
  }

  let input: unknown;
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > MAX_BODY_BYTES) return failure(413, "Request body too large.");
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return failure(413, "Request body too large.");
    }
    input = JSON.parse(raw);
  } catch {
    return failure(400, "Invalid JSON request body.");
  }

  if (!input || typeof input !== "object" || !("text" in input) ||
      typeof input.text !== "string") {
    return failure(400, "A text message is required.");
  }
  const message = input.text.trim();
  if (!message) return failure(400, "A nonempty text message is required.");
  if (message.length > MAX_INPUT_LENGTH) return failure(400, "Text exceeds 1500 characters.");

  const model = env.OPENROUTER_MODEL || "z-ai/glm-5.3-flash";
  const voiceId = env.ELEVENLABS_VOICE_ID || "CwhRBWXzGAHq8TQ4Fs17"; // Roger
  if (!/^[a-zA-Z0-9]{8,40}$/.test(voiceId)) {
    return failure(503, "Invalid ElevenLabs voice ID configuration.");
  }

  let reply: string;
  try {
    const llm = await fetcher("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.OPENROUTER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        messages: [
          { role: "system", content: "Reply in one to three brief natural spoken sentences. No markdown, headings, or emojis." },
          { role: "user", content: message },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(24_000),
    });
    if (!llm.ok) {
      return failure(502, "OpenRouter failed (HTTP " + llm.status + ").");
    }
    const payload: unknown = await llm.json();
    const content = (payload as { choices?: { message?: { content?: unknown } }[] })
      ?.choices?.[0]?.message?.content;
    reply = typeof content === "string"
      ? content.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/[#*`_]/g, "").trim().slice(0, 600)
      : "";
    if (!reply) return failure(502, "OpenRouter returned no spoken reply.");
  } catch {
    return failure(502, "Unable to reach OpenRouter.");
  }

  try {
    const tts = await fetcher(
      "https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(voiceId) +
      "?output_format=mp3_44100_128",
      {
        method: "POST",
        headers: {
          "xi-api-key": env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({ text: reply, model_id: "eleven_turbo_v2_5" }),
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      },
    );
    if (!tts.ok) {
      return failure(502, "ElevenLabs failed (HTTP " + tts.status + ").");
    }
    if (!(tts.headers.get("content-type") ?? "").toLowerCase().includes("audio")) {
      return failure(502, "ElevenLabs returned a non-audio response.");
    }
    const audio = Buffer.from(await tts.arrayBuffer());
    if (audio.length === 0) return failure(502, "ElevenLabs returned empty audio.");
    if (audio.length > MAX_AUDIO_BYTES) return failure(502, "Generated audio is too large.");
    return json({ text: reply, audioBase64: audio.toString("base64") }, 200);
  } catch {
    return failure(502, "Unable to reach ElevenLabs.");
  }
}
