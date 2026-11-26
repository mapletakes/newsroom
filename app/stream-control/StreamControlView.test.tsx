import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ControlView } from '@/lib/stream-control-shared';

vi.mock('@/lib/use-realtime-channel', () => ({ useRealtimeChannel: vi.fn() }));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => null }));

import { StreamControlView, orderItems } from './StreamControlView';

const baseView = (): ControlView => ({
  snapshot: {
    activeSceneId: 'live',
    scenes: [
      {
        id: 'live',
        name: 'Live Scene',
        items: [
          { id: 'cam', name: 'Cam', type: 'item', visible: true, parentId: null },
          { id: 'grp', name: 'Overlays', type: 'folder', visible: true, parentId: null },
          { id: 'logo', name: 'Logo', type: 'item', visible: false, parentId: 'grp' },
        ],
      },
      { id: 'brb', name: 'BRB', items: [] },
    ],
  },
  relayOnline: true,
  streamlabsConnected: true,
  updatedAt: null,
  access: { canSwitchScenes: true, canToggleSources: true },
  recent: [],
});

let view: ControlView;
let posted: unknown[];
let postStatus: number;
let postBody: unknown;

beforeEach(() => {
  view = baseView();
  posted = [];
  postStatus = 201;
  postBody = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/stream-control/state') return new Response(JSON.stringify(view));
      posted.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(postBody), { status: postStatus });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StreamControlView streamId="s1" channel="streamer" isMod />
    </QueryClientProvider>,
  );
}

describe('orderItems', () => {
  it('puts folder contents under their folder, and orphans at the top', () => {
    const out = orderItems([
      { id: 'a', name: 'A', type: 'item', visible: true, parentId: null },
      { id: 'f', name: 'F', type: 'folder', visible: true, parentId: null },
      { id: 'b', name: 'B', type: 'item', visible: true, parentId: 'f' },
      { id: 'c', name: 'C', type: 'item', visible: true, parentId: 'missing' },
    ]);
    expect(out.map(({ item, depth }) => `${item.id}:${depth}`)).toEqual(['a:0', 'f:0', 'b:1', 'c:0']);
  });
});

describe('StreamControlView', () => {
  it('needs two taps to switch scenes', async () => {
    renderView();
    const brb = await screen.findByRole('button', { name: /BRB/ });
    fireEvent.click(brb);
    expect(posted).toEqual([]);
    expect(brb).toHaveTextContent('Tap again to switch');
    fireEvent.click(brb);
    await waitFor(() => expect(posted).toEqual([{ kind: 'switch_scene', args: { sceneId: 'brb' } }]));
  });

  it('marks the live scene and does not let it be switched to', async () => {
    renderView();
    const liveBtn = await screen.findByRole('button', { name: /Live Scene/ });
    expect(liveBtn).toBeDisabled();
    expect(liveBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows and hides sources in the live scene', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'Hide Cam' }));
    await waitFor(() =>
      expect(posted).toEqual([{ kind: 'set_visibility', args: { sceneId: 'live', itemId: 'cam', visible: false } }]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show Logo' }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]).toEqual({ kind: 'set_visibility', args: { sceneId: 'live', itemId: 'logo', visible: true } });
  });

  it('offers no toggles to someone who can only switch scenes', async () => {
    view.access = { canSwitchScenes: true, canToggleSources: false };
    renderView();
    await screen.findByText('Cam');
    expect(screen.queryByRole('button', { name: 'Hide Cam' })).toBeNull();
  });

  it('turns everything off while the relay is offline', async () => {
    view.relayOnline = false;
    view.streamlabsConnected = false;
    renderView();
    expect(await screen.findByText(/relay isn.t running/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /BRB/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Hide Cam' })).toBeDisabled();
  });

  it('marks a source with a request in flight', async () => {
    view.recent = [
      {
        id: 'r1',
        kind: 'set_visibility',
        args: { sceneId: 'live', itemId: 'cam', visible: false },
        actorLogin: 'othermod',
        targetName: 'Cam',
        status: 'running',
        error: null,
        createdAt: '2026-11-26T20:00:00Z',
      },
    ];
    renderView();
    expect(await screen.findByRole('button', { name: 'Hide Cam' })).toBeDisabled();
    expect(screen.getByText('working…')).toBeInTheDocument();
    const recent = screen.getByText('othermod').closest('li')!;
    expect(within(recent).getByText(/hide Cam/)).toBeInTheDocument();
  });

  it('explains a refused request in plain words', async () => {
    postStatus = 409;
    postBody = { error: 'not-live-scene' };
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'Hide Cam' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The scene changed before that went through');
  });
});
