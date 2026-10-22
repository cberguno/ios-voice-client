import test from "node:test";
import assert from "node:assert/strict";
import { handleVoice } from "../lib/voice";

const env = {
  VOICE_WORKFLOW_KEY: "test-workflow-secret",
  OPENROUTER_API_KEY: "test-openrouter-key",
  ELEVENLABS_API_KEY: "test-elevenlabs-key",
  ELEVENLABS_VOICE_ID: "CwhRBWXzGAHq8TQ4Fs17",
};

function request(text = "Hello", key = env.VOICE_WORKFLOW_KEY) {
  return new Request("http://localhost/api/voice", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify({ text }),
  });
}

test("valid request returns text and base64 audio, without caching", async () => {
  const calls: string[] = [];
  const mockFetch: typeof fetch = async (url, options) => {
    calls.push(String(url));
    const headers = new Headers(options?.headers);
    if (calls.length === 1) {
      assert.equal(headers.get("Authorization"), "Bearer test-openrouter-key");
      const body = JSON.parse(String(options?.body));
      assert.equal(body.messages[1].content, "Hello");
      return Response.json({ choices: [{ message: { content: "Hello back!" } }] });
    }
    assert.equal(headers.get("xi-api-key"), "test-elevenlabs-key");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.text, "Hello back!");
    return new Response(Buffer.from("ID3-mp3-test-audio"), {
      headers: { "Content-Type": "audio/mpeg" },
    });
  };
  const result = await handleVoice(request(), env, mockFetch);
  const body = await result.json();
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal(body.text, "Hello back!");
  assert.equal(Buffer.from(body.audioBase64, "base64").toString(), "ID3-mp3-test-audio");
  assert.match(calls[0], /openrouter/);
  assert.match(calls[1], /elevenlabs/);
});

test("missing workflow key is unauthorized; provider never called", async () => {
  const notCalled: typeof fetch = async () => { throw Error("must not call provider"); };
  const response = await handleVoice(request("Hello", "wrong"), env, notCalled);
  assert.equal(response.status, 401);
});

test("missing credentials is a configuration failure", async () => {
  const response = await handleVoice(request(), { ...env, ELEVENLABS_API_KEY: "" });
  assert.equal(response.status, 503);
});

test("empty message is rejected", async () => {
  const response = await handleVoice(request(" "));
  assert.equal(response.status, 400);
});

test("ElevenLabs 402 becomes actionable 502 and no audio", async () => {
  let count = 0;
  const mockFetch: typeof fetch = async () => {
    count++;
    return count === 1
      ? Response.json({ choices: [{ message: { content: "Hi" } }] })
      : new Response("plan limit", { status: 402 });
  };
  const response = await handleVoice(request(), env, mockFetch);
  assert.equal(response.status, 502);
  assert.match(JSON.stringify(await response.json()), /402/);
});

test("upstream failures do not reveal provider keys", async () => {
  const mockFetch: typeof fetch = async () =>
    new Response("sensitive-provider-body", { status: 403 });
  const response = await handleVoice(request(), env, mockFetch);
  const data = JSON.stringify(await response.json());
  assert.equal(response.status, 502);
  assert.doesNotMatch(data, /test-openrouter-key|sensitive-provider-body/);
});
