// The palette picker is the surface that made a broken theme reachable: six
// free colour pickers with nothing stopping a streamer landing on an
// unreadable pair. These cover the replacement — that picking is visual,
// that the builder derives rather than accepts arbitrary colours, and that
// what gets saved is both the derived palette and the recipe behind it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppThemeSettings } from './ThemeSettings';
import {
  DEFAULT_APP_THEME,
  derivePalette,
  paletteContrastFailures,
  PALETTES,
  type AppTheme,
} from '@/lib/theme';

function mockApi() {
  const posts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') posts.push(JSON.parse(init.body as string));
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }),
  );
  return posts;
}

function renderSettings(initial: AppTheme = DEFAULT_APP_THEME) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <AppThemeSettings initial={initial} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const savedTheme = (posts: unknown[]) => (posts.at(-1) as { app_theme: AppTheme }).app_theme;

/** Drive a range input. userEvent can't type into one, and setting `.value`
 *  alone doesn't reach React — it tracks the last value it wrote and skips the
 *  change as a no-op, so the native setter has to be called explicitly. */
function setRange(input: HTMLElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AppThemeSettings — palette picking', () => {
  it('offers every built-in palette plus Custom, as radio options', () => {
    mockApi();
    renderSettings();
    const group = screen.getByRole('radiogroup', { name: /app palette/i });
    // One card per palette in lib/theme.ts, plus the builder — so adding a
    // palette there surfaces here without touching this file.
    expect(within(group).getAllByRole('radio')).toHaveLength(Object.keys(PALETTES).length + 1);
    expect(within(group).getByRole('radio', { name: /broadsheet/i })).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: /custom/i })).toBeInTheDocument();
  });

  it('saves the chosen preset, dropping any leftover custom colours', async () => {
    const posts = mockApi();
    const user = userEvent.setup();
    // A theme carrying an override from the old picker: selecting a preset has
    // to clear it, or one stale token repaints the preset it sits on.
    renderSettings({ ...DEFAULT_APP_THEME, preset: 'custom', colors: { rust: '#ff0000' } });

    await user.click(screen.getByRole('radio', { name: /midnight/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(savedTheme(posts).preset).toBe('midnight');
      expect(savedTheme(posts).colors).toEqual({});
    });
  });
});

describe('AppThemeSettings — the guided builder', () => {
  it('seeds a recipe and a full derived palette on entering Custom', async () => {
    const posts = mockApi();
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('radio', { name: /custom/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const t = savedTheme(posts);
      expect(t.preset).toBe('custom');
      expect(t.recipe).toBeDefined();
      // Both halves are written: colours are what renders, the recipe only
      // restores the controls.
      expect(t.colors).toEqual(derivePalette(t.recipe!));
    });
  });

  it('starts on a dark ground when entering Custom from a dark palette', async () => {
    const posts = mockApi();
    const user = userEvent.setup();
    renderSettings({ ...DEFAULT_APP_THEME, preset: 'midnight' });

    await user.click(screen.getByRole('radio', { name: /custom/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(savedTheme(posts).recipe?.ground).toBe('dark'));
  });

  it('re-derives the palette when a control moves', async () => {
    const posts = mockApi();
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('radio', { name: /custom/i }));
    setRange(screen.getByLabelText(/temperature/i), '40');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const t = savedTheme(posts);
      expect(t.recipe?.hue).toBe(40);
      expect(t.colors).toEqual(derivePalette(t.recipe!));
    });
  });

  it('cannot produce a palette that fails the contrast bar', async () => {
    // The point of replacing the free pickers. Whatever the controls are set
    // to, what gets saved has to be readable.
    const posts = mockApi();
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('radio', { name: /custom/i }));
    // Every control pushed to an extreme — the corner most likely to break.
    setRange(screen.getByLabelText(/temperature/i), '55');
    setRange(screen.getByLabelText(/paper tint/i), '0.14');
    setRange(screen.getByLabelText(/accent intensity/i), '0.85');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const t = savedTheme(posts);
      expect(paletteContrastFailures(t.colors as never)).toEqual([]);
    });
  });

  it('warns when a pre-builder custom theme is about to be rebuilt', async () => {
    mockApi();
    // Colours but no recipe — saved before the builder existed. The sliders
    // can't reflect where those colours came from, so the UI has to say so
    // rather than letting them look authoritative.
    renderSettings({ ...DEFAULT_APP_THEME, preset: 'custom', colors: { ...PALETTES.light } });

    expect(await screen.findByText(/old colour pickers/i)).toBeInTheDocument();

    // And it clears once the theme has actually been rebuilt from a recipe.
    setRange(screen.getByLabelText(/temperature/i), '120');
    await waitFor(() => expect(screen.queryByText(/old colour pickers/i)).not.toBeInTheDocument());
  });

  it('leaves a pre-builder custom theme untouched until a control is moved', async () => {
    // Merely opening the page must not silently repaint someone's saved
    // theme — the rebuild is their action, not a side effect of navigating.
    const posts = mockApi();
    const user = userEvent.setup();
    const legacy = { ...DEFAULT_APP_THEME, preset: 'custom', colors: { ...PALETTES.sepia } };
    renderSettings(legacy);

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(savedTheme(posts).colors).toEqual(legacy.colors);
      expect(savedTheme(posts).recipe).toBeUndefined();
    });
  });
});
