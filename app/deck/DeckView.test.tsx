// Integration coverage for the deck's trickiest, most bug-prone path: an
// item removed via markPlayed/removeFromQueue must never flash back in
// while its write is delayed behind the 5s Undo toast, and Undo must never
// leave a duplicate behind. This exact regression has broken twice — see
// git history on suppressRefreshUntil/beginPendingWrite/settlePendingWrite —
// so it's the one place in the app that most needs a standing test rather
// than a rebuilt-from-scratch mock harness every time it's touched.
//
// Written against the pre-React-Query DeckView as a baseline; it should
// keep passing unmodified once DeckView migrates to useQuery/useMutation,
// which is the whole point of writing it now rather than after.
//
// Real timers, deliberately: the delayed write is a genuine setTimeout, and
// every test either cancels it (via Undo) or lets it fully resolve before
// returning — a test that finishes early while its own timer is still
// pending leaves it to fire during a LATER test against whatever fetch mock
// happens to be installed then, which is exactly the kind of cross-test
// flake this file exists to prevent, not cause.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { DeckView } from './DeckView';

const SUB = {
  id: 'sub-1',
  url: 'https://www.reuters.com/world/us/senate-passes-budget-bill',
  kind: 'article',
  status: 'approved',
  title: 'Senate passes surprise budget bill in 3am vote',
  thumbnail_url: null,
  publisher: 'Reuters',
  author: null,
  duration_seconds: null,
  published_at: null,
  description: 'A short description.',
  summary: null,
  credibility_tag: 'mainstream',
  topics: [],
  dmca_risk: 'low',
  content_warning: null,
  related_coverage: null,
  archive_url: null,
  mod_notes: null,
  prep_note: null,
  trigger_warning: null,
  segment_id: null,
  position: 1,
  submitter_login: 'some_viewer',
  submitter_is_sub: true,
  submitter_is_mod: false,
  submitter_is_vip: false,
  created_at: '2026-07-08T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

/**
 * A minimal fake backend: the item is 'approved' until a PATCH sets it to
 * something else, exactly like the real API — GET always reflects current
 * server-side truth, so a refetch landing before the real write happens
 * would legitimately still show the item, which is the whole point.
 */
function installMockBackend() {
  const state = { status: 'approved' as string, patchCalls: 0 };

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';

      if (url.startsWith('/api/queue') && method === 'GET') {
        const stillApproved = state.status === 'approved';
        return jsonResponse({
          submissions: stillApproved ? [SUB] : [],
          nowPlaying: null,
          counts: { pending: 0, approved: stillApproved ? 1 : 0, played: 0, rejected: 0, total: 1 },
        });
      }
      if (url === '/api/queue' && method === 'PATCH') {
        state.patchCalls++;
        const body = JSON.parse(String(init?.body || '{}'));
        state.status = body.status;
        return jsonResponse({ submission: {} });
      }
      if (url.startsWith('/api/segments')) return jsonResponse({ segments: [], ungroupedPosition: 0 });
      if (url.startsWith('/api/twitch/eventsub/status')) return jsonResponse({ connected: true });
      if (url.startsWith('/api/quick-links')) return jsonResponse({ links: [] });
      if (url.startsWith('/api/deck/now-playing')) return jsonResponse({ ok: true });
      return jsonResponse({});
    }),
  );

  return state;
}

function renderDeck() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <DeckView displayName="Some Streamer" streamId="mock-stream" isAdmin={false} curateOnly={false} />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

// Same trick used to verify this bug live: a realtime broadcast or a
// visible-tab poll both funnel through the same visibilitychange-driven
// catch-up refetch, so firing this event mid-window reproduces "a refresh
// lands while the write is still pending" without needing to wait out the
// real 5s window to test it.
function forceVisibilityRefetch() {
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('DeckView — mark played / undo', () => {
  afterEach(() => {
    // RTL's automatic afterEach(cleanup) only registers when Vitest's
    // globals are enabled (this file imports everything explicitly instead),
    // and Sonner's toast store is a module-level singleton that outlives
    // any one render — without both, state from one test leaks into the next.
    cleanup();
    toast.dismiss();
    vi.unstubAllGlobals();
  });

  it('does not flash the item back in if a refetch lands during the undo window, and undo leaves no duplicate', async () => {
    const backend = installMockBackend();
    const user = userEvent.setup();
    renderDeck();

    await screen.findByText(SUB.title);
    // Nothing is auto-selected on load anymore (see DeckView's play-order
    // effect) — the streamer has to click an item before it's "on air", so
    // the test does that click too, same as a real session would.
    await user.click(screen.getByText(SUB.title));
    const baselineCount = screen.getAllByText(SUB.title).length;

    await user.click(screen.getByRole('button', { name: /played — next/i }));

    // Optimistic removal: gone immediately from both the active card and the sidebar.
    expect(screen.queryByText(SUB.title)).not.toBeInTheDocument();

    // The exact race this test exists for: force a refetch well before the
    // 5s delayed write fires, while the server still reports the item as
    // approved. Pre-fix, this brought the item back.
    forceVisibilityRefetch();
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText(SUB.title)).not.toBeInTheDocument();

    // Undo restores the item to the queue — but, correctly, does NOT put it
    // back on air: markPlayed already advanced activeId away (to whatever
    // was next, or null here since this was the only item), and undo only
    // reverses the optimistic removal from the queue list, not that
    // navigation. Re-activating it automatically would be exactly the bug
    // the play-order effect fix (auto-select) addresses — the streamer
    // clicks it again if they want it live. So the restored count is 1
    // (queue list only), not baselineCount (2, which included the active
    // card) — what this test actually guards is that it's exactly 1, not 2
    // or more, i.e. undo doesn't leave a duplicate queue entry behind.
    const undoButton = await screen.findByRole('button', { name: /undo/i });
    await user.click(undoButton);
    const restoredCount = screen.getAllByText(SUB.title).length;
    expect(restoredCount).toBe(1);
    expect(restoredCount).toBeLessThan(baselineCount);

    // Wait out the window the cancelled write would have fired in, inside
    // this same test, so nothing is left pending for a later test to catch.
    await new Promise((r) => setTimeout(r, 5200));
    expect(backend.patchCalls).toBe(0);
    expect(screen.getAllByText(SUB.title)).toHaveLength(restoredCount);
  }, 10000);

  it('marking played persists after the undo window if not undone', async () => {
    const backend = installMockBackend();
    const user = userEvent.setup();
    renderDeck();

    await screen.findByText(SUB.title);
    // Same as above — select it first; nothing is auto-selected on load.
    await user.click(screen.getByText(SUB.title));
    await user.click(screen.getByRole('button', { name: /played — next/i }));

    await waitFor(() => expect(backend.patchCalls).toBe(1), { timeout: 6000 });
    expect(screen.queryByText(SUB.title)).not.toBeInTheDocument();
  }, 10000);
});
