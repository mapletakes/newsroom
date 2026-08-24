// Covers the one thing worth pinning down here: every authenticated page
// renders this shared header, so "Log out" living in it (rather than only
// buried on /setup) is a promise worth a regression test.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppHeader } from './AppHeader';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AppHeader — Log out', () => {
  it('is always present, regardless of what the page passes as `right`', () => {
    render(<AppHeader section="test" />);
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
  });

  it('clears the session on click', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<AppHeader section="test" right={<span>Deck</span>} />);

    await user.click(screen.getByRole('button', { name: /log out/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth', { method: 'POST' });
    });
  });
});
