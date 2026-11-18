import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  verifySignature,
  isTimestampFresh,
  resolveEventId,
  classifyDedupOutcome,
  createChatSubscription,
  createSuspiciousLogSubscriptions,
  deleteSuspiciousLogSubscriptions,
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

describe('subscription management', () => {
  const SUBSCRIPTIONS_URL = 'https://api.twitch.tv/helix/eventsub/subscriptions';

  function stubTwitch(respond: (type: string) => Response) {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test/');
    vi.stubEnv('EVENTSUB_SECRET', 'secret');
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).startsWith('https://id.twitch.tv/')) {
        return new Response(JSON.stringify({ access_token: 'app-token', expires_in: 3600 }));
      }
      return respond(JSON.parse(String(init?.body)).type);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const created = () => new Response(JSON.stringify({ data: [{ id: 'sub-1', status: 'pending' }] }), { status: 202 });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('subscribes to messages and status changes with the broadcaster as moderator', async () => {
    const fetchMock = stubTwitch(created);

    expect(await createSuspiciousLogSubscriptions('100')).toBe('active');

    const bodies = fetchMock.mock.calls
      .filter(([url]) => String(url) === SUBSCRIPTIONS_URL)
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies.map((b) => b.type).sort()).toEqual([
      'channel.suspicious_user.message',
      'channel.suspicious_user.update',
    ]);
    for (const body of bodies) {
      expect(body.condition).toEqual({ broadcaster_user_id: '100', moderator_user_id: '100' });
      expect(body.transport.callback).toBe('https://app.test/api/twitch/eventsub');
    }
  });

  it('treats subscriptions that already exist as active', async () => {
    stubTwitch(() => new Response('exists', { status: 409 }));
    expect(await createSuspiciousLogSubscriptions('100')).toBe('active');
  });

  it('asks for a reconnect when the scope has not been granted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubTwitch((type) => (type.endsWith('.update') ? new Response('no', { status: 403 }) : created()));
    expect(await createSuspiciousLogSubscriptions('100')).toBe('needs_reconnect');
  });

  it('reports any other failure as stopped', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubTwitch(() => new Response('down', { status: 500 }));
    expect(await createSuspiciousLogSubscriptions('100')).toBe('stopped');
  });

  it('keeps the chat subscription contract unchanged', async () => {
    stubTwitch(created);
    expect(await createChatSubscription('100')).toBe('sub-1');

    stubTwitch(() => new Response('exists', { status: 409 }));
    expect(await createChatSubscription('100')).toBe('existing');

    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubTwitch(() => new Response('down', { status: 500 }));
    expect(await createChatSubscription('100')).toBeNull();
  });

  it('deletes only this channel\'s suspicious-user subscriptions', async () => {
    vi.stubEnv('NEXT_PUBLIC_TWITCH_CLIENT_ID', 'client');
    const deleted: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.startsWith('https://id.twitch.tv/')) {
        return new Response(JSON.stringify({ access_token: 'app-token', expires_in: 3600 }));
      }
      if (init?.method === 'DELETE') {
        deleted.push(new URL(target).searchParams.get('id') as string);
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({
        data: [
          { id: 'keep-chat', type: 'channel.chat.message', condition: { broadcaster_user_id: '100' } },
          { id: 'keep-other', type: 'channel.suspicious_user.message', condition: { broadcaster_user_id: '999' } },
          { id: 'remove-1', type: 'channel.suspicious_user.message', condition: { broadcaster_user_id: '100' } },
          { id: 'remove-2', type: 'channel.suspicious_user.update', condition: { broadcaster_user_id: '100' } },
        ],
        pagination: {},
      }));
    }));

    expect(await deleteSuspiciousLogSubscriptions('100')).toBe(true);
    expect(deleted).toEqual(['remove-1', 'remove-2']);
  });
});
