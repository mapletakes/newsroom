// Covers the two things this file adds: a per-segment "Send to deck" action
// that turns a shelf segment into its own fresh deck segment (not a flat
// dump into a chosen target), and the ungrouped block's flat send (which
// still lets you pick a target, since there's no segment identity to
// preserve there). Everything else on ShelfDetailView (drag-and-drop,
// rename, share links) is exercised in the browser rather than here.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ShelfDetailView } from './ShelfDetailView';

const ITEM_A = {
  id: 'item-a',
  url: 'https://example.com/a',
  kind: 'article',
  title: 'Cold open piece',
  thumbnail_url: null,
  publisher: 'Example',
  duration_seconds: null,
  published_at: null,
  description: null,
  summary: null,
  credibility_tag: null,
  topics: [],
  dmca_risk: null,
  content_warning: null,
  note: null,
  added_by: 'alice',
  segment_id: 'seg-1',
  position: 1,
  created_at: '2026-08-01T00:00:00.000Z',
};
const ITEM_B = { ...ITEM_A, id: 'item-b', title: 'Second cold open piece', position: 2 };
const ITEM_UNGROUPED = { ...ITEM_A, id: 'item-c', title: 'Loose item', segment_id: null, position: 1 };

const SHELF = {
  list: { id: 'shelf-1', name: 'Tonight', share_token: null, ungrouped_position: 0 },
  items: [ITEM_A, ITEM_B, ITEM_UNGROUPED],
  segments: [{ id: 'seg-1', name: 'Cold open', position: 1 }],
};

type Posted = { url: string; body: unknown };

function mockApi() {
  const posts: Posted[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method || 'GET';
      if (url === '/api/lists/shelf-1' && method === 'GET') {
        return Promise.resolve(new Response(JSON.stringify(SHELF), { status: 200 }));
      }
      if (url === '/api/segments') {
        return Promise.resolve(
          new Response(JSON.stringify({ segments: [{ id: 'deck-seg-1', name: 'Main block' }] }), { status: 200 }),
        );
      }
      if (method === 'POST') {
        posts.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
        return Promise.resolve(new Response(JSON.stringify({ added: 2, skipped: 0, segmentsCreated: 1 }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }),
  );
  return posts;
}

function renderShelf() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ShelfDetailView shelfId="shelf-1" streamId="s1" displayName="Alice" canCurate />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ShelfDetailView — per-segment send to deck', () => {
  it('sends the segment as its own fresh deck segment, with no target to pick', async () => {
    const posts = mockApi();
    const user = userEvent.setup();
    renderShelf();

    // The segment title renders as an editable <input> (canCurate is on),
    // not plain text, so it needs findByDisplayValue rather than findByText.
    const segmentHeader = (await screen.findByDisplayValue('Cold open')).closest('div')!;
    const sendButton = within(segmentHeader).getByRole('button', { name: /send segment to deck/i });

    // A plain click, not a dropdown — there's no existing deck segment to
    // choose since sending a segment always creates a fresh one.
    await user.click(sendButton);

    await waitFor(() => {
      expect(posts).toContainEqual({
        url: '/api/lists/shelf-1/send-to-deck',
        body: { mode: 'segment', listSegmentId: 'seg-1' },
      });
    });
  });

  it('does not offer a target-picking menu on a named segment', async () => {
    mockApi();
    renderShelf();

    const segmentHeader = (await screen.findByDisplayValue('Cold open')).closest('div')!;
    expect(within(segmentHeader).queryByRole('button', { name: /^send to deck/i })).not.toBeInTheDocument();
  });
});

describe('ShelfDetailView — ungrouped send to deck', () => {
  it('still offers a target to pick, since there is no segment identity to preserve', async () => {
    const posts = mockApi();
    const user = userEvent.setup();
    renderShelf();

    const ungroupedHeader = (await screen.findByText('Ungrouped')).closest('div')!;
    const sendButton = within(ungroupedHeader).getByRole('button', { name: /send to deck/i });
    await user.click(sendButton);

    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Ungrouped')).toBeInTheDocument();
    expect(within(menu).getByText('Main block')).toBeInTheDocument();

    await user.click(within(menu).getByText('Main block'));

    await waitFor(() => {
      expect(posts).toContainEqual({
        url: '/api/lists/shelf-1/send-to-deck',
        body: { itemIds: ['item-c'], segmentId: 'deck-seg-1' },
      });
    });
  });
});
