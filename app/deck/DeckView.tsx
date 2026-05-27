'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Submission } from '@/components/SubmissionCard';
import { extractYouTubeId } from '@/lib/url';

export function DeckView({ displayName }: { displayName: string }) {
  const [queue, setQueue] = useState<Submission[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [takeaway, setTakeaway] = useState('');
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch('/api/queue?status=approved');
    if (r.ok) {
      const data = await r.json();
      setQueue(data.submissions || []);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  // Pick the first approved as active if none selected
  useEffect(() => {
    if (!activeId && queue.length > 0) {
      setActiveId(queue[0].id);
      setStartedAt(Date.now());
      setTakeaway('');
    }
  }, [queue, activeId]);

  const active = useMemo(() => queue.find((s) => s.id === activeId) || null, [queue, activeId]);

  const markPlayed = async () => {
    if (!active) return;
    const duration = startedAt ? Math.round((Date.now() - startedAt) / 1000) : null;
    await fetch('/api/queue', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: active.id,
        status: 'played',
        takeaway: takeaway || null,
        duration_on_screen_s: duration,
      }),
    });
    // Move to next
    const next = queue.find((s) => s.id !== active.id);
    setActiveId(next?.id || null);
    setStartedAt(next ? Date.now() : null);
    setTakeaway('');
    refresh();
  };

  const skip = async () => {
    if (!active) return;
    // Move to back of queue by clearing position; easier MVP: just move active pointer
    const next = queue.find((s) => s.id !== active.id);
    setActiveId(next?.id || null);
    setStartedAt(next ? Date.now() : null);
    setTakeaway('');
  };

  const embedYouTube = active && (active.kind === 'youtube' || active.kind === 'youtube_short')
    ? extractYouTubeId(active.url) : null;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Bar */}
      <header className="border-b-2 border-ink px-6 py-3 flex items-center gap-6 flex-wrap">
        <Link href="/" className="font-display text-2xl font-black">Newsroom</Link>
        <span className="font-mono text-xs uppercase tracking-widest text-ink/60">/ streamer deck</span>
        <div className="ml-auto flex items-center gap-4 font-mono text-xs">
          <span className="uppercase tracking-widest">{queue.length} approved</span>
          <Link href="/mod" className="underline hover:text-rust">Mod View →</Link>
          <a href="/api/notes?format=markdown" className="underline hover:text-rust">Export Notes</a>
          <span>{displayName}</span>
        </div>
      </header>

      <main className="flex-1 grid lg:grid-cols-[1fr_320px] gap-0">
        {/* Active card */}
        <section className="p-8 border-r border-ink/20">
          {!active && (
            <div className="text-center py-24">
              <p className="font-display text-3xl mb-3">No approved items yet.</p>
              <p className="text-ink/60 font-mono text-sm mb-6">
                Your mods need to approve submissions in the
                <Link href="/mod" className="underline ml-1">Mod View</Link>.
              </p>
            </div>
          )}
          {active && (
            <article>
              {/* Header */}
              <div className="flex items-center gap-2 mb-3 flex-wrap font-mono text-xs uppercase tracking-widest">
                <span className="bg-ink text-paper px-2 py-1">{active.kind.replace('_', ' ')}</span>
                {active.credibility_tag && (
                  <span className="border border-ink px-2 py-1">{active.credibility_tag}</span>
                )}
                {active.dmca_risk === 'high' && (
                  <span className="bg-rust text-paper px-2 py-1">⚠ High DMCA risk</span>
                )}
                {active.dmca_risk === 'medium' && (
                  <span className="border-2 border-ochre text-ochre px-2 py-1">◐ Medium risk</span>
                )}
                {active.publisher && <span className="text-ink/60">· {active.publisher}</span>}
              </div>

              <h1 className="font-display text-4xl lg:text-5xl font-black leading-tight mb-4">
                {active.title || active.url}
              </h1>

              {active.summary && (
                <p className="text-lg leading-relaxed mb-6 max-w-3xl">{active.summary}</p>
              )}

              {/* Embed */}
              {embedYouTube && (
                <div className="aspect-video bg-ink mb-6 max-w-3xl">
                  <iframe
                    src={`https://www.youtube.com/embed/${embedYouTube}`}
                    className="w-full h-full"
                    allowFullScreen
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  />
                </div>
              )}

              {active.kind === 'article' && active.thumbnail_url && (
                <img
                  src={active.thumbnail_url}
                  alt=""
                  className="max-w-3xl border border-ink/20 mb-6"
                />
              )}

              {active.topics && active.topics.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-6">
                  {active.topics.map((t) => (
                    <span key={t} className="font-mono text-xs uppercase bg-paper border border-ink/30 px-2 py-1">
                      #{t}
                    </span>
                  ))}
                </div>
              )}

              {active.related_coverage && active.related_coverage.length > 0 && (
                <div className="mb-6 max-w-3xl">
                  <div className="rule-double mb-3" />
                  <h2 className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">
                    Related coverage ({active.related_coverage.length})
                  </h2>
                  <div className="space-y-2">
                    {active.related_coverage.map((c, i) => (
                      <a
                        key={i}
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block card-paper p-3 hover:border-ink"
                      >
                        <div className="font-display text-sm font-bold leading-tight mb-1">
                          {c.title}
                        </div>
                        <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">
                          {c.publisher}
                        </div>
                        {c.snippet && (
                          <div className="text-xs text-ink/70 leading-relaxed line-clamp-2">
                            {c.snippet}
                          </div>
                        )}
                      </a>
                    ))}
                  </div>
                  <div className="rule-double mt-3" />
                </div>
              )}

              <div className="flex gap-3 flex-wrap mb-6">
                <a
                  href={active.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-sm uppercase tracking-widest bg-ink text-paper px-4 py-2 hover:bg-rust transition-colors"
                >
                  Open source ↗
                </a>
                <button
                  onClick={markPlayed}
                  className="font-mono text-sm uppercase tracking-widest bg-moss text-paper px-4 py-2 hover:opacity-90"
                >
                  ✓ Played — next
                </button>
                <button
                  onClick={skip}
                  className="font-mono text-sm uppercase tracking-widest border border-ink/40 px-4 py-2 hover:bg-ink hover:text-paper"
                >
                  Skip
                </button>
              </div>

              {/* Takeaway */}
              <label className="block max-w-3xl">
                <span className="font-mono text-xs uppercase tracking-widest text-ink/60">
                  Takeaway for show notes (optional)
                </span>
                <textarea
                  value={takeaway}
                  onChange={(e) => setTakeaway(e.target.value)}
                  rows={3}
                  className="w-full mt-1 border border-ink/30 bg-paper p-3 font-mono text-sm focus:outline-none focus:border-ink"
                  placeholder="Add a one-liner about what you said about this on stream…"
                />
              </label>
            </article>
          )}
        </section>

        {/* Sidebar queue */}
        <aside className="p-4 bg-ink/5">
          <div className="font-mono text-xs uppercase tracking-widest mb-3 text-ink/60">
            Up next ({Math.max(queue.length - 1, 0)})
          </div>
          <div className="space-y-2">
            {queue.filter((s) => s.id !== activeId).slice(0, 20).map((s) => (
              <button
                key={s.id}
                onClick={() => { setActiveId(s.id); setStartedAt(Date.now()); setTakeaway(''); }}
                className="block w-full text-left card-paper p-2 hover:bg-paper"
              >
                <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">
                  {s.kind.replace('_', ' ')}
                  {s.dmca_risk === 'high' && <span className="text-rust ml-1">⚠</span>}
                </div>
                <div className="font-display text-sm font-bold leading-tight line-clamp-2">
                  {s.title || s.url}
                </div>
                {s.publisher && (
                  <div className="font-mono text-[10px] text-ink/50 mt-1 truncate">{s.publisher}</div>
                )}
              </button>
            ))}
          </div>
        </aside>
      </main>
    </div>
  );
}
