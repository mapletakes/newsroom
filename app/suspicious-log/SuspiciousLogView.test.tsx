import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SuspiciousLogView } from './SuspiciousLogView';
import type { ChattersResponse, LogResponse, ShareSummary } from '@/lib/suspicious-log-query';
import type { NetworkResponse } from '@/lib/chatter-flag-types';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const RESPONSE: LogResponse = {
  items: [
    {
      id: '4b4dbeb8-77ce-4eec-96ef-fba4bda9693c',
      chatter_user_id: '200',
      chatter_login: 'viewer',
      chatter_name: 'Viewer',
      message_text: '<img src=x onerror=alert(1)> https://bad.test/link',
      low_trust_status: 'restricted',
      detection_types: ['manually_added'],
      ban_evasion_evaluation: 'unknown',
      shared_ban_channel_ids: [],
      sent_at: '2026-11-18T19:09:24.448Z',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 200,
  statusChanges: [],
  canDelete: true,
  logEnabled: true,
  logStatus: 'active',
  logStatusAt: null,
};

const CHATTERS: ChattersResponse = {
  chatters: [
    { id: '200', login: 'viewer', name: 'Viewer', status: 'restricted', last_seen: '2026-11-18T19:09:24.448Z' },
  ],
};

const SHARE_URL = `https://app.test/sl/sl_${'a'.repeat(48)}`;

const share = (over: Partial<ShareSummary> = {}): ShareSummary => ({
  id: '9c2d3e1f-1111-4222-8333-444455556666',
  url: SHARE_URL,
  kind: 'chatter',
  label: 'Viewer',
  created_by_login: 'themod',
  created_at: '2026-11-18T19:30:00.000Z',
  expires_at: '2026-12-18T19:30:00.000Z',
  status: 'active',
  mine: true,
  ...over,
});

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

const NOT_RECEIVING: NetworkResponse = { logEnabled: true, subscribed: false, canSubscribe: true, chatters: [], truncated: false };

function mockApi(response: LogResponse = RESPONSE, shareList: ShareSummary[] = [], network: NetworkResponse = NOT_RECEIVING) {
  const networkCalls: [string, unknown][] = [];
  const urls: string[] = [];
  const deletes: unknown[] = [];
  const created: unknown[] = [];
  const revoked: unknown[] = [];
  const flagged: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (url.startsWith('/api/suspicious-log/network')) {
        if (method !== 'GET') {
          networkCalls.push([`${method} ${url}`, body]);
          return json({ ok: true });
        }
        return json(network);
      }
      if (url.startsWith('/api/suspicious-log/flags')) {
        if (method === 'POST') {
          flagged.push(body);
          return json({ flag: { id: 'f1', chatterName: 'Viewer' } }, 201);
        }
        return json({ flags: [] });
      }
      if (url.startsWith('/api/suspicious-log/share')) {
        if (method === 'POST') {
          created.push(body);
          return json({ share: { id: 'new', url: SHARE_URL, kind: body.kind, label: 'Viewer', expiresAt: '2026-12-18T19:00:00.000Z' } }, 201);
        }
        if (method === 'DELETE') {
          revoked.push(body);
          return json({ ok: true });
        }
        return json({ shares: shareList });
      }
      if (method === 'DELETE') {
        deletes.push(body);
        return json({ ok: true, deleted: 1 });
      }
      urls.push(url);
      return json(url.startsWith('/api/suspicious-log/chatters') ? CHATTERS : response);
    }),
  );
  return { urls, deletes, created, revoked, flagged, networkCalls };
}

