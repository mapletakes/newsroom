import { describe, it, expect, vi, beforeEach } from 'vitest';

const maybeSingle = vi.fn();
vi.mock('./supabase', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

import { streamHasChat, requireChat } from './chat';

describe('streamHasChat / requireChat', () => {
  beforeEach(() => maybeSingle.mockReset());

  it('is true when the stream has a Twitch user id', async () => {
    maybeSingle.mockResolvedValue({ data: { twitch_user_id: '123' } });
    expect(await streamHasChat('s')).toBe(true);
    expect(await requireChat('s')).toBeNull();
  });

  it('is false, and requireChat returns a 409, when there is no Twitch user id', async () => {
    maybeSingle.mockResolvedValue({ data: { twitch_user_id: null } });
    expect(await streamHasChat('s')).toBe(false);
    const res = await requireChat('s');
    expect(res?.status).toBe(409);
    expect((await res!.json()).error).toBe('no-twitch');
  });

  it('is false for a stream that does not exist', async () => {
    maybeSingle.mockResolvedValue({ data: null });
    expect(await streamHasChat('missing')).toBe(false);
  });
});
