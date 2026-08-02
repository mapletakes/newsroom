// Regression test for a reported bug: a mod would type a note, see it sitting
// in the field (this input is uncontrolled-ish, so it just keeps showing
// whatever was typed), and never click Save — the status color they'd
// already picked earlier did reach the server, so the save "worked" from
// their point of view, but the note never did. Nobody else ever saw it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModStatusPanel } from './ModStatusPanel';

const ME = {
  twitchUserId: '1',
  login: 'alice_mod',
  status: 'green' as const,
  note: null as string | null,
  updatedAt: new Date().toISOString(),
  isSelf: true,
};

function mockApi() {
  const patchCalls: Array<{ status: string | null; note: string | null }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/api/mod-status') && init?.method === 'PATCH') {
        const body = JSON.parse(init.body as string);
        patchCalls.push(body);
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ mods: [ME] }), { status: 200 }),
      );
    }),
  );
  return patchCalls;
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ModStatusPanel streamId="stream-1" enabled variant="tab" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ModStatusPanel — note save-on-blur', () => {
  it('saves a typed note when focus leaves the field, without a separate Save click', async () => {
    const patchCalls = mockApi();
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /open mods/i }));
    const input = await screen.findByLabelText('Status note');

    await user.type(input, 'back in 20');
    // Move focus elsewhere without touching Save.
    await user.click(screen.getByText('Your availability'));

    await waitFor(() => {
      expect(patchCalls).toContainEqual({ status: 'green', note: 'back in 20' });
    });
  });

  it('does not re-save on blur when the note is unchanged', async () => {
    const patchCalls = mockApi();
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /open mods/i }));
    const input = await screen.findByLabelText('Status note');

    await user.click(input);
    await user.click(screen.getByText('Your availability'));

    expect(patchCalls).toHaveLength(0);
  });
});
