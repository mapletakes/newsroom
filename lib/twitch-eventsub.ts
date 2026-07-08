// Twitch EventSub webhook helpers.
// Twitch pushes chat messages to our /api/twitch/eventsub endpoint
// via HTTP — no persistent connection or separate worker needed.

import crypto from 'crypto';

const HMAC_PREFIX = 'sha256=';

// ── App Access Token (client credentials) ──────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Get a Twitch App Access Token (client credentials flow). Cached in memory. */
export async function getAppAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET!;

  const r = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });

  if (!r.ok) throw new Error(`App access token failed: ${r.status}`);
  const data = await r.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 300) * 1000, // refresh 5 min early
  };
  return data.access_token;
}

// ── Signature verification ─────────────────────────────────────

export function getEventSubSecret(): string {
  return process.env.EVENTSUB_SECRET || '';
}

/** Verify the HMAC-SHA256 signature on an incoming EventSub webhook. */
export function verifySignature(
  messageId: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): boolean {
  const secret = getEventSubSecret();
  if (!secret) return false;

  const hmacMessage = messageId + timestamp + rawBody;
  const expected =
    HMAC_PREFIX +
    crypto.createHmac('sha256', secret).update(hmacMessage).digest('hex');

  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/** Reject messages older than 10 minutes (replay protection). */
export function isTimestampFresh(timestamp: string): boolean {
  const diff = Math.abs(Date.now() - new Date(timestamp).getTime());
  return diff < 10 * 60 * 1000;
}

// ── Idempotency ─────────────────────────────────────────────────

/**
 * Which id to dedup a chat-message notification on: Twitch's stable
 * per-message id when present (identical across every retry/duplicate
 * delivery of the same chat message), falling back to the webhook
 * delivery id otherwise.
 */
export function resolveEventId(event: { message_id?: string }, deliveryMsgId: string): string {
  return event.message_id || deliveryMsgId;
}

export type DedupOutcome = 'process' | 'duplicate' | 'process-with-warning';

/**
 * Decide what to do after attempting to record an event id as seen (via a
 * unique-constrained insert). A unique-violation means another delivery
 * already claimed this id — drop it. Any other error (e.g. the dedup table
 * isn't migrated yet) must NOT be treated as "already seen": that would
 * silently drop real chat messages, so process it anyway and just warn.
 */
export function classifyDedupOutcome(insertError: { code?: string } | null): DedupOutcome {
  if (!insertError) return 'process';
  if (insertError.code === '23505') return 'duplicate';
  return 'process-with-warning';
}

// ── Subscription management ────────────────────────────────────

/**
 * Create an EventSub subscription for `channel.chat.message`.
 * Uses broadcaster's user ID as both broadcaster_user_id and user_id
 * (the broadcaster must have granted `user:read:chat` via OAuth).
 *
 * Returns the subscription ID, or null on failure.
 * If the subscription already exists, Twitch returns 409 — we treat that as success.
 */
export async function createChatSubscription(
  broadcasterUserId: string,
): Promise<string | null> {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  const secret = getEventSubSecret();
  if (!appUrl || !secret) {
    console.error('Missing NEXT_PUBLIC_APP_URL or EVENTSUB_SECRET');
    return null;
  }

  const token = await getAppAccessToken();
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!;

  const r = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Client-Id': clientId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'channel.chat.message',
      version: '1',
      condition: {
        broadcaster_user_id: broadcasterUserId,
        user_id: broadcasterUserId,
      },
      transport: {
        method: 'webhook',
        callback: `${appUrl}/api/twitch/eventsub`,
        secret,
      },
    }),
  });

  // 409 = duplicate subscription — that's fine
  if (r.status === 409) {
    console.log(`EventSub chat sub already exists for user ${broadcasterUserId}`);
    return 'existing';
  }

  if (!r.ok) {
    const text = await r.text();
    console.error(`EventSub create failed ${r.status}: ${text}`);
    return null;
  }

  const data = await r.json();
  const sub = data.data?.[0];
  if (sub) {
    console.log(`EventSub chat sub created: ${sub.id} (${sub.status})`);
    return sub.id;
  }
  return null;
}

/**
 * List active EventSub subscriptions for our app.
 * Optionally filter by type.
 */
export async function listSubscriptions(type?: string) {
  const token = await getAppAccessToken();
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!;

  const u = new URL('https://api.twitch.tv/helix/eventsub/subscriptions');
  if (type) u.searchParams.set('type', type);

  const r = await fetch(u, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Client-Id': clientId,
    },
  });

  if (!r.ok) return [];
  const data = await r.json();
  return data.data || [];
}

/**
 * Delete every webhook subscription whose callback doesn't match the current
 * NEXT_PUBLIC_APP_URL — i.e. leftovers pointing at an old domain that would
 * otherwise keep delivering (causing duplicate chat ingestion after a domain
 * change). Paginates through all subscriptions. Guarded: refuses to run if the
 * app URL is unset, so it can never delete the live subscriptions by mistake.
 */
export async function pruneStaleSubscriptions(): Promise<{
  deleted: number;
  kept: number;
  expectedCallback: string;
  deletedCallbacks: Record<string, number>;
}> {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL is not set — refusing to prune');
  const expectedCallback = `${appUrl}/api/twitch/eventsub`;

  const token = await getAppAccessToken();
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!;

  let deleted = 0;
  let kept = 0;
  const deletedCallbacks: Record<string, number> = {};
  let cursor: string | undefined;

  do {
    const u = new URL('https://api.twitch.tv/helix/eventsub/subscriptions');
    if (cursor) u.searchParams.set('after', cursor);
    const r = await fetch(u, {
      headers: { Authorization: `Bearer ${token}`, 'Client-Id': clientId },
    });
    if (!r.ok) throw new Error(`List subscriptions failed: ${r.status}`);
    const data = await r.json();
    for (const sub of data.data || []) {
      const cb: string = sub.transport?.callback || '';
      // Only webhook subs have a callback; mismatch → stale → delete.
      if (cb && cb !== expectedCallback) {
        if (await deleteSubscription(sub.id)) {
          deleted++;
          deletedCallbacks[cb] = (deletedCallbacks[cb] || 0) + 1;
        }
      } else {
        kept++;
      }
    }
    cursor = data.pagination?.cursor;
  } while (cursor);

  return { deleted, kept, expectedCallback, deletedCallbacks };
}

/** Delete an EventSub subscription by ID. */
export async function deleteSubscription(subscriptionId: string): Promise<boolean> {
  const token = await getAppAccessToken();
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID!;

  const r = await fetch(
    `https://api.twitch.tv/helix/eventsub/subscriptions?id=${subscriptionId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Client-Id': clientId,
      },
    },
  );
  return r.ok || r.status === 404;
}
