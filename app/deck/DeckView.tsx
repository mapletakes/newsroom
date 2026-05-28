'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Submission } from '@/components/SubmissionCard';
import { extractYouTubeId } from '@/lib/url';
import { DarkModeToggle } from '@/components/DarkModeToggle';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableQueueItem({
  s,
  onSelect,
  onRemove,
}: {
  s: Submission;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: s.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-stretch gap-0">
      <button
        {...attributes}
        {...listeners}
        className="shrink-0 w-6 flex items-center justify-center cursor-grab active:cursor-grabbing text-ink/25 hover:text-ink/50 select-none"
        aria-label="Drag to reorder"
        tabIndex={-1}
      >
        ⠿
      </button>
      <button
        onClick={onSelect}
        className="flex-1 text-left card-paper p-2 hover:bg-paper min-w-0"
      >
        <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">
          {s.kind.replace('_', ' ')}
          {s.dmca_risk === 'high' && <span className="text-rust ml-1">⚠</span>}
        </div>
        <div className="font-display text-sm font-bold leading-tight line-clamp-2">
          {s.title || s.url}
        </div>
        {s.publisher && (
          <div className="font-mono text-[10px] text-ink/50 mt-1 truncate">
            {s.publisher}
          </div>
        )}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="shrink-0 w-6 flex items-center justify-center text-ink/20 hover:text-rust transition-colors"
        aria-label="Remove"
        tabIndex={-1}
      >
        <span className="material-icons text-base">delete</span>
      </button>
    </div>
  );
}

