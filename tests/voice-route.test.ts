import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "../app/api/voice/rate-limit";
import { POST } from "../app/api/voice/route";

const WORKFLOW_KEY = "test-workflow-key";
const OPENROUTER_KEY = "test-openrouter-key";
const ELEVENLABS_KEY = "test-elevenlabs-key";
const SPOKEN_REPLY = "Hi from the assistant.";
const MP3_BYTES = Buffer.from("ID3-fake-mp3");

const ENV_KEYS = [
  "VOICE_WORKFLOW_KEY",
  "OPENROUTER_API_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
] as const;

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((name) => [name, process.env[name]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

function postVoice(ip: string, apiKey?: string): Promise<Response> {
  const headers = new Headers({
    "content-type": "application/json",
    "x-forwarded-for": ip,
  });
  if (apiKey !== undefined) {
    headers.set("x-api-key", apiKey);
  }
  return POST(
    new NextRequest("https://voice.example/api/voice", {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "hello" }),
    }),
  );
}

function mockProviders(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url.includes("openrouter.ai")) {
      expect(headers.get("authorization")).toBe(`Bearer ${OPENROUTER_KEY}`);
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.model).toBe("z-ai/glm-5.3-flash");
      expect(body.messages[1]).toEqual({ role: "user", content: "hello" });
      return Response.json({
        choices: [{ message: { content: SPOKEN_REPLY } }],
      });
    }
    if (url.includes("api.elevenlabs.io")) {
      expect(headers.get("xi-api-key")).toBe(ELEVENLABS_KEY);
      expect(url).toContain("output_format=mp3_44100_128");
      expect(url).toContain("CwhRBWXzGAHq8TQ4Fs17");
      const body = JSON.parse(String(init?.body)) as { text: string; model_id: string };
      expect(body.model_id).toBe("eleven_turbo_v2_5");
      expect(body.text).toBe(SPOKEN_REPLY);
      return new Response(MP3_BYTES, {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function forbidFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("fetch must not be called");
    }),
  );
}

describe("POST /api/voice", () => {
  beforeEach(() => {
    resetRateLimit();
    process.env.VOICE_WORKFLOW_KEY = WORKFLOW_KEY;
    process.env.OPENROUTER_API_KEY = OPENROUTER_KEY;
    process.env.ELEVENLABS_API_KEY = ELEVENLABS_KEY;
    delete process.env.ELEVENLABS_VOICE_ID;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetRateLimit();
    for (const name of ENV_KEYS) {
      const value = originalEnv[name];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it("returns audio and text for a valid key without calling the real providers", async () => {
    const fetchMock = mockProviders();
    const response = await postVoice("203.0.113.10", WORKFLOW_KEY);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = (await response.json()) as { audioBase64: string; text: string };
    expect(payload.text).toBe(SPOKEN_REPLY);
    expect(Buffer.from(payload.audioBase64, "base64")).toEqual(MP3_BYTES);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(payload)).not.toContain(OPENROUTER_KEY);
    expect(JSON.stringify(payload)).not.toContain(ELEVENLABS_KEY);
    expect(JSON.stringify(payload)).not.toContain(WORKFLOW_KEY);
  });

  it("returns 401 when x-api-key is missing", async () => {
    forbidFetch();
    const response = await postVoice("203.0.113.11");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { message: "Unauthorized." },
    });
  });

  it("returns 401 when x-api-key does not match", async () => {
    forbidFetch();
    const response = await postVoice("203.0.113.12", "wrong-key");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { message: "Unauthorized." },
    });
  });

  it("returns 429 with Retry-After after 10 requests in a minute from one IP", async () => {
    const fetchMock = mockProviders();
    const ip = "203.0.113.13";

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await postVoice(ip, WORKFLOW_KEY);
      expect(response.status).toBe(200);
    }

    const callsBeforeBlock = fetchMock.mock.calls.length;
    const blocked = await postVoice(ip, WORKFLOW_KEY);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^[1-9]\d*$/);
    await expect(blocked.json()).resolves.toEqual({
      error: { message: "Too many requests." },
    });
    expect(fetchMock.mock.calls.length).toBe(callsBeforeBlock);

    resetRateLimit();
    const afterReset = await postVoice(ip, WORKFLOW_KEY);
    expect(afterReset.status).toBe(200);
  });

  it("fails closed with 503 when VOICE_WORKFLOW_KEY is unset", async () => {
    forbidFetch();
    delete process.env.VOICE_WORKFLOW_KEY;

    const response = await postVoice("203.0.113.14", WORKFLOW_KEY);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { message: "Voice service is not configured." },
    });
  });
});
