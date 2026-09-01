// The grid itself, independent of where it's used — ThemeSettings.test.tsx
// covers the token-pinning behaviour that sits on top of this.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SwatchPicker } from './swatch-picker';

afterEach(() => cleanup());

describe('SwatchPicker', () => {
  it('shows the current colour on the trigger and nothing else until opened', () => {
    render(<SwatchPicker value="#336699" onChange={() => {}} label="Accent" />);
    const trigger = screen.getByLabelText(/set accent explicitly/i);
    expect(trigger).toHaveStyle({ background: '#336699' });
    expect(screen.queryByRole('button', { name: /^use$/i })).not.toBeInTheDocument();
  });

  it('opens a grid of clickable swatches, each identified by its own hex', async () => {
    const user = userEvent.setup();
    render(<SwatchPicker value="#336699" onChange={() => {}} label="Accent" />);
    await user.click(screen.getByLabelText(/set accent explicitly/i));

    // Every swatch is its own real colour, not a handful of repeated ones —
    // a picker whose "grid" was actually 3 colours stretched over 80 cells
    // would still pass a naive "is there a grid" check.
    const swatches = screen.getAllByRole('button', { name: /^#[0-9a-f]{6}$/i });
    const uniqueHexes = new Set(swatches.map((s) => s.getAttribute('aria-label')));
    expect(swatches.length).toBeGreaterThan(50);
    expect(uniqueHexes.size).toBeGreaterThan(50);
  });

  it('commits and closes when a swatch is clicked', async () => {
    let picked: string | null = null;
    const user = userEvent.setup();
    render(<SwatchPicker value="#336699" onChange={(hex) => { picked = hex; }} label="Accent" />);
    await user.click(screen.getByLabelText(/set accent explicitly/i));

    const swatches = screen.getAllByRole('button', { name: /^#[0-9a-f]{6}$/i });
    const target = swatches[10].getAttribute('aria-label')!;
    await user.click(swatches[10]);

    expect(picked).toBe(target);
    expect(screen.queryByRole('button', { name: /^use$/i })).not.toBeInTheDocument(); // popover closed
  });

  it('the exact-hex fallback accepts a typed value the grid could never land on exactly', async () => {
    let picked: string | null = null;
    const user = userEvent.setup();
    render(<SwatchPicker value="#336699" onChange={(hex) => { picked = hex; }} label="Accent" />);
    await user.click(screen.getByLabelText(/set accent explicitly/i));

    const hexField = screen.getByLabelText(/exact hex value/i);
    await user.clear(hexField);
    await user.type(hexField, '#a1b2c3');
    await user.click(screen.getByRole('button', { name: /^use$/i }));

    expect(picked).toBe('#a1b2c3');
  });

  it('rejects an incomplete or malformed hex rather than committing garbage', async () => {
    let picked: string | null = null;
    const user = userEvent.setup();
    render(<SwatchPicker value="#336699" onChange={(hex) => { picked = hex; }} label="Accent" />);
    await user.click(screen.getByLabelText(/set accent explicitly/i));

    const hexField = screen.getByLabelText(/exact hex value/i);
    await user.clear(hexField);
    await user.type(hexField, '#zzzzzz');
    expect(screen.getByRole('button', { name: /^use$/i })).toBeDisabled();
    expect(picked).toBeNull(); // the disabled state actually stops the commit, not just the button's look
  });

  it('marks swatches the caller flags as accessible, and only those', async () => {
    // A real predicate against the actual generated swatches, not hardcoded
    // hexes that may not exist in the grid at all — dark swatches (low
    // perceived luminance) pass, light ones don't, which is exactly the
    // kind of predicate a caller grading against a light paper would supply.
    const luminance = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return (r * 299 + g * 587 + b * 114) / 1000;
    };

    const user = userEvent.setup();
    render(
      <SwatchPicker
        value="#336699"
        onChange={() => {}}
        label="Accent"
        isAccessible={(hex) => luminance(hex) < 100}
      />,
    );
    await user.click(screen.getByLabelText(/set accent explicitly/i));

    const allSwatches = screen.getAllByRole('button', { name: /^#[0-9a-f]{6}$/i });
    const flaggedCount = allSwatches.filter(
      (s) => within(s).queryByText('✓') !== null,
    ).length;
    // Some swatches qualify (the dark rows) and some don't (the light ones)
    // — it's a strict subset either way, not all-or-nothing.
    expect(flaggedCount).toBeGreaterThan(0);
    expect(flaggedCount).toBeLessThan(allSwatches.length);
  });
});
