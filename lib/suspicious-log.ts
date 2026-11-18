// Suspicious-user log: turns Twitch's suspicious-user EventSub events into
// stored rows, and tracks whether capture is actually running for a channel.
//
// Message text never goes to the console here. These are messages Twitch has
// withheld or flagged, and server logs outlive the retention period below.

import type { supabaseAdmin } from './supabase';
import { SHARE_EXPIRED_KEEP_DAYS } from './suspicious-log-query';
import {
  SUSPICIOUS_MESSAGE_SUBSCRIPTION,
  SUSPICIOUS_UPDATE_SUBSCRIPTION,
  createSuspiciousLogSubscriptions,
  deleteSuspiciousLogSubscriptions,
  type SuspiciousSubscriptionResult,
} from './twitch-eventsub';

type Sb = ReturnType<typeof supabaseAdmin>;

export const SUSPICIOUS_LOG_RETENTION_DAYS = 365;

export type SuspiciousLogStatus = 'off' | SuspiciousSubscriptionResult;

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const textList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

type RawEvent = Record<string, unknown> & { message?: Record<string, unknown> | null };

/** The row for a suspicious-user message, or null if the event lacks what
 *  identifies it. `shared_ban_channel_ids` arrives as null when there are none. */
export function parseSuspiciousMessage(event: RawEvent, sentAt: string) {
  const message = event.message ?? {};
  const messageId = text(message.message_id);
  const userId = text(event.user_id);
  const login = text(event.user_login);
  const status = text(event.low_trust_status);
  if (!messageId || !userId || !login || !status) return null;

  return {
    twitch_message_id: messageId,
    chatter_user_id: userId,
    chatter_login: login,
    chatter_name: text(event.user_name) ?? login,
    message_text: typeof message.text === 'string' ? message.text : '',
    fragments: Array.isArray(message.fragments) ? message.fragments : [],
    low_trust_status: status,
    detection_types: textList(event.types),
    ban_evasion_evaluation: text(event.ban_evasion_evaluation),
    shared_ban_channel_ids: textList(event.shared_ban_channel_ids),
    sent_at: sentAt,
  };
}

/** The row for a status change, or null if the event lacks what identifies it. */
export function parseSuspiciousStatusChange(event: RawEvent, deliveryId: string, changedAt: string) {
  const userId = text(event.user_id);
  const login = text(event.user_login);
  const status = text(event.low_trust_status);
  if (!deliveryId || !userId || !login || !status) return null;

  return {
    twitch_event_id: deliveryId,
    chatter_user_id: userId,
    chatter_login: login,
    chatter_name: text(event.user_name) ?? login,
    moderator_user_id: text(event.moderator_user_id),
    moderator_login: text(event.moderator_user_login),
    low_trust_status: status,
    changed_at: changedAt,
  };
}

export type RecordOutcome = 'stored' | 'ignored' | 'failed';

/**
 * Stores one suspicious-user event. 'failed' means the caller should make
 * Twitch retry: there's no way to fetch a missed message later. Retried
 * deliveries land on the tables' unique constraints and are skipped.
 */