export function DeckView({ displayName }: { displayName: string }) {
  const [queue, setQueue] = useState<Submission[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [takeaway, setTakeaway] = useState('');
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const [addUrl, setAddUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [addStatus, setAddStatus] = useState('');

  const suppressRefreshUntil = useRef(0);

  const refresh = useCallback(async () => {
    if (Date.now() < suppressRefreshUntil.current) return;
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

  useEffect(() => {
    if (!activeId && queue.length > 0) {
      setActiveId(queue[0].id);
      setStartedAt(Date.now());
      setTakeaway('');
    }
  }, [queue, activeId]);

  const active = useMemo(() => {
    const found = queue.find((s) => s.id === activeId) || null;
    if (found && found.related_coverage && !Array.isArray(found.related_coverage)) {
      try {
        found.related_coverage = JSON.parse(found.related_coverage as unknown as string);
      } catch {
        found.related_coverage = null;
      }
    }
    return found;
  }, [queue, activeId]);

  const sidebarItems = useMemo(
    () => queue.filter((s) => s.id !== activeId).slice(0, 30),
    [queue, activeId],
  );

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
    const next = sidebarItems[0];
    setActiveId(next?.id || null);
    setStartedAt(next ? Date.now() : null);
    setTakeaway('');
    refresh();
  };

  const skip = async () => {
    if (!active) return;
    const next = sidebarItems[0];
    setActiveId(next?.id || null);
    setStartedAt(next ? Date.now() : null);
    setTakeaway('');
  };

  const removeFromQueue = async (id: string) => {
    setQueue((prev) => prev.filter((s) => s.id !== id));
    await fetch('/api/queue', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'rejected' }),
    });
  };

  // --- Direct add ---
  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = addUrl.trim();
    if (!url || adding) return;
    setAdding(true);
    setAddStatus('');
    try {
      const r = await fetch('/api/deck/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (r.ok) {
        const data = await r.json();
        setAddUrl('');
        if (data.expanded) {
          setAddStatus(`Added ${data.count} videos from playlist`);
        } else {
          setAddStatus('Added');
        }
        refresh();
        setTimeout(() => setAddStatus(''), 3000);
      } else {
        const err = await r.json().catch(() => ({}));
        setAddStatus(err.error || 'Failed to add');
      }
    } finally {
      setAdding(false);
    }
  };

  // --- Drag and drop ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active: dragged, over } = event;
      if (!over || dragged.id === over.id) return;

      const oldIndex = sidebarItems.findIndex((s) => s.id === dragged.id);
      const newIndex = sidebarItems.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(sidebarItems, oldIndex, newIndex);

      // Optimistic local update — rebuild full queue with active first, then reordered sidebar
      setQueue((prev) => {
        const activeItem = prev.find((s) => s.id === activeId);
        return activeItem ? [activeItem, ...reordered] : [...reordered];
      });

      suppressRefreshUntil.current = Date.now() + 5000;

      await fetch('/api/queue/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: reordered.map((s) => s.id) }),
      });
    },
    [sidebarItems, activeId],
  );

  const embedYouTube =
    active && (active.kind === 'youtube' || active.kind === 'youtube_short')
      ? extractYouTubeId(active.url)
      : null;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b-2 border-ink px-6 py-3 flex items-center gap-6 flex-wrap">
        <Link href="/" className="font-display text-2xl font-black">
          Newsroom
        </Link>
        <span className="font-mono text-xs uppercase tracking-widest text-ink/60">
          / streamer deck
        </span>
        <div className="ml-auto flex items-center gap-4 font-mono text-xs">
          <span className="uppercase tracking-widest">{queue.length} approved</span>
          <Link href="/mod" className="underline hover:text-rust">
            Mod View &rarr;
          </Link>
          <a href="/api/notes?format=markdown" className="underline hover:text-rust">
            Export Notes
          </a>
          <Link href="/setup" className="underline hover:text-rust">
            Settings
          </Link>
          <span>{displayName}</span>
          <DarkModeToggle />
        </div>
      </header>

      <main className="flex-1 grid lg:grid-cols-[1fr_640px] gap-0">
        {/* Active card */}
        <section className="p-8 border-r border-ink/20">
          {!active && (
            <div className="text-center py-24">
              <p className="font-display text-3xl mb-3">No approved items yet.</p>
              <p className="text-ink/60 font-mono text-sm mb-6">
                Your mods need to approve submissions in the
                <Link href="/mod" className="underline ml-1">
                  Mod View
                </Link>
                , or add links directly from the sidebar.
              </p>
            </div>
          )}
          {active && (
            <article>
              <div className="flex items-center gap-2 mb-3 flex-wrap font-mono text-xs uppercase tracking-widest">
                <span className="bg-ink text-paper px-2 py-1">
                  {active.kind.replace('_', ' ')}
                </span>
                {active.credibility_tag && (
                  <span className="border border-ink px-2 py-1">{active.credibility_tag}</span>
                )}
                {active.dmca_risk === 'high' && (
                  <span className="bg-rust text-paper px-2 py-1">⚠ High DMCA risk</span>
                )}
                {active.dmca_risk === 'medium' && (
                  <span className="border-2 border-ochre text-ochre px-2 py-1">
                    ◐ Medium risk
                  </span>
                )}
                {active.publisher && <span className="text-ink/60">· {active.publisher}</span>}
              </div>

              <h1 className="font-display text-4xl lg:text-5xl font-black leading-tight mb-4">
                {active.title || active.url}
              </h1>

              {active.summary && (
                <p className="text-lg leading-relaxed mb-6 max-w-3xl">{active.summary}</p>
              )}

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
                    <span
                      key={t}
                      className="font-mono text-xs uppercase bg-paper border border-ink/30 px-2 py-1"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              )}

              {active.related_coverage &&
                Array.isArray(active.related_coverage) &&
                active.related_coverage.length > 0 && (
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

              <label className="block max-w-3xl">
                <span className="font-mono text-xs uppercase tracking-widest text-ink/60">
                  Takeaway for show notes (optional)
                </span>
                <textarea
                  value={takeaway}
                  onChange={(e) => setTakeaway(e.target.value)}
                  rows={3}
                  className="w-full mt-1 border border-ink/30 bg-paper p-3 font-mono text-sm focus:outline-none focus:border-ink"
                  placeholder="Add a one-liner about what you said about this on stream..."
                />
              </label>
            </article>
          )}
        </section>

        {/* Sidebar */}
        <aside className="p-4 bg-ink/5 flex flex-col">
          {/* Add link */}
          <form onSubmit={handleAddLink} className="mb-4">
            <div className="flex gap-1">
              <input
                type="url"
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                placeholder="Paste link or playlist URL..."
                className="flex-1 min-w-0 font-mono text-xs border border-ink/30 bg-paper px-2 py-1.5 focus:outline-none focus:border-ink"
                disabled={adding}
              />
              <button
                type="submit"
                disabled={adding || !addUrl.trim()}
                className="shrink-0 font-mono text-xs uppercase tracking-widest bg-ink text-paper px-3 py-1.5 hover:bg-rust transition-colors disabled:opacity-40"
              >
                {adding ? '...' : 'Add'}
              </button>
            </div>
            {addStatus && (
              <div className="font-mono text-[10px] mt-1 text-ink/60">{addStatus}</div>
            )}
          </form>

          <div className="font-mono text-xs uppercase tracking-widest mb-3 text-ink/60">
            Up next ({sidebarItems.length})
          </div>

          <div className="space-y-1 flex-1 overflow-y-auto">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sidebarItems.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                {sidebarItems.map((s) => (
                  <SortableQueueItem
                    key={s.id}
                    s={s}
                    onSelect={() => {
                      setActiveId(s.id);
                      setStartedAt(Date.now());
                      setTakeaway('');
                    }}
                    onRemove={() => removeFromQueue(s.id)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </aside>
      </main>
    </div>
  );
}
