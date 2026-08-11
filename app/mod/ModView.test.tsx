// Covers the two additions the mod-view review flagged as missing relative
// to the deck: an Undo toast on approve/reject (including the swipe path's
// only safety net against a mis-swipe), and keyboard triage (j/k to move the
// highlight, a/r to act on it). Unlike the deck's Undo (a delayed write that
// can be silently cancelled — see DeckView.test.tsx), this Undo is a second,
// immediate write back to 'pending': mod triage is shared and realtime-synced
// across every mod working the queue, so pretending an action hasn't
// happened yet would be actively wrong here. Real timers aren't needed as a
// result — there's no setTimeout in this path to race against.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { ModView } from './ModView';

function makeSub(id: string, title: string, status: string) {
  return {
    id,
    url: `https://example.com/${id}`,
    kind: 'article',
    status,
    title,
    thumbnail_url: null,
    publisher: 'Example',
    author: null,
    duration_seconds: null,
    published_at: null,
    description: null,
    summary: null,
    credibility_tag: null,
    topics: [],
    dmca_risk: null,
    content_warning: null,
    related_coverage: null,
    archive_url: null,
    mod_notes: null,
    prep_note: null,
    trigger_warning: null,
    segment_id: null,
    position: null,
    submitter_login: 'some_viewer',
    submitter_is_sub: false,
    submitter_is_mod: false,
    submitter_is_vip: false,
    created_at: '2026-07-08T00:00:00.000Z',
  };
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

/** Mutable in-memory backend, filtered by ?status= like the real API. */
function installMockBackend(initial: ReturnType<typeof makeSub>[]) {
  const state = new Map(initial.map((s) => [s.id, { ...s }]));
  const patches: { id: string; status: string }[] = [];

  const counts = () => {
    const c = { pending: 0, approved: 0, played: 0, rejected: 0, total: 0 };
    for (const item of state.values()) {
      c[item.status as 'pending' | 'approved' | 'played' | 'rejected']++;
      c.total++;
    }
    return c;
  };

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';

      if (url.startsWith('/api/queue') && method === 'GET') {
        const status = new URL(url, 'http://localhost').searchParams.get('status');
        const submissions = [...state.values()].filter((s) => !status || s.status === status);
        return jsonResponse({ submissions, nowPlaying: null, counts: counts() });
      }
      if (url === '/api/queue' && method === 'PATCH') {
        const body = JSON.parse(String(init?.body || '{}'));
        const item = state.get(body.id);
        if (item && typeof body.status === 'string') {
          item.status = body.status;
          patches.push({ id: body.id, status: body.status });
        }
        return jsonResponse({ submission: item ?? {} });
      }
      if (url.startsWith('/api/archive')) return jsonResponse({ ok: true });
      return jsonResponse({});
    }),
  );

  return { state, patches };
}

function renderModView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ModView
          channel="somechannel"
          displayName="Some Mod"
          streamDisplayName="Some Streamer"
          submitCommand={null}
          streamId="mock-stream"
          isMod
        />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  toast.dismiss();
  vi.unstubAllGlobals();
});

describe('ModView — undo on approve/reject', () => {
  it('approving removes the item and offers Undo, which writes it back to pending', async () => {
    const backend = installMockBackend([makeSub('a', 'Item A', 'pending')]);
    const user = userEvent.setup();
    renderModView();

    await screen.findByText('Item A');
    await user.click(screen.getByRole('button', { name: /^approve$/i }));

    await waitFor(() => expect(screen.queryByText('Item A')).not.toBeInTheDocument());
    expect(backend.patches).toContainEqual({ id: 'a', status: 'approved' });

    await user.click(await screen.findByRole('button', { name: /undo/i }));

    await waitFor(() => expect(backend.patches).toContainEqual({ id: 'a', status: 'pending' }));
    expect(await screen.findByText('Item A')).toBeInTheDocument();
  });

  it('rejecting (the swipe path\'s only safety net) also offers Undo', async () => {
    const backend = installMockBackend([makeSub('a', 'Item A', 'pending')]);
    const user = userEvent.setup();
    renderModView();

    await screen.findByText('Item A');
    await user.click(screen.getByRole('button', { name: /^reject$/i }));

    await waitFor(() => expect(backend.patches).toContainEqual({ id: 'a', status: 'rejected' }));
    expect(screen.queryByText('Item A')).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /undo/i }));

    await waitFor(() => expect(backend.patches).toContainEqual({ id: 'a', status: 'pending' }));
    expect(await screen.findByText('Item A')).toBeInTheDocument();
  });
});

describe('ModView — keyboard triage', () => {
  it('approves the first item on "a" with no navigation needed', async () => {
    const backend = installMockBackend([makeSub('a', 'Item A', 'pending')]);
    renderModView();

    await screen.findByText('Item A');
    await userEvent.keyboard('a');

    await waitFor(() => expect(backend.patches).toContainEqual({ id: 'a', status: 'approved' }));
  });

  it('moves the highlight with j/k before acting on the newly-highlighted item', async () => {
    const backend = installMockBackend([
      makeSub('a', 'Item A', 'pending'),
      makeSub('b', 'Item B', 'pending'),
    ]);
    renderModView();

    await screen.findByText('Item A');
    await screen.findByText('Item B');

    // Highlight starts on the first item; move it down one to Item B, then reject.
    await userEvent.keyboard('j');
    await userEvent.keyboard('r');

    await waitFor(() => expect(backend.patches).toContainEqual({ id: 'b', status: 'rejected' }));
    expect(backend.patches).not.toContainEqual({ id: 'a', status: 'rejected' });
  });

  it('does not fire shortcuts while typing in the note field', async () => {
    const backend = installMockBackend([makeSub('a', 'Item A', 'pending')]);
    const user = userEvent.setup();
    renderModView();

    await screen.findByText('Item A');
    await user.click(screen.getByRole('button', { name: /add note/i }));
    await user.type(screen.getByPlaceholderText(/skip to/i), 'a whole sentence about a video');

    expect(backend.patches).toHaveLength(0);
  });

  it('opens the shortcuts modal on "?"', async () => {
    installMockBackend([makeSub('a', 'Item A', 'pending')]);
    renderModView();

    await screen.findByText('Item A');
    await userEvent.keyboard('?');

    expect(await screen.findByText(/keyboard shortcuts/i)).toBeInTheDocument();
  });
});