function stubClipboard() {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SuspiciousLogView displayName="Mike" isAdmin={false} isMod={false} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

describe('SuspiciousLogView', () => {
  it('shows chat text as plain text, with no live links or markup', async () => {
    mockApi();
    const { container } = renderView();
    expect(await screen.findByText(/onerror=alert/)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('link', { name: /bad\.test/ })).toBeNull();
  });

  it('puts each message on one line with a clock time and the chatter\'s name', async () => {
    mockApi();
    renderView();
    await screen.findByText(/onerror=alert/);
    expect(screen.getByRole('button', { name: /^\d{2}:\d{2}:\d{2}$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Viewer' })).toBeInTheDocument();
    // The reason a user is flagged stays out of the line until asked for. The
    // " · " separator keeps this from matching the Detection filter's option.
    expect(screen.queryByText(/Restricted · Added by a mod/)).toBeNull();
  });

  it('shows why a user is flagged when the time is clicked', async () => {
    mockApi();
    renderView();
    await userEvent.click(await screen.findByRole('button', { name: /^\d{2}:\d{2}:\d{2}$/ }));
    expect(screen.getByText(/Restricted · Added by a mod/)).toHaveTextContent('Ban evasion: unknown');
  });

  it('lets mods select messages, but not delete them', async () => {
    mockApi({ ...RESPONSE, canDelete: false });
    renderView();
    await userEvent.click(await screen.findByRole('checkbox', { name: /select message from viewer/i }));
    expect(screen.getByRole('button', { name: 'Share 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
  });

  it('warns when logging has stopped', async () => {
    mockApi({ ...RESPONSE, logStatus: 'needs_reconnect' });
    renderView();
    expect(await screen.findByRole('status')).toHaveTextContent(/sign out and back in/i);
  });

  it('stays quiet while logging is running', async () => {
    mockApi();
    renderView();
    await screen.findByText(/onerror=alert/);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('narrows to one chatter when their name is clicked', async () => {
    const { urls } = mockApi();
    renderView();
    await userEvent.click(await screen.findByRole('button', { name: 'Viewer' }));

    expect(await screen.findByRole('button', { name: 'Clear chatter' })).toBeInTheDocument();
    await waitFor(() => expect(urls.some((u) => u.includes('chatterId=200'))).toBe(true));
    // Their name no longer repeats on every line.
    expect(screen.queryByRole('button', { name: 'Viewer' })).toBeNull();
  });

  it('finds a chatter through the picker', async () => {
    const { urls } = mockApi();
    renderView();
    await screen.findByText(/onerror=alert/);

    await userEvent.click(screen.getByRole('combobox', { name: 'Chatter' }));
    await userEvent.click(await screen.findByRole('option', { name: /viewer/i }));

    expect(await screen.findByRole('button', { name: 'Clear chatter' })).toBeInTheDocument();
    await waitFor(() => expect(urls.some((u) => u.includes('chatterId=200'))).toBe(true));
  });

  it('picks the highlighted chatter with the keyboard', async () => {
    const { urls } = mockApi();
    renderView();
    await screen.findByText(/onerror=alert/);

    await userEvent.click(screen.getByRole('combobox', { name: 'Chatter' }));
    await screen.findByRole('option', { name: /viewer/i });
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(urls.some((u) => u.includes('chatterId=200'))).toBe(true));
  });

  it('goes back to everyone when the chatter is cleared', async () => {
    mockApi();
    renderView();
    await userEvent.click(await screen.findByRole('button', { name: 'Viewer' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Clear chatter' }));

    expect(await screen.findByRole('combobox', { name: 'Chatter' })).toBeInTheDocument();
    // Names are back on each line, because the log is no longer one person's.
    expect(await screen.findByRole('button', { name: 'Viewer' })).toBeInTheDocument();
  });

  it('searches messages as you type', async () => {
    const { urls } = mockApi();
    renderView();
    await screen.findByText(/onerror=alert/);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search messages' }), 'abc');

    await waitFor(() => expect(urls.some((u) => u.includes('q=abc'))).toBe(true));
  });

  it('can list the oldest messages first', async () => {
    const { urls } = mockApi();
    renderView();
    await screen.findByText(/onerror=alert/);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Order' }), 'oldest');

    await waitFor(() => expect(urls.some((u) => u.includes('order=oldest'))).toBe(true));
  });

  it('deletes selected messages after confirmation', async () => {
    const { deletes } = mockApi();
    renderView();
    await userEvent.click(await screen.findByRole('checkbox', { name: /select message from viewer/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete 1' }));
    expect(deletes).toEqual([]);

    const buttons = await screen.findAllByRole('button', { name: 'Delete 1' });
    await userEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(deletes).toEqual([{ ids: [RESPONSE.items[0].id] }]));
  });
});

describe('SuspiciousLogView sharing', () => {
  it('copies selected messages as plain text', async () => {
    mockApi();
    const writeText = stubClipboard();
    renderView();

    await userEvent.click(await screen.findByRole('checkbox', { name: /select message from viewer/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('Viewer: <img src=x onerror=alert(1)> https://bad.test/link'),
      ),
    );
  });

  it('offers CSV and text downloads of everything the filters match', async () => {
    mockApi();
    renderView();
    await screen.findByText(/onerror=alert/);

    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
      'href',
      '/api/suspicious-log/export?format=csv',
    );
    expect(screen.getByRole('link', { name: 'Export text' })).toHaveAttribute(
      'href',
      '/api/suspicious-log/export?format=txt',
    );

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search messages' }), 'abc');
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Export CSV' }).getAttribute('href')).toContain('q=abc'),
    );
    expect(screen.getByRole('link', { name: 'Export CSV' }).getAttribute('href')).not.toContain('page=');
  });

  it('tells you who can read a link before making it', async () => {
    const { created } = mockApi();
    renderView();
    await userEvent.click(await screen.findByRole('checkbox', { name: /select message from viewer/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Share 1' }));

    const dialog = await screen.findByRole('dialog', { name: 'Share a link' });
    expect(dialog).toHaveTextContent(/anyone who has the link can read/i);
    expect(dialog).toHaveTextContent(/30 days/);
    // Opening the dialog is not agreeing to it.
    expect(created).toEqual([]);
  });

  it('makes a link to the selected messages', async () => {
    const { created } = mockApi();
    renderView();
    await userEvent.click(await screen.findByRole('checkbox', { name: /select message from viewer/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Share 1' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create link' }));

    expect(await screen.findByRole('textbox', { name: 'Share link' })).toHaveValue(SHARE_URL);
    expect(created).toEqual([{ kind: 'messages', messageIds: [RESPONSE.items[0].id] }]);
  });

  it('makes a link to everything one chatter has said', async () => {
    const { created } = mockApi();
    renderView();
    await userEvent.click(await screen.findByRole('button', { name: 'Viewer' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Share all' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create link' }));

    expect(await screen.findByRole('textbox', { name: 'Share link' })).toHaveValue(SHARE_URL);
    expect(created).toEqual([{ kind: 'chatter', chatterId: '200' }]);
  });

  it('lists links and revokes one', async () => {
    const { revoked } = mockApi(RESPONSE, [share()]);
    renderView();
    await screen.findByText(/onerror=alert/);

    await userEvent.click(screen.getByRole('button', { name: 'Shared links' }));
    const list = await screen.findByRole('list', { name: 'Shared links' });
    expect(list).toHaveTextContent('Viewer');
    expect(list).toHaveTextContent('all messages');

    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(revoked).toEqual([{ id: share().id }]));
  });

  it('shows a dead link as dead, with nothing to copy', async () => {
    mockApi(RESPONSE, [share({ status: 'revoked', url: null })]);
    renderView();
    await screen.findByText(/onerror=alert/);

    await userEvent.click(screen.getByRole('button', { name: 'Shared links' }));
    const list = await screen.findByRole('list', { name: 'Shared links' });

    expect(list).toHaveTextContent('revoked');
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });

  it('lets a mod revoke only their own links', async () => {
    mockApi({ ...RESPONSE, canDelete: false }, [share({ mine: true }), share({ id: 'other', mine: false })]);
    renderView();
    await screen.findByText(/onerror=alert/);

    await userEvent.click(screen.getByRole('button', { name: 'Shared links' }));
    await screen.findByRole('list', { name: 'Shared links' });

    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1);
  });

  it('lets the streamer revoke anyone\'s link, and says whose it is', async () => {
    mockApi(RESPONSE, [share({ mine: false, created_by_login: 'themod' })]);
    renderView();
    await screen.findByText(/onerror=alert/);

    await userEvent.click(screen.getByRole('button', { name: 'Shared links' }));
    const list = await screen.findByRole('list', { name: 'Shared links' });

    expect(list).toHaveTextContent('by themod');
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
  });

  it('flags a chatter with the selected messages, context optional', async () => {
    const api = mockApi();
    renderView();
    await userEvent.click(await screen.findByRole('checkbox', { name: /select message from viewer/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Flag 1' }));

    expect(await screen.findByRole('heading', { name: 'Flag Viewer' })).toBeInTheDocument();
    expect(screen.getByText(/never|won.t see who on your team/i)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Flag chatter' });
    expect(submit).toBeDisabled();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'spam');
    await userEvent.click(submit);

    await waitFor(() =>
      expect(api.flagged).toEqual([{ chatterId: '200', messageIds: [RESPONSE.items[0].id], category: 'spam', context: '' }]),
    );
  });

  it('requires context to flag someone by username', async () => {
    const api = mockApi();
    renderView();
    await userEvent.click(await screen.findByRole('button', { name: 'Flag by username' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Twitch username' }), 'troll');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'ban_evasion');
    const submit = screen.getByRole('button', { name: 'Flag chatter' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByRole('textbox', { name: /context/i }), 'Banned for slurs before Twitch flagged them.');
    await userEvent.click(submit);
    await waitFor(() =>
      expect(api.flagged).toEqual([
        { login: 'troll', category: 'ban_evasion', context: 'Banned for slurs before Twitch flagged them.' },
      ]),
    );
  });

  it('offers no flagging while the module is off', async () => {
    mockApi({ ...RESPONSE, logEnabled: false, logStatus: 'off' });
    renderView();
    await userEvent.click(await screen.findByRole('checkbox', { name: /select message from viewer/i }));
    expect(screen.queryByRole('button', { name: /^Flag (\d|chatter|by username)/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Flags' })).toBeInTheDocument();
  });

  it('lets the streamer start receiving network flags', async () => {
    const api = mockApi();
    renderView();
    await userEvent.click(await screen.findByRole('tab', { name: 'Network flags' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Receive network flags' }));
    await waitFor(() =>
      expect(api.networkCalls).toEqual([['POST /api/suspicious-log/network/subscription', { subscribed: true }]]),
    );
  });

  it('tells a mod only the streamer can turn receiving on', async () => {
    mockApi(RESPONSE, [], { ...NOT_RECEIVING, canSubscribe: false });
    renderView();
    await userEvent.click(await screen.findByRole('tab', { name: 'Network flags' }));
    expect(await screen.findByText('Only the streamer can turn this on.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Receive network flags' })).toBeNull();
  });

  it('shows other channels’ flags apart from their evidence, and records a decision', async () => {
    const api = mockApi(RESPONSE, [], {
      logEnabled: true,
      subscribed: true,
      canSubscribe: false,
      truncated: false,
      chatters: [
        {
          chatter_user_id: '900',
          chatter_login: 'troll',
          chatter_name: 'Troll',
          latest_at: '2026-11-18T00:00:00Z',
          review: null,
          isNew: true,
          inMyLog: false,
          flags: [
            {
              id: 'f1',
              channelName: 'OtherChannel',
              category: 'hate',
              context: 'Banned for slurs.',
              created_at: '2026-11-18T00:00:00Z',
              updated_at: null,
              messages: [{ id: 'm1', sent_at: '2026-11-17T00:00:00Z', message_text: 'awful thing', low_trust_status: 'restricted' }],
            },
          ],
        },
      ],
    });
    renderView();
    await userEvent.click(await screen.findByRole('tab', { name: 'Network flags' }));
    expect(await screen.findByText('Troll')).toBeInTheDocument();
    expect(screen.getByText(/OtherChannel.s account/)).toBeInTheDocument();
    expect(screen.getByText(/captured by Twitch in OtherChannel/)).toBeInTheDocument();
    expect(screen.getByText('awful thing')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop receiving' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Banned' }));
    await waitFor(() =>
      expect(api.networkCalls).toEqual([['POST /api/suspicious-log/network/review', { chatterId: '900', decision: 'banned' }]]),
    );
  });
});
