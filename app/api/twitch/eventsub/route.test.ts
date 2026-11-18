// A suspicious user's message must reach the log and nothing else: this route
// also turns ordinary chat into queue submissions.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));
vi.mock('@/lib/twitch-eventsub', async (orig) => ({
  ...(await orig<typeof import('@/lib/twitch-eventsub')>()),
  verifySignature: vi.fn(() => true),
  isTimestampFresh: vi.fn(() => true),
}));
vi.mock('@/lib/suspicious-log', () => ({
  recordSuspiciousEvent: vi.fn(async () => 'stored'),
  markSuspiciousLogRevoked: vi.fn(async () => {}),
}));
vi.mock('@/lib/submit-url', () => ({ submitUrlToQueue: vi.fn(async () => {}) }));
vi.mock('@/lib/submit-question', () => ({
  matchQuestionCommand: vi.fn(() => null),
  submitQuestionToQueue: vi.fn(async () => {}),
}));
vi.mock('@/lib/raffle', () => ({ handleRaffleEntry: vi.fn(async () => {}) }));
vi.mock('@/lib/announce', () => ({ announceSubmission: vi.fn(async () => {}) }));
vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: vi.fn(async () => ({ ok: true })),
  hashKey: vi.fn((k: string) => k),
}));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.insert = async () => ({ error: null });
      chain.single = async () => ({
        data: table === 'streams'
          ? { id: 's1', twitch_user_id: '100', allow_anyone: true, approved: true, submit_command: null, ignored_users: [] }
          : null,
      });
      return chain;
    },
  }),
}));

import { markSuspiciousLogRevoked, recordSuspiciousEvent } from '@/lib/suspicious-log';
import { submitUrlToQueue } from '@/lib/submit-url';
import { handleRaffleEntry } from '@/lib/raffle';
import { POST } from './route';

const TIMESTAMP = '2026-11-18T19:09:24.448Z';

const deliver = (messageType: string, body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/twitch/eventsub', {
      method: 'POST',
      headers: {
        'twitch-eventsub-message-id': 'delivery-1',
        'twitch-eventsub-message-timestamp': TIMESTAMP,
        'twitch-eventsub-message-signature': 'sha256=test',
        'twitch-eventsub-message-type': messageType,
      },
      body: JSON.stringify(body),
    }),
  );

const suspiciousMessage = {
  subscription: { type: 'channel.suspicious_user.message' },
  event: {
    broadcaster_user_id: '100',
    user_login: 'viewer',
    message: { message_id: 'm1', text: 'watch https://bad.test/link' },
  },
};

afterEach(() => vi.clearAllMocks());

describe('POST /api/twitch/eventsub', () => {
  it('sends a suspicious message containing a link to the log only', async () => {
    const res = await deliver('notification', suspiciousMessage);

    expect(res.status).toBe(204);
    expect(recordSuspiciousEvent).toHaveBeenCalledWith(expect.anything(), {
      subscriptionType: 'channel.suspicious_user.message',
      event: suspiciousMessage.event,
      deliveryId: 'delivery-1',
      sentAt: TIMESTAMP,
    });
    expect(submitUrlToQueue).not.toHaveBeenCalled();
    expect(handleRaffleEntry).not.toHaveBeenCalled();
  });

  it('asks Twitch to retry when the log could not be written', async () => {
    vi.mocked(recordSuspiciousEvent).mockResolvedValueOnce('failed');
    expect((await deliver('notification', suspiciousMessage)).status).toBe(500);
  });

  it('ignores a notification type this route does not handle', async () => {
    const res = await deliver('notification', {
      subscription: { type: 'channel.something_new' },
      event: { broadcaster_user_id: '100', message: { text: 'https://bad.test/link' } },
    });

    expect(res.status).toBe(204);
    expect(submitUrlToQueue).not.toHaveBeenCalled();
    expect(recordSuspiciousEvent).not.toHaveBeenCalled();
  });

  it('still submits links from ordinary chat', async () => {
    const res = await deliver('notification', {
      subscription: { type: 'channel.chat.message' },
      event: {
        broadcaster_user_id: '100',
        chatter_user_login: 'viewer',
        message_id: 'm2',
        message: { text: 'https://good.test/article' },
      },
    });

    expect(res.status).toBe(204);
    expect(submitUrlToQueue).toHaveBeenCalledTimes(1);
    expect(recordSuspiciousEvent).not.toHaveBeenCalled();
  });

  it('records when Twitch revokes a suspicious-user subscription', async () => {
    const res = await deliver('revocation', {
      subscription: {
        id: 'sub-1',
        type: 'channel.suspicious_user.update',
        status: 'authorization_revoked',
        condition: { broadcaster_user_id: '100', moderator_user_id: '100' },
      },
    });

    expect(res.status).toBe(204);
    expect(markSuspiciousLogRevoked).toHaveBeenCalledWith(expect.anything(), '100', 'authorization_revoked');
  });

  it('leaves the log status alone when a chat subscription is revoked', async () => {
    await deliver('revocation', {
      subscription: { id: 'sub-2', type: 'channel.chat.message', status: 'authorization_revoked' },
    });
    expect(markSuspiciousLogRevoked).not.toHaveBeenCalled();
  });
});
