// Regression test for a reported bug: a mod would type a note, see it sitting
// in the field (this input is uncontrolled-ish, so it just keeps showing
// whatever was typed), and never click Save — the status color they'd
// already picked earlier did reach the server, so the save "worked" from
// their point of view, but the note never did. Nobody else ever saw it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModStatusPanel } from './ModStatusPanel';

const ME = {
  twitchUserId: '1',
  login: 'alice_mod',
  status: 'green' as const,
  note: null as string | null,
  updatedAt: new Date().toISOString(),
  viaMobile: false,
  isSelf: true,
};

function mockApi(mods: unknown[] = [ME]) {
  const patchCalls: Array<{ status: string | null; note: string | null; viaMobile: boolean }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/api/mod-status') && init?.method === 'PATCH') {
        const body = JSON.parse(init.body as string);
        patchCalls.push(body);
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ mods }), { status: 200 }));
    }),
  );
  return patchCalls;
}

function renderPanel(variant: 'tab' | 'menu' | 'page' = 'tab') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ModStatusPanel streamId="stream-1" enabled variant={variant} />
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
      expect(patchCalls).toContainEqual({ status: 'green', note: 'back in 20', viaMobile: false });
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

describe('ModStatusPanel — variant="page" (the /mod-status check-in surface)', () => {
  it('tags saves made from the page as viaMobile', async () => {
    const patchCalls = mockApi();
    const user = userEvent.setup();
    renderPanel('page');

    await user.click(await screen.findByTitle('Here and attentive'));

    await waitFor(() => {
      expect(patchCalls).toContainEqual({ status: 'green', note: '', viaMobile: true });
    });
  });

  it('renders inline with no drawer trigger', () => {
    mockApi();
    renderPanel('page');
    expect(screen.queryByRole('button', { name: /open mods/i })).not.toBeInTheDocument();
  });
});

describe('ModStatusPanel — mobile check-in badge', () => {
  it('shows a mobile badge next to a status set from the page, not the drawer', async () => {
    mockApi([
      { ...ME, twitchUserId: '1', login: 'alice_mod', viaMobile: true },
      { ...ME, twitchUserId: '2', login: 'bob_mod', isSelf: false, viaMobile: false },
    ]);
    const user = userEvent.setup();
    renderPanel('tab');

    await user.click(screen.getByRole('button', { name: /open mods/i }));
    await screen.findByText('alice_mod');

    const aliceRow = screen.getByText('alice_mod').closest('div')!;
    const bobRow = screen.getByText('bob_mod').closest('div')!;
    expect(within(aliceRow).getByText('mobile')).toBeInTheDocument();
    expect(within(bobRow).queryByText('mobile')).not.toBeInTheDocument();
  });

  it('hides the badge once status is cleared, even if viaMobile is still true in stale data', async () => {
    mockApi([{ ...ME, status: null, viaMobile: true }]);
    renderPanel('tab');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /open mods/i }));
    await screen.findByText('alice_mod');

    expect(screen.queryByText('mobile')).not.toBeInTheDocument();
  });
});
