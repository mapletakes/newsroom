import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  verifySignature,
  isTimestampFresh,
  resolveEventId,
  classifyDedupOutcome,
} from './twitch-eventsub';

function sign(secret: string, messageId: string, timestamp: string, body: string) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(messageId + timestamp + body).digest('hex');
}

describe('verifySignature', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a correctly signed webhook', () => {
    vi.stubEnv('EVENTSUB_SECRET', 'test-secret');
    const sig = sign('test-secret', 'msg-1', '2026-01-01T00:00:00Z', '{"a":1}');
    expect(verifySignature('msg-1', '2026-01-01T00:00:00Z', '{"a":1}', sig)).toBe(true);
  });

  it('rejects a signature computed with the wrong secret', () => {
    vi.stubEnv('EVENTSUB_SECRET', 'test-secret');
    const sig = sign('wrong-secret', 'msg-1', '2026-01-01T00:00:00Z', '{"a":1}');
    expect(verifySignature('msg-1', '2026-01-01T00:00:00Z', '{"a":1}', sig)).toBe(false);
  });

  it('rejects if any signed field (id, timestamp, or body) is altered', () => {
    vi.stubEnv('EVENTSUB_SECRET', 'test-secret');
    const sig = sign('test-secret', 'msg-1', '2026-01-01T00:00:00Z', '{"a":1}');
    expect(verifySignature('msg-2', '2026-01-01T00:00:00Z', '{"a":1}', sig)).toBe(false);
    expect(verifySignature('msg-1', '2026-01-01T00:00:01Z', '{"a":1}', sig)).toBe(false);
    expect(verifySignature('msg-1', '2026-01-01T00:00:00Z', '{"a":2}', sig)).toBe(false);
  });

  it('rejects a malformed / wrong-length signature without throwing', () => {
    vi.stubEnv('EVENTSUB_SECRET', 'test-secret');
    expect(() => verifySignature('msg-1', '2026-01-01T00:00:00Z', '{}', 'sha256=short')).not.toThrow();
    expect(verifySignature('msg-1', '2026-01-01T00:00:00Z', '{}', 'sha256=short')).toBe(false);
    expect(verifySignature('msg-1', '2026-01-01T00:00:00Z', '{}', '')).toBe(false);
  });

  it('always rejects when EVENTSUB_SECRET is unset', () => {
    vi.stubEnv('EVENTSUB_SECRET', '');
    const sig = sign('anything', 'msg-1', '2026-01-01T00:00:00Z', '{}');
    expect(verifySignature('msg-1', '2026-01-01T00:00:00Z', '{}', sig)).toBe(false);
  });
});

describe('isTimestampFresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts a timestamp from right now', () => {
    expect(isTimestampFresh(new Date().toISOString())).toBe(true);
  });

  it('rejects a timestamp older than 10 minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:11:00Z'));
    expect(isTimestampFresh('2026-01-01T00:00:00Z')).toBe(false);
  });

  it('accepts a timestamp just under the 10 minute boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:09:59Z'));
    expect(isTimestampFresh('2026-01-01T00:00:00Z')).toBe(true);
  });

  it('also rejects a timestamp more than 10 minutes in the future (symmetric check)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    expect(isTimestampFresh('2026-01-01T00:11:00Z')).toBe(false);
  });
});

describe('resolveEventId', () => {
  it('prefers the chat message id, stable across retried/duplicate deliveries', () => {
    expect(resolveEventId({ message_id: 'chat-msg-1' }, 'delivery-1')).toBe('chat-msg-1');
  });

  it('falls back to the delivery id when message_id is missing', () => {
    expect(resolveEventId({}, 'delivery-1')).toBe('delivery-1');
    expect(resolveEventId({ message_id: '' }, 'delivery-1')).toBe('delivery-1');
  });
});

describe('classifyDedupOutcome', () => {
  it('processes when the insert succeeded (id was new)', () => {
    expect(classifyDedupOutcome(null)).toBe('process');
  });

  it('treats a unique-violation (23505) as an already-seen duplicate', () => {
    expect(classifyDedupOutcome({ code: '23505' })).toBe('duplicate');
  });

  it('does NOT drop the message on an unrelated DB error (fails open)', () => {
    expect(classifyDedupOutcome({ code: '42P01' })).toBe('process-with-warning');
    expect(classifyDedupOutcome({})).toBe('process-with-warning');
  });
});
