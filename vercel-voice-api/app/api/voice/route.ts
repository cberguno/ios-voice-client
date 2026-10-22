import { handleVoice } from "../../../lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const preferredRegion = "iad1";

export async function GET(): Promise<Response> {
  // Liveness only: does not establish that API credentials or provider calls work.
  return Response.json(
    { ok: true, service: "voice-loop" },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleVoice(request);
}
