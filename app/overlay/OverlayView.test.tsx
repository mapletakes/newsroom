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
});
