// The list's own filtering is covered in lib/archive-list.test.ts; this pins
// down the page wiring: it loads, searches, and its row actions call the
// archive API the way the deck's button does.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArchivesView } from './ArchivesView';
import type { ArchiveListItem } from '@/lib/archive-list';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const ITEMS: ArchiveListItem[] = [
  {
    id: 'sub-1',
    title: 'Budget vote delayed',
    url: 'https://www.cbc.ca/news/budget',
    publisher: 'CBC',
    kind: 'article',
    status: 'played',
    created_at: '2026-10-01T00:00:00Z',
    played_at: '2026-10-01T01:00:00Z',
    archive_url: 'https://thebroadside.net/a/abcdefghij',
    source: 'broadside',
    archived_at: '2026-10-02T00:00:00Z',
    bytes: 2048,
  },
  {
    id: 'sub-2',
    title: 'Paywalled story',
    url: 'https://www.nytimes.com/story',
    publisher: 'NYT',
    kind: 'article',
    status: 'approved',
    created_at: '2026-10-03T00:00:00Z',
    played_at: null,
    archive_url: 'https://archive.today/newest/https://www.nytimes.com/story',
    source: 'archive.today',
    archived_at: null,
    bytes: null,
  },
];

function mockApi() {
  const calls: { method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method || 'GET';
      calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (method === 'GET') return Promise.resolve(new Response(JSON.stringify({ items: ITEMS, truncated: false })));
      return Promise.resolve(new Response(JSON.stringify({ ok: true, archive_url: 'https://thebroadside.net/a/newsnapshot' })));
    }),
  );
  return calls;
}

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ArchivesView displayName="Mike" isAdmin={false} chatEnabled isMod={false} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ArchivesView', () => {
  it('lists archives with original and snapshot links', async () => {
    mockApi();
    renderView();
    const title = await screen.findByRole('link', { name: 'Budget vote delayed' });
    expect(title).toHaveAttribute('href', 'https://www.cbc.ca/news/budget');
    const snaps = screen.getAllByRole('link', { name: /view snapshot/i }).map((a) => a.getAttribute('href'));
    expect(snaps).toEqual([ITEMS[1].archive_url, ITEMS[0].archive_url]); // newest first
    expect(screen.getByText('archive.today fallback', { selector: 'span' })).toBeInTheDocument();
  });

  it('narrows the list as you search', async () => {
    mockApi();
    const user = userEvent.setup();
    renderView();
    await screen.findByText('Budget vote delayed');
    await user.type(screen.getByRole('searchbox', { name: /search archives/i }), 'nytimes');
    expect(screen.queryByText('Budget vote delayed')).toBeNull();
    expect(screen.getByText('Paywalled story')).toBeInTheDocument();
    expect(screen.getByText(/1 of 2/)).toBeInTheDocument();
  });

  it('offers re-capture only on archive.today fallbacks, and sends recapture', async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderView();
    await screen.findByText('Paywalled story');
    const buttons = screen.getAllByRole('button', { name: /re-capture/i });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]);
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'POST', body: { id: 'sub-2', recapture: true } }),
    );
  });

  it('deletes after confirmation', async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    renderView();
    await screen.findByText('Budget vote delayed');
    await user.type(screen.getByRole('searchbox', { name: /search archives/i }), 'budget');
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    await screen.findByText('Delete this snapshot?');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(screen.getAllByRole('button', { name: /^delete$/i }).at(-1)!);
    await waitFor(() => expect(calls).toContainEqual({ method: 'DELETE', body: { id: 'sub-1' } }));
  });
});
