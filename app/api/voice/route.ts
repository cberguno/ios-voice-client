import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { clientIp, consumeRateLimit } from "./rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "z-ai/glm-5.3-flash";
const ELEVENLABS_MODEL_ID = "eleven_turbo_v2_5";

// Documented default on POST /v1/text-to-speech/{voice_id}.
// https://elevenlabs.io/docs/api-reference/text-to-speech/convert
const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";

/**
 * Premade stock voice used when ELEVENLABS_VOICE_ID is unset.
 * Roger (CwhRBWXzGAHq8TQ4Fs17) is the ElevenLabs voice HANDOFF.md verified
 * on the free tier with eleven_turbo_v2_5 and mp3_44100_128.
 * SPEC.md also names Rachel (21m00Tcm4TlvDq8ikWAM); set ELEVENLABS_VOICE_ID
 * to use a different premade voice.
 */
const DEFAULT_ELEVENLABS_VOICE_ID = "CwhRBWXzGAHq8TQ4Fs17";

const SYSTEM_PROMPT = [
  "You are a friendly voice assistant talking with a fourth grader.",
  "Reply in one to three short spoken sentences.",
  "Use clear, kind, everyday words.",
  "Answer directly.",
  "Do not use markdown, lists, headings, code, links, or emoji.",
  "Say only the words that should be spoken aloud.",
].join(" ");

const NO_STORE = { "Cache-Control": "no-store" } as const;

class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}

function jsonError(
  status: number,
  message: string,
  extraHeaders?: Record<string, string>,
): NextResponse {
  return NextResponse.json(
    { error: { message } },
    { status, headers: { ...NO_STORE, ...extraHeaders } },
  );
}

function keysMatch(candidate: string, expected: string): boolean {
  const left = createHash("sha256").update(candidate, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(left, right);
}

function workflowKeyAuthorized(request: NextRequest, expected: string): boolean {
  const provided = request.headers.get("x-api-key");
  const candidate = provided ?? "";
  const matches = keysMatch(candidate, expected);
  return provided !== null && candidate.length > 0 && matches;
}

function transcriptFromBody(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("text" in body)) {
    return null;
  }
  const { text } = body;
  if (typeof text !== "string") {
    return null;
  }
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function spokenReply(raw: string): string {
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, " ");
  const withoutMarkup = withoutThink.replace(/[*_`#>]/g, "");
  return withoutMarkup.replace(/\s+/g, " ").trim();
}

function assistantText(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("choices" in payload)) {
    return null;
  }
  const { choices } = payload;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const first: unknown = choices[0];
  if (typeof first !== "object" || first === null || !("message" in first)) {
    return null;
  }
  const { message } = first;
  if (typeof message !== "object" || message === null || !("content" in message)) {
    return null;
  }
  const { content } = message;
  if (typeof content === "string") {
    const spoken = spokenReply(content);
    return spoken.length > 0 ? spoken : null;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const parts: string[] = [];
  for (const part of content) {
    if (
      typeof part === "object" &&
      part !== null &&
      "text" in part &&
      typeof part.text === "string"
    ) {
      parts.push(part.text);
    }
  }
  if (parts.length === 0) {
    return null;
  }
  const spoken = spokenReply(parts.join(" "));
  return spoken.length > 0 ? spoken : null;
}

function failureMessage(error: unknown): string {
  if (error instanceof UpstreamError) {
    return error.message;
  }
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return "The voice service timed out.";
  }
  return "The voice service could not complete the request.";
}

async function openRouterReply(apiKey: string, transcript: string): Promise<string> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "ios-voice-client",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });

  if (!response.ok) {
    console.error("OpenRouter request failed", response.status);
    throw new UpstreamError("The language model request failed.");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new UpstreamError("The language model returned an unreadable response.");
  }

  const reply = assistantText(payload);
  if (reply === null) {
    throw new UpstreamError("The language model returned an empty reply.");
  }
  return reply;
}

async function synthesize(
  apiKey: string,
  voiceId: string,
  reply: string,
): Promise<string> {
  const url = new URL(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
  );
  url.searchParams.set("output_format", ELEVENLABS_OUTPUT_FORMAT);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: reply,
      model_id: ELEVENLABS_MODEL_ID,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    console.error("ElevenLabs request failed", response.status);
    throw new UpstreamError("Speech synthesis failed.");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") || contentType.startsWith("text/")) {
    console.error("ElevenLabs returned a non-audio body");
    throw new UpstreamError("Speech synthesis returned an unexpected response.");
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) {
    throw new UpstreamError("Speech synthesis returned empty audio.");
  }
  return audio.toString("base64");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const workflowKey = process.env.VOICE_WORKFLOW_KEY?.trim() ?? "";
  // Fail closed. 503 (not 401) means the server secret is missing, so no
  // caller is allowed through and providers are not called.
  if (workflowKey.length === 0) {
    console.error("Voice service is missing VOICE_WORKFLOW_KEY.");
    return jsonError(503, "Voice service is not configured.");
  }

  const decision = consumeRateLimit(clientIp(request.headers));
  if (decision.limited) {
    return jsonError(429, "Too many requests.", {
      "Retry-After": String(decision.retryAfterSeconds),
    });
  }

  if (!workflowKeyAuthorized(request, workflowKey)) {
    return jsonError(401, "Unauthorized.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be JSON.");
  }

  const transcript = transcriptFromBody(body);
  if (transcript === null) {
    return jsonError(400, "text is required and must be a non-empty string.");
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY?.trim() ?? "";
  if (openRouterKey.length === 0 || elevenLabsKey.length === 0) {
    console.error("Voice service is missing OPENROUTER_API_KEY or ELEVENLABS_API_KEY.");
    return jsonError(503, "Voice service is not configured.");
  }

  const voiceId =
    process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_ELEVENLABS_VOICE_ID;

  try {
    const reply = await openRouterReply(openRouterKey, transcript);
    const audioBase64 = await synthesize(elevenLabsKey, voiceId, reply);
    return NextResponse.json(
      { audioBase64, text: reply },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (!(error instanceof UpstreamError)) {
      console.error(
        "Voice route failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
    return jsonError(502, failureMessage(error));
  }
}
