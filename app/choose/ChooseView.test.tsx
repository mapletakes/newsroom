// The picker used to show only what was recorded at sign-in, so a channel
// someone started moderating afterwards never appeared. It now re-asks Twitch
// (via /api/auth/refresh-channels) every time it loads.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ChooseView } from './ChooseView';

const OWN = { id: 's-own', login: 'me', name: 'Me' };
const ALPHA = { id: 's-a', login: 'alpha', name: 'Alpha' };
const BRAVO = { id: 's-b', login: 'bravo', name: 'Bravo' };

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function stubRefresh(respond: () => Promise<Response>) {
  const fn = vi.fn((url: RequestInfo | URL) => (String(url) === '/api/auth/refresh-channels' ? respond() : json({})));
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** The status region flips aria-busy off once the check on load has finished. */
const checkFinished = () =>
  waitFor(() => expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'false'));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChooseView — checking for newly modded channels on load', () => {
  it('adds a channel that was missing from the server-rendered list, and says so', async () => {
    stubRefresh(() => json({ ok: true, channels: [ALPHA, BRAVO] }));
    render(<ChooseView displayName="Mod" ownStream={OWN} modStreams={[ALPHA]} />);

    expect(await screen.findByText('Bravo')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/found a new channel: Bravo/i);
  });

  it('asks exactly once per load, and stays quiet when nothing is new', async () => {
    const fn = stubRefresh(() => json({ ok: true, channels: [ALPHA] }));
    render(<ChooseView displayName="Mod" ownStream={OWN} modStreams={[ALPHA]} />);

    await checkFinished();
    expect(fn.mock.calls.filter((c) => String(c[0]) === '/api/auth/refresh-channels')).toHaveLength(1);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('offers to reconnect Twitch when the sign-in can no longer check, and keeps the known channels usable', async () => {
    stubRefresh(() => json({ error: 'reconnect' }, 400));
    render(<ChooseView displayName="Mod" ownStream={OWN} modStreams={[ALPHA]} />);

    const link = await screen.findByRole('link', { name: /reconnect twitch/i });
    expect(link).toHaveAttribute('href', '/api/twitch/oauth');
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('says nothing when Twitch just has a bad moment — nobody asked for the check', async () => {
    stubRefresh(() => json({ error: 'twitch' }, 502));
    render(<ChooseView displayName="Mod" ownStream={OWN} modStreams={[ALPHA]} />);

    await checkFinished();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('survives the request failing outright', async () => {
    stubRefresh(() => Promise.reject(new Error('offline')));
    render(<ChooseView displayName="Mod" ownStream={OWN} modStreams={[ALPHA]} />);

    await checkFinished();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('does not claim "no channels" while the check that might find some is still running', async () => {
    let finish!: (r: Response) => void;
    stubRefresh(() => new Promise<Response>((res) => (finish = res)));
    render(<ChooseView displayName="Mod" ownStream={OWN} modStreams={[]} />);

    expect(screen.getByText(/checking twitch/i)).toBeInTheDocument();
    expect(screen.queryByText(/no channels yet/i)).not.toBeInTheDocument();

    finish(new Response(JSON.stringify({ ok: true, channels: [BRAVO] }), { status: 200 }));
    expect(await screen.findByText('Bravo')).toBeInTheDocument();
  });

  it('settles on "No channels yet" with the explanation once the check comes back empty', async () => {
    stubRefresh(() => json({ ok: true, channels: [] }));
    render(<ChooseView displayName="Mod" ownStream={OWN} modStreams={[]} />);

    expect(await screen.findByText(/no channels yet/i)).toBeInTheDocument();
    expect(screen.getByText(/once its streamer has signed in/i)).toBeInTheDocument();
  });
});
