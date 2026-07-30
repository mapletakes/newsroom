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

function mockOverlayApi(nowPlaying: Record<string, unknown> | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ ok: true, streamId: 'stream-1', nowPlaying, next: null }),
          { status: 200 },
        ),
      ),
    ),
  );
}

function renderOverlay(variant: OverlayVariant) {
  return render(<OverlayView token="tok" theme={null} showBrand variant={variant} />);
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
      container.querySelector('.flex.flex-col > div:not(.bg-rust)') as HTMLElement;

    it('gives the row the full 84px when there is no warning', async () => {
      mockOverlayApi({ ...NOW_PLAYING, triggerWarning: null });
      const { container } = renderOverlay('default');

      await screen.findByText(NOW_PLAYING.title);
      expect(rowOf(container).className).toContain('h-[84px]');
      expect(container.querySelector('.bg-rust.h-9')).toBeNull();
    });

    it('splits the same 84px into a 44px bar and a 40px row when there is one', async () => {
      mockOverlayApi({ ...NOW_PLAYING, triggerWarning: 'graphic footage' });
      const { container } = renderOverlay('default');

      await screen.findByText('graphic footage');
      expect(container.querySelector('.bg-rust')!.className).toContain('h-11'); // 44px
      expect(rowOf(container).className).toContain('h-10'); // 40px — 44 + 40 = 84
      expect(rowOf(container).className).not.toContain('h-[84px]');
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
