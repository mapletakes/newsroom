// The overlay is the one surface nobody can eyeball while it's failing — it
// lives inside an OBS browser source, on stream. The trigger warning has to
// survive in every variant, including `minimal`, whose one-line chip had to be
// restructured into a column to make room for it.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { OverlayView, type OverlayVariant } from './OverlayView';

const NOW_PLAYING = {
  title: 'Senate passes surprise budget bill in 3am vote',
  kind: 'article',
  publisher: 'Reuters',
  durationSeconds: null,
  triggerWarning: null as string | null,
};

function mockOverlayApi(
  nowPlaying: Record<string, unknown> | null,
  question: Record<string, unknown> | null = null,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ ok: true, streamId: 'stream-1', theme: null, nowPlaying, next: null, question }),
          { status: 200 },
        ),
      ),
    ),
  );
}

function renderOverlay(variant: OverlayVariant) {
  return render(<OverlayView token="tok" fallbackPreset={null} showBrand variant={variant} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const VARIANTS: OverlayVariant[] = ['default', 'minimal', 'ticker'];

describe('OverlayView — trigger warning', () => {
  it.each(VARIANTS)('renders the warning in the %s variant', async (variant) => {
    mockOverlayApi({ ...NOW_PLAYING, triggerWarning: 'graphic footage of the crash' });
    renderOverlay(variant);

    expect(await screen.findByText('graphic footage of the crash')).toBeInTheDocument();
    expect(screen.getByText(/trigger warning/i)).toBeInTheDocument();
    // The item itself still renders alongside it, rather than being displaced.
    expect(screen.getByText(NOW_PLAYING.title)).toBeInTheDocument();
  });

  it.each(VARIANTS)('shows no warning chrome in the %s variant when absent', async (variant) => {
    mockOverlayApi({ ...NOW_PLAYING, triggerWarning: null });
    renderOverlay(variant);

    expect(await screen.findByText(NOW_PLAYING.title)).toBeInTheDocument();
    expect(screen.queryByText(/trigger warning/i)).not.toBeInTheDocument();
  });

  it('renders nothing at all between items, warning or not', async () => {
    mockOverlayApi(null);
    const { container } = renderOverlay('default');

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  // The bug this guards: a browser source is a fixed-size window, so a warning
  // bar that ADDS height pushes the card off the bottom of it mid-show. The
  // bar's 36px has to come back out of the row underneath, not off the end.
  describe('card height is unchanged by a warning', () => {
    const rowOf = (container: HTMLElement) =>
      container.querySelector('[data-ov="row"]') as HTMLElement;
    const barOf = (container: HTMLElement) =>
      container.querySelector('[data-ov="warning"]');

    it('gives the row the full 84px when there is no warning', async () => {
      mockOverlayApi({ ...NOW_PLAYING, triggerWarning: null });
      const { container } = renderOverlay('default');

      await screen.findByText(NOW_PLAYING.title);
      expect(rowOf(container).className).toContain('h-[84px]');
      expect(barOf(container)).toBeNull();
    });

    it('splits the same 84px into a 44px bar and a 40px row when there is one', async () => {
      mockOverlayApi({ ...NOW_PLAYING, triggerWarning: 'graphic footage' });
      const { container } = renderOverlay('default');

      await screen.findByText('graphic footage');
      expect(barOf(container)!.className).toContain('h-11'); // 44px
      expect(rowOf(container).className).toContain('h-10'); // 40px — 44 + 40 = 84
      expect(rowOf(container).className).not.toContain('h-[84px]');
    });

    // The title has to shrink along with its row: 30px reads well in the full
    // 84px, but would crowd the 40px left once a warning takes the top half.
    it('sizes the title to the row it is in', async () => {
      mockOverlayApi({ ...NOW_PLAYING, triggerWarning: null });
      renderOverlay('default');
      expect((await screen.findByText(NOW_PLAYING.title)).className).toContain('text-[30px]');
      cleanup();

      mockOverlayApi({ ...NOW_PLAYING, triggerWarning: 'graphic footage' });
      renderOverlay('default');
      expect((await screen.findByText(NOW_PLAYING.title)).className).toContain('text-xl');
    });

    // What gives way is the publisher/kind/duration line — the least
    // important thing on the card once an item carries a warning.
    it('drops the meta line to make the room', async () => {
      mockOverlayApi({ ...NOW_PLAYING, triggerWarning: null });
      renderOverlay('default');
      expect(await screen.findByText(/Reuters/)).toBeInTheDocument();
      cleanup();

      mockOverlayApi({ ...NOW_PLAYING, triggerWarning: 'graphic footage' });
      renderOverlay('default');
      await screen.findByText('graphic footage');
      expect(screen.queryByText(/Reuters/)).not.toBeInTheDocument();
    });
  });
});

const QUESTION = {
  text: 'How do you decide which stories are worth covering?',
  asker: 'crazycorgiqueen',
  askerTag: 'sub',
};

describe('OverlayView — question takeover', () => {
  it.each(VARIANTS)('renders the question and who asked it in the %s variant', async (variant) => {
    mockOverlayApi(NOW_PLAYING, QUESTION);
    renderOverlay(variant);

    expect(await screen.findByText(QUESTION.text)).toBeInTheDocument();
    expect(screen.getByText(/crazycorgiqueen/)).toBeInTheDocument();
    expect(screen.getByText(/sub/)).toBeInTheDocument();
  });

  // "Takeover" is the whole contract: two things claiming to be current at
  // once is the one thing an on-air graphic can't do.
  it.each(VARIANTS)('displaces the now-playing item entirely in the %s variant', async (variant) => {
    mockOverlayApi(NOW_PLAYING, QUESTION);
    renderOverlay(variant);

    await screen.findByText(QUESTION.text);
    expect(screen.queryByText(NOW_PLAYING.title)).not.toBeInTheDocument();
  });

  // The case that would be easy to break by gating the question on
  // nowPlaying: a streamer between items reading one out is the ordinary
  // use, not an edge case.
  it('renders with nothing on air at all', async () => {
    mockOverlayApi(null, QUESTION);
    renderOverlay('default');

    expect(await screen.findByText(QUESTION.text)).toBeInTheDocument();
  });

  it('falls back to the normal card when no question is live', async () => {
    mockOverlayApi(NOW_PLAYING, null);
    renderOverlay('default');

    expect(await screen.findByText(NOW_PLAYING.title)).toBeInTheDocument();
    expect(screen.queryByText(/crazycorgiqueen/)).not.toBeInTheDocument();
  });

  it('names an anonymous asker rather than leaving the line blank', async () => {
    mockOverlayApi(null, { ...QUESTION, asker: null, askerTag: null });
    renderOverlay('default');

    expect(await screen.findByText(/anonymous/)).toBeInTheDocument();
  });

  // Same fixed-window bug the warning tests guard: the takeover has to land on
  // the row height the source was sized for, not whatever the text needs.
  it('occupies the same 84px row the default card does', async () => {
    mockOverlayApi(NOW_PLAYING, QUESTION);
    const { container } = renderOverlay('default');

    await screen.findByText(QUESTION.text);
    const row = container.querySelector('[data-ov="question"]') as HTMLElement;
    expect(row.className).toContain('h-[84px]');
  });

  // A question can't be truncated the way a headline can, so the type steps
  // down instead — and it has to actually step, or the longest ones overflow
  // the row they're pinned to.
  describe('type size steps down as the question grows', () => {
    const sizeOf = async (text: string) => {
      mockOverlayApi(null, { ...QUESTION, text });
      renderOverlay('default');
      const el = await screen.findByText(text);
      return el.className;
    };

    it('gives a short question the largest step', async () => {
      expect(await sizeOf('Why this story?')).toContain('text-[26px]');
    });

    it('drops a medium question a step', async () => {
      expect(await sizeOf('a'.repeat(120))).toContain('text-[18px]');
    });

    it('drops a long question another step', async () => {
      expect(await sizeOf('a'.repeat(200))).toContain('text-[15px]');
    });

    // Measured: prose only renders complete to ~280 chars at 15px, so the
    // top of the 300-char range needs its own step rather than clipping.
    it('drops a question near the 300-char cap to the smallest step', async () => {
      expect(await sizeOf('a'.repeat(290))).toContain('text-[13px]');
    });

    it('clamps every step so no length can push the row taller', async () => {
      expect(await sizeOf('Why this story?')).toContain('line-clamp-2');
      cleanup();
      expect(await sizeOf('a'.repeat(290))).toContain('line-clamp-3');
    });
  });
});
