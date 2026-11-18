import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SuspiciousLogView } from './SuspiciousLogView';
import type { ChattersResponse, LogResponse } from '@/lib/suspicious-log-query';

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

function mockApi(response: LogResponse = RESPONSE) {
  const urls: string[] = [];
  const deletes: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'DELETE') {
        deletes.push(JSON.parse(String(init.body)));
        return Promise.resolve(new Response(JSON.stringify({ ok: true, deleted: 1 })));
      }
      urls.push(url);
      const body = url.startsWith('/api/suspicious-log/chatters') ? CHATTERS : response;
      return Promise.resolve(new Response(JSON.stringify(body)));
    }),
  );
  return { urls, deletes };
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
    // The reason a user is flagged stays out of the line until asked for.
    expect(screen.queryByText(/Added by a mod/)).toBeNull();
  });

  it('shows why a user is flagged when the time is clicked', async () => {
    mockApi();
    renderView();
    await userEvent.click(await screen.findByRole('button', { name: /^\d{2}:\d{2}:\d{2}$/ }));
    expect(screen.getByText(/Added by a mod/)).toHaveTextContent('Ban evasion: unknown');
  });

  it('hides deleting from mods', async () => {
    mockApi({ ...RESPONSE, canDelete: false });
    renderView();
    await screen.findByText(/onerror=alert/);
    expect(screen.queryByRole('checkbox', { name: /select message/i })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /select page/i })).toBeNull();
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
