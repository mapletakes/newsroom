// Integration coverage for the deck's trickiest, most bug-prone path:
// markPlayed/removeFromQueue write to the server immediately (not delayed
// behind a cancellable timer — see their doc comments in DeckView.tsx for
// why: the deck is a shared, realtime-synced surface, and a delayed write
// means anyone reading during that window — a page reload, the mod view's
// on-air bar, the overlay, a second curator — sees the item as if it were
// never removed). These tests prove: the item never flashes back in even if
// a refetch lands while the write's own (short) network round-trip is still
// in flight, the write itself needs no artificial delay to persist, and
// Undo is a real compensating write, not a free cancellation, so it must
// actually restore the item once that write resolves too.
//
// This exact class of regression has broken before (see git history on
// suppressRefreshUntil/beginPendingWrite/settlePendingWrite) — this is the
// one place in the app that most needs a standing test rather than a
// rebuilt-from-scratch mock harness every time it's touched.

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
 * server-side truth, so a refetch landing before a PATCH resolves would
 * legitimately still show the item, which is the whole point of holdNextPatch.
 */
function installMockBackend() {
  const state = { status: 'approved' as string, patchCalls: 0 };
  let patchGate: Promise<void> | null = null;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
        if (patchGate) await patchGate;
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

  return {
    state,
    // Delays the NEXT PATCH's resolution until the returned function is
    // called — lets a test force a refetch attempt while a write is
    // genuinely still in flight, the real-world race this file exists to
    // guard against (a reload, a realtime broadcast, a background poll
    // landing mid-write), without depending on a fixed artificial delay.
    holdNextPatch(): () => void {
      let release!: () => void;
      patchGate = new Promise<void>((r) => { release = r; });
      return () => {
        release();
        patchGate = null;
      };
    },
  };
}

function renderDeck() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <DeckView displayName="Some Streamer" streamId="mock-stream" isAdmin={false} curateOnly={false} />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...view, client };
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

  it('does not flash the item back in if a refetch lands while the write is still in flight, and undo sends a real compensating write', async () => {
    const backend = installMockBackend();
    const user = userEvent.setup();
    const { client } = renderDeck();

    await screen.findByText(SUB.title);
    // Nothing is auto-selected on load anymore (see DeckView's play-order
    // effect) — the streamer has to click an item before it's "on air", so
    // the test does that click too, same as a real session would.
    await user.click(screen.getByText(SUB.title));
    const baselineCount = screen.getAllByText(SUB.title).length;

    // Hold the PATCH open so there's a real window to force a refetch into —
    // this is the race the fix closes: pendingWrites must suppress a GET
    // landing while our own write is genuinely still in flight, the same way
    // it always did, just over a real (short) network gap now instead of an
    // artificial 5s one.
    const releasePatch = backend.holdNextPatch();

    await user.click(screen.getByRole('button', { name: /played — next/i }));

    // Optimistic removal: gone immediately from both the active card and the sidebar.
    expect(screen.queryByText(SUB.title)).not.toBeInTheDocument();

    // Force exactly what a realtime broadcast or a background poll tick
    // does — invalidateQueries — while the PATCH is still held open. Pre-fix
    // (and pre-guard), this would bring the item back.
    await client.invalidateQueries();
    expect(screen.queryByText(SUB.title)).not.toBeInTheDocument();

    // Let the write actually complete — no artificial delay to wait out.
    releasePatch();
    await waitFor(() => expect(backend.state.patchCalls).toBe(1));
    expect(screen.queryByText(SUB.title)).not.toBeInTheDocument();

    // Undo now sends a REAL compensating write (status: 'approved'), not a
    // cancelled timer — confirm it actually fires and the item comes back
    // exactly once (no duplicate).
    const undoButton = await screen.findByRole('button', { name: /undo/i });
    await user.click(undoButton);
    await waitFor(() => expect(backend.state.patchCalls).toBe(2));
    expect(backend.state.status).toBe('approved');
    const restoredCount = screen.getAllByText(SUB.title).length;
    expect(restoredCount).toBe(1);
    expect(restoredCount).toBeLessThan(baselineCount);
  });

  it('marking played writes to the server immediately — no delay to wait out before it persists', async () => {
    const backend = installMockBackend();
    const user = userEvent.setup();
    renderDeck();

    await screen.findByText(SUB.title);
    // Same as above — select it first; nothing is auto-selected on load.
    await user.click(screen.getByText(SUB.title));
    await user.click(screen.getByRole('button', { name: /played — next/i }));

    // No 5s wait: the write fires as part of the click, not behind a timer.
    await waitFor(() => expect(backend.state.patchCalls).toBe(1));
    expect(backend.state.status).toBe('played');
    expect(screen.queryByText(SUB.title)).not.toBeInTheDocument();
  });
});
