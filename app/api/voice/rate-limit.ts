/**
 * In-memory sliding window: 10 requests per minute per IP.
 * Each serverless instance keeps its own map, so this is not a global cap.
 * A shared store such as Upstash Redis or Vercel KV is the follow-up.
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;

const hitsByIp = new Map<string, number[]>();

export function resetRateLimit(): void {
  hitsByIp.clear();
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim() ?? "";
    if (first.length > 0) {
      return first;
    }
  }
  const realIp = headers.get("x-real-ip")?.trim() ?? "";
  if (realIp.length > 0) {
    return realIp;
  }
  return "unknown";
}

export type RateLimitDecision =
  | { limited: false }
  | { limited: true; retryAfterSeconds: number };

export function consumeRateLimit(ip: string, now = Date.now()): RateLimitDecision {
  const windowStart = now - WINDOW_MS;
  const recent = (hitsByIp.get(ip) ?? []).filter((stamp) => stamp > windowStart);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    const oldest = recent[0] ?? now;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + WINDOW_MS - now) / 1000),
    );
    hitsByIp.set(ip, recent);
    return { limited: true, retryAfterSeconds };
  }
  recent.push(now);
  hitsByIp.set(ip, recent);
  return { limited: false };
}
