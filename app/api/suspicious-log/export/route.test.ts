import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  access: {} as Record<string, unknown>,
  pages: [] as { data: unknown[] | null; error?: { message: string } | null }[],
  calls: [] as [string, unknown[]][],
}));

vi.mock('@/lib/suspicious-log-access', () => ({
  getSuspiciousLogAccess: vi.fn(async () => state.access),
}));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      state.calls.push(['from', [table]]);
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'neq', 'ilike', 'contains', 'gte', 'lt', 'order']) {
        chain[method] = (...args: unknown[]) => {
          state.calls.push([method, args]);
          return chain;
        };
      }
      chain.range = async (...args: unknown[]) => {
        state.calls.push(['range', args]);
        return state.pages.shift() ?? { data: [], error: null };
      };
      return chain;
    },
  }),
}));

import { GET } from './route';

const access = { ok: true, role: 'mod', userId: '200', userLogin: 'themod', streamId: 's1' };
const get = (query = '') => GET(new NextRequest(`http://localhost/api/suspicious-log/export${query}`));
const called = (method: string) => state.calls.filter(([name]) => name === method).map(([, args]) => args);

const row = (text: string) => ({
  sent_at: '2026-11-18T19:09:24.448Z',
  chatter_login: 'viewer',
  chatter_name: 'Viewer',
  message_text: text,
  low_trust_status: 'restricted',
  detection_types: ['manually_added'],
  ban_evasion_evaluation: 'unknown',
});

beforeEach(() => {
  state.access = access;
  state.pages = [];
  state.calls = [];
});

afterEach(() => vi.clearAllMocks());

describe('GET /api/suspicious-log/export', () => {
  it.each([
    ['unauthenticated', 401],
    ['forbidden', 403],
    ['reconnect', 403],
    ['twitch', 503],
  ])('refuses %s without reading the log', async (reason, status) => {
    state.access = { ok: false, reason };
    expect((await get()).status).toBe(status);
    expect(state.calls).toEqual([]);
  });

  it('downloads a CSV with UTC times, as an attachment that is never cached', async () => {
    state.pages = [{ data: [row('hello')] }];

    const res = await get();

    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="suspicious-log-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe(
      '﻿time_utc,username,display_name,status,detection,ban_evasion,message\r\n' +
        '2026-11-18 19:09:24,viewer,Viewer,restricted,manually_added,unknown,hello\r\n',
    );
  });

  it('does not let chat text run as a spreadsheet formula', async () => {
    state.pages = [{ data: [row('=HYPERLINK("http://bad.test")')] }];
    const text = await (await get()).text();
    expect(text).toContain(`"'=HYPERLINK(""http://bad.test"")"`);
  });

  it('can download plain text instead', async () => {
    state.pages = [{ data: [row('hello')] }];

    const res = await get('?format=txt');

    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('2026-11-18 19:09:24 UTC Viewer: hello\n');
  });

  it('only reads this channel and applies the same filters as the page', async () => {
    await get('?chatterId=300&status=restricted&order=oldest');
    expect(called('eq')).toContainEqual(['stream_id', 's1']);
    expect(called('eq')).toContainEqual(['chatter_user_id', '300']);
    expect(called('eq')).toContainEqual(['low_trust_status', 'restricted']);
    expect(called('order')).toContainEqual(['sent_at', { ascending: true }]);
  });

  it('reads every page of results, not just the first', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => row(`m${i}`));
    state.pages = [{ data: full }, { data: [row('last')] }];

    const text = await (await get('?format=txt')).text();

    expect(called('range')).toEqual([[0, 999], [1000, 1999]]);
    expect(text.trim().split('\n')).toHaveLength(1001);
  });

  it('flags an export cut off at the row limit', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => row(`m${i}`));
    state.pages = Array.from({ length: 10 }, () => ({ data: full }));
    expect((await get()).headers.get('x-export-truncated')).toBe('true');
  });

  it('reports a failed read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.pages = [{ data: null, error: { message: 'down' } }];
    expect((await get()).status).toBe(500);
  });
});
