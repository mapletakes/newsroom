import { describe, expect, it, vi } from 'vitest';
import {
  markSuspiciousLogRevoked,
  parseSuspiciousMessage,
  parseSuspiciousStatusChange,
  purgeExpiredSuspiciousLog,
  recordSuspiciousEvent,
  SUSPICIOUS_LOG_RETENTION_DAYS,
} from './suspicious-log';
import { SUSPICIOUS_MESSAGE_SUBSCRIPTION, SUSPICIOUS_UPDATE_SUBSCRIPTION } from './twitch-eventsub';

const SENT_AT = '2026-11-18T19:09:24.448Z';

// Shape captured from a live channel.suspicious_user.message delivery.
const messageEvent = {
  broadcaster_user_id: '100',
  user_id: '200',
  user_name: 'Viewer',
  user_login: 'viewer',
  low_trust_status: 'restricted',
  shared_ban_channel_ids: null,
  types: ['manually_added'],
  ban_evasion_evaluation: 'unknown',
  message: {
    message_id: 'msg-1',
    text: 'hello',
    fragments: [{ type: 'text', text: 'hello', cheermote: null, emote: null }],
  },
};

const statusEvent = {
  broadcaster_user_id: '100',
  user_id: '200',
  user_name: 'Viewer',
  user_login: 'viewer',
  moderator_user_id: '300',
  moderator_user_login: 'mod',
  low_trust_status: 'active_monitoring',
};

function fakeDb(opts: {
  stream?: Record<string, unknown> | null;
  streamError?: { message: string } | null;
  upsertError?: { message: string } | null;
} = {}) {
  const stream = opts.stream === undefined
    ? { id: 'stream-1', approved: true, suspicious_log_enabled: true }
    : opts.stream;
  const upsert = vi.fn(async () => ({ error: opts.upsertError ?? null }));
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.maybeSingle = async () => ({ data: stream, error: opts.streamError ?? null });
    chain.upsert = upsert;
    return chain;
  });
  return { sb: { from } as never, from, upsert };
}

type RecordInput = Parameters<typeof recordSuspiciousEvent>[1];

const record = (sb: never, subscriptionType = SUSPICIOUS_MESSAGE_SUBSCRIPTION, event: RecordInput['event'] = messageEvent) =>
  recordSuspiciousEvent(sb, { subscriptionType, event, deliveryId: 'delivery-1', sentAt: SENT_AT });

const skippedChannels: [string, Record<string, unknown> | null][] = [
  ['an unknown channel', null],
  ['a blocked channel', { id: 'stream-1', approved: false, suspicious_log_enabled: true }],
  ['a channel with the module off', { id: 'stream-1', approved: true, suspicious_log_enabled: false }],
];

describe('parseSuspiciousMessage', () => {
  it('maps a live payload, treating null shared bans as none', () => {
    expect(parseSuspiciousMessage(messageEvent, SENT_AT)).toEqual({
      twitch_message_id: 'msg-1',
      chatter_user_id: '200',
      chatter_login: 'viewer',
      chatter_name: 'Viewer',
      message_text: 'hello',
      fragments: messageEvent.message.fragments,
      low_trust_status: 'restricted',
      detection_types: ['manually_added'],
      ban_evasion_evaluation: 'unknown',
      shared_ban_channel_ids: [],
      sent_at: SENT_AT,
    });
  });

  it('keeps a status value it has never seen rather than losing the message', () => {
    expect(parseSuspiciousMessage({ ...messageEvent, low_trust_status: 'new_status' }, SENT_AT)?.low_trust_status).toBe('new_status');
  });

  it('rejects an event with no message id', () => {
    expect(parseSuspiciousMessage({ ...messageEvent, message: { text: 'hello' } }, SENT_AT)).toBeNull();
    expect(parseSuspiciousMessage({ ...messageEvent, message: null }, SENT_AT)).toBeNull();
  });
});

describe('parseSuspiciousStatusChange', () => {
  it('records who made the change', () => {
    expect(parseSuspiciousStatusChange(statusEvent, 'delivery-1', SENT_AT)).toMatchObject({
      twitch_event_id: 'delivery-1',
      moderator_user_id: '300',
      moderator_login: 'mod',
      low_trust_status: 'active_monitoring',
      changed_at: SENT_AT,
    });
  });

  it('allows a change with no moderator', () => {
    const automatic = { ...statusEvent, moderator_user_id: null, moderator_user_login: null };
    expect(parseSuspiciousStatusChange(automatic, 'delivery-1', SENT_AT)?.moderator_user_id).toBeNull();
  });
});

describe('recordSuspiciousEvent', () => {
  it('stores a message once per Twitch message id', async () => {
    const { sb, from, upsert } = fakeDb();
    expect(await record(sb)).toBe('stored');
    expect(from).toHaveBeenCalledWith('suspicious_messages');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ stream_id: 'stream-1', twitch_message_id: 'msg-1' }),
      { onConflict: 'stream_id,twitch_message_id', ignoreDuplicates: true },
    );
  });

  it('stores a status change', async () => {
    const { sb, from } = fakeDb();
    expect(await record(sb, SUSPICIOUS_UPDATE_SUBSCRIPTION, statusEvent)).toBe('stored');
    expect(from).toHaveBeenCalledWith('suspicious_status_changes');
  });

  it.each(skippedChannels)('stores nothing for %s', async (_label, stream) => {
    const { sb, upsert } = fakeDb({ stream });
    expect(await record(sb)).toBe('ignored');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('reports a failed write so Twitch retries', async () => {
    const { sb } = fakeDb({ upsertError: { message: 'down' } });
    expect(await record(sb)).toBe('failed');
  });

  it('reports a failed channel lookup so Twitch retries', async () => {
    const { sb } = fakeDb({ stream: null, streamError: { message: 'down' } });
    expect(await record(sb)).toBe('failed');
  });

  it('never writes message text to the console', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sb } = fakeDb({ upsertError: { message: 'down' } });
    await record(sb);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('hello');
    spy.mockRestore();
  });
});

describe('markSuspiciousLogRevoked', () => {
  function revocationDb() {
    const update = vi.fn(() => {
      const chain: { eq: () => unknown; error: null } = { eq: () => chain, error: null };
      return chain;
    });
    return { sb: { from: () => ({ update }) } as never, update };
  }

  it('asks for a reconnect when the streamer withdrew authorization', async () => {
    const { sb, update } = revocationDb();
    await markSuspiciousLogRevoked(sb, '100', 'authorization_revoked');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ suspicious_log_status: 'needs_reconnect' }));
  });

  it('marks capture stopped for any other reason', async () => {
    const { sb, update } = revocationDb();
    await markSuspiciousLogRevoked(sb, '100', 'notification_failures_exceeded');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ suspicious_log_status: 'stopped' }));
  });
});

describe('purgeExpiredSuspiciousLog', () => {
  it('deletes only entries older than the retention period', async () => {
    const lt = vi.fn(async () => ({ count: 2, error: null }));
    const sb = { from: () => ({ delete: () => ({ lt }) }) } as never;
    const now = Date.parse('2026-11-18T00:00:00Z');

    const result = await purgeExpiredSuspiciousLog(sb, now);

    const cutoff = new Date(now - SUSPICIOUS_LOG_RETENTION_DAYS * 86_400_000).toISOString();
    expect(lt).toHaveBeenCalledWith('sent_at', cutoff);
    expect(lt).toHaveBeenCalledWith('changed_at', cutoff);
    expect(result).toEqual({ messagesDeleted: 2, statusChangesDeleted: 2, error: null });
  });
});
