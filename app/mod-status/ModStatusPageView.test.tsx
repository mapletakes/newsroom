// Covers the header's channel switcher: falls back to plain text with
// nothing to switch to (same reasoning as SendToDeckMenu), otherwise offers
// every other channel this account moderates and posts the right switch
// request when one is picked.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModStatusPageView } from './ModStatusPageView';

type Posted = { url: string; body: unknown };

function mockApi() {
  const posts: Posted[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/api/mod-status')) {
        return Promise.resolve(new Response(JSON.stringify({ mods: [] }), { status: 200 }));
      }
      if (url === '/api/auth/switch') {
        posts.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }),
  );
  return posts;
}

function renderView(channels: { id: string; login: string; name: string }[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ModStatusPageView streamId="s1" displayName="Alice" channel="alicestream" isMod channels={channels} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ModStatusPageView — channel switcher', () => {
  it('renders plain text, not a dropdown, when there is nothing else to switch to', () => {
    mockApi();
    renderView([{ id: 's1', login: 'alicestream', name: 'Alice' }]);

    expect(screen.getByText('#alicestream')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /alicestream/i })).not.toBeInTheDocument();
  });

  it('offers other moderated channels and switches on selection', async () => {
    const posts = mockApi();
    const user = userEvent.setup();
    renderView([
      { id: 's1', login: 'alicestream', name: 'Alice' },
      { id: 's2', login: 'bobstream', name: 'Bob' },
    ]);

    await user.click(screen.getByRole('button', { name: /alicestream/i }));

    expect(await screen.findByText('#alicestream (current)')).toBeInTheDocument();
    await user.click(screen.getByText('#bobstream'));

    await waitFor(() => {
      expect(posts).toContainEqual({
        url: '/api/auth/switch',
        body: { streamId: 's2', role: 'mod' },
      });
    });
  });
});
