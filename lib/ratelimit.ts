import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import crypto from 'crypto';

// Protects the token-authed, externally-facing endpoints (extension,
// bookmarklet, OBS overlay) — a leaked or abused token would otherwise be
// able to drive unlimited AI/search spend, or (per a real incident) hammer
// the database if a client ever gets stuck retrying in a loop.
//
// Degrades gracefully — fails OPEN — if Upstash isn't configured, same
// pattern as other optional integrations in this app (e.g. Brave Search):
// the app must never break because rate limiting wasn't set up. Logs once
// so the gap is visible rather than silently permanent.
let redis: Redis | null | undefined;
let warned = false;
function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!warned) {
      console.warn('Rate limiting disabled: UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN not set');
      warned = true;
    }
    redis = null;
    return null;
  }
  redis = new Redis({ url, token });
  return redis;
}

// Hash tokens before using them as Redis keys — avoids storing raw secrets
// in a third-party store, even for something as low-stakes as a counter key.
export function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

type Kind = 'write' | 'read' | 'poll' | 'question' | 'raffle';

let writeLimiter: Ratelimit | undefined;
let readLimiter: Ratelimit | undefined;
let pollLimiter: Ratelimit | undefined;
let questionLimiter: Ratelimit | undefined;
let raffleLimiter: Ratelimit | undefined;

function limiterFor(kind: Kind): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;
  if (kind === 'write') {
    // quick-add (extension + bookmarklet): each call can trigger real AI/
    // search cost. Generous enough for a legitimate burst of pasted links.
    return (writeLimiter ??= new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(20, '1 m'),
      prefix: 'rl:write',
    }));
  }
  if (kind === 'read') {
    // segments list: cheap DB read, used by the extension's menu.
    return (readLimiter ??= new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(30, '1 m'),
      prefix: 'rl:read',
    }));
  }
  if (kind === 'poll') {
    // overlay: legitimate traffic is ~1 poll/30s plus the occasional
    // realtime-triggered refresh — well under 10/10s even on a fast-paced
    // show. Sized to cut off a runaway client loop within seconds rather
    // than let it run wild (this would have capped the blast radius of the
    // realtime reconnect bug well before it became hundreds of thousands of
    // requests).
    return (pollLimiter ??= new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(10, '10 s'),
      prefix: 'rl:poll',
    }));
  }
  if (kind === 'raffle') {
    // !enter: entries are already deduped by the DB's unique(raffle_id,
    // chatter_login) — a repeat !enter from the same person is a harmless
    // no-op insert, not a queue someone can flood. This is defense-in-depth
    // against a bot hammering the command anyway, keyed per-chatter same as
    // question so it can't blunt a genuine burst of DIFFERENT people
    // entering at once.
    return (raffleLimiter ??= new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(3, '20 s'),
      prefix: 'rl:raffle',
    }));
  }
  // !question command: keyed per-asker (not per-channel, unlike video_command
  // — one person shouldn't be able to flood the mod queue during exactly the
  // moment questions matter most). One every 20s is enough for a real asker
  // rephrasing or adding a follow-up, tight enough to blunt a spam bot.
  return (questionLimiter ??= new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(1, '20 s'),
    prefix: 'rl:question',
  }));
}

/**
 * Check a rate limit for `key` under the named bucket. Returns `{ ok: true }`
 * when the request is allowed (including when rate limiting isn't
 * configured — fails open); returns `{ ok: false, retryAfterSeconds }` when
 * the caller should respond 429.
 */
export async function checkRateLimit(
  kind: Kind,
  key: string,
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const limiter = limiterFor(kind);
  if (!limiter) return { ok: true };
  const { success, reset } = await limiter.limit(key);
  if (success) return { ok: true };
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((reset - Date.now()) / 1000)) };
}
