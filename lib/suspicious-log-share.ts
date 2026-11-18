// Share links for the suspicious-user log: creating them, judging whether one
// still works, and loading what one points at. Server only.

import crypto from 'crypto';
import type { supabaseAdmin } from './supabase';
import {
  MAX_SHARE_MESSAGES,
  SHARE_TTL_DAYS,
  chunk,
  type ShareStatus,
  type SharedMessage,
} from './suspicious-log-query';

type Sb = ReturnType<typeof supabaseAdmin>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The whole token is the credential, so it's 192 bits of randomness. */
export const SHARE_TOKEN_RE = /^sl_[0-9a-f]{48}$/;

export function newShareToken(): string {
  return `sl_${crypto.randomBytes(24).toString('hex')}`;
}

export type ShareRequest =
  | { kind: 'messages'; messageIds: string[] }
  | { kind: 'chatter'; chatterId: string };

/** A well-formed request, or null. Anything else is the caller's mistake. */
export function parseShareRequest(body: unknown): ShareRequest | null {
  if (!body || typeof body !== 'object') return null;
  const { kind, messageIds, chatterId } = body as Record<string, unknown>;

  if (kind === 'chatter') {
    return typeof chatterId === 'string' && /^\d{1,20}$/.test(chatterId) ? { kind, chatterId } : null;
  }
  if (kind === 'messages') {
    if (!Array.isArray(messageIds)) return null;
    if (!messageIds.every((id) => typeof id === 'string' && UUID.test(id))) return null;
    const unique = [...new Set(messageIds as string[])];
    return unique.length >= 1 && unique.length <= MAX_SHARE_MESSAGES ? { kind, messageIds: unique } : null;
  }
  return null;
}

export function shareExpiry(now: number): string {
  return new Date(now + SHARE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function shareStatus(
  share: { expires_at: string; revoked_at: string | null },
  now: number,
): ShareStatus {
  if (share.revoked_at) return 'revoked';
  return new Date(share.expires_at).getTime() > now ? 'active' : 'expired';
}

/** Most messages a shared page will show. */
export const SHARED_LOG_LIMIT = 5000;

export type SharedLog = {
  label: string;
  channelName: string;
  createdAt: string;
  expiresAt: string;
  messages: SharedMessage[];
  /** True when the link points at more than SHARED_LOG_LIMIT messages. */
  truncated: boolean;
};

const MESSAGE_COLUMNS = 'id, sent_at, chatter_name, message_text, low_trust_status';

type StoredMessage = SharedMessage & { id: string };

/**
 * What a share link shows, or null when there is nothing to show: no such link,
 * revoked, expired, or the channel is no longer approved. Those are
 * deliberately not told apart, so a stranger probing tokens learns nothing.
 * A database failure throws instead, so it never reads as "expired".
 */
export async function loadSharedLog(sb: Sb, token: string, now = Date.now()): Promise<SharedLog | null> {
  if (!SHARE_TOKEN_RE.test(token)) return null;

  const { data: share, error: shareErr } = await sb
    .from('suspicious_shares')
    .select('stream_id, kind, message_ids, chatter_user_id, label, created_at, expires_at, revoked_at')
    .eq('token', token)
    .maybeSingle();
  if (shareErr) throw new Error(`share lookup failed: ${shareErr.message}`);
  if (!share || shareStatus(share, now) !== 'active') return null;

  const { data: stream, error: streamErr } = await sb
    .from('streams')
    .select('display_name, twitch_login, approved')
    .eq('id', share.stream_id)
    .maybeSingle();
  if (streamErr) throw new Error(`channel lookup failed: ${streamErr.message}`);
  if (!stream || stream.approved === false) return null;

  let rows: StoredMessage[] = [];
  if (share.kind === 'chatter') {
    const { data, error } = await sb
      .from('suspicious_messages')
      .select(MESSAGE_COLUMNS)
      .eq('stream_id', share.stream_id)
      .eq('chatter_user_id', share.chatter_user_id)
      .lte('sent_at', share.created_at)
      .order('sent_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(SHARED_LOG_LIMIT + 1);
    if (error) throw new Error(`message lookup failed: ${error.message}`);
    rows = data ?? [];
  } else {
    for (const ids of chunk<string>(share.message_ids ?? [])) {
      const { data, error } = await sb
        .from('suspicious_messages')
        .select(MESSAGE_COLUMNS)
        .eq('stream_id', share.stream_id)
        .in('id', ids);
      if (error) throw new Error(`message lookup failed: ${error.message}`);
      rows.push(...(data ?? []));
    }
    rows.sort((a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at) || a.id.localeCompare(b.id));
  }

  const truncated = rows.length > SHARED_LOG_LIMIT;
  return {
    label: share.label,
    channelName: stream.display_name || stream.twitch_login || 'A channel',
    createdAt: share.created_at,
    expiresAt: share.expires_at,
    truncated,
    messages: rows.slice(0, SHARED_LOG_LIMIT).map(({ sent_at, chatter_name, message_text, low_trust_status }) => ({
      sent_at,
      chatter_name,
      message_text,
      low_trust_status,
    })),
  };
}
