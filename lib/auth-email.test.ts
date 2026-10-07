import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const upsertSingle = vi.fn();
const existingMaybeSingle = vi.fn();
const upsertSpy = vi.fn();

vi.mock('./supabase', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: existingMaybeSingle }) }),
      upsert: (row: unknown, opts: unknown) => {
        upsertSpy(row, opts);
        return { select: () => ({ single: upsertSingle }) };
      },
    }),
  }),
}));

import { normalizeEmail, hashEmail, findOrCreateEmailStream } from './auth-email';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Em@Example.COM ')).toBe('em@example.com');
  });

  it.each(['', 'nope', 'a@b', 'a b@c.com', '@c.com', 42, null, undefined])('rejects %j', (v) => {
    expect(normalizeEmail(v)).toBeNull();
  });

  it('rejects absurdly long addresses', () => {
    expect(normalizeEmail(`${'a'.repeat(250)}@example.com`)).toBeNull();
  });
});

describe('hashEmail', () => {
  it('is stable and does not contain the address', () => {
    expect(hashEmail('a@b.co')).toBe(hashEmail('a@b.co'));
    expect(hashEmail('a@b.co')).not.toContain('a@b.co');
  });
});

describe('findOrCreateEmailStream', () => {
  const OLD_ENV = process.env.REQUIRE_APPROVAL;
  beforeEach(() => {
    existingMaybeSingle.mockReset();
    upsertSingle.mockReset();
    upsertSpy.mockReset();
    delete process.env.REQUIRE_APPROVAL;
  });
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.REQUIRE_APPROVAL;
    else process.env.REQUIRE_APPROVAL = OLD_ENV;
  });

  it('returns the existing stream without creating one', async () => {
    existingMaybeSingle.mockResolvedValue({ data: { id: 's1', display_name: 'em' } });
    const r = await findOrCreateEmailStream({ id: 'u1', email: 'em@example.com' });
    expect(r).toEqual({ stream: { id: 's1', display_name: 'em' }, isNew: false });
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('creates a Twitch-less stream named from the email on first sign-in', async () => {
    existingMaybeSingle.mockResolvedValue({ data: null });
    upsertSingle.mockResolvedValue({ data: { id: 's2', display_name: 'em' }, error: null });
    const r = await findOrCreateEmailStream({ id: 'u1', email: 'em@example.com' });
    expect(r.isNew).toBe(true);
    const [row, opts] = upsertSpy.mock.calls[0];
    expect(row).toEqual({ auth_user_id: 'u1', email: 'em@example.com', display_name: 'em' });
    expect(opts).toEqual({ onConflict: 'auth_user_id' });
  });

  it('is not gated by REQUIRE_APPROVAL: email signup is open to anyone', async () => {
    process.env.REQUIRE_APPROVAL = 'true';
    existingMaybeSingle.mockResolvedValue({ data: null });
    upsertSingle.mockResolvedValue({ data: { id: 's3', display_name: 'em' }, error: null });
    await findOrCreateEmailStream({ id: 'u1', email: 'em@example.com' });
    expect(upsertSpy.mock.calls[0][0]).not.toHaveProperty('approved');
  });
});
