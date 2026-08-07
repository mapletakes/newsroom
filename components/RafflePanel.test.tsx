// The three states a raffle moves through (nothing running, open and
// collecting entries, closed with winners to announce) are what this exists
// to pin down — the panel itself never draws winners or matches chat
// commands, that's all server-side (see lib/raffle.ts).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RafflePanel } from './RafflePanel';

type Posted = { url: string; body: unknown };

function mockApi(raffle: Record<string, unknown> | null) {
  const posts: Posted[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (init?.method === 'POST') {
        posts.push({ url, body: init.body ? JSON.parse(init.body as string) : undefined });
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ raffle }), { status: 200 }));
    }),
  );
  return posts;
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RafflePanel streamId="s1" enabled variant="tab" />
    </QueryClientProvider>,
  );
}

async function openPanel() {
  const user = userEvent.setup();
  renderPanel();
  await user.click(screen.getByRole('button', { name: /open raffle/i }));
  return user;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RafflePanel — idle (no raffle running)', () => {
  it('shows the start form and posts what was entered', async () => {
    const posts = mockApi(null);
    const user = await openPanel();

    const commandInput = await screen.findByLabelText('Entry command');
    await user.clear(commandInput);
    await user.type(commandInput, '!giveaway');
    await user.clear(screen.getByLabelText('Duration in minutes'));
    await user.type(screen.getByLabelText('Duration in minutes'), '3');
    await user.clear(screen.getByLabelText('Number of winners'));
    await user.type(screen.getByLabelText('Number of winners'), '2');

    await user.click(screen.getByRole('button', { name: /start raffle/i }));

    await waitFor(() => {
      expect(posts).toContainEqual({
        url: '/api/raffle',
        body: { command: '!giveaway', durationSeconds: 180, winnerCount: 2 },
      });
    });
  });

  it('surfaces a failed start rather than silently doing nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'a raffle is already running' }), { status: 409 }),
          );
        }
        return Promise.resolve(new Response(JSON.stringify({ raffle: null }), { status: 200 }));
      }),
    );
    const user = await openPanel();
    await screen.findByLabelText('Entry command');

    await user.click(screen.getByRole('button', { name: /start raffle/i }));

    expect(await screen.findByText(/already running/i)).toBeInTheDocument();
  });
});

describe('RafflePanel — open (collecting entries)', () => {
  const OPEN = {
    id: 'r1',
    command: '!enter',
    winnerCount: 1,
    status: 'open',
    openedAt: new Date().toISOString(),
    closesAt: new Date(Date.now() + 60_000).toISOString(),
    closedAt: null,
    winnersAnnouncedAt: null,
    startedByLogin: 'alice',
    entryCount: 7,
    winners: [],
  };

  it('shows the live entry count and command, not the start form', async () => {
    mockApi(OPEN);
    await openPanel();

    expect(await screen.findByText('!enter')).toBeInTheDocument();
    expect(screen.getByText(/7 entries/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Entry command')).not.toBeInTheDocument();
  });

  it('ends the raffle early on request', async () => {
    const posts = mockApi(OPEN);
    const user = await openPanel();

    await user.click(await screen.findByRole('button', { name: /end raffle now/i }));

    await waitFor(() => {
      expect(posts).toContainEqual({ url: '/api/raffle/end', body: undefined });
    });
  });
});

describe('RafflePanel — closed (winners drawn)', () => {
  const CLOSED = {
    id: 'r1',
    command: '!enter',
    winnerCount: 2,
    status: 'closed',
    openedAt: new Date(Date.now() - 120_000).toISOString(),
    closesAt: new Date(Date.now() - 1000).toISOString(),
    closedAt: new Date().toISOString(),
    winnersAnnouncedAt: null,
    startedByLogin: 'alice',
    entryCount: 12,
    winners: ['bob', 'carol'],
  };

  it('lists the winners and offers to announce them', async () => {
    mockApi(CLOSED);
    await openPanel();

    expect(await screen.findByText('bob')).toBeInTheDocument();
    expect(screen.getByText('carol')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /announce to chat/i })).toBeInTheDocument();
  });

  it('posts the announcement on click', async () => {
    const posts = mockApi(CLOSED);
    const user = await openPanel();

    await user.click(await screen.findByRole('button', { name: /announce to chat/i }));

    await waitFor(() => {
      expect(posts).toContainEqual({ url: '/api/raffle/announce', body: undefined });
    });
  });

  it('shows "Announced" instead of the button once winners_announced_at is set', async () => {
    mockApi({ ...CLOSED, winnersAnnouncedAt: new Date().toISOString() });
    await openPanel();

    expect(await screen.findByText(/announced to chat/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /announce to chat/i })).not.toBeInTheDocument();
  });

  it('reveals the start form again for a new raffle without losing the old result first', async () => {
    mockApi(CLOSED);
    const user = await openPanel();

    await screen.findByText('bob');
    await user.click(screen.getByRole('button', { name: /start new raffle/i }));

    expect(await screen.findByLabelText('Entry command')).toBeInTheDocument();
  });

  it('says plainly that nobody entered rather than an empty winner list', async () => {
    mockApi({ ...CLOSED, entryCount: 0, winners: [] });
    await openPanel();

    expect(await screen.findByText(/nobody entered/i)).toBeInTheDocument();
  });

  it('rerolls a specific winner without reopening entries', async () => {
    const posts = mockApi(CLOSED);
    const user = await openPanel();

    await screen.findByText('bob');
    const rerollButtons = screen.getAllByRole('button', { name: /reroll/i });
    await user.click(rerollButtons[0]);

    await waitFor(() => {
      expect(posts).toContainEqual({ url: '/api/raffle/reroll', body: { winnerLogin: 'bob' } });
    });
  });

  it('disables reroll once no entrant remains who could replace a winner', async () => {
    mockApi({ ...CLOSED, entryCount: 2 }); // 2 entrants, both already winners
    await openPanel();

    const rerollButtons = await screen.findAllByRole('button', { name: /reroll/i });
    for (const btn of rerollButtons) expect(btn).toBeDisabled();
  });

  it('surfaces a failed reroll rather than silently doing nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'no eligible entrants left to draw' }), { status: 409 }),
          );
        }
        return Promise.resolve(new Response(JSON.stringify({ raffle: CLOSED }), { status: 200 }));
      }),
    );
    const user = await openPanel();

    await screen.findByText('bob');
    await user.click(screen.getAllByRole('button', { name: /reroll/i })[0]);

    expect(await screen.findByText(/no eligible entrants/i)).toBeInTheDocument();
  });
});
