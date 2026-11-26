import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StreamControlSettings } from './StreamControlSettings';

let posted: unknown[];
let postOk: boolean;

beforeEach(() => {
  posted = [];
  postOk = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/curators') {
        posted.push(JSON.parse(String(init?.body)));
        return new Response('{}', { status: postOk ? 200 : 500 });
      }
      return new Response(
        JSON.stringify({
          commands: [
            {
              id: 'c1',
              kind: 'set_visibility',
              args: { sceneId: 'live', itemId: 'cam', visible: false },
              actorLogin: 'modA',
              targetName: 'Cam',
              status: 'done',
              error: null,
              createdAt: '2026-11-26T20:00:00Z',
            },
          ],
        }),
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StreamControlSettings
        initial={[{ twitchUserId: '200', login: 'moda', canSwitchScenes: false, canToggleSources: true }]}
      />
    </QueryClientProvider>,
  );
}

describe('StreamControlSettings', () => {
  it('grants one permission at a time', async () => {
    renderSettings();
    const box = screen.getByRole('checkbox', { name: 'moda can switch scenes' });
    fireEvent.click(box);
    await waitFor(() => expect(box).toBeChecked());
    expect(posted).toEqual([{ twitchUserId: '200', canSwitchScenes: true }]);
    expect(screen.getByRole('checkbox', { name: 'moda can show and hide sources' })).toBeChecked();
  });

  it('keeps the box as it was when saving fails', async () => {
    postOk = false;
    renderSettings();
    const box = screen.getByRole('checkbox', { name: 'moda can show and hide sources' });
    fireEvent.click(box);
    expect(await screen.findByText(/Couldn.t save/)).toBeInTheDocument();
    expect(box).toBeChecked();
  });

  it('shows what mods have done, with the recorded names', async () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /Show what mods have done/ }));
    expect(await screen.findByText('modA')).toBeInTheDocument();
    expect(screen.getByText(/hide Cam/)).toBeInTheDocument();
  });
});
