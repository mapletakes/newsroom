'use client';

import { useCallback, useEffect, useState } from 'react';

type QuickLink = { id: string; label: string; url: string; position: number };

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

// A streamer's personal "on-hand" links (fossabot, fundraisers, etc.), in a
// popout drawer that overlays the deck. Entirely separate from the queue.
export function QuickLinksDrawer() {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const r = await fetch('/api/quick-links');
    if (r.ok) {
      const d = await r.json();
      setLinks(d.links || []);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Esc closes the drawer.
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || adding) return;
    setAdding(true);
    setError('');
    try {
      const r = await fetch('/api/quick-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, url }),
      });
      if (r.ok) {
        const d = await r.json();
        setLinks((prev) => [...prev, d.link]);
        setLabel('');
        setUrl('');
      } else {
        const d = await r.json().catch(() => ({}));
        setError(d.error === 'invalid url' ? 'That doesn’t look like a URL.' : d.error || 'Failed to add');
      }
    } finally {
      setAdding(false);
    }
  };

  const remove = async (id: string) => {
    setLinks((prev) => prev.filter((l) => l.id !== id)); // optimistic
    await fetch('/api/quick-links', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  };

  return (
    <>
      {/* Left-edge launcher tab — always reachable while running the show. */}
      <button
        onClick={() => setOpen(true)}
        className="fixed left-0 top-20 z-30 flex flex-col items-center gap-1.5 bg-ink text-paper px-1.5 py-3 rounded-r-sm shadow-lg hover:bg-rust transition-colors"
        aria-label="Open on-hand links"
        title="On-hand links"
      >
        <span className="material-icons text-lg">bookmarks</span>
        <span className="[writing-mode:vertical-rl] font-mono text-[10px] uppercase tracking-widest">
          Links
        </span>
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-ink/40 z-40"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Drawer */}
      <aside
        className={`fixed left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-paper border-r-2 border-ink z-50 flex flex-col shadow-2xl transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!open}
      >
        <div className="flex items-center gap-2 border-b-2 border-ink px-4 py-3">
          <span className="material-icons text-ink">bookmarks</span>
          <h2 className="font-display text-xl font-black">On-hand links</h2>
          <button
            onClick={() => setOpen(false)}
            className="ml-auto text-ink/50 hover:text-rust"
            aria-label="Close"
          >
            <span className="material-icons">close</span>
          </button>
        </div>

        <form onSubmit={add} className="border-b border-ink/20 p-4 space-y-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            className="w-full font-mono text-xs border border-ink/30 bg-paper px-2 py-1.5 focus:outline-none focus:border-ink"
          />
          <div className="flex gap-1">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a URL…"
              className="flex-1 min-w-0 font-mono text-xs border border-ink/30 bg-paper px-2 py-1.5 focus:outline-none focus:border-ink"
              disabled={adding}
            />
            <button
              type="submit"
              disabled={adding || !url.trim()}
              className="shrink-0 font-mono text-xs uppercase tracking-widest bg-ink text-paper px-3 py-1.5 hover:bg-rust transition-colors disabled:opacity-40"
            >
              {adding ? '…' : 'Add'}
            </button>
          </div>
          {error && <div className="font-mono text-[10px] text-rust">{error}</div>}
        </form>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {links.length === 0 ? (
            <p className="font-mono text-[11px] text-ink/40 px-2 py-6 text-center leading-relaxed">
              No links yet. Stash fossabot, fundraisers, giveaway pages — anything
              you want one click away during the show.
            </p>
          ) : (
            links.map((l) => (
              <div key={l.id} className="group flex items-center gap-2 card-paper p-2">
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 hover:text-rust"
                >
                  <div className="font-display text-sm font-bold leading-tight truncate">
                    {l.label}
                  </div>
                  <div className="font-mono text-[10px] text-ink/50 truncate">{host(l.url)}</div>
                </a>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-ink/30 hover:text-ink"
                  aria-label="Open in new tab"
                >
                  <span className="material-icons text-base">open_in_new</span>
                </a>
                <button
                  onClick={() => remove(l.id)}
                  className="shrink-0 text-ink/20 hover:text-rust transition-colors"
                  aria-label="Remove"
                >
                  <span className="material-icons text-base">delete</span>
                </button>
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
