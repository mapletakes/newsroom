// The deck re-renders one ArchiveButton as the active item changes rather
// than mounting a fresh one, so the link it shows must always belong to the
// item it's currently showing.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArchiveButton } from './ArchiveButton';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ArchiveButton', () => {
  it('drops the previous item’s stored link when switched to an unarchived item', () => {
    const { rerender } = render(<ArchiveButton id="a" archiveUrl="https://x.test/a/old" />);
    expect(screen.getByRole('link', { name: /archived/i })).toHaveAttribute('href', 'https://x.test/a/old');

    rerender(<ArchiveButton id="b" archiveUrl={null} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: /archive/i })).toBeInTheDocument();
  });

  it('keeps a link it just archived only for the item it archived', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ archive_url: 'https://x.test/a/new' })))));
    const user = userEvent.setup();
    const { rerender } = render(<ArchiveButton id="a" archiveUrl={null} />);

    await user.click(screen.getByRole('button', { name: /archive/i }));
    await waitFor(() => expect(screen.getByRole('link')).toHaveAttribute('href', 'https://x.test/a/new'));

    rerender(<ArchiveButton id="b" archiveUrl={null} />);
    expect(screen.queryByRole('link')).toBeNull();

    rerender(<ArchiveButton id="a" archiveUrl={null} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://x.test/a/new');
  });

  it('does not put an in-flight capture’s link on the item switched to', async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (resolve = r))));
    const user = userEvent.setup();
    const { rerender } = render(<ArchiveButton id="a" archiveUrl={null} />);

    await user.click(screen.getByRole('button', { name: /archive/i }));
    rerender(<ArchiveButton id="b" archiveUrl={null} />);
    expect(screen.getByRole('button', { name: /^archive$/i })).toBeEnabled();

    resolve(new Response(JSON.stringify({ archive_url: 'https://x.test/a/late' })));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('link')).toBeNull();
  });
});
