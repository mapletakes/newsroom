// The overlay takeover puts audience text on the actual broadcast, so the two
// things worth pinning down are that the control is gated to the same grant as
// setting what's on air, and that "on stream" always reflects one question.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuestionsPanel } from './QuestionsPanel';

const Q1 = {
  id: 'q1',
  text: 'How do you decide which stories are worth covering?',
  asker_login: 'crazycorgiqueen',
  asker_is_sub: true,
  asker_is_mod: false,
  asker_is_vip: false,
  status: 'approved' as const,
  position: null,
  created_at: new Date().toISOString(),
};
const Q2 = { ...Q1, id: 'q2', text: 'What changed your mind most this year?' };

type Posted = { url: string; body: Record<string, unknown> };

// Stateful, because the panel refetches after every write: a mock that always
// replayed its initial rows would resurrect a question the moment it was
// answered, and any assertion about what's on screen afterwards would be
// measuring the mock rather than the component. Writes here mirror what the
// real routes do — including dropping a question off the overlay when it
// stops being approved (see the PATCH handler in app/api/questions).
function mockApi(overlayQuestionId: string | null = null) {
  const posts: Posted[] = [];
  const state = { questions: [Q1, Q2] as (typeof Q1)[], overlayQuestionId };

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (init?.method && init.method !== 'GET') {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        posts.push({ url, body });
        if (url.startsWith('/api/deck/overlay-question')) {
          state.overlayQuestionId = (body.id as string | null) ?? null;
        } else {
          state.questions = state.questions.filter((q) => q.id !== body.id);
          if (state.overlayQuestionId === body.id) state.overlayQuestionId = null;
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ questions: state.questions, overlayQuestionId: state.overlayQuestionId }),
          { status: 200 },
        ),
      );
    }),
  );
  return posts;
}

function renderPanel(canSetNowPlaying: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QuestionsPanel streamId="s1" enabled variant="tab" canSetNowPlaying={canSetNowPlaying} />
    </QueryClientProvider>,
  );
}

async function openPanel(canSetNowPlaying = true) {
  const user = userEvent.setup();
  renderPanel(canSetNowPlaying);
  await user.click(screen.getByRole('button', { name: /open questions/i }));
  await screen.findByText(Q1.text);
  return user;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('QuestionsPanel — overlay takeover', () => {
  it('offers no takeover control to a mod without the now-playing grant', async () => {
    mockApi();
    await openPanel(false);

    expect(screen.queryByRole('button', { name: /show on stream/i })).not.toBeInTheDocument();
    // Answering is still theirs — the gate is on airing, not on triage.
    expect(screen.getAllByRole('button', { name: /answered/i }).length).toBeGreaterThan(0);
  });

  it('airs the question that was clicked, by id', async () => {
    const posts = mockApi();
    const user = await openPanel();

    await user.click(screen.getAllByRole('button', { name: /show on stream/i })[1]);

    await waitFor(() => {
      expect(posts).toContainEqual({ url: '/api/deck/overlay-question', body: { id: 'q2' } });
    });
  });

  it('clears the overlay when the live question is taken down', async () => {
    const posts = mockApi('q1');
    const user = await openPanel();

    await user.click(await screen.findByRole('button', { name: /take down/i }));

    await waitFor(() => {
      expect(posts).toContainEqual({ url: '/api/deck/overlay-question', body: { id: null } });
    });
  });

  it('marks only the live question as on stream', async () => {
    mockApi('q1');
    await openPanel();

    // Exact text, not /on stream/i — that also matches the other card's
    // "Show on stream" button and would pass with the badge on every row.
    expect(await screen.findAllByText('On stream')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /show on stream/i })).toHaveLength(1);
  });

  it('takes the question off the overlay when it is answered', async () => {
    mockApi('q1');
    const user = await openPanel();

    expect(await screen.findByRole('button', { name: /take down/i })).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /answered/i })[0]);

    // An answered question left on the broadcast is the failure this guards:
    // the card goes, and the takeover has to go with it.
    await waitFor(() => {
      expect(screen.queryByText('On stream')).not.toBeInTheDocument();
    });
    expect(screen.queryByText(Q1.text)).not.toBeInTheDocument();
  });
});