export async function recordSuspiciousEvent(
  sb: Sb,
  input: { subscriptionType: string; event: RawEvent; deliveryId: string; sentAt: string },
): Promise<RecordOutcome> {
  const { subscriptionType, event, deliveryId, sentAt } = input;

  const { data: stream, error: streamErr } = await sb
    .from('streams')
    .select('id, approved, suspicious_log_enabled')
    .eq('twitch_user_id', String(event.broadcaster_user_id ?? ''))
    .maybeSingle();
  if (streamErr) {
    console.error('suspicious-log: stream lookup failed:', streamErr.message);
    return 'failed';
  }
  if (!stream || stream.approved === false || stream.suspicious_log_enabled !== true) return 'ignored';

  if (subscriptionType === SUSPICIOUS_MESSAGE_SUBSCRIPTION) {
    const row = parseSuspiciousMessage(event, sentAt);
    if (!row) {
      console.error('suspicious-log: malformed message event', deliveryId);
      return 'ignored';
    }
    const { error } = await sb
      .from('suspicious_messages')
      .upsert({ stream_id: stream.id, ...row }, { onConflict: 'stream_id,twitch_message_id', ignoreDuplicates: true });
    if (error) {
      console.error('suspicious-log: message insert failed:', error.message);
      return 'failed';
    }
    return 'stored';
  }

  if (subscriptionType === SUSPICIOUS_UPDATE_SUBSCRIPTION) {
    const row = parseSuspiciousStatusChange(event, deliveryId, sentAt);
    if (!row) {
      console.error('suspicious-log: malformed status event', deliveryId);
      return 'ignored';
    }
    const { error } = await sb
      .from('suspicious_status_changes')
      .upsert({ stream_id: stream.id, ...row }, { onConflict: 'stream_id,twitch_event_id', ignoreDuplicates: true });
    if (error) {
      console.error('suspicious-log: status insert failed:', error.message);
      return 'failed';
    }
    return 'stored';
  }

  return 'ignored';
}

async function writeStatus(sb: Sb, streamId: string, status: SuspiciousLogStatus): Promise<void> {
  const { error } = await sb
    .from('streams')
    .update({ suspicious_log_status: status, suspicious_log_status_at: new Date().toISOString() })
    .eq('id', streamId);
  if (error) console.error('suspicious-log: status update failed:', error.message);
}

/** Subscribes a channel and records whether capture is now running. */
export async function connectSuspiciousLog(
  sb: Sb,
  stream: { id: string; twitch_user_id: string },
): Promise<SuspiciousLogStatus> {
  const status = await createSuspiciousLogSubscriptions(stream.twitch_user_id).catch((err) => {
    console.error('suspicious-log: subscribe failed:', err);
    return 'stopped' as const;
  });
  await writeStatus(sb, stream.id, status);
  return status;
}

/** Unsubscribes a channel whose module was turned off. Stored messages stay
 *  until they age out. */
export async function disconnectSuspiciousLog(
  sb: Sb,
  stream: { id: string; twitch_user_id: string },
): Promise<SuspiciousLogStatus> {
  const removed = await deleteSuspiciousLogSubscriptions(stream.twitch_user_id).catch(() => false);
  if (!removed) console.error('suspicious-log: could not remove subscriptions for', stream.id);
  await writeStatus(sb, stream.id, 'off');
  return 'off';
}

/** Records that Twitch ended a channel's capture, so the log can say so. */
export async function markSuspiciousLogRevoked(
  sb: Sb,
  broadcasterUserId: string,
  reason: unknown,
): Promise<void> {
  const status: SuspiciousLogStatus = reason === 'authorization_revoked' ? 'needs_reconnect' : 'stopped';
  const { error } = await sb
    .from('streams')
    .update({ suspicious_log_status: status, suspicious_log_status_at: new Date().toISOString() })
    .eq('twitch_user_id', broadcasterUserId)
    .eq('suspicious_log_enabled', true);
  if (error) console.error('suspicious-log: revocation update failed:', error.message);
}

/** Deletes everything past the retention period. */
export async function purgeExpiredSuspiciousLog(sb: Sb, now: number) {
  const cutoff = new Date(now - SUSPICIOUS_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const messages = await sb.from('suspicious_messages').delete({ count: 'exact' }).lt('sent_at', cutoff);
  const changes = await sb.from('suspicious_status_changes').delete({ count: 'exact' }).lt('changed_at', cutoff);
  // Share links go once they've been expired for a while.
  const sharesCutoff = new Date(now - SHARE_EXPIRED_KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const shares = await sb.from('suspicious_shares').delete({ count: 'exact' }).lt('expires_at', sharesCutoff);
  return {
    messagesDeleted: messages.count ?? 0,
    statusChangesDeleted: changes.count ?? 0,
    sharesDeleted: shares.count ?? 0,
    error: messages.error?.message ?? changes.error?.message ?? shares.error?.message ?? null,
  };
}
